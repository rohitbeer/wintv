'use strict';
// WinTV system layer: what the TV shows on top of every app. Quick settings
// (hold Home), the keyboard, the volume, the sleep-timer warning. This window
// never has the focus, so the remote's keys arrive from main.js (input.ps1
// takes them from the app while a panel is up), and typing goes to the app.

const GLYPHS = {
  sound: '<path d="M4.5 9.5h3l4.5-3.8v12.6l-4.5-3.8h-3z" stroke-linejoin="round"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  mute: '<path d="M4.5 9.5h3l4.5-3.8v12.6l-4.5-3.8h-3z" stroke-linejoin="round"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" stroke-linejoin="round"/>',
  keyboard: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.2"/><path d="M6.5 9.6h.01M10 9.6h.01M13.5 9.6h.01M17 9.6h.01M6.5 12.6h.01M10 12.6h.01M13.5 12.6h.01M17 12.6h.01M8 15.4h8"/>',
  screenoff: '<rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M8.5 20h7M12 16.5V20M4 3.5l16 16"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="16.8" cy="9.4" r="2.5"/><path d="M15.6 14c2.4-.3 4.3 1.3 4.9 4.4"/>',
  home: '<path d="M4 11.2L12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" stroke-linejoin="round"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  shift: '<path d="M12 4.5l7 7.2h-4v6.8H9v-6.8H5z" stroke-linejoin="round"/>',
  caps: '<path d="M12 4.5l7 7.2h-4v4.3H9v-4.3H5z" stroke-linejoin="round"/><path d="M9 19.5h6"/>',
  backspace: '<path d="M9 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-6-6.5z" stroke-linejoin="round"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  hide: '<rect x="3.5" y="4" width="17" height="10" rx="2"/><path d="M8 17.5l4 3 4-3"/>',
  left: '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
  right: '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
};
const glyph = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${GLYPHS[name]}</svg>`;
const $ = (id) => document.getElementById(id);

// Outside Electron (design work in a plain browser): ?show=quick|keyboard|volume|notice
const preview = !window.wintvLayer;
const api = window.wintvLayer || {
  onShow: () => {}, onHide: () => {}, onKey: () => {}, onPrefs: () => {},
  close: () => {}, type: async () => ({ ok: true }), key: async () => ({ ok: true }),
  action: async (name, arg) => ({ ok: true, result: name === 'sleep-timer' ? { minutes: arg, at: arg ? Date.now() + arg * 60000 : 0 } : {} }),
};

// ------------------------------------------------------------------ sound (tone: prefs.js)
const tick = () => tone(1900, 28, 0.02);
const click = () => tone(1300, 35, 0.025);

// ------------------------------------------------------------------ surfaces
const ELEMENTS = { quick: 'quick', keyboard: 'kb', volume: 'vol', notice: 'notice' };
const open = new Set();

function show(name, data) {
  if (!ELEMENTS[name]) return;
  const again = open.has(name);
  open.add(name);
  if (name === 'quick') showQuick(data);
  else if (name === 'keyboard') showKeyboard(data, again);
  else if (name === 'volume') showVolume(data);
  else if (name === 'notice') showNotice(data);
  if (open.has(name)) $(ELEMENTS[name]).classList.remove('hidden'); // a surface may decline (volume while quick settings is open)
}

// tell = false when main.js closed it (it already knows).
function hide(name, tell = true) {
  if (!open.delete(name)) return;
  $(ELEMENTS[name]).classList.add('hidden');
  if (name === 'notice') { clearInterval(notice?.timer); clearTimeout(notice?.gone); }
  if (name === 'volume') clearTimeout(volTimer);
  if (tell) api.close(name);
}

// The panel that gets the remote: a warning first, then the keyboard, then quick settings.
function key(k, repeat) {
  if (open.has('notice')) noticeKey(k);
  else if (open.has('keyboard')) keyboardKey(k, repeat);
  else if (open.has('quick')) quickKey(k, repeat);
}

api.onShow(({ surface, data }) => show(surface, data));
api.onHide((name) => hide(name, false));
api.onKey(({ k, repeat }) => key(k, repeat));
api.onPrefs(applyLook); // text size, contrast, motion and sounds, as chosen in Settings
document.querySelector('.q-close').addEventListener('click', () => hide('quick'));

// Only when this window has the focus: a plain browser, or a Linux test run.
const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', Escape: 'back', Backspace: 'back', BrowserBack: 'back' };
window.addEventListener('keydown', (e) => {
  if (!KEYS[e.key]) return;
  e.preventDefault();
  document.body.classList.remove('pointer');
  key(KEYS[e.key], e.repeat);
});
window.addEventListener('mousemove', () => document.body.classList.add('pointer'));

// Mouse clicks (D-53): this window never takes the focus from the app, and
// Chromium eats clicks on such a window, so input.ps1 takes a click while the
// pointer is over a panel and it arrives here: what is under the pointer is
// clicked, through the same handlers as a real click.
let pointerAt = null;
let pointerOver = false;
function trackPointer() {
  const el = pointerAt && document.elementFromPoint(pointerAt.x, pointerAt.y);
  const over = !!el?.closest('#quick:not(.hidden), #kb:not(.hidden), #notice:not(.hidden)');
  if (over !== pointerOver) { pointerOver = over; api.pointer?.(over); }
}
window.addEventListener('mousemove', (e) => { pointerAt = { x: e.clientX, y: e.clientY }; trackPointer(); });
document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { pointerAt = null; trackPointer(); } }); // off the panels
api.onClick?.(() => { const el = pointerAt && document.elementFromPoint(pointerAt.x, pointerAt.y); el?.click(); });
api.onShow(() => setTimeout(trackPointer, 60));
api.onHide(() => setTimeout(trackPointer, 60));

// ------------------------------------------------------------------ quick settings
// Like tvOS's Control Center or Google TV's dashboard: the few things you
// change mid-film, without leaving it.
let quick = null; // { rows, index, data }
let volSend = 0;
let sleepSend = 0;

function clockText() {
  const now = new Date();
  $('q-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('q-date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function sleepText(r) {
  if (!r.value) return 'Off';
  if (r.at && r.value === r.setTo) {
    const left = Math.max(1, Math.round((r.at - Date.now()) / 60000));
    return `${left} min left`;
  }
  return `${r.value} min`;
}

function showQuick(d) {
  clockText();
  const rows = [];
  if (d.audio?.present) {
    rows.push({ id: 'volume', kind: 'slider', glyph: 'sound', label: 'Volume', value: d.audio.volume, muted: d.audio.muted });
    rows.push({ id: 'mute', kind: 'toggle', glyph: 'mute', label: 'Mute', on: d.audio.muted });
  }
  rows.push({ id: 'sleep', kind: 'stepper', glyph: 'moon', label: 'Sleep timer', steps: d.sleepSteps || [0, 15, 30, 60, 90, 120],
    value: d.sleep?.minutes || 0, setTo: d.sleep?.minutes || 0, at: d.sleep?.at || 0 });
  // Switching contexts (D-36): the other open apps, and for the browser
  // apps in front their full screen and (Brave) the address bar.
  if (d.others?.length) rows.push({ id: 'switch', kind: 'apps', glyph: 'apps', label: 'Switch to', options: d.others, at: 0 });
  if (d.app?.kind === 'browser') rows.push({ id: 'address', kind: 'action', glyph: 'search', label: 'Address bar', note: 'Search, tabs and Brave’s settings' });
  if (d.app?.kind === 'web' || d.app?.kind === 'browser') {
    rows.push({ id: 'fullscreen', kind: 'action', glyph: 'fullscreen', label: d.app.full ? 'Leave full screen' : 'Full screen' });
  }
  if (d.appInFront) rows.push({ id: 'keyboard', kind: 'action', glyph: 'keyboard', label: 'Keyboard' });
  rows.push({ id: 'screen-off', kind: 'action', glyph: 'screenoff', label: 'Picture off', note: 'Sound keeps playing. Any button turns it back on.' });
  if (d.profiles) rows.push({ id: 'who', kind: 'action', glyph: 'people', label: 'Who’s watching?' });
  rows.push({ id: 'home', kind: 'action', glyph: 'home', label: 'Home' });
  quick = { rows, index: 0, data: d };
  paintQuick();
}

function paintQuick() {
  const box = $('q-rows');
  box.innerHTML = '';
  quick.rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = `q-row ${r.kind}`;
    el.innerHTML = `${glyph(r.glyph)}<span class="q-label"></span><span class="q-val"></span>`;
    el.querySelector('.q-label').textContent = r.label;
    if (r.note) {
      el.insertAdjacentHTML('beforeend', '<span class="q-note"></span>');
      el.querySelector('.q-note').textContent = r.note;
    }
    const val = el.querySelector('.q-val');
    if (r.kind === 'slider') {
      val.textContent = r.value;
      el.classList.toggle('muted', !!r.muted);
      el.insertAdjacentHTML('beforeend', '<div class="q-bar"><div class="q-fill"></div></div>');
      el.querySelector('.q-fill').style.width = `${r.value}%`;
    } else if (r.kind === 'toggle') val.textContent = r.on ? 'On' : 'Off';
    else if (r.kind === 'stepper') val.textContent = sleepText(r);
    else if (r.kind === 'apps') val.textContent = r.options[r.at].name;
    else val.textContent = r.value || '';
    el.classList.toggle('focused', i === quick.index);
    el.addEventListener('mousemove', () => { if (quick.index !== i) { quick.index = i; paintQuick(); } });
    el.addEventListener('click', () => { quick.index = i; quickKey('ok', false); });
    box.append(el);
  });
  box.children[quick.index]?.scrollIntoView({ block: 'nearest' }); // long lists scroll
}

function quickKey(k, repeat) {
  const r = quick.rows[quick.index];
  if (k === 'back') { hide('quick'); return; }
  if (k === 'up' || k === 'down') {
    const i = quick.index + (k === 'up' ? -1 : 1);
    if (i < 0 || i >= quick.rows.length) return;
    quick.index = i;
    tick();
  } else if (k === 'left' || k === 'right') {
    const dir = k === 'left' ? -1 : 1;
    if (r.kind === 'slider') {
      r.value = Math.max(0, Math.min(100, r.value + dir * 2));
      clearTimeout(volSend); // send once the remote stops, not on every press
      volSend = setTimeout(() => api.action('volume', r.value), 120);
      if (r.muted && dir > 0) setMute(false);
    } else if (r.kind === 'stepper') {
      if (repeat) return;
      const at = r.steps.indexOf(r.value) + dir;
      if (at < 0 || at >= r.steps.length) return;
      r.value = r.steps[at];
      clearTimeout(sleepSend); // stepping 15 → 30 → 60 sets the timer once, on the last
      sleepSend = setTimeout(() => setSleep(r.value), 700);
    } else if (r.kind === 'toggle') {
      if (repeat) return;
      setMute(!r.on);
    } else if (r.kind === 'apps') {
      if (repeat || r.options.length < 2) return;
      r.at = (r.at + dir + r.options.length) % r.options.length;
    } else return;
    tick();
  } else if (k === 'ok') {
    if (repeat) return;
    click();
    if (r.kind === 'toggle') setMute(!r.on);
    else if (r.kind === 'stepper') {
      const at = (r.steps.indexOf(r.value) + 1) % r.steps.length;
      r.value = r.steps[at];
      clearTimeout(sleepSend);
      sleepSend = setTimeout(() => setSleep(r.value), 700);
    } else if (r.kind === 'action') {
      if (['home', 'who', 'screen-off', 'keyboard', 'address', 'fullscreen'].includes(r.id)) hide('quick');
      api.action(r.id);
      return;
    } else if (r.kind === 'apps') {
      hide('quick');
      api.action('switch', r.options[r.at].id);
      return;
    }
  }
  paintQuick();
}

function setMute(on) {
  for (const r of quick.rows) {
    if (r.id === 'mute') r.on = on;
    if (r.id === 'volume') r.muted = on;
  }
  api.action('mute', on);
  paintQuick();
}

async function setSleep(minutes) {
  const r = await api.action('sleep-timer', minutes);
  const row = quick?.rows.find((x) => x.id === 'sleep');
  if (!row || !r.ok) return;
  row.setTo = r.result.minutes;
  row.at = r.result.at || 0;
  if (open.has('quick')) paintQuick();
}

// ------------------------------------------------------------------ keyboard
// A TV keyboard for the remote. Every key types straight into the app's text
// field (this window never takes the focus), so the field itself shows the
// text; the line above the keys repeats it, masked for passwords.
const LAYOUTS = {
  qwerty: { name: 'EN', rows: ['1234567890', 'qwertyuiop', 'asdfghjkl@', 'zxcvbnm-_.'] },
  qwertz: { name: 'DE', rows: ['1234567890ß', 'qwertzuiopü', 'asdfghjklöä', 'yxcvbnm@-_.'] },
};
const SYMBOLS = ['1234567890', '!?#$%&*+=/', '()[]{}<>:;', '\'"\\|~^`€,.'];
let kb = null; // { layout, symbols, shift: 0 off | 1 once | 2 caps, password, echo, peek, rows, r, c, els }

