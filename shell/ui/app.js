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
  update: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v3.6h-3.6"/><path d="M12 8.5v4.2l2.6 1.6"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" stroke-linejoin="round"/>',
  access: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="7.4" r=".9" fill="currentColor"/><path d="M7.6 9.8l4.4.9 4.4-.9M12 10.7v3.4M12 14.1l-2.2 3.6M12 14.1l2.2 3.6"/>',
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
    return { apps: tag(cfg.apps, 0), system: tag(cfg.system, 1), running: ['youtube'], browser: 'brave', user: 'preview',
      profiles: cfg.profiles || [], profile: null, prefs };
  },
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
};

// Sample answers for design work in a plain browser.
const MOCK_SYSTEM = {
  'display.get': { current: { width: 1920, height: 1080, hz: 60 }, modes: [
    { width: 3840, height: 2160, hz: 60 }, { width: 3840, height: 2160, hz: 30 }, { width: 1920, height: 1080, hz: 120 },
    { width: 1920, height: 1080, hz: 60 }, { width: 1280, height: 720, hz: 60 }] },
  'audio.get': { present: true, device: 'LG TV (NVIDIA High Definition Audio)', volume: 40, muted: false },
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
  if (settings) { moveSettings(dx, dy); return; }
  if (dy) {
    const r = pos.row + dy;
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
  if (picker) return choosePicker();
  if (sheet) return sheet.items[sheet.index].run();
  if (settings) return activateSetting();
  const item = current();
  const el = currentTile();
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 160);
  if (!item.available) { toast(item.reason); return; }
  select();
  if (item.kind === 'power') return openPower();
  if (item.kind === 'settings') return openSettings();
  const res = await api.launch(item.id);
  if (!res.ok) toast(res.error || `Could not open ${item.name}`);
}

function openSheet(title, items, start = 0) {
  sheet = { items, index: 0, buttons: [] };
  $('sheet-title').textContent = title;
  const box = $('sheet-items');
  box.innerHTML = '';
  sheet.buttons = items.map((it, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.tabIndex = -1;
    b.textContent = it.label;
    b.addEventListener('mousemove', () => focusSheet(i));
    b.addEventListener('click', () => { focusSheet(i); it.run(); });
    box.append(b);
    return b;
  });
  focusSheet(Math.max(0, start));
  $('sheet').classList.remove('hidden');
}

