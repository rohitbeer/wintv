'use strict';
// WinTV shell, main process. On the TV this exe *is* the shell of the `tv`
// account (HKCU\...\Winlogon\Shell), in place of Explorer: everything the
// person on the couch sees is drawn by it (D-22). Two windows:
//   home   the full-screen home screen, Settings, "Who's watching?", the clock screen
//   layer  the system layer, always on top of every app and never focused:
//          quick settings, the keyboard, volume, the sleep-timer warning
// It must never quit on its own, must survive its own crashes, and is the
// only way to start anything.

const { app, BrowserWindow, ipcMain, globalShortcut, shell, session, powerMonitor, protocol, screen, systemPreferences, nativeImage } = require('electron');

// First thing: an error while starting must end this process (the
// supervisor then restarts it or rolls back), not leave Electron's
// "A JavaScript error occurred" dialog on the TV. The full handler, which
// also logs, replaces this one further down.
process.on('uncaughtException', (e) => { try { process.stderr.write(String(e && e.stack || e)); } catch { /* nothing to write to */ } app.exit(1); });
const { spawn, execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const art = require('./art');
const filesLib = require('./files');

const IS_WIN = process.platform === 'win32';
// Admin-owned config (C:\ProgramData\WinTV, read-only for the tv user).
const SYSTEM_DIR = IS_WIN
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'WinTV')
  : path.join(os.homedir(), '.wintv');
// Installed versions (admin-owned): versions\<x.y.z>\ and current.json, which
// names the one to run. Updates add a folder and rewrite current.json (D-28).
const INSTALL_DIR = IS_WIN
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinTV')
  : path.join(os.homedir(), '.wintv', 'install');

// Pictures and logos the TV downloaded (art.js), per account.
const CACHE_DIR = IS_WIN
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'WinTV', 'cache')
  : path.join(os.homedir(), '.wintv', 'cache');

let win = null;
let quitting = false;
let config = null;
let profile = null;        // active WinTV profile (the TV's own sign-in, not a Windows account)
const running = new Map(); // app id -> { pid, dir, full } (dir: the app's browser profile; full: in full screen)
let frontApp = null;       // the app last opened or switched to, while one is in front of the home screen
let pointerMode = false;   // a mouse or air mouse is in use: the browser opens with its tabs (D-36)

// ---------------------------------------------------------------- logging
function logFile() {
  return path.join(app.getPath('userData'), 'shell.log');
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
    quickKeys: cfg.quickKeys || [],
    lockScreen: { afterMinutes: 5, askWhoAfterMinutes: 30, ...(cfg.lockScreen || {}) },
    keyboard: { autoOpen: true, layout: 'auto', ...(cfg.keyboard || {}) },
    weather: isPlace(cfg.weather) ? cfg.weather : null,
    wallpapers: (Array.isArray(cfg.wallpapers) ? cfg.wallpapers : [])
      .filter((v) => typeof v?.file === 'string' && typeof v?.title === 'string')
      .map(({ file, title }) => ({ file, title: title.slice(0, 80) })),
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
  const a = [...config.apps, ...pinnedItems(), ...config.system].find((x) => x.id === id);
  return a ? resolve(a) : null;
}

// ---------------------------------------------------------------- All apps (D-37)
// Every app Windows lists for this account (system.ps1 apps.list). Only apps
// from the last list, or pinned ones, may be opened. Pinned apps are tiles
// on the home row, per profile.
let knownApps = new Map(); // AppID -> { name, icon }
const appKey = (appId) => crypto.createHash('sha1').update(appId).digest('hex').slice(0, 16);
const iconUrl = (appId) => `wintv://ui/cache/icons/${appKey(appId)}.png`;

async function listApps() {
  const r = await system('apps.list', {}, 90000); // the first time draws every icon
  if (!r.ok) return r;
  knownApps = new Map(r.result.apps.map((a) => [a.id, a]));
  return { ok: true, result: r.result.apps.map((a) => ({ ...a, icon: a.icon ? iconUrl(a.id) : null })) };
}

function pinsOf(profileId) {
  return prefs.pins?.[profileId] || [];
}

function pinnedItems() {
  const who = profile || config.profiles[0];
  return pinsOf(who?.id).map((p) => ({
    id: `pin-${appKey(p.id)}`, name: p.name, kind: 'start', appid: p.id, glyph: 'apps', logo: p.id,
    eyebrow: 'Pinned', tagline: 'Pinned from All apps. Hold OK to unpin.', colors: ['#2e2e36', '#121216'],
  }));
}

// ---------------------------------------------------------------- launching
// A tile's logo, once art.js has it: wintv://ui/cache/logos/<file>.
function logoUrl(name) {
  const file = art.logo(name);
  return file ? `wintv://ui/cache/logos/${file}` : null;
}

function artState() {
  return {
    videos: art.videos(config.wallpapers).map(({ file, title, artist, license }) =>
      ({ url: `wintv://ui/cache/videos/${file}`, title, artist, license })),
  };
}

function publicState() {
  const strip = ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row, logo, logoStyle, logoWhite }) =>
    ({ id, name, kind, tagline, eyebrow, colors, glyph, available, reason, row,
      logo: logoUrl(logo), logoStyle: logoStyle === 'wordmark' ? 'wordmark' : 'icon', logoWhite: logoWhite === true });
  return {
    apps: [...visible(config.apps).map(strip), ...pinnedItems().map((p) => ({ ...strip(resolve(p)), logo: iconUrl(p.appid) }))],
    system: visible(config.system).map(strip),
    running: [...running.keys()],
    profiles: profileList(),
    profileColours: PROFILE_COLOURS,
    profile: profile?.id ?? null,
    browser: config.browser ? path.basename(config.browser, '.exe') : null,
    user: os.userInfo().username,
    version: app.getVersion(),
    prefs,
    art: artState(),
  };
}

// Logos, then the live wallpapers: at start, then four times a day. Each new
// one reaches the home screen with the state.
let artBusy = false;
async function refreshArt() {
  if (artBusy) return; // a first download of the videos can take a while
  artBusy = true;
  const redraw = () => { if (win && !win.isDestroyed()) win.webContents.send('state', publicState()); };
  try { if (await art.refreshLogos([...config.apps, ...config.system].map((a) => a.logo).filter(Boolean))) redraw(); } catch (e) { log('art:', e.message); }
  try { await art.refreshVideos(config.wallpapers, redraw); } catch (e) { log('art:', e.message); }
  artBusy = false;
  // Interrupted (offline, or Wikimedia asked to slow down): try again soon.
  if (art.videosMissing(config.wallpapers)) setTimeout(refreshArt, 15 * 60000);
}

const fahrenheit = () => ['US', 'LR', 'MM'].includes(app.getLocaleCountryCode?.() || '');

async function weatherNow() {
  const place = prefs.weatherPlace;
  if (!place) return { ok: true, result: null };
  try { return { ok: true, result: { ...(await art.weather(place, fahrenheit())), unit: fahrenheit() ? '°F' : '°C' } }; } catch (e) { return { ok: false, error: e.message }; }
}

