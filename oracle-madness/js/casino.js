// SPDX-License-Identifier: Apache-2.0
// Oracle Madness "casino floor" layer: synthesized sound (Web Audio API, no audio
// files), flashes, odometers, race bars, overtime takeover, Entropy reel, confetti +
// coin shower, jackpot banner, live price ticker, and a just-for-fun "call it"
// prediction game (points + streak in localStorage, no money involved).
const $ = (id) => document.getElementById(id);
const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const MUTE_KEY = "oracleMadness.muted.v1";
const PRED_KEY = "oracleMadness.calls.v1";

/* ------------------------------------------------------------------ */
/* Sound: every effect is generated with oscillators + noise           */
/* ------------------------------------------------------------------ */
export const Sfx = {
  ctx: null,
  master: null,
  unlocked: false,
  muted: localStorage.getItem(MUTE_KEY) === "1", // silent until the first user gesture creates the AudioContext
  _last: {},
  unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.unlocked = true;
  },
  setMuted(m) {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    if (m === false) this.unlock();
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    renderMute();
  },
  ok(name, gapMs = 0) {
    if (this.muted || !this.unlocked || !this.ctx) return false;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const now = performance.now();
    if (gapMs && now - (this._last[name] || 0) < gapMs) return false;
    this._last[name] = now;
    return true;
  },
  tone(freq, dur, { type = "sine", vol = 0.2, at = 0, slide = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  noise(dur, { vol = 0.2, at = 0, from = 400, to = 4000, q = 1 } = {}) {
    const c = this.ctx, t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf;
    f.type = "bandpass"; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
  },
  tick(up = true) { if (this.ok("tick", 120)) this.tone(up ? 1800 : 1300, 0.03, { type: "square", vol: 0.04 }); },
  click() { if (this.ok("click", 40)) this.tone(900, 0.05, { type: "triangle", vol: 0.12, slide: -400 }); },
  whoosh() { if (this.ok("whoosh", 300)) this.noise(0.45, { vol: 0.25, from: 300, to: 5000, q: 0.8 }); },
  ding() {
    if (!this.ok("ding", 400)) return;
    this.tone(1318.5, 0.5, { vol: 0.16 });
    this.tone(1975.5, 0.6, { vol: 0.1, at: 0.06 });
  },
  alarm() {
    if (!this.ok("alarm", 1500)) return;
    for (let i = 0; i < 4; i++) {
      this.tone(660, 0.18, { type: "sawtooth", vol: 0.08, at: i * 0.36 });
      this.tone(880, 0.18, { type: "sawtooth", vol: 0.08, at: i * 0.36 + 0.18 });
    }
  },
  reel(seconds = 2) {
    if (!this.ok("reel", 300)) return;
    const n = Math.round(seconds * 14);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.tone(500 + (i % 3) * 120, 0.03, { type: "square", vol: 0.05, at });
      at += 0.04 + (i / n) ** 2 * 0.2; // slows down like a reel
    }
    this.tone(1046.5, 0.35, { type: "triangle", vol: 0.15, at: at + 0.05 });
  },
  fanfare() {
    if (!this.ok("fanfare", 1500)) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    const times = [0, 0.14, 0.28, 0.42, 0.62, 0.74, 0.9];
    notes.forEach((f, i) => {
      this.tone(f, i === notes.length - 1 ? 1.2 : 0.22, { type: "triangle", vol: 0.16, at: times[i] });
      this.tone(f / 2, i === notes.length - 1 ? 1.2 : 0.22, { type: "sine", vol: 0.08, at: times[i] });
    });
    for (let i = 0; i < 10; i++) this.tone(2000 + Math.random() * 2000, 0.08, { vol: 0.04, at: 1 + i * 0.07 }); // coin sparkle
  },
};

function renderMute() {
  const b = $("muteBtn");
  if (!b) return;
  b.setAttribute("aria-pressed", String(!Sfx.muted));
  b.textContent = Sfx.muted ? "🔇 Sound off" : "🔊 Sound on";
  b.title = Sfx.muted ? "Turn sound effects on" : "Mute sound effects";
}

