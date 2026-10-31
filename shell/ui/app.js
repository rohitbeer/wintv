'use strict';
// WinTV home screen: focus engine, input (remote keys, gamepad, air mouse),
// the top shelf, Settings and the menus. One of the WinTV shell's two
// windows; the other, the system layer (layer.js), floats over every app.
// Talks to the machine only through window.wintv.

const GLYPHS = {
  play: '<path d="M9 6.2v11.6l9.2-5.8z" fill="currentColor" stroke-linejoin="round"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9.2h17M3.5 14.8h17M8 5v4.2M16 5v4.2M8 14.8V19M16 14.8V19"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M8.5 20h7M12 16.5V20"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.7l-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z" stroke-linejoin="round"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.6 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.6-3.5-8.5s1.1-5.9 3.5-8.5z"/>',
  gamepad: '<path d="M7.2 8h9.6a4 4 0 0 1 3.9 4.9l-.8 3.6a2.3 2.3 0 0 1-4 1l-1.3-1.5H9.4l-1.3 1.5a2.3 2.3 0 0 1-4-1l-.8-3.6A4 4 0 0 1 7.2 8z"/><path d="M8.2 10.8v3M6.7 12.3h3"/><circle cx="15.8" cy="11.4" r=".5" fill="currentColor"/><circle cx="17.3" cy="13.1" r=".5" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
  power: '<path d="M12 3.6v7.6"/><path d="M7.1 6.3a7.6 7.6 0 1 0 9.8 0"/>',
  sound: '<path d="M4.5 9.5h3l4.5-3.8v12.6l-4.5-3.8h-3z" stroke-linejoin="round"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>',
  folder: '<path d="M3.5 7.2a1.7 1.7 0 0 1 1.7-1.7h4.1l2 2.2h7.5a1.7 1.7 0 0 1 1.7 1.7v8.4a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" stroke-linejoin="round"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  music: '<path d="M9 17.5V6.5l10-2v11"/><circle cx="6.8" cy="17.5" r="2.2"/><circle cx="16.8" cy="15.5" r="2.2"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" stroke-linejoin="round"/>',
  drive: '<rect x="3.5" y="13" width="17" height="6" rx="1.8"/><path d="M5.5 13 8 5.5h8l2.5 7.5"/><circle cx="16.5" cy="16" r=".6" fill="currentColor"/>',
  bin: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/><path d="M10.3 10.5v6M13.7 10.5v6"/>',
  file: '<path d="M7 3.5h6.5l4 4v13H7z" stroke-linejoin="round"/><path d="M13.5 3.5v4h4"/>',
  update: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v3.6h-3.6"/><path d="M12 8.5v4.2l2.6 1.6"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" stroke-linejoin="round"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  access: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="7.4" r=".9" fill="currentColor"/><path d="M7.6 9.8l4.4.9 4.4-.9M12 10.7v3.4M12 14.1l-2.2 3.6M12 14.1l2.2 3.6"/>',
  // weather
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  cloud: '<path d="M7.2 18.5h10.3a3.9 3.9 0 0 0 .4-7.8 5.4 5.4 0 0 0-10.4-1.2 4.5 4.5 0 0 0-.3 9z" stroke-linejoin="round"/>',
  partly: '<circle cx="8.4" cy="8.4" r="2.8"/><path d="M8.4 3.2v1.1M3.2 8.4h1.1M4.7 4.7l.8.8M12.1 4.7l-.8.8"/><path d="M9.5 19.5h8.4a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.8-.9 3.8 3.8 0 0 0 .1 7.5z" stroke-linejoin="round"/>',
  rain: '<path d="M7.2 15h10.3a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10.2-1.1 4.2 4.2 0 0 0-.5 8.3z" stroke-linejoin="round"/><path d="M8.8 18l-.9 2.4M12.8 18l-.9 2.4M16.8 18l-.9 2.4"/>',
  snow: '<path d="M7.2 15h10.3a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10.2-1.1 4.2 4.2 0 0 0-.5 8.3z" stroke-linejoin="round"/><circle cx="8.6" cy="18.6" r=".7" fill="currentColor"/><circle cx="12.2" cy="20.2" r=".7" fill="currentColor"/><circle cx="15.8" cy="18.6" r=".7" fill="currentColor"/>',
  storm: '<path d="M7.2 15h10.3a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10.2-1.1 4.2 4.2 0 0 0-.5 8.3z" stroke-linejoin="round"/><path d="M12.8 15.6l-2 3h3l-2 3" stroke-linejoin="round"/>',
  fog: '<path d="M4 9h16M6 12.5h12M4 16h16"/>',
};