function showKeyboard(d, again) {
  // The app announced the same (or the next) field again: keep the place,
  // take only whether it is a password.
  if (again && kb) {
    kb.password = !!d.password;
    $('kb-note').innerHTML = kb.password ? `${glyph('lock')}<span>Password</span>` : '';
    paintEcho();
    return;
  }
  kb = { layout: LAYOUTS[d.layout] ? d.layout : 'qwerty', symbols: false, shift: 0, password: !!d.password,
    echo: '', peek: 0, rows: [], r: 1, c: 0, els: [] };
  $('kb-note').innerHTML = kb.password ? `${glyph('lock')}<span>Password</span>` : '';
  buildKeys();
  paintEcho();
}

function keyRows() {
  const L = LAYOUTS[kb.layout];
  const rows = (kb.symbols ? SYMBOLS : L.rows).map((r) => [...r].map((ch) => ({ t: 'char', v: ch })));
  const last = rows[rows.length - 1];
  if (!kb.symbols) last.unshift({ t: 'shift', w: 1.5 });
  last.push({ t: 'backspace', w: 1.5 });
  rows.push([
    { t: 'mode', label: kb.symbols ? 'ABC' : '123', w: 1.5 },
    { t: 'layout', label: L.name, w: 1.2 },
    { t: 'space', label: 'space', w: 4.4 },
    { t: 'left' },
    { t: 'right' },
    { t: 'text', v: '.com', label: '.com', w: 1.5 },
    { t: 'enter', label: 'Enter', w: 2 },
    { t: 'hide', w: 1.2 },
  ]);
  return rows;
}

