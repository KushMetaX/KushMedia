import { createLcd, present, LCD_W, LCD_H } from './lcd.js';
import * as audio from './audio.js';
import {
  createTitleState, tickMinute, pressA, pressB, pressC, saveState, resetGame,
  snapshot, MS_PER_MIN, isSleeping,
} from './game.js';
import { drawFrame, stepWalk } from './view.js';

const params = new URLSearchParams(location.search);
const embed = params.get('embed') === '1' || window !== window.top;
if (embed) document.documentElement.classList.add('embed');

const state = createTitleState();
const canvas = document.getElementById('lcd');
const lcd = createLcd(canvas);
const egg = document.getElementById('egg');
const btnA = document.getElementById('btnA');
const btnB = document.getElementById('btnB');
const btnC = document.getElementById('btnC');
const muteBtn = document.getElementById('muteBtn');
const resetBtn = document.getElementById('resetBtn');
const speedBtn = document.getElementById('speedBtn');

let speed = 1;
let lastTick = performance.now();
let lastWalk = performance.now();
let lastCall = 0;
let lastSave = performance.now();
let hidden = document.hidden;

function applyPetShell() {
  egg.dataset.pet = state.pet;
}

function playSfx(name) {
  if (name === 'click') audio.click();
  else if (name === 'back') audio.back();
  else if (name === 'eat') audio.eat();
  else if (name === 'flush') audio.flush();
  else if (name === 'heal') audio.heal();
  else if (name === 'hatch') audio.hatch();
  else if (name === 'win') audio.win();
  else if (name === 'lose') audio.lose();
  else if (name === 'refuse') audio.refuse();
}

function tap(which) {
  audio.unlockAudio();
  let sfx = 'ignore';
  if (which === 'A') sfx = pressA(state);
  else if (which === 'B') sfx = pressB(state);
  else sfx = pressC(state);
  playSfx(sfx);
  applyPetShell();
  if (state.anim && state.anim.type === 'hatch') audio.hatch();
}

function bindButton(el, which) {
  const fire = (ev) => {
    ev.preventDefault();
    el.classList.add('is-down');
    tap(which);
  };
  const up = () => el.classList.remove('is-down');
  el.addEventListener('pointerdown', fire);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}

bindButton(btnA, 'A');
bindButton(btnB, 'B');
bindButton(btnC, 'C');

window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = ev.key;
  if (k === 'a' || k === 'A' || k === 'ArrowLeft') {
    ev.preventDefault();
    tap('A');
  } else if (k === 's' || k === 'S' || k === ' ' || k === 'Enter') {
    ev.preventDefault();
    tap('B');
  } else if (k === 'd' || k === 'D' || k === 'ArrowRight' || k === 'Escape') {
    if (k === 'Escape' && document.body.classList.contains('menu-open')) return;
    ev.preventDefault();
    tap('C');
  }
});

muteBtn.addEventListener('click', () => {
  audio.unlockAudio();
  const muted = audio.toggleMute();
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn.textContent = muted ? 'Muted' : 'Mute';
});

resetBtn.addEventListener('click', () => {
  if (!confirm('Reset Doginal Gotchi? This clears the saved pet.')) return;
  Object.assign(state, resetGame());
  applyPetShell();
});

speedBtn.addEventListener('click', () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  speedBtn.textContent = speed + 'x';
});

function persist() {
  if (state.screen === 'play' || state.screen === 'dead') {
    saveState(snapshot(state));
  }
}

document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (hidden) persist();
  lastTick = performance.now();
  lastWalk = performance.now();
});

window.addEventListener('pagehide', () => persist());

function fitLcd() {
  const host = document.querySelector('.bezel-glass');
  if (!host) return;
  const maxW = host.clientWidth;
  const maxH = host.clientHeight;
  const s = Math.max(3, Math.floor(Math.min(maxW / LCD_W, maxH / LCD_H)));
  canvas.style.width = LCD_W * s + 'px';
  canvas.style.height = LCD_H * s + 'px';
}

window.addEventListener('resize', fitLcd);
fitLcd();

function loop(now) {
  if (!hidden) {
    const tickEvery = MS_PER_MIN / speed;
    while (now - lastTick >= tickEvery) {
      const before = state.stage;
      tickMinute(state);
      lastTick += tickEvery;
      if (before === 'egg' && state.stage === 'baby') audio.hatch();
      if (state.screen === 'dead' && state.anim && state.anim.type === 'dead') {
        audio.death();
        state.anim = { type: 'dead-done' };
      }
    }
    if (now - lastWalk >= 280 / Math.max(1, speed * 0.5)) {
      stepWalk(state, now);
      lastWalk = now;
    }
    if (state.calling && !isSleeping(state) && now - lastCall > 1600) {
      audio.callBeep();
      lastCall = now;
    }
    if (now - lastSave > 15000) {
      persist();
      lastSave = now;
    }
  } else {
    lastTick = now;
    lastWalk = now;
  }

  applyPetShell();
  drawFrame(lcd, state, now);
  present(lcd);
  requestAnimationFrame(loop);
}

applyPetShell();
requestAnimationFrame(loop);