function glyph(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${GLYPHS[name] || GLYPHS.tv}</svg>`;
}

// Outside Electron (design work in a plain browser) fake the bridge.
const api = window.wintv || {
  getState: async () => {
    const cfg = await (await fetch('../apps.default.json')).json();
    const tag = (list, row) => list.map((a) => ({ ...a, row, available: true }));
    // ?lock=1 starts the screen saver after a minute; ?text=large, ?contrast, ?still try the accessibility settings.
    const q = new URLSearchParams(location.search);
    const prefs = { screenSaverMinutes: Number(q.get('lock') || cfg.lockScreen.afterMinutes), screenSaverStyle: q.get('saver') || 'colour',
      askWhoMinutes: cfg.lockScreen.askWhoAfterMinutes, navSounds: 'normal', textSize: q.get('text') || 'default',
      reduceMotion: q.has('still'), highContrast: q.has('contrast') };
    // ?wall=<video url> and ?logos (served at ../logos/<id>.png) try the downloaded art.
    const logo = (list) => list.map((a) => ({ ...a, logo: q.has('logos') && a.logo ? `../logos/${a.id}.png` : null, logoStyle: a.logoStyle || 'icon' }));
    const art = { videos: q.has('wall') ? [{ url: q.get('wall'), title: 'Landwasser Viaduct, Switzerland', artist: 'A videographer', license: 'CC BY-SA 4.0' }] : [] };
    return { apps: logo(tag(cfg.apps, 0)), system: tag(cfg.system, 1), running: ['youtube'], browser: 'brave', user: 'preview',
      profiles: cfg.profiles || [], profile: null, prefs: { ...prefs, weatherPlace: q.has('weather') ? { name: 'Dublin' } : null }, art,
      profileColours: { orange: ['#ff9f0a', '#5a2a00'], green: ['#30d158', '#0b3d1c'], blue: ['#0a84ff', '#06224a'] } };
  },
  weather: async () => ({ ok: true, result: { place: 'Dublin', temp: 9, code: 2, day: true, high: 12, low: 6, unit: '°C' } }),
  places: async (name) => ({ ok: true, result: [{ name, region: 'Leinster, Ireland', latitude: 53.35, longitude: -6.26 }] }),
  keyboard: async () => ({ ok: true }),
  apps: async () => ({ ok: true, result: [
    { id: 'a', name: 'Notepad', icon: null }, { id: 'b', name: 'Terminal', icon: null }, { id: 'c', name: 'Windows PowerShell', icon: null },
    { id: 'd', name: 'VLC media player', icon: null }, { id: 'e', name: 'Steam', icon: null }, { id: 'f', name: 'Task Manager', tool: true, icon: null },
    { id: 'g', name: 'Registry Editor', tool: true, icon: null }, { id: 'h', name: 'Microsoft Store', desktopOnly: true, icon: null }] }),
  device: async () => ({ ok: true }),
  pointer: async () => ({ ok: true }),
  admin: async (op, a) => {
    if (op === 'status') return { ok: true, result: { admin: 'admin', lockedMinutes: 0 } };
    if (op === 'unlock') return a.password === 'admin' ? { ok: true, result: {} } : { ok: false, error: 'That isn\'t the admin password' };
    if (op === 'encryption.get') return { ok: true, result: { state: 'off', percent: 0 } };
    if (op === 'device.rename') return { ok: true, result: { name: 'WINTV', pending: a.name } };
    return { ok: true, result: { name: 'WINTV', pending: null } };
  },
  files: async (op, a) => mockFiles(op, a || {}),
  onDevice: () => {},
  setProfile: async () => ({ ok: true }),
  setPref: async (key, value) => ({ ok: true, result: { ...prefs, [key]: value } }),
  system: async (op) => ({ ok: true, result: MOCK_SYSTEM[op] }),
  updates: async () => ({ ok: true, result: MOCK_UPDATES }),
  launch: async (id) => ({ ok: true, preview: id }),
  quit: async () => ({ ok: true }),
  power: async () => ({ ok: true }),
  onState: () => {},
  onHome: () => {},
  onLock: () => {},
  onPicker: () => {},
  onPrefs: () => {},
  onFiles: () => {},
  onDrives: () => {},
};

// Files in a plain browser: a few folders, a USB stick and a Recycle Bin.
function mockFiles(op, a) {
  const home = 'C:\\Users\\tv\\';
  const item = (name, kind) => ({ name, path: `${a.path}\\${name}`, folder: kind === 'folder', size: 734003200, modified: Date.now(), kind });
  const ok = (result) => ({ ok: true, result });
  if (op === 'places') {
    return ok({ bin: 2, places: [
      { id: 'downloads', name: 'Downloads', glyph: 'download', path: `${home}Downloads` },
      { id: 'videos', name: 'Videos', glyph: 'film', path: `${home}Videos` },
      { id: 'music', name: 'Music', glyph: 'music', path: `${home}Music` },
      { id: 'pictures', name: 'Pictures', glyph: 'photo', path: `${home}Pictures` },
      { id: 'drive:E:\\', name: 'USB drive', letter: 'E:', glyph: 'drive', path: 'E:\\', removable: true }] });
  }
  if (op === 'list') {
    return ok({ path: a.path, removable: a.path.startsWith('E:'), more: false, items: [item('Holidays', 'folder'),
      ...Array.from({ length: 14 }, (_, i) => item(`Episode ${i + 1}.mp4`, 'video')), item('Cover.jpg', 'image'), item('Beach.jpg', 'image'),
      item('Theme.mp3', 'audio'), item('notes.txt', 'other')] });
  }
  if (op === 'bin.list') {
    return ok({ items: [
      { id: 'C:\\$Recycle.Bin\\S-1\\$IAAAAAA.mp4', name: 'Old film.mp4', from: `${home}Videos`, deleted: Date.now() - 864e5, size: 1, folder: false, kind: 'video' },
      { id: 'C:\\$Recycle.Bin\\S-1\\$IBBBBBB', name: 'Trip', from: `${home}Pictures`, deleted: Date.now() - 3 * 864e5, size: 1, folder: true, kind: 'folder' }] });
  }
  if (op === 'thumb') return ok(null);
  if (op === 'media') return ok({ kind: 'image', url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="%23335"/></svg>' });
  if (op === 'trash') return ok({ gone: a.path.startsWith('E:') });
  return ok({});
}

// Sample answers for design work in a plain browser.
const MOCK_SYSTEM = {
  'display.get': { current: { width: 1920, height: 1080, hz: 60 }, modes: [
    { width: 3840, height: 2160, hz: 60 }, { width: 3840, height: 2160, hz: 30 }, { width: 1920, height: 1080, hz: 120 },
    { width: 1920, height: 1080, hz: 60 }, { width: 1280, height: 720, hz: 60 }] },
  'audio.get': { present: true, device: 'LG TV (NVIDIA High Definition Audio)', volume: 40, muted: false, outputs: [
    { id: '{0.0.0.00000000}.{a}', name: 'LG TV (NVIDIA High Definition Audio)', current: true },
    { id: '{0.0.0.00000000}.{b}', name: 'Soundbar (USB Audio)', current: false },
    { id: '{0.0.0.00000000}.{c}', name: 'Headphones (WH-1000XM4)', current: false }] },
  'audio.set': { present: true, device: 'LG TV (NVIDIA High Definition Audio)', volume: 40, muted: false },
  'power.get': { screenOff: 30, sleep: 60 },
  'power.set': { screenOff: 30, sleep: 60 },
  'network.get': { connections: [{ name: 'Ethernet', wifi: false, network: 'Home', internet: true, ipv4: '192.0.2.80', gateway: '192.0.2.1' }] },
  about: { windows: 'Microsoft Windows 11 Pro', version: '25H2 (build 26200.1234)', device: 'WINTV', uptimeMinutes: 1500,
    lastUpdate: new Date(Date.now() - 2 * 86400000).toISOString(), restartNeeded: false },
};

const MOCK_UPDATES = {
  running: '0.2.0', next: '0.2.1', restartPending: true,
  wintv: { state: 'ready', current: '0.2.0', available: '0.2.1', checked: new Date().toISOString() },
  windows: { state: 'idle', checked: new Date().toISOString(), pending: [{ title: '2026-10 Cumulative Update for Windows 11', sizeMB: 812 },
    { title: 'Security Intelligence Update for Microsoft Defender Antivirus', sizeMB: 62 }], rebootRequired: false,
  lastInstall: new Date(Date.now() - 3 * 86400000).toISOString() },
};

const $ = (id) => document.getElementById(id);
let rows = [];            // [[item...], [item...]]
let tiles = [];           // matching elements
let pos = { row: 0, col: 0 };
let running = new Set();
let sheet = null;         // { items:[{label, run}], index, buttons }
let picker = null;        // { index, faces } while "Who's watching?" is up
let profiles = [];
let active = null;        // id of the profile using the TV
let artFlip = false;
let prefs = { screenSaverMinutes: 5, screenSaverStyle: 'colour', askWhoMinutes: 30 }; // the household's WinTV settings (main.js)
let lastInput = Date.now();
let lock = null;          // { since, askWho, timer, tick, spot, hue, flip } while the lock screen is up
let settings = null;      // { section, col: 'side' | 'rows', row, rows, token } while Settings is open
let appVersion = '';

// ------------------------------------------------------------------ sound (tone: prefs.js)
const tick = () => tone(1900, 28, 0.02);
const select = () => { tone(880, 70, 0.035); setTimeout(() => tone(1320, 90, 0.03), 55); };

// ------------------------------------------------------------------ build
function tileFor(item) {
  const b = document.createElement('button');
  b.className = 'tile';
  b.tabIndex = -1;
  b.dataset.id = item.id;
  b.style.setProperty('--c1', item.colors?.[0] || '#444');
  b.style.setProperty('--c2', item.colors?.[1] || '#111');
  if (!item.available) b.classList.add('unavailable');
  b.innerHTML = `
    <div class="card">
      <div class="bg"></div>
      <div class="face">${glyph(item.glyph)}<span class="name"></span></div>
      <div class="sheen"></div>
    </div>
    <div class="label"></div>
    <div class="dot"></div>`;
  // The service's own logo, once the TV has downloaded it (art.js).
  if (item.logo) {
    const img = document.createElement('img');
    img.className = `logo ${item.logoStyle}${item.logoWhite ? ' white' : ''}`;
    img.alt = '';
    img.src = item.logo;
    img.onerror = () => img.replaceWith(document.createRange().createContextualFragment(glyph(item.glyph))); // icon not drawn yet
    b.querySelector('.face svg').replaceWith(img);
  }
  b.querySelector('.name').textContent = item.name;
  b.querySelector('.label').textContent = item.name;
  return b;
}

function build(state) {
  const main = $('rows');
  main.innerHTML = '';
  rows = [state.apps, state.system].filter((r) => r.length);
  tiles = rows.map((items, r) => {
    const row = document.createElement('div');
    row.className = `row ${r === 0 ? 'apps' : 'system'}`;
    const track = document.createElement('div');
    track.className = 'track';
    row.append(track);
    main.append(row);
    return items.map((item, c) => {
      const t = tileFor(item);
      t.addEventListener('mousemove', (e) => pointerOver(e, r, c));
      t.addEventListener('click', () => { setFocus(r, c); activate(); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); setFocus(r, c); openContext(); });
      track.append(t);
      return t;
    });
  });
  running = new Set(state.running || []);
  paintRunning();
}

function paintRunning() {
  rows.forEach((items, r) => items.forEach((item, c) => tiles[r][c].classList.toggle('running', running.has(item.id))));
}

// ------------------------------------------------------------------ focus
const current = () => rows[pos.row]?.[pos.col];
const currentTile = () => tiles[pos.row]?.[pos.col];

function setFocus(r, c, quietly = false) {
  const before = currentTile();
  pos = { row: r, col: c };
  const el = currentTile();
  if (before && before !== el) before.classList.remove('focused');
  el.classList.add('focused');
  scrollRow(r);
  panWall();
  if (before !== el || quietly) showShelf(current());
  if (!quietly && before !== el) tick();
}

function scrollRow(r) {
  const track = tiles[r][0].parentElement;
  const el = tiles[r][pos.col];
  const vw = window.innerWidth;
  const left = el.offsetLeft;
  const margin = vw * 0.06;
  const overflow = left + el.offsetWidth + margin * 2 - vw;
  track.style.transform = `translateX(${-Math.max(0, overflow)}px)`;
}

function showShelf(item) {
  const next = $(artFlip ? 'art-a' : 'art-b');
  const prev = $(artFlip ? 'art-b' : 'art-a');
  artFlip = !artFlip;
  next.style.setProperty('--c1', item.colors?.[0] || '#333');
  next.style.setProperty('--c2', item.colors?.[1] || '#111');
  next.innerHTML = glyph(item.glyph);
  next.classList.add('on');
  prev.classList.remove('on');

  const info = $('info');
  $('eyebrow').textContent = item.eyebrow || '';
  $('title').textContent = item.name;
  $('tagline').textContent = item.available ? (item.tagline || '') : item.reason;
  info.classList.remove('swap');
  void info.offsetWidth; // restart the animation
  info.classList.add('swap');
}

function bump(dir) {
  const el = currentTile();
  el.classList.remove('bump-left', 'bump-right', 'bump-up', 'bump-down');
  void el.offsetWidth;
  el.classList.add(`bump-${dir}`);
}

function move(dx, dy) {
  if (picker) { if (dx) movePicker(dx); return; }
  if (sheet) { if (dy) moveSheet(dy); return; }
  if (viewer) { moveViewer(dx, dy); return; }
  if (files) { moveFiles(dx, dy); return; }
  if (settings) { moveSettings(dx, dy); return; }
  if (allApps) { moveAllApps(dx, dy); return; }
  if (meFocused) { if (dy > 0) focusMe(false); return; }
  if (dy) {
    const r = pos.row + dy;
    if (r < 0 && focusMe(true)) return;
    if (r < 0 || r >= rows.length) return bump(dy < 0 ? 'up' : 'down');
    // Land on the tile whose centre is closest to where the eye already is.
    const from = currentTile().getBoundingClientRect();
    const cx = from.left + from.width / 2;
    let best = 0;
    let bestDist = Infinity;
    tiles[r].forEach((t, c) => {
      const b = t.getBoundingClientRect();
      const d = Math.abs(b.left + b.width / 2 - cx);
      if (d < bestDist) { bestDist = d; best = c; }
    });
    setFocus(r, best);
  } else {
    const c = pos.col + dx;
    if (c < 0 || c >= rows[pos.row].length) return bump(dx < 0 ? 'left' : 'right');
    setFocus(pos.row, c);
  }
}

// ------------------------------------------------------------------ actions
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function activate() {
  if (guide) return closeGuide();
  if (picker) return choosePicker();
  if (sheet) return sheet.items[sheet.index].run();
  if (viewer) return activateViewer();
  if (files) return activateFiles();
  if (settings) return activateSetting();
  if (allApps) return openFromAllApps();
  if (meFocused) { select(); return openProfileMenu(); }
  const item = current();
  const el = currentTile();
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 160);
  if (!item.available) { toast(item.reason); return; }
  select();
  if (item.kind === 'power') return openPower();
  if (item.kind === 'settings') return openSettings();
  if (item.kind === 'allapps') return openAllApps();
  if (item.kind === 'files') return openFiles();
  const res = await api.launch(item.id);
  if (!res.ok) toast(res.error || `Could not open ${item.name}`);
}

// Lists follow the focus with every press, the way TV grids do: the focused
// row stays at one height on the screen (the keyline, a share of the list's
// height from its top) and the list glides under it; at the ends it stops, so
// the title shows again at the top. Not scrollIntoView: "nearest" only moves
// once the focus touches an edge (then leaves it cut off there), and its
// smooth scroll falls behind when presses come quicker than it finishes.
const glides = new WeakMap(); // list -> { at, to, last, raf }
function follow(box, el, keyline) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const max = box.scrollHeight - box.clientHeight;
  const to = Math.min(max, Math.max(0, box.scrollTop + r.top + r.height / 2 - b.top - box.clientTop - box.clientHeight * keyline));
  let g = glides.get(box);
  if (!g) glides.set(box, (g = { at: 0, to: 0, last: 0, raf: 0 }));
  g.to = to;
  if (look.still) { cancelAnimationFrame(g.raf); g.raf = 0; box.scrollTop = to; return; }
  if (g.raf) return; // already gliding: it heads for the new target from where it is
  g.at = box.scrollTop;
  g.last = performance.now();
  const step = (now) => {
    // Time-based, not per frame: a slow frame (software rendering) jumps further.
    const dt = Math.max(0, now - g.last);
    g.last = now;
    g.at += (g.to - g.at) * (1 - Math.exp(-dt / 85)); // eases out, catches up within ~0.3 s
    if (Math.abs(g.to - g.at) < 0.5) g.at = g.to;
    box.scrollTop = g.at;
    g.raf = g.at === g.to ? 0 : requestAnimationFrame(step);
  };
  g.raf = requestAnimationFrame(step);
}

function openSheet(title, items, start = 0) {
  sheet = { items, index: 0, buttons: [] };
  $('sheet-title').textContent = title;
  const box = $('sheet-items');
  box.innerHTML = '';
  sheet.buttons = items.map((it, i) => {
    const b = document.createElement(it.input ? 'input' : 'button');
    b.className = it.input ? 'choice search' : 'choice';
    b.tabIndex = -1;
    if (it.input) Object.assign(b, { type: it.password ? 'password' : 'text', placeholder: it.label, value: it.value || '', spellcheck: false, autocomplete: 'off' });
    else b.textContent = it.label;
    b.addEventListener('mousemove', () => focusSheet(i, true));
    b.addEventListener('click', () => { focusSheet(i, true); it.run(); });
    box.append(b);
    return b;
  });
  focusSheet(Math.max(0, start));
  $('sheet').classList.remove('hidden');
}

function focusSheet(i, byPointer = false) {
  sheet.buttons[sheet.index]?.classList.remove('focused');
  sheet.index = i;
  sheet.buttons[i].classList.add('focused');
  // A text field takes the focus and calls up the TV's keyboard (it types
  // into whatever has the focus, this window included).
  if (sheet.buttons[i].tagName === 'INPUT') { sheet.buttons[i].focus(); $('sheet').classList.add('typing'); api.keyboard(true); } else leaveField();
  // Long lists scroll. Not for the pointer: it is already on the choice, and
  // the list sliding under it would hand the focus on to the next one.
  if (!byPointer) follow($('sheet-items'), sheet.buttons[i], 0.5);
}

function moveSheet(dy) {
  const i = sheet.index + dy;
  if (i < 0 || i >= sheet.items.length) return;
  focusSheet(i);
  tick();
}

function leaveField() {
  $('sheet').classList.remove('typing');
  if (document.activeElement?.tagName !== 'INPUT') return;
  document.activeElement.blur();
  api.keyboard(false);
}

function closeSheet() {
  if (!sheet) return false;
  leaveField();
  sheet = null;
  $('sheet').classList.add('hidden');
  return true;
}

function openPower() {
  const act = (a) => async () => { closeSheet(); const r = await api.power(a); if (!r.ok) toast(r.error); };
  openSheet('Power', [
    { label: 'Sleep', run: act('sleep') },
    { label: 'Restart', run: act('restart') },
    { label: 'Shut Down', run: act('shutdown') },
    ...(profiles.length > 1 ? [{ label: 'Switch Profile', run: () => { closeSheet(); openPicker(); } }] : []),
    { label: 'Cancel', run: closeSheet },
  ]);
}

function openContext() {
  if (viewer) return;
  if (files) return filesMenu();
  if (allApps) return allAppsMenu();
  if (picker || settings) return;
  const item = current();
  if (!item || item.kind === 'power' || item.kind === 'settings') return;
  const items = [{ label: `Open ${item.name}`, run: () => { closeSheet(); activate(); } }];
  if (item.kind === 'start') items.push({ label: 'Unpin from Home', run: () => { closeSheet(); unpin(item.appid); } });
  if (running.has(item.id)) {
    items.push({ label: `Quit ${item.name}`, run: async () => { closeSheet(); await api.quit(item.id); } });
  }
  items.push({ label: 'Cancel', run: closeSheet });
  openSheet(item.name, items);
}

function back() {
  if (guide) { closeGuide(); return; }
  if (picker) { if (active) closePicker(); return; }
  if (closeSheet()) return;
  if (viewer) { closeViewer(); return; }
  if (files) { filesBack(); return; }
  if (allApps) { closeAllApps(); return; }
  if (meFocused) { focusMe(false); return; }
  if (settings) { settingsBack(); return; }
  if (pos.row !== 0 || pos.col !== 0) setFocus(0, 0);
}

// ------------------------------------------------------------------ profiles
// The TV's sign-in screen. Windows signs the tv account in by itself; this is
// where a person says who they are, and each profile keeps its own app logins.
function avatar(p, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.setProperty('--c1', p.colors?.[0] || '#5e5ce6');
  d.style.setProperty('--c2', p.colors?.[1] || '#1c1c40');
  d.textContent = p.guest ? '?' : p.name.trim().charAt(0).toUpperCase();
  return d;
}

function openPicker() {
  closeSheet();
  const box = $('faces');
  box.innerHTML = '';
  const faces = profiles.map((p, i) => {
    const f = document.createElement('button');
    f.className = 'face-btn';
    f.tabIndex = -1;
    f.append(avatar(p, 'avatar'));
    const n = document.createElement('div');
    n.className = 'who-name';
    n.textContent = p.name;
    f.append(n);
    f.addEventListener('mousemove', () => focusPicker(i));
    f.addEventListener('click', () => { focusPicker(i); choosePicker(); });
    box.append(f);
    return f;
  });
  picker = { index: 0, faces };
  focusPicker(Math.max(0, profiles.findIndex((p) => p.id === active)));
  $('picker').classList.remove('hidden');
}

function focusPicker(i) {
  picker.faces[picker.index]?.classList.remove('focused');
  picker.index = i;
  picker.faces[i].classList.add('focused');
}

function movePicker(dx) {
  const i = picker.index + dx;
  if (i < 0 || i >= picker.faces.length) return;
  focusPicker(i);
  tick();
}

async function choosePicker() {
  const p = profiles[picker.index];
  select();
  await api.setProfile(p.id);
  active = p.id;
  closePicker();
}

function closePicker() {
  picker = null;
  $('picker').classList.add('hidden');
  paintMe();
}

function paintMe() {
  const me = $('me');
  me.innerHTML = '';
  const p = profiles.find((x) => x.id === active) || (profiles.length === 1 ? profiles[0] : null);
  if (!p) return;
  me.append(avatar(p, 'avatar mini'));
}

// ------------------------------------------------------------------ All apps (D-37)
// Every app Windows lists for the TV account: programs, Terminal, PowerShell,
// Windows' tools. The older Store apps are shown but can't open on the TV:
// they need Explorer's window host (D-19). Hold OK to pin one to Home.
let allApps = null; // { list, tiles, index } while open

async function openAllApps() {
  allApps = { list: [], tiles: [], index: 0 };
  $('allapps').classList.remove('hidden');
  $('allapps').scrollTop = 0;
  $('aa-groups').innerHTML = '<p class="aa-wait">Finding your apps…</p>';
  const r = await api.apps();
  if (!allApps) return;
  if (!r.ok) { $('aa-groups').innerHTML = ''; toast(r.error || 'Couldn’t list the apps'); return; }
  const byName = (a, b) => a.name.localeCompare(b.name);
  // WinTV's own apps first: the home screen's tiles (streaming, browser…).
  const tvApps = (rows[0] || []).filter((a) => a.kind !== 'start').map((a) => ({ id: a.id, name: a.name, tile: a }));
  const groups = [
    ['TV apps', tvApps],
    ['Apps', r.result.filter((a) => !a.tool && !a.desktopOnly).sort(byName)],
    ['Windows tools', r.result.filter((a) => a.tool && !a.desktopOnly).sort(byName)],
    ['Only on the Windows desktop', r.result.filter((a) => a.desktopOnly).sort(byName)],
  ].filter(([, list]) => list.length);
  const box = $('aa-groups');
  box.innerHTML = '';
  allApps.list = [];
  for (const [title, list] of groups) {
    const h = document.createElement('h3');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'aa-grid';
    box.append(h, grid);
    for (const a of list) {
      const i = allApps.list.length;
      const t = document.createElement('button');
      t.className = `aa-tile${a.desktopOnly ? ' off' : ''}${a.tile ? ' tv' : ''}`;
      t.tabIndex = -1;
      if (a.tile) {
        // A small copy of its home tile: brand colours and logo.
        t.style.setProperty('--c1', a.tile.colors?.[0] || '#333');
        t.style.setProperty('--c2', a.tile.colors?.[1] || '#111');
        // A light tile (YouTube's white) gets a dark label.
        const [r, g, b] = (a.tile.colors?.[0] || '#333').match(/\w\w/g).map((h) => parseInt(h, 16));
        t.classList.toggle('light', 0.299 * r + 0.587 * g + 0.114 * b > 160);
        t.innerHTML = a.tile.logo ? `<img alt="" class="${a.tile.logoStyle}${a.tile.logoWhite ? ' white' : ''}">` : glyph(a.tile.glyph);
        if (a.tile.logo) t.querySelector('img').src = a.tile.logo;
      } else {
        t.innerHTML = a.icon ? '<img alt="">' : glyph('apps');
        if (a.icon) t.querySelector('img').src = a.icon;
      }
      const n = document.createElement('span');
      n.textContent = a.name;
      t.append(n);
      t.addEventListener('mousemove', () => focusAllApps(i, true));
      t.addEventListener('click', () => { focusAllApps(i, true); openFromAllApps(); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); focusAllApps(i, true); allAppsMenu(); });
      grid.append(t);
      allApps.list.push(a);
      allApps.tiles.push(t);
    }
  }
  focusAllApps(0);
}

function closeAllApps() {
  allApps = null;
  $('allapps').classList.add('hidden');
  setFocus(pos.row, pos.col, true);
}

function focusAllApps(i, byPointer = false) {
  if (!allApps.tiles[i]) return;
  allApps.tiles[allApps.index]?.classList.remove('focused');
  allApps.index = i;
  allApps.tiles[i].classList.add('focused');
  if (!byPointer) follow($('allapps'), allApps.tiles[i], 0.42); // as in focusSheet
}

// Arrows go to the nearest tile that way, in grids with headings or uneven
// rows (All apps, Files). -1 if there is none.
function nearestTile(tiles, index, dx, dy) {
  const from = tiles[index]?.getBoundingClientRect();
  if (!from) return -1;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  tiles.forEach((t, i) => {
    if (i === index) return;
    const b = t.getBoundingClientRect();
    const x = b.left + b.width / 2 - cx;
    const y = b.top + b.height / 2 - cy;
    const along = dx ? x * dx : y * dy;          // distance the right way
    const across = Math.abs(dx ? y : x);         // off to the side
    if (along <= 1 || across > (dx ? from.height / 2 : Infinity)) return;
    const score = along + across * 3;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function moveAllApps(dx, dy) {
  const best = nearestTile(allApps.tiles, allApps.index, dx, dy);
  if (best >= 0) { focusAllApps(best); tick(); }
}

async function openFromAllApps() {
  const a = allApps.list[allApps.index];
  if (!a) return;
  if (a.tile) { select(); closeAllApps(); const r = await api.launch(a.id); if (!r.ok) toast(r.error || `Couldn’t open ${a.name}`); return; }
  if (a.desktopOnly) { toast(`${a.name} opens only on the Windows desktop`); return; }
  select();
  const r = await api.launch(`app:${a.id}`);
  if (!r.ok) toast(r.error || `Couldn’t open ${a.name}`);
}

function allAppsMenu() {
  const a = allApps?.list[allApps.index];
  if (!a) return;
  const pinned = (prefs.pins?.[active] || []).some((p) => p.id === a.id);
  if (a.tile) { openSheet(a.name, [{ label: 'Open', run: () => { closeSheet(); openFromAllApps(); } }, { label: 'Cancel', run: closeSheet }]); return; }
  openSheet(a.name, [
    ...(a.desktopOnly ? [] : [{ label: 'Open', run: () => { closeSheet(); openFromAllApps(); } }]),
    ...(a.desktopOnly ? [] : [pinned
      ? { label: 'Unpin from Home', run: () => { closeSheet(); unpin(a.id); } }
      : { label: 'Pin to Home', run: () => { closeSheet(); pin(a); } }]),
    { label: 'Cancel', run: closeSheet },
  ]);
}

// ------------------------------------------------------------------ Files (D-40)
// The TV account's folders, its drives and its Recycle Bin, and a full-screen
// player for what is in them. main.js checks every path sent back.
let files = null; // while open: { places, side, col, place, stack, items, tiles, index, removable, token }
const BIN_PLACE = { id: 'bin', name: 'Recycle Bin', glyph: 'bin' };
const KIND_GLYPH = { folder: 'folder', video: 'film', audio: 'music', image: 'photo', other: 'file' };
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB`
  : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const fmtDay = (ms) => new Date(ms).toLocaleDateString([], new Date(ms).getFullYear() === new Date().getFullYear()
  ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
const lastPart = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const placeName = (p) => (p.letter ? `${p.name} (${p.letter})` : p.count ? `${p.name} · ${p.count}` : p.name);

// `root`: open at that drive (the drive notice's "Open in Files", D-42).
async function openFiles(root = null) {
  files = { places: [], side: 0, col: root ? 'items' : 'side', place: null, stack: [], items: [], tiles: [], index: 0, removable: false, token: 0 };
  $('files').classList.remove('hidden');
  $('fl-items').innerHTML = '';
  $('fl-path').textContent = '';
  const r = await api.files('places');
  if (!files) return;
  if (!r.ok) { toast(r.error || 'Couldn’t open Files'); closeFiles(); return; }
  files.places = [...r.result.places, { ...BIN_PLACE, count: r.result.bin }];
  pickPlace(Math.max(0, files.places.findIndex((p) => p.path === root)));
}

// A drive came or went: the list on the left follows. If the open drive went,
// back to Downloads.
async function refreshPlaces() {
  const r = await api.files('places');
  if (!files || !r.ok) return;
  const was = files.place?.id;
  files.places = [...r.result.places, { ...BIN_PLACE, count: r.result.bin }];
  const i = files.places.findIndex((p) => p.id === was);
  if (i >= 0) { files.side = i; files.place = files.places[i]; paintPlaces(); return; }
  closeViewer();
  files.col = 'side';
  pickPlace(0);
}

function closeFiles() {
  files = null;
  thumbs.queue.length = 0;
  thumbs.seen?.disconnect();
  $('files').classList.add('hidden');
  setFocus(pos.row, pos.col, true);
}

function paintPlaces() {
  const box = $('fl-places');
  box.innerHTML = '';
  files.places.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'set-sec';
    b.tabIndex = -1;
    b.innerHTML = `${glyph(p.glyph)}<span></span>`;
    b.querySelector('span').textContent = placeName(p);
    b.classList.toggle('current', i === files.side);
    b.classList.toggle('focused', files.col === 'side' && i === files.side);
    b.addEventListener('click', () => { leaveItems(); pickPlace(i); });
    box.append(b);
  });
}

