#!/usr/bin/env node
/**
 * ssh-manager — Developer-friendly SSH session manager
 * 
 * Usage:
 *   ssh-manager                          → Open TUI
 *   ssh-manager connect <alias>          → Connect instantly
 *   ssh-manager add <alias> [options]    → Add a host
 *   ssh-manager list                     → List all hosts
 *   ssh-manager remove <alias>           → Remove a host
 *   ssh-manager history [alias]          → Show command history
 *   ssh-manager sessions [alias]         → Show session history
 *   ssh-manager import                   → Import from ~/.ssh/config
 *   ssh-manager export                   → Export config
 *   ssh-manager keygen <alias>           → Show key-setup commands
 *   ssh-manager setup-keys <alias>       → Actually run ssh-copy-id across every hop (one-shot, interactive)
 */

const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('./src/store');
const { buildSSHCommand, describeChain, resolveChain, generateKeySetupCommands } = require('./src/connection');

const pkg = require('./package.json');
const program = new Command();

// ─── Colours ──────────────────────────────────────────────────────────────────
const accent  = s => chalk.hex('#7c6af7')(s);
const dim     = s => chalk.hex('#4a4a5a')(s);
const muted   = s => chalk.hex('#6b6b80')(s);
const bright  = s => chalk.hex('#e8e8f0').bold(s);
const green   = s => chalk.hex('#4ade80')(s);
const yellow  = s => chalk.hex('#fbbf24')(s);
const red     = s => chalk.hex('#f87171')(s);
const cyan    = s => chalk.hex('#22d3ee')(s);

function header() {
  console.log(accent('⬡ ssh-manager') + dim(' v' + pkg.version));
}

function formatDuration(secs) {
  if (!secs) return dim('—');
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ─── Program ──────────────────────────────────────────────────────────────────
program
  .name('ssh-manager')
  .description('Secure SSH session manager with multi-hop support')
  .version(pkg.version);

// ─── Default: open TUI ────────────────────────────────────────────────────────
program
  .action(() => {
    const { createTUI } = require('./src/tui');
    createTUI();
  });

// ─── connect ──────────────────────────────────────────────────────────────────
program
  .command('connect <alias>')
  .alias('c')
  .description('Connect to a host by alias')
  .option('-v, --verbose', 'Verbose SSH output')
  .option('--dry-run', 'Print the SSH command without connecting')
  .action((alias, opts) => {
    const host = store.getHost(alias);
    if (!host) {
      console.error(red(`✗ Unknown host alias: "${alias}"`));
      const all = Object.keys(store.getAllHosts());
      const close = all.filter(a => a.startsWith(alias[0]));
      if (close.length > 0) console.log(muted(`  Did you mean: ${close.join(', ')}?`));
      process.exit(1);
    }

    let cmd;
    try {
      cmd = buildSSHCommand(alias, { verbose: opts.verbose });
    } catch (e) {
      console.error(red(`✗ ${e.message}`));
      process.exit(1);
    }

    let chain;
    try { chain = describeChain(alias); } catch { chain = `${host.user}@${host.hostname}`; }

    console.log(accent('⬡') + ' ' + bright(alias) + dim('  →  ') + cyan(chain));

    if (opts.dryRun) {
      console.log('\n' + dim('SSH command:'));
      console.log(cyan(cmd));
      return;
    }

    const startTime = Date.now();
    console.log(dim(cmd) + '\n');

    const proc = spawn('bash', ['-c', cmd], { stdio: 'inherit', env: process.env });

    proc.on('exit', (code) => {
      const duration = Math.floor((Date.now() - startTime) / 1000);
      store.recordSession(alias, duration);
      console.log(dim(`\n⬡ disconnected (${formatDuration(duration)})`));
    });
  });

// ─── add ──────────────────────────────────────────────────────────────────────
program
  .command('add <alias>')
  .description('Add a new SSH host')
  .option('-H, --host <hostname>', 'Hostname or IP address')
  .option('-u, --user <username>', 'SSH username')
  .option('-p, --port <port>', 'SSH port (default: 22)', '22')
  .option('-j, --jump <alias>', 'Jump host alias')
  .option('-J, --jump-chain <aliases>', 'Ordered jump chain (comma-separated aliases)')
  .option('-i, --identity <path>', 'Path to private key')
  .option('-g, --group <group>', 'Group/tag for organization', 'default')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--password', 'Prompt for password to store encrypted')
  .action(async (alias, opts) => {
    header();

    if (store.getHost(alias)) {
      console.error(yellow(`! Host "${alias}" already exists. Use 'ssh-manager edit ${alias}' to update.`));
      process.exit(1);
    }

    // Interactive prompts for missing required fields
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(muted(q) + ' ', res));

    const hostname = opts.host || await ask('Hostname / IP:');
    const user     = opts.user || await ask('Username:');

    let password = null;
    if (opts.password) {
      process.stdout.write(muted('Password (stored encrypted): '));
      password = await new Promise(res => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        let pw = '';
        process.stdin.on('data', function handler(char) {
          char = char.toString();
          if (char === '\n' || char === '\r' || char === '\u0003') {
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handler);
            process.stdin.pause();
            console.log('');
            res(pw);
          } else if (char === '\u007f') {
            pw = pw.slice(0, -1);
          } else {
            pw += char;
          }
        });
      });
    }

    rl.close();

    const entry = {
      hostname: hostname.trim(),
      user: user.trim(),
      port: parseInt(opts.port) || 22,
      jump: opts.jump || null,
      jumpChain: opts.jumpChain ? opts.jumpChain.split(',').map(s => s.trim()) : [],
      keyPath: opts.identity || null,
      group: opts.group || 'default',
      tags: opts.tags ? opts.tags.split(',').map(s => s.trim()) : [],
      password,
    };

    store.addHost(alias, entry);
    let chain;
    try { chain = describeChain(alias); } catch { chain = `${user}@${hostname}`; }

    console.log(green(`✓ Added "${alias}"`));
    console.log(dim('  path: ') + cyan(chain));
    console.log(dim('\nConnect with: ') + accent(`ssh-manager connect ${alias}`));
  });

