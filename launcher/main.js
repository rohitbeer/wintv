'use strict';
// WinTV launcher, main process. On the TV this exe *is* the shell of the
// `tv` account (HKCU\...\Winlogon\Shell), so it must never quit on its own,
// must survive its own crashes, and is the only way to start anything.

const { app, BrowserWindow, ipcMain, globalShortcut, shell, session, powerMonitor, protocol } = require('electron');
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
  const items = (list, row) => (list || []).map((a) => ({ ...a, row }));
  const profiles = (cfg.profiles && cfg.profiles.length ? cfg.profiles : [{ id: 'home', name: 'Home' }])
    .filter((p) => /^[a-z0-9-]+$/.test(p.id));
  return {
    browser,
    profiles,
    homeKeys: cfg.homeKeys || [],
    lockScreen: { afterMinutes: 5, askWhoAfterMinutes: 30, ...(cfg.lockScreen || {}) },
    apps: items(cfg.apps, 0),
    system: items(cfg.system, 1),
  };
}

function resolve(a) {
  const needs = a.requires ? expand(a.requires) : null;
  let available = true;
  let reason = '';
  if (needs && !fs.existsSync(needs)) { available = false; reason = `${a.name} is not installed`; }
  if ((a.kind === 'web' || a.kind === 'browser') && !config.browser) { available = false; reason = 'No browser installed'; }
  return { ...a, available, reason };
}

function visible(list) {
  return list.map(resolve).filter((a) => a.available || !a.hideWhenMissing);
}

function findItem(id) {
  const a = [...config.apps, ...config.system].find((x) => x.id === id);
  return a ? resolve(a) : null;
}

// ---------------------------------------------------------------- launching
function publicState() {
  const strip = ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row }) =>
    ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row });
  return {
    apps: visible(config.apps).map(strip),
    system: visible(config.system).map(strip),
    running: [...running.keys()],
    profiles: config.profiles.map(({ id, name, colors, guest }) => ({ id, name, colors, guest: !!guest })),
    profile: profile?.id ?? null,
    browser: config.browser ? path.basename(config.browser, '.exe') : null,
    user: os.userInfo().username,
    version: app.getVersion(),
    lockScreen: config.lockScreen,
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', { running: [...running.keys()] });
}

function profileDir(item) {
  const who = profile || config.profiles[0];
  return path.join(expand('${PROFILES}'), who.id, item.id);
}

// Brave ships with Widevine, the DRM that Netflix, Prime Video and Disney+
// need, switched off until the user accepts a prompt, which is awkward with a
// remote. Tiles marked "drm" accept in advance: they set Brave's own switch,
// brave.widevine_opted_in in the profile's Local State, before Brave starts.
// Other tiles (YouTube, the browser) keep Brave's default.
function optInWidevine(dir) {
  if (path.basename(config.browser || '').toLowerCase() !== 'brave.exe') return;
  const file = path.join(dir, 'Local State');
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') { log('widevine: cannot read', file, e.message); return; }
  }
  if (state.brave?.widevine_opted_in === true) return;
  state.brave = { ...(state.brave || {}), widevine_opted_in: true };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
  log('widevine: opted in for', dir);
}

function browserArgs(item) {
  const who = profile || config.profiles[0];
  const dir = profileDir(item);
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

// ---------------------------------------------------------------- system helper
// The WinTV Settings screens change Windows through one long-lived PowerShell
// process, system.ps1, running as this (standard) user. Starting PowerShell
// costs about a second, so it starts once. Only the ops below exist, and
// their arguments are checked here before they reach Windows.
let helper = null;
let helperSeq = 0;
const helperWaiting = new Map(); // request id -> resolve

function int(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('bad argument');
  return n;
}

const SYSTEM_OPS = {
  'display.get': () => ({}),
  'display.set': (a) => ({ width: int(a.width, 640, 15360), height: int(a.height, 480, 8640), hz: int(a.hz, 20, 1000) }),
  'audio.get': () => ({}),
  'audio.set': (a) => (a.volume !== undefined ? { volume: int(a.volume, 0, 100) } : { muted: a.muted === true }),
  'network.get': () => ({}),
  about: () => ({}),
};

function stopHelper(reason) {
  if (!helper) return;
  log('helper stopped:', reason);
  helper.kill();
  helper = null;
}

function startHelper() {
  const script = fs.readFileSync(path.join(__dirname, 'system.ps1'), 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        helperWaiting.get(msg.id)?.(msg);
        helperWaiting.delete(msg.id);
      } catch { log('helper: bad line', line.slice(0, 200)); }
    }
  });
  child.stderr.on('data', (d) => log('helper:', String(d).trim().slice(0, 500)));
  child.once('exit', (code) => {
    log('helper exited', String(code));
    if (helper === child) helper = null;
    for (const done of helperWaiting.values()) done({ ok: false, error: 'helper exited' });
    helperWaiting.clear();
  });
  return child;
}