/* ------------------------------------------------------------------ */
/* Visual helpers                                                      */
/* ------------------------------------------------------------------ */
export function flash(el, cls = "flash", ms = 700) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(el["_" + cls]);
  el["_" + cls] = setTimeout(() => el.classList.remove(cls), ms);
}

export function screenFlash(color = "rgba(255,196,0,.35)") {
  const f = $("screenFlash");
  if (!f) return;
  f.style.setProperty("--fc", color);
  flash(f, "on", RM() ? 300 : 600);
}

// Animated number that eases toward its target (odometer feel).
class Odo {
  constructor(el, fmt) { this.el = el; this.fmt = fmt; this.v = 0; this.t = 0; this.raf = 0; }
  set(t, snap = false) {
    this.t = t;
    if (snap || RM()) { this.v = t; this.el.textContent = this.fmt(t); return; }
    if (!this.raf) this.raf = requestAnimationFrame(() => this.step());
  }
  step() {
    this.raf = 0;
    const d = this.t - this.v;
    this.v = Math.abs(d) < 1e-6 ? this.t : this.v + d * 0.25;
    this.el.textContent = this.fmt(this.v);
    if (this.v !== this.t) this.raf = requestAnimationFrame(() => this.step());
  }
}

/* ------------------------------------------------------------------ */
/* Race bars (tug of war + odometers) and lead tracking                */
/* ------------------------------------------------------------------ */
const pct = (v) => (v >= 0 ? "+" : "") + v.toFixed(3) + "%";
export class RaceBars {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="rb-side a"><span class="rb-sym"></span><span class="rb-odo mono">+0.000%</span></div>
      <div class="rb-track" aria-hidden="true"><div class="rb-shield"></div><div class="rb-fill a"></div><div class="rb-fill b"></div><div class="rb-mid"></div><div class="rb-puck"></div></div>
      <div class="rb-side b"><span class="rb-odo mono">+0.000%</span><span class="rb-sym"></span></div>`;
    const q = (s) => root.querySelector(s);
    this.symA = q(".rb-side.a .rb-sym"); this.symB = q(".rb-side.b .rb-sym");
    this.odoA = new Odo(q(".rb-side.a .rb-odo"), pct); this.odoB = new Odo(q(".rb-side.b .rb-odo"), pct);
    this.fillA = q(".rb-fill.a"); this.fillB = q(".rb-fill.b"); this.puck = q(".rb-puck"); this.shield = q(".rb-shield");
    this.leader = null;
  }
  start(a, b, colA, colB) {
    this.symA.textContent = a; this.symB.textContent = b;
    this.root.style.setProperty("--ca", colA); this.root.style.setProperty("--cb", colB);
    this.odoA.set(0, true); this.odoB.set(0, true);
    this.leader = null; this.lastA = 0; this.lastB = 0;
    this.update({ dA: 0, dB: 0, gap: 0, band: 0, leader: null, tooClose: true }, true);
  }
  // returns "a" | "b" when a clean lead changes hands, else null
  update(res, quiet = false) {
    const { dA, dB, band, tooClose } = res;
    this.odoA.set(dA); this.odoB.set(dB);
    const scale = Math.max(Math.abs(dA - dB), band, 1e-9) * 1.4;
    const diff = Math.max(-1, Math.min(1, (dA - dB) / scale)); // + = A ahead
    this.puck.style.left = 50 - diff * 50 + "%";
    this.fillA.style.width = Math.max(0, diff) * 50 + "%";
    this.fillB.style.width = Math.max(0, -diff) * 50 + "%";
    this.shield.style.width = Math.min(100, (band / scale) * 100) + "%";
    this.root.classList.toggle("close", !!tooClose);
    if (!quiet && (dA !== this.lastA || dB !== this.lastB)) Sfx.tick(dA + dB >= this.lastA + this.lastB);
    this.lastA = dA; this.lastB = dB;
    const lead = tooClose ? null : res.leader;
    let changed = null;
    if (lead && lead !== this.leader) {
      if (this.leader !== null || !quiet) changed = lead;
      this.leader = lead;
    }
    if (changed && !quiet) {
      Sfx.ding();
      flash(this.root, "lead-" + changed, 900);
    }
    return changed;
  }
}

/* ------------------------------------------------------------------ */
/* Overtime takeover                                                   */
/* ------------------------------------------------------------------ */
export function suddenDeathWheel(a, b, colA, colB) {
  const el = $("sdTakeover");
  if (!el) return { spin: async () => {}, hide() {} };
  el.style.setProperty("--ca", colA);
  el.style.setProperty("--cb", colB);
  el.querySelector(".sd-a").textContent = a;
  el.querySelector(".sd-b").textContent = b;
  el.querySelector(".sd-sub").textContent = `Entropy · even → ${a}   ·   odd → ${b}`;
  const wheel = el.querySelector(".sd-wheel");
  wheel.style.transition = "none";
  wheel.style.transform = "rotate(0deg)";
  el.classList.remove("landed");
  el.hidden = false;
  el.classList.add("show");
  Sfx.alarm();
  screenFlash("rgba(139,92,246,.45)");
  return {
    async spin(winnerIsA, seconds = 4.2) {
      const secs = RM() ? 0.35 : seconds;
      void wheel.offsetWidth;
      const jitter = (Math.random() * 56 - 28);
      const land = winnerIsA ? 0 : 180;
      wheel.style.transition = `transform ${secs}s cubic-bezier(.08,.7,.05,1)`;
      wheel.style.transform = `rotate(${360 * 7 + land + jitter}deg)`;
      Sfx.reel(secs);
      await new Promise((r) => setTimeout(r, secs * 1000 + 90));
      el.classList.add("landed");
      screenFlash();
      Sfx.ding();
    },
    hide() {
      el.classList.remove("show", "landed");
      el.hidden = true;
    },
  };
}

export function overtimeTakeover(sub) {
  const o = $("otTakeover");
  if (!o) return;
  o.querySelector("small").textContent = sub || "";
  o.hidden = false;
  Sfx.alarm();
  screenFlash("rgba(255,40,70,.4)");
  flash(o, "show", RM() ? 1200 : 2400);
  setTimeout(() => (o.hidden = true), RM() ? 1250 : 2450);
}

/* ------------------------------------------------------------------ */
/* Entropy reel (sudden death)                                         */
/* ------------------------------------------------------------------ */
// Builds a slot reel of alternating fighters; spin() lands on the winner the
// randomness already chose (the animation never decides anything).
export function buildReel(box, a, b, colA, colB) {
  const wrap = document.createElement("div");
  wrap.className = "reel";
  wrap.setAttribute("aria-hidden", "true");
  const n = 30;
  let html = "";
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? b : a;
    html += `<div class="reel-cell" style="--c:${i % 2 ? colB : colA}">${s}</div>`;
  }
  wrap.innerHTML = `<div class="reel-win"></div><div class="reel-strip">${html}</div>`;
  box.appendChild(wrap);
  const strip = wrap.querySelector(".reel-strip");
  strip.classList.add("idle");
  return {
    spin(winnerIsA, seconds = 2.6) {
      strip.classList.remove("idle");
      const cell = wrap.querySelector(".reel-cell").offsetHeight || 56;
      const idx = n - 4 + (winnerIsA ? 0 : 1); // even cells = A, odd cells = B
      const secs = RM() ? 0.3 : seconds;
      Sfx.reel(secs);
      strip.style.transition = `transform ${secs}s cubic-bezier(.12,.75,.2,1)`;
      strip.style.transform = `translateY(${-idx * cell}px)`;
      return new Promise((r) => setTimeout(() => {
        wrap.classList.add("landed");
        strip.children[idx].classList.add("hit");
        screenFlash();
        r();
      }, secs * 1000 + 80));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Confetti + coin shower + jackpot                                    */
/* ------------------------------------------------------------------ */
export function celebrate(level = "match") {
  const c = $("confetti");
  if (!c) return;
  const big = level === "champ";
  if (RM()) { screenFlash(); return; }
  const cols = ["#ffc400", "#8b5cf6", "#22e584", "#ff4d6d", "#e6dafe"];
  const nConf = big ? 140 : 40, nCoin = big ? 60 : 14;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < nConf; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = cols[i % cols.length];
    p.style.animationDuration = 2 + Math.random() * 2.5 + "s";
    p.style.animationDelay = Math.random() * 0.8 + "s";
    frag.appendChild(p);
  }
  for (let i = 0; i < nCoin; i++) {
    const p = document.createElement("b");
    p.className = "coin-drop";
    p.textContent = "◆";
    p.style.left = Math.random() * 100 + "vw";
    p.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    p.style.animationDelay = Math.random() * (big ? 1.4 : 0.5) + "s";
    p.style.fontSize = 14 + Math.random() * 18 + "px";
    frag.appendChild(p);
  }
  c.appendChild(frag);
  clearTimeout(c._t);
  c._t = setTimeout(() => (c.innerHTML = ""), 6500);
}

export function jackpot(champ, sub) {
  const j = $("jackpot");
  if (!j) return;
  j.querySelector(".jp-name").textContent = champ;
  j.querySelector(".jp-sub").textContent = sub || "";
  j.hidden = false;
  Sfx.fanfare();
  screenFlash("rgba(255,196,0,.5)");
  celebrate("champ");
  flash(j, "show", 4200);
  setTimeout(() => (j.hidden = true), 4300);
}

/* ------------------------------------------------------------------ */
/* Bracket lighting                                                    */
/* ------------------------------------------------------------------ */
export function lightBracket(sym, round) {
  const rounds = document.querySelectorAll("#bracket .round");
  const cur = rounds[round], next = rounds[round + 1];
  const find = (r) => r && [...r.querySelectorAll(".slot")].find((s) => s.querySelector(".nm")?.textContent === sym);
  const a = find(cur), b = find(next);
  if (a) { a.closest(".bm")?.classList.add("lit"); flash(a, "pulse-win", 1400); }
  if (b) setTimeout(() => flash(b, "arrive", 1400), RM() ? 0 : 350);
}

/* ------------------------------------------------------------------ */
/* Live ticker                                                         */
/* ------------------------------------------------------------------ */
export function startTicker(getRows) {
  const el = $("ticker");
  if (!el) return;
  const track = el.querySelector(".tk-track");
  const prev = {};
  const draw = () => {
    const rows = getRows();
    if (!rows.length) return;
    const html = rows.map(({ sym, price, conf, color, live }) => {
      const dir = prev[sym] == null || price == null ? "" : price > prev[sym] ? "up" : price < prev[sym] ? "down" : "";
      if (price != null) prev[sym] = price;
      return `<span class="tk-item ${dir}"><i style="background:${color}"></i><b>${sym}</b> ${price == null ? "—" : "$" + fmt(price)}${conf ? ` <small>±${fmt(conf)}</small>` : ""}${live ? "" : ' <small class="sim">SIM</small>'}</span>`;
    }).join("");
    track.innerHTML = `<div class="tk-run">${html}</div><div class="tk-run" aria-hidden="true">${html}</div>`;
    el.hidden = false;
  };
  draw();
  setInterval(draw, 1500);
}
function fmt(p) {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const d = Math.min(10, Math.max(2, -Math.floor(Math.log10(p)) + 3));
  return p.toFixed(d);
}

/* ------------------------------------------------------------------ */
/* "Call it" prediction game: points + streak, localStorage only       */
/* ------------------------------------------------------------------ */
export const Calls = {
  st: (() => { try { return JSON.parse(localStorage.getItem(PRED_KEY)) || null; } catch { return null; } })() || { pts: 0, streak: 0, best: 0, made: 0, hit: 0 },
  current: null,
  save() { localStorage.setItem(PRED_KEY, JSON.stringify(this.st)); this.render(); },
  render() {
    const el = $("callStats");
    if (el) el.innerHTML = `<b>${this.st.pts}</b> pts · streak <b>${this.st.streak}</b>${this.st.streak >= 3 ? " 🔥" : ""} · best ${this.st.best} · ${this.st.hit}/${this.st.made} called`;
  },
  open(a, b, colA, colB) {
    const box = $("callBox");
    if (!box) return;
    this.current = { a, b, pick: null, open: true };
    box.hidden = false;
    box.classList.remove("won", "lost");
    box.querySelector(".call-q").textContent = "Pick your winner: who advances?";
    const [ba, bb] = box.querySelectorAll(".call-btn");
    ba.textContent = a; bb.textContent = b;
    ba.style.setProperty("--c", colA); bb.style.setProperty("--c", colB);
    [ba, bb].forEach((btn) => { btn.disabled = false; btn.setAttribute("aria-pressed", "false"); });
    ba.onclick = () => this.pick(a, ba, bb);
    bb.onclick = () => this.pick(b, bb, ba);
    this.render();
  },
  pick(sym, on, off) {
    if (!this.current?.open) return;
    this.current.pick = sym;
    on.setAttribute("aria-pressed", "true"); off.setAttribute("aria-pressed", "false");
    flash(on, "pop", 400);
    $("callBox").querySelector(".call-q").textContent = `You called ${sym}. Calls lock at the halfway mark.`;
  },
  lock() {
    if (!this.current?.open) return;
    this.current.open = false;
    $("callBox")?.querySelectorAll(".call-btn").forEach((b) => (b.disabled = true));
    if (this.current.pick) $("callBox").querySelector(".call-q").textContent = `Locked: ${this.current.pick}`;
    else $("callBox").querySelector(".call-q").textContent = "No call this match";
  },
  settle(winner, how) {
    const c = this.current;
    if (!c) return null;
    this.lock();
    this.current = null;
    if (!c.pick) return null;
    const box = $("callBox");
    this.st.made++;
    let gained = 0;
    if (c.pick === winner) {
      this.st.hit++;
      this.st.streak++;
      this.st.best = Math.max(this.st.best, this.st.streak);
      gained = 100 * Math.min(5, this.st.streak) + (how === "sd" ? 50 : how === "ot" ? 25 : 0);
      this.st.pts += gained;
      box.classList.add("won");
      box.querySelector(".call-q").textContent = `✔ ${winner}! +${gained} pts${this.st.streak > 1 ? ` (×${Math.min(5, this.st.streak)} streak)` : ""}`;
      flash($("callStats"), "pop", 500);
    } else {
      this.st.streak = 0;
      box.classList.add("lost");
      box.querySelector(".call-q").textContent = `✘ ${winner} advanced. Streak reset.`;
    }
    this.save();
    return gained;
  },
};

/* ------------------------------------------------------------------ */
/* Wire-up                                                             */
/* ------------------------------------------------------------------ */
export function initCasino() {
  const b = $("muteBtn");
  if (b) b.addEventListener("click", (e) => { e.stopPropagation(); Sfx.setMuted(!Sfx.muted); if (!Sfx.muted) Sfx.ding(); });
  renderMute();
  // The audio context is only created after a real user gesture (autoplay rules).
  const first = () => { if (!Sfx.muted) Sfx.unlock(); };
  addEventListener("pointerdown", first, { once: true, capture: true });
  addEventListener("keydown", first, { once: true, capture: true });
  // button click sounds + ripple micro-interaction
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, .choice");
    if (!t || t.id === "muteBtn") return;
    Sfx.click();
    if (RM()) return;
    const r = t.getBoundingClientRect();
    const s = document.createElement("span");
    s.className = "ripple";
    s.style.left = e.clientX - r.left + "px";
    s.style.top = e.clientY - r.top + "px";
    t.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });
  Calls.render();
}
