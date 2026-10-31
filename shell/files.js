'use strict';
// WinTV Files (D-40): the TV account's own folders, its drives and its
// Recycle Bin. Plain Node, so it can be tested anywhere; main.js wires it to
// the home screen. Every path the screen sends back is checked here: it
// counts only if its real path (junctions and links resolved) is inside one
// of the places Files shows.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp',
};
const KIND = (type) => (type ? type.split('/')[0] : 'other'); // video | audio | image | other

// Not shown: Windows' own bookkeeping, and files marked as temporary.
const HIDDEN = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information', 'recycler']);
const MAX_ITEMS = 3000;

function mediaType(file) {
  return TYPES[path.extname(file).toLowerCase()] || null;
}

function kindOf(file) {
  return KIND(mediaType(file));
}

function inside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The real path of p if it lies inside one of the roots, else null.
function check(roots, p) {
  if (typeof p !== 'string' || !p || p.length > 2048 || p.includes('\0')) return null;
  let real;
  try { real = fs.realpathSync.native(p); } catch { return null; }
  for (const r of roots) {
    let root;
    try { root = fs.realpathSync.native(r); } catch { continue; }
    if (inside(root, real)) return real;
  }
  return null;
}

// A folder's contents: folders first, then files, by name as people sort
// them ("Episode 2" before "Episode 10").
function list(dir) {
  const out = [];
  let more = false;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const low = d.name.toLowerCase();
    if (HIDDEN.has(low) || d.name.startsWith('.') || d.name.startsWith('~$')) continue;
    if (out.length >= MAX_ITEMS) { more = true; break; }
    const p = path.join(dir, d.name);
    let st;
    try { st = fs.statSync(p); } catch { continue; } // a broken link, or no access
    const folder = st.isDirectory();
    out.push({ name: d.name, path: p, folder, size: folder ? 0 : st.size, modified: st.mtimeMs, kind: folder ? 'folder' : kindOf(d.name) });
  }
  const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  out.sort((a, b) => (b.folder - a.folder) || byName.compare(a.name, b.name));
  return { items: out, more };
}

// ---------------------------------------------------------------- Recycle Bin
// Windows keeps each deleted file as $R<id><ext>, next to $I<id><ext>: where
// it came from, when it was deleted and how big it is. Format 2 (Windows 10
// and later): version, size, FILETIME, path length in characters (with the
// final NUL), the path in UTF-16. Format 1 (older): the path in a fixed
// 520-byte field.
const INFO_NAME = /^\$I[^\\/]+$/i;

function readInfo(file) {
  const b = fs.readFileSync(file);
  if (b.length < 28) return null;
  const version = Number(b.readBigInt64LE(0));
  const size = Number(b.readBigInt64LE(8));
  const filetime = b.readBigInt64LE(16);
  let from;
  if (version === 2) {
    const n = b.readInt32LE(24);
    if (n < 1 || 28 + n * 2 > b.length) return null;
    from = b.toString('utf16le', 28, 28 + (n - 1) * 2);
  } else if (version === 1) {
    from = b.toString('utf16le', 24, Math.min(b.length, 24 + 520)).replace(/\0[\s\S]*$/, '');
  } else return null;
  const deleted = Number(filetime / 10000n) - 11644473600000; // FILETIME (100 ns since 1601) to Unix ms
  return { from, size, deleted };
}

// An info file the screen sent back: only directly inside one of the bins.
function binEntry(bins, id) {
  if (typeof id !== 'string' || !INFO_NAME.test(path.basename(id))) return null;
  const dir = path.dirname(id);
  if (!bins.some((b) => path.relative(b, dir) === '')) return null;
  const data = path.join(dir, '$R' + path.basename(id).slice(2));
  return { info: id, data };
}

function binList(bins) {
  const items = [];
  for (const dir of bins) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; } // no bin on that drive yet
    for (const name of names) {
      if (!INFO_NAME.test(name)) continue;
      const info = path.join(dir, name);
      const data = path.join(dir, '$R' + name.slice(2));
      let meta;
      let st;
      try { meta = readInfo(info); st = fs.statSync(data); } catch { continue; }
      if (!meta) continue;
      const folder = st.isDirectory();
      items.push({ id: info, name: path.win32.basename(meta.from), from: path.win32.dirname(meta.from),
        deleted: meta.deleted, size: meta.size, folder, kind: folder ? 'folder' : kindOf(meta.from) });
    }
  }
  return items.sort((a, b) => b.deleted - a.deleted);
}

function freeName(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let n = 2; n < 1000; n++) {
    const next = `${base} (${n})${ext}`;
    if (!fs.existsSync(next)) return next;
  }
  throw new Error('No free name to restore it under');
}

// Back where it was deleted from; under "name (2)" if that name is taken.
function binRestore(bins, id) {
  const e = binEntry(bins, id);
  if (!e) throw new Error('bad argument');
  const meta = readInfo(e.info);
  if (!meta || !path.isAbsolute(meta.from)) throw new Error('Windows’ note for this file is damaged');
  const target = freeName(meta.from);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(e.data, target);
  fs.rmSync(e.info, { force: true });
  return target;
}

function binDelete(bins, id) {
  const e = binEntry(bins, id);
  if (!e) throw new Error('bad argument');
  fs.rmSync(e.data, { recursive: true, force: true, maxRetries: 2 });
  fs.rmSync(e.info, { force: true });
}

function binEmpty(bins) {
  let n = 0;
  for (const dir of bins) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/^\$[IR]/i.test(name)) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 2 });
      if (/^\$I/i.test(name)) n++;
    }
  }
  return n;
}

module.exports = { TYPES, mediaType, kindOf, check, list, readInfo, binList, binRestore, binDelete, binEmpty, inside };