async function system(op, args) {
  const check = SYSTEM_OPS[op];
  if (!check) return { ok: false, error: 'Unknown setting' };
  let clean;
  try { clean = check(args || {}); } catch (e) { return { ok: false, error: e.message }; }
  if (!IS_WIN) return { ok: false, error: 'Settings need Windows' };
  helper ||= startHelper();
  const id = ++helperSeq;
  return new Promise((done) => {
    const timer = setTimeout(() => {
      helperWaiting.delete(id);
      stopHelper(`${op} timed out`); // a stuck helper would block every later request
      done({ ok: false, error: 'Windows did not answer' });
    }, 20000);
    helperWaiting.set(id, (msg) => { clearTimeout(timer); done(msg); });
    helper.stdin.write(JSON.stringify({ id, op, ...clean }) + '\n');
  });
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
  if (item.kind === 'web' || item.kind === 'browser') {
    file = config.browser;
    args = browserArgs(item);
    if (item.drm) {
      try { optInWidevine(profileDir(item)); } catch (e) { log('widevine:', e.message); }
    }
  }
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

// ---------------------------------------------------------------- ui files
// The screens are served from the app's own ui/ folder under wintv://ui/,
// not file://. The exe's GrantFileProtocolExtraPrivileges fuse is off (a
// file:// page could otherwise read other local files), and with it off the
// packaged app cannot load its page from file:// at all (ERR_FILE_NOT_FOUND,
// a black screen on the first VM run). This handler serves only files
// inside ui/.
const UI_DIR = path.join(__dirname, 'ui');
const UI_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
protocol.registerSchemesAsPrivileged([{ scheme: 'wintv', privileges: { standard: true, secure: true } }]);

function serveUi() {
  protocol.handle('wintv', (req) => {
    const url = new URL(req.url);
    const file = path.normalize(path.join(UI_DIR, decodeURIComponent(url.pathname)));
    if (url.host !== 'ui' || !file.startsWith(UI_DIR + path.sep)) return new Response('', { status: 404 });
    try {
      return new Response(fs.readFileSync(file), { headers: { 'content-type': UI_TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
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
  win.loadURL('wintv://ui/index.html');
  win.once('ready-to-show', () => {
    log('window ready');
    win.show();
    // Start the Settings helper in the background: PowerShell takes a second
    // or two to start, which would otherwise delay the first Settings page.
    setTimeout(() => { if (IS_WIN && !helper) helper = startHelper(); }, 3000);
  });
  win.on('close', (e) => { if (!quitting) e.preventDefault(); }); // Alt+F4 must not kill the shell
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // The log is the only window into a TV with no desktop: record whether the
  // page loaded and any error it printed.
  win.webContents.on('did-finish-load', () => log('ui loaded'));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('ui failed to load:', String(code), desc));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log('ui', e.level, e.message, `${e.sourceId}:${e.lineNumber}`);
  });
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

// ---------------------------------------------------------------- supervisor
// Windows starts the shell once and never again: on the VM, killing the
// launcher left a black screen until the next restart. So the shell is
// `WinTV.exe --supervise`, a small parent with no window whose only job is
// to start the real launcher (`--child`) and start it again whenever it
// exits. If the launcher keeps crashing, it waits longer between starts.
const SUPERVISE = process.argv.includes('--supervise');
const CHILD = process.argv.includes('--child');
const EXIT_ALREADY_RUNNING = 3;

function supervise() {
  app.disableHardwareAcceleration();
  let recent = [];
  const start = (delay) => setTimeout(() => {
    const passOn = process.argv.slice(1).filter((a) => a !== '--supervise');
    const child = spawn(process.execPath, [...passOn, '--child'], { stdio: 'ignore' });
    child.once('error', (e) => { log('supervisor: cannot start launcher:', e.message); start(10000); });
    child.once('exit', (code) => {
      log('supervisor: launcher exited', String(code));
      const now = Date.now();
      recent = recent.filter((t) => now - t < 60000).concat(now);
      if (code === EXIT_ALREADY_RUNNING) start(30000);
      else start(recent.length > 5 ? 10000 : 300);
    });
  }, delay);
  app.whenReady().then(() => { log('supervisor: start'); start(0); });
}

// ---------------------------------------------------------------- startup
process.on('uncaughtException', (e) => {
  log('fatal:', e.stack || String(e));
  if (!CHILD) app.relaunch(); // under the supervisor, exiting is enough
  app.exit(1);
});

if (SUPERVISE) {
  supervise();
} else if (!app.requestSingleInstanceLock()) {
  app.exit(CHILD ? EXIT_ALREADY_RUNNING : 0);
} else {
  app.on('second-instance', () => goHome('second-instance'));
  app.whenReady().then(() => {
    config = loadConfig();
    log(`start v${app.getVersion()} user=${os.userInfo().username} browser=${config.browser || 'none'}`);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    serveUi();
    ipcMain.handle('wintv:state', () => publicState());
    ipcMain.handle('wintv:launch', (_e, id) => launch(String(id)));
    ipcMain.handle('wintv:quit', (_e, id) => quitApp(String(id)));
    ipcMain.handle('wintv:power', (_e, action) => power(String(action)));
    ipcMain.handle('wintv:profile', (_e, id) => setProfile(String(id)));
    ipcMain.handle('wintv:system', (_e, op, args) => system(String(op), args && typeof args === 'object' ? args : {}));
    if (config.profiles.length === 1) profile = config.profiles[0];
    // Waking the TV shows the lock screen; the next button asks who is watching.
    powerMonitor.on('resume', () => {
      goHome('resume');
      win.webContents.send('lock');
    });
    app.on('child-process-gone', (_e, d) => log('process gone:', d.type, d.reason, String(d.exitCode)));
    app.getGPUInfo('basic')
      .then((g) => log('gpu:', (g.gpuDevice || []).map((d) => `${d.vendorId}:${d.deviceId}${d.active ? '*' : ''}`).join(' ') || 'none'))
      .catch((e) => log('gpu:', e.message));
    createWindow();
    registerHomeKeys();
  });
  app.on('window-all-closed', () => { if (!quitting) createWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHelper('quit'); });
}