async function findPlaces(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60) return { ok: false, error: 'bad argument' };
  try { return { ok: true, result: await art.findPlaces(name.trim()) }; } catch (e) { return { ok: false, error: e.message }; }
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
  // Apps fill the screen. The browser too, except for someone using a mouse,
  // who gets Brave's tabs and toolbar to click (D-36).
  const full = item.kind === 'web' || !pointerMode;
  const args = [
    `--user-data-dir=${dir}`,
    full ? '--start-fullscreen' : '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
  ];
  // A quit app is closed hard (taskkill), and Brave would greet the next
  // start with "Restore pages?". A TV just opens the app again.
  args.push('--hide-crash-restore-bubble');
  // Show the page's text fields to UI Automation, so the keyboard comes up
  // when one gets the focus. Brave only does this for screen readers by
  // default; "basic" is the light level (no screen-reader extras).
  if (config.keyboard.autoOpen) args.push('--force-renderer-accessibility=basic');
  if (who.guest) args.push('--incognito'); // guests leave nothing behind
  if (item.userAgent) args.push(`--user-agent=${item.userAgent}`);
  if (item.kind === 'web') args.push(`--app=${item.url}`);
  else if (item.url) args.push(item.url);
  return args;
}

// ---------------------------------------------------------------- PowerShell helpers
// The shell reaches into Windows through two long-lived PowerShell processes
// running as this (standard) user: system.ps1 (settings) and input.ps1 (the
// remote's keys). The scripts live inside app.asar, where PowerShell can't
// read them, so each is sent as the first line of its stdin to a two-line
// loader; JSON lines follow both ways. (Passing the script on the command
// line, as before, hits Windows' 32,767-character limit.)
const PS_LOADER = '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); '
  + 'Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())))';

function startPs(name, onMessage, onExit) {
  const script = fs.readFileSync(path.join(__dirname, name), 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(PS_LOADER, 'utf16le').toString('base64')],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdin.write(Buffer.from(script, 'utf8').toString('base64') + '\n');
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { log(`${name}: bad line`, line.slice(0, 200)); continue; }
      onMessage(msg);
    }
  });
  child.stderr.on('data', (d) => log(`${name}:`, String(d).trim().slice(0, 500)));
  child.once('error', (e) => log(`${name}: cannot start:`, e.message));
  child.once('exit', (code) => { log(`${name} exited`, String(code)); onExit(child); });
  return child;
}

// ---------------------------------------------------------------- system helper
// The Settings screens and the system layer change Windows through
// system.ps1. Only the ops below exist, and their arguments are checked here
// before they reach Windows.
let helper = null;
let helperSeq = 0;
const helperWaiting = new Map(); // request id -> resolve

function int(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('bad argument');
  return n;
}

function oneOf(v, list) {
  if (!list.includes(v)) throw new Error('bad argument');
  return v;
}

// Windows' own power timeouts while plugged in, in minutes (0 = never), as
// Settings > Screen Saver offers them (D-31).
const SCREEN_OFF_STEPS = [5, 10, 15, 30, 60, 120, 0];
const IDLE_SLEEP_STEPS = [15, 30, 60, 120, 240, 0];

const SYSTEM_OPS = {
  'display.get': () => ({}),
  'display.set': (a) => ({ width: int(a.width, 640, 15360), height: int(a.height, 480, 8640), hz: int(a.hz, 20, 1000) }),
  'audio.get': () => ({}),
  'audio.set': (a) => {
    if (a.output !== undefined) {
      // A render endpoint's id, as Windows writes it (D-43).
      if (typeof a.output !== 'string' || !/^\{0\.0\.0\.00000000\}\.\{[0-9a-fA-F-]{36}\}$/.test(a.output)) throw new Error('bad argument');
      return { output: a.output };
    }
    return a.volume !== undefined ? { volume: int(a.volume, 0, 100) } : { muted: a.muted === true };
  },
  'audio.key': (a) => { if (!['up', 'down', 'mute'].includes(a.key)) throw new Error('bad argument'); return { key: a.key }; },
  'network.get': () => ({}),
  // Wi-Fi (D-44): the helper checks again what Windows accepts.
  'wifi.scan': () => ({}),
  'wifi.allow': () => ({}),
  'wifi.connect': (a) => {
    const ssid = typeof a.ssid === 'string' ? a.ssid : '';
    if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32 || /[\u0000-\u001f]/.test(ssid)) throw new Error('A network name has 1 to 32 characters');
    const auth = a.auth ?? 'wpa2';
    if (!['open', 'wpa', 'wpa2', 'wpa3'].includes(auth)) throw new Error('This network needs a certificate or a user name: set it up on the Windows desktop (Settings > Admin)');
    let key = null;
    if (a.key !== undefined && a.key !== null) {
      if (typeof a.key !== 'string' || /[\u0000-\u001f]/.test(a.key)) throw new Error('bad argument');
      if (auth !== 'open' && !/^[0-9a-fA-F]{64}$/.test(a.key) && (a.key.length < 8 || a.key.length > 63)) throw new Error('A Wi-Fi password has 8 to 63 characters');
      key = a.key;
    }
    const profile = typeof a.profile === 'string' && a.profile.length <= 256 ? a.profile : '';
    return { ssid, key, auth, hidden: a.hidden === true, profile };
  },
  'power.get': () => ({}),
  'power.set': (a) => (a.screenOff !== undefined ? { screenOff: oneOf(a.screenOff, SCREEN_OFF_STEPS) } : { sleep: oneOf(a.sleep, IDLE_SLEEP_STEPS) }),
  'motion.set': (a) => ({ reduce: a.reduce === true }),
  'apps.list': () => ({}),
  'apps.open': (a) => {
    const who = profile || config.profiles[0];
    if (typeof a.app !== 'string' || !(knownApps.has(a.app) || pinsOf(who?.id).some((p) => p.id === a.app))) throw new Error('bad argument');
    return { app: a.app };
  },
  about: () => ({}),
  'drives.get': () => ({}),
  'process.find': (a) => {
    const root = expand('${PROFILES}') + path.sep;
    if (typeof a.dir !== 'string' || !a.dir.startsWith(root) || /["\r\n]/.test(a.dir)) throw new Error('bad argument');
    return { dir: a.dir };
  },
};

function stopHelper(reason) {
  if (!helper) return;
  log('helper stopped:', reason);
  helper.kill();
  helper = null;
}

function startHelper() {
  return startPs('system.ps1', (msg) => {
    helperWaiting.get(msg.id)?.(msg);
    helperWaiting.delete(msg.id);
  }, (child) => {
    if (helper === child) helper = null;
    for (const done of helperWaiting.values()) done({ ok: false, error: 'helper exited' });
    helperWaiting.clear();
  });
}

// Joining a network waits for Windows to connect (up to 25 s).
const SLOW_OPS = { 'wifi.connect': 45000 };

async function system(op, args, timeoutMs = SLOW_OPS[op] || 20000) {
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
    }, timeoutMs);
    helperWaiting.set(id, (msg) => { clearTimeout(timer); done(msg); });
    helper.stdin.write(JSON.stringify({ id, op, ...clean }) + '\n');
  });
}

// ---------------------------------------------------------------- preferences
// WinTV's own settings, chosen in Settings: the screen saver, navigation
// sounds and accessibility (D-31). They belong to the TV, not to a profile,
// and live in %APPDATA%\WinTV\settings.json. Only the values listed here
// are accepted; the site file's lockScreen gives the screen saver defaults.
const PREFS = {
  screenSaverMinutes: [2, 5, 10, 15, 30, 0], // idle minutes on the home screen; 0 = never
  screenSaverStyle: ['live', 'colour', 'dark'],
  askWhoMinutes: [15, 30, 60, 120, 0],       // waking after this long away asks who is watching; 0 = never
  navSounds: ['off', 'soft', 'normal', 'loud'],
  textSize: ['default', 'large', 'larger'],
  reduceMotion: [false, true],
  highContrast: [false, true],
  weatherPlace: (v) => v === null || isPlace(v),
  profileLooks: (v) => isProfileLooks(v),
  tips: [true, false],
  pins: (v) => isPins(v),
  tutorialsSeen: (v) => Array.isArray(v) && v.length <= 4 && v.every((k) => ['keyboard', 'remote', 'gamepad', 'mouse'].includes(k)),
};
let prefs = null;