function keyFace(k) {
  if (k.t === 'char') return null;
  if (k.t === 'shift') return glyph(kb.shift === 2 ? 'caps' : 'shift');
  if (['backspace', 'left', 'right', 'hide'].includes(k.t)) return glyph(k.t);
  return null;
}

function buildKeys() {
  const box = $('kb-keys');
  box.innerHTML = '';
  kb.rows = keyRows();
  kb.els = kb.rows.map((row, r) => {
    const line = document.createElement('div');
    line.className = 'kb-row';
    box.append(line);
    return row.map((k, c) => {
      const el = document.createElement('div');
      el.className = `key${k.t === 'char' ? '' : ' special'}`;
      if (k.w) el.style.setProperty('--w', k.w);
      el.addEventListener('mousemove', () => { if (kb.r !== r || kb.c !== c) { kb.r = r; kb.c = c; paintFocus(); } });
      el.addEventListener('click', () => { kb.r = r; kb.c = c; press(false); });
      line.append(el);
      return el;
    });
  });
  kb.r = Math.min(kb.r, kb.rows.length - 1);
  kb.c = Math.min(kb.c, kb.rows[kb.r].length - 1);
  paintKeys();
}

function paintKeys() {
  kb.rows.forEach((row, r) => row.forEach((k, c) => {
    const el = kb.els[r][c];
    const face = keyFace(k);
    if (face) el.innerHTML = face;
    else el.textContent = k.t === 'char' ? charOf(k) : k.label;
    el.classList.toggle('on', k.t === 'shift' && kb.shift > 0);
  }));
  paintFocus();
}