// ─── list ─────────────────────────────────────────────────────────────────────
program
  .command('list')
  .alias('ls')
  .description('List all configured hosts')
  .option('-g, --group <group>', 'Filter by group')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const hosts = store.getAllHosts();
    const aliases = Object.keys(hosts);

    if (aliases.length === 0) {
      header();
      console.log(muted('\nNo hosts configured yet.'));
      console.log(dim('  ssh-manager add <alias> --host <ip> --user <user>'));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(hosts, null, 2));
      return;
    }

    header();
    const table = new Table({
      head: [
        accent('Alias'), cyan('Host'), muted('User'), muted('Port'),
        yellow('Jump'), green('Group'), dim('Last connected'), dim('Connects'),
      ],
      style: { head: [], border: ['grey'] },
      chars: { 'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
               'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
               'left': '│', 'right': '│', 'mid': '─', 'mid-mid': '┼', 'middle': '│' },
    });

    for (const alias of aliases) {
      const h = hosts[alias];
      if (opts.group && h.group !== opts.group) continue;
      const jumpLabel = h.jump || (h.jumpChain && h.jumpChain.length > 0 ? h.jumpChain.join('→') : '');
      const last = h.lastConnected ? new Date(h.lastConnected).toLocaleDateString() : dim('—');
      table.push([
        bright(alias),
        h.hostname,
        muted(h.user),
        muted(String(h.port)),
        jumpLabel ? yellow(jumpLabel) : dim('—'),
        green(h.group || 'default'),
        last,
        String(h.connectCount || 0),
      ]);
    }
    console.log(table.toString());
  });

// ─── remove ───────────────────────────────────────────────────────────────────
program
  .command('remove <alias>')
  .alias('rm')
  .description('Remove a host')
  .action((alias) => {
    if (!store.getHost(alias)) {
      console.error(red(`✗ Unknown alias: "${alias}"`));
      process.exit(1);
    }
    store.removeHost(alias);
    console.log(green(`✓ Removed "${alias}"`));
  });

// ─── history ──────────────────────────────────────────────────────────────────
program
  .command('history [alias]')
  .alias('hist')
  .description('Show command history (all hosts or specific alias)')
  .option('-n, --limit <n>', 'Number of entries', '50')
  .option('--json', 'Output as JSON')
  .action((alias, opts) => {
    const history = store.getCommandHistory(alias, parseInt(opts.limit));
    if (opts.json) { console.log(JSON.stringify(history, null, 2)); return; }

    header();
    if (history.length === 0) {
      console.log(muted('\nNo command history yet.'));
      return;
    }

    console.log('');
    for (const c of history) {
      const ts = new Date(c.timestamp).toLocaleString();
      console.log(dim(ts) + '  ' + accent(c.alias) + '  ' + cyan('❯') + ' ' + bright(c.command));
    }
  });

// ─── sessions ─────────────────────────────────────────────────────────────────
program
  .command('sessions [alias]')
  .description('Show session history')
  .option('-n, --limit <n>', 'Number of entries', '20')
  .option('--json', 'Output as JSON')
  .action((alias, opts) => {
    const sessions = store.getSessions(alias, parseInt(opts.limit));
    if (opts.json) { console.log(JSON.stringify(sessions, null, 2)); return; }

    header();
    if (sessions.length === 0) {
      console.log(muted('\nNo sessions recorded yet.'));
      return;
    }

    const table = new Table({
      head: [accent('Alias'), cyan('Started'), muted('Duration')],
      style: { border: ['grey'] },
    });
    for (const s of sessions) {
      table.push([bright(s.alias), new Date(s.startedAt).toLocaleString(), formatDuration(s.durationSecs)]);
    }
    console.log(table.toString());
  });