// A profile's name and colour, changed from the TV (the profile menu). The
// profiles themselves come from the site file; this only renames and
// recolours them, on this TV.
const PROFILE_COLOURS = {
  orange: ['#ff9f0a', '#5a2a00'], green: ['#30d158', '#0b3d1c'], blue: ['#0a84ff', '#06224a'], purple: ['#bf5af2', '#3a1450'],
  pink: ['#ff375f', '#4a0a1c'], teal: ['#64d2ff', '#0b3344'], yellow: ['#ffd60a', '#4a3a00'], grey: ['#8e8e93', '#1c1c1e'],
};

function isProfileLooks(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([id, look]) => config.profiles.some((p) => p.id === id && !p.guest)
    && look && typeof look === 'object'
    && (look.name === undefined || (typeof look.name === 'string' && /^[^\u0000-\u001f\u007f<>]{1,24}$/.test(look.name.trim())))
    && (look.colour === undefined || look.colour in PROFILE_COLOURS));
}

function isPins(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([id, list]) => config.profiles.some((p) => p.id === id) && Array.isArray(list) && list.length <= 40
    && list.every((p) => p && typeof p.id === 'string' && p.id.length <= 300 && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 80));
}

function profileList() {
  return config.profiles.map(({ id, name, colors, guest }) => {
    const look = prefs.profileLooks?.[id] || {};
    return { id, name: look.name?.trim() || name, colors: PROFILE_COLOURS[look.colour] || colors, guest: !!guest };
  });
}

function isPlace(p) {
  return !!p && typeof p === 'object' && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 60
    && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
}

const prefOk = (key, value) => (Array.isArray(PREFS[key]) ? PREFS[key].includes(value) : !!PREFS[key]?.(value));

function prefsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadPrefs() {
  const saved = readJson(prefsFile()) || {};
  if (saved.screenSaverStyle === 'photo') saved.screenSaverStyle = 'live'; // pictures of the day became live wallpapers (D-35)
  prefs = {
    screenSaverMinutes: config.lockScreen.afterMinutes,
    screenSaverStyle: 'live',
    askWhoMinutes: config.lockScreen.askWhoAfterMinutes,
    navSounds: 'normal',
    textSize: 'default',
    reduceMotion: false,
    highContrast: false,
    weatherPlace: config.weather,
    profileLooks: {},
    tips: true,
    tutorialsSeen: [],
    pins: {},
  };
  for (const key of Object.keys(PREFS)) if (key in saved && prefOk(key, saved[key])) prefs[key] = saved[key];
}

async function setPref(key, value) {
  if (!prefOk(key, value)) return { ok: false, error: 'bad argument' };
  if (key === 'weatherPlace' && value) value = { name: value.name, latitude: value.latitude, longitude: value.longitude };
  if (key === 'reduceMotion' && IS_WIN) {
    // Windows' "Animation effects" too: Brave and other apps read it as
    // prefers-reduced-motion, so websites keep still as well.
    const r = await system('motion.set', { reduce: value });
    if (!r.ok) return { ok: false, error: r.error };
    log('animation settings:', JSON.stringify(systemPreferences.getAnimationSettings?.() ?? null));
  }
  prefs = { ...prefs, [key]: value };
  try {
    const file = prefsFile();
    fs.writeFileSync(file + '.tmp', JSON.stringify(prefs, null, 2));
    fs.renameSync(file + '.tmp', file); // a crash mid-write keeps the old file
  } catch (e) {
    log('prefs: cannot save:', e.message);
    return { ok: false, error: 'Could not save the setting' };
  }
  log('prefs:', key, value && typeof value === 'object' ? 'changed' : String(value));
  if (win && !win.isDestroyed()) win.webContents.send('prefs', prefs);
  if (win && !win.isDestroyed() && (key === 'profileLooks' || key === 'pins')) win.webContents.send('state', publicState());
  layerSend('prefs', prefs);
  return { ok: true, result: prefs };
}

function quiet(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout }));
  });
}

// A launched app that is still running gets raised instead of started twice.
async function raise(pid) {
  if (!IS_WIN) return;
  await quiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(New-Object -ComObject WScript.Shell).AppActivate(${Number(pid)}) | Out-Null`]);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// The process we started has exited. That doesn't always mean the app has
// closed: Brave restarts itself once after a background update, handing its
// window to a new process (seen on the VM: the Browser tile "exited" with 0
// after two seconds and the home screen jumped over it). For browser apps
// the profile folder identifies the app, so a browser still running with it
// *is* the app, and the shell follows that process instead.
async function appGone(id, pid) {
  const entry = running.get(id);
  if (!entry || entry.pid !== pid) return;
  if (entry.dir) {
    const r = await system('process.find', { dir: entry.dir });
    const next = r.ok ? r.result.pids?.[0] : null;
    if (next && running.get(id) === entry) {
      log('app', id, 'continues in process', String(next));
      entry.pid = next;
      const watch = setInterval(() => {
        if (pidAlive(next)) return;
        clearInterval(watch);
        appGone(id, next);
      }, 1500);
      return;
    }
  }
  running.delete(id);
  if (frontApp === id) frontApp = null;
  pushState();
  goHome('app-exit');
}

async function launch(id) {
  // Straight from All apps: an AppID Windows listed (system.ps1 checks nothing; SYSTEM_OPS does).
  if (id.startsWith('app:')) {
    const r = await system('apps.open', { app: id.slice(4) });
    if (r.ok) log('launch app', id.slice(4));
    return r.ok ? { ok: true } : { ok: false, error: 'Windows couldn’t open it' };
  }
  const item = findItem(id);
  if (!item) return { ok: false, error: 'Unknown app' };
  if (!item.available) return { ok: false, error: item.reason };
  log('launch', id);

  const alive = running.get(id);
  if (alive) { frontApp = id; await raise(alive.pid); return { ok: true, raised: true }; }

  if (item.kind === 'start') {
    const r = await system('apps.open', { app: item.appid });
    if (!r.ok) return { ok: false, error: `Couldn't open ${item.name}` };
    return { ok: true };
  }

  if (item.kind === 'uri') {
    try { await shell.openExternal(item.uri); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  let file;
  let args;
  let dir = null;
  if (item.kind === 'web' || item.kind === 'browser') {
    dir = profileDir(item);
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
    child.once('spawn', () => {
      running.set(id, { pid: child.pid, dir, full: dir !== null && (item.kind === 'web' || !pointerMode) });
      frontApp = id;
      pushState();
      resolve({ ok: true });
    });
    child.once('exit', (code) => {
      log('exit', id, String(code));
      appGone(id, child.pid);
    });
    child.unref();
  });
}

