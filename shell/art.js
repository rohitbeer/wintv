'use strict';
// WinTV's pictures and weather, fetched by the TV itself (D-32): the
// wallpaper (Wikimedia Commons' picture of the day, in 4K), the services'
// logos (vector files on Wikimedia Commons, by file name) and the weather
// (Open-Meteo). None of it is in the repo, none of it needs an account or a
// key, and WinTV works without it. Everything is kept in a cache on the TV,
// so the home screen looks the same offline.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { net } = require('electron');

// Wikimedia asks every program to say who it is.
const USER_AGENT = 'WinTV (https://github.com/rohitbeer/wintv)';
const KEEP_PICTURES = 30;
const LOOK_BACK_DAYS = 21;

let dir = null;
let log = () => {};

function init(cacheDir, logger) {
  dir = cacheDir;
  log = logger;
  for (const sub of ['wallpapers', 'logos']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
}

async function get(url, timeoutMs = 20000) {
  const res = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res;
}

// Written next to the target and renamed, so a crash leaves no half file.
function writeAtomic(file, data) {
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
}

async function save(url, file) {
  const res = await get(url, 90000);
  writeAtomic(file, Buffer.from(await res.arrayBuffer()));
}

function readIndex(sub) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, sub, 'index.json'), 'utf8')); } catch { return {}; }
}

function writeIndex(sub, index) {
  writeAtomic(path.join(dir, sub, 'index.json'), JSON.stringify(index, null, 1));
}

const plain = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
// The author field is usually a name, but some authors put a note there.
const nameOnly = (s) => (s && s.length <= 48 && !/[:.!?]\s/.test(s) ? s : '');

// ---------------------------------------------------------------- wallpapers
// Wikimedia Commons' picture of the day: a photo the Commons community chose,
// under a free licence that names its author. Only landscape pictures at
// least 1920 pixels wide are kept, newest first.
function wallpapers() {
  const pictures = readIndex('wallpapers').pictures || {};
  return Object.keys(pictures).sort().reverse()
    .filter((day) => fs.existsSync(path.join(dir, 'wallpapers', pictures[day].file)))
    .map((day) => ({ day, ...pictures[day], artist: nameOnly(pictures[day].artist) }));
}

