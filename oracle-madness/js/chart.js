// SPDX-License-Identifier: Apache-2.0
// Tiny dependency-free canvas race chart: % change of two assets with their
// Pyth confidence bands ("shields") drawn around each line.
export class RaceChart {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = [];
    this.opts = {};
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(200, r.width);
    this.h = Math.max(140, r.height);
    this.c.width = this.w * dpr;
    this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  set(data, opts) {
    const prevT = this.data.length ? this.data[this.data.length - 1].t : 0;
    const nextT = data.length ? data[data.length - 1].t : 0;
    // New race (time jumped backwards) — drop the eased zoom from the last match.
    if (nextT < prevT) this._tMax = null;
    this.data = data;
    this.opts = opts;
    this.draw();
  }
  draw() {
    const { ctx, w, h } = this;
    const d = this.data;
    const o = this.opts || {};
    ctx.clearRect(0, 0, w, h);
    const lastP = d.length ? d[d.length - 1] : null;
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    const labA = lastP && o.labelA ? `${o.labelA} ${(lastP.dA >= 0 ? "+" : "")}${lastP.dA.toFixed(3)}%` : "";
    const labB = lastP && o.labelB ? `${o.labelB} ${(lastP.dB >= 0 ? "+" : "")}${lastP.dB.toFixed(3)}%` : "";
    const labW = Math.max(ctx.measureText(labA).width, ctx.measureText(labB).width, 0);
    const pad = { l: 52, r: Math.max(20, Math.ceil(labW) + 16), t: 14, b: 26 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const lastT = lastP ? lastP.t : 0;
    const planned = Math.max(o.duration || 1, 1);
    // Keep the planned window while the race is in progress so the line grows
    // toward the finish. Once it reaches (or passes) that end, zoom the x-axis
    // out so the heads and labels sit inside the plot instead of clipping.
    const target = lastT >= planned * 0.98 ? Math.max(planned, lastT) * 1.14 : planned;
    if (this._tMax == null || target < this._tMax * 0.5) this._tMax = target;
    else this._tMax += (target - this._tMax) * 0.28;
    const tMax = Math.max(this._tMax, 1e-6);
    let lo = -0.02, hi = 0.02;
    for (const p of d) {
      lo = Math.min(lo, p.dA - p.uA, p.dB - p.uB);
      hi = Math.max(hi, p.dA + p.uA, p.dB + p.uB);
    }
    const span = hi - lo;
    lo -= span * 0.08;
    hi += span * 0.08;
    const X = (t) => pad.l + (t / tMax) * pw;
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;

    // grid
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    const ticks = niceTicks(lo, hi, 5);
    for (const v of ticks) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(v));
      ctx.lineTo(w - pad.r, Y(v));
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText((v > 0 ? "+" : "") + v.toFixed(prec(hi - lo)) + "%", pad.l - 6, Y(v) + 4);
    }
    // zero line
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(0));
      ctx.lineTo(w - pad.r, Y(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // x labels
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,.4)";
    const step = tMax > 90 ? 30 : tMax > 30 ? 10 : tMax > 10 ? 5 : 1;
    for (let t = 0; t <= tMax + 1e-6; t += step) ctx.fillText(Math.round(t) + "s", X(t), h - 8);
    // Buzzer (end of regulation) vs actual overtime start — they diverge when
    // photo-finish waits for a slow Solana update after the 60s window.
    const mark = (t, color, label) => {
      if (!t || t >= tMax - 1e-6) return;
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(X(t), pad.t);
      ctx.lineTo(X(t), pad.t + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, X(t), pad.t + 10);
    };
    if (o.overtimeAt) mark(o.overtimeAt, "rgba(255,196,0,.9)", "OT");
    else if (o.buzzer) mark(o.buzzer, "rgba(230,218,254,.7)", "BUZZER");
    else if (o.regulation) mark(o.regulation, "rgba(255,196,0,.9)", "OT");
    if (!d.length) return;
    // keep the two end labels from overlapping
    let yA = Y(lastP.dA) + 4, yB = Y(lastP.dB) + 4;
    if (Math.abs(yA - yB) < 15) {
      const mid = (yA + yB) / 2;
      if (lastP.dA >= lastP.dB) { yA = mid - 8; yB = mid + 8; } else { yA = mid + 8; yB = mid - 8; }
    }
    for (const side of ["A", "B"]) {
      const col = side === "A" ? o.colorA : o.colorB;
      const key = "d" + side, uk = "u" + side;
      // shield band
      ctx.beginPath();
      d.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p[key] + p[uk])) : ctx.moveTo(X(p.t), Y(p[key] + p[uk]))));
      for (let i = d.length - 1; i >= 0; i--) ctx.lineTo(X(d[i].t), Y(d[i][key] - d[i][uk]));
      ctx.closePath();
      ctx.fillStyle = hexA(col, 0.16);
      ctx.fill();
      // line
      ctx.beginPath();
      d.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p[key])) : ctx.moveTo(X(p.t), Y(p[key]))));
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // head
      const last = d[d.length - 1];
      ctx.beginPath();
      ctx.arc(X(last.t), Y(last[key]), 5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.textAlign = "left";
      ctx.font = "bold 12px Inter, system-ui, sans-serif";
      ctx.fillText(
        side === "A" ? labA : labB,
        Math.min(X(last.t) + 8, w - pad.r + 4),
        side === "A" ? yA : yB
      );
      ctx.font = "11px Inter, system-ui, sans-serif";
    }
  }
}
function prec(span) {
  return span < 0.05 ? 3 : span < 0.5 ? 2 : 1;
}
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}
function hexA(hex, a) {
  const h = (hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