async function quitApp(id) {
  const entry = running.get(id);
  if (!entry) return { ok: true };
  log('quit', id);
  if (IS_WIN) await quiet('taskkill.exe', ['/PID', String(entry.pid), '/T', '/F']);
  else try { process.kill(entry.pid); } catch { /* already gone */ }
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
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState()); // that profile's pinned tiles
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

// ---------------------------------------------------------------- input service
// input.ps1 owns the remote's system keys in every app: Home (tap = home
// screen, hold = quick settings) and volume. Windows would hand those to
// Explorer, which the TV account doesn't run. While the system layer shows
// something to move around in, input.ps1 also takes the arrows, OK and Back
// away from the app and sends them here. It also does the keyboard's typing.
const HOLD_MS = 600;
let input = null;
let homeDown = null;      // { fired } while Home is held
let hwKeyboardAt = 0;     // last time someone typed on a real keyboard

function startInput() {
  if (!IS_WIN) return;
  input = startPs('input.ps1', onInput, (child) => {
    if (input !== child) return;
    input = null;
    if (!quitting) setTimeout(startInput, 3000); // the remote must keep working
  });
}

function inputSend(req) {
  if (input?.stdin.writable) input.stdin.write(JSON.stringify(req) + '\n');
}

function onInput(msg) {
  if (msg.ev === 'key') {
    if (msg.k === 'home') onHomeKey(msg.down, msg.repeat);
    else if (msg.k === 'quick') openQuick(); // the Windows key, held
    else if (['volup', 'voldown', 'mute'].includes(msg.k)) volumeKey(msg.k);
    else layerSend('key', { k: msg.k, repeat: msg.repeat });
  } else if (msg.ev === 'text') onTextFocus(msg);
  else if (msg.ev === 'hwtype') { hwKeyboardAt = Date.now(); closeSurface('keyboard'); }
  else if (msg.ev === 'grab-expired') { log('input: grab expired'); closeSurfaces(); }
  else if (msg.ev === 'device') deviceSeen(msg.kind);
  else if (msg.ev === 'ready') { log(`input: ready hook=${msg.hook} uia=${msg.uia}`); syncGrab(); }
  else if (msg.ev === 'error') log('input:', msg.message);
}

function onHomeKey(down, repeat) {
  if (down && !repeat) {
    const press = { fired: false };
    press.timer = setTimeout(() => { press.fired = true; openQuick(); }, HOLD_MS);
    homeDown = press;
  } else if (!down && homeDown) {
    clearTimeout(homeDown.timer);
    if (!homeDown.fired) goHome('home key');
    homeDown = null;
  }
}

// Volume keys step the default output and show the volume on top of the app.
const volKeys = [];
async function volumeKey(k) {
  volKeys.push(k === 'volup' ? 'up' : k === 'voldown' ? 'down' : 'mute');
  if (volKeys.length > 1) return; // the running loop below takes it
  let last = null;
  while (volKeys.length) {
    last = await system('audio.key', { key: volKeys[0] });
    volKeys.shift();
  }
  if (last?.ok) openSurface('volume', last.result);
}

// ---------------------------------------------------------------- system layer
// One transparent, always-on-top window over the whole screen. It never takes
// the focus (WS_EX_NOACTIVATE), so the app underneath keeps its text cursor
// and the keyboard's typing lands there. Hidden whenever it shows nothing.
const SURFACES = ['quick', 'keyboard', 'volume', 'notice'];
const INTERACTIVE = ['quick', 'keyboard', 'notice']; // these take the remote's arrows/OK/Back
const SLEEP_STEPS = [0, 15, 30, 60, 90, 120];
let layer = null;
const surfaces = new Set();
let keyboardAuto = false;  // opened because a text field got the focus
let sleepTimer = null;     // { minutes, at, warn, fire }
let layerHideTimer = 0;

function createLayer() {
  layer = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    focusable: !!process.env.WINTV_LAYER_FOCUSABLE, // Linux test runs have no input.ps1
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'layer-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  layer.removeMenu();
  layer.setIgnoreMouseEvents(true);
  layer.loadURL('wintv://ui/layer.html');
  layer.webContents.on('did-finish-load', () => layerSend('prefs', prefs));
  layer.on('close', (e) => { if (!quitting) e.preventDefault(); });
  layer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  layer.webContents.on('will-navigate', (e) => e.preventDefault());
  layer.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log('layer', e.level, e.message, `${e.sourceId}:${e.lineNumber}`);
  });
  layer.webContents.on('render-process-gone', (_e, d) => {
    log('layer renderer gone:', d.reason);
    surfaces.clear();
    syncGrab();
    setTimeout(() => { if (!layer.isDestroyed()) layer.reload(); }, 500);
  });
  const fit = () => { if (!layer.isDestroyed()) layer.setBounds(screen.getPrimaryDisplay().bounds); };
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
}

function layerSend(channel, data) {
  if (layer && !layer.isDestroyed()) layer.webContents.send(channel, data);
}

// After a notice goes by itself, the remote stays with the layer a moment
// longer: an OK meant for the notice must not land on the app behind it
// (seen on VM 223: OK 0.4 s too late opened YouTube, D-42).
let graceUntil = 0;
function syncGrab() {
  const interactive = [...surfaces].some((s) => INTERACTIVE.includes(s));
  inputSend({ op: 'grab', on: interactive || Date.now() < graceUntil });
  if (layer && !layer.isDestroyed()) layer.setIgnoreMouseEvents(!interactive);
}

function openSurface(name, data) {
  if (!layer || layer.isDestroyed()) return;
  // One thing to move around in at a time: quick settings gives way to the keyboard.
  if (INTERACTIVE.includes(name)) for (const s of INTERACTIVE) if (s !== name && s !== 'notice') closeSurface(s);
  surfaces.add(name);
  clearTimeout(layerHideTimer);
  layerSend('show', { surface: name, data });
  if (!layer.isVisible()) {
    if (process.env.WINTV_LAYER_FOCUSABLE) layer.show(); else layer.showInactive();
  }
  layer.setAlwaysOnTop(true, 'screen-saver'); // above full-screen apps, and back above home after goHome
  layer.moveTop();
  syncGrab();
}

function closeSurface(name) {
  if (!surfaces.delete(name)) return;
  if (name === 'keyboard') keyboardAuto = false;
  layerSend('hide', name);
  syncGrab();
  if (!surfaces.size) {
    clearTimeout(layerHideTimer);
    layerHideTimer = setTimeout(() => { if (!surfaces.size && !layer.isDestroyed()) layer.hide(); }, 400); // after the fade
  }
}

function closeSurfaces(except = []) {
  for (const s of [...surfaces]) if (!except.includes(s)) closeSurface(s);
}

async function openQuick() {
  if (surfaces.has('quick')) { closeSurface('quick'); return; } // hold Home again to close
  const audio = await system('audio.get');
  const front = frontApp && running.has(frontApp) && win && !win.isFocused() ? findItem(frontApp) : null;
  openSurface('quick', {
    // The app in front, and the others open behind it to switch to.
    app: front ? { id: front.id, name: front.name, kind: front.kind, full: running.get(front.id).full } : null,
    others: [...running.keys()].filter((id) => id !== front?.id).map((id) => ({ id, name: findItem(id)?.name || id })),
    audio: audio.ok ? audio.result : null,
    sleep: sleepState(),
    sleepSteps: SLEEP_STEPS,
    appInFront: !!win && !win.isDestroyed() && !win.isFocused(),
    profiles: config.profiles.length > 1,
  });
}