function pickPlace(i) {
  if (i < 0 || i >= files.places.length) return;
  files.side = i;
  files.place = files.places[i];
  files.stack = [];
  paintPlaces();
  loadItems(0);
}

// The folder (or the Recycle Bin) on the right; `keep` is the tile to focus.
async function loadItems(keep) {
  const token = ++files.token;
  const p = files.place;
  $('fl-path').textContent = [placeName({ ...p, count: 0 }), ...files.stack.map((s) => s.name)].join('  ›  ');
  $('fl-note').textContent = '';
  const r = p.id === 'bin' ? await api.files('bin.list') : await api.files('list', { path: files.stack.at(-1)?.path || p.path });
  if (!files || token !== files.token) return; // moved on meanwhile
  if (!r.ok) { files.items = []; paintItems(0); $('fl-note').textContent = r.error || 'Couldn’t open this folder'; return; }
  files.removable = !!r.result.removable;
  if (p.id === 'bin') {
    files.items = r.result.items.map((it) => ({ ...it, bin: true }));
    if (files.items.length) files.items.unshift({ action: 'empty', name: 'Empty Recycle Bin', kind: 'empty' });
    p.count = r.result.items.length;
    paintPlaces();
  } else files.items = r.result.items;
  paintItems(Math.max(0, Math.min(keep, files.items.length - 1)));
  if (!files.items.length) $('fl-note').textContent = p.id === 'bin' ? 'The Recycle Bin is empty.' : 'Nothing in here yet.';
  else if (r.result.more) $('fl-note').textContent = 'Only the first 3,000 are shown.';
}

function itemLine(it) {
  if (it.action) return `${files.items.length - 1} in the bin`;
  if (it.bin) return `From ${lastPart(it.from)} · ${fmtDay(it.deleted)}`;
  return it.folder ? 'Folder' : fmtSize(it.size);
}