function paintFocus() {
  for (const row of kb.els) for (const el of row) el.classList.remove('focused');
  kb.els[kb.r][kb.c].classList.add('focused');
}

const charOf = (k) => (kb.shift && !kb.symbols ? k.v.toUpperCase() : k.v);

function paintEcho() {
  const el = $('kb-echo');
  el.innerHTML = '';
  if (!kb.echo) {
    el.classList.add('empty');
    el.textContent = kb.password ? 'Typing a password' : 'Typing into the app';
    return;
  }
  el.classList.remove('empty');
  let text = kb.echo;
  // Passwords show as dots, with the last character visible for a moment, like a phone.
  if (kb.password) text = '•'.repeat(text.length - 1) + (Date.now() < kb.peek ? text.slice(-1) : '•');
  el.append(document.createTextNode(text.slice(-48)));
  const caret = document.createElement('span');
  caret.className = 'caret';
  el.append(caret);
}

// Up and down land on the key nearest to where the eye already is.
function moveRow(dr) {
  const r = kb.r + dr;
  if (r < 0 || r >= kb.rows.length) return false;
  const from = kb.els[kb.r][kb.c].getBoundingClientRect();
  const cx = from.left + from.width / 2;
  let best = 0;
  let dist = Infinity;
  kb.els[r].forEach((el, c) => {
    const b = el.getBoundingClientRect();
    const d = Math.abs(b.left + b.width / 2 - cx);
    if (d < dist) { dist = d; best = c; }
  });
  kb.r = r;
  kb.c = best;
  return true;
}