// The keyboard's letters follow the household's layout: German homes get
// QWERTZ with umlauts, everyone else QWERTY. The layout key switches anyway.
function keyboardLayout() {
  const want = config.keyboard.layout;
  if (want === 'qwerty' || want === 'qwertz') return want;
  const langs = [app.getSystemLocale?.() || '', ...(app.getPreferredSystemLanguages?.() || [])];
  return langs.some((l) => /^de\b/i.test(l)) ? 'qwertz' : 'qwerty';
}

function openKeyboard(password, auto) {
  openSurface('keyboard', { password: !!password, layout: keyboardLayout() });
  keyboardAuto = auto;
}

// A text field got the focus somewhere (input.ps1, via UI Automation): bring
// the keyboard up, the way a TV does. Not while someone uses a real keyboard.
function onTextFocus(msg) {
  if (msg.on) {
    if (!config.keyboard.autoOpen || Date.now() - hwKeyboardAt < 10 * 60000) return;
    if (surfaces.has('quick') || surfaces.has('notice')) return;
    // Apps report the same field again as you type; the layer keeps its
    // place and only takes the password flag from a repeat.
    if (!surfaces.has('keyboard')) log('keyboard: text field', msg.password ? '(password)' : '');
    openKeyboard(msg.password, true);
  } else if (keyboardAuto) {
    log('keyboard: text field left');
    closeSurface('keyboard');
  }
}

// Sleep timer: like a TV's, it warns a minute before and a button press
// cancels it. It doesn't survive a restart, on purpose.
function sleepState() {
  return sleepTimer ? { minutes: sleepTimer.minutes, at: sleepTimer.at } : { minutes: 0 };
}

function setSleepTimer(minutes) {
  if (sleepTimer) { clearTimeout(sleepTimer.warn); clearTimeout(sleepTimer.fire); sleepTimer = null; }
  closeSurface('notice');
  if (!minutes) { log('sleep timer off'); return sleepState(); }
  const ms = minutes * 60000;
  sleepTimer = {
    minutes,
    at: Date.now() + ms,
    warn: setTimeout(() => openSurface('notice', { kind: 'sleep', at: sleepTimer.at }), ms - 60000),
    fire: setTimeout(() => { sleepTimer = null; closeSurfaces(); power('sleep'); }, ms),
  };
  log('sleep timer', String(minutes));
  return sleepState();
}

const KEYBOARD_KEYS = ['backspace', 'enter', 'left', 'right', 'tab'];

const LAYER_ACTIONS = {
  home: () => { goHome('quick settings'); return {}; },
  keyboard: () => { openKeyboard(false, false); return {}; },
  'screen-off': () => {
    closeSurfaces();
    // Wait for the OK button to be let go, or its release wakes the picture again.
    setTimeout(() => inputSend({ op: 'screen-off' }), 800);
    return {};
  },
  'sleep-timer': (m) => {
    if (!SLEEP_STEPS.includes(m)) throw new Error('bad argument');
    return setSleepTimer(m);
  },
  'sleep-now': () => { setSleepTimer(0); closeSurfaces(); setTimeout(() => power('sleep'), 300); return {}; },
  'notice-expired': () => {
    graceUntil = Date.now() + 1000;
    closeSurface('notice');
    setTimeout(syncGrab, 1050);
    return {};
  },
  // The drive notice's "Open in Files" (D-42): only a drive Files shows.
  'open-files': (root) => {
    if (!drivePlaces().some((p) => p.path === root)) throw new Error('bad argument');
    closeSurfaces();
    goHome('files');
    win.webContents.send('files', root);
    return {};
  },
  who: () => { goHome('who is watching'); win.webContents.send('picker'); return {}; },
  // Switching contexts (D-36): another open app, the browser's address bar,
  // full screen. The keys go to the app in front (the layer never has the
  // focus), once quick settings has closed and the OK button is let go.
  switch: (id) => {
    if (!running.has(id)) throw new Error('bad argument');
    closeSurfaces();
    launch(id); // raises it
    return {};
  },
  fullscreen: () => {
    const entry = running.get(frontApp);
    if (!entry?.dir) throw new Error('No browser app in front');
    entry.full = !entry.full;
    closeSurfaces();
    setTimeout(() => inputSend({ op: 'key', key: 'f11' }), 400);
    return {};
  },
  address: () => {
    const entry = running.get(frontApp);
    if (!entry?.dir) throw new Error('No browser in front');
    const keys = entry.full ? ['f11', 'address'] : ['address']; // the address bar shows only outside full screen
    entry.full = false;
    closeSurfaces();
    keys.forEach((key, i) => setTimeout(() => inputSend({ op: 'key', key }), 400 + i * 500));
    return {};
  },
  volume: async (v) => result(await system('audio.set', { volume: v })),
  mute: async (on) => result(await system('audio.set', { muted: on === true })),
};

