'use strict';
// WinTV launcher, main process. On the TV this exe *is* the shell of the
// `tv` account (HKCU\...\Winlogon\Shell), so it must never quit on its own,
// must survive its own crashes, and is the only way to start anything.

const { app, BrowserWindow, ipcMain, globalShortcut, shell, session, powerMonitor } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const IS_WIN = process.platform === 'win32';
// Admin-owned config (C:\ProgramData\WinTV, read-only for the tv user).
const SYSTEM_DIR = IS_WIN
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'WinTV')
  : path.join(os.homedir(), '.wintv');

let win = null;
let quitting = false;
let config = null;
let profile = null;        // active WinTV profile (the TV's own sign-in, not a Windows account)
const running = new Map(); // app id -> ChildProcess

// ---------------------------------------------------------------- logging
function logFile() {
  return path.join(app.getPath('userData'), 'launcher.log');
}
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  try { fs.appendFileSync(logFile(), line); } catch { /* log dir not ready */ }
  if (!app.isPackaged) process.stdout.write(line);
}

// ---------------------------------------------------------------- config
// %VAR% expands from the environment; ${PROFILES} is this user's per-app
// browser profile folder, so every streaming app keeps its own login.
function expand(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m)
    .replace(/\$\{PROFILES\}/g, path.join(app.getPath('userData'), 'profiles'));
}

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps.default.json'), 'utf8'));
  // Site file: any top-level key replaces the shipped one; addApps/removeApps
  // edit the shipped list so a household only writes down what differs.
  const sitePath = path.join(SYSTEM_DIR, 'apps.json');
  try {
    const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));
    const { addApps = [], removeApps = [], ...replace } = site;
    Object.assign(cfg, replace);
    cfg.apps = cfg.apps.filter((a) => !removeApps.includes(a.id));
    for (const { after, ...extra } of addApps) {
      const at = cfg.apps.findIndex((a) => a.id === after);
      cfg.apps.splice(at < 0 ? cfg.apps.length : at + 1, 0, extra);
    }
    log('config:', sitePath);
  } catch (e) {
    if (e.code !== 'ENOENT') log('config: ignoring broken', sitePath, e.message);
  }
  const browser = (cfg.browserCandidates || []).map(expand).find((p) => fs.existsSync(p)) || null;
  const items = (list, row) => (list || []).map((a) => {
    const needs = a.requires ? expand(a.requires) : null;
    const usesBrowser = a.kind === 'web' || a.kind === 'browser';
    let available = true;
    let reason = '';
    if (needs && !fs.existsSync(needs)) { available = false; reason = `${a.name} is not installed`; }
    if (usesBrowser && !browser) { available = false; reason = 'No browser installed'; }
    return { ...a, row, available, reason };
  }).filter((a) => a.available || !a.hideWhenMissing);
  const profiles = (cfg.profiles && cfg.profiles.length ? cfg.profiles : [{ id: 'home', name: 'Home' }])
    .filter((p) => /^[a-z0-9-]+$/.test(p.id));
  return {
    browser,
    profiles,
    homeKeys: cfg.homeKeys || [],
    apps: items(cfg.apps, 0),
    system: items(cfg.system, 1),
  };
}

function findItem(id) {
  return [...config.apps, ...config.system].find((a) => a.id === id);
}

// ---------------------------------------------------------------- launching
function publicState() {
  const strip = ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row }) =>
    ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row });
  return {
    apps: config.apps.map(strip),
    system: config.system.map(strip),
    running: [...running.keys()],
    profiles: config.profiles.map(({ id, name, colors, guest }) => ({ id, name, colors, guest: !!guest })),
    profile: profile?.id ?? null,
    browser: config.browser ? path.basename(config.browser, '.exe') : null,
    user: os.userInfo().username,
    version: app.getVersion(),
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', { running: [...running.keys()] });
}

function browserArgs(item) {
  const who = profile || config.profiles[0];
  const dir = path.join(expand('${PROFILES}'), who.id, item.id);
  const args = [
    `--user-data-dir=${dir}`,
    '--start-fullscreen',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (who.guest) args.push('--incognito'); // guests leave nothing behind
  if (item.userAgent) args.push(`--user-agent=${item.userAgent}`);
  if (item.kind === 'web') args.push(`--app=${item.url}`);
  else if (item.url) args.push(item.url);
  return args;
}

function quiet(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout }));
  });
}