function keyboardKey(k, repeat) {
  if (k === 'back') { hide('keyboard'); return; }
  if (k === 'ok') { press(repeat); return; }
  let moved = false;
  if (k === 'left' || k === 'right') {
    const n = kb.rows[kb.r].length;
    kb.c = (kb.c + (k === 'left' ? -1 : 1) + n) % n; // rows wrap around, so the far side is one press away
    moved = true;
  } else if (k === 'up' || k === 'down') moved = moveRow(k === 'up' ? -1 : 1);
  if (moved) { tick(); paintFocus(); }
}

function flash() {
  const el = kb.els[kb.r][kb.c];
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 90);
}

function typeText(text) {
  api.type(text);
  kb.echo += text;
  kb.peek = Date.now() + 1200;
  setTimeout(() => { if (kb && Date.now() >= kb.peek) paintEcho(); }, 1250);
}

function press(repeat) {
  const k = kb.rows[kb.r][kb.c];
  // Holding OK repeats only the keys where that helps.
  if (repeat && !['backspace', 'left', 'right'].includes(k.t)) return;
  flash();
  click();
  switch (k.t) {
    case 'char':
      typeText(charOf(k));
      if (kb.shift === 1) { kb.shift = 0; paintKeys(); }
      break;
    case 'text': typeText(k.v); break;
    case 'space': typeText(' '); break;
    case 'backspace':
      api.key('backspace');
      kb.echo = kb.echo.slice(0, -1);
      break;
    case 'left':
    case 'right': api.key(k.t); break;
    case 'shift': kb.shift = (kb.shift + 1) % 3; paintKeys(); break; // off → once → caps lock → off
    case 'mode': kb.symbols = !kb.symbols; kb.shift = 0; buildKeys(); break;
    case 'layout': kb.layout = kb.layout === 'qwerty' ? 'qwertz' : 'qwerty'; buildKeys(); break;
    case 'enter': api.key('enter'); hide('keyboard'); return;
    case 'hide': hide('keyboard'); return;
  }
  paintEcho();
}

// ------------------------------------------------------------------ volume
let volTimer = 0;
function showVolume(a) {
  // Quick settings, if open, already shows the volume: update it there instead.
  const row = quick && open.has('quick') && quick.rows.find((r) => r.id === 'volume');
  if (row) {
    row.value = a.volume;
    row.muted = a.muted;
    const m = quick.rows.find((r) => r.id === 'mute');
    if (m) m.on = a.muted;
    paintQuick();
    hide('volume');
    return;
  }
  $('vol-glyph').innerHTML = glyph(a.muted || a.volume === 0 ? 'mute' : 'sound');
  $('vol-fill').style.width = `${a.volume}%`;
  $('vol-num').textContent = a.muted ? 'Mute' : a.volume;
  $('vol').classList.toggle('muted', !!a.muted);
  clearTimeout(volTimer);
  if (!preview) volTimer = setTimeout(() => hide('volume'), 2200);
}

