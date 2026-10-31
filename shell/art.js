'use strict';
// WinTV's pictures and weather, fetched by the TV itself (D-32, D-35): the
// live wallpapers (open-licensed videos on Wikimedia Commons), the services'
// logos (vector files on Wikimedia Commons, by file name) and the weather
// (Open-Meteo). None of it is in the repo, none of it needs an account or a
// key, and WinTV works without it. Everything is kept in a cache on the TV,
// so the home screen looks the same offline.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { net } = require('electron');

// Wikimedia asks every program to say who it is.
const USER_AGENT = 'WinTV (https://github.com/rohitbeer/wintv)';

let dir = null;
let log = () => {};

function init(cacheDir, logger) {
  dir = cacheDir;
  log = logger;
  for (const sub of ['videos', 'logos']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  // Pictures of the day, from before the live wallpapers (D-35).
  fs.rmSync(path.join(dir, 'wallpapers'), { recursive: true, force: true });
}

async function get(url, timeoutMs = 20000, headers = {}) {
  const res = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
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

// Large files go straight to disk instead of through memory.
async function saveStream(url, file) {
  const res = await get(url, 30 * 60000);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file + '.tmp'));
  fs.renameSync(file + '.tmp', file);
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

// Commons' author field is HTML; videos sometimes credit "Video: … <br> Audio: …".
function author(html) {
  const lines = String(html || '').replace(/<br\s*\/?>/gi, '\n').split('\n').map(plain).filter(Boolean);
  const video = lines.find((l) => /^video\s*:/i.test(l));
  return nameOnly((video || lines[0] || '').replace(/^video\s*:\s*/i, ''));
}

// ---------------------------------------------------------------- live wallpapers
// The screen saver's videos (D-35): a fixed collection of open-licensed
// clips on Wikimedia Commons, named in apps.json's "wallpapers". The TV
// downloads each clip's 1080p WebM once, one at a time, and reads its author
// and licence from Commons for the credit.
const VIDEO_NAME = /^[^|#<>[\]{}\u0000-\u001f]{1,240}\.(webm|ogv)$/i;
const TRANSCODES = ['1080p.vp9.webm', '1080p.webm', '720p.vp9.webm', '720p.webm'];

// Only smooth footage: 60 frames a second (59.94, the TV standard, counts).
// Commons' own frame-rate field is sometimes wrong, so the TV reads the
// frame duration from the start of the WebM file itself (Matroska's
// DefaultDuration, in nanoseconds) before downloading the rest.
const MIN_FPS = 59;

async function frameRate(url) {
  const head = Buffer.from(await (await get(url, 60000, { Range: 'bytes=0-262143' })).arrayBuffer());
  const at = head.indexOf(Buffer.from([0x23, 0xe3, 0x83]));
  if (at < 0) return null;
  const sizeByte = head[at + 3];
  const width = 9 - sizeByte.toString(2).length; // EBML: leading zeros + 1 bytes of size
  const size = sizeByte & (0xff >> width);
  const ns = head.subarray(at + 3 + width, at + 3 + width + size).reduce((n, b) => n * 256 + b, 0);
  return ns ? 1e9 / ns : null;
}
const videoFile = (name) => `${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}.webm`;

const haveVideo = (index, name) => !!index[name]?.file && fs.existsSync(path.join(dir, 'videos', index[name].file));

// The ones on disk, in the collection's order.
function videos(list) {
  const index = readIndex('videos');
  return list.filter((v) => haveVideo(index, v.file)).map((v) => ({ ...index[v.file], title: v.title }));
}

async function refreshVideos(list, onNew = () => {}) {
  const index = readIndex('videos');
  // Clips no longer in the collection: their space back first.
  for (const name of Object.keys(index)) {
    if (list.some((v) => v.file === name)) continue;
    if (index[name].file) fs.rmSync(path.join(dir, 'videos', index[name].file), { force: true });
    delete index[name];
  }
  writeIndex('videos', index);
  const missing = list.filter((v) => VIDEO_NAME.test(v.file) && !haveVideo(index, v.file) && !index[v.file]?.refused);
  let added = 0;
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'videoinfo', viprop: 'derivatives|extmetadata',
      viextmetadatafilter: 'Artist|LicenseShortName', titles: batch.map((v) => `File:${v.file}`).join('|') });
    const r = await (await get(`https://commons.wikimedia.org/w/api.php?${q}`)).json();
    const spelled = new Map((r.query?.normalized || []).map((n) => [n.from, n.to]));
    const pages = new Map(Object.values(r.query?.pages || {}).map((p) => [p.title, p.videoinfo?.[0]]));
    for (const v of batch) {
      const info = pages.get(spelled.get(`File:${v.file}`) || `File:${v.file}`);
      const byKey = new Map((info?.derivatives || []).map((d) => [d.transcodekey, d.src]));
      const url = TRANSCODES.map((k) => byKey.get(k)).find(Boolean);
      if (!url) { log('art: no playable copy on Commons:', v.file); continue; }
      try {
        const fps = await frameRate(url);
        if (!(fps >= MIN_FPS)) {
          log('art: not a wallpaper,', fps ? `${fps.toFixed(2)} fps:` : 'frame rate unknown:', v.file);
          index[v.file] = { refused: fps ? `${fps.toFixed(2)} fps` : 'frame rate unknown' };
          writeIndex('videos', index);
          continue;
        }
        await saveStream(url, path.join(dir, 'videos', videoFile(v.file)));
        index[v.file] = {
          file: videoFile(v.file),
          artist: author(info.extmetadata?.Artist?.value),
          license: plain(info.extmetadata?.LicenseShortName?.value).slice(0, 40),
        };
        writeIndex('videos', index);
        added += 1;
        onNew();
        await new Promise((r) => setTimeout(r, 5000)); // Wikimedia limits how fast one client may download
      } catch (e) {
        log('art: video', v.file, e.message);
        return added; // offline or interrupted: the next refresh carries on
      }
    }
  }
  if (added) log('art: new videos:', String(added));
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

// Clips in the collection not yet on the TV (refused ones don't count).
function videosMissing(list) {
  const index = readIndex('videos');
  return list.filter((v) => !haveVideo(index, v.file) && !index[v.file]?.refused).length;
}

module.exports = { init, videos, videosMissing, refreshVideos, logo, refreshLogos, weather, findPlaces };