function paintItems(index) {
  const box = $('fl-items');
  box.innerHTML = '';
  box.scrollTop = 0;
  thumbs.queue.length = 0;
  thumbs.seen?.disconnect();
  // Windows' thumbnails, as tiles come near the screen, a few at a time.
  thumbs.seen = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting) { thumbs.seen.unobserve(e.target); thumbs.queue.push(e.target); }
    pumpThumbs();
  }, { root: box, rootMargin: '50% 0px' });
  const grid = document.createElement('div');
  grid.className = 'fl-grid';
  files.tiles = files.items.map((it, i) => {
    const t = document.createElement('button');
    t.className = `fl-tile ${it.kind}`;
    t.tabIndex = -1;
    t.innerHTML = `<div class="fl-pic">${glyph(it.action ? 'bin' : KIND_GLYPH[it.kind] || 'file')}</div><span class="fl-name"></span><span class="fl-sub"></span>`;
    t.querySelector('.fl-name').textContent = it.name;
    t.querySelector('.fl-sub').textContent = itemLine(it);
    if (!it.bin && (it.kind === 'image' || it.kind === 'video')) t.dataset.thumb = it.path;
    t.addEventListener('mousemove', () => { toItems(); focusFileItem(i, true); });
    t.addEventListener('click', () => { toItems(); focusFileItem(i, true); activateFiles(); });
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); toItems(); focusFileItem(i, true); filesMenu(); });
    grid.append(t);
    return t;
  });
  if (files.tiles.length) box.append(grid); // empty, the note sits right under the heading
  for (const t of files.tiles) if (t.dataset.thumb) thumbs.seen.observe(t);
  files.index = index;
  if (files.col === 'items') {
    if (files.tiles.length) focusFileItem(index);
    else leaveItems();
  }
}

const thumbs = { queue: [], busy: 0, seen: null };
function pumpThumbs() {
  while (thumbs.busy < 3 && thumbs.queue.length) {
    const t = thumbs.queue.shift();
    if (!t.isConnected) continue;
    thumbs.busy += 1;
    api.files('thumb', { path: t.dataset.thumb }).then((r) => {
      if (!r.ok || !r.result || !t.isConnected) return;
      const pic = t.querySelector('.fl-pic');
      pic.style.backgroundImage = `url("${r.result}")`;
      pic.classList.add('shot');
    }).finally(() => { thumbs.busy -= 1; pumpThumbs(); });
  }
}

function focusFileItem(i, byPointer = false) {
  if (!files.tiles[i]) return;
  files.tiles[files.index]?.classList.remove('focused');
  files.index = i;
  files.tiles[i].classList.add('focused');
  if (!byPointer) follow($('fl-items'), files.tiles[i], 0.42); // as in focusSheet
}

function toItems() {
  if (files.col === 'items' || !files.tiles.length) return;
  files.col = 'items';
  paintPlaces();
  focusFileItem(Math.min(files.index, files.tiles.length - 1));
}

function leaveItems() {
  files.tiles[files.index]?.classList.remove('focused');
  files.col = 'side';
  paintPlaces();
}

function moveFiles(dx, dy) {
  if (files.col === 'side') {
    if (dy) { const i = files.side + dy; if (i >= 0 && i < files.places.length) { pickPlace(i); tick(); } }
    else if (dx > 0 && files.tiles.length) { toItems(); tick(); }
    return;
  }
  const best = nearestTile(files.tiles, files.index, dx, dy);
  if (best >= 0) { focusFileItem(best); tick(); } else if (dx < 0) { leaveItems(); tick(); }
}

function activateFiles() {
  if (files.col === 'side') { toItems(); return; }
  const it = files.items[files.index];
  if (!it) return;
  select();
  if (it.action === 'empty') return confirmEmptyBin();
  if (it.bin) return filesMenu();
  if (it.folder) { files.stack.push({ name: it.name, path: it.path, from: files.index }); loadItems(0); return; }
  if (it.kind === 'other') { toast('This kind of file doesn’t open on the TV'); return; }
  openViewer(it);
}

function filesBack() {
  if (files.col === 'items' && files.stack.length) { loadItems(files.stack.pop().from); return; }
  if (files.col === 'items') { leaveItems(); return; }
  closeFiles();
}

// A choice that can't be undone: Cancel has the focus.
function confirmSheet(title, label, run) {
  openSheet(title, [{ label, run: () => { closeSheet(); run(); } }, { label: 'Cancel', run: closeSheet }], 1);
}

function filesMenu() {
  const it = files?.col === 'items' && files.items[files.index];
  if (!it || it.action) return;
  if (it.bin) {
    openSheet(it.name, [
      { label: 'Restore', run: async () => {
        closeSheet();
        const r = await api.files('bin.restore', { id: it.id });
        toast(r.ok ? `${it.name} is back in ${lastPart(it.from)}` : r.error);
        if (files) loadItems(files.index);
      } },
      { label: 'Delete for good', run: () => {
        closeSheet();
        confirmSheet(`Delete “${it.name}” for good?`, 'Delete for good', async () => {
          const r = await api.files('bin.delete', { id: it.id });
          if (!r.ok) toast(r.error);
          if (files) loadItems(files.index);
        });
      } },
      { label: 'Cancel', run: closeSheet },
    ]);
    return;
  }
  openSheet(it.name, [
    ...(it.folder || it.kind !== 'other' ? [{ label: 'Open', run: () => { closeSheet(); activateFiles(); } }] : []),
    files.removable
      ? { label: 'Delete for good', run: () => { closeSheet(); confirmSheet(`Delete “${it.name}” for good? A USB stick has no Recycle Bin.`, 'Delete for good', () => trashFile(it)); } }
      : { label: 'Move to Recycle Bin', run: () => { closeSheet(); trashFile(it); } },
    { label: 'Cancel', run: closeSheet },
  ]);
}

async function trashFile(it) {
  const r = await api.files('trash', { path: it.path });
  if (!r.ok) { toast(r.error || 'Couldn’t delete it'); return; }
  toast(r.result.gone ? `${it.name} is deleted` : `${it.name} is in the Recycle Bin`);
  if (!files) return;
  const bin = files.places.find((p) => p.id === 'bin');
  if (bin && !r.result.gone) bin.count = (bin.count || 0) + 1;
  paintPlaces();
  loadItems(files.index);
}

function confirmEmptyBin() {
  const n = files.items.length - 1;
  confirmSheet(`Delete ${n === 1 ? 'it' : `all ${n}`} for good?`, 'Empty Recycle Bin', async () => {
    const r = await api.files('bin.empty');
    toast(r.ok ? 'The Recycle Bin is empty' : r.error);
    if (files) loadItems(0);
  });
}

// ------------------------------------------------------------------ the player
// Photos (left/right: the next one in the folder), videos and music (OK
// pauses, left/right jump 10 s; music goes on to the next song).
let viewer = null; // { list, at, kind, barTimer, token }
const MEDIA_KEYS = {
  MediaPlayPause: () => activateViewer(), MediaPlay: () => activateViewer(), MediaPause: () => activateViewer(),
  MediaTrackNext: () => viewerTrack(1), MediaTrackPrevious: () => viewerTrack(-1), MediaStop: () => closeViewer(),
};
const fmtTime = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const mm = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

function initViewer() {
  const v = $('vw-video');
  $('vw-art').innerHTML = glyph('music');
  v.addEventListener('timeupdate', paintBar);
  v.addEventListener('loadedmetadata', paintBar);
  v.addEventListener('play', () => showBar());
  v.addEventListener('pause', () => showBar());
  v.addEventListener('ended', () => {
    if (viewer?.kind === 'audio' && viewer.at < viewer.list.length - 1) { viewer.at += 1; showMedia(); } else showBar();
  });
  v.addEventListener('error', () => { if (viewer && v.getAttribute('src')) { toast('This file doesn’t play on the TV'); closeViewer(); } });
  $('vw-img').addEventListener('error', () => { if (viewer && $('vw-img').getAttribute('src')) { toast('This picture doesn’t open on the TV'); closeViewer(); } });
}

function openViewer(it) {
  const same = files.items.filter((x) => !x.folder && !x.bin && x.kind === it.kind);
  viewer = { list: it.kind === 'video' ? [it] : same, at: 0, kind: it.kind, barTimer: 0, token: 0 };
  viewer.at = Math.max(0, viewer.list.indexOf(it));
  $('viewer').dataset.kind = it.kind;
  $('viewer').classList.remove('hidden');
  showMedia();
}

async function showMedia() {
  const it = viewer.list[viewer.at];
  const token = ++viewer.token;
  const r = await api.files('media', { path: it.path });
  if (!viewer || token !== viewer.token) return;
  if (!r.ok) { toast(r.error || 'Couldn’t open it'); closeViewer(); return; }
  const v = $('vw-video');
  const img = $('vw-img');
  $('vw-title').textContent = it.name;
  if (viewer.kind === 'image') {
    img.src = r.result.url;
  } else {
    $('vw-song').textContent = it.name.replace(/\.[^.]+$/, '');
    $('vw-from').textContent = files ? (files.stack.at(-1)?.name || files.place?.name || '') : '';
    v.src = r.result.url;
    v.play().catch(() => {});
  }
  showBar();
}

function paintBar() {
  if (!viewer) return;
  if (viewer.kind === 'image') { $('vw-time').textContent = `${viewer.at + 1} of ${viewer.list.length}`; return; }
  const v = $('vw-video');
  const d = Number.isFinite(v.duration) ? v.duration : 0;
  $('vw-progress').firstElementChild.style.width = d ? `${(v.currentTime / d) * 100}%` : '0%';
  $('vw-time').textContent = d ? `${fmtTime(v.currentTime)} / ${fmtTime(d)}` : fmtTime(v.currentTime);
}

// Shows on any button; while a video plays or a photo is up it fades after
// 3 s. Paused, and for music, it stays.
function showBar() {
  if (!viewer) return;
  const bar = $('vw-bar');
  bar.classList.remove('quiet');
  paintBar();
  clearTimeout(viewer.barTimer);
  const v = $('vw-video');
  if (viewer.kind === 'image' || (viewer.kind === 'video' && !v.paused)) viewer.barTimer = setTimeout(() => bar.classList.add('quiet'), 3000);
}

function moveViewer(dx, dy) {
  if (dy || !dx) { showBar(); return; }
  if (viewer.kind === 'image') {
    const i = viewer.at + dx;
    if (i < 0 || i >= viewer.list.length) { showBar(); return; }
    viewer.at = i;
    tick();
    showMedia();
    return;
  }
  const v = $('vw-video');
  if (Number.isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration - 0.25, v.currentTime + dx * 10));
  showBar();
}

function activateViewer() {
  if (!viewer) return;
  if (viewer.kind === 'image') { showBar(); return; }
  const v = $('vw-video');
  if (v.paused) v.play().catch(() => {}); else v.pause();
}

function viewerTrack(d) {
  const i = viewer.at + d;
  if (viewer.kind === 'video' || i < 0 || i >= viewer.list.length) return;
  viewer.at = i;
  showMedia();
}

function closeViewer() {
  if (!viewer) return;
  clearTimeout(viewer.barTimer);
  viewer = null;
  const v = $('vw-video');
  v.pause();
  v.removeAttribute('src');
  v.load();
  $('vw-img').removeAttribute('src');
  $('viewer').classList.add('hidden');
}


function pin(a) {
  const who = active || profiles[0]?.id;
  const list = prefs.pins?.[who] || [];
  if (list.some((p) => p.id === a.id)) return;
  savePref('pins', { ...(prefs.pins || {}), [who]: [...list, { id: a.id, name: a.name.slice(0, 80) }] });
  toast(`${a.name} is on your Home screen`);
}

function unpin(appId) {
  const who = active || profiles[0]?.id;
  savePref('pins', { ...(prefs.pins || {}), [who]: (prefs.pins?.[who] || []).filter((p) => p.id !== appId) });
}

