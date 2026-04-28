import { hexToRgb, mixHex, shiftHex } from './sample-data.js';

const NAIL_CANVAS_WIDTH = 380;
const NAIL_CANVAS_HEIGHT = 560;

const imageCache = new Map();

/* ─── Helpers ────────────────────────────────────────── */

function prepareCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function hexToRgba(color, alpha) {
  const rgb = hexToRgb(color);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function roundedRect(ctx, x, y, w, h, r) {
  const safe = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + safe, y);
  ctx.lineTo(x + w - safe, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + safe);
  ctx.lineTo(x + w, y + h - safe);
  ctx.quadraticCurveTo(x + w, y + h, x + w - safe, y + h);
  ctx.lineTo(x + safe, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - safe);
  ctx.lineTo(x, y + safe);
  ctx.quadraticCurveTo(x, y, x + safe, y);
  ctx.closePath();
}

function loadImage(src) {
  if (!src) return Promise.reject(new Error('No image source'));
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

/* ─── Nail shape paths (tip at top, cuticle at bottom) ─── */

function createNailPath(ctx, x, y, w, h, shape = 'almond') {
  ctx.beginPath();
  switch (shape) {
    case 'coffin':
      ctx.moveTo(x + w * 0.15, y + h);
      ctx.bezierCurveTo(x + w * 0.06, y + h * 0.72, x + w * 0.1, y + h * 0.36, x + w * 0.26, y + h * 0.08);
      ctx.quadraticCurveTo(x + w * 0.34, y + h * 0.015, x + w * 0.38, y + h * 0.01);
      ctx.lineTo(x + w * 0.62, y + h * 0.01);
      ctx.quadraticCurveTo(x + w * 0.66, y + h * 0.015, x + w * 0.74, y + h * 0.08);
      ctx.bezierCurveTo(x + w * 0.9, y + h * 0.36, x + w * 0.94, y + h * 0.72, x + w * 0.85, y + h);
      ctx.closePath();
      return;
    case 'stiletto':
      ctx.moveTo(x + w * 0.13, y + h);
      ctx.bezierCurveTo(x + w * 0.04, y + h * 0.66, x + w * 0.16, y + h * 0.28, x + w * 0.36, y + h * 0.08);
      ctx.quadraticCurveTo(x + w * 0.48, y, x + w * 0.5, y);
      ctx.quadraticCurveTo(x + w * 0.52, y, x + w * 0.64, y + h * 0.08);
      ctx.bezierCurveTo(x + w * 0.84, y + h * 0.28, x + w * 0.96, y + h * 0.66, x + w * 0.87, y + h);
      ctx.closePath();
      return;
    case 'round':
      ctx.moveTo(x + w * 0.12, y + h);
      ctx.bezierCurveTo(x + w * 0.04, y + h * 0.7, x + w * 0.07, y + h * 0.3, x + w * 0.22, y + h * 0.1);
      ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.02, x + w * 0.78, y + h * 0.1);
      ctx.bezierCurveTo(x + w * 0.93, y + h * 0.3, x + w * 0.96, y + h * 0.7, x + w * 0.88, y + h);
      ctx.closePath();
      return;
    case 'oval':
      ctx.moveTo(x + w * 0.13, y + h);
      ctx.bezierCurveTo(x + w * 0.05, y + h * 0.72, x + w * 0.09, y + h * 0.28, x + w * 0.26, y + h * 0.07);
      ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.01, x + w * 0.74, y + h * 0.07);
      ctx.bezierCurveTo(x + w * 0.91, y + h * 0.28, x + w * 0.95, y + h * 0.72, x + w * 0.87, y + h);
      ctx.closePath();
      return;
    case 'square':
      ctx.moveTo(x + w * 0.14, y + h);
      ctx.bezierCurveTo(x + w * 0.07, y + h * 0.72, x + w * 0.1, y + h * 0.32, x + w * 0.16, y + h * 0.06);
      ctx.lineTo(x + w * 0.18, y + h * 0.015);
      ctx.lineTo(x + w * 0.82, y + h * 0.015);
      ctx.lineTo(x + w * 0.84, y + h * 0.06);
      ctx.bezierCurveTo(x + w * 0.9, y + h * 0.32, x + w * 0.93, y + h * 0.72, x + w * 0.86, y + h);
      ctx.closePath();
      return;
    case 'ballerina':
      ctx.moveTo(x + w * 0.14, y + h);
      ctx.bezierCurveTo(x + w * 0.06, y + h * 0.7, x + w * 0.1, y + h * 0.34, x + w * 0.25, y + h * 0.08);
      ctx.quadraticCurveTo(x + w * 0.32, y + h * 0.02, x + w * 0.37, y + h * 0.012);
      ctx.lineTo(x + w * 0.63, y + h * 0.012);
      ctx.quadraticCurveTo(x + w * 0.68, y + h * 0.02, x + w * 0.75, y + h * 0.08);
      ctx.bezierCurveTo(x + w * 0.9, y + h * 0.34, x + w * 0.94, y + h * 0.7, x + w * 0.86, y + h);
      ctx.closePath();
      return;
    case 'squoval':
      ctx.moveTo(x + w * 0.13, y + h);
      ctx.bezierCurveTo(x + w * 0.06, y + h * 0.72, x + w * 0.09, y + h * 0.3, x + w * 0.2, y + h * 0.07);
      ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.012, x + w * 0.38, y + h * 0.012);
      ctx.lineTo(x + w * 0.62, y + h * 0.012);
      ctx.quadraticCurveTo(x + w * 0.7, y + h * 0.012, x + w * 0.8, y + h * 0.07);
      ctx.bezierCurveTo(x + w * 0.91, y + h * 0.3, x + w * 0.94, y + h * 0.72, x + w * 0.87, y + h);
      ctx.closePath();
      return;
    default: // almond
      ctx.moveTo(x + w * 0.14, y + h);
      ctx.bezierCurveTo(x + w * 0.05, y + h * 0.7, x + w * 0.1, y + h * 0.3, x + w * 0.26, y + h * 0.09);
      ctx.quadraticCurveTo(x + w * 0.42, y + h * 0.008, x + w * 0.5, y);
      ctx.quadraticCurveTo(x + w * 0.58, y + h * 0.008, x + w * 0.74, y + h * 0.09);
      ctx.bezierCurveTo(x + w * 0.9, y + h * 0.3, x + w * 0.95, y + h * 0.7, x + w * 0.86, y + h);
      ctx.closePath();
  }
}