// ─── keygen ───────────────────────────────────────────────────────────────────
program
  .command('keygen <alias>')
  .description('Show commands to set up key-based auth across the jump chain')
  .action((alias) => {
    if (!store.getHost(alias)) {
      console.error(red(`✗ Unknown alias: "${alias}"`));
      process.exit(1);
    }
    header();
    console.log('\n' + yellow('Key setup commands for: ') + bright(alias));
    console.log(dim('Run these to enable passwordless auth:\n'));
    const cmds = generateKeySetupCommands(alias);
    for (const { host, command } of cmds) {
      console.log(muted(`# ${host.alias || host.hostname}`));
      console.log(cyan(command) + '\n');
    }
  });

// ─── setup-keys — pure ssh2, no ssh-copy-id, no password-over-ProxyJump hell ──
program
  .command('setup-keys <alias>')
  .alias('sk')
  .description('One-shot: copy your public key to every hop (type password once per hop, never again)')
  .option('-i, --identity <path>', 'Public key to install (default: auto-detected)')
  .option('--generate', 'Generate a new ed25519 key pair if none exists')
  .action(async (alias, opts) => {
    header();

    if (!store.getHost(alias)) {
      console.error(red(`✗ Unknown alias: "${alias}"`));
      process.exit(1);
    }

    // ── 1. Find or generate a key pair ──────────────────────────────────────
    const sshDir = path.join(os.homedir(), '.ssh');
    const keySearchPaths = [
      path.join(sshDir, 'id_ed25519'),
      path.join(sshDir, 'id_rsa'),
      path.join(sshDir, 'id_ecdsa'),
    ];

    let privKeyPath = opts.identity
      ? opts.identity.replace(/\.pub$/, '')
      : keySearchPaths.find(p => fs.existsSync(p));

    if (!privKeyPath) {
      if (opts.generate) {
        privKeyPath = path.join(sshDir, 'id_ed25519');
        console.log(yellow('\n  No SSH key found — generating ed25519 key pair…'));
        try {
          fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
          execSync(
            `ssh-keygen -t ed25519 -f "${privKeyPath}" -N "" -C "${os.userInfo().username}@$(hostname)"`,
            { stdio: 'inherit' }
          );
          console.log(green('  ✓ Key pair created: ') + cyan(privKeyPath) + '\n');
        } catch (e) {
          console.error(red('  ✗ ssh-keygen failed: ' + e.message));
          process.exit(1);
        }
      } else {
        console.error(red('  ✗ No SSH key found in ~/.ssh/'));
        console.log(muted('  Generate one first:'));
        console.log(cyan(`  sm setup-keys ${alias} --generate`));
        process.exit(1);
      }
    }

    const pubKeyPath = privKeyPath + '.pub';
    if (!fs.existsSync(pubKeyPath)) {
      console.error(red(`  ✗ Public key not found: ${pubKeyPath}`));
      process.exit(1);
    }

    // ── 2. Resolve the full chain ────────────────────────────────────────────
    let chain;
    try {
      chain = resolveChain(alias);
    } catch (e) {
      console.error(red(`  ✗ ${e.message}`));
      process.exit(1);
    }

    console.log('');
    console.log(accent('⬡') + ' Installing key across ' + bright(String(chain.length)) + ' hop(s) for ' + bright(alias));
    console.log(dim(`  Key: ${pubKeyPath}`));
    console.log(dim(`  Path: ${chain.map(h => `${h.user}@${h.hostname}`).join(' → ')}`));
    console.log('');
    console.log(muted('  Enter the remote password when prompted — once per hop.'));
    console.log(muted('  After this completes, you will never need a password again.\n'));

    // ── 3. Walk the chain using pure ssh2 tunnels ────────────────────────────
    const { copyKeyChain } = require('./src/keycopy');

    let successCount = 0;
    try {
      await copyKeyChain(chain, pubKeyPath, {
        step: (i, total, label) => {
          process.stdout.write(dim(`  [${i}/${total}] `) + accent(label) + '\n');
        },
        success: (label) => {
          if (label === '__done__') return;
          console.log(green(`         ✓ key installed\n`));
          successCount++;
        },
        error: (msg) => {
          console.error(red(`         ✗ ${msg}\n`));
        },
      });
    } catch (e) {
      console.error(red(`\n  ✗ Failed: ${e.message}`));
      if (e.message.includes('ECONNREFUSED')) {
        console.log(muted('  → Host unreachable. Check hostname/port.'));
      } else if (e.message.includes('Authentication') || e.message.includes('auth')) {
        console.log(muted('  → Wrong password, or the server only allows key auth.'));
        console.log(muted('    Ask your admin to temporarily allow password auth, or copy the key manually.'));
      }
      process.exit(1);
    }

    // ── 4. Update store — all hops now use key auth ──────────────────────────
    for (const h of chain) {
      if (h.alias) store.updateHost(h.alias, { keyPath: privKeyPath, password: null });
    }
    store.updateHost(alias, { keyPath: privKeyPath, password: null });

    console.log('');
    console.log(green('✓ Done! ') + bright(alias) + ' is now fully passwordless.');
    console.log('');
    console.log(dim('  Connect with:'));
    console.log('  ' + cyan(`sm connect ${alias}`) + dim('  or  ') + cyan(`sm c ${alias}`));
    console.log('');
  });