// ------------------------------------------------------------------ getting around (D-36)
// The first time a kind of device is used (main.js and this page notice),
// a card shows how to get around with it. Settings > Controls shows them
// again, and can turn the automatic cards off.
const GUIDES = {
  keyboard: { name: 'Keyboard', title: 'Using a keyboard', rows: [
    ['← ↑ → ↓', 'Move'], ['Enter', 'Open · hold it for the app menu'], ['Esc', 'Back'],
    ['⊞ Windows key', 'Home screen, from any app'],
    ['Hold ⊞', 'Quick settings: switch apps, address bar, full screen, volume'],
    ['On a Mac', '⌘ is the Windows key']] },
  remote: { name: 'TV remote', title: 'Using a TV remote', rows: [
    ['Arrows · OK', 'Move and open · hold OK for the app menu'], ['Back', 'Back'],
    ['Home', 'Home screen, from any app'],
    ['Hold Home', 'Quick settings: switch apps, address bar, full screen, volume, sleep timer'],
    ['Volume', 'Works over any app']] },
  gamepad: { name: 'Game controller', title: 'Using a game controller', rows: [
    ['Stick · D-pad', 'Move'], ['A', 'Open'], ['B', 'Back'], ['Y · Menu', 'App menu'],
    ['In apps', 'Home is on the remote or the keyboard']] },
  mouse: { name: 'Mouse or air mouse', title: 'Using a mouse or air mouse', rows: [
    ['Point', 'Highlight'], ['Click', 'Open'], ['Right-click', 'App menu'], ['Wheel', 'Move along a row'],
    ['‹ Back', 'Shows at the top left while you use the mouse'],
    ['Browser', 'Opens with its tabs: + for a new one, × to close one']] },
};
let guide = null;            // the kind on screen
const guidesWaiting = new Set();

function maybeGuide(kind) {
  if (!GUIDES[kind] || prefs.tutorialsSeen?.includes(kind) || prefs.tips === false) return;
  if (guide || lock || picker || sheet || !document.hasFocus()) { guidesWaiting.add(kind); return; }
  openGuide(kind);
}

function openGuide(kind) {
  const g = GUIDES[kind];
  guide = kind;
  $('g-title').textContent = g.title;
  const box = $('g-rows');
  box.innerHTML = '';
  for (const [keys, what] of g.rows) {
    const k = document.createElement('kbd');
    k.textContent = keys;
    const w = document.createElement('span');
    w.textContent = what;
    box.append(k, w);
  }
  $('guide').classList.remove('hidden');
}

function closeGuide() {
  const kind = guide;
  guide = null;
  $('guide').classList.add('hidden');
  select();
  if (!prefs.tutorialsSeen?.includes(kind)) savePref('tutorialsSeen', [...(prefs.tutorialsSeen || []), kind]);
  const next = [...guidesWaiting].find((k) => !prefs.tutorialsSeen?.includes(k) && k !== kind);
  guidesWaiting.clear();
  if (next) setTimeout(() => maybeGuide(next), 600);
}

function controlsRows() {
  return [
    { kind: 'toggle', label: 'Tips for new devices', on: prefs.tips !== false, run: (on) => savePref('tips', on) },
    ...Object.entries(GUIDES).map(([kind, g]) => ({ kind: 'action', label: g.name, value: 'Show', press: () => openGuide(kind) })),
  ];
}

// ------------------------------------------------------------------ profile menu
// The avatar at the top is the second way into Settings (WTV-58): Up from
// the apps reaches it, OK opens this profile's menu.
let meFocused = false;
let profileColours = {};

function focusMe(on) {
  if (on && !$('me').childElementCount) return false;
  meFocused = on;
  $('me').classList.toggle('focused', on);
  panWall();
  currentTile()?.classList.toggle('focused', !on);
  tick();
  if (on) {
    const p = me();
    $('eyebrow').textContent = 'Profile';
    $('title').textContent = p?.name || '';
    $('tagline').textContent = 'Switch profile, your name and colour, and all Settings.';
  } else showShelf(current());
  return true;
}

const me = () => profiles.find((x) => x.id === active) || (profiles.length === 1 ? profiles[0] : null);

function openProfileMenu() {
  const p = me();
  if (!p) return;
  const done = (fn) => () => { closeSheet(); focusMe(false); fn(); };
  openSheet(p.name, [
    ...(profiles.length > 1 ? [{ label: 'Switch Profile', run: done(openPicker) }] : []),
    ...(p.guest ? [] : [{ label: 'Rename', run: () => renameProfile(p) }, { label: 'Colour', run: () => recolourProfile(p) }]),
    { label: 'Settings', run: done(openSettings) },
    { label: 'Screen Saver Now', run: done(() => showLock(false)) },
    { label: 'Cancel', run: closeSheet },
  ]);
}

function saveLook(id, change) {
  focusMe(false); // back on the tiles, as after any menu choice
  const looks = { ...(prefs.profileLooks || {}) };
  looks[id] = { ...(looks[id] || {}), ...change };
  return savePref('profileLooks', looks);
}

function renameProfile(p) {
  openSheet('Rename', [
    { input: true, label: 'Name', value: p.name, run: () => {
      const name = sheet.buttons[0].value.trim();
      closeSheet();
      if (name && name !== p.name) saveLook(p.id, { name: name.slice(0, 24) });
    } },
    { label: 'Cancel', run: closeSheet },
  ]);
}

function recolourProfile(p) {
  const names = Object.keys(profileColours);
  openSheet('Colour', [
    ...names.map((c) => ({ label: c.charAt(0).toUpperCase() + c.slice(1), run: () => { closeSheet(); saveLook(p.id, { colour: c }); } })),
    { label: 'Cancel', run: closeSheet },
  ], Math.max(0, names.findIndex((c) => profileColours[c][0] === p.colors?.[0])));
}

// ------------------------------------------------------------------ keys
// Remotes send arrows/Enter/Escape (or BrowserBack); a long Enter press opens
// the app menu, like holding the touch surface on a TV remote.
let enterTimer = 0;
let enterDown = false;      // keyup only counts if the press started here
let enterConsumed = false;
window.addEventListener('keydown', (e) => {
  touched();
  if (wake()) { e.preventDefault(); return; } // the press that wakes the TV does nothing else
  setPointer(false);
  const k = e.key;
  if (guide) {
    if (['Enter', ' ', 'Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(k)) { e.preventDefault(); closeGuide(); }
    return;
  }
  // In a text field, letters, Backspace and left/right edit it; OK submits.
  if (e.target instanceof HTMLInputElement) {
    if (k === 'Enter') { e.preventDefault(); sheet?.items[sheet.index]?.run(); }
    else if (k === 'Escape') { e.preventDefault(); back(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); move(0, k === 'ArrowDown' ? 1 : -1); }
    return;
  }
  // The remote's media keys, while the player is up.
  if (viewer && MEDIA_KEYS[k]) { e.preventDefault(); MEDIA_KEYS[k](); return; }
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[k]) { e.preventDefault(); move(...dirs[k]); return; }
  if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    enterDown = true;
    enterConsumed = false;
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { if (!sheet) { enterConsumed = true; openContext(); } }, 650);
    return;
  }
  if (['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(k)) { e.preventDefault(); back(); return; }
  if (k === 'ContextMenu') { e.preventDefault(); openContext(); }
});
window.addEventListener('keyup', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  clearTimeout(enterTimer);
  if (enterDown && !enterConsumed) activate();
  enterDown = false;
});

// ------------------------------------------------------------------ pointer (air mouse)
const lean = { x: 0, y: 0, tx: 0, ty: 0 };
// Pointer mode: while a mouse or air mouse is in use, Back buttons show on
// screen and Brave opens with its tabs (main.js). Any key ends it.
function setPointer(on) {
  if (document.body.classList.contains('pointer') === on) return;
  document.body.classList.toggle('pointer', on);
  api.pointer(on);
  if (on) maybeGuide('mouse');
}

function pointerOver(e, r, c) {
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) setPointer(true);
  if (sheet) return;
  if (pos.row !== r || pos.col !== c) setFocus(r, c);
  const b = e.currentTarget.getBoundingClientRect();
  lean.tx = ((e.clientX - b.left) / b.width - 0.5) * 2;
  lean.ty = ((e.clientY - b.top) / b.height - 0.5) * 2;
}
window.addEventListener('wheel', (e) => {
  touched();
  if (!wake()) move(Math.sign(e.deltaY || e.deltaX), 0);
}, { passive: true });
window.addEventListener('mousemove', (e) => {
  touched();
  const real = Math.abs(e.movementX) + Math.abs(e.movementY) > 6; // an air mouse jitters a little
  if (lock && real) wake();
  else if (real) setPointer(true);
});
window.addEventListener('mousedown', () => { touched(); wake(); }, true);

// ------------------------------------------------------------------ gamepad
const pad = { held: {}, next: {} };
function padButton(gp, i, t, fn, repeat) {
  const down = gp.buttons[i]?.pressed;
  if (down && !pad.held[i]) { fn(); pad.next[i] = t + 380; }
  else if (down && repeat && t >= pad.next[i]) { fn(); pad.next[i] = t + 110; }
  pad.held[i] = down;
}
function pollPad(t) {
  for (const gp of navigator.getGamepads?.() || []) {
    if (!gp) continue;
    if (!pad.seen) { pad.seen = true; maybeGuide('gamepad'); }
    const [ax = 0, ay = 0, rx = 0, ry = 0] = gp.axes;
    const anything = gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > 0.6);
    if (anything) touched();
    if (anything && wake()) {
      // Count everything held now as already handled, so waking doesn't also click.
      gp.buttons.forEach((b, i) => { pad.held[i] = b.pressed; });
      Object.assign(pad.held, { 100: ay < -0.6, 101: ay > 0.6, 102: ax < -0.6, 103: ax > 0.6 });
      continue;
    }
    // Left stick acts as a d-pad: virtual buttons 100-103.
    const virt = { 100: ay < -0.6, 101: ay > 0.6, 102: ax < -0.6, 103: ax > 0.6 };
    const bt = (i) => (i >= 100 ? { pressed: virt[i] } : gp.buttons[i]);
    const g = { buttons: new Proxy({}, { get: (_o, i) => bt(Number(i)) }) };
    padButton(g, 12, t, () => move(0, -1), true);
    padButton(g, 13, t, () => move(0, 1), true);
    padButton(g, 14, t, () => move(-1, 0), true);
    padButton(g, 15, t, () => move(1, 0), true);
    padButton(g, 100, t, () => move(0, -1), true);
    padButton(g, 101, t, () => move(0, 1), true);
    padButton(g, 102, t, () => move(-1, 0), true);
    padButton(g, 103, t, () => move(1, 0), true);
    padButton(g, 0, t, activate, false);
    padButton(g, 1, t, back, false);
    padButton(g, 3, t, openContext, false);
    padButton(g, 9, t, openContext, false);
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) { lean.tx = rx; lean.ty = ry; }
  }
}

// ------------------------------------------------------------------ motion
// The focused tile leans toward the pointer/stick and sways a little when
// idle; the sheen follows the lean like light on a glossy card. Reduce
// motion holds it still.
function frame(t) {
  pollPad(t);
  const el = currentTile();
  if (el) {
    const m = look.still ? 0 : 1;
    const swayX = Math.sin(t / 1500) * 0.35;
    const swayY = Math.cos(t / 1900) * 0.3;
    lean.x += (lean.tx + swayX - lean.x) * 0.07;
    lean.y += (lean.ty + swayY - lean.y) * 0.07;
    lean.tx *= 0.97;
    lean.ty *= 0.97;
    const s = el.style;
    s.setProperty('--ry', `${(lean.x * 6 * m).toFixed(2)}deg`);
    s.setProperty('--rx', `${(-lean.y * 4.5 * m).toFixed(2)}deg`);
    s.setProperty('--px', `${(lean.x * 0.55 * m).toFixed(3)}vw`);
    s.setProperty('--py', `${(lean.y * 0.45 * m).toFixed(3)}vh`);
    s.setProperty('--sx', `${(50 + lean.x * 40 * m).toFixed(1)}%`);
    s.setProperty('--sy', `${(25 + lean.y * 35 * m).toFixed(1)}%`);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ clock
function clock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  setTimeout(clock, 1000 * (60 - new Date().getSeconds()));
}

// ------------------------------------------------------------------ live wallpaper
// Open-licensed videos from Wikimedia Commons (apps.json "wallpapers";
// art.js downloads them). On the home screen one clip holds still on a
// frame, blurred towards the tiles. As the screen saver it plays, clip after
// clip; the moment someone presses a button it slows to a stop on the frame
// it is showing, and that frame stays as the wallpaper, the way a Mac's
// lock screen does (D-35).
let walls = [];        // [{ url, title, artist, license }]
let wallAt = -1;       // the clip on screen
let wallFlip = false;
let rateRamp = 0;      // the running change of speed (animation frame id)
let clipTimer = 0;     // moves the screen saver on from a long clip
const CLIP_MAX_MS = 3 * 60000;
// Half speed, for a cinematic slow motion: the clips are 60 fps, so this
// still shows 30 new frames a second, each held for exactly two refreshes
// of a 60 Hz TV (any other fraction would hold some frames longer).
const WALL_SPEED = 0.5;

const wallVideo = () => $(wallFlip ? 'wall-b' : 'wall-a'); // the one on screen

function useArt(a) {
  const before = walls[wallAt]?.url;
  walls = a?.videos || [];
  document.body.classList.toggle('has-wall', walls.length > 0);
  panWall();
  const keep = walls.findIndex((w) => w.url === before);
  if (keep >= 0) wallAt = keep;
  else if (walls.length) showWall(Math.floor(Date.now() / 86400000) % walls.length, false); // a different clip each day
}

// Loads a clip into a hidden element and waits until it has a frame to show:
// held a third of the way in, or from the start to play.
function loadClip(video, url, still) {
  return new Promise((resolve, reject) => {
    const done = (ok) => {
      video.onloadeddata = video.onseeked = video.onerror = null;
      if (ok) resolve(); else reject(new Error('cannot play'));
    };
    video.onerror = () => done(false);
    video.onloadeddata = () => {
      if (!still) { done(true); return; }
      video.onseeked = () => done(true);
      video.currentTime = video.duration * 0.33;
    };
    video.src = url;
    video.load();
  });
}

// The blur behind the tiles is drawn once from the held frame, small,
// instead of a live blur filter over the video on every frame.
function blurred(src) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d');
  g.filter = 'blur(9px) saturate(1.25) brightness(.78)';
  const w0 = src.videoWidth || src.naturalWidth;
  const h0 = src.videoHeight || src.naturalHeight;
  const s = Math.max(c.width / w0, c.height / h0) * 1.08;
  g.drawImage(src, (c.width - w0 * s) / 2, (c.height - h0 * s) / 2, w0 * s, h0 * s);
  return c.toDataURL('image/jpeg', 0.85);
}