// ------------------------------------------------------------------ notice
// The sleep timer's last minute: OK (or Back) keeps watching. A drive plugged
// in: Open in Files, or Not now; it goes by itself after 15 s (D-42).
let notice = null; // { buttons, index, timer, at, back, gone }
function showNotice(d) {
  clearInterval(notice?.timer);
  clearTimeout(notice?.gone);
  if (d.kind === 'drive') {
    $('n-title').textContent = d.removable ? 'USB drive' : 'Drive';
    $('n-text').textContent = `${d.name} (${d.letter}) is connected.`;
    notice = { index: 0, back: () => hide('notice'), buttons: [
      { label: 'Open in Files', run: () => { hide('notice'); api.action('open-files', d.root); } },
      { label: 'Not now', run: () => hide('notice') },
    ] };
    notice.gone = setTimeout(() => api.action('notice-expired'), 15000); // main closes it, keeping the remote 1 s
    paintNoticeButtons();
    return;
  }
  $('n-title').textContent = 'Sleep timer';
  notice = { index: 0, at: d.at, back: () => notice.buttons[0].run(), buttons: [
    { label: 'Keep watching', run: () => { api.action('sleep-timer', 0); hide('notice'); } },
    { label: 'Sleep now', run: () => { hide('notice'); api.action('sleep-now'); } },
  ] };
  paintNoticeButtons();
  const count = () => {
    const s = Math.max(0, Math.round((notice.at - Date.now()) / 1000));
    $('n-text').textContent = `The TV goes to sleep in ${s} s.`;
  };
  count();
  notice.timer = setInterval(count, 1000);
}

function paintNoticeButtons() {
  const box = $('n-buttons');
  box.innerHTML = '';
  notice.els = notice.buttons.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'n-btn';
    el.textContent = b.label;
    el.addEventListener('mousemove', () => { notice.index = i; paintNotice(); });
    el.addEventListener('click', () => b.run());
    box.append(el);
    return el;
  });
  paintNotice();
}

function paintNotice() {
  notice.els.forEach((el, i) => el.classList.toggle('focused', i === notice.index));
}

function noticeKey(k) {
  if (k === 'back') { notice.back(); return; }
  clearTimeout(notice.gone); // someone is answering it
  if (k === 'ok') { click(); notice.buttons[notice.index].run(); return; }
  const dir = k === 'left' || k === 'up' ? -1 : 1;
  const i = notice.index + dir;
  if (i < 0 || i >= notice.buttons.length) return;
  notice.index = i;
  tick();
  paintNotice();
}

// ------------------------------------------------------------------ preview
if (preview) {
  document.body.classList.add('preview');
  const q = new URLSearchParams(location.search);
  applyLook({ textSize: q.get('text') || 'default', reduceMotion: q.has('still'), highContrast: q.has('contrast'), navSounds: 'normal' });
  const audioState = { present: true, device: 'LG TV', volume: 36, muted: false };
  for (const name of (q.get('show') || 'quick').split(',')) {
    if (name === 'quick') show('quick', { audio: audioState, sleep: { minutes: 30, at: Date.now() + 27 * 60000 }, appInFront: true, profiles: true,
      app: { id: 'browser', name: 'Browser', kind: 'browser', full: true }, others: [{ id: 'youtube', name: 'YouTube' }, { id: 'netflix', name: 'Netflix' }] });
    if (name === 'keyboard') show('keyboard', { layout: q.get('layout') || 'qwerty', password: q.has('password') });
    if (name === 'volume') show('volume', audioState);
    if (name === 'notice') show('notice', { kind: 'sleep', at: Date.now() + 58000 });
  }
  if (q.has('type')) for (const ch of q.get('type')) typeText(ch), paintEcho();
  if (q.has('focus')) { const [r, c] = q.get('focus').split('.').map(Number); kb.r = r; kb.c = c; paintFocus(); }
  if (q.has('row')) { quick.index = Number(q.get('row')); paintQuick(); }
}
