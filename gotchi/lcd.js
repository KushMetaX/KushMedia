/** 64×48 Tamagotchi framebuffer. Integer-scaled, nearest-neighbor only. */

export const LCD_W = 64;
export const LCD_H = 48;
export const ICON_H = 8;
export const PLAY_Y = 8;
export const PLAY_H = 32;
export const PLAY_BOTTOM = 40;

const ON = [0x2a, 0x2e, 0x10, 255];
const OFF = [0xc6, 0xd4, 0x4e, 255];

export function createLcd(canvas) {
  canvas.width = LCD_W;
  canvas.height = LCD_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  const buf = new Uint8Array(LCD_W * LCD_H);
  const image = ctx.createImageData(LCD_W, LCD_H);
  return { canvas, ctx, buf, image };
}

export function clear(lcd) {
  lcd.buf.fill(0);
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < LCD_W && y < LCD_H;
}

export function px(lcd, x, y, on = 1) {
  if (!inBounds(x, y)) return;
  lcd.buf[y * LCD_W + x] = on ? 1 : 0;
}

export function getPx(lcd, x, y) {
  if (!inBounds(x, y)) return 0;
  return lcd.buf[y * LCD_W + x];
}

export function fillRect(lcd, x, y, w, h, on = 1) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) px(lcd, x + i, y + j, on);
  }
}

export function hline(lcd, x, y, w, on = 1) {
  for (let i = 0; i < w; i++) px(lcd, x + i, y, on);
}

export function vline(lcd, x, y, h, on = 1) {
  for (let j = 0; j < h; j++) px(lcd, x, y + j, on);
}

export function rect(lcd, x, y, w, h, on = 1) {
  hline(lcd, x, y, w, on);
  hline(lcd, x, y + h - 1, w, on);
  vline(lcd, x, y, h, on);
  vline(lcd, x + w - 1, y, h, on);
}

export function invertRect(lcd, x, y, w, h) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const xx = x + i;
      const yy = y + j;
      if (inBounds(xx, yy)) {
        const iBuf = yy * LCD_W + xx;
        lcd.buf[iBuf] = lcd.buf[iBuf] ? 0 : 1;
      }
    }
  }
}

/** Blit a row-string sprite. `on` is the set of chars that light a pixel. */
export function blit(lcd, rows, x, y, opts = {}) {
  const onChars = opts.on || 'KFDBk';
  const flip = !!opts.flip;
  const h = rows.length;
  const w = rows[0] ? rows[0].length : 0;
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    for (let i = 0; i < w; i++) {
      const src = flip ? row[w - 1 - i] : row[i];
      if (src && onChars.indexOf(src) !== -1) px(lcd, x + i, y + j, 1);
    }
  }
}

export function spriteSize(rows) {
  return { w: rows[0] ? rows[0].length : 0, h: rows.length };
}

export function present(lcd) {
  const { buf, image, ctx } = lcd;
  const data = image.data;
  for (let i = 0, p = 0; i < buf.length; i++, p += 4) {
    const c = buf[i] ? ON : OFF;
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