const paintBlur = (video) => { $('wall-blur').style.backgroundImage = `url("${blurred(video)}")`; };

// A clip that isn't on screen gives its decoder and frame buffers back
// (tens of MB each).
function unloadClip(video) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

// While an app covers the home screen nobody sees the wallpaper: it goes,
// and comes back on the same frame when the home screen does.
let parked = null; // { at, time } while unloaded
function parkWall() {
  const v = wallVideo();
  if (!walls.length || lock || parked || !v.getAttribute('src')) return;
  parked = { at: wallAt, time: v.currentTime };
  // A still of the frame stays as the element's poster, so coming back
  // never shows black while the clip loads again.
  const c = document.createElement('canvas');
  c.width = 1920;
  c.height = 1080;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  v.poster = c.toDataURL('image/jpeg', 0.85);
  unloadClip(v);
}

let parkTimer = 0;
window.addEventListener('blur', () => { clearTimeout(parkTimer); parkTimer = setTimeout(parkWall, 30000); });
window.addEventListener('focus', () => { clearTimeout(parkTimer); unparkWall(); });
async function unparkWall() {
  if (!parked) return;
  const { at, time } = parked;
  parked = null;
  const v = wallVideo();
  try {
    await loadClip(v, walls[at].url, false);
    await new Promise((resolve) => { v.onseeked = () => { v.onseeked = null; resolve(); }; v.currentTime = time; });
  } catch { /* the next screen saver loads a clip anyway */ }
}

async function showWall(i, play) {
  if (!walls.length) return;
  const at = (i + walls.length) % walls.length;
  const next = $(wallFlip ? 'wall-a' : 'wall-b');
  const prev = $(wallFlip ? 'wall-b' : 'wall-a');
  next.removeAttribute('poster');
  try { await loadClip(next, walls[at].url, !play); } catch { return; } // a frame first, so the fade never shows a blank
  wallAt = at;
  wallFlip = !wallFlip;
  next.defaultPlaybackRate = WALL_SPEED;
  next.playbackRate = WALL_SPEED;
  if (play) next.play().catch(() => {});
  next.classList.add('on');
  prev.classList.remove('on');
  setTimeout(() => { if (!prev.classList.contains('on')) unloadClip(prev); }, 2600); // after the crossfade
  if (!play) paintBlur(next);
  const w = walls[at];
  $('lock-credit').textContent = [w.title, `Video: ${w.artist || 'Wikimedia Commons'}`, w.license, 'Wikimedia Commons'].filter(Boolean).join(' · ');
}

// Changes the clip's speed smoothly over about a second and a half.
// Chromium plays no slower than 1/16; below that the clip is paused.
function ramp(video, to, then = () => {}) {
  cancelAnimationFrame(rateRamp);
  const from = video.playbackRate;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 1500);
    const rate = from + (to - from) * k * k * (3 - 2 * k);
    if (k >= 1 || (to === 0 && rate < 0.07)) { if (to > 0) video.playbackRate = to; then(); return; }
    video.playbackRate = Math.max(0.0625, rate);
    rateRamp = requestAnimationFrame(step);
  };
  rateRamp = requestAnimationFrame(step);
}

function keepClipsComing() {
  const v = wallVideo();
  v.onended = nextClip;
  clearTimeout(clipTimer);
  clipTimer = setTimeout(nextClip, CLIP_MAX_MS);
}

async function nextClip() {
  if (!lock?.live) return;
  wallVideo().onended = null;
  await showWall(wallAt + 1, !look.still);
  if (lock?.live) keepClipsComing();
}

// Screen saver on: the held frame comes alive, gathering speed.
async function playWall() {
  if (parked) await unparkWall(); // woken from sleep straight after an app
  if (look.still) { clearTimeout(clipTimer); clipTimer = setTimeout(nextClip, CLIP_MAX_MS); return; } // stills, changing
  const v = wallVideo();
  v.playbackRate = 0.0625;
  v.play().catch(() => {});
  ramp(v, WALL_SPEED);
  keepClipsComing();
}

// A button: the clip slows to a stop where it is, and that frame stays.
function stopWall() {
  clearTimeout(clipTimer);
  const v = wallVideo();
  v.onended = null;
  if (v.paused) return;
  ramp(v, 0, () => { v.pause(); paintBlur(v); });
}

// Parallax: the picture moves a little against the focus, slower than the
// tiles: up to 3.5% sideways from one end of a row to the other, and a
// little up or down with the rows. Reduce motion keeps it still.
function panWall() {
  if (!walls.length) return;
  const items = rows[pos.row] || [];
  const along = items.length > 1 ? pos.col / (items.length - 1) : 0.5;
  const x = look.still ? 0 : (0.5 - along) * 7;
  const y = look.still ? 0 : meFocused ? 1.5 : -1.5 * pos.row;
  $('wall-pan').style.transform = `scale(1.1) translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}%, 0)`;
}

// ------------------------------------------------------------------ weather
// From Open-Meteo for the town chosen in Settings > Screen Saver (main.js
// asks, at most every 15 minutes). WMO weather codes to a picture and a word.
let weather = null;

function sky(code, day) {
  if (code <= 1) return [day ? 'sun' : 'moon', code ? 'Mostly clear' : 'Clear'];
  if (code === 2) return [day ? 'partly' : 'cloud', 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Cloudy'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 51 && code <= 57) return ['rain', 'Drizzle'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', 'Rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Snow'];
  if (code >= 95) return ['storm', 'Thunderstorm'];
  return ['cloud', ''];
}

async function refreshWeather() {
  if (!prefs.weatherPlace) weather = null;
  else {
    const r = await api.weather().catch(() => null);
    if (r?.ok) weather = r.result; // a failed fetch keeps the last reading
  }
  paintWeather();
}

function paintWeather() {
  const top = $('weather');
  const low = $('lock-weather');
  top.innerHTML = '';
  low.innerHTML = '';
  if (!weather) return;
  const [pic, word] = sky(weather.code, weather.day);
  top.innerHTML = glyph(pic);
  top.append(`${weather.temp}°`);
  low.innerHTML = glyph(pic);
  low.append([`${weather.temp}°`, word, `H ${weather.high}° L ${weather.low}°`, weather.place].filter(Boolean).join(' · '));
}

// ------------------------------------------------------------------ settings
// WinTV's own Settings, in place of Windows' Settings app (which needs
// Explorer, and the TV account has none). Big rows a remote can drive.
// Every change goes through window.wintv.system(), which main.js checks.
const SECTIONS = [
  { id: 'display', name: 'Display', glyph: 'tv' },
  { id: 'sound', name: 'Sound', glyph: 'sound' },
  { id: 'saver', name: 'Screen Saver', glyph: 'moon' },
  { id: 'access', name: 'Accessibility', glyph: 'access' },
  { id: 'controls', name: 'Controls', glyph: 'gamepad' },
  { id: 'network', name: 'Network', glyph: 'globe' },
  { id: 'updates', name: 'Updates', glyph: 'update' },
  { id: 'admin', name: 'Admin', glyph: 'lock' },
  { id: 'about', name: 'About', glyph: 'info' },
];
const KEEP_SECONDS = 15;

// The line under each section. Set once the section's rows have arrived, so
// a slow answer from Windows can't put one section's note under another.
const NOTES = {
  display: () => 'If the edges of the picture are cut off, turn on your TV’s “Just Scan”, “Screen Fit” or “Full Pixel” picture size.',
  saver: () => 'The screen saver comes on over the home screen only: a film keeps the TV awake. '
    + 'The live wallpapers are open-licensed videos from Wikimedia Commons; the weather comes from Open-Meteo. '
    + 'Turning off the screen and sleep apply while the PC is plugged in.',
  access: () => 'Text size and high contrast change WinTV’s own screens, over every app too. '
    + 'Reduce motion also asks apps and websites to keep still.',
  controls: () => 'The first time you use a keyboard, a remote, a controller or a mouse, WinTV shows how to get around with it. '
    + 'Turn the tips off here, or show any of them again.',
  updates: () => 'Windows installs its updates by itself too; “Install now” only does it sooner. '
    + 'WinTV updates are checked every day, and switch in when no app is open.',
  admin: () => (adminOpen
    ? 'Unlocked until you leave Settings, or for 10 minutes without a change. Windows desktop opens Windows’ sign-in screen '
      + 'for the admin, for repairs WinTV’s own screens can’t do yet; signing out there brings the TV back.'
    : 'Changes to the PC itself, for whoever knows the admin password. Windows checks the password; WinTV doesn’t keep it.'),
};

function openSettings() {
  closeSheet();
  settings = { section: 0, col: 'side', row: 0, rows: [], token: 0 };
  $('settings').classList.remove('hidden');
  paintSections();
  loadSection();
}

function closeSettings() {
  clearInterval(updatesPoll);
  settings = null;
  if (adminOpen) { adminOpen = false; api.admin('lock'); }
  $('settings').classList.add('hidden');
  setFocus(pos.row, pos.col, true);
}

function settingsBack() {
  if (settings.col === 'rows') { settings.col = 'side'; paintSections(); paintRows(); tick(); return; }
  closeSettings();
}

function paintSections() {
  const box = $('set-sections');
  box.innerHTML = '';
  SECTIONS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'set-sec';
    b.tabIndex = -1;
    b.innerHTML = `${glyph(s.glyph)}<span></span>`;
    b.querySelector('span').textContent = s.name;
    b.classList.toggle('current', i === settings.section);
    b.classList.toggle('focused', settings.col === 'side' && i === settings.section);
    b.addEventListener('click', () => { settings.col = 'side'; pickSection(i); });
    box.append(b);
  });
}

function pickSection(i) {
  if (i < 0 || i >= SECTIONS.length) return;
  if (i !== settings.section) { settings.section = i; settings.row = 0; tick(); loadSection(); }
  paintSections();
}

async function loadSection() {
  const s = SECTIONS[settings.section];
  clearInterval(updatesPoll);
  if (s.id === 'updates') updatesPoll = setInterval(refreshSection, 2000); // progress moves while you look
  const token = ++settings.token;
  $('set-heading').textContent = s.name;
  $('set-note').textContent = '';
  settings.rows = [{ kind: 'info', label: 'Loading…', value: '' }];
  paintRows();
  let rows;
  try { rows = await sectionRows(s.id); } catch (e) { rows = [{ kind: 'info', label: 'Not available', value: e.message }]; }
  if (!settings || token !== settings.token) return; // moved on meanwhile
  settings.rows = rows;
  settings.row = Math.min(settings.row, rows.length - 1);
  $('set-note').textContent = NOTES[s.id]?.() || '';
  paintRows();
}

// Re-reads the section without the "Loading…" flash and keeps the focus.
async function refreshSection() {
  if (!settings) return;
  const s = SECTIONS[settings.section];
  const token = settings.token;
  let rows;
  try { rows = await sectionRows(s.id); } catch { return; }
  if (!settings || token !== settings.token || sheet) return;
  settings.rows = rows;
  settings.row = Math.min(settings.row, rows.length - 1);
  $('set-note').textContent = NOTES[s.id]?.() || '';
  paintRows();
}