function result(r) {
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

// IPC from the two windows: each may only call its own set.
const fromHome = (fn) => (e, ...a) => (e.sender === win?.webContents ? fn(...a) : { ok: false, error: 'not allowed' });
const fromLayer = (fn) => (e, ...a) => (e.sender === layer?.webContents ? fn(...a) : { ok: false, error: 'not allowed' });

function layerIpc() {
  ipcMain.on('layer:close', (e, name) => {
    if (e.sender === layer?.webContents && SURFACES.includes(name)) closeSurface(name);
  });
  ipcMain.handle('layer:type', fromLayer((text) => {
    // One key's worth (".com" is the longest), printable characters only.
    if (typeof text !== 'string' || !text.length || text.length > 8 || /[\u0000-\u001f\u007f]/.test(text)) return { ok: false, error: 'bad argument' };
    // Into WinTV's own window directly: through Windows' input, every keyboard
    // hook in the session would see it, the admin password too (D-39).
    if (win?.isFocused()) win.webContents.insertText(text);
    else inputSend({ op: 'type', text });
    return { ok: true };
  }));
  ipcMain.handle('layer:key', fromLayer((name) => {
    if (!KEYBOARD_KEYS.includes(name)) return { ok: false, error: 'bad argument' };
    if (win?.isFocused()) {
      const keyCode = { backspace: 'Backspace', enter: 'Enter', left: 'Left', right: 'Right', tab: 'Tab' }[name];
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    } else inputSend({ op: 'key', key: name });
    return { ok: true };
  }));
  ipcMain.handle('layer:action', fromLayer(async (name, arg) => {
    const fn = LAYER_ACTIONS[name];
    if (!fn) return { ok: false, error: 'Unknown action' };
    try { return { ok: true, result: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
  }));
}

// ---------------------------------------------------------------- files (D-40)
// Files: the TV account's folders, its drives and its Recycle Bin. files.js
// checks every path the screen sends back against these places; media plays
// from wintv://ui/media/<token>, a token per file checked here.
const MEDIA = new Map(); // token -> file
let drives = { at: 0, list: [], sid: null };

async function refreshDrives() {
  if (!IS_WIN || Date.now() - drives.at < 5000) return;
  const r = await system('drives.get', {});
  if (r.ok) { drives = { at: Date.now(), list: r.result.drives || [], sid: r.result.sid || null }; drivesKnown = true; }
}

// A drive plugged in or out (WM_DEVICECHANGE). Without Explorer there is no
// AutoPlay, so nothing on the TV would say a USB stick was seen: a notice in
// the system layer offers Files (D-42). Files reloads its list either way.
let drivesKnown = false;
let driveTimer = 0;
function deviceChanged() {
  clearTimeout(driveTimer);
  driveTimer = setTimeout(async () => {
    const before = new Set(drives.list.map((d) => d.root));
    const knew = drivesKnown;
    drives.at = 0;
    await refreshDrives();
    if (!drives.at) return;
    drivesKnown = true;
    if (win && !win.isDestroyed()) win.webContents.send('drives');
    const added = drivePlaces().find((p) => !before.has(p.path));
    if (knew && added) {
      log('drive: in', added.letter);
      openSurface('notice', { kind: 'drive', name: added.name, letter: added.letter, root: added.path, removable: added.removable });
    }
  }, 1500);
}

function folderPlaces() {
  return [
    { id: 'downloads', name: 'Downloads', glyph: 'download', path: app.getPath('downloads') },
    { id: 'videos', name: 'Videos', glyph: 'film', path: app.getPath('videos') },
    { id: 'music', name: 'Music', glyph: 'music', path: app.getPath('music') },
    { id: 'pictures', name: 'Pictures', glyph: 'photo', path: app.getPath('pictures') },
  ];
}

function drivePlaces() {
  return drives.list.filter((d) => !d.system && typeof d.root === 'string').map((d) => ({
    id: `drive:${d.root}`, name: d.label || (d.removable ? 'USB drive' : 'Drive'), letter: d.root.slice(0, 2),
    glyph: 'drive', path: d.root, removable: !!d.removable,
  }));
}

const fileRoots = () => [...folderPlaces(), ...drivePlaces()].map((p) => p.path);
const binDirs = () => (drives.sid ? drives.list.filter((d) => !d.removable).map((d) => path.join(d.root, '$Recycle.Bin', drives.sid)) : []);
const onRemovable = (p) => drivePlaces().some((d) => d.removable && filesLib.inside(d.path, p));

function checked(p) {
  const f = filesLib.check(fileRoots(), p);
  if (!f) throw new Error('That isn’t there any more');
  return f;
}

const FILE_OPS = {
  places: async () => {
    await refreshDrives();
    return { places: [...folderPlaces(), ...drivePlaces()], bin: filesLib.binList(binDirs()).length };
  },
  list: async (a) => {
    await refreshDrives();
    const dir = checked(a.path);
    return { path: dir, removable: onRemovable(dir), ...filesLib.list(dir) };
  },
  // Windows' own thumbnail (its cache), as a data URL; null if it has none.
  thumb: async (a) => {
    const f = checked(a.path);
    if (!IS_WIN) return null;
    try { return (await nativeImage.createThumbnailFromPath(f, { width: 480, height: 270 })).toDataURL(); } catch { return null; }
  },
  media: async (a) => {
    const f = checked(a.path);
    const type = filesLib.mediaType(f);
    if (!type) throw new Error('This kind of file doesn’t open on the TV');
    const token = crypto.randomBytes(16).toString('hex');
    MEDIA.set(token, f);
    if (MEDIA.size > 64) MEDIA.delete(MEDIA.keys().next().value);
    return { url: `wintv://ui/media/${token}`, kind: type.split('/')[0] };
  },
  // To the Recycle Bin; a USB stick has none, so there it is gone for good
  // (the screen asks first).
  trash: async (a) => {
    await refreshDrives();
    const f = checked(a.path);
    if (fileRoots().some((r) => path.relative(r, f) === '')) throw new Error('bad argument'); // not a place itself
    if (onRemovable(f)) { fs.rmSync(f, { recursive: true, maxRetries: 2 }); return { gone: true }; }
    await shell.trashItem(f);
    return { gone: false };
  },
  'bin.list': async () => { await refreshDrives(); return { items: filesLib.binList(binDirs()) }; },
  'bin.restore': async (a) => { await refreshDrives(); return { path: filesLib.binRestore(binDirs(), a.id) }; },
  'bin.delete': async (a) => { await refreshDrives(); filesLib.binDelete(binDirs(), a.id); return {}; },
  'bin.empty': async () => { await refreshDrives(); return { count: filesLib.binEmpty(binDirs()) }; },
};

const FILE_ERRORS = { EPERM: 'Windows didn’t allow that', EACCES: 'Windows didn’t allow that', EBUSY: 'It’s in use', ENOENT: 'That isn’t there any more', ENOTEMPTY: 'It’s in use' };

async function filesOp(op, args) {
  const fn = FILE_OPS[op];
  if (!fn) return { ok: false, error: 'Unknown' };
  try { return { ok: true, result: await fn(args) }; } catch (e) {
    log('files:', op, e.code || '', e.message);
    return { ok: false, error: FILE_ERRORS[e.code] || e.message };
  }
}

// ---------------------------------------------------------------- admin (D-39)
// Settings > Admin: jobs on the PC itself, behind the admin password, done
// by a SYSTEM broker (payload setup/admin.ps1) this account may only start.
// The broker checks everything itself; these checks only give quick errors.
// The key it hands out for the password stays in this process: the home
// screen only learns that the section is unlocked.
const PC_NAME = /^(?![0-9]+$)(?!-)[A-Za-z0-9-]{1,15}(?<!-)$/;
const ADMIN_JOBS = {
  status: () => ({}),
  unlock: (a) => {
    if (typeof a.password !== 'string' || !a.password.length || a.password.length > 256) throw new Error('Type the admin password');
    return { password: a.password };
  },
  lock: () => ({}),
  'device.get': () => ({}),
  'device.rename': (a) => {
    if (typeof a.name !== 'string' || !PC_NAME.test(a.name)) throw new Error('Use up to 15 letters, digits and hyphens');
    return { name: a.name };
  },
  'encryption.get': () => ({}),
};
// Written by the broker; only SYSTEM and admins can write it (D-39).
const BROKER_FILE = path.join(SYSTEM_DIR, 'state', 'admin-broker.json');
let adminKey = null;

function brokerInfo() {
  const b = readJson(BROKER_FILE);
  return typeof b?.pipe === 'string' && /^WinTV\.Admin\.[0-9a-f]{32}$/.test(b.pipe) ? b : null;
}

// One request, one answer. `down`: nobody is listening on that pipe.
function brokerAsk(pipe, req, timeoutMs = 20000) {
  return new Promise((done) => {
    let buf = '';
    let over = false;
    const sock = net.connect(`\\\\.\\pipe\\${pipe}`);
    const end = (r) => { if (over) return; over = true; clearTimeout(timer); sock.destroy(); done(r); };
    const timer = setTimeout(() => end({ ok: false, error: 'The admin helper didn’t answer' }), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) { if (buf.length > 65536) end({ ok: false, error: 'bad answer' }); return; }
      try { end(JSON.parse(buf.slice(0, nl))); } catch { end({ ok: false, error: 'bad answer' }); }
    });
    sock.on('error', (e) => end({ ok: false, error: e.message, down: e.code === 'ENOENT' }));
    sock.on('close', () => end({ ok: false, error: 'The admin helper didn’t answer' }));
  });
}

// Starts the broker and waits for its new pipe (PowerShell and its compiler
// take a few seconds).
async function startBroker() {
  const before = brokerInfo()?.pipe;
  const { err } = await quiet('schtasks.exe', ['/Run', '/TN', '\\WinTV\\AdminBroker']);
  if (err) return null; // not registered yet: an updated TV gets it at its next restart
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const b = brokerInfo();
    if (b && b.pipe !== before) return b;
  }
  return null;
}

