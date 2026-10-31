'use strict';
// Is WinTV drawing with the graphics card, and should it restart to get it
// back (D-47)? Chromium keeps drawing on whatever it started with: Windows'
// fallback renderer on a fresh install before the graphics driver arrives,
// or the CPU after its GPU process died a few times (a session switch can do
// that). Only a restart brings the card back. Plain Node, so it is tested
// without Electron.

const MICROSOFT = 0x1414;            // Windows' fallback renderer (Basic Render Driver, WARP)
const AGAIN_AFTER_MS = 10 * 60000;   // at most one restart in 10 minutes
const VERDICT_MS = 5 * 60000;        // a start this soon after a restart tells whether it helped

// info: app.getGPUInfo('basic'); status: app.getGPUFeatureStatus().
function software(info, status) {
  const devices = (info && info.gpuDevice) || [];
  const active = devices.find((d) => d.active) || devices[0];
  if (!active || active.vendorId === MICROSOFT) return true;
  return /^(disabled|unavailable)/.test(String((status && status.gpu_compositing) || ''));
}

// The adapters Windows has a real driver for (not its fallback, and
// working). The driver version is part of the key: a new driver may help
// where the old one didn't.
function realKeys(adapters) {
  return (adapters || []).filter((a) => a && !a.basic && a.ok).map((a) => `${a.id}|${a.driver || ''}`).sort();
}

const same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

// now: { software, adapters (realKeys; only looked up when software), onConsole, at, started }
// last: the record of the last restart { at, adapters, helped: null | true | false }, or null.
// Returns { restart, why, record? }: record is what to save (with a restart: when it happens).
function decide(now, last) {
  const lastAt = last ? Date.parse(last.at) : NaN;
  const afterRestart = !!last && last.helped == null && now.started >= lastAt && now.started - lastAt < VERDICT_MS;
  if (!now.software) {
    if (afterRestart) return { restart: false, why: 'drawing with the graphics card again after the restart', record: { ...last, helped: true } };
    return { restart: false, why: 'drawing with the graphics card' };
  }
  if (!now.adapters.length) return { restart: false, why: 'drawing without a graphics card: Windows has no driver for one yet' };
  const sameCard = !!last && same(last.adapters || [], now.adapters);
  if (!now.onConsole) return { restart: false, why: 'drawing without the graphics card; waiting until the TV is back on the screen' };
  if (afterRestart && sameCard) return { restart: false, why: 'a restart did not bring the graphics card back; staying as it is', record: { ...last, helped: false } };
  if (sameCard && last.helped === false) return { restart: false, why: 'drawing without the graphics card; a restart did not help with this driver before' };
  if (last && now.at - lastAt < AGAIN_AFTER_MS) return { restart: false, why: 'drawing without the graphics card; restarted less than 10 minutes ago' };
  return { restart: true, why: 'drawing without the graphics card although Windows has a driver for it: restarting when nobody is watching',
    record: { at: new Date(now.at).toISOString(), adapters: now.adapters, helped: null } };
}

const describe = (info) => ((info && info.gpuDevice) || []).map((d) => `${d.vendorId}:${d.deviceId}${d.active ? '*' : ''}`).join(' ') || 'none';

module.exports = { software, realKeys, decide, describe, AGAIN_AFTER_MS, VERDICT_MS };