function paintRows() {
  const box = $('set-rows');
  box.innerHTML = '';
  settings.rows.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = `set-row ${r.kind}`;
    b.tabIndex = -1;
    b.innerHTML = '<span class="set-label"></span><span class="set-value"></span>';
    b.querySelector('.set-label').textContent = r.label;
    const v = b.querySelector('.set-value');
    if (r.kind === 'slider') {
      v.innerHTML = '<span class="bar"><span class="fill"></span></span><span class="num"></span>';
      v.querySelector('.fill').style.width = `${r.value}%`;
      v.querySelector('.num').textContent = r.value;
    } else if (r.kind === 'toggle') {
      v.textContent = r.on ? 'On' : 'Off';
    } else {
      v.textContent = r.value ?? '';
    }
    b.classList.toggle('focused', settings.col === 'rows' && i === settings.row);
    b.addEventListener('click', () => { settings.col = 'rows'; settings.row = i; paintSections(); paintRows(); activateSetting(); });
    box.append(b);
  });
}

function moveSettings(dx, dy) {
  if (settings.col === 'side') {
    if (dy) pickSection(settings.section + dy);
    else if (dx > 0) { settings.col = 'rows'; paintSections(); paintRows(); tick(); }
    return;
  }
  const r = settings.rows[settings.row];
  if (dx && r?.kind === 'slider') { r.set(Math.max(0, Math.min(100, r.value + dx * (r.step || 5)))); paintRows(); tick(); return; }
  if (dx < 0) { settingsBack(); return; }
  if (dy) {
    const i = settings.row + dy;
    if (i < 0 || i >= settings.rows.length) return;
    settings.row = i;
    paintRows();
    tick();
  }
}

async function activateSetting() {
  if (settings.col === 'side') { settings.col = 'rows'; paintSections(); paintRows(); return; }
  const r = settings.rows[settings.row];
  if (!r) return;
  if (r.kind === 'choice') {
    openSheet(r.label, [...r.options.map((o) => ({ label: o.label, run: () => { closeSheet(); o.run(); } })),
      { label: 'Cancel', run: closeSheet }], r.options.findIndex((o) => o.current));
  } else if (r.kind === 'toggle') {
    r.on = !r.on;
    paintRows();
    await r.run(r.on);
  } else if (r.press) {
    r.press();
  }
}

function result(r) {
  if (!r.ok) throw new Error(r.error || 'Windows did not answer');
  return r.result;
}

async function sectionRows(id) {
  if (id === 'display') return displayRows(result(await api.system('display.get')));
  if (id === 'sound') return soundRows(result(await api.system('audio.get')));
  if (id === 'saver') return saverRows(result(await api.system('power.get')));
  if (id === 'access') return accessRows();
  if (id === 'controls') return controlsRows();
  if (id === 'network') return networkRows(result(await api.system('network.get')));
  if (id === 'updates') return updateRows(result(await api.updates('get')));
  if (id === 'admin') return adminRows();
  return aboutRows(result(await api.system('about')));
}

const fmtMode = (m) => `${m.width} × ${m.height}`;

function displayRows({ current, modes }) {
  if (!current) return [{ kind: 'info', label: 'Picture', value: 'No display found' }];
  // Below 1280 × 720 nothing is readable on a TV, so those sizes aren't offered.
  const sizes = [];
  for (const m of modes) {
    if (m.width < 1280 || m.height < 720) continue;
    if (!sizes.some((s) => s.width === m.width && s.height === m.height)) sizes.push(m);
  }
  const rates = modes.filter((m) => m.width === current.width && m.height === current.height);
  // A new size keeps the current refresh rate if the TV offers it there, else
  // 60 Hz, else the highest it has.
  const rateFor = (w, h) => {
    const at = modes.filter((m) => m.width === w && m.height === h);
    return at.find((m) => m.hz === current.hz) || at.find((m) => m.hz === 60) || at[0];
  };
  return [
    { kind: 'choice', label: 'Resolution', value: fmtMode(current),
      options: sizes.map((s) => {
        const on = s.width === current.width && s.height === current.height;
        return { label: fmtMode(s) + (on ? '  ✓' : ''), current: on, run: () => changeMode(rateFor(s.width, s.height), current) };
      }) },
    { kind: 'choice', label: 'Refresh rate', value: `${current.hz} Hz`,
      options: rates.map((m) => ({ label: `${m.hz} Hz${m.hz === current.hz ? '  ✓' : ''}`, current: m.hz === current.hz, run: () => changeMode(m, current) })) },
  ];
}

// Like a TV: a new picture mode must be confirmed, or it goes back by itself.
// A mode the TV can't show would otherwise leave a black screen for good.
async function changeMode(next, prev) {
  if (next.width === prev.width && next.height === prev.height && next.hz === prev.hz) return;
  const r = await api.system('display.set', next);
  if (!r.ok || r.result.code !== 0) { toast('The TV didn’t accept that picture mode'); return; }
  let left = KEEP_SECONDS;
  const title = () => `Keep this picture? Going back in ${left} s`;
  const undo = async () => {
    clearInterval(timer);
    closeSheet();
    await api.system('display.set', prev);
    if (settings) loadSection();
  };
  openSheet(title(), [
    { label: 'Keep', run: () => { clearInterval(timer); closeSheet(); if (settings) loadSection(); } },
    { label: 'Go Back', run: undo },
  ]);
  const mine = sheet;
  const timer = setInterval(() => {
    if (sheet !== mine) { clearInterval(timer); return; }
    left -= 1;
    if (left <= 0) { undo(); return; }
    $('sheet-title').textContent = title();
  }, 1000);
}

// A row whose choices are a fixed list of values; show(value) is its text.
function pick(label, value, values, show, run) {
  return { kind: 'choice', label, value: show(value),
    options: values.map((v) => ({ label: show(v) + (v === value ? '  ✓' : ''), current: v === value, run: () => run(v) })) };
}

const minutes = (m) => (m === 0 ? 'Never' : m < 60 ? `After ${m} min` : `After ${m / 60} h`);

// WinTV's own settings (main.js keeps them, D-31).
async function savePref(key, value) {
  const r = await api.setPref(key, value);
  if (!r.ok) { toast(r.error || 'Couldn’t change that'); refreshSection(); return; }
  usePrefs(r.result);
  if (key === 'navSounds') select(); // hear the new level
  refreshSection();
}

function usePrefs(p) {
  if (!p) return;
  const moved = JSON.stringify(p.weatherPlace ?? null) !== JSON.stringify(prefs.weatherPlace ?? null);
  prefs = p;
  applyLook(p);
  panWall(); // reduce motion re-centres the picture
  $('lock').classList.toggle('dark', p.screenSaverStyle === 'dark');
  if (moved) refreshWeather();
}

let volTimer = 0;
function soundRows(a) {
  const nav = pick('Navigation sounds', prefs.navSounds, ['off', 'soft', 'normal', 'loud'],
    (v) => v.charAt(0).toUpperCase() + v.slice(1), (v) => savePref('navSounds', v));
  if (!a.present) return [{ kind: 'info', label: 'Sound', value: 'No sound output found' }, nav];
  const volume = {
    kind: 'slider', label: 'Volume', value: a.volume, step: 5,
    set(v) {
      volume.value = v;
      clearTimeout(volTimer); // send once the remote stops, not on every press
      volTimer = setTimeout(() => api.system('audio.set', { volume: v }), 150);
    },
  };
  return [
    volume,
    { kind: 'toggle', label: 'Mute', on: a.muted, run: (on) => api.system('audio.set', { muted: on }) },
    outputRow(a),
    nav,
  ];
}

// Where the sound goes (D-43): the TV over HDMI, a soundbar, headphones. A
// choice once there is more than one; Windows' own default for everything.
function outputRow(a) {
  // Two outputs can carry the same name (two HDMI ports on one graphics
  // card): number the second the way Windows' own lists do.
  const seen = {};
  const outs = (a.outputs || []).map((o) => {
    seen[o.name] = (seen[o.name] || 0) + 1;
    return { ...o, name: seen[o.name] > 1 ? `${o.name} ${seen[o.name]}` : o.name };
  });
  if (outs.length < 2) return { kind: 'info', label: 'Output', value: a.device };
  return { kind: 'choice', label: 'Output', value: outs.find((o) => o.current)?.name || a.device,
    options: outs.map((o) => ({ label: o.name + (o.current ? '  ✓' : ''), current: o.current, run: () => setOutput(o) })) };
}

async function setOutput(o) {
  const r = await api.system('audio.set', { output: o.id });
  toast(r.ok ? `Sound now plays on ${o.name}` : r.error || 'Windows didn’t switch');
  refreshSection();
}

// The screen saver is WinTV's (the clock screen, below); turning the screen
// off and sleep are Windows' power plan, which this account may change.
function saverRows(power) {
  const rows = [
    pick('Screen saver', prefs.screenSaverMinutes, [2, 5, 10, 15, 30, 0], minutes, (v) => savePref('screenSaverMinutes', v)),
    pick('Style', prefs.screenSaverStyle, Object.keys(SAVER_STYLES), (v) => SAVER_STYLES[v], (v) => savePref('screenSaverStyle', v)),
    { kind: 'action', label: 'Weather', value: prefs.weatherPlace?.name || 'Off', press: chooseWeather },
  ];
  if (profiles.length > 1) {
    rows.push(pick('Ask who’s watching', prefs.askWhoMinutes, [15, 30, 60, 120, 0], (m) => (m ? `${minutes(m)} away` : 'Never'),
      (v) => savePref('askWhoMinutes', v)));
  }
  rows.push(
    pick('Turn off the screen', power.screenOff, [5, 10, 15, 30, 60, 120, 0], minutes, (v) => setPower({ screenOff: v })),
    pick('Sleep', power.sleep, [15, 30, 60, 120, 240, 0], minutes, (v) => setPower({ sleep: v })),
  );
  return rows;
}

const SAVER_STYLES = { live: 'Live wallpapers', colour: 'Clock on colour', dark: 'Clock on black' };

// The weather's town: typed with the TV's keyboard (or a real one) and
// looked up with Open-Meteo's town search.
function chooseWeather() {
  openSheet('Weather for which town?', [
    { input: true, label: 'Town', run: searchWeather },
    ...(prefs.weatherPlace ? [{ label: 'Turn off weather', run: () => { closeSheet(); savePref('weatherPlace', null); } }] : []),
    { label: 'Cancel', run: closeSheet },
  ]);
}

async function searchWeather() {
  const name = sheet?.buttons[0]?.value?.trim();
  if (!name) return;
  leaveField();
  const r = await api.places(name);
  if (!r.ok) { toast(r.error || 'Couldn’t search right now'); return; }
  if (!r.result.length) { toast(`No town called “${name}”`); return; }
  openSheet('Which one?', [
    ...r.result.map((p) => ({ label: p.region ? `${p.name} · ${p.region}` : p.name,
      run: () => { closeSheet(); savePref('weatherPlace', { name: p.name, latitude: p.latitude, longitude: p.longitude }); } })),
    { label: 'Cancel', run: closeSheet },
  ]);
}

async function setPower(change) {
  const r = await api.system('power.set', change);
  if (!r.ok) toast(r.error || 'Windows didn’t accept that');
  refreshSection();
}

function accessRows() {
  return [
    pick('Text size', prefs.textSize, ['default', 'large', 'larger'], (v) => v.charAt(0).toUpperCase() + v.slice(1),
      (v) => savePref('textSize', v)),
    { kind: 'toggle', label: 'Reduce motion', on: prefs.reduceMotion, run: (on) => savePref('reduceMotion', on) },
    { kind: 'toggle', label: 'High contrast', on: prefs.highContrast, run: (on) => savePref('highContrast', on) },
  ];
}

function networkRows({ connections }) {
  const list = connections || [];
  if (!list.length) return [{ kind: 'info', label: 'Not connected', value: 'Plug in a network cable' }];
  return list.flatMap((c) => [
    { kind: 'info', label: c.wifi ? 'Wi-Fi' : 'Ethernet', value: c.network || c.name },
    { kind: 'info', label: 'Internet', value: c.internet ? 'Connected' : 'No internet' },
    { kind: 'info', label: 'IP address', value: c.ipv4 || '—' },
  ]);
}

// Admin (D-39): jobs on the PC itself, behind the admin password. A SYSTEM
// helper does them; main.js keeps the key it hands out, so this screen only
// knows whether the section is unlocked. The Windows desktop (the repair
// mode of D-22) is here too, now that something locks it.
let adminOpen = false;
const ENCRYPTION = {
  off: 'Off', on: 'On', suspended: 'Paused', unavailable: 'Not in this Windows edition', other: 'Unknown',
  encrypting: (e) => `Encrypting · ${e.percent}%`, decrypting: (e) => `Decrypting · ${e.percent}%`,
};