// onFirst runs once the first new picture is saved, so a new TV shows it
// without waiting for the rest.
async function refreshWallpapers(onFirst = () => {}) {
  const index = readIndex('wallpapers');
  index.pictures ||= {};
  index.skipped ||= {};
  let added = 0;
  for (let back = 0; back < LOOK_BACK_DAYS; back++) {
    const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    if (index.pictures[day] || index.skipped[day]) continue;
    try {
      const feed = await (await get(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${day.replaceAll('-', '/')}`)).json();
      const pic = feed.image;
      const width = pic?.image?.width || 0;
      const height = pic?.image?.height || 1;
      const thumb = String(pic?.thumbnail?.source || '').replace(/\?.*$/, '');
      if (width < 1920 || width < height * 1.3 || !thumb.includes('/960px-')) { index.skipped[day] = true; continue; }
      // Commons renders standard widths only; 3840 is 4K.
      const url = thumb.replace('/960px-', width >= 3840 ? '/3840px-' : '/1920px-');
      const file = `${day}${/\.png$/i.test(url) ? '.png' : '.jpg'}`;
      await save(url, path.join(dir, 'wallpapers', file));
      index.pictures[day] = {
        file,
        title: plain(pic.description?.text).slice(0, 160),
        artist: nameOnly(plain(pic.artist?.text)),
        source: plain(pic.title).replace(/^File:/, '').slice(0, 120),
        license: plain(pic.license?.type).slice(0, 40),
      };
      added += 1;
      if (added === 1) { writeIndex('wallpapers', index); onFirst(); }
    } catch (e) {
      log('art: picture of', day, e.message);
      break; // offline: the next refresh tries again
    }
  }
  const days = Object.keys(index.pictures).sort().reverse();
  for (const old of days.slice(KEEP_PICTURES)) {
    fs.rmSync(path.join(dir, 'wallpapers', index.pictures[old].file), { force: true });
    delete index.pictures[old];
  }
  const cutoff = new Date(Date.now() - 2 * LOOK_BACK_DAYS * 86400000).toISOString().slice(0, 10);
  for (const day of Object.keys(index.skipped)) if (day < cutoff) delete index.skipped[day];
  writeIndex('wallpapers', index);
  if (added) log('art: new pictures:', String(added));
  return added;
}

// ---------------------------------------------------------------- logos
// A tile's "logo" names a file on Wikimedia Commons, where most services'
// logos are kept as vector files (simple text logos are in the public
// domain). The TV asks Commons for a 960-pixel rendering once and keeps it.
const LOGO_NAME = /^[^|#<>[\]{}\u0000-\u001f]{1,200}\.(svg|png)$/i;
const logoFile = (name) => `${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}.png`;

function logo(name) {
  if (typeof name !== 'string' || !LOGO_NAME.test(name)) return null;
  const file = logoFile(name);
  return fs.existsSync(path.join(dir, 'logos', file)) ? file : null;
}

async function refreshLogos(names) {
  const missing = [...new Set(names)].filter((n) => typeof n === 'string' && LOGO_NAME.test(n) && !logo(n));
  if (!missing.length) return 0;
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '960',
    titles: missing.map((n) => `File:${n}`).join('|') });
  const r = await (await get(`https://commons.wikimedia.org/w/api.php?${q}`)).json();
  // Commons answers with its own spelling of each title ("_" becomes " ").
  const spelled = new Map((r.query?.normalized || []).map((n) => [n.from, n.to]));
  const urls = new Map(Object.values(r.query?.pages || {}).map((p) => [p.title, p.imageinfo?.[0]?.thumburl]));
  let added = 0;
  for (const name of missing) {
    const title = `File:${name}`;
    const url = urls.get(spelled.get(title) || title);
    if (!url) { log('art: no such logo on Commons:', name); continue; }
    try {
      await save(url, path.join(dir, 'logos', logoFile(name)));
      added += 1;
    } catch (e) { log('art: logo', name, e.message); }
  }
  if (added) log('art: new logos:', String(added));
  return added;
}

// ---------------------------------------------------------------- weather
// Open-Meteo: free and open source, no account or key. Asked at most every
// 15 minutes, for the place chosen in Settings.
let weatherCache = null; // { key, at, data }

async function weather(place, fahrenheit) {
  if (!place) return null;
  const key = `${place.latitude},${place.longitude},${fahrenheit}`;
  if (weatherCache?.key === key && Date.now() - weatherCache.at < 15 * 60000) return weatherCache.data;
  const q = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: '1',
    current: 'temperature_2m,weather_code,is_day', daily: 'temperature_2m_max,temperature_2m_min',
    ...(fahrenheit ? { temperature_unit: 'fahrenheit' } : {}),
  });
  const j = await (await get(`https://api.open-meteo.com/v1/forecast?${q}`)).json();
  const data = {
    place: place.name,
    temp: Math.round(j.current.temperature_2m),
    code: j.current.weather_code,
    day: j.current.is_day === 1,
    high: Math.round(j.daily.temperature_2m_max[0]),
    low: Math.round(j.daily.temperature_2m_min[0]),
  };
  weatherCache = { key, at: Date.now(), data };
  return data;
}

// Town search for Settings, by Open-Meteo's geocoding (same terms).
async function findPlaces(name) {
  const q = new URLSearchParams({ name, count: '8', language: 'en', format: 'json' });
  const j = await (await get(`https://geocoding-api.open-meteo.com/v1/search?${q}`)).json();
  return (j.results || []).map((r) => ({
    name: plain(r.name).slice(0, 60),
    region: [r.admin1, r.country].filter(Boolean).map(plain).join(', ').slice(0, 80),
    latitude: Math.round(r.latitude * 1000) / 1000,
    longitude: Math.round(r.longitude * 1000) / 1000,
  }));
}

module.exports = { init, wallpapers, refreshWallpapers, logo, refreshLogos, weather, findPlaces };
