'use strict';
// WinTV home screen: focus engine, input (remote keys, gamepad, air mouse),
// the top shelf and the menus. Talks to the machine only through window.wintv.

const GLYPHS = {
  play: '<path d="M9 6.2v11.6l9.2-5.8z" fill="currentColor" stroke-linejoin="round"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9.2h17M3.5 14.8h17M8 5v4.2M16 5v4.2M8 14.8V19M16 14.8V19"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M8.5 20h7M12 16.5V20"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.7l-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z" stroke-linejoin="round"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.6 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.6-3.5-8.5s1.1-5.9 3.5-8.5z"/>',
  gamepad: '<path d="M7.2 8h9.6a4 4 0 0 1 3.9 4.9l-.8 3.6a2.3 2.3 0 0 1-4 1l-1.3-1.5H9.4l-1.3 1.5a2.3 2.3 0 0 1-4-1l-.8-3.6A4 4 0 0 1 7.2 8z"/><path d="M8.2 10.8v3M6.7 12.3h3"/><circle cx="15.8" cy="11.4" r=".5" fill="currentColor"/><circle cx="17.3" cy="13.1" r=".5" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
  power: '<path d="M12 3.6v7.6"/><path d="M7.1 6.3a7.6 7.6 0 1 0 9.8 0"/>',
};

function glyph(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${GLYPHS[name] || GLYPHS.tv}</svg>`;
}

// Outside Electron (design work in a plain browser) fake the bridge.
const api = window.wintv || {
  getState: async () => {
    const cfg = await (await fetch('../apps.default.json')).json();
    const tag = (list, row) => list.map((a) => ({ ...a, row, available: true }));
    return { apps: tag(cfg.apps, 0), system: tag(cfg.system, 1), running: ['youtube'], browser: 'brave', user: 'preview',
      profiles: cfg.profiles || [], profile: null };
  },
  setProfile: async () => ({ ok: true }),
  onPicker: () => {},
  launch: async (id) => ({ ok: true, preview: id }),
  quit: async () => ({ ok: true }),
  power: async () => ({ ok: true }),
  onState: () => {},
  onHome: () => {},
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

// ------------------------------------------------------------------ sound
let audio = null;
function tone(freq, ms, gain) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio device is fine */ }
}
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
  const item = current();
  const el = currentTile();
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 160);
  if (!item.available) { toast(item.reason); return; }
  select();
  if (item.kind === 'power') return openPower();
  const res = await api.launch(item.id);
  if (!res.ok) toast(res.error || `Could not open ${item.name}`);
}

function openSheet(title, items) {
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
  focusSheet(0);
  $('sheet').classList.remove('hidden');
}

function focusSheet(i) {
  sheet.buttons[sheet.index]?.classList.remove('focused');
  sheet.index = i;
  sheet.buttons[i].classList.add('focused');
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
    { label: 'Admin Sign-in', run: act('switch-user') },
    { label: 'Cancel', run: closeSheet },
  ]);
}

function openContext() {
  if (picker) return;
  const item = current();
  if (!item || item.kind === 'power') return;
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
window.addEventListener('wheel', (e) => move(Math.sign(e.deltaY || e.deltaX), 0), { passive: true });

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
// idle; the sheen follows the lean like light on a glossy card.
function frame(t) {
  pollPad(t);
  const el = currentTile();
  if (el) {
    const swayX = Math.sin(t / 1500) * 0.35;
    const swayY = Math.cos(t / 1900) * 0.3;
    lean.x += (lean.tx + swayX - lean.x) * 0.07;
    lean.y += (lean.ty + swayY - lean.y) * 0.07;
    lean.tx *= 0.97;
    lean.ty *= 0.97;
    const s = el.style;
    s.setProperty('--ry', `${(lean.x * 6).toFixed(2)}deg`);
    s.setProperty('--rx', `${(-lean.y * 4.5).toFixed(2)}deg`);
    s.setProperty('--px', `${(lean.x * 0.55).toFixed(3)}vw`);
    s.setProperty('--py', `${(lean.y * 0.45).toFixed(3)}vh`);
    s.setProperty('--sx', `${(50 + lean.x * 40).toFixed(1)}%`);
    s.setProperty('--sy', `${(25 + lean.y * 35).toFixed(1)}%`);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ clock
function clock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  setTimeout(clock, 1000 * (60 - new Date().getSeconds()));
}

// ------------------------------------------------------------------ start
(async function start() {
  const state = await api.getState();
  profiles = state.profiles || [];
  active = state.profile;
  build(state);
  setFocus(0, 0, true);
  api.onState((s) => { running = new Set(s.running); paintRunning(); });
  api.onHome(() => { closeSheet(); setFocus(pos.row, pos.col, true); });
  api.onPicker(() => { if (profiles.length > 1) openPicker(); });
  if (profiles.length > 1) openPicker(); else paintMe();
  clock();
  requestAnimationFrame(frame);
})();
