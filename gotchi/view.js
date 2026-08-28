import {
  LCD_W, PLAY_Y, PLAY_H, PLAY_BOTTOM, clear, px, hline, rect, invertRect, blit, spriteSize,
} from './lcd.js';
import * as S from './sprites.js';
import { isNight, isSleeping, lifeMinutes } from './game.js';

const ON = 'KFDBk';

function textWidth(str) {
  let w = 0;
  const s = String(str).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const g = S.FONT[s[i]] || S.FONT[' '];
    w += (g[0] ? g[0].length : 3) + 1;
  }
  return Math.max(0, w - 1);
}

export function drawText(lcd, str, x, y) {
  let cx = x;
  const s = String(str).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const g = S.FONT[s[i]] || S.FONT['?'];
    blit(lcd, g, cx, y, { on: 'K' });
    cx += (g[0] ? g[0].length : 3) + 1;
  }
  return cx;
}

export function drawTextCenter(lcd, str, y) {
  const w = textWidth(str);
  drawText(lcd, str, Math.max(0, Math.floor((LCD_W - w) / 2)), y);
}

function drawHearts(lcd, x, y, filled) {
  for (let i = 0; i < 4; i++) {
    blit(lcd, i < filled ? S.HEART : S.HEART_EMPTY, x + i * 6, y, { on: 'K' });
  }
}

function drawBars(lcd, x, y, filled) {
  for (let i = 0; i < 4; i++) {
    blit(lcd, i < filled ? S.BAR : S.BAR_EMPTY, x + i * 6, y, { on: 'K' });
  }
}

function iconPos(index) {
  if (index < 4) return { x: 2 + index * 16, y: 0 };
  return { x: 2 + (index - 4) * 16, y: 40 };
}

function drawIcons(lcd, state, now) {
  const names = ['food', 'lights', 'game', 'medicine', 'toilet', 'status', 'discipline', 'attention'];
  for (let i = 0; i < 8; i++) {
    const { x, y } = iconPos(i);
    const rows = S.ICONS[names[i]];
    const hideAttn = i === 7 && state.calling && Math.floor(now / 280) % 2 === 0;
    if (!hideAttn) blit(lcd, rows, x, y, { on: 'K' });
    if (state.screen === 'play' && i === state.icon && i < 7) {
      invertRect(lcd, x - 1, y, 10, 8);
    }
  }
}

function walkSprite(state) {
  if (state.stage === 'baby') return S.BABY_WALK;
  if (state.stage === 'child') {
    return state.pet === 'mary' ? S.MARY_WALK : S.CHILD_WALK;
  }
  return state.pet === 'mary' ? S.MARY_WALK : S.GARY_WALK;
}

function drawPet(lcd, state, now) {
  if (state.stage === 'egg') {
    const crack = state.anim && state.anim.type === 'egg' ? state.anim.crack : 0;
    const egg = crack >= 2 ? S.EGG_CRACK2 : crack >= 1 ? S.EGG_CRACK1 : S.EGG;
    const { w, h } = spriteSize(egg);
    const wig = Math.floor(now / 220) % 2 === 0 ? -1 : 1;
    blit(lcd, egg, Math.floor((LCD_W - w) / 2) + wig, PLAY_Y + PLAY_H - h - 1, { on: ON });
    return;
  }

  const sleeping = isSleeping(state);
  let rows = walkSprite(state);
  const blinking = !sleeping && Math.floor(now / 180) % 22 === 0;
  if (blinking || sleeping) rows = S.blinkSprite(rows);
  const { w, h } = spriteSize(rows);
  const ground = PLAY_BOTTOM - 1;
  let x = state.walkX;
  let y = ground - h;
  if (!sleeping) y -= state.walkBob;
  const flip = state.walkDir < 0;
  const shake = state.anim && state.anim.type === 'refuse' && now < state.anim.until
    ? (Math.floor(now / 80) % 2 ? 1 : -1)
    : 0;
  blit(lcd, rows, x + shake, y, { on: ON, flip });

  if (sleeping) {
    blit(lcd, S.ZZZ, x + (flip ? -8 : w + 1), y - 4, { on: 'K' });
  }
  if (state.sick && !(state.menu)) {
    blit(lcd, S.SKULL, x + Math.floor(w / 2) - 4, PLAY_Y + 1, { on: 'K' });
  }
  if (state.poops > 0 && !state.menu) {
    for (let i = 0; i < Math.min(state.poops, 3); i++) {
      blit(lcd, S.POOP, 4 + i * 10, ground - 5, { on: 'K' });
    }
  }
  if (state.anim && state.anim.type === 'eat' && now < state.anim.until) {
    const food = state.anim.food === 'snack' ? S.CAKE : S.HAMBURGER;
    blit(lcd, food, x + (flip ? -11 : w + 1), y + 4, { on: 'K' });
  }
}