async function adminRows() {
  if (!adminOpen) {
    const s = result(await api.admin('status'));
    return [{ kind: 'action', label: 'Unlock', value: s.lockedMinutes ? `Wait ${s.lockedMinutes} min` : 'Admin password', press: askAdminPassword }];
  }
  const [dev, enc] = await Promise.all([api.admin('device.get'), api.admin('encryption.get')]);
  if (dev.locked || enc.locked) { adminOpen = false; return adminRows(); }
  const d = result(dev);
  const e = result(enc);
  const crypt = ENCRYPTION[e.state] ?? e.state;
  return [
    { kind: 'action', label: 'Device name', value: d.pending ? `${d.pending} after a restart` : d.name, press: () => renameDevice(d) },
    { kind: 'info', label: 'Disk encryption', value: typeof crypt === 'function' ? crypt(e) : crypt },
    { kind: 'choice', label: 'Windows desktop', value: 'For repairs', options: [{ label: 'Sign in as admin', run: signInAsAdmin }] },
    { kind: 'action', label: 'Lock', value: '', press: lockAdmin },
  ];
}

// Windows' sign-in screen, for the admin. Settings closes first, which locks
// Admin: signing out of the desktop brings the TV back to the home screen
// (BackToTV, D-41).
async function signInAsAdmin() {
  closeSettings();
  const r = await api.power('switch-user');
  if (!r.ok) toast(r.error);
}

function askAdminPassword() {
  openSheet('Admin password', [
    { input: true, password: true, label: 'Password', run: async () => {
      const field = sheet?.buttons[0];
      const password = field?.value || '';
      if (!password) return;
      field.value = '';
      closeSheet();
      const r = await api.admin('unlock', { password });
      if (!r.ok) { toast(r.error || 'Couldn’t unlock'); if (settings) refreshSection(); return; }
      adminOpen = true;
      if (settings) loadSection();
    } },
    { label: 'Cancel', run: closeSheet },
  ]);
}

function relocked(r) {
  if (!r.locked) return false;
  adminOpen = false;
  toast('Admin locked itself again');
  if (settings) loadSection();
  return true;
}

function renameDevice(d) {
  const now = d.pending || d.name;
  openSheet('Device name', [
    { input: true, label: 'Name', value: now, run: async () => {
      const name = sheet?.buttons[0]?.value.trim() || '';
      closeSheet();
      if (!name || name.toUpperCase() === now.toUpperCase()) return; // Windows keeps PC names in capitals
      const r = await api.admin('device.rename', { name });
      if (relocked(r)) return;
      if (!r.ok) toast(r.error);
      else toast(r.result.pending ? `The TV is called ${r.result.pending} after its next restart` : `The TV keeps the name ${r.result.name}`);
      refreshSection();
    } },
    { label: 'Cancel', run: closeSheet },
  ]);
}

async function lockAdmin() {
  adminOpen = false;
  await api.admin('lock');
  loadSection();
}

function aboutRows(a) {
  const hours = Math.floor(a.uptimeMinutes / 60);
  const rows = [
    { kind: 'info', label: 'WinTV', value: appVersion },
    { kind: 'info', label: 'Windows', value: `${a.windows.replace(/^Microsoft /, '')} ${a.version}` },
    { kind: 'info', label: 'Device name', value: a.device },
    { kind: 'info', label: 'Last update', value: a.lastUpdate ? new Date(a.lastUpdate).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not yet' },
    { kind: 'info', label: 'On for', value: hours >= 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${hours} h ${a.uptimeMinutes % 60} min` },
  ];
  return rows;
}

// Updates: WinTV's own (signed releases) and Windows', side by side. Both
// run as SYSTEM tasks this screen may only start (D-27, D-28).
let updatesPoll = 0;
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'long' });
};

async function startUpdate(job, note) {
  const r = await api.updates('run', job);
  toast(r.ok ? note : r.error);
  setTimeout(refreshSection, 800);
}

function wintvStatus(u) {
  const w = u.wintv || {};
  if (u.restartPending) return `${u.next} is installed and starts when nobody is watching`;
  if (w.state === 'checking') return 'Checking…';
  if (w.state === 'downloading') return `Downloading ${w.available}…`;
  if (w.state === 'installing') return `Installing ${w.available}…`;
  if (w.state === 'failed') return `Couldn’t update: ${w.error || 'unknown error'}`;
  if (w.state === 'up-to-date') return `Up to date · checked ${when(w.checked || w.updated)}`;
  return 'Not checked yet';
}

function windowsStatus(w) {
  if (!w) return 'Not checked yet';
  if (w.state === 'checking') return 'Checking…';
  if (w.state === 'downloading') return `Downloading ${w.step} of ${w.total}…`;
  if (w.state === 'installing') return `Installing ${w.step} of ${w.total}…`;
  if (w.state === 'failed') return w.error ? `Couldn’t update: ${w.error}` : `${w.failedTitles?.length || 1} update(s) failed`;
  if (w.rebootRequired) return 'Restart to finish';
  const n = w.pending?.length || 0;
  return n ? `${n} update${n > 1 ? 's' : ''} ready to install` : `Up to date · checked ${when(w.checked)}`;
}

function updateRows(u) {
  const busy = (s) => ['checking', 'downloading', 'installing'].includes(s?.state);
  const w = u.windows;
  const rows = [{ kind: 'info', label: `WinTV ${u.running}`, value: wintvStatus(u) }];
  if (u.restartPending) {
    rows.push({ kind: 'choice', label: `Start WinTV ${u.next} now`, value: '', options: [
      { label: 'Restart WinTV', run: async () => { const r = await api.updates('restart'); if (!r.ok) toast(r.error); } }] });
  } else if (!busy(u.wintv)) {
    rows.push({ kind: 'action', label: 'Check for WinTV updates', value: '', press: () => startUpdate('wintv', 'Checking for WinTV updates') });
  }
  rows.push({ kind: 'info', label: 'Windows', value: windowsStatus(w) });
  if (w?.rebootRequired && !busy(w)) {
    rows.push({ kind: 'choice', label: 'Restart to finish', value: '', options: [
      { label: 'Restart Now', run: async () => { const r = await api.power('restart'); if (!r.ok) toast(r.error); } }] });
  } else if (w?.pending?.length && !busy(w)) {
    rows.push({ kind: 'action', label: 'Install Windows updates now', value: `${w.pending.reduce((a, p) => a + (p.sizeMB || 0), 0)} MB`,
      press: () => startUpdate('windows-install', 'Installing Windows updates. Keep watching, it runs in the background') });
  }
  if (!busy(w)) rows.push({ kind: 'action', label: 'Check for Windows updates', value: '', press: () => startUpdate('windows-check', 'Checking for Windows updates') });
  if (w?.lastInstall) rows.push({ kind: 'info', label: 'Last Windows update', value: when(w.lastInstall) });
  return rows;
}

// ------------------------------------------------------------------ lock screen
// The TV's lock screen. After a few idle minutes on the home screen, or when
// the PC wakes from sleep, it shows a big clock over drifting colour. Any
// button wakes it. After a long absence, and after sleep, waking asks who is
// watching, the way a streaming box does.
function touched() { lastInput = Date.now(); }

function showLock(askWho = false) {
  if (lock) { lock.askWho ||= askWho; return; }
  closeSheet();
  // "Live wallpapers": the home screen's own wallpaper comes alive (D-35).
  const live = prefs.screenSaverStyle === 'live' && walls.length > 0;
  lock = { since: Date.now(), askWho, timer: 0, tick: 0, spot: 0, hue: 0, flip: false, live };
  const el = $('lock');
  el.dataset.spot = '0';
  el.classList.toggle('live', live);
  if (live) { document.body.classList.add('saver'); playWall(); }
  paintLock();
  el.classList.remove('hidden');
  const hint = $('lock-hint');
  hint.style.animation = 'none';
  void hint.offsetWidth; // restart the "Press any button" fade
  hint.style.animation = '';
}

function paintLock() {
  if (!lock) return;
  const now = new Date();
  $('lock-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('lock-date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  // Colour: the home screen's apps, one after another, crossfading.
  const palette = lock.live ? [] : rows.flat().filter((a) => a.colors?.length);
  if (palette.length) {
    const it = palette[lock.hue++ % palette.length];
    const next = $(lock.flip ? 'lock-a' : 'lock-b');
    const prev = $(lock.flip ? 'lock-b' : 'lock-a');
    next.style.setProperty('--c1', it.colors[0]);
    next.style.setProperty('--c2', it.colors[1] || '#111');
    next.classList.add('on');
    prev.classList.remove('on');
    lock.flip = !lock.flip;
  }
  // Every second minute the clock fades out and comes back in another corner.
  if (lock.tick++ % 2 === 1) {
    const clockEl = $('lock-clock');
    clockEl.classList.add('moving');
    setTimeout(() => {
      if (!lock) return;
      lock.spot = (lock.spot + 1) % 4;
      $('lock').dataset.spot = String(lock.spot);
      clockEl.classList.remove('moving');
    }, 1300);
  }
  lock.timer = setTimeout(paintLock, 1000 * (60 - now.getSeconds()));
}

// Returns true if the lock screen was up (the caller then ignores the input).
function wake() {
  if (!lock) return false;
  clearTimeout(lock.timer);
  const askWho = prefs.askWhoMinutes > 0 && (lock.askWho || Date.now() - lock.since > prefs.askWhoMinutes * 60000);
  lock = null;
  touched();
  $('lock').classList.add('hidden');
  if (document.body.classList.contains('saver')) {
    document.body.classList.remove('saver'); // the blur and the tiles come back
    stopWall();
  }
  $('lock-clock').classList.remove('moving');
  if (askWho && profiles.length > 1) openPicker();
  return true;
}

function watchIdle() {
  setInterval(() => {
    if (lock || !(prefs.screenSaverMinutes > 0)) return;
    if (viewer) { touched(); return; } // watching something from Files
    // An app in front means someone is watching, not idling on the home screen.
    if (!document.hasFocus()) { touched(); return; }
    if (Date.now() - lastInput > prefs.screenSaverMinutes * 60000) showLock(false);
  }, 2000);
}

// ------------------------------------------------------------------ start
(async function start() {
  const state = await api.getState();
  profiles = state.profiles || [];
  profileColours = state.profileColours || {};
  $('me').addEventListener('click', () => { focusMe(true); openProfileMenu(); });
  active = state.profile;
  usePrefs(state.prefs);
  useArt(state.art);
  setInterval(refreshWeather, 10 * 60000);
  appVersion = state.version || '';
  build(state);
  setFocus(0, 0, true);
  initViewer();
  api.onState((s) => {
    if (s.art) useArt(s.art);
    if (s.profiles) { profiles = s.profiles; paintMe(); if (meFocused) focusMe(true); }
    // New tiles arrive when a Store app was installed or removed, or a logo was downloaded.
    if (s.apps) {
      const id = current()?.id;
      build({ ...s, running: s.running });
      const r = rows.findIndex((items) => items.some((a) => a.id === id));
      const c = r < 0 ? 0 : rows[r].findIndex((a) => a.id === id);
      setFocus(Math.max(r, 0), Math.max(c, 0), true);
      return;
    }
    running = new Set(s.running);
    paintRunning();
  });
  api.onHome(() => {
    if (wake()) return; // Home on the clock screen wakes the TV, like any button
    touched();
    closeSheet();
    if (settings) closeSettings();
    if (allApps) closeAllApps();
    closeViewer();
    if (files) closeFiles();
    if (guide) closeGuide();
    setFocus(pos.row, pos.col, true);
  });
  // The PC woke from sleep: the clock screen, and the next button asks who is
  // watching. Without a screen saver, straight to "Who's watching?".
  api.onLock(() => {
    if (prefs.screenSaverMinutes > 0) showLock(true);
    else if (prefs.askWhoMinutes > 0 && profiles.length > 1) openPicker();
  });
  api.onPrefs(usePrefs);
  api.onDevice(maybeGuide);
  api.onFiles((root) => {
    wake();
    closeSheet();
    if (settings) closeSettings();
    if (allApps) closeAllApps();
    closeViewer();
    if (files) closeFiles();
    openFiles(root);
  });
  api.onDrives(() => { if (files) refreshPlaces(); });
  for (const el of document.querySelectorAll('.back-btn')) el.addEventListener('click', () => { touched(); back(); });
  api.onPicker(() => { if (lock) wake(); if (profiles.length > 1 && !picker) openPicker(); });
  if (profiles.length > 1) openPicker(); else paintMe();
  clock();
  watchIdle();
  requestAnimationFrame(frame);
})();