/* ─── Background & Skin ─────────────────────────────── */

function drawBackdrop(ctx, descriptor) {
  const bg = ctx.createLinearGradient(0, 0, 0, NAIL_CANVAS_HEIGHT);
  bg.addColorStop(0, '#faf7f2');
  bg.addColorStop(0.6, '#f3ede4');
  bg.addColorStop(1, '#ece5da');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, NAIL_CANVAS_WIDTH, NAIL_CANVAS_HEIGHT);

  const ambient = ctx.createRadialGradient(
    NAIL_CANVAS_WIDTH / 2, NAIL_CANVAS_HEIGHT * 0.32, 10,
    NAIL_CANVAS_WIDTH / 2, NAIL_CANVAS_HEIGHT * 0.32, NAIL_CANVAS_WIDTH * 0.7
  );
  ambient.addColorStop(0, hexToRgba(descriptor.accentColor, 0.07));
  ambient.addColorStop(0.5, hexToRgba(descriptor.baseColor, 0.03));
  ambient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, NAIL_CANVAS_WIDTH, NAIL_CANVAS_HEIGHT);
}

function drawFingerSkin(ctx, bounds) {
  const skinTop = bounds.y + bounds.height - 6;
  const skinH = 62;
  const cx = bounds.x + bounds.width / 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bounds.x - 18, skinTop);
  ctx.lineTo(bounds.x + bounds.width + 18, skinTop);
  ctx.lineTo(bounds.x + bounds.width + 22, skinTop + skinH);
  ctx.quadraticCurveTo(cx, skinTop + skinH + 20, bounds.x - 22, skinTop + skinH);
  ctx.closePath();

  const skin = ctx.createLinearGradient(0, skinTop, 0, skinTop + skinH + 20);
  skin.addColorStop(0, '#e8c9b0');
  skin.addColorStop(0.45, '#dbb99d');
  skin.addColorStop(1, '#d4ad8e');
  ctx.fillStyle = skin;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.1, skinTop + 2);
  ctx.quadraticCurveTo(cx, skinTop - 7, bounds.x + bounds.width * 0.9, skinTop + 2);
  ctx.strokeStyle = 'rgba(148, 110, 82, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/* ─── Nail shadow ────────────────────────────────────── */

function drawNailShadow(ctx, bounds, shape, accentColor) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 12;
  createNailPath(ctx, bounds.x, bounds.y + 4, bounds.width, bounds.height, shape);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.06;
  const reflected = ctx.createRadialGradient(
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.82, 10,
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.82, bounds.width * 0.6
  );
  reflected.addColorStop(0, accentColor);
  reflected.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = reflected;
  ctx.fillRect(bounds.x - 20, bounds.y + bounds.height * 0.5, bounds.width + 40, bounds.height);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ─── Base surface ───────────────────────────────────── */