// A launched app that is still running gets raised instead of started twice.
async function raise(child) {
  if (!IS_WIN) return;
  await quiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(New-Object -ComObject WScript.Shell).AppActivate(${child.pid}) | Out-Null`]);
}

async function launch(id) {
  const item = findItem(id);
  if (!item) return { ok: false, error: 'Unknown app' };
  if (!item.available) return { ok: false, error: item.reason };
  log('launch', id);

  const alive = running.get(id);
  if (alive && alive.exitCode === null) { await raise(alive); return { ok: true, raised: true }; }

  if (item.kind === 'uri') {
    try { await shell.openExternal(item.uri); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  let file;
  let args;
  if (item.kind === 'web' || item.kind === 'browser') { file = config.browser; args = browserArgs(item); }
  else if (item.kind === 'exe') { file = expand(item.path); args = (item.args || []).map(expand); }
  else return { ok: false, error: `Cannot launch kind ${item.kind}` };

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore' });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    child.once('error', (e) => { log('launch error', id, e.message); running.delete(id); pushState(); resolve({ ok: false, error: e.message }); });
    child.once('spawn', () => { running.set(id, child); pushState(); resolve({ ok: true }); });
    child.once('exit', (code) => {
      log('exit', id, String(code));
      if (running.get(id) === child) running.delete(id);
      pushState();
      goHome('app-exit');
    });
    child.unref();
  });
}

async function quitApp(id) {
  const child = running.get(id);
  if (!child) return { ok: true };
  log('quit', id);
  if (IS_WIN) await quiet('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill();
  return { ok: true };
}

// Changing who is watching closes everything the previous person had open.
async function setProfile(id) {
  const next = config.profiles.find((p) => p.id === id);
  if (!next) return { ok: false, error: 'Unknown profile' };
  if (profile && profile.id !== next.id) {
    for (const appId of [...running.keys()]) await quitApp(appId);
  }
  profile = next;
  log('profile', next.id);
  return { ok: true };
}

const POWER = {
  sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
  restart: ['shutdown.exe', ['/r', '/t', '0']],
  shutdown: ['shutdown.exe', ['/s', '/t', '0']],
  'switch-user': ['rundll32.exe', ['user32.dll,LockWorkStation']],
};

async function power(action) {
  const cmd = POWER[action];
  if (!cmd) return { ok: false, error: 'Unknown action' };
  log('power', action);
  if (!IS_WIN) return { ok: true, dryRun: true };
  const { err } = await quiet(cmd[0], cmd[1]);
  return err ? { ok: false, error: err.message } : { ok: true };
}

// ---------------------------------------------------------------- window
function goHome(reason) {
  if (!win || win.isDestroyed()) return;
  log('home', reason);
  if (win.isMinimized()) win.restore();
  win.show();
  // Briefly topmost so Windows lets the launcher take the foreground back.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.webContents.focus();
  setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 400);
  win.webContents.send('home');
}

function createWindow() {
  win = new BrowserWindow({
    fullscreen: !process.env.WINTV_WINDOWED,
    width: 1600,
    height: 900,
    frame: false,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!quitting) e.preventDefault(); }); // Alt+F4 must not kill the shell
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone:', d.reason);
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 500);
  });
}

function registerHomeKeys() {
  for (const acc of config.homeKeys) {
    try {
      log(`home key ${acc}:`, globalShortcut.register(acc, () => goHome(acc)) ? 'registered' : 'taken');
    } catch (e) {
      log(`home key ${acc}: invalid (${e.message})`);
    }
  }
}

// ---------------------------------------------------------------- startup
process.on('uncaughtException', (e) => {
  log('fatal:', e.stack || String(e));
  app.relaunch();
  app.exit(1);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => goHome('second-instance'));
  app.whenReady().then(() => {
    config = loadConfig();
    log(`start v${app.getVersion()} user=${os.userInfo().username} browser=${config.browser || 'none'}`);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ipcMain.handle('wintv:state', () => publicState());
    ipcMain.handle('wintv:launch', (_e, id) => launch(String(id)));
    ipcMain.handle('wintv:quit', (_e, id) => quitApp(String(id)));
    ipcMain.handle('wintv:power', (_e, action) => power(String(action)));
    ipcMain.handle('wintv:profile', (_e, id) => setProfile(String(id)));
    if (config.profiles.length === 1) profile = config.profiles[0];
    // Waking the TV asks who is watching again, like a streaming box does.
    powerMonitor.on('resume', () => {
      if (config.profiles.length < 2) return;
      goHome('resume');
      win.webContents.send('picker');
    });
    createWindow();
    registerHomeKeys();
  });
  app.on('window-all-closed', () => { if (!quitting) createWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
