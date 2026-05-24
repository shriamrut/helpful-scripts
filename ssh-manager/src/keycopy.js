/**
 * keycopy.js — Pure ssh2 key installer, no ssh-copy-id needed.
 *
 * Strategy: prompt for password BEFORE connecting. Then connect once with
 * the right credentials. No authHandler state machines, no race conditions.
 */

'use strict';

const { Client } = require('ssh2');
const fs   = require('fs');
const os   = require('os');

// ── Password prompt (no echo) ──────────────────────────────────────────────

function promptPassword(label) {
  return new Promise((resolve) => {
    process.stdout.write(`  password for ${label}: `);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let pw = '';
    const onData = (buf) => {
      const ch = buf.toString('utf8');
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pw);
      } else if (ch === '\u0003') {          // Ctrl-C
        stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(null);
      } else if (ch === '\u007f' || ch === '\b') {  // backspace
        pw = pw.slice(0, -1);
      } else {
        pw += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ── Auto-detect local private keys ────────────────────────────────────────

function findLocalKeys() {
  const home = os.homedir();
  const candidates = [
    `${home}/.ssh/id_ed25519`,
    `${home}/.ssh/id_rsa`,
    `${home}/.ssh/id_ecdsa`,
  ];
  const keys = [];
  for (const p of candidates) {
    try { keys.push(fs.readFileSync(p)); } catch {}
  }
  return keys;  // Buffer[]
}

// ── Connect to one host, returning a ready ssh2 Client ─────────────────────
//
// We try in order:
//   1. Any local private keys (silent — just skip if they fail)
//   2. Prompt for password once, try 'password' auth
//   3. Prompt for password once, try 'keyboard-interactive' auth
//
// sock: optional stream to use as transport (for jump-host tunnels)

async function connectHost(host, sock) {
  const label = `${host.user}@${host.hostname}`;

  // --- Step 1: try key auth (no prompt needed) ---
  const localKeys = findLocalKeys();
  if (host.keyPath) {
    try { localKeys.unshift(fs.readFileSync(host.keyPath.replace(/^~/, os.homedir()))); } catch {}
  }

  for (const key of localKeys) {
    const result = await attemptConnect({ host, sock, privateKey: key });
    if (result) return result;
    // If it failed due to auth, try next key; other errors bubble up
  }

  // --- Step 2: prompt for password, then connect ---
  const pw = await promptPassword(label);
  if (pw === null) throw new Error('Cancelled by user');

  // Try plain 'password' auth first
  const r1 = await attemptConnect({ host, sock, password: pw });
  if (r1) return r1;

  // Some servers only accept keyboard-interactive
  const r2 = await attemptConnectKbdInt({ host, sock, password: pw });
  if (r2) return r2;

  throw new Error(`Authentication failed for ${label} — wrong password?`);
}

// Attempt a single connection with given credentials.
// Resolves with the Client on success, null on auth failure, throws on other errors.
function attemptConnect({ host, sock, privateKey, password }) {
  return new Promise((resolve) => {
    const client = new Client();

    client.on('ready', () => resolve(client));

    client.on('error', (err) => {
      // Auth failures come through as errors with level 'client-authentication'
      if (err.level === 'client-authentication' || /auth/i.test(err.message)) {
        resolve(null);
      } else {
        resolve(null); // surface as null so caller can give a better message
      }
    });

    const opts = {
      host:         host.hostname,
      port:         host.port || 22,
      username:     host.user,
      readyTimeout: 30000,
      sock,
    };
    if (privateKey) opts.privateKey = privateKey;
    if (password)   opts.password   = password;

    client.connect(opts);
  });
}

// keyboard-interactive variant — server sends a prompt, we answer with the password
function attemptConnectKbdInt({ host, sock, password }) {
  return new Promise((resolve) => {
    const client = new Client();

    client.on('ready', () => resolve(client));
    client.on('error', () => resolve(null));

    client.on('keyboard-interactive', (_name, _inst, _lang, prompts, finish) => {
      // Answer every prompt (usually just "Password:") with our password
      finish(prompts.map(() => password));
    });

    client.connect({
      host:                  host.hostname,
      port:                  host.port || 22,
      username:              host.user,
      readyTimeout:          30000,
      sock,
      tryKeyboard:           true,
      authHandler:           ['keyboard-interactive'],
    });
  });
}

// ── Install the public key on a connected host ─────────────────────────────

function installKey(client, pubKeyContent) {
  return new Promise((resolve, reject) => {
    const key = pubKeyContent.trim().replace(/'/g, "'\\''");   // shell-escape single quotes
    const cmd = [
      'mkdir -p ~/.ssh',
      'chmod 700 ~/.ssh',
      'touch ~/.ssh/authorized_keys',
      'chmod 600 ~/.ssh/authorized_keys',
      // Append only if not already present
      `grep -qF "${pubKeyContent.trim().split(' ').slice(0,2).join(' ')}" ~/.ssh/authorized_keys` +
        ` || printf '%s\\n' '${key}' >> ~/.ssh/authorized_keys`,
    ].join(' && ');

    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stderr = '';
      stream.stderr.on('data', (d) => { stderr += d; });
      stream.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`authorized_keys write failed (exit ${code}): ${stderr.trim()}`));
      });
    });
  });
}

// ── Open a TCP tunnel through an existing Client ───────────────────────────

function openTunnel(jumpClient, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    jumpClient.forwardOut(
      '127.0.0.1', 0,
      targetHost, targetPort || 22,
      (err, stream) => {
        if (err) reject(new Error(`Tunnel → ${targetHost}:${targetPort} failed: ${err.message}`));
        else resolve(stream);
      }
    );
  });
}

// ── Main: walk the chain, install key at each hop ─────────────────────────

async function copyKeyChain(chain, pubKeyPath, log = {}) {
  const {
    step    = (i, n, label) => console.log(`[${i}/${n}] ${label}`),
    success = (label) => console.log(`✓ ${label}`),
  } = log;

  const pubKeyContent = fs.readFileSync(pubKeyPath, 'utf8').trim();
  const clients = [];
  let sock = undefined;

  try {
    for (let i = 0; i < chain.length; i++) {
      const host  = chain[i];
      const label = `${host.user}@${host.hostname}:${host.port || 22}`;
      const isLast = i === chain.length - 1;

      step(i + 1, chain.length, label);

      const client = await connectHost(host, sock);
      clients.push(client);

      await installKey(client, pubKeyContent);
      success(label);

      // Update store so future connects use the key
      if (host.alias) {
        try {
          const store = require('./store');
          store.updateHost(host.alias, {
            keyPath: pubKeyPath.replace(/\.pub$/, ''),
            password: null,
          });
        } catch {}
      }

      if (!isLast) {
        const next = chain[i + 1];
        sock = await openTunnel(client, next.hostname, next.port || 22);
      }
    }

    success('__done__');
  } finally {
    for (const c of [...clients].reverse()) {
      try { c.end(); } catch {}
    }
  }
}

module.exports = { copyKeyChain, promptPassword };
