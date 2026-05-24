/**
 * ssh-manager: SSH command builder
 * Resolves multi-hop jump chains and builds the correct ssh invocation.
 */

const store = require('./store');
const path = require('path');
const os = require('os');

/**
 * Resolve the full jump chain for a host alias (recursive).
 * Returns ordered array of HostEntry from outermost jump to target.
 */
function resolveChain(alias, visited = new Set()) {
  if (visited.has(alias)) {
    throw new Error(`Circular jump chain detected at: ${alias}`);
  }
  visited.add(alias);

  const host = store.getHost(alias);
  if (!host) throw new Error(`Unknown host alias: "${alias}"`);

  // Explicit jumpChain array takes precedence
  if (host.jumpChain && host.jumpChain.length > 0) {
    const chain = host.jumpChain.map(j => {
      const jh = store.getHost(j);
      if (!jh) throw new Error(`Jump host "${j}" not found (referenced by "${alias}")`);
      return jh;
    });
    return [...chain, host];
  }

  // Single jump
  if (host.jump) {
    const jumpChain = resolveChain(host.jump, visited);
    return [...jumpChain, host];
  }

  return [host];
}

/**
 * Build the SSH command string for a given alias.
 */
function buildSSHCommand(alias, options = {}) {
  const chain = resolveChain(alias);
  const target = chain[chain.length - 1];
  const jumps = chain.slice(0, -1);

  const args = ['ssh'];

  // SSH options
  const sshOpts = [
    '-o StrictHostKeyChecking=accept-new',
    '-o ServerAliveInterval=60',
    '-o ServerAliveCountMax=3',
    '-o ConnectTimeout=10',
  ];

  if (options.verbose) sshOpts.push('-v');

  // Build ProxyJump chain for multi-hop
  if (jumps.length > 0) {
    const proxyChain = jumps.map(j => {
      const userHost = `${j.user}@${j.hostname}`;
      const portOpt = j.port !== 22 ? `:${j.port}` : '';
      return `${userHost}${portOpt}`;
    }).join(',');
    sshOpts.push(`-J ${proxyChain}`);
  }

  // Key file
  const keyPath = target.keyPath || defaultKeyPath();
  if (keyPath) {
    sshOpts.push(`-i ${keyPath}`);
  }

  // Port
  if (target.port && target.port !== 22) {
    sshOpts.push(`-p ${target.port}`);
  }

  args.push(...sshOpts);
  args.push(`${target.user}@${target.hostname}`);

  // Optional remote command
  if (options.command) {
    args.push(`"${options.command}"`);
  }

  return args.join(' ');
}

/**
 * Build an sshpass-wrapped command if password is needed,
 * or plain ssh if key auth is configured.
 */
function buildFullCommand(alias, options = {}) {
  const chain = resolveChain(alias);
  const sshCmd = buildSSHCommand(alias, options);

  // Check if any host in chain uses password auth
  const needsPassword = chain.some(h => h.password && !h.keyPath);

  if (needsPassword) {
    // We'll use SSH_ASKPASS or sshpass — return metadata so caller handles it
    return {
      command: sshCmd,
      requiresPassword: true,
      chain,
    };
  }

  return {
    command: sshCmd,
    requiresPassword: false,
    chain,
  };
}

function defaultKeyPath() {
  const candidates = [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_ecdsa'),
  ];
  const { existsSync } = require('fs');
  return candidates.find(p => existsSync(p)) || null;
}

/**
 * Returns a human-readable description of the connection path.
 */
function describeChain(alias) {
  const chain = resolveChain(alias);
  return chain.map(h => `${h.user}@${h.hostname}:${h.port}`).join(' → ');
}

/**
 * Generate ssh-copy-id commands to set up key-based auth across the chain.
 */
function generateKeySetupCommands(alias) {
  const chain = resolveChain(alias);
  const commands = [];

  for (let i = 0; i < chain.length; i++) {
    const h = chain[i];
    const jumps = chain.slice(0, i);
    let cmd;

    if (jumps.length === 0) {
      cmd = `ssh-copy-id -i ~/.ssh/id_ed25519.pub ${h.user}@${h.hostname}`;
    } else {
      const proxyChain = jumps.map(j => `${j.user}@${j.hostname}`).join(',');
      cmd = `ssh-copy-id -i ~/.ssh/id_ed25519.pub -o ProxyJump=${proxyChain} ${h.user}@${h.hostname}`;
    }
    commands.push({ host: h, command: cmd });
  }

  return commands;
}

module.exports = { resolveChain, buildSSHCommand, buildFullCommand, describeChain, generateKeySetupCommands };
