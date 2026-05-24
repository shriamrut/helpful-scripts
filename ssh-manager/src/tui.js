/**
 * ssh-manager TUI
 * A Claude Code-inspired dark terminal interface.
 * Navigate hosts, connect, view history — keyboard driven.
 */

const blessed = require('blessed');
const contrib = require('blessed-contrib');
const { execSync, spawn } = require('child_process');
const chalk = require('chalk');
const store = require('./store');
const { buildSSHCommand, describeChain, resolveChain } = require('./connection');

// ─── Colour palette ──────────────────────────────────────────────────────────
const C = {
  bg:       '#0d0d0f',
  bgPanel:  '#131316',
  bgHover:  '#1c1c22',
  border:   '#2a2a35',
  dim:      '#4a4a5a',
  muted:    '#6b6b80',
  text:     '#c8c8d4',
  bright:   '#e8e8f0',
  accent:   '#7c6af7',   // purple — brand colour
  accentB:  '#a89ff8',
  green:    '#4ade80',
  yellow:   '#fbbf24',
  red:      '#f87171',
  cyan:     '#22d3ee',
  orange:   '#fb923c',
};

function createTUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'ssh-manager',
    cursor: { artificial: true, shape: 'line', blink: true, color: C.accent },
    fullUnicode: true,
    dockBorders: false,
  });

  // ─── Layout: left sidebar + right pane ────────────────────────────────────
  const sidebar = blessed.box({
    parent: screen,
    left: 0, top: 0,
    width: 32, height: '100%',
    style: { bg: C.bgPanel },
    border: { type: 'line' },
    style: { border: { fg: C.border }, bg: C.bgPanel },
  });

  const mainPane = blessed.box({
    parent: screen,
    left: 32, top: 0,
    width: screen.width - 32, height: '100%-3',
    style: { bg: C.bg },
    border: { type: 'line' },
    style: { border: { fg: C.border }, bg: C.bg },
  });

  const statusBar = blessed.box({
    parent: screen,
    left: 0, bottom: 0,
    width: '100%', height: 3,
    style: { bg: C.bgPanel, border: { fg: C.border } },
    border: { type: 'line' },
  });

  // ─── Sidebar: logo + host list ────────────────────────────────────────────
  const logo = blessed.text({
    parent: sidebar,
    top: 1, left: 2,
    content: `{bold}{#7c6af7-fg}⬡ ssh-manager{/}`,
    tags: true,
    style: { bg: C.bgPanel },
  });

  const divider1 = blessed.line({
    parent: sidebar,
    top: 3, left: 1,
    orientation: 'horizontal',
    width: 28,
    style: { fg: C.border, bg: C.bgPanel },
  });

  const filterBox = blessed.textbox({
    parent: sidebar,
    top: 4, left: 2,
    width: 27, height: 3,
    border: { type: 'line' },
    style: {
      bg: C.bgHover, fg: C.text,
      border: { fg: C.dim },
      focus: { border: { fg: C.accent } },
    },
    inputOnFocus: true,
    keys: true,
  });

  blessed.text({
    parent: sidebar,
    top: 4, left: 3,
    content: '{#4a4a5a-fg}/ filter{/}',
    tags: true,
    style: { bg: C.bgHover },
  });

  const hostList = blessed.list({
    parent: sidebar,
    top: 8, left: 1,
    width: 29, height: screen.height - 14,
    keys: true, vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: { ch: '│', style: { fg: C.dim } },
    style: {
      bg: C.bgPanel, fg: C.text,
      selected: { bg: C.accent, fg: '#ffffff', bold: true },
      item: { hover: { bg: C.bgHover } },
    },
    tags: true,
  });

  const sidebarHint = blessed.text({
    parent: sidebar,
    bottom: 1, left: 2,
    content: `{#4a4a5a-fg}↑↓ nav  enter connect{/}`,
    tags: true,
    style: { bg: C.bgPanel },
  });

  // ─── Main pane: detail view ───────────────────────────────────────────────
  const headerText = blessed.text({
    parent: mainPane,
    top: 1, left: 2,
    tags: true,
    content: '{bold}{#7c6af7-fg}Select a host to begin{/}',
    style: { bg: C.bg },
  });

  const detailBox = blessed.box({
    parent: mainPane,
    top: 3, left: 2,
    width: '100%-6', height: 12,
    border: { type: 'line' },
    style: { border: { fg: C.border }, bg: C.bg },
    tags: true,
    content: '',
  });

  const tabBar = blessed.text({
    parent: mainPane,
    top: 16, left: 2,
    tags: true,
    content: '',
    style: { bg: C.bg },
  });

  const contentBox = blessed.box({
    parent: mainPane,
    top: 18, left: 2,
    width: '100%-6', height: '100%-22',
    border: { type: 'line' },
    style: { border: { fg: C.border }, bg: C.bg },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: C.dim } },
    keys: true,
    vi: true,
    content: '',
  });

  // ─── Status bar ───────────────────────────────────────────────────────────
  const statusLeft = blessed.text({
    parent: statusBar,
    top: 1, left: 2,
    tags: true,
    content: '',
    style: { bg: C.bgPanel },
  });

  const statusRight = blessed.text({
    parent: statusBar,
    top: 1, right: 2,
    tags: true,
    content: `{#4a4a5a-fg}q quit  a add  d del  c connect  h history  s sessions  ? help{/}`,
    style: { bg: C.bgPanel },
  });

  // ─── Overlay / modal helper ───────────────────────────────────────────────
  function showModal(title, content, onClose) {
    const modal = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: 70, height: 24,
      border: { type: 'line' },
      style: { border: { fg: C.accent }, bg: C.bgPanel },
      tags: true,
      keys: true,
      scrollable: true,
      alwaysScroll: true,
      label: ` {bold}{#7c6af7-fg}${title}{/} `,
    });
    blessed.text({
      parent: modal,
      top: 1, left: 2,
      tags: true, content,
      style: { bg: C.bgPanel },
    });
    blessed.text({
      parent: modal,
      bottom: 1, left: 2,
      tags: true,
      content: `{#4a4a5a-fg}Press ESC or q to close{/}`,
      style: { bg: C.bgPanel },
    });
    modal.focus();
    modal.key(['escape', 'q'], () => { modal.destroy(); screen.render(); if (onClose) onClose(); });
    screen.render();
    return modal;
  }

  // ─── State ────────────────────────────────────────────────────────────────
  let allHosts = {};
  let filteredAliases = [];
  let selectedAlias = null;
  let currentTab = 'info'; // info | history | sessions | cmd

  function loadHosts() {
    allHosts = store.getAllHosts();
    applyFilter('');
  }

  function applyFilter(query) {
    const q = query.toLowerCase();
    filteredAliases = Object.keys(allHosts).filter(alias => {
      if (!q) return true;
      const h = allHosts[alias];
      return alias.includes(q)
        || h.hostname.includes(q)
        || (h.user || '').includes(q)
        || (h.group || '').includes(q)
        || (h.tags || []).some(t => t.includes(q));
    });
    renderHostList();
  }

  function renderHostList() {
    const items = filteredAliases.map(alias => {
      const h = allHosts[alias];
      const hasJump = h.jump || (h.jumpChain && h.jumpChain.length > 0);
      const jumpIcon = hasJump ? '{#fbbf24-fg}⇢{/}' : ' ';
      const connIcon = h.lastConnected ? '{#4ade80-fg}●{/}' : '{#4a4a5a-fg}○{/}';
      const name = alias.length > 18 ? alias.slice(0, 17) + '…' : alias.padEnd(18);
      return `${connIcon} ${jumpIcon} {bold}${name}{/}`;
    });
    hostList.setItems(items);
    if (selectedAlias && filteredAliases.includes(selectedAlias)) {
      hostList.select(filteredAliases.indexOf(selectedAlias));
    }
    screen.render();
  }

  function renderDetail(alias) {
    if (!alias) {
      headerText.setContent('{bold}{#7c6af7-fg}Select a host to begin{/}');
      detailBox.setContent('');
      return;
    }
    const h = allHosts[alias];
    if (!h) return;

    headerText.setContent(`{bold}{#7c6af7-fg}${alias}{/}  {#4a4a5a-fg}${h.hostname}{/}`);

    let chain = '';
    try { chain = describeChain(alias); } catch { chain = `${h.user}@${h.hostname}`; }

    const lastConn = h.lastConnected
      ? new Date(h.lastConnected).toLocaleString()
      : 'Never';

    const authType = h.keyPath ? `{#4ade80-fg}Key{/} (${h.keyPath})` : h.password ? '{#fbbf24-fg}Password (stored){/}' : '{#f87171-fg}None configured{/}';

    const lines = [
      `  {#6b6b80-fg}alias    {/} {bold}{#e8e8f0-fg}${alias}{/}`,
      `  {#6b6b80-fg}host     {/} ${h.hostname}:${h.port}`,
      `  {#6b6b80-fg}user     {/} ${h.user}`,
      `  {#6b6b80-fg}group    {/} {#22d3ee-fg}${h.group || 'default'}{/}`,
      `  {#6b6b80-fg}tags     {/} ${(h.tags || []).map(t => `{#a89ff8-fg}#${t}{/}`).join(' ') || '{#4a4a5a-fg}none{/}'}`,
      `  {#6b6b80-fg}auth     {/} ${authType}`,
      `  {#6b6b80-fg}path     {/} {#22d3ee-fg}${chain}{/}`,
      `  {#6b6b80-fg}connects {/} ${h.connectCount || 0}   {#6b6b80-fg}last{/} ${lastConn}`,
    ];

    detailBox.setContent(lines.join('\n'));
    renderTab(alias, currentTab);
    screen.render();
  }

  function renderTab(alias, tab) {
    currentTab = tab;
    const tabs = ['info', 'history', 'sessions'];
    const tabContent = tabs.map(t =>
      t === tab
        ? ` {bold}{#7c6af7-fg}[${t}]{/} `
        : ` {#4a4a5a-fg}${t}{/} `
    ).join('{#2a2a35-fg}│{/}');
    tabBar.setContent(tabContent);

    if (tab === 'info') {
      let sshCmd = '';
      try { sshCmd = buildSSHCommand(alias); } catch (e) { sshCmd = `Error: ${e.message}`; }
      contentBox.setContent([
        `{#6b6b80-fg}── SSH Command ─────────────────────────────────────────{/}`,
        `{#22d3ee-fg}${sshCmd}{/}`,
        '',
        `{#6b6b80-fg}── Quick Connect ────────────────────────────────────────{/}`,
        `  Press {bold}{#7c6af7-fg}Enter{/} or {bold}{#7c6af7-fg}c{/} to open a terminal session`,
        `  Press {bold}{#fbbf24-fg}k{/} to set up key-based auth (copy public key)`,
        `  Press {bold}{#fb923c-fg}e{/} to edit this host`,
      ].join('\n'));
    } else if (tab === 'history') {
      const history = store.getCommandHistory(alias, 100);
      if (history.length === 0) {
        contentBox.setContent('{#4a4a5a-fg}No command history for this host yet.{/}');
      } else {
        const lines = history.map(c => {
          const ts = new Date(c.timestamp).toLocaleString();
          return `{#4a4a5a-fg}${ts}{/}  {#22d3ee-fg}❯{/} {bold}${c.command}{/}`;
        });
        contentBox.setContent(lines.join('\n'));
      }
    } else if (tab === 'sessions') {
      const sessions = store.getSessions(alias, 50);
      if (sessions.length === 0) {
        contentBox.setContent('{#4a4a5a-fg}No sessions recorded for this host yet.{/}');
      } else {
        const lines = sessions.map(s => {
          const start = new Date(s.startedAt).toLocaleString();
          const dur = formatDuration(s.durationSecs);
          return `{#4a4a5a-fg}${start}{/}  {bold}{#4ade80-fg}${dur}{/}`;
        });
        contentBox.setContent(lines.join('\n'));
      }
    }

    screen.render();
  }

  function formatDuration(secs) {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }

  // ─── Connect action ───────────────────────────────────────────────────────
  function connectToHost(alias) {
    if (!alias) return;
    let cmd;
    try {
      cmd = buildSSHCommand(alias);
    } catch (e) {
      setStatus(`{#f87171-fg}Error: ${e.message}{/}`);
      return;
    }

    const host = store.getHost(alias);
    const startTime = Date.now();

    setStatus(`{#4ade80-fg}Connecting to ${alias}…{/}`);
    screen.destroy();

    console.log(chalk.hex(C.accent)(`\n⬡ ssh-manager`) + chalk.hex(C.dim)(` connecting to ${alias}`));
    console.log(chalk.hex(C.cyan)(describeChain(alias)));
    console.log(chalk.hex(C.dim)(cmd) + '\n');

    const proc = spawn('bash', ['-c', cmd], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    proc.on('exit', (code) => {
      const duration = Math.floor((Date.now() - startTime) / 1000);
      store.recordSession(alias, duration);
      console.log(chalk.hex(C.dim)(`\n⬡ session ended (${formatDuration(duration)})\n`));
      // Restart TUI
      setTimeout(() => {
        const { createTUI } = require('./tui');
        createTUI();
      }, 300);
    });
  }

  // ─── Add host wizard ──────────────────────────────────────────────────────
  function showAddHostWizard() {
    const form = blessed.form({
      parent: screen,
      top: 'center', left: 'center',
      width: 64, height: 28,
      border: { type: 'line' },
      style: { border: { fg: C.accent }, bg: C.bgPanel },
      keys: true, vi: true,
      label: ' {bold}{#7c6af7-fg}Add New Host{/} ',
      tags: true,
    });

    const fields = [
      { name: 'alias',    label: 'Alias (e.g. prod-web-01)', y: 2  },
      { name: 'hostname', label: 'Hostname / IP',             y: 5  },
      { name: 'user',     label: 'Username',                  y: 8  },
      { name: 'port',     label: 'Port (default: 22)',        y: 11 },
      { name: 'jump',     label: 'Jump host alias (optional)',y: 14 },
      { name: 'keyPath',  label: 'Key path (optional)',       y: 17 },
      { name: 'group',    label: 'Group (default: default)',  y: 20 },
    ];

    const inputs = {};
    for (const f of fields) {
      blessed.text({
        parent: form, top: f.y, left: 2,
        content: `{#6b6b80-fg}${f.label}{/}`, tags: true,
        style: { bg: C.bgPanel },
      });
      inputs[f.name] = blessed.textbox({
        parent: form, name: f.name,
        top: f.y + 1, left: 2,
        width: 58, height: 3,
        border: { type: 'line' },
        style: {
          bg: C.bgHover, fg: C.text,
          border: { fg: C.dim },
          focus: { border: { fg: C.accent } },
        },
        inputOnFocus: true, keys: true,
      });
      inputs[f.name].key('tab', () => {
        const keys = Object.keys(inputs);
        const idx = keys.indexOf(f.name);
        inputs[keys[(idx + 1) % keys.length]].focus();
      });
    }

    const submitBtn = blessed.button({
      parent: form,
      bottom: 1, right: 12,
      width: 12, height: 3,
      content: ' Add Host ',
      border: { type: 'line' },
      style: {
        bg: C.accent, fg: '#fff', bold: true,
        border: { fg: C.accentB },
        hover: { bg: C.accentB },
        focus: { bg: C.accentB },
      },
      keys: true, mouse: true,
    });

    const cancelBtn = blessed.button({
      parent: form,
      bottom: 1, right: 2,
      width: 10, height: 3,
      content: ' Cancel ',
      border: { type: 'line' },
      style: {
        bg: C.bgHover, fg: C.text,
        border: { fg: C.dim },
        focus: { bg: C.bgHover, border: { fg: C.accent } },
      },
      keys: true, mouse: true,
    });

    function doSubmit() {
      const alias = inputs.alias.getValue().trim();
      const hostname = inputs.hostname.getValue().trim();
      const user = inputs.user.getValue().trim();
      if (!alias || !hostname || !user) {
        setStatus('{#f87171-fg}Alias, hostname and user are required{/}');
        return;
      }
      store.addHost(alias, {
        hostname,
        user,
        port: parseInt(inputs.port.getValue().trim()) || 22,
        jump: inputs.jump.getValue().trim() || null,
        keyPath: inputs.keyPath.getValue().trim() || null,
        group: inputs.group.getValue().trim() || 'default',
      });
      form.destroy();
      loadHosts();
      selectedAlias = alias;
      renderDetail(alias);
      setStatus(`{#4ade80-fg}Host "${alias}" added successfully{/}`);
      hostList.focus();
      screen.render();
    }

    submitBtn.on('press', doSubmit);
    cancelBtn.on('press', () => { form.destroy(); hostList.focus(); screen.render(); });
    form.key(['escape'], () => { form.destroy(); hostList.focus(); screen.render(); });
    form.key(['enter'], doSubmit);

    inputs.alias.focus();
    screen.render();
  }

  // ─── Status helper ────────────────────────────────────────────────────────
  function setStatus(msg) {
    statusLeft.setContent(msg);
    screen.render();
    setTimeout(() => { statusLeft.setContent(''); screen.render(); }, 4000);
  }

  // ─── Keybindings ─────────────────────────────────────────────────────────
  screen.key(['q', 'C-c'], () => process.exit(0));

  screen.key(['a'], () => showAddHostWizard());

  screen.key(['d'], () => {
    if (!selectedAlias) return;
    const alias = selectedAlias;
    store.removeHost(alias);
    selectedAlias = null;
    loadHosts();
    headerText.setContent('{bold}{#7c6af7-fg}Select a host to begin{/}');
    detailBox.setContent('');
    contentBox.setContent('');
    tabBar.setContent('');
    setStatus(`{#fbbf24-fg}Host "${alias}" removed{/}`);
  });

  screen.key(['c', 'enter'], () => {
    if (screen.focused === filterBox) return;
    connectToHost(selectedAlias);
  });

  screen.key(['1'], () => { if (selectedAlias) renderTab(selectedAlias, 'info'); });
  screen.key(['2'], () => { if (selectedAlias) renderTab(selectedAlias, 'history'); });
  screen.key(['3'], () => { if (selectedAlias) renderTab(selectedAlias, 'sessions'); });

  screen.key(['?'], () => {
    showModal('Keyboard Shortcuts', [
      '{bold}{#7c6af7-fg}Navigation{/}',
      '  {#22d3ee-fg}↑ / ↓ / j / k{/}  Move through host list',
      '  {#22d3ee-fg}Enter / c{/}        Connect to selected host',
      '  {#22d3ee-fg}/ (in filter){/}    Type to filter hosts',
      '',
      '{bold}{#7c6af7-fg}Actions{/}',
      '  {#22d3ee-fg}a{/}  Add new host',
      '  {#22d3ee-fg}d{/}  Delete selected host',
      '  {#22d3ee-fg}e{/}  Edit selected host',
      '',
      '{bold}{#7c6af7-fg}Tabs{/}',
      '  {#22d3ee-fg}1{/}  Host info & SSH command',
      '  {#22d3ee-fg}2{/}  Command history',
      '  {#22d3ee-fg}3{/}  Session history',
      '',
      '{bold}{#7c6af7-fg}Other{/}',
      '  {#22d3ee-fg}?{/}  This help',
      '  {#22d3ee-fg}q{/}  Quit',
    ].join('\n'));
  });

  // Filter box
  screen.key(['/'], () => {
    filterBox.clearValue();
    filterBox.focus();
  });

  filterBox.on('keypress', (ch, key) => {
    setTimeout(() => applyFilter(filterBox.getValue()), 50);
  });

  filterBox.key(['escape', 'enter'], () => {
    hostList.focus();
    applyFilter(filterBox.getValue());
  });

  // Host list selection
  hostList.on('select item', (item, idx) => {
    selectedAlias = filteredAliases[idx];
    renderDetail(selectedAlias);
  });

  hostList.on('select', (item, idx) => {
    selectedAlias = filteredAliases[idx];
    connectToHost(selectedAlias);
  });

  // ─── Boot ─────────────────────────────────────────────────────────────────
  loadHosts();

  // Show welcome if no hosts
  if (filteredAliases.length === 0) {
    headerText.setContent('{bold}{#7c6af7-fg}No hosts yet{/}');
    detailBox.setContent([
      '',
      '  {#6b6b80-fg}Get started:{/}',
      '  Press {bold}{#7c6af7-fg}a{/} to add your first SSH host',
      '',
      '  {#6b6b80-fg}Or from the command line:{/}',
      '  {#22d3ee-fg}ssh-manager add prod-web-01 --host 10.0.1.5 --user ubuntu{/}',
      '  {#22d3ee-fg}ssh-manager add jump-01 --host 203.0.113.5 --user admin{/}',
      '  {#22d3ee-fg}ssh-manager add db-01 --host 10.0.1.10 --user postgres --jump jump-01{/}',
    ].join('\n'));
    statusLeft.setContent('{#7c6af7-fg}Press {bold}a{/bold} to add a host  •  {bold}?{/bold} for help{/}');
  }

  hostList.focus();
  screen.render();

  return screen;
}

module.exports = { createTUI };