function drawNailBed(ctx, bounds) {
  const bed = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x, bounds.y + bounds.height);
  bed.addColorStop(0, '#f5d5c8');
  bed.addColorStop(0.7, '#f0c4b0');
  bed.addColorStop(1, '#eab8a0');
  ctx.fillStyle = bed;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawBaseSurface(ctx, descriptor, bounds) {
  const creamyBase = mixHex(descriptor.baseColor, '#f4ddc8', 0.18);

  const baseGrad = ctx.createLinearGradient(
    bounds.x, bounds.y,
    bounds.x + bounds.width * 0.6, bounds.y + bounds.height
  );
  baseGrad.addColorStop(0, shiftHex(creamyBase, 0.06));
  baseGrad.addColorStop(0.5, descriptor.baseColor);
  baseGrad.addColorStop(1, shiftHex(descriptor.secondaryColor || descriptor.baseColor, -0.04));
  ctx.fillStyle = baseGrad;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  const lunula = ctx.createRadialGradient(
    bounds.x + bounds.width / 2, bounds.y + bounds.height + 10,
    bounds.width * 0.15,
    bounds.x + bounds.width / 2, bounds.y + bounds.height + 10,
    bounds.width * 0.55
  );
  lunula.addColorStop(0, 'rgba(255,255,255,0.2)');
  lunula.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  lunula.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lunula;
  ctx.fillRect(bounds.x, bounds.y + bounds.height * 0.7, bounds.width, bounds.height * 0.35);

  const depth = ctx.createRadialGradient(
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.4, bounds.width * 0.2,
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.4, bounds.width * 0.7
  );
  depth.addColorStop(0, 'rgba(255,255,255,0)');
  depth.addColorStop(0.6, 'rgba(0,0,0,0.02)');
  depth.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = depth;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

/* ─── Specular & Gloss ───────────────────────────────── */

function drawSpecularHighlight(ctx, bounds, finish) {
  if (finish === 'matte') return;

  const intensity = finish === 'chrome' ? 0.58 : finish === 'glazed' ? 0.4 : 0.28;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.02);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.22, bounds.y + bounds.height * 0.5,
    bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.92
  );
  ctx.lineTo(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.92);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.38, bounds.y + bounds.height * 0.5,
    bounds.x + bounds.width * 0.36, bounds.y + bounds.height * 0.02
  );
  ctx.closePath();

  const stripGrad = ctx.createLinearGradient(
    bounds.x + bounds.width * 0.2, bounds.y,
    bounds.x + bounds.width * 0.42, bounds.y + bounds.height
  );
  stripGrad.addColorStop(0, `rgba(255,255,255,${intensity})`);
  stripGrad.addColorStop(0.25, `rgba(255,255,255,${intensity * 0.55})`);
  stripGrad.addColorStop(0.5, `rgba(255,255,255,${intensity * 0.25})`);
  stripGrad.addColorStop(0.8, `rgba(255,255,255,${intensity * 0.12})`);
  stripGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = stripGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.24, bounds.y + bounds.height * 0.04);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.4,
    bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.78
  );
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = `rgba(255,255,255,${intensity * 0.65})`;
  ctx.stroke();

  const topBloom = ctx.createRadialGradient(
    bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.06, 3,
    bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.06, bounds.width * 0.28
  );
  topBloom.addColorStop(0, `rgba(255,255,255,${intensity * 0.75})`);
  topBloom.addColorStop(0.4, `rgba(255,255,255,${intensity * 0.18})`);
  topBloom.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topBloom;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height * 0.3);

  ctx.restore();
}

function drawGloss(ctx, bounds, finish) {
  if (finish === 'matte') {
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    return;
  }

  const gloss = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width * 0.4, bounds.y + bounds.height);
  gloss.addColorStop(0, 'rgba(255,255,255,0.06)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

/* ─── Design motifs ──────────────────────────────────── */

function drawAuraBloom(ctx, bounds, color, intensity = 0.2) {
  const bloom = ctx.createRadialGradient(
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35, bounds.width * 0.04,
    bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35, bounds.width * 0.55
  );
  bloom.addColorStop(0, hexToRgba(color, 0.32 * intensity));
  bloom.addColorStop(0.5, hexToRgba(color, 0.12 * intensity));
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawMicroFrench(ctx, bounds, descriptor) {
  const tipDepth = bounds.height * (0.1 + descriptor.detailLevel * 0.06);
  const tipColor = descriptor.tipColor || descriptor.accentColor;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.08, bounds.y + tipDepth * 1.2);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.5, bounds.y - tipDepth * 0.15,
    bounds.x + bounds.width * 0.92, bounds.y + tipDepth * 1.2
  );
  ctx.lineTo(bounds.x + bounds.width * 0.92, bounds.y);
  ctx.lineTo(bounds.x + bounds.width * 0.08, bounds.y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(tipColor, 0.92);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.14, bounds.y + tipDepth * 1.15);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.5, bounds.y + tipDepth * 0.2,
    bounds.x + bounds.width * 0.86, bounds.y + tipDepth * 1.15
  );
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawOmbreGradient(ctx, bounds, descriptor) {
  const tipColor = descriptor.tipColor || descriptor.accentColor;

  const grad = ctx.createLinearGradient(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y);
  grad.addColorStop(0, hexToRgba(descriptor.baseColor, 0.08));
  grad.addColorStop(0.3, hexToRgba(mixHex(descriptor.baseColor, tipColor, 0.4), 0.5));
  grad.addColorStop(0.6, hexToRgba(tipColor, 0.78));
  grad.addColorStop(1, hexToRgba(shiftHex(tipColor, 0.1), 0.92));
  ctx.fillStyle = grad;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawMarbleTexture(ctx, bounds, descriptor) {
  const veinColor = hexToRgba(descriptor.accentColor, 0.22);
  const highlight = hexToRgba('#ffffff', 0.14);

  ctx.fillStyle = hexToRgba('#ffffff', 0.18);
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.save();
  ctx.lineCap = 'round';

  const veins = [
    { s: [0.1, 0.2], c1: [0.3, 0.35], c2: [0.5, 0.15], e: [0.85, 0.3], w: 2.5 },
    { s: [0.0, 0.5], c1: [0.25, 0.42], c2: [0.6, 0.58], e: [0.95, 0.45], w: 1.8 },
    { s: [0.15, 0.7], c1: [0.35, 0.62], c2: [0.7, 0.78], e: [0.9, 0.65], w: 2.2 },
    { s: [0.05, 0.35], c1: [0.2, 0.55], c2: [0.45, 0.3], e: [0.75, 0.5], w: 1.2 },
    { s: [0.2, 0.85], c1: [0.4, 0.75], c2: [0.55, 0.9], e: [0.85, 0.8], w: 1.5 },
  ];

  for (const v of veins) {
    ctx.beginPath();
    ctx.moveTo(bounds.x + bounds.width * v.s[0], bounds.y + bounds.height * v.s[1]);
    ctx.bezierCurveTo(
      bounds.x + bounds.width * v.c1[0], bounds.y + bounds.height * v.c1[1],
      bounds.x + bounds.width * v.c2[0], bounds.y + bounds.height * v.c2[1],
      bounds.x + bounds.width * v.e[0], bounds.y + bounds.height * v.e[1]
    );
    ctx.lineWidth = v.w;
    ctx.strokeStyle = veinColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bounds.x + bounds.width * v.s[0] + 2, bounds.y + bounds.height * v.s[1] - 1);
    ctx.bezierCurveTo(
      bounds.x + bounds.width * v.c1[0] + 2, bounds.y + bounds.height * v.c1[1] - 1,
      bounds.x + bounds.width * v.c2[0] + 2, bounds.y + bounds.height * v.c2[1] - 1,
      bounds.x + bounds.width * v.e[0] + 2, bounds.y + bounds.height * v.e[1] - 1
    );
    ctx.lineWidth = v.w * 0.5;
    ctx.strokeStyle = highlight;
    ctx.stroke();
  }

  ctx.restore();
}