async function admin(op, args) {
  const check = ADMIN_JOBS[op];
  if (!check) return { ok: false, error: 'Unknown job' };
  let clean;
  try { clean = check(args || {}); } catch (e) { return { ok: false, error: e.message }; }
  if (!IS_WIN) return { ok: false, error: 'Admin needs Windows' };
  const req = { op, ...clean };
  if (op !== 'status' && op !== 'unlock') {
    if (!adminKey) return { ok: false, error: 'Locked', locked: true };
    req.key = adminKey;
  }
  const b = brokerInfo();
  let r = b ? await brokerAsk(b.pipe, req) : { down: true };
  if (r.down) {
    // It stops after 10 idle minutes, and the key goes with it.
    if (req.key) { adminKey = null; return { ok: false, error: 'Locked', locked: true }; }
    const fresh = await startBroker();
    if (!fresh) return { ok: false, error: 'Admin isn’t set up on this TV yet: restart it once' };
    r = await brokerAsk(fresh.pipe, req);
  }
  if (r.locked || op === 'lock') adminKey = null;
  if (op === 'unlock' && r.ok) {
    adminKey = typeof r.result?.key === 'string' ? r.result.key : null;
    log('admin: unlocked');
    return { ok: true, result: {} };
  }
  return { ok: !!r.ok, result: r.result, error: r.error, locked: r.locked, lockedMinutes: r.lockedMinutes };
}

// ---------------------------------------------------------------- updates
// Windows updates and WinTV's own run as SYSTEM in three scheduled tasks
// (payload setup/updates.ps1). This account may only start them; they take
// no input. Their progress is in C:\ProgramData\WinTV\state (D-27, D-28).
const UPDATE_TASKS = { 'windows-check': 'WindowsUpdateCheck', 'windows-install': 'WindowsUpdateInstall', wintv: 'WinTVUpdate' };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function currentVersion() {
  const v = readJson(path.join(INSTALL_DIR, 'current.json'))?.version;
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

function updatesState() {
  const next = currentVersion();
  const state = (name) => readJson(path.join(SYSTEM_DIR, 'state', `${name}.json`));
  return {
    windows: state('windows-update'),
    wintv: state('wintv-update'),
    running: app.getVersion(),
    next,
    restartPending: !!next && next !== app.getVersion(),
  };
}

async function runUpdateTask(job) {
  const task = UPDATE_TASKS[job];
  if (!task) return { ok: false, error: 'Unknown update' };
  if (!IS_WIN) return { ok: false, error: 'Updates need Windows' };
  log('updates: start', task);
  const { err } = await quiet('schtasks.exe', ['/Run', '/TN', `\\WinTV\\${task}`]);
  return err ? { ok: false, error: 'Windows did not start the update' } : { ok: true };
}

// The new version runs once this process restarts: the supervisor starts
// whatever current.json names.
function restartIntoUpdate(reason) {
  if (!CHILD) return { ok: false, error: 'Restart WinTV to finish' };
  log('updates: restarting into', currentVersion(), `(${reason})`);
  stopHelper('update');
  input?.kill();
  setTimeout(() => app.exit(0), 300);
  return { ok: true };
}

// A downloaded WinTV update switches in when nobody is watching: no app
// open and no button pressed for 10 minutes.
function watchForUpdate() {
  setInterval(() => {
    if (updatesState().restartPending && running.size === 0 && powerMonitor.getSystemIdleTime() >= 600) restartIntoUpdate('idle');
  }, 60000);
}

async function updates(action, arg) {
  if (action === 'get') return { ok: true, result: updatesState() };
  if (action === 'run') return runUpdateTask(String(arg));
  if (action === 'restart') return updatesState().restartPending ? restartIntoUpdate('asked') : { ok: false, error: 'No update waiting' };
  return { ok: false, error: 'Unknown action' };
}

// The supervisor's rollback check (updates.ps1) looks for this: the version
// that is running has drawn its screen.
function reportHealthy() {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'health.json'), JSON.stringify({ version: app.getVersion(), at: new Date().toISOString() }));
  } catch (e) { log('health:', e.message); }
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
  '.webm': 'video/webm',
};
// stream: video elements may play from wintv:// (the live wallpapers).
protocol.registerSchemesAsPrivileged([{ scheme: 'wintv', privileges: { standard: true, secure: true, stream: true } }]);

// A downloaded file, in the pieces a video player asks for (HTTP Range).
function serveCached(req, file, type = UI_TYPES[path.extname(file)] || 'application/octet-stream') {
  let size;
  try { size = fs.statSync(file).size; } catch { return new Response('', { status: 404 }); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!range || (!range[1] && !range[2])) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response('', { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' },
  });
}