// ─── import ───────────────────────────────────────────────────────────────────
program
  .command('import')
  .description('Import hosts from ~/.ssh/config')
  .option('--dry-run', 'Preview without saving')
  .action((opts) => {
    header();
    const configPath = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(configPath)) {
      console.error(red('✗ ~/.ssh/config not found'));
      process.exit(1);
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const blocks = raw.split(/^Host\s+/m).slice(1);
    let imported = 0;

    for (const block of blocks) {
      const lines = block.split('\n');
      const aliasLine = lines[0].trim();
      if (aliasLine.includes('*')) continue; // skip wildcards

      const alias = aliasLine.split(/\s+/)[0];
      const get = key => {
        const m = block.match(new RegExp(`^\\s*${key}\\s+(.+)$`, 'mi'));
        return m ? m[1].trim() : null;
      };

      const hostname = get('HostName') || alias;
      const user = get('User') || os.userInfo().username;
      const port = parseInt(get('Port')) || 22;
      const keyPath = get('IdentityFile');
      const proxy = get('ProxyJump') || get('ProxyCommand');

      if (opts.dryRun) {
        console.log(accent(alias) + dim('  →  ') + `${user}@${hostname}:${port}`);
      } else {
        if (!store.getHost(alias)) {
          store.addHost(alias, { hostname, user, port, keyPath, group: 'imported' });
          imported++;
          console.log(green('✓') + ' ' + bright(alias));
        } else {
          console.log(yellow('~') + ' ' + dim(`Skipped (already exists): ${alias}`));
        }
      }
    }
    if (!opts.dryRun) console.log(dim(`\nImported ${imported} host(s) into group "imported"`));
  });

// ─── info ─────────────────────────────────────────────────────────────────────
program
  .command('info <alias>')
  .description('Show detailed info for a host')
  .action((alias) => {
    const host = store.getHost(alias);
    if (!host) { console.error(red(`✗ Unknown alias: "${alias}"`)); process.exit(1); }

    header();
    let chain;
    try { chain = describeChain(alias); } catch (e) { chain = red(e.message); }
    let sshCmd;
    try { sshCmd = buildSSHCommand(alias); } catch (e) { sshCmd = red(e.message); }

    console.log(`
${bright(alias)}
${muted('─'.repeat(40))}
  ${muted('Host')}       ${cyan(host.hostname)}:${host.port}
  ${muted('User')}       ${host.user}
  ${muted('Auth')}       ${host.keyPath ? green('key: ' + host.keyPath) : host.password ? yellow('password (stored)') : red('none')}
  ${muted('Group')}      ${host.group || 'default'}
  ${muted('Tags')}       ${(host.tags || []).map(t => accent('#' + t)).join(' ') || dim('none')}
  ${muted('Jump path')}  ${chain}
  ${muted('Connects')}   ${host.connectCount || 0}
  ${muted('Last conn')}  ${host.lastConnected ? new Date(host.lastConnected).toLocaleString() : dim('never')}

${muted('SSH command:')}
  ${dim(sshCmd)}
    `);
  });

// ─── cmd — run a one-off command on a remote host ────────────────────────────
program
  .command('cmd <alias> <command...>')
  .description('Run a command on a remote host and return output')
  .action((alias, commandParts) => {
    const cmd_str = commandParts.join(' ');
    const host = store.getHost(alias);
    if (!host) { console.error(red(`✗ Unknown alias: "${alias}"`)); process.exit(1); }

    let sshCmd;
    try {
      sshCmd = buildSSHCommand(alias, { command: cmd_str });
    } catch (e) {
      console.error(red(`✗ ${e.message}`)); process.exit(1);
    }

    console.log(dim(`${alias} ❯ ${cmd_str}`));
    const result = spawn('bash', ['-c', sshCmd], { stdio: 'inherit', env: process.env });
    result.on('exit', (code) => {
      store.recordCommand(alias, cmd_str, null);
    });
  });

program.parse(process.argv);
