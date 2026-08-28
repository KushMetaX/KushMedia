/** WebAudio square-wave beeps. Unlocked on first user gesture. */

let ctx = null;
let muted = false;
let unlocked = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio() {
  const audio = ac();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  unlocked = true;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
}

export function toggleMute() {
  muted = !muted;
  return muted;
}

function beep(freq, dur, when = 0, vol = 0.07) {
  if (muted) return;
  const audio = ac();
  if (!audio || audio.state !== 'running') return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audio.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + when + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(audio.currentTime + when);
  osc.stop(audio.currentTime + when + dur + 0.02);
}

export function click() {
  beep(880, 0.04, 0, 0.05);
}

export function back() {
  beep(440, 0.05, 0, 0.05);
}

export function callBeep() {
  beep(980, 0.08, 0, 0.08);
  beep(720, 0.08, 0.1, 0.08);
}

export function eat() {
  beep(520, 0.06);
  beep(640, 0.06, 0.07);
}

export function flush() {
  beep(300, 0.12);
  beep(220, 0.16, 0.1);
}

export function heal() {
  beep(660, 0.07);
  beep(880, 0.1, 0.08);
}

export function hatch() {
  beep(523, 0.08);
  beep(659, 0.08, 0.1);
  beep(784, 0.16, 0.2);
}

export function win() {
  beep(784, 0.08);
  beep(988, 0.12, 0.1);
}

export function lose() {
  beep(330, 0.16);
}

export function death() {
  beep(392, 0.18);
  beep(311, 0.22, 0.2);
  beep(247, 0.4, 0.42);
}

export function refuse() {
  beep(200, 0.1);
}

export function isUnlocked() {
  return unlocked;
}
