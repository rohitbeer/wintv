'use strict';
// The household's WinTV settings that change how WinTV's own screens look
// and sound (D-31): navigation sounds, text size, reduce motion, high
// contrast. Shared by both windows, the home screen and the system layer;
// loaded before app.js / layer.js. main.js sends the values, this applies them.

const TEXT_SCALE = { default: 1, large: 1.2, larger: 1.4 };
const NAV_GAIN = { off: 0, soft: 0.45, normal: 1, loud: 2.2 };
const look = { gain: 1, still: false };
// Windows' own "Animation effects" switch counts as reduce motion too,
// whoever turned it off (Chromium reports it as prefers-reduced-motion).
const systemStill = matchMedia('(prefers-reduced-motion: reduce)');
let lastLook = null;

function applyLook(p) {
  if (!p) return;
  lastLook = p;
  const still = !!p.reduceMotion || systemStill.matches;
  document.documentElement.style.setProperty('--ts', String(TEXT_SCALE[p.textSize] || 1));
  document.body.classList.toggle('reduce-motion', still);
  document.body.classList.toggle('high-contrast', !!p.highContrast);
  look.gain = NAV_GAIN[p.navSounds] ?? 1;
  look.still = still;
}
systemStill.addEventListener('change', () => applyLook(lastLook));

// Navigation sounds: short synthesized ticks, at the chosen level.
let audio = null;
function tone(freq, ms, gain) {
  if (!look.gain) return;
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain * look.gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio device is fine */ }
}