function drawChromeSweep(ctx, bounds, descriptor, design) {
  const foil = descriptor.foilColor || design.style.accentColor;

  const chromeGrad = ctx.createLinearGradient(
    bounds.x - 10, bounds.y + 20,
    bounds.x + bounds.width + 20, bounds.y + bounds.height - 20
  );
  chromeGrad.addColorStop(0.0, hexToRgba('#242424', 0.4));
  chromeGrad.addColorStop(0.15, hexToRgba(foil, 0.6));
  chromeGrad.addColorStop(0.3, hexToRgba('#ffffff', 0.7));
  chromeGrad.addColorStop(0.45, hexToRgba(foil, 0.8));
  chromeGrad.addColorStop(0.6, hexToRgba('#ffffff', 0.5));
  chromeGrad.addColorStop(0.75, hexToRgba(shiftHex(foil, -0.15), 0.7));
  chromeGrad.addColorStop(0.9, hexToRgba('#ffffff', 0.3));
  chromeGrad.addColorStop(1.0, hexToRgba('#1a1a1a', 0.3));
  ctx.fillStyle = chromeGrad;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  const cross = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y);
  cross.addColorStop(0, 'rgba(0,0,0,0.15)');
  cross.addColorStop(0.3, 'rgba(255,255,255,0.1)');
  cross.addColorStop(0.5, 'rgba(255,255,255,0)');
  cross.addColorStop(0.8, 'rgba(0,0,0,0.08)');
  cross.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = cross;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawAirbrushCloud(ctx, bounds, descriptor) {
  const spots = [
    [0.3, 0.2, 0.32, 0.42],
    [0.65, 0.35, 0.28, 0.32],
    [0.45, 0.6, 0.35, 0.28],
    [0.25, 0.45, 0.22, 0.22],
  ];

  for (const [xr, yr, size, alpha] of spots) {
    const bloom = ctx.createRadialGradient(
      bounds.x + bounds.width * xr, bounds.y + bounds.height * yr, 6,
      bounds.x + bounds.width * xr, bounds.y + bounds.height * yr, bounds.width * size
    );
    bloom.addColorStop(0, hexToRgba(descriptor.auraColor || descriptor.accentColor, alpha));
    bloom.addColorStop(0.6, hexToRgba(descriptor.tipColor || descriptor.accentColor, alpha * 0.4));
    bloom.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
}

function drawCatEyeBand(ctx, bounds, descriptor) {
  const band = ctx.createLinearGradient(
    bounds.x + bounds.width * 0.05, bounds.y + bounds.height * 0.9,
    bounds.x + bounds.width * 0.95, bounds.y + bounds.height * 0.1
  );
  band.addColorStop(0.15, 'rgba(255,255,255,0)');
  band.addColorStop(0.38, hexToRgba('#ffffff', 0.12));
  band.addColorStop(0.48, hexToRgba(descriptor.foilColor || descriptor.accentColor, 0.85));
  band.addColorStop(0.52, hexToRgba('#ffffff', 0.4));
  band.addColorStop(0.62, hexToRgba('#ffffff', 0.1));
  band.addColorStop(0.85, 'rgba(255,255,255,0)');
  ctx.fillStyle = band;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawTraitSwoop(ctx, bounds, descriptor) {
  ctx.save();
  ctx.fillStyle = hexToRgba(descriptor.tipColor || descriptor.accentColor, 0.6);
  ctx.beginPath();
  ctx.moveTo(bounds.x + bounds.width * 0.08, bounds.y + bounds.height * 0.55);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.32,
    bounds.x + bounds.width * 0.88, bounds.y + bounds.height * 0.25
  );
  ctx.lineTo(bounds.x + bounds.width * 0.88, bounds.y + bounds.height * 0.38);
  ctx.quadraticCurveTo(
    bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.46,
    bounds.x + bounds.width * 0.14, bounds.y + bounds.height * 0.65
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStickerBadge(ctx, bounds, descriptor) {
  const bw = bounds.width * 0.42;
  const bh = 34;
  const bx = bounds.x + bounds.width * 0.45;
  const by = bounds.y + bounds.height * 0.24;

  roundedRect(ctx, bx, by, bw, bh, 17);
  ctx.fillStyle = hexToRgba(descriptor.accentColor, 0.9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#050505';
  ctx.font = '700 11px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DOGINAL', bx + bw / 2, by + bh / 2);
}

function drawGemCluster(ctx, bounds, descriptor) {
  const total = Math.max(0, Math.min(6, descriptor.gemCount || 0));
  if (!total) return;

  const gems = [
    [0.66, 0.18, 9], [0.56, 0.27, 7], [0.74, 0.28, 6.5],
    [0.62, 0.35, 5.5], [0.76, 0.16, 5], [0.52, 0.15, 5]
  ].slice(0, total);

  for (const [xr, yr, radius] of gems) {
    const gx = bounds.x + bounds.width * xr;
    const gy = bounds.y + bounds.height * yr;

    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius * 2.5);
    glow.addColorStop(0, hexToRgba(descriptor.foilColor || descriptor.accentColor, 0.3));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(gx, gy, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    const gemGrad = ctx.createRadialGradient(gx - 2, gy - 2, 1, gx, gy, radius);
    gemGrad.addColorStop(0, '#ffffff');
    gemGrad.addColorStop(0.3, hexToRgba(descriptor.foilColor || descriptor.accentColor, 0.9));
    gemGrad.addColorStop(1, hexToRgba('#ffffff', 0.25));
    ctx.fillStyle = gemGrad;
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(gx - radius * 0.3, gy - radius * 0.3, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHolographic(ctx, bounds) {
  const holo = ctx.createLinearGradient(
    bounds.x, bounds.y,
    bounds.x + bounds.width, bounds.y + bounds.height
  );
  holo.addColorStop(0, 'rgba(255, 100, 100, 0.15)');
  holo.addColorStop(0.16, 'rgba(255, 180, 80, 0.12)');
  holo.addColorStop(0.33, 'rgba(255, 255, 100, 0.15)');
  holo.addColorStop(0.5, 'rgba(100, 255, 100, 0.12)');
  holo.addColorStop(0.66, 'rgba(100, 180, 255, 0.15)');
  holo.addColorStop(0.83, 'rgba(180, 100, 255, 0.12)');
  holo.addColorStop(1, 'rgba(255, 100, 180, 0.15)');
  ctx.fillStyle = holo;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  const cross = ctx.createLinearGradient(
    bounds.x + bounds.width, bounds.y,
    bounds.x, bounds.y + bounds.height
  );
  cross.addColorStop(0, 'rgba(100, 200, 255, 0.1)');
  cross.addColorStop(0.5, 'rgba(255, 150, 200, 0.08)');
  cross.addColorStop(1, 'rgba(200, 255, 100, 0.1)');
  ctx.fillStyle = cross;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawGlitterOverlay(ctx, bounds, descriptor) {
  const seed = descriptor.baseColor.charCodeAt(1) + descriptor.baseColor.charCodeAt(3);
  const count = 40 + Math.round(descriptor.detailLevel * 30);

  ctx.save();
  for (let i = 0; i < count; i++) {
    const h1 = ((seed * (i + 1) * 2654435761) >>> 0) / 4294967296;
    const h2 = ((seed * (i + 7) * 2246822519) >>> 0) / 4294967296;
    const h3 = ((seed * (i + 13) * 3266489917) >>> 0) / 4294967296;

    const px = bounds.x + bounds.width * h1;
    const py = bounds.y + bounds.height * h2;
    const size = 1 + h3 * 2.5;
    const alpha = 0.3 + h3 * 0.6;

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ─── Finish overlays ────────────────────────────────── */

function drawFinishOverlay(ctx, bounds, descriptor, design) {
  switch (descriptor.finish) {
    case 'chrome':
      drawChromeSweep(ctx, bounds, descriptor, design);
      break;
    case 'velvet':
      drawCatEyeBand(ctx, bounds, descriptor);
      break;
    case 'holographic':
      drawHolographic(ctx, bounds);
      break;
    case 'glitter':
      drawGlitterOverlay(ctx, bounds, descriptor);
      break;
    case 'jelly':
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      break;
    case 'matte':
      ctx.fillStyle = 'rgba(40,35,30,0.05)';
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      break;
    default:
      break;
  }
}

/* ─── Decals & overlays ──────────────────────────────── */

function drawImageCover(ctx, image, bounds, zoom = 0.82) {
  const scale = Math.max(bounds.width / image.width, bounds.height / image.height) * zoom;
  const dw = image.width * scale;
  const dh = image.height * scale;
  const ox = bounds.x + (bounds.width - dw) / 2;
  const oy = bounds.y + (bounds.height - dh) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, ox, oy, dw, dh);
}

function drawMonogram(ctx, text, bounds) {
  const grad = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.fillStyle = '#f7f4ea';
  ctx.font = '700 22px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

function resolveBrandAsset(brandAssets, assetKey, fallbackKeys = []) {
  const keys = [assetKey, ...fallbackKeys].filter(Boolean);

  for (const key of keys) {
    if (brandAssets[key]) {
      return brandAssets[key];
    }
  }

  return '';
}

async function drawLogoDecal(ctx, bounds, descriptor, brandAssets) {
  const assetKey = descriptor.logoAssetKey || 'gary';
  const src = resolveBrandAsset(brandAssets, assetKey);
  if (!src) return;

  const img = await loadImage(src);
  const assetScale = Math.max(0.1, Math.min(10, Number(descriptor.logoAssetScale) || 1));
  const baseWidth = bounds.width * 0.24;
  const rawWidth = baseWidth * assetScale;
  const rawHeight = rawWidth * (img.height / img.width);
  const w = rawWidth;
  const h = rawHeight;
  const anchorX = bounds.x + bounds.width * 0.67;
  const anchorY = bounds.y + bounds.height * 0.64;
  const offsetX = bounds.width * ((Number(descriptor.logoOffsetX) || 0) / 100);
  const offsetY = bounds.height * ((Number(descriptor.logoOffsetY) || 0) / 100);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(anchorX + offsetX, anchorY + offsetY);
  ctx.scale(1, descriptor.logoFlipVertical ? -1 : 1);
  ctx.drawImage(img, -(w / 2), -(h / 2), w, h);
  ctx.restore();
}

async function drawSloganText(ctx, bounds, descriptor, brandAssets) {
  if (!descriptor.decalText) return;

  const sloganSrc = resolveBrandAsset(brandAssets, descriptor.sloganAssetKey || 'woofwoof');
  if (sloganSrc) {
    try {
      const sloganImage = await loadImage(sloganSrc);
      const assetScale = Math.max(0.1, Math.min(10, Number(descriptor.sloganAssetScale) || 1));
      const rawWidth = bounds.width * 0.58 * assetScale;
      const rawHeight = rawWidth * (sloganImage.height / sloganImage.width);
      const width = rawWidth;
      const height = rawHeight;
      const centerX = bounds.x + (bounds.width / 2) + (bounds.width * ((Number(descriptor.sloganOffsetX) || 0) / 100));
      const centerY = bounds.y + (bounds.height * 0.84) + (bounds.height * ((Number(descriptor.sloganOffsetY) || 0) / 100));

      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(centerX, centerY);
      ctx.scale(1, descriptor.sloganFlipVertical ? -1 : 1);
      ctx.drawImage(sloganImage, -(width / 2), -(height / 2), width, height);
      ctx.restore();
      return;
    } catch {
      /* fall back to text rendering */
    }
  }

  ctx.save();
  ctx.translate(
    bounds.x + bounds.width * 0.18 + (bounds.width * ((Number(descriptor.sloganOffsetX) || 0) / 100)),
    bounds.y + bounds.height * 0.7 + (bounds.height * ((Number(descriptor.sloganOffsetY) || 0) / 100))
  );
  ctx.rotate(-Math.PI / 2);
  ctx.scale(1, descriptor.sloganFlipVertical ? -1 : 1);
  ctx.font = `700 ${10 + ((descriptor.sloganScale || 0.7) * (descriptor.sloganAssetScale || 1)) * 4}px Orbitron, sans-serif`;
  ctx.letterSpacing = '0.08em';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexToRgba('#f7f4ea', 0.75);
  ctx.fillText(descriptor.decalText, 0, 0);
  ctx.restore();
}

/* ─── Main motif router ──────────────────────────────── */

async function drawMotif(ctx, descriptor, design, bounds, brandAssets) {
  switch (descriptor.motif) {
    case 'micro-french':
      drawAuraBloom(ctx, bounds, descriptor.auraColor || descriptor.accentColor, design.style.auraAmount);
      drawMicroFrench(ctx, bounds, descriptor);
      break;
    case 'chrome-sweep':
      drawChromeSweep(ctx, bounds, descriptor, design);
      drawMicroFrench(ctx, bounds, descriptor);
      break;
    case 'airbrush-cloud':
      drawAirbrushCloud(ctx, bounds, descriptor);
      break;
    case 'cat-eye':
      drawAuraBloom(ctx, bounds, descriptor.auraColor || descriptor.accentColor, design.style.auraAmount + 0.1);
      drawCatEyeBand(ctx, bounds, descriptor);
      break;
    case 'trait-swoop':
      drawAuraBloom(ctx, bounds, descriptor.auraColor || descriptor.accentColor, design.style.auraAmount * 0.8);
      drawTraitSwoop(ctx, bounds, descriptor);
      break;
    case 'sticker-badge':
      drawAirbrushCloud(ctx, bounds, descriptor);
      drawStickerBadge(ctx, bounds, descriptor);
      break;
    case 'logo-decals':
      drawMicroFrench(ctx, bounds, descriptor);
      break;
    case 'rare-gems':
      drawAuraBloom(ctx, bounds, descriptor.auraColor || descriptor.accentColor, design.style.auraAmount + 0.08);
      drawTraitSwoop(ctx, bounds, descriptor);
      break;
    case 'slogan-type':
      drawMicroFrench(ctx, bounds, descriptor);
      drawAirbrushCloud(ctx, bounds, descriptor);
      break;
    case 'ombre':
      drawOmbreGradient(ctx, bounds, descriptor);
      break;
    case 'marble':
      drawMarbleTexture(ctx, bounds, descriptor);
      break;
    case 'portrait':
      drawAuraBloom(ctx, bounds, descriptor.auraColor || descriptor.accentColor, design.style.auraAmount + 0.08);
      break;
    default:
      break;
  }

  if (descriptor.gemCount) {
    drawGemCluster(ctx, bounds, descriptor);
  }
}

/* ─── Nail edge ──────────────────────────────────────── */

function drawNailEdge(ctx, bounds, shape) {
  ctx.save();
  createNailPath(ctx, bounds.x, bounds.y, bounds.width, bounds.height, shape);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.stroke();
  ctx.restore();
}

/* ─── Chips & Labels ─────────────────────────────────── */

function drawChip(ctx, text, x, y, maxW, fill, stroke) {
  const safe = String(text || '').trim();
  if (!safe) return;

  ctx.save();
  ctx.font = '600 12px Inter, sans-serif';
  const px = 12;
  const h = 28;
  const w = Math.min(maxW, ctx.measureText(safe).width + px * 2);

  roundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.fillStyle = '#3a3530';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(safe, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function drawBadge(ctx, text, x, y, color) {
  if (!text) return;

  ctx.save();
  ctx.font = '700 11px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.max(74, ctx.measureText(text).width + 22);

  roundedRect(ctx, x, y, w, 26, 13);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#050505';
  ctx.fillText(text.toUpperCase(), x + w / 2, y + 13);
  ctx.restore();
}

/* ─── Asset overlay with transforms ──────────────────── */

async function drawAssetOverlay(ctx, bounds, src, transforms) {
  if (!src || !transforms || !transforms.enabled) return;
  let img;
  try {
    img = await loadImage(src);
  } catch {
    return;
  }

  const scale = Math.max(0.05, Math.min(5, transforms.scale || 1));
  const baseW = bounds.width * 0.35;
  const w = baseW * scale;
  const h = w * (img.height / img.width);
  const cx = bounds.x + bounds.width / 2 + (bounds.width * ((transforms.x || 0) / 100));
  const cy = bounds.y + bounds.height * 0.5 + (bounds.height * ((transforms.y || 0) / 100));
  const rotation = ((transforms.rotation || 0) * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);
  ctx.scale(1, transforms.flipV ? -1 : 1);
  ctx.drawImage(img, -(w / 2), -(h / 2), w, h);
  ctx.restore();
}

/* ─── Main render ────────────────────────────────────── */

async function renderNailCanvas(canvas, descriptor, design, brandAssets = {}, extras = {}) {
  const ctx = prepareCanvas(canvas, NAIL_CANVAS_WIDTH, NAIL_CANVAS_HEIGHT);

  const nailBounds = {
    x: 68,
    y: 36,
    width: NAIL_CANVAS_WIDTH - 136,
    height: 360
  };

  drawBackdrop(ctx, descriptor);
  drawFingerSkin(ctx, nailBounds);
  drawNailShadow(ctx, nailBounds, descriptor.shape, descriptor.accentColor);

  ctx.save();
  createNailPath(ctx, nailBounds.x, nailBounds.y, nailBounds.width, nailBounds.height, descriptor.shape);
  ctx.clip();

  // AI base image replaces computed background when present
  if (extras.aiImage) {
    drawImageCover(ctx, extras.aiImage, nailBounds, 1.0);
  } else {
    drawNailBed(ctx, nailBounds);
    drawBaseSurface(ctx, descriptor, nailBounds);
    await drawMotif(ctx, descriptor, design, nailBounds, brandAssets);
  }

  drawFinishOverlay(ctx, nailBounds, descriptor, design);
  drawGloss(ctx, nailBounds, descriptor.finish);
  drawSpecularHighlight(ctx, nailBounds, descriptor.finish);

  // Draw per-nail asset overlays with transforms
  if (extras.assetOverlays && Array.isArray(extras.assetOverlays)) {
    for (const overlay of extras.assetOverlays) {
      await drawAssetOverlay(ctx, nailBounds, overlay.src, overlay.transforms);
    }
  }

  ctx.restore();

  drawNailEdge(ctx, nailBounds, descriptor.shape);

  if (descriptor.badgeText) {
    drawBadge(ctx, descriptor.badgeText, 28, 22, design.style.accentColor);
  }

  drawChip(
    ctx, descriptor.chipText,
    26, NAIL_CANVAS_HEIGHT - 70, NAIL_CANVAS_WIDTH - 52,
    'rgba(255,255,255,0.72)', 'rgba(0,0,0,0.08)'
  );

  ctx.fillStyle = '#5a524a';
  ctx.font = '600 12px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(descriptor.caption, NAIL_CANVAS_WIDTH / 2, NAIL_CANVAS_HEIGHT - 22);
}

/* ─── Combined export canvas ─────────────────────────── */

async function renderCombinedCanvas(canvas, design, renderedCanvases, brandAssets = {}) {
  const width = 2000;
  const height = 1100;
  const ctx = prepareCanvas(canvas, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#faf7f2');
  bg.addColorStop(1, '#f0ebe3');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const aura = ctx.createRadialGradient(width / 2, 200, 40, width / 2, 200, 500);
  aura.addColorStop(0, hexToRgba(design.style.accentColor, 0.1));
  aura.addColorStop(0.6, hexToRgba(design.style.accentColor, 0.03));
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.font = '700 100px Orbitron, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.03)';
  ctx.fillText(design.summary.slogan, width - 80, 130);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#3a3530';
  ctx.font = '700 28px Orbitron, sans-serif';
  ctx.fillText('Kush Media Nail Designer', 100, 78);

  ctx.fillStyle = '#1a1612';
  ctx.font = '700 54px Orbitron, sans-serif';
  ctx.fillText(design.summary.title, 100, 148);

  ctx.fillStyle = '#7a7068';
  ctx.font = '400 22px Inter, sans-serif';
  ctx.fillText(
    `${design.style.label} \u2022 ${design.summary.shapeLabel} \u2022 ${design.summary.finishLabel} \u2022 ${design.summary.sourceLabel}`,
    100, 196
  );

  try {
    const mascot = await loadImage(resolveBrandAsset(brandAssets, 'gary'));
    ctx.globalAlpha = 0.92;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mascot, width - 208, 36, 132, 132);
    ctx.globalAlpha = 1;
  } catch {
    /* logo optional */
  }

  const startX = 80;
  const startY = 254;
  const cardW = 340;
  const cardH = 590;
  const gap = 24;

  design.nails.forEach((desc, i) => {
    const cx = startX + (cardW + gap) * i;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    roundedRect(ctx, cx, startY, cardW, cardH, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, cx, startY, cardW, cardH, 28);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.stroke();

    const nailCanvas = renderedCanvases[desc.id];
    ctx.drawImage(nailCanvas, cx + 14, startY + 14, cardW - 28, cardH - 96);

    ctx.fillStyle = '#1a1612';
    ctx.font = '700 18px Orbitron, sans-serif';
    ctx.fillText(desc.label, cx + 20, startY + cardH - 44);

    ctx.fillStyle = '#7a7068';
    ctx.font = '500 15px Inter, sans-serif';
    ctx.fillText(desc.title, cx + 20, startY + cardH - 18);
  });

  const chipY = startY + cardH + 40;
  const chipFill = 'rgba(255,255,255,0.7)';
  const chipStroke = 'rgba(0,0,0,0.08)';

  drawChip(ctx, design.summary.rarityLabel, 100, chipY, 200, chipFill, chipStroke);
  drawChip(ctx, design.summary.shapeLabel, 310, chipY, 200, chipFill, chipStroke);
  drawChip(ctx, design.summary.finishLabel, 520, chipY, 200, chipFill, chipStroke);
  drawChip(ctx, design.summary.accessory || 'No accessory', 730, chipY, 260, chipFill, chipStroke);

  ctx.fillStyle = '#3a3530';
  ctx.font = '700 18px Orbitron, sans-serif';
  ctx.fillText('Traits', 100, chipY + 58);

  let tx = 100;
  for (const trait of design.summary.traitSummary) {
    drawChip(ctx, trait, tx, chipY + 72, 240, chipFill, chipStroke);
    tx += 220;
  }

  ctx.fillStyle = '#7a7068';
  ctx.font = '400 16px Inter, sans-serif';
  ctx.fillText(`${design.summary.message} \u2022 ${design.summary.slogan}`, 100, chipY + 112);
}

export {
  NAIL_CANVAS_HEIGHT,
  NAIL_CANVAS_WIDTH,
  renderCombinedCanvas,
  renderNailCanvas
};