function drawTitle(lcd) {
  drawTextCenter(lcd, 'DOGINAL', PLAY_Y + 6);
  drawTextCenter(lcd, 'GOTCHI', PLAY_Y + 14);
  drawTextCenter(lcd, 'PRESS B', PLAY_Y + 24);
}

function drawContinue(lcd, state) {
  drawTextCenter(lcd, 'SAVE?', PLAY_Y + 4);
  const keepY = PLAY_Y + 14;
  const newY = PLAY_Y + 22;
  drawTextCenter(lcd, 'KEEP', keepY);
  drawTextCenter(lcd, 'NEW', newY);
  const y = state.keepChoice === 'keep' ? keepY : newY;
  drawText(lcd, '>', 14, y);
}

function drawSelect(lcd, state) {
  const name = state.pet === 'mary' ? 'MARY' : 'GARY';
  drawTextCenter(lcd, name, PLAY_Y + 1);
  const portrait = state.pet === 'mary' ? S.MARY_25 : S.GARY_25;
  const { w, h } = spriteSize(portrait);
  blit(lcd, portrait, Math.floor((LCD_W - w) / 2), PLAY_Y + PLAY_H - h, { on: ON });
  drawText(lcd, '<', 2, PLAY_Y + 14);
  drawText(lcd, '>', 58, PLAY_Y + 14);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function drawClock(lcd, state, now) {
  drawTextCenter(lcd, 'SET CLOCK', PLAY_Y + 4);
  const label = pad2(state.clockH) + ':' + pad2(state.clockM);
  const x = Math.floor((LCD_W - textWidth(label)) / 2);
  drawText(lcd, label, x, PLAY_Y + 16);
  if (Math.floor(now / 400) % 2 === 0) {
    const under = state.clockField === 0 ? x : x + textWidth(pad2(state.clockH) + ':');
    const w = textWidth(state.clockField === 0 ? pad2(state.clockH) : pad2(state.clockM));
    hline(lcd, under, PLAY_Y + 22, w, 1);
  }
  drawTextCenter(lcd, 'A CHG  B OK', PLAY_Y + 25);
}

function drawFoodMenu(lcd, state) {
  drawTextCenter(lcd, 'FOOD', PLAY_Y + 2);
  blit(lcd, S.HAMBURGER, 10, PLAY_Y + 10, { on: 'K' });
  blit(lcd, S.CAKE, 40, PLAY_Y + 10, { on: 'K' });
  drawText(lcd, 'MEAL', 8, PLAY_Y + 20);
  drawText(lcd, 'SNACK', 34, PLAY_Y + 20);
  const x = state.menuOpt === 0 ? 6 : 32;
  rect(lcd, x, PLAY_Y + 8, 26, 20);
}

function drawGame(lcd, state) {
  const g = state.game;
  if (!g) return;
  if (g.phase === 'done') {
    drawTextCenter(lcd, g.wins + '/5', PLAY_Y + 8);
    drawTextCenter(lcd, g.wins >= 3 ? 'WIN' : 'LOSE', PLAY_Y + 16);
    drawTextCenter(lcd, 'PRESS B', PLAY_Y + 24);
    return;
  }
  drawTextCenter(lcd, 'R' + (g.round + 1) + '  ' + g.wins + 'OK', PLAY_Y + 2);
  const face = g.phase === 'reveal' ? g.face : 0;
  const rows = S.blinkSprite(state.pet === 'mary' && state.stage !== 'baby' ? S.MARY_WALK : S.GARY_WALK);
  const { w, h } = spriteSize(rows);
  const flip = face < 0;
  blit(lcd, rows, Math.floor((LCD_W - w) / 2), PLAY_Y + PLAY_H - h - 1, { on: ON, flip });
  if (g.phase === 'wait') {
    drawText(lcd, 'A', 4, PLAY_Y + 14);
    drawText(lcd, 'C', 56, PLAY_Y + 14);
  } else {
    drawTextCenter(lcd, face === g.pick ? 'YES' : 'NO', PLAY_Y + 10);
  }
}

function drawStatus(lcd, state) {
  const page = state.statusPage;
  if (page === 0) {
    drawTextCenter(lcd, state.pet === 'mary' ? 'MARY' : 'GARY', PLAY_Y + 3);
    drawTextCenter(lcd, 'AGE ' + Math.floor(lifeMinutes(state) / (24 * 60)), PLAY_Y + 11);
    drawTextCenter(lcd, state.weight + 'G', PLAY_Y + 19);
    drawTextCenter(lcd, state.pet === 'mary' ? 'GIRL' : 'BOY', PLAY_Y + 26);
    return;
  }
  if (page === 1) {
    drawText(lcd, 'HUNGRY', 4, PLAY_Y + 4);
    drawHearts(lcd, 20, PLAY_Y + 12, state.hunger);
    drawText(lcd, 'HAPPY', 4, PLAY_Y + 18);
    drawHearts(lcd, 20, PLAY_Y + 26, state.happy);
    return;
  }
  drawText(lcd, 'DISC', 4, PLAY_Y + 4);
  drawBars(lcd, 20, PLAY_Y + 12, state.discipline);
  drawTextCenter(lcd, pad2(state.clockH) + ':' + pad2(state.clockM), PLAY_Y + 22);
}

function drawDiscipline(lcd) {
  drawTextCenter(lcd, 'SCOLD?', PLAY_Y + 10);
  drawTextCenter(lcd, 'PRESS B', PLAY_Y + 20);
}

function drawDead(lcd, state) {
  const { w, h } = spriteSize(S.ANGEL);
  blit(lcd, S.ANGEL, Math.floor((LCD_W - w) / 2), PLAY_Y + 2, { on: ON });
  drawTextCenter(lcd, 'AGE ' + state.deathAge, PLAY_Y + 24);
}

export function drawFrame(lcd, state, now) {
  clear(lcd);
  drawIcons(lcd, state, now);

  if (state.screen === 'title') drawTitle(lcd);
  else if (state.screen === 'continue') drawContinue(lcd, state);
  else if (state.screen === 'select') drawSelect(lcd, state);
  else if (state.screen === 'clock') drawClock(lcd, state, now);
  else if (state.screen === 'dead') drawDead(lcd, state);
  else if (state.menu === 'food') drawFoodMenu(lcd, state);
  else if (state.menu === 'game') drawGame(lcd, state);
  else if (state.menu === 'status') drawStatus(lcd, state);
  else if (state.menu === 'discipline') drawDiscipline(lcd);
  else {
    if (isNight(state) && !state.lightsOn) {
      for (let y = PLAY_Y; y < PLAY_BOTTOM; y++) {
        for (let x = 0; x < LCD_W; x++) px(lcd, x, y, 1);
      }
      if (state.stage !== 'egg') {
        const rows = S.blinkSprite(walkSprite(state));
        const { w, h } = spriteSize(rows);
        blit(lcd, rows, state.walkX, PLAY_BOTTOM - 1 - h, { on: '', flip: state.walkDir < 0 });
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const ch = rows[j][state.walkDir < 0 ? w - 1 - i : i];
            if (ch && ON.indexOf(ch) !== -1) px(lcd, state.walkX + i, PLAY_BOTTOM - 1 - h + j, 0);
          }
        }
        blit(lcd, S.ZZZ, state.walkX + w + 1, PLAY_Y + 6, { on: '' });
        const z = S.ZZZ;
        for (let j = 0; j < z.length; j++) {
          for (let i = 0; i < z[j].length; i++) {
            if (z[j][i] === 'K') px(lcd, state.walkX + w + 1 + i, PLAY_Y + 6 + j, 0);
          }
        }
      }
    } else {
      hline(lcd, 0, PLAY_BOTTOM - 1, LCD_W, 1);
      drawPet(lcd, state, now);
    }
  }
}

export function stepWalk(state, now) {
  if (state.screen !== 'play' || state.stage === 'egg' || state.stage === 'dead') return;
  if (state.menu || isSleeping(state)) return;
  const rows = walkSprite(state);
  const { w } = spriteSize(rows);
  state.walkBob = state.walkBob ? 0 : 1;
  state.walkX += state.walkDir;
  if (state.walkX <= 2) {
    state.walkX = 2;
    state.walkDir = 1;
  }
  if (state.walkX + w >= LCD_W - 2) {
    state.walkX = LCD_W - 2 - w;
    state.walkDir = -1;
  }
  if (state.anim && state.anim.until && now > state.anim.until) {
    if (state.anim.type !== 'egg') state.anim = null;
  }
}
