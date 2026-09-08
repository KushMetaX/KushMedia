/**
 * Semi-IRL lane watcher: occupancy + name/art fingerprints
 * (precomputed in ddl-prints.js) so the camera can auto-bind Companion peeks.
 */
(function (global) {
  const ART_W = 28;
  const ART_H = 24;
  const NAME_W = 64;
  const NAME_H = 14;
  const FULL_W = 24;
  const FULL_H = 32;
  const ART_BOX = { x0: 0.11, y0: 0.09, x1: 0.89, y1: 0.515 };
  const NAME_BOX = { x0: 0.10, y0: 0.615, x1: 0.90, y1: 0.705 };
  const FULL_BOX = { x0: 0.08, y0: 0.07, x1: 0.92, y1: 0.93 };
  const prints = new Map();
  let loaded = false;
  let artBox = ART_BOX;
  let nameBox = NAME_BOX;
  let fullBox = FULL_BOX;
  let artW = ART_W;
  let artH = ART_H;
  let nameW = NAME_W;
  let nameH = NAME_H;
  let fullW = FULL_W;
  let fullH = FULL_H;

  function packedPrints() {
    const pack = global.DDL_PRINTS;
    if (!pack || !pack.cards) return null;
    return pack;
  }

  function loadPrints() {
    if (loaded) return prints;
    const pack = packedPrints();
    if (!pack) return prints;
    artW = Number(pack.aw) || ART_W;
    artH = Number(pack.ah) || ART_H;
    nameW = Number(pack.nw) || NAME_W;
    nameH = Number(pack.nh) || NAME_H;
    fullW = Number(pack.gw) || FULL_W;
    fullH = Number(pack.gh) || FULL_H;
    if (pack.art) artBox = pack.art;
    if (pack.name) nameBox = pack.name;
    if (pack.full) fullBox = pack.full;
    Object.keys(pack.cards).forEach((id) => {
      const row = pack.cards[id];
      const art = row && (row.a || row.g);
      const name = row && row.n;
      if (!art || art.length !== artW * artH) return;
      if (!name || name.length !== nameW * nameH) return;
      const full = row.g && row.g.length === fullW * fullH && row.a ? row.g : null;
      prints.set(String(id).toUpperCase(), {
        id: String(id).toUpperCase(),
        art: Float32Array.from(art),
        full: full ? Float32Array.from(full) : null,
        hue: Float32Array.from(row.h || []),
        name: Float32Array.from(name),
        color: Float32Array.from(row.c || []),
      });
    });
    loaded = true;
    return prints;
  }

  function mediaSize(el) {
    if (!el) return null;
    const vw = el.videoWidth || el.width || 0;
    const vh = el.videoHeight || el.height || 0;
    if (!vw || !vh) return null;
    return { vw, vh };
  }

  function slotToVideoRect(video, slotEl) {
    if (!video || !slotEl) return null;
    const size = mediaSize(video);
    const vr = video.getBoundingClientRect();
    const sr = slotEl.getBoundingClientRect();
    if (!size || !vr.width || !vr.height) return null;
    const vw = size.vw;
    const vh = size.vh;
    if (sr.width < 8 || sr.height < 8) return null;
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = vr.left + (vr.width - dispW) / 2;
    const offY = vr.top + (vr.height - dispH) / 2;
    const x = (sr.left - offX) / scale;
    const y = (sr.top - offY) / scale;
    const w = sr.width / scale;
    const h = sr.height / scale;
    if (w < 12 || h < 16) return null;
    const insetX = Math.max(1, Math.floor(w * 0.03));
    const insetY = Math.max(1, Math.floor(h * 0.02));
    return {
      x: Math.max(0, Math.floor(x + insetX)),
      y: Math.max(0, Math.floor(y + insetY)),
      w: Math.max(10, Math.ceil(w - insetX * 2)),
      h: Math.max(14, Math.ceil(h - insetY * 2)),
    };
  }

  function gridSlotRect(video, key) {
    const size = mediaSize(video);
    if (!size) return null;
    const m = String(key).match(/^(creature|spell)-(\d)$/);
    if (!m) return null;
    const host = video.closest('.cam-frame') || video;
    const hr = host.getBoundingClientRect();
    if (!hr.width || !hr.height) return null;
    const vw = size.vw;
    const vh = size.vh;
    const scale = Math.max(hr.width / vw, hr.height / vh);
    const shownW = hr.width / scale;
    const shownH = hr.height / scale;
    const originX = (vw - shownW) / 2;
    const originY = (vh - shownH) / 2;
    const row = m[1] === 'creature' ? 0 : 1;
    const col = Number(m[2]) + 1;
    const gapX = shownW * 0.008;
    const gapY = shownH * 0.016;
    const cellW = (shownW - gapX * 6) / 7;
    const cellH = cellW * 88 / 63;
    const padT = shownH * 0.004;
    return {
      x: originX + col * (cellW + gapX),
      y: originY + padT + row * (cellH + gapY),
      w: cellW,
      h: cellH,
    };
  }

  function clipRect(rect, vw, vh) {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(vw - x, Math.ceil(rect.w));
    const h = Math.min(vh - y, Math.ceil(rect.h));
    if (w < 10 || h < 14) return null;
    return { x, y, w, h };
  }

  function grabSlot(video, rect) {
    if (!video || !rect || rect.w < 8 || rect.h < 10) return null;
    const dw = 96;
    const dh = 134;
    const c = grabSlot._c || (grabSlot._c = document.createElement('canvas'));
    if (c.width !== dw) c.width = dw;
    if (c.height !== dh) c.height = dh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    try {
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, dw, dh);
      const img = ctx.getImageData(0, 0, dw, dh);
      return { data: img.data, w: dw, h: dh };
    } catch (_err) {
      return null;
    }
  }

  function rgbaLuma(data, i) {
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  }

  function toGray(src) {
    const gray = new Float32Array(src.w * src.h);
    for (let i = 0, p = 0; i < src.data.length; i += 4, p += 1) {
      gray[p] = rgbaLuma(src.data, i);
    }
    return gray;
  }

  function autocontrast(gray, cutoff) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i += 1) {
      hist[Math.max(0, Math.min(255, Math.round(gray[i])))] += 1;
    }
    const cut = gray.length * (cutoff || 0.02);
    let lo = 0;
    let hi = 255;
    let acc = 0;
    while (lo < 255 && acc < cut) {
      acc += hist[lo];
      lo += 1;
    }
    acc = 0;
    while (hi > 0 && acc < cut) {
      acc += hist[hi];
      hi -= 1;
    }
    const scale = hi > lo ? 255 / (hi - lo) : 1;
    const out = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) {
      out[i] = Math.max(0, Math.min(255, (gray[i] - lo) * scale));
    }
    return out;
  }

  function resizeGray(src, sw, sh, tw, th) {
    const out = new Float32Array(tw * th);
    if (sw < 1 || sh < 1 || tw < 1 || th < 1) return out;
    for (let y = 0; y < th; y += 1) {
      const fy = (y + 0.5) * sh / th - 0.5;
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const y1 = Math.min(sh - 1, y0 + 1);
      const wy = fy - y0;
      for (let x = 0; x < tw; x += 1) {
        const fx = (x + 0.5) * sw / tw - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const wx = fx - x0;
        const v00 = src[y0 * sw + x0];
        const v10 = src[y0 * sw + x1];
        const v01 = src[y1 * sw + x0];
        const v11 = src[y1 * sw + x1];
        out[y * tw + x] = v00 * (1 - wx) * (1 - wy)
          + v10 * wx * (1 - wy)
          + v01 * (1 - wx) * wy
          + v11 * wx * wy;
      }
    }
    return out;
  }

  function sampleBox(src, box, tw, th, huesOut) {
    const sw = src.w;
    const sh = src.h;
    const data = src.data;
    const x0 = box.x0 * sw;
    const y0 = box.y0 * sh;
    const bw = Math.max(1, (box.x1 - box.x0) * sw);
    const bh = Math.max(1, (box.y1 - box.y0) * sh);
    const gray = new Float32Array(tw * th);
    const hues = huesOut || new Float32Array(8);
    let chromaN = 0;
    for (let y = 0; y < th; y += 1) {
      const py = y0 + (y + 0.5) * bh / th;
      const sy0 = Math.max(0, Math.min(sh - 1, Math.floor(py)));
      const sy1 = Math.min(sh - 1, sy0 + 1);
      const wy = py - sy0;
      for (let x = 0; x < tw; x += 1) {
        const px = x0 + (x + 0.5) * bw / tw;
        const sx0 = Math.max(0, Math.min(sw - 1, Math.floor(px)));
        const sx1 = Math.min(sw - 1, sx0 + 1);
        const wx = px - sx0;
        const i00 = (sy0 * sw + sx0) * 4;
        const i10 = (sy0 * sw + sx1) * 4;
        const i01 = (sy1 * sw + sx0) * 4;
        const i11 = (sy1 * sw + sx1) * 4;
        const l00 = rgbaLuma(data, i00);
        const l10 = rgbaLuma(data, i10);
        const l01 = rgbaLuma(data, i01);
        const l11 = rgbaLuma(data, i11);
        gray[y * tw + x] = l00 * (1 - wx) * (1 - wy)
          + l10 * wx * (1 - wy)
          + l01 * (1 - wx) * wy
          + l11 * wx * wy;
        const i = wy < 0.5 ? (wx < 0.5 ? i00 : i10) : (wx < 0.5 ? i01 : i11);
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx < 24 || mx - mn < 14) continue;
        chromaN += 1;
        const df = mx - mn;
        let hue;
        if (mx === r) hue = ((g - b) / df) % 6;
        else if (mx === g) hue = (b - r) / df + 2;
        else hue = (r - g) / df + 4;
        if (hue < 0) hue += 6;
        hues[Math.min(7, Math.floor((hue / 6) * 8))] += 1;
      }
    }
    let hueSum = 0;
    for (let i = 0; i < 8; i += 1) hueSum += hues[i];
    if (hueSum) {
      for (let i = 0; i < 8; i += 1) hues[i] /= hueSum;
    }
    const color = new Float32Array(12);
    const cw = 4;
    const ch = 3;
    for (let y = 0; y < ch; y += 1) {
      const py = y0 + (y + 0.5) * bh / ch;
      const sy = Math.max(0, Math.min(sh - 1, Math.floor(py)));
      for (let x = 0; x < cw; x += 1) {
        const px = x0 + (x + 0.5) * bw / cw;
        const sx = Math.max(0, Math.min(sw - 1, Math.floor(px)));
        const i = (sy * sw + sx) * 4;
        const o = (y * cw + x) * 3;
        color[o] = data[i];
        color[o + 1] = data[i + 1];
        color[o + 2] = data[i + 2];
      }
    }
    return { gray, hue: hues, color, satRatio: (tw * th) ? chromaN / (tw * th) : 0 };
  }

  function sampleGray(src, box, tw, th) {
    const sw = src.w;
    const sh = src.h;
    const data = src.data;
    const x0 = box.x0 * sw;
    const y0 = box.y0 * sh;
    const bw = Math.max(1, (box.x1 - box.x0) * sw);
    const bh = Math.max(1, (box.y1 - box.y0) * sh);
    const gray = new Float32Array(tw * th);
    for (let y = 0; y < th; y += 1) {
      const sy = Math.min(sh - 1, Math.floor(y0 + (y + 0.5) * bh / th));
      for (let x = 0; x < tw; x += 1) {
        const sx = Math.min(sw - 1, Math.floor(x0 + (x + 0.5) * bw / tw));
        gray[y * tw + x] = rgbaLuma(data, (sy * sw + sx) * 4);
      }
    }
    return { gray };
  }

  function energySpan(arr, keep) {
    const n = arr.length;
    let total = 0;
    for (let i = 0; i < n; i += 1) total += arr[i];
    if (total < 1e-6) return [0, n - 1];
    const need = total * (keep || 0.86);
    let bestL = 0;
    let bestR = n - 1;
    let bestW = n;
    let acc = 0;
    let r = -1;
    for (let l = 0; l < n; l += 1) {
      if (l) acc -= arr[l - 1];
      if (r < l - 1) {
        r = l - 1;
        acc = 0;
      }
      while (r + 1 < n && acc < need) {
        r += 1;
        acc += arr[r];
      }
      if (acc >= need && (r - l) < bestW) {
        bestW = r - l;
        bestL = l;
        bestR = r;
      }
    }
    return [bestL, bestR];
  }

  function tightCard(src) {
    const sw = src.w;
    const sh = src.h;
    const tw = 48;
    const th = 66;
    const gray = resizeGray(toGray(src), sw, sh, tw, th);
    const mag = new Float32Array(tw * th);
    for (let y = 1; y < th - 1; y += 1) {
      for (let x = 1; x < tw - 1; x += 1) {
        const gx = gray[y * tw + x + 1] - gray[y * tw + x - 1];
        const gy = gray[(y + 1) * tw + x] - gray[(y - 1) * tw + x];
        mag[y * tw + x] = gx * gx + gy * gy;
      }
    }
    const col = new Float32Array(tw);
    const row = new Float32Array(th);
    for (let y = 0; y < th; y += 1) {
      for (let x = 0; x < tw; x += 1) {
        const v = mag[y * tw + x];
        col[x] += v;
        row[y] += v;
      }
    }
    const [cx0, cx1] = energySpan(col, 0.88);
    const [cy0, cy1] = energySpan(row, 0.88);
    const padX = Math.max(1, Math.round((cx1 - cx0) * 0.04));
    const padY = Math.max(1, Math.round((cy1 - cy0) * 0.04));
    const nx0 = Math.max(0, cx0 - padX) / tw;
    const nx1 = Math.min(tw, cx1 + padX + 1) / tw;
    const ny0 = Math.max(0, cy0 - padY) / th;
    const ny1 = Math.min(th, cy1 + padY + 1) / th;
    if (nx1 - nx0 < 0.50 || ny1 - ny0 < 0.55) {
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    const aspect = ((nx1 - nx0) * sw) / Math.max(1, (ny1 - ny0) * sh);
    if (aspect < 0.48 || aspect > 1.05) {
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    return { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
  }

  function cropSrc(src, box) {
    const x = Math.max(0, Math.floor(src.w * box.x0));
    const y = Math.max(0, Math.floor(src.h * box.y0));
    const w = Math.max(8, Math.min(src.w - x, Math.ceil(src.w * (box.x1 - box.x0))));
    const h = Math.max(10, Math.min(src.h - y, Math.ceil(src.h * (box.y1 - box.y0))));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy += 1) {
      const si = ((y + yy) * src.w + x) * 4;
      data.set(src.data.subarray(si, si + w * 4), yy * w * 4);
    }
    return { data, w, h };
  }

  function rgbAt(src, x, y) {
    const i = (Math.max(0, Math.min(src.h - 1, y)) * src.w + Math.max(0, Math.min(src.w - 1, x))) * 4;
    return [src.data[i], src.data[i + 1], src.data[i + 2]];
  }

  function rgbDist2(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function matCardBox(src) {
    const w = src.w;
    const h = src.h;
    if (w < 16 || h < 20) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    function patch(x, y) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = 0; yy < 5; yy += 1) {
        for (let xx = 0; xx < 5; xx += 1) {
          const p = rgbAt(src, x + xx, y + yy);
          r += p[0];
          g += p[1];
          b += p[2];
          n += 1;
        }
      }
      return [r / n, g / n, b / n];
    }
    const mats = [patch(0, 0), patch(w - 6, 0), patch(0, h - 6), patch(w - 6, h - 6)];
    const mat = [
      (mats[0][0] + mats[1][0] + mats[2][0] + mats[3][0]) / 4,
      (mats[0][1] + mats[1][1] + mats[2][1] + mats[3][1]) / 4,
      (mats[0][2] + mats[1][2] + mats[2][2] + mats[3][2]) / 4,
    ];
    const thr = 30 * 30;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let hit = 0;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (rgbDist2(rgbAt(src, x, y), mat) < thr) continue;
        hit += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (hit < 12 || maxX < minX) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    const padX = Math.max(step, (maxX - minX) * 0.08);
    const padY = Math.max(step, (maxY - minY) * 0.06);
    const x0 = Math.max(0, minX - padX) / w;
    const x1 = Math.min(w, maxX + padX + 1) / w;
    const y0 = Math.max(0, minY - padY) / h;
    const y1 = Math.min(h, maxY + padY + 1) / h;
    if (x1 - x0 < 0.28 || y1 - y0 < 0.32) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0, y0, x1, y1 };
  }

  function findNameBox(src) {
    const gw = 40;
    const gh = 56;
    const gray = resizeGray(toGray(src), src.w, src.h, gw, gh);
    const mean = new Float32Array(gh);
    const std = new Float32Array(gh);
    const x0 = Math.floor(gw * 0.16);
    const x1 = Math.ceil(gw * 0.84);
    const span = Math.max(1, x1 - x0);
    for (let y = 0; y < gh; y += 1) {
      let sum = 0;
      for (let x = x0; x < x1; x += 1) sum += gray[y * gw + x];
      const m = sum / span;
      mean[y] = m;
      let v = 0;
      for (let x = x0; x < x1; x += 1) {
        const d = gray[y * gw + x] - m;
        v += d * d;
      }
      std[y] = Math.sqrt(v / span);
    }
    let boxY0 = -1;
    let boxY1 = -1;
    let run0 = -1;
    const yStart = Math.floor(gh * 0.56);
    const yEnd = Math.floor(gh * 0.92);
    function keepRun(a, b) {
      if (a < 0 || b < a) return;
      if (boxY0 < 0 || (b - a) > (boxY1 - boxY0)) {
        boxY0 = a;
        boxY1 = b;
      }
    }
    for (let y = yStart; y < yEnd; y += 1) {
      const ok = mean[y] > 138 && std[y] < 88;
      if (ok) {
        if (run0 < 0) run0 = y;
      } else {
        keepRun(run0, y - 1);
        run0 = -1;
      }
    }
    keepRun(run0, yEnd - 1);
    const win = Math.max(3, Math.round(gh * 0.075));
    const yLo = Math.floor(gh * 0.54);
    const yHi = boxY0 > 0 ? Math.min(boxY0 - 1, Math.floor(gh * 0.76)) : Math.floor(gh * 0.74);
    let bestY = Math.round(gh * 0.62);
    let bestS = -1;
    for (let y = yLo; y + win <= yHi; y += 1) {
      let s = 0;
      for (let k = 0; k < win; k += 1) s += std[y + k];
      if (s > bestS) {
        bestS = s;
        bestY = y;
      }
    }
    const ny0 = Math.max(0.50, (bestY - 1) / gh);
    const ny1 = Math.min(0.76, (bestY + win + 1) / gh);
    const dWin = Math.max(3, Math.round(gh * 0.08));
    const dLo = Math.floor(gh * 0.40);
    const dHi = Math.floor(gh * 0.72);
    let darkY = -1;
    let darkS = -1;
    for (let y = dLo; y + dWin <= dHi; y += 1) {
      let m = 0;
      let s = 0;
      for (let k = 0; k < dWin; k += 1) {
        m += mean[y + k];
        s += std[y + k];
      }
      m /= dWin;
      if (m > 132) continue;
      if (s > darkS) {
        darkS = s;
        darkY = y;
      }
    }
    if (darkY >= 0 && darkS > bestS * 0.8) {
      return {
        x0: 0.12,
        y0: Math.max(0.40, (darkY - 1) / gh),
        x1: 0.88,
        y1: Math.min(0.74, (darkY + dWin + 1) / gh),
      };
    }
    if (ny1 - ny0 < 0.04) return nameBox;
    return { x0: 0.10, y0: ny0, x1: 0.90, y1: ny1 };
  }

  function ncc(a, b) {
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i += 1) {
      ma += a[i];
      mb += b[i];
    }
    ma /= n;
    mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i += 1) {
      const xa = a[i] - ma;
      const xb = b[i] - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    if (da < 1e-6 || db < 1e-6) return 0;
    return num / Math.sqrt(da * db);
  }

  function nccShift(a, b, w, h, maxD) {
    let best = ncc(a, b);
    const lim = Number(maxD) || 0;
    if (lim < 1) return best;
    for (let dy = -lim; dy <= lim; dy += 1) {
      for (let dx = -lim; dx <= lim; dx += 1) {
        if (!dx && !dy) continue;
        const x0 = Math.max(0, dx);
        const x1 = Math.min(w, w + dx);
        const y0 = Math.max(0, dy);
        const y1 = Math.min(h, h + dy);
        const bw = x1 - x0;
        const bh = y1 - y0;
        if (bw < w - lim || bh < h - lim) continue;
        let n = 0;
        let ma = 0;
        let mb = 0;
        for (let y = y0; y < y1; y += 1) {
          const ia = y * w + x0;
          const ib = (y - dy) * w + (x0 - dx);
          for (let x = 0; x < bw; x += 1) {
            ma += a[ia + x];
            mb += b[ib + x];
            n += 1;
          }
        }
        ma /= n;
        mb /= n;
        let num = 0;
        let da = 0;
        let db = 0;
        for (let y = y0; y < y1; y += 1) {
          const ia = y * w + x0;
          const ib = (y - dy) * w + (x0 - dx);
          for (let x = 0; x < bw; x += 1) {
            const xa = a[ia + x] - ma;
            const xb = b[ib + x] - mb;
            num += xa * xb;
            da += xa * xa;
            db += xb * xb;
          }
        }
        if (da < 1e-6 || db < 1e-6) continue;
        const s = num / Math.sqrt(da * db);
        if (s > best) best = s;
      }
    }
    return best;
  }

  function colorSim(a, b) {
    if (!a || !b || a.length < 3 || b.length < 3) return 0;
    const n = Math.min(a.length, b.length);
    let se = 0;
    for (let i = 0; i < n; i += 1) {
      const d = (a[i] - b[i]) / 255;
      se += d * d;
    }
    return Math.max(0, 1 - Math.sqrt(se / n) * 1.7);
  }

  function hueCos(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    const n = Math.min(8, a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const xa = a[i] || 0;
      const xb = b[i] || 0;
      dot += xa * xb;
      na += xa * xa;
      nb += xb * xb;
    }
    if (na < 1e-8 || nb < 1e-8) return 0;
    return dot / Math.sqrt(na * nb);
  }

  function bitSim(a, b) {
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    let same = 0;
    for (let i = 0; i < n; i += 1) {
      if ((a[i] >= 0.5) === (b[i] >= 0.5)) same += 1;
    }
    return same / n;
  }

  function invertBits(bits) {
    const out = new Float32Array(bits.length);
    for (let i = 0; i < bits.length; i += 1) out[i] = bits[i] >= 0.5 ? 0 : 1;
    return out;
  }

  function nameInkFromGray(gray, sw, sh) {
    if (!gray || sw < 6 || sh < 4) return null;
    const stretched = autocontrast(gray, 0.02);
    function bitsFrom(src, brightInk) {
      let mean = 0;
      for (let i = 0; i < src.length; i += 1) mean += src[i];
      mean /= src.length;
      const thr = brightInk ? mean + 24 : mean - 24;
      let minX = sw;
      let maxX = -1;
      let ink = 0;
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const v = src[y * sw + x];
          const hit = brightInk ? v >= thr : v <= thr;
          if (!hit) continue;
          ink += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (ink < 8 || maxX < minX) return null;
      const pad = Math.max(2, Math.floor((maxX - minX) * 0.06));
      const x0 = Math.max(0, minX - pad);
      const x1 = Math.min(sw, maxX + pad + 1);
      const tw = x1 - x0;
      const trimmed = new Float32Array(tw * sh);
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < tw; x += 1) {
          trimmed[y * tw + x] = src[y * sw + (x0 + x)];
        }
      }
      const small = resizeGray(trimmed, tw, sh, nameW, nameH);
      let mean2 = 0;
      for (let i = 0; i < small.length; i += 1) mean2 += small[i];
      mean2 /= small.length;
      const t2 = brightInk ? mean2 + 14 : mean2 - 14;
      const bits = new Float32Array(small.length);
      let ones = 0;
      for (let i = 0; i < small.length; i += 1) {
        const on = brightInk ? small[i] >= t2 : small[i] <= t2;
        bits[i] = on ? 1 : 0;
        ones += bits[i];
      }
      const dens = ones / small.length;
      if (dens < 0.04 || dens > 0.62) return null;
      return { bits, gray: plateGrayFrom(small, nameW, nameH), dens };
    }
    return bitsFrom(stretched, true) || bitsFrom(stretched, false);
  }

  function plateGrayFrom(small, sw, sh) {
    return resizeGray(small, sw, sh, 96, 20);
  }

  function plateGray(data, sw, sh) {
    const gray = new Float32Array(sw * sh);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = rgbaLuma(data, i);
    }
    const stretched = autocontrast(gray, 0.02);
    let mean = 0;
    for (let i = 0; i < stretched.length; i += 1) mean += stretched[i];
    mean /= stretched.length;
    const thr = mean + 24;
    let minX = sw;
    let maxX = -1;
    let minY = sh;
    let maxY = -1;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        if (stretched[y * sw + x] < thr) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return resizeGray(stretched, sw, sh, 96, 20);
    const padX = Math.max(1, Math.floor((maxX - minX) * 0.08));
    const padY = Math.max(1, Math.floor((maxY - minY) * 0.20));
    const x0 = Math.max(0, minX - padX);
    const x1 = Math.min(sw, maxX + padX + 1);
    const y0 = Math.max(0, minY - padY);
    const y1 = Math.min(sh, maxY + padY + 1);
    const tw = x1 - x0;
    const th = y1 - y0;
    const cropped = new Float32Array(tw * th);
    for (let y = 0; y < th; y += 1) {
      for (let x = 0; x < tw; x += 1) {
        cropped[y * tw + x] = stretched[(y0 + y) * sw + (x0 + x)];
      }
    }
    return resizeGray(cropped, tw, th, 96, 20);
  }

  function xProj(gray) {
    const w = 96;
    const h = 20;
    if (!gray || gray.length !== w * h) return null;
    const raw = new Float32Array(w);
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let y = 0; y < h; y += 1) {
        const v = gray[y * w + x];
        if (v > 40) s += v;
      }
      raw[x] = s;
    }
    let a = 0;
    let b = w - 1;
    while (a < b && raw[a] < 1) a += 1;
    while (b > a && raw[b] < 1) b -= 1;
    const n = b - a + 1;
    if (n < 8) return null;
    return resizeGray(raw.subarray(a, b + 1), n, 1, 64, 1);
  }

  const glyphGrayCache = new Map();

  function glyphGrayFor(name) {
    const key = String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!key) return null;
    if (glyphGrayCache.has(key)) return glyphGrayCache.get(key);
    const srcW = 180;
    const srcH = 36;
    const c = glyphGrayFor._c || (glyphGrayFor._c = document.createElement('canvas'));
    c.width = srcW;
    c.height = srcH;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, srcW, srcH);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = key.length > 12 ? 16 : key.length > 8 ? 20 : key.length > 5 ? 24 : 28;
    g.font = `800 ${size}px "Arial Black", Impact, Arial, sans-serif`;
    g.fillText(key, srcW / 2, srcH / 2 + 1);
    let img;
    try {
      img = g.getImageData(0, 0, srcW, srcH);
    } catch (_err) {
      glyphGrayCache.set(key, null);
      return null;
    }
    const gray = plateGray(img.data, srcW, srcH);
    glyphGrayCache.set(key, gray);
    return gray;
  }

  function collectNames(src) {
    const hi = sampleGray(src, nameBox, nameW * 2, nameH * 2);
    const ink = nameInkFromGray(hi.gray, nameW * 2, nameH * 2);
    return ink ? [ink] : [];
  }

  function looksLikeCard(src) {
    if (!src || !src.data || !src.data.length) return false;
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    let chroma = 0;
    let bright = 0;
    for (let p = 0; p < src.data.length; p += 20) {
      const r = src.data[p];
      const g = src.data[p + 1];
      const b = src.data[p + 2];
      const luma = r * 0.3 + g * 0.59 + b * 0.11;
      sum += luma;
      sum2 += luma * luma;
      n += 1;
      if (luma > 170) bright += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 16) chroma += 1;
    }
    if (!n) return false;
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    if (mean > 70 && mean < 155 && chroma / n < 0.08 && bright / n < 0.035 && variance < 500) {
      return false;
    }
    if (variance > 380 && (chroma / n > 0.07 || bright / n > 0.05)) return true;
    if (variance > 560) return true;
    return false;
  }

  function cardType(id) {
    const Cat = global.DdlIrlCatalog;
    const card = Cat && Cat.byId(id);
    return card && card.type ? String(card.type) : '';
  }

  function allowedForLane(key, id) {
    const type = cardType(id);
    if (!type) return true;
    if (String(key).indexOf('creature-') === 0) return type === 'Creature';
    if (String(key).indexOf('spell-') === 0) return type === 'Spell' || type === 'Trap';
    return false;
  }

  function isPlayLane(key) {
    return /^(creature|spell)-\d$/.test(String(key || ''));
  }

  function isPileLane(key) {
    return /^(extra|deck|banish|gy|hand)$/.test(String(key || ''));
  }

  function laneCandidates(preferIds, laneKey) {
    loadPrints();
    const Cat = global.DdlIrlCatalog;
    const prefer = new Set((preferIds || []).map((id) => String(id).toUpperCase()).filter(Boolean));
    let all = Cat && Cat.cards ? Cat.cards() : [];
    if (!all.length) {
      all = [...prints.keys()].map((id) => ({ id, name: id, type: '' }));
    }
    const rows = all.filter((card) => allowedForLane(laneKey, card.id));
    if (prefer.size) {
      const hit = rows.filter((card) => prefer.has(String(card.id).toUpperCase()));
      if (hit.length) return hit;
      return [...prefer].map((id) => {
        const card = Cat && Cat.byId ? Cat.byId(id) : null;
        return card || { id, name: id, type: '' };
      }).filter((card) => allowedForLane(laneKey, card.id));
    }
    return rows;
  }

  function grayBand(gray, w, h, x0f, x1f) {
    const x0 = Math.max(0, Math.floor(w * x0f));
    const x1 = Math.min(w, Math.ceil(w * x1f));
    const tw = Math.max(1, x1 - x0);
    const out = new Float32Array(tw * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < tw; x += 1) {
        out[y * tw + x] = gray[y * w + (x0 + x)];
      }
    }
    return out;
  }

  function nameScoreFor(print, names) {
    let best = -1;
    (names || []).forEach((row) => {
      if (!row || !row.bits) return;
      const s = Math.max(ncc(row.bits, print.name), bitSim(row.bits, print.name) * 2 - 1);
      if (s > best) best = s;
    });
    return best;
  }

  function identify(arts, full, names, preferIds, laneKey) {
    if (!isPlayLane(laneKey)) return null;
    const cands = laneCandidates(preferIds, laneKey);
    if (!cands.length) return null;
    loadPrints();
    const tight = Boolean(preferIds && preferIds.length);
    const ranked = [];
    cands.forEach((card) => {
      const id = String(card.id).toUpperCase();
      const print = prints.get(id);
      if (!print) return;
      let artBest = -1;
      (arts || []).forEach((art) => {
        if (art && art.gray) {
          const s = ncc(art.gray, print.art);
          if (s > artBest) artBest = s;
        }
      });
      const fullS = full && full.gray && print.full ? ncc(full.gray, print.full) : -1;
      ranked.push({
        id,
        name: card.name,
        art: artBest,
        nameS: -1,
        full: fullS,
        score: 0.85 * Math.max(0, artBest) + 0.15 * Math.max(0, fullS),
      });
    });
    ranked.sort((a, b) => b.score - a.score);
    ranked.slice(0, 3).forEach((row) => {
      const print = prints.get(row.id);
      if (!print) return;
      row.nameS = nameScoreFor(print, names);
      if (row.nameS >= 0.28) {
        row.score = 0.70 * Math.max(0, row.art) + 0.22 * row.nameS + 0.08 * Math.max(0, row.full);
      }
    });
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;
    const top = ranked[0];
    const second = ranked[1];
    const gap = second ? top.score - second.score : 1;
    const accept = tight
      ? (
        (top.art >= 0.26 && gap >= 0.045)
        || (top.nameS >= 0.38 && top.art >= 0.18 && gap >= 0.04)
      )
      : (
        (top.art >= 0.36 && gap >= 0.07)
        || (top.nameS >= 0.45 && top.art >= 0.24 && gap >= 0.06)
      );
    if (!accept) return null;
    const conf = Math.max(0, Math.min(1, (top.score - 0.12) / 0.55));
    return {
      id: top.id,
      conf,
      score: top.score,
      name: top.name,
      art: Math.max(0, top.art),
      why: top.art >= (top.nameS || 0) ? 'art' : 'name',
      nameOk: top.nameS >= 0.28,
      artOk: top.art >= 0.26,
    };
  }

  function scan(video, slotEls, preferIds) {
    if (scan._busy) return scan._last || [];
    scan._busy = true;
    try {
      loadPrints();
      if (!video) return [];
      const size = mediaSize(video);
      if (!size) return [];
      const vw = size.vw;
      const vh = size.vh;
      const rows = (slotEls || []).map((row) => {
        const empty = {
          key: row.key,
          occupied: false,
          energy: 0,
          id: '',
          conf: 0,
          nameOk: false,
          artOk: false,
        };
        const mapped = slotToVideoRect(video, row.el) || gridSlotRect(video, row.key);
        const rect = mapped && clipRect(mapped, vw, vh);
        if (!rect) return empty;
        if (!isPlayLane(row.key)) {
          return { ...empty, pile: true };
        }
        const raw = grabSlot(video, rect);
        if (!raw || !looksLikeCard(raw)) return empty;
        let src = raw;
        const matBox = matCardBox(raw);
        if (matBox.x1 - matBox.x0 < 0.92 && matBox.y1 - matBox.y0 < 0.92) {
          const cropped = cropSrc(raw, matBox);
          if (cropped && looksLikeCard(cropped)) src = cropped;
        }
        const arts = [sampleGray(src, artBox, artW, artH)];
        const full = sampleGray(src, fullBox, fullW, fullH);
        const names = collectNames(src);
        const hit = identify(arts, full, names, preferIds, row.key);
        if (!hit || !hit.id) return empty;
        return {
          key: row.key,
          occupied: true,
          energy: 0,
          id: hit.id,
          conf: hit.conf,
          nameOk: Boolean(hit.nameOk),
          artOk: Boolean(hit.artOk),
        };
      });
      scan._last = squashAdjacent(rows);
      return scan._last;
    } finally {
      scan._busy = false;
    }
  }

  function squashAdjacent(hits) {
    const map = {};
    hits.forEach((h) => { map[h.key] = h; });
    function clear(h) {
      h.id = '';
      h.occupied = false;
      h.nameOk = false;
      h.artOk = false;
      h.conf = 0;
    }
    ['creature', 'spell'].forEach((row) => {
      const lane = [];
      for (let i = 0; i < 5; i += 1) {
        const hit = map[`${row}-${i}`];
        if (hit) lane.push(hit);
      }
      let i = 0;
      while (i < lane.length) {
        const id = lane[i].id;
        if (!id) {
          i += 1;
          continue;
        }
        let j = i + 1;
        while (j < lane.length && lane[j].id === id) j += 1;
        if (j - i > 1) {
          let best = i;
          for (let k = i + 1; k < j; k += 1) {
            if ((lane[k].conf || 0) > (lane[best].conf || 0)) best = k;
          }
          for (let k = i; k < j; k += 1) {
            if (k !== best) clear(lane[k]);
          }
        }
        i = j;
      }
    });
    return hits;
  }

  function alertsFromScan(seatN, hits, boardSeat, clock, lockedCounts, catalogById) {
    const notes = [];
    const extra = hits.find((h) => h.key === 'extra');
    if (extra && extra.id) {
      notes.push({
        kind: 'extra',
        seat: seatN,
        text: `Seat ${seatN}: Extra zone looks occupied. DDL has no Extra deck.`,
      });
    }
    const creatures = hits.filter((h) => h.key.indexOf('creature-') === 0 && h.id);
    const spells = hits.filter((h) => h.key.indexOf('spell-') === 0 && h.id);
    if (creatures.length > 5) {
      notes.push({
        kind: 'overflow',
        seat: seatN,
        text: `Seat ${seatN}: more than 5 creature lanes look filled.`,
      });
    }
    if (spells.length > 5) {
      notes.push({
        kind: 'overflow',
        seat: seatN,
        text: `Seat ${seatN}: more than 5 spell/trap slots look filled.`,
      });
    }
    if (lockedCounts) {
      const onBoard = {};
      hits.forEach((h) => {
        const id = h.id || (boardSeat && laneId(boardSeat, h.key));
        if (!id) return;
        onBoard[id] = (onBoard[id] || 0) + 1;
        if (lockedCounts[id] == null) {
          const card = catalogById ? catalogById(id) : null;
          notes.push({
            kind: 'unknown',
            seat: seatN,
            text: `Seat ${seatN}: ${card ? card.name : id} is not on the locked list.`,
          });
        }
      });
      Object.keys(onBoard).forEach((id) => {
        const allowed = Number(lockedCounts[id]) || 0;
        if (allowed && onBoard[id] > allowed) {
          const card = catalogById ? catalogById(id) : null;
          notes.push({
            kind: 'copies',
            seat: seatN,
            text: `Seat ${seatN}: ${card ? card.name : id} on the mat exceeds the locked copies.`,
          });
        }
      });
    }
    const searching = clock && Number(clock.searching) === Number(seatN);
    if (!searching && clock && clock.started && Number(clock.active) === Number(seatN)) {
      const bodies = hits.filter((h) => h.key.indexOf('creature-') === 0 && h.id).length;
      if (bodies >= 5) {
        notes.push({
          kind: 'full',
          seat: seatN,
          text: `Seat ${seatN}: creature row looks full. A 6th body is an illegal extra.`,
        });
      }
    }
    return notes;
  }

  function laneId(boardSeat, key) {
    if (!boardSeat || !key) return '';
    if (key === 'extra') return boardSeat.extra && boardSeat.extra.id || '';
    if (key === 'banish') return boardSeat.banish && boardSeat.banish.id || '';
    const m = key.match(/^(creature|spell)-(\d)$/);
    if (!m) return '';
    const arr = m[1] === 'creature' ? boardSeat.creatures : boardSeat.spells;
    const slot = arr && arr[Number(m[2])];
    return slot && slot.id || '';
  }

  function printCount() {
    loadPrints();
    return prints.size;
  }

  global.DdlIrlWatch = {
    scan,
    loadPrints,
    printCount,
    alertsFromScan,
    slotToVideoRect,
    isPlayLane,
    isPileLane,
  };
})(window);
