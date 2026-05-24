/**
 * ssh-manager: Encrypted persistent store
 * Hosts, jump chains, command history — all AES-encrypted at rest.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');

const CONFIG_DIR = path.join(os.homedir(), '.ssh-manager');
const STORE_FILE = path.join(CONFIG_DIR, 'store.enc');
const KEY_FILE = path.join(CONFIG_DIR, '.key');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
  }
}

function getMasterKey() {
  ensureDir();
  if (!fs.existsSync(KEY_FILE)) {
    // Derive a machine-unique key from hostname + user
    const seed = `${os.hostname()}-${os.userInfo().username}-ssh-manager-v1`;
    const key = CryptoJS.SHA256(seed).toString();
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    return key;
  }
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}

function loadStore() {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) {
    return defaultStore();
  }
  try {
    const encrypted = fs.readFileSync(STORE_FILE, 'utf8');
    const key = getMasterKey();
    const bytes = CryptoJS.AES.decrypt(encrypted, key);
    const json = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(json);
  } catch (e) {
    return defaultStore();
  }
}

function saveStore(data) {
  ensureDir();
  const key = getMasterKey();
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
  fs.writeFileSync(STORE_FILE, encrypted, { mode: 0o600 });
}

function defaultStore() {
  return {
    version: 1,
    hosts: {},       // alias -> HostEntry
    groups: {},      // group name -> [alias]
    sessions: [],    // SessionRecord[]
    commandHistory: [], // CommandRecord[]
  };
}

// ─── Host CRUD ───────────────────────────────────────────────────────────────

function addHost(alias, entry) {
  const store = loadStore();
  store.hosts[alias] = {
    id: uuidv4(),
    alias,
    hostname: entry.hostname,
    user: entry.user,
    port: entry.port || 22,
    jump: entry.jump || null,         // alias of jump host (or null)
    jumpChain: entry.jumpChain || [], // ordered list of jump aliases
    keyPath: entry.keyPath || null,   // path to private key
    password: entry.password          // stored encrypted already by caller
      ? CryptoJS.AES.encrypt(entry.password, getMasterKey()).toString()
      : null,
    tags: entry.tags || [],
    group: entry.group || 'default',
    lastConnected: null,
    connectCount: 0,
    createdAt: new Date().toISOString(),
  };
  if (!store.groups[entry.group || 'default']) {
    store.groups[entry.group || 'default'] = [];
  }
  if (!store.groups[entry.group || 'default'].includes(alias)) {
    store.groups[entry.group || 'default'].push(alias);
  }
  saveStore(store);
  return store.hosts[alias];
}

function getHost(alias) {
  const store = loadStore();
  return store.hosts[alias] || null;
}

function getAllHosts() {
  const store = loadStore();
  return store.hosts;
}

function removeHost(alias) {
  const store = loadStore();
  const host = store.hosts[alias];
  if (!host) return false;
  delete store.hosts[alias];
  for (const grp of Object.values(store.groups)) {
    const idx = grp.indexOf(alias);
    if (idx !== -1) grp.splice(idx, 1);
  }
  saveStore(store);
  return true;
}

function updateHost(alias, patch) {
  const store = loadStore();
  if (!store.hosts[alias]) return null;
  Object.assign(store.hosts[alias], patch);
  saveStore(store);
  return store.hosts[alias];
}

function getPassword(alias) {
  const store = loadStore();
  const host = store.hosts[alias];
  if (!host || !host.password) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(host.password, getMasterKey());
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}

// ─── Session tracking ────────────────────────────────────────────────────────

function recordSession(alias, durationSecs) {
  const store = loadStore();
  store.sessions.push({
    id: uuidv4(),
    alias,
    startedAt: new Date(Date.now() - durationSecs * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    durationSecs,
  });
  if (store.hosts[alias]) {
    store.hosts[alias].lastConnected = new Date().toISOString();
    store.hosts[alias].connectCount = (store.hosts[alias].connectCount || 0) + 1;
  }
  // Keep last 1000
  if (store.sessions.length > 1000) store.sessions = store.sessions.slice(-1000);
  saveStore(store);
}

function recordCommand(alias, command, output) {
  const store = loadStore();
  store.commandHistory.push({
    id: uuidv4(),
    alias,
    command,
    output: output ? output.slice(0, 2000) : null,
    timestamp: new Date().toISOString(),
  });
  if (store.commandHistory.length > 5000) {
    store.commandHistory = store.commandHistory.slice(-5000);
  }
  saveStore(store);
}

function getCommandHistory(alias, limit = 50) {
  const store = loadStore();
  const history = alias
    ? store.commandHistory.filter(c => c.alias === alias)
    : store.commandHistory;
  return history.slice(-limit).reverse();
}

function getSessions(alias, limit = 20) {
  const store = loadStore();
  const sessions = alias
    ? store.sessions.filter(s => s.alias === alias)
    : store.sessions;
  return sessions.slice(-limit).reverse();
}

function getGroups() {
  const store = loadStore();
  return store.groups;
}

module.exports = {
  addHost, getHost, getAllHosts, removeHost, updateHost, getPassword,
  recordSession, recordCommand, getCommandHistory, getSessions, getGroups,
  CONFIG_DIR,
};