function serveUi() {
  protocol.handle('wintv', (req) => {
    const url = new URL(req.url);
    if (url.host !== 'ui') return new Response('', { status: 404 });
    // Files art.js downloaded: only names it writes itself.
    const cached = /^\/cache\/(videos|logos|icons)\/([0-9a-f]{16}\.(?:webm|png))$/.exec(url.pathname);
    if (cached) return serveCached(req, path.join(CACHE_DIR, cached[1], cached[2]));
    // Files' player (D-40): only files main.js checked and gave a token.
    const media = /^\/media\/([0-9a-f]{32})$/.exec(url.pathname);
    if (media) {
      const f = MEDIA.get(media[1]);
      return f ? serveCached(req, f, filesLib.mediaType(f) || 'application/octet-stream') : new Response('', { status: 404 });
    }
    const file = path.normalize(path.join(UI_DIR, decodeURIComponent(url.pathname)));
    if (!file.startsWith(UI_DIR + path.sep)) return new Response('', { status: 404 });
    try {
      return new Response(fs.readFileSync(file), { headers: { 'content-type': UI_TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- window
// The first time a kind of device is used, the home screen shows how to get
// around with it (D-36); in an app, it waits until the home screen is back.
const DEVICES = ['keyboard', 'remote', 'gamepad', 'mouse'];
let pendingDevice = null;

function deviceSeen(kind) {
  if (!DEVICES.includes(kind) || prefs.tutorialsSeen.includes(kind) || !prefs.tips) return;
  log('device: first', kind);
  if (win && !win.isDestroyed() && win.isFocused()) win.webContents.send('device', kind);
  else pendingDevice = kind;
}

function goHome(reason) {
  if (!win || win.isDestroyed()) return;
  log('home', reason);
  frontApp = null;
  if (pendingDevice) { win.webContents.send('device', pendingDevice); pendingDevice = null; }
  closeSurfaces(['volume', 'notice']); // the sleep-timer warning stays until answered
  if (win.isMinimized()) win.restore();
  win.show();
  // Briefly topmost so Windows lets the home screen take the foreground back.
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
  // DBT_DEVICEARRIVAL / DBT_DEVICEREMOVECOMPLETE reach every top-level window (D-42).
  if (IS_WIN) {
    win.hookWindowMessage(0x0219, (wParam) => {
      const event = wParam.readUInt32LE(0);
      if (event === 0x8000 || event === 0x8004) deviceChanged();
    });
  }
  win.loadURL('wintv://ui/index.html');
  win.once('ready-to-show', () => {
    log('window ready');
    win.show();
    // Start the Settings helper in the background: PowerShell takes a second
    // or two to start, which would otherwise delay the first Settings page.
    // Then learn the drives, so the first USB stick plugged in is news (D-42).
    setTimeout(() => { if (IS_WIN && !helper) helper = startHelper(); refreshDrives(); }, 3000);
  });
  win.on('close', (e) => { if (!quitting) e.preventDefault(); }); // Alt+F4 must not kill the shell
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // The log is the only window into a TV with no desktop: record whether the
  // page loaded and any error it printed.
  win.webContents.on('did-finish-load', () => { log('ui loaded'); reportHealthy(); });
  win.webContents.on('did-fail-load', (_e, code, desc) => log('ui failed to load:', String(code), desc));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log('ui', e.level, e.message, `${e.sourceId}:${e.lineNumber}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone:', d.reason);
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 500);
  });
}

// input.ps1 handles Home (and holding it) in every app. These shortcuts are
// the fallback while it isn't running, plus quick settings for a keyboard.
function registerHomeKeys() {
  const keys = [...config.homeKeys.map((acc) => [acc, () => goHome(acc)]),
    ...config.quickKeys.map((acc) => [acc, () => openQuick()])];
  for (const [acc, fn] of keys) {
    try {
      log(`shortcut ${acc}:`, globalShortcut.register(acc, fn) ? 'registered' : 'taken');
    } catch (e) {
      log(`shortcut ${acc}: invalid (${e.message})`);
    }
  }
}

// ---------------------------------------------------------------- supervisor
// Windows starts the shell once and never again: on the VM, killing the
// shell left a black screen until the next restart. So the shell is
// `WinTV.exe --supervise`, a small parent with no window whose only job is
// to start the real shell (`--child`) and start it again whenever it
// exits. If it keeps crashing, it waits longer between starts.
const SUPERVISE = process.argv.includes('--supervise');
const CHILD = process.argv.includes('--child');
const EXIT_ALREADY_RUNNING = 3;

// The shell it starts is the version current.json names, so an update takes
// effect at the next restart. If that version keeps crashing, the
// supervisor asks the update task to go back to the previous one.
function childExe() {
  const v = currentVersion();
  const exe = v && path.join(INSTALL_DIR, 'versions', v, 'WinTV.exe');
  return exe && fs.existsSync(exe) ? exe : process.execPath;
}

// A start counts as failed if the shell exits with an error within a
// minute, or hasn't drawn its screen (health.json) after WATCHDOG_MS: a
// release can crash, or hang. Three failed starts in a row of a version
// that was just installed ask updates.ps1 to go back to the previous one.
const WATCHDOG_MS = 90000;

function healthySince(t) {
  const h = readJson(path.join(app.getPath('userData'), 'health.json'));
  return !!h && Date.parse(h.at) >= t;
}

function supervise() {
  app.disableHardwareAcceleration();
  let failsInARow = 0;
  let rollbackAsked = null;
  const start = (delay) => setTimeout(() => {
    const passOn = process.argv.slice(1).filter((a) => a !== '--supervise');
    const exe = childExe();
    const started = Date.now();
    const child = spawn(exe, [...passOn, '--child'], { stdio: 'ignore' });
    const watchdog = setTimeout(() => {
      if (child.exitCode === null && !healthySince(started)) {
        log('supervisor: the shell has not drawn its screen after', String(WATCHDOG_MS / 1000), 's; stopping it');
        child.kill();
      }
    }, WATCHDOG_MS);
    child.once('error', (e) => { clearTimeout(watchdog); log('supervisor: cannot start the shell:', e.message); start(10000); });
    child.once('exit', (code) => {
      clearTimeout(watchdog);
      log('supervisor: shell exited', String(code), exe);
      const ranWell = healthySince(started) && Date.now() - started > 60000;
      if (code === 0 || code === EXIT_ALREADY_RUNNING || ranWell) failsInARow = 0;
      else failsInARow += 1;
      const looping = failsInARow >= 3;
      const version = currentVersion();
      if (looping && version && rollbackAsked !== version) {
        rollbackAsked = version;
        log('supervisor: version', version, 'keeps crashing; asking for the previous one');
        try {
          fs.writeFileSync(path.join(app.getPath('userData'), 'crashloop.json'), JSON.stringify({ version, at: new Date().toISOString() }));
        } catch (e) { log('supervisor:', e.message); }
        runUpdateTask('wintv');
      }
      if (code === EXIT_ALREADY_RUNNING) start(30000);
      else start(looping ? 10000 : 300);
    });
  }, delay);
  app.whenReady().then(() => { log('supervisor: start'); start(0); });
}

// ---------------------------------------------------------------- startup
process.removeAllListeners('uncaughtException');
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
    loadPrefs();
    art.init(CACHE_DIR, log);
    log(`start v${app.getVersion()} user=${os.userInfo().username} browser=${config.browser || 'none'}`);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    serveUi();
    ipcMain.handle('wintv:state', fromHome(() => publicState()));
    ipcMain.handle('wintv:launch', fromHome((id) => launch(String(id))));
    ipcMain.handle('wintv:quit', fromHome((id) => quitApp(String(id))));
    ipcMain.handle('wintv:power', fromHome((action) => power(String(action))));
    ipcMain.handle('wintv:profile', fromHome((id) => setProfile(String(id))));
    ipcMain.handle('wintv:system', fromHome((op, args) => system(String(op), args && typeof args === 'object' ? args : {})));
    ipcMain.handle('wintv:admin', fromHome((op, args) => admin(String(op), args && typeof args === 'object' ? args : {})));
    ipcMain.handle('wintv:files', fromHome((op, args) => filesOp(String(op), args && typeof args === 'object' ? args : {})));
    ipcMain.handle('wintv:updates', fromHome((action, arg) => updates(String(action), arg)));
    ipcMain.handle('wintv:pref', fromHome((key, value) => setPref(String(key), value)));
    ipcMain.handle('wintv:weather', fromHome(() => weatherNow()));
    ipcMain.handle('wintv:places', fromHome((name) => findPlaces(name)));
    // The home screen's own text fields (the weather town) call up the keyboard.
    ipcMain.handle('wintv:apps', fromHome(() => listApps()));
    ipcMain.handle('wintv:device', fromHome((kind) => { deviceSeen(String(kind)); return { ok: true }; }));
    ipcMain.handle('wintv:pointer', fromHome((on) => { pointerMode = on === true; return { ok: true }; }));
    ipcMain.handle('wintv:keyboard', fromHome((on) => { if (on === true) openKeyboard(false, true); else closeSurface('keyboard'); return { ok: true }; }));
    layerIpc();
    if (config.profiles.length === 1) profile = config.profiles[0];
    // Waking the TV shows the lock screen; the next button asks who is watching.
    powerMonitor.on('resume', () => {
      setSleepTimer(0);
      closeSurfaces();
      goHome('resume');
      win.webContents.send('lock');
    });
    app.on('child-process-gone', (_e, d) => log('process gone:', d.type, d.reason, String(d.exitCode)));
    app.getGPUInfo('basic')
      .then((g) => log('gpu:', (g.gpuDevice || []).map((d) => `${d.vendorId}:${d.deviceId}${d.active ? '*' : ''}`).join(' ') || 'none'))
      .catch((e) => log('gpu:', e.message));
    startInput();
    createWindow();
    createLayer();
    registerHomeKeys();
    watchForUpdate();
    setTimeout(refreshArt, 15000);
    setInterval(refreshArt, 6 * 3600000);
  });
  app.on('window-all-closed', () => { if (!quitting) createWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHelper('quit'); input?.kill(); });
}