function focusSheet(i) {
  sheet.buttons[sheet.index]?.classList.remove('focused');
  sheet.index = i;
  sheet.buttons[i].classList.add('focused');
  sheet.buttons[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // long lists scroll
}

function moveSheet(dy) {
  const i = sheet.index + dy;
  if (i < 0 || i >= sheet.items.length) return;
  focusSheet(i);
  tick();
}

function closeSheet() {
  if (!sheet) return false;
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
  if (picker || settings) return;
  const item = current();
  if (!item || item.kind === 'power' || item.kind === 'settings') return;
  const items = [{ label: `Open ${item.name}`, run: () => { closeSheet(); activate(); } }];
  if (running.has(item.id)) {
    items.push({ label: `Quit ${item.name}`, run: async () => { closeSheet(); await api.quit(item.id); } });
  }
  items.push({ label: 'Cancel', run: closeSheet });
  openSheet(item.name, items);
}

function back() {
  if (picker) { if (active) closePicker(); return; }
  if (closeSheet()) return;
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
  const p = profiles.find((x) => x.id === active);
  if (!p || profiles.length < 2) return;
  me.append(avatar(p, 'avatar mini'));
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
  document.body.classList.remove('pointer');
  const k = e.key;
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
function pointerOver(e, r, c) {
  document.body.classList.add('pointer');
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
  if (lock && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) wake(); // an air mouse jitters a little
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

// ------------------------------------------------------------------ settings
// WinTV's own Settings, in place of Windows' Settings app (which needs
// Explorer, and the TV account has none). Big rows a remote can drive.
// Every change goes through window.wintv.system(), which main.js checks.
const SECTIONS = [
  { id: 'display', name: 'Display', glyph: 'tv' },
  { id: 'sound', name: 'Sound', glyph: 'sound' },
  { id: 'saver', name: 'Screen Saver', glyph: 'moon' },
  { id: 'access', name: 'Accessibility', glyph: 'access' },
  { id: 'network', name: 'Network', glyph: 'globe' },
  { id: 'updates', name: 'Updates', glyph: 'update' },
  { id: 'about', name: 'About', glyph: 'info' },
];
const KEEP_SECONDS = 15;

// The line under each section. Set once the section's rows have arrived, so
// a slow answer from Windows can't put one section's note under another.
const NOTES = {
  display: () => 'If the edges of the picture are cut off, turn on your TV’s “Just Scan”, “Screen Fit” or “Full Pixel” picture size.',
  saver: () => 'The screen saver comes on over the home screen only: a film keeps the TV awake. '
    + 'Turning off the screen and sleep apply while the PC is plugged in.',
  access: () => 'Text size and high contrast change WinTV’s own screens, over every app too. '
    + 'Reduce motion also asks apps and websites to keep still.',
  updates: () => 'Windows installs its updates by itself too; “Install now” only does it sooner. '
    + 'WinTV updates are checked every day, and switch in when no app is open.',
  about: () => (repair.open ? 'Repair mode opens Windows’ sign-in screen. The admin signs in with the admin password '
    + 'and gets the Windows desktop. Signing out there brings the TV back.' : ''),
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
  repair = { taps: 0, open: false };
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
  if (id === 'network') return networkRows(result(await api.system('network.get')));
  if (id === 'updates') return updateRows(result(await api.updates('get')));
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
  prefs = p;
  applyLook(p);
  $('lock').classList.toggle('dark', p.screenSaverStyle === 'dark');
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
    { kind: 'info', label: 'Output', value: a.device },
    nav,
  ];
}

// The screen saver is WinTV's (the clock screen, below); turning the screen
// off and sleep are Windows' power plan, which this account may change.
function saverRows(power) {
  const rows = [
    pick('Screen saver', prefs.screenSaverMinutes, [2, 5, 10, 15, 30, 0], minutes, (v) => savePref('screenSaverMinutes', v)),
    pick('Style', prefs.screenSaverStyle, ['colour', 'dark'], (v) => (v === 'dark' ? 'Clock on black' : 'Clock on colour'),
      (v) => savePref('screenSaverStyle', v)),
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

// Repair mode: the Windows desktop, for the admin, when something needs
// fixing that WinTV's own screens can't. Hidden the way Android hides its
// developer options: press OK on "WinTV" in About seven times (D-22).
let repair = { taps: 0, open: false };
const REPAIR_TAPS = 7;

function repairTap() {
  if (repair.open) return;
  repair.taps += 1;
  if (repair.taps >= REPAIR_TAPS) {
    repair.open = true;
    toast('Repair mode is now at the bottom of About');
    loadSection();
  } else if (repair.taps >= 4) {
    toast(`${REPAIR_TAPS - repair.taps} more for repair mode`);
  }
}

function aboutRows(a) {
  const hours = Math.floor(a.uptimeMinutes / 60);
  const rows = [
    { kind: 'info', label: 'WinTV', value: appVersion, press: repairTap },
    { kind: 'info', label: 'Windows', value: `${a.windows.replace(/^Microsoft /, '')} ${a.version}` },
    { kind: 'info', label: 'Device name', value: a.device },
    { kind: 'info', label: 'Last update', value: a.lastUpdate ? new Date(a.lastUpdate).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not yet' },
    { kind: 'info', label: 'On for', value: hours >= 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${hours} h ${a.uptimeMinutes % 60} min` },
  ];
  if (repair.open) {
    rows.push({ kind: 'choice', label: 'Repair mode', value: 'Windows desktop', options: [
      { label: 'Sign in as admin', run: async () => { const r = await api.power('switch-user'); if (!r.ok) toast(r.error); } }] });
  }
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
  lock = { since: Date.now(), askWho, timer: 0, tick: 0, spot: 0, hue: 0, flip: false };
  const el = $('lock');
  el.dataset.spot = '0';
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
  const palette = rows.flat().filter((a) => a.colors?.length);
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
  $('lock-clock').classList.remove('moving');
  if (askWho && profiles.length > 1) openPicker();
  return true;
}

function watchIdle() {
  setInterval(() => {
    if (lock || !(prefs.screenSaverMinutes > 0)) return;
    // An app in front means someone is watching, not idling on the home screen.
    if (!document.hasFocus()) { touched(); return; }
    if (Date.now() - lastInput > prefs.screenSaverMinutes * 60000) showLock(false);
  }, 2000);
}

// ------------------------------------------------------------------ start
(async function start() {
  const state = await api.getState();
  profiles = state.profiles || [];
  active = state.profile;
  usePrefs(state.prefs);
  appVersion = state.version || '';
  build(state);
  setFocus(0, 0, true);
  api.onState((s) => {
    // New tiles arrive when a Store app was installed or removed.
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
    setFocus(pos.row, pos.col, true);
  });
  // The PC woke from sleep: the clock screen, and the next button asks who is
  // watching. Without a screen saver, straight to "Who's watching?".
  api.onLock(() => {
    if (prefs.screenSaverMinutes > 0) showLock(true);
    else if (prefs.askWhoMinutes > 0 && profiles.length > 1) openPicker();
  });
  api.onPrefs(usePrefs);
  api.onPicker(() => { if (lock) wake(); if (profiles.length > 1 && !picker) openPicker(); });
  if (profiles.length > 1) openPicker(); else paintMe();
  clock();
  watchIdle();
  requestAnimationFrame(frame);
})();
