// SPDX-License-Identifier: Apache-2.0
// Oracle Madness: UI + tournament orchestration (vanilla ES modules, no build step).
import { ASSETS, BRACKETS, ROUND_NAMES, ROUND_POINTS, resolveBracket } from "./assets.js?v=20261022";
import { HermesProxySource, SolanaOnchainSource, DemoSource, MixedSource, readEvmPythPrice } from "./sources.js?v=20261022";
import { SimulatedEntropy, shuffle } from "./entropy.js";
import { buildBracket, advance, allMatches, judge, scorePicks, setPick, pickSlots, picksComplete } from "./engine.js?v=20261022";
import { RaceChart } from "./chart.js";
import { Sfx, RaceBars, overtimeTakeover, suddenDeathWheel, celebrate, jackpot, lightBracket, startTicker, Calls, flash, screenFlash, initCasino } from "./casino.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const TURBO = params.get("demo") === "turbo";
const LB_KEY = "oracleMadness.leaderboard.v1";
const PROXY = params.get("proxy") || "proxy.php";

const S = {
  bracketId: params.get("bracket") || "doginal16",
  source: null,
  entropy: new SimulatedEntropy(),
  bracket: null,
  picks: [],
  locked: false,
  name: "",
  replays: [],
  avail: { checked: false, hermes: false, hermesCov: new Set(), solana: null },
  phase: "setup",
};
window.__om = S; // handy for debugging in the console
const setState = (s) => { S.phase = s; document.body.dataset.state = s; };
setState("setup");

/* -------------------------------------------------------------- */
/* formatting                                                      */
/* -------------------------------------------------------------- */
function fmtPrice(p) {
  if (p == null || !isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const d = Math.min(14, Math.max(2, -Math.floor(Math.log10(p)) + 4));
  return p.toFixed(d);
}
const fmtPct = (v, d = 3) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const short = (h) => (h ? "0x" + h.slice(0, 10) + "…" + h.slice(-6) : "—");
const tok = (sym, cls = "") => {
  const a = ASSETS[sym];
  return `<span class="tok ${cls}" style="background:${a.color}" aria-hidden="true">${sym.slice(0, 4)}</span>`;
};
const say = (t) => { $("sr").textContent = t; };
function timeAgo(sec) {
  if (!isFinite(sec)) return "never";
  if (sec < 90) return Math.round(sec) + " s ago";
  if (sec < 5400) return Math.round(sec / 60) + " min ago";
  if (sec < 172800) return Math.round(sec / 3600) + " h ago";
  return Math.round(sec / 86400) + " days ago";
}

/* -------------------------------------------------------------- */
/* setup screen                                                    */
/* -------------------------------------------------------------- */
// ---- availability & per-asset routing --------------------------------------
// Each asset is routed to ONE real Pyth source: Hermes (if the proxy's key is
// entitled to it), else its Solana push feed (if fresh), else it is not live and
// is left out of live brackets. Simulated data only appears in explicit demo mode.
const FRESH_SEC = 180;
const allCandidates = () => [...new Set(Object.values(BRACKETS).flatMap((b) => b.candidates))];
function solFresh(sym) {
  const ages = S.avail.solana;
  return !!ages && ages[sym] < FRESH_SEC;
}
function hermesHas(sym) {
  return !!(S.avail.hermes && S.avail.hermesCov && S.avail.hermesCov.has(sym));
}
function routeFor(sym, choice, def) {
  if (choice === "demo") return "demo";
  if (def?.keylessOnly || choice === "solana") return solFresh(sym) ? "solana" : null;
  if (choice === "hermes") return hermesHas(sym) ? "hermes" : null;
  return hermesHas(sym) ? "hermes" : solFresh(sym) ? "solana" : null; // auto = mixed
}
function lineup(def, choice = $("srcSelect").value) {
  if (!S.avail.checked && choice !== "demo") return { pending: true, assets: def.candidates.slice(0, def.size), dropped: [], ok: false };
  const r = resolveBracket(def, (s) => !!routeFor(s, choice, def), { demo: choice === "demo" });
  r.routes = {};
  r.assets.forEach((s) => (r.routes[s] = routeFor(s, choice, def)));
  return r;
}

function renderChoices() {
  const wrap = $("bracketChoices");
  const choice = $("srcSelect").value;
  wrap.innerHTML = Object.values(BRACKETS)
    .map((b) => {
      const L = lineup(b, choice);
      const chips = L.assets
        .map((s) => {
          const rt = L.routes?.[s];
          const mark = rt === "hermes" ? "H" : rt === "solana" ? "S" : rt === "demo" ? "sim" : "…";
          const t = rt === "hermes" ? "live via Pyth Hermes" : rt === "solana" ? "live via Pyth Solana push feed" : rt === "demo" ? "simulated" : "checking";
          return `<span class="chip" style="color:${ASSETS[s].color}" title="${s}: ${t}">${s}<sup>${mark}</sup></span>`;
        })
        .join("");
      const note = L.pending
        ? `<em class="chip-note">Checking live feeds…</em>`
        : !L.ok
        ? `<em class="chip-note warn">Not available live: ${L.reason}. Try Quick demo.</em>`
        : L.dropped.length
        ? `<em class="chip-note">${L.size} live seeds. Sitting out (no live Pyth feed right now): ${L.dropped.join(", ")}</em>`
        : `<em class="chip-note">${L.size} live seeds</em>`;
      return `<button type="button" class="choice" role="radio" aria-checked="${b.id === S.bracketId}" data-id="${b.id}" ${!L.pending && !L.ok ? 'aria-disabled="true"' : ""}>
        <strong>${b.title}</strong><span>${b.blurb}</span>
        <div class="chips">${chips}</div>${note}
      </button>`;
    })
    .join("");
  wrap.querySelectorAll(".choice").forEach((el) =>
    el.addEventListener("click", () => {
      S.bracketId = el.dataset.id;
      refreshSetup();
    })
  );
}

async function detectSources() {
  const t0 = performance.now();
  const cached = HermesProxySource.cachedCoverage();
  const solP = new SolanaOnchainSource().freshness(Object.keys(ASSETS)).catch(() => null);
  const healthP = HermesProxySource.available(PROXY);
  const health = await healthP;
  let covP = null;
  if (health) covP = HermesProxySource.coverage(allCandidates(), PROXY).catch(() => null);
  // A cached coverage answer (< 30 min old) lets the page get going immediately;
  // the fresh answer still replaces it if it arrives before the draw.
  const [sol, cov] = await Promise.all([solP, cached && covP ? Promise.race([covP, sleep(400).then(() => cached)]) : covP]);
  S.avail = { checked: true, hermes: !!(health && cov && cov.size), hermesCov: cov || new Set(), solana: sol };
  console.info(`Source check ${Math.round(performance.now() - t0)} ms`);
  // If the default bracket can't run live, pre-select the first one that can.
  if (!params.has("bracket") && $("srcSelect").value !== "demo" && !lineup(BRACKETS[S.bracketId]).ok) {
    const alt = Object.values(BRACKETS).find((b) => lineup(b).ok);
    if (alt) S.bracketId = alt.id;
  }
  refreshSetup();
  if (cached && covP) covP.then((fresh) => {
    if (fresh && S.phase === "setup" && [...fresh].sort().join() !== [...S.avail.hermesCov].sort().join()) {
      S.avail.hermesCov = fresh;
      S.avail.hermes = fresh.size > 0;
      refreshSetup();
    }
  });
}
function refreshSetup() {
  renderChoices();
  updateSrcHelp();
  tuneWindowsForSource();
}
function updateSrcHelp() {
  const def = BRACKETS[S.bracketId];
  const choice = $("srcSelect").value;
  const L = lineup(def, choice);
  const btn = $("drawBtn");
  if (L.pending) {
    $("srcHelp").innerHTML = "Checking which Pyth feeds are live (a few seconds at most)…";
    btn.disabled = true;
    return;
  }
  btn.disabled = !L.ok;
  if (choice === "demo") {
    $("srcHelp").innerHTML = "⚠️ <strong>Simulated data</strong>: prices are generated in your browser and are not real.";
    return;
  }
  const cand = def.candidates;
  const hList = cand.filter(hermesHas);
  const sList = cand.filter((s) => solFresh(s) && !hermesHas(s));
  const h = !S.avail.hermes ? "⛔ Hermes proxy not available (no key, or proxy unreachable)" : `✅ Hermes key live for: ${hList.join(", ") || "none of these"}`;
  const so = !S.avail.solana ? "⛔ Solana RPC unreachable" : `✅ Fresh Solana push feeds: ${sList.join(", ") || "none extra"}`;
  const nH = Object.values(L.routes || {}).filter((r) => r === "hermes").length;
  const nS = Object.values(L.routes || {}).filter((r) => r === "solana").length;
  const line = L.ok
    ? `Lineup: <strong>${L.size} live seeds</strong> (${nH} via Hermes, ${nS} via Solana)${nH && nS ? " → <strong>LIVE · MIXED</strong>" : ""}`
    : `⚠️ ${def.title} can't run live: ${L.reason}.`;
  $("srcHelp").innerHTML = `${h}<br>${so}<br>${line}`;
}
// Slow (Solana ~60 s) feeds need longer windows; settlement waits for a post-buzzer update anyway.
function tuneWindowsForSource() {
  if (TURBO || params.has("window")) return;
  const L = lineup(BRACKETS[S.bracketId]);
  const slow = Object.values(L.routes || {}).includes("solana");
  if (slow && +$("winInput").value < 60) { $("winInput").value = 60; $("otInput").value = 30; }
  if (!slow && +$("winInput").value === 60 && +$("otInput").value === 30) { $("winInput").value = 30; $("otInput").value = 15; }
}
function makeSource(choice, L, windowSec) {
  if (choice === "demo") return new DemoSource({ windowSec, tickMs: TURBO ? 100 : 250 });
  return new MixedSource(L.routes, PROXY);
}
function readCfg() {
  const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
  return {
    window: Math.max(2, num("winInput", 30)),
    ot: Math.max(1, num("otInput", 15)),
    k: Math.max(0, num("kInput", 1)),
    prize: Math.max(0, num("prizeInput", 100)),
    src: $("srcSelect").value,
  };
}

/* -------------------------------------------------------------- */
/* seeding                                                         */
/* -------------------------------------------------------------- */
async function startSeeding() {
  S.cfg = readCfg();
  const def = BRACKETS[S.bracketId];
  S.def = def;
  const L = lineup(def, S.cfg.src);
  if (!L.ok) {
    alert(`${def.title} can't run on live data right now (${L.reason || "still checking"}). Try another bracket or the Quick demo.`);
    return;
  }
  S.lineup = L;
  S.source = makeSource(S.cfg.src, L, S.cfg.window);
  setBadge();
  $("setup").hidden = true;
  $("seeding").hidden = false;
  setState("seeding");
  const fast = TURBO ? 0.25 : 1;

  await S.entropy.init();
  $("stepCommit").classList.add("on");
  $("seedCommit").textContent = "0x" + S.entropy.commitment;
  await sleep(700 * fast);
  const draw = await S.entropy.request("Bracket seeding");
  logEntropy(draw);
  $("stepUser").classList.add("on");
  $("seedUser").textContent = "0x" + draw.userRandom;
  await sleep(700 * fast);
  $("stepReveal").classList.add("on");
  $("seedReveal").textContent = "0x" + draw.providerReveal;
  if (draw.verified) $("stepReveal").classList.add("ok");
  await sleep(700 * fast);
  $("stepRandom").classList.add("on");
  $("seedRandom").textContent = "0x" + draw.random;
  const seeded = await shuffle(L.assets, draw.random);
  S.seedDraw = draw;
  const list = $("seedList");
  list.innerHTML = "";
  for (let i = 0; i < seeded.length; i++) {
    const s = seeded[i];
    const li = document.createElement("li");
    li.innerHTML = `<span class="seed">${i + 1}</span>${tok(s)}<strong>${s}</strong>`;
    li.style.animationDelay = i * 60 * fast + "ms";
    list.appendChild(li);
  }
  say("Seeds drawn. Number one seed: " + seeded[0]);
  await sleep((seeded.length * 60 + 900) * fast);

  // start data early so prices are warm by kickoff
  S.sourceReady = S.source.init(L.assets).catch((e) => console.warn("source init", e));
  startTicker(() => L.assets.map((sym) => { const p = S.source.latest(sym); return { sym, price: p?.price, conf: p?.conf, color: ASSETS[sym].color, live: !S.source.simulated }; }));
  S.bracket = buildBracket(seeded);
  $("seeding").hidden = true;
  $("bracketPanel").hidden = false;
  $("side").hidden = false;
  renderLeaderboard();
  updatePrize();
  enterPickMode();
}

/* -------------------------------------------------------------- */
/* pick'em                                                         */
/* -------------------------------------------------------------- */
function enterPickMode() {
  setState("picks");
  S.picks = S.bracket.rounds.map(() => []);
  $("pickBar").hidden = false;
  const pts = ROUND_POINTS[S.bracket.size];
  $("ptsInfo").textContent = ROUND_NAMES[S.bracket.size].map((n, i) => `${n} ${pts[i]}`).join(" · ");
  $("nameInput").value = localStorage.getItem("oracleMadness.name") || "";
  renderBracket();
  if (TURBO) {
    autoFill("random");
    $("nameInput").value = $("nameInput").value || "Demo fan";
    setTimeout(() => lockPicks(), 600);
  }
}
function autoFill(mode) {
  const b = S.bracket;
  S.picks = b.rounds.map(() => []);
  b.rounds.forEach((ms, r) =>
    ms.forEach((_, i) => {
      const [x, y] = pickSlots(b, S.picks, r, i);
      const choice = mode === "chalk" ? (b.seeds[x] < b.seeds[y] ? x : y) : Math.random() < 0.5 ? x : y;
      setPick(b, S.picks, r, i, choice);
    })
  );
  renderBracket();
}
function updatePickCount() {
  const total = allMatches(S.bracket).length;
  const n = S.picks.flat().filter(Boolean).length;
  $("pickCount").textContent = `${n} / ${total} picks`;
  $("lockBtn").disabled = !picksComplete(S.bracket, S.picks);
}
function lockPicks() {
  S.locked = true;
  S.name = ($("nameInput").value || "Anonymous").trim().slice(0, 24);
  localStorage.setItem("oracleMadness.name", S.name);
  beginTournament();
}

/* -------------------------------------------------------------- */
/* bracket rendering                                               */
/* -------------------------------------------------------------- */
function renderBracket() {
  const b = S.bracket;
  const pickMode = S.phase === "picks";
  const names = ROUND_NAMES[b.size];
  const el = $("bracket");
  el.innerHTML = b.rounds
    .map((ms, r) => {
      const body = ms
        .map((m, i) => {
          let slots;
          if (pickMode) {
            const [x, y] = pickSlots(b, S.picks, r, i);
            slots = [x, y].map((s) => pickSlotHtml(s, r, i)).join("");
          } else {
            slots = [["a", m.a], ["b", m.b]].map(([side, s]) => liveSlotHtml(m, side, s)).join("");
          }
          const tag = m.result?.suddenDeath ? `<span class="tag sd" title="Decided in sudden death">SUDDEN DEATH</span>` : m.result?.overtime ? `<span class="tag ot" title="Went to overtime">OT</span>` : "";
          const mine = !pickMode && S.locked ? myPickHtml(m, r, i) : "";
          const my = tag || mine ? `<div class="bm-pick">${mine}${tag}</div>` : "";
          const label = `${names[r]} match ${i + 1}`;
          return `<div class="bm ${m.status === "live" ? "active" : ""}" role="group" aria-label="${label}">${slots}${tag}${my}</div>`;
        })
        .join("");
      return `<div class="round"><h3>${names[r]}</h3><div class="round-body">${body}</div></div>`;
    })
    .join("");
  if (pickMode) {
    el.querySelectorAll("button.slot[data-sym]").forEach((btn) =>
      btn.addEventListener("click", () => {
        setPick(b, S.picks, +btn.dataset.r, +btn.dataset.i, btn.dataset.sym);
        renderBracket();
      })
    );
    updatePickCount();
  }
}
function pickSlotHtml(sym, r, i) {
  if (!sym) return `<button class="slot empty" disabled><span class="nm">Pick earlier round</span></button>`;
  const picked = S.picks[r]?.[i] === sym;
  return `<button class="slot ${picked ? "picked" : ""}" data-sym="${sym}" data-r="${r}" data-i="${i}" aria-pressed="${picked}" aria-label="Pick ${sym} to win">
    <span class="seed">${S.bracket.seeds[sym]}</span>${tok(sym)}<span class="nm">${sym}</span></button>`;
}
function liveSlotHtml(m, side, sym) {
  if (!sym) return `<div class="slot empty"><span class="nm">TBD</span></div>`;
  const cls = m.status === "done" ? (m.winner === sym ? "win" : "lose") : "";
  const pc = m.result ? fmtPct(side === "a" ? m.result.final.dA : m.result.final.dB, 3) : "";
  return `<div class="slot ${cls}"><span class="seed">${S.bracket.seeds[sym]}</span>${tok(sym)}<span class="nm">${sym}</span><span class="pc">${pc}</span></div>`;
}
function myPickHtml(m, r, i) {
  const p = S.picks[r]?.[i];
  if (!p) return "";
  let cls = "";
  if (m.status === "done") cls = p === m.winner ? "ok" : "bad";
  else if (isOut(p, r)) cls = "bad";
  return `<span>Your pick <span class="mypick ${cls}">${p}</span></span>`;
}
function isOut(sym, r) {
  return S.bracket.rounds.slice(0, r + 1).flat().some((m) => m.status === "done" && (m.a === sym || m.b === sym) && m.winner !== sym);
}

/* -------------------------------------------------------------- */
/* tournament                                                      */
/* -------------------------------------------------------------- */
async function beginTournament() {
  setState("live");
  $("pickBar").hidden = true;
  $("arena").hidden = false;
  $("scoreBadge").hidden = !S.locked;
  $("arena").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  renderMyPick();
  renderBracket();
  S.chart = S.chart || new RaceChart($("race"));
  await S.sourceReady;
  const total = allMatches(S.bracket).length;
  $("matchTotal").textContent = total;
  let no = 0;
  for (let r = 0; r < S.bracket.rounds.length; r++) {
    for (const m of S.bracket.rounds[r]) {
      no++;
      $("matchNo").textContent = no;
      $("roundName").textContent = ROUND_NAMES[S.bracket.size][r];
      await runMatch(m);
    }
  }
  await crownChampion();
}

function setPhase(kind, text) {
  const ph = $("phase");
  ph.className = "sb-phase phase-" + kind;
  ph.textContent = text;
  $("arena").classList.toggle("ot", kind === "ot");
  $("arena").classList.toggle("sd", kind === "sd");
}
function banner(text, sub, cls, ms = 1900) {
  const b = $("banner");
  $("bannerText").textContent = text;
  $("bannerSub").textContent = sub || "";
  b.className = "banner " + cls;
  void b.offsetWidth;
  b.classList.add("show");
  say(text + ". " + (sub || ""));
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove("show"), ms);
}

async function waitForPrices(syms, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (syms.every((s) => S.source.latest(s))) return true;
    await sleep(200);
  }
  return false;
}

function renderFighter(el, sym, seed, cur, d, u, maxU) {
  const a = ASSETS[sym];
  el.style.setProperty("--c", a.color);
  const dir = d > 0 ? "up" : d < 0 ? "down" : "";
  el.innerHTML = `${tok(sym, "lg")}
    <div>
      <div class="f-sub">#${seed} seed · ${a.name}</div>
      <div class="f-name">${sym}</div>
      <div class="f-pct ${dir}" aria-label="${sym} change">${fmtPct(d)}</div>
      <div class="f-price">$${fmtPrice(cur?.price)} <span class="muted">± ${fmtPrice(cur?.conf)}</span></div>
      <div class="shield" aria-hidden="true"><i style="width:${Math.min(100, (u / maxU) * 100)}%"></i></div>
      <div class="shield-l">Confidence shield ±${u.toFixed(3)}%</div>
      <div class="f-src ${S.source.simulated ? "sim" : "live"}">${S.source.simulated ? "SIMULATED" : "LIVE"} · ${srcLabel(sym)}${cur && !S.source.simulated ? ` · published ${timeAgo(Date.now() / 1000 - cur.publishTime)}` : ""}</div>
    </div>`;
}
function srcLabel(sym) {
  return S.source.routeLabel ? S.source.routeLabel(sym) : S.source.short;
}
const slowFeed = (sym) => (S.source.cadence ? S.source.cadence(sym) : 1) > 5;

// FAIR SETTLEMENT
// Hermes feeds tick ~every second; Solana push feeds step every ~45-60 s. To compare
// like with like at the buzzer:
//  1. PHOTO FINISH: wait (bounded) until every slow feed has published at/after the buzzer.
//  2. TIME ALIGNMENT: if exactly one side is slow, the fast side is priced at the slow
//     side's exact start and end publish times (from the polled Hermes buffer, or a
//     signed Pyth Benchmarks update), so both % changes cover the same seconds.
async function settle(m, rawStartA, rawStartB, buzzerSec, onWait) {
  const notes = [];
  const slow = [m.a, m.b].filter(slowFeed);
  if (slow.length && !S.source.simulated) {
    const maxWait = TURBO ? 0 : 75;
    const t0 = Date.now();
    setPhase("ot", "PHOTO FINISH");
    for (;;) {
      const waiting = slow.filter((s) => (S.source.latest(s)?.publishTime || 0) < buzzerSec - 1);
      if (!waiting.length) break;
      const left = Math.ceil(maxWait - (Date.now() - t0) / 1000);
      if (left <= 0) { notes.push(`No post-buzzer update from ${waiting.join(", ")} within ${maxWait}s; used its latest on-chain price.`); break; }
      $("refCall").textContent = `Photo finish: waiting for ${waiting.join(" & ")}'s next on-chain Pyth update`;
      $("clock").textContent = "≤" + left + "s";
      if (typeof onWait === "function") onWait();
      await sleep(500);
    }
    if (typeof onWait === "function") onWait();
  }
  let sA = rawStartA, sB = rawStartB;
  let eA = { ...S.source.latest(m.a) }, eB = { ...S.source.latest(m.b) };
  let aligned = null;
  if (slow.length === 1 && !S.source.simulated) {
    const slowIsA = slow[0] === m.a;
    const fast = slowIsA ? m.b : m.a;
    const ss = slowIsA ? sA : sB, se = slowIsA ? eA : eB;
    const [fs, fe] = await Promise.all([S.source.priceAt(fast, ss.publishTime), S.source.priceAt(fast, se.publishTime)]);
    if (fs && fe) {
      if (slowIsA) { sB = fs; eB = fe; } else { sA = fs; eA = fe; }
      aligned = { slow: slow[0], fast, from: ss.publishTime, to: se.publishTime, via: [fs.via, fe.via] };
      notes.push(`Time-aligned: ${fast} priced at ${slow[0]}'s on-chain publish times (${fs.via} / ${fe.via}).`);
    } else notes.push(`Couldn't align ${fast} to ${slow[0]}'s publish times; used live samples.`);
  } else if (slow.length === 2) {
    notes.push("Both feeds are Solana push feeds; each measured from its own start update to its first update after the buzzer.");
  }
  const res = judge(sA, eA, sB, eB, S.cfg.k);
  return { res, startA: sA, startB: sB, endA: eA, endB: eB, aligned, notes };
}

async function runMatch(m) {
  m.status = "live";
  renderBracket();
  $("sdBox").hidden = true;
  $("champBox").hidden = true;
  const fA = $("fA"), fB = $("fB");
  fA.className = "fighter";
  fB.className = "fighter right";
  const ok = await waitForPrices([m.a, m.b]);
  if (!ok) {
    const missing = [m.a, m.b].filter((s) => !S.source.latest(s));
    setPhase("sd", "NO DATA");
    $("clock").textContent = "--:--";
    $("refCall").textContent = `No ${S.source.short} price for ${missing.join(" or ")}`;
    banner("NO PRICE DATA", `${missing.join(", ")} not available from ${S.source.short}. Reload and pick another bracket or source.`, "sd", 8000);
    throw new Error("no prices for " + missing.join(", "));
  }
  setPhase("live", "LIVE");
  $("refCall").textContent = "Referee watching";
  const slowOnes = S.source.simulated ? [] : [m.a, m.b].filter(slowFeed);
  $("chartNote").hidden = !slowOnes.length;
  $("chartNote").textContent = slowOnes.length === 1
    ? `${slowOnes[0]} comes from a Solana push feed that updates in ~60 s steps, so its line moves in jumps. At the buzzer the referee waits for its next update, then prices ${slowOnes[0] === m.a ? m.b : m.a} at the exact same publish times so both moves cover the same seconds.`
    : slowOnes.length === 2 ? "Both assets come from Solana push feeds (~60 s steps). At the buzzer the referee waits for each feed's next on-chain update." : "";
  banner(`${m.a} vs ${m.b}`, ROUND_NAMES[S.bracket.size][m.round], "win", 1300);
  Sfx.whoosh();
  S.bars = S.bars || new RaceBars($("raceBars"));
  S.bars.start(m.a, m.b, ASSETS[m.a].color, ASSETS[m.b].color);
  Calls.open(m.a, m.b, ASSETS[m.a].color, ASSETS[m.b].color);

  const startA = { ...S.source.latest(m.a) };
  const startB = { ...S.source.latest(m.b) };
  const ticks = [];
  const W = S.cfg.window, OT = S.cfg.ot, k = S.cfg.k;
  const tickMs = TURBO ? 100 : 250;
  let overtime = false;
  let endAt = W;
  let otAt = 0;
  const t0 = performance.now();
  let res;

  const paint = () => {
    const lastT = ticks.length ? ticks[ticks.length - 1].t : 0;
    S.chart.set(ticks, {
      duration: Math.max(endAt, lastT, W),
      buzzer: lastT > W ? W : 0,
      overtimeAt: overtime ? otAt : 0,
      colorA: ASSETS[m.a].color, colorB: ASSETS[m.b].color, labelA: m.a, labelB: m.b,
    });
  };
  const sample = ({ clock = true } = {}) => {
    const t = (performance.now() - t0) / 1000;
    const cA = S.source.latest(m.a), cB = S.source.latest(m.b);
    res = judge(startA, cA, startB, cB, k);
    ticks.push({ t, dA: res.dA, dB: res.dB, uA: res.uA, uB: res.uB, pA: cA.price, pB: cB.price, cA: cA.conf, cB: cB.conf, ptA: cA.publishTime, ptB: cB.publishTime });
    const maxU = Math.max(res.uA, res.uB, 1e-9) * 1.15;
    renderFighter(fA, m.a, m.seedA, cA, res.dA, res.uA, maxU);
    renderFighter(fB, m.b, m.seedB, cB, res.dB, res.uB, maxU);
    const lc = S.bars.update(res);
    if (t > W / 2) Calls.lock();
    if (lc) { flash(lc === "a" ? fA : fB, "lead-flash", 900); $("refCall").classList.remove("pop"); flash($("refCall"), "pop", 600); }
    fA.classList.toggle("leading", res.leader === "a" && !res.tooClose);
    fB.classList.toggle("leading", res.leader === "b" && !res.tooClose);
    $("gapVal").textContent = res.gap.toFixed(4) + "%";
    $("bandVal").textContent = res.band.toFixed(4) + "%";
    const scale = Math.max(res.gap, res.band, 1e-9) * 1.25;
    $("rmBand").style.width = (res.band / scale) * 100 + "%";
    $("rmGap").style.width = (res.gap / scale) * 100 + "%";
    if (clock) {
      $("refCall").textContent = res.tooClose ? "Inside the shield: too close to call" : `Clean lead: ${res.leader === "a" ? m.a : m.b}`;
      const left = Math.max(0, endAt - t);
      $("clock").textContent = (overtime ? "OT " : "") + "00:" + String(Math.ceil(left)).padStart(2, "0").slice(-2);
      if (left >= 60) $("clock").textContent = (overtime ? "OT " : "") + Math.floor(left / 60) + ":" + String(Math.ceil(left % 60)).padStart(2, "0");
    }
    paint();
    return t;
  };
  const applySettled = (st) => {
    const t = (performance.now() - t0) / 1000;
    const eA = st.endA, eB = st.endB;
    res = st.res;
    ticks.push({ t, dA: res.dA, dB: res.dB, uA: res.uA, uB: res.uB, pA: eA.price, pB: eB.price, cA: eA.conf, cB: eB.conf, ptA: eA.publishTime, ptB: eB.publishTime });
    const maxU = Math.max(res.uA, res.uB, 1e-9) * 1.15;
    renderFighter(fA, m.a, m.seedA, eA, res.dA, res.uA, maxU);
    renderFighter(fB, m.b, m.seedB, eB, res.dB, res.uB, maxU);
    S.bars.update(res);
    paint();
  };

  while (sample() < W) await sleep(tickMs);
  let st = await settle(m, startA, startB, Date.now() / 1000, () => sample({ clock: false }));
  applySettled(st);
  const regulation = st.res;
  if (regulation.tooClose) {
    overtime = true;
    const otStart = performance.now();
    otAt = (otStart - t0) / 1000;
    endAt = otAt + OT;
    setPhase("ot", "OVERTIME");
    banner("OVERTIME", `Gap ${regulation.gap.toFixed(4)}% is inside the ${regulation.band.toFixed(4)}% confidence shield`, "ot");
    overtimeTakeover(`Confidence bands overlap · gap ${regulation.gap.toFixed(4)}% ≤ shield ${regulation.band.toFixed(4)}%`);
    paint();
    while (sample() < endAt) await sleep(tickMs);
    st = await settle(m, startA, startB, Date.now() / 1000, () => sample({ clock: false }));
    applySettled(st);
  }
  const final = st.res;
  let winner, suddenDeath = null;
  if (final.tooClose) {
    setPhase("sd", "SUDDEN DEATH");
    banner("SUDDEN DEATH", "Still inside the shield. Entropy decides.", "sd");
    suddenDeath = await suddenDeathDraw(m);
    winner = suddenDeath.winner;
  } else {
    winner = final.leader === "a" ? m.a : m.b;
  }
  setPhase("final", "FINAL");
  $("clock").textContent = "FINAL";
  (winner === m.a ? fA : fB).classList.add("winner");
  (winner === m.a ? fB : fA).classList.add("loser");
  // keep the exact (settled) samples used for the decision
  m.result = {
    startA: st.startA, startB: st.startB, endA: st.endA, endB: st.endB, regulation, final, overtime, suddenDeath, ticks, k, W, OT,
    tOT: overtime ? endAt : W, otAt, aligned: st.aligned, notes: st.notes,
    routeA: srcLabel(m.a), routeB: srcLabel(m.b),
    source: S.source.label, sourceId: S.source.id, simulated: S.source.simulated,
  };
  advance(S.bracket, m, winner);
  const gained = Calls.settle(winner, suddenDeath ? "sd" : overtime ? "ot" : "");
  celebrate("match");
  screenFlash();
  Sfx.ding();
  banner(`${winner} ADVANCES`, suddenDeath ? "Won in sudden death" : overtime ? "Won in overtime" : `${fmtPct(winner === m.a ? final.dA : final.dB)} vs ${fmtPct(winner === m.a ? final.dB : final.dA)}`, "win", 1500);
  renderBracket();
  lightBracket(winner, m.round);
  renderMyPick();
  S.replays.push(m);
  renderVault();
  await sleep(TURBO ? 500 : 1600);
  await openReplay(m, true);
}

async function suddenDeathDraw(m) {
  $("banner").classList.remove("show");
  $("otTakeover").hidden = true;
  const wheel = suddenDeathWheel(m.a, m.b, ASSETS[m.a].color, ASSETS[m.b].color);
  const draw = await S.entropy.request(`Sudden death ${m.a} vs ${m.b}`);
  logEntropy(draw);
  const even = parseInt(draw.random.slice(-8), 16) % 2 === 0;
  const winner = even ? m.a : m.b;
  // Randomness already decided; the wheel only animates the known result.
  await wheel.spin(even, TURBO ? 0.9 : 4.2);
  await sleep(TURBO ? 250 : 900);
  wheel.hide();
  const box = $("sdBox");
  box.hidden = false;
  box.innerHTML = `<div class="sd-grid"><div><strong>Sudden death</strong> · ${S.entropy.label}
    <dl class="kv">
      <dt>Sequence #</dt><dd>${draw.seq}</dd>
      <dt>Provider commitment</dt><dd>${short(draw.prevCommit)}</dd>
      <dt>Provider reveal</dt><dd>${short(draw.providerReveal)} ${draw.verified ? "✓ hashes to commitment" : "✗"}</dd>
      <dt>Your random</dt><dd>${short(draw.userRandom)}</dd>
      <dt>Result</dt><dd>${short(draw.random)} → ${even ? "even" : "odd"} → <strong>${winner}</strong></dd>
    </dl></div><div class="coin stop">${winner}</div></div>`;
  await sleep(TURBO ? 400 : 1600);
  return { ...draw, winner, rule: "even → " + m.a + ", odd → " + m.b };
}

/* -------------------------------------------------------------- */
/* replay                                                          */
/* -------------------------------------------------------------- */
let replayChart;
function openReplay(m, auto) {
  const dlg = $("replay");
  const r = m.result;
  const loser = m.winner === m.a ? m.b : m.a;
  $("replayTitle").textContent = `${m.winner} def. ${loser}`;
  const how = r.suddenDeath
    ? `Regulation gap ${r.regulation.gap.toFixed(4)}% and overtime gap ${r.final.gap.toFixed(4)}% were both inside the confidence shield (${r.final.band.toFixed(4)}%). <strong>Sudden death</strong>: Entropy #${r.suddenDeath.seq} returned ${short(r.suddenDeath.random)} (${r.suddenDeath.rule}).`
    : r.overtime
    ? `Regulation gap ${r.regulation.gap.toFixed(4)}% was inside the shield (${r.regulation.band.toFixed(4)}%), so the referee called <strong>overtime</strong>. After overtime the gap was ${r.final.gap.toFixed(4)}% vs a ${r.final.band.toFixed(4)}% shield: clean win.`
    : `Gap ${r.final.gap.toFixed(4)}% beat the combined confidence shield of ${r.final.band.toFixed(4)}%: <strong>clean win</strong> in regulation.`;
  const row = (sym, s, e, d, u, via) => `<tr><td>${tok(sym)} <strong>${sym}</strong><br><span class="muted">${via || ""}</span></td>
      <td class="mono">$${fmtPrice(s.price)}<br><span class="muted">± ${fmtPrice(s.conf)}</span></td>
      <td class="mono">$${fmtPrice(e.price)}<br><span class="muted">± ${fmtPrice(e.conf)}</span></td>
      <td class="mono">${fmtPct(d, 4)}</td><td class="mono">±${u.toFixed(4)}%</td>
      <td class="mono">${new Date(s.publishTime * 1000).toISOString().slice(11, 19)} → ${new Date(e.publishTime * 1000).toISOString().slice(11, 19)}</td></tr>`;
  $("replayBody").innerHTML = `
    <p><span class="src-pill ${r.simulated ? "sim" : "live"}">${r.simulated ? "SIMULATED" : "REAL PYTH DATA"}</span> <span class="muted">${r.source}</span></p>
    <div class="verdict">${how}</div>
    <div style="overflow-x:auto"><table class="rtable">
      <thead><tr><th>Asset</th><th>Start price ± conf</th><th>End price ± conf</th><th>Change</th><th>Uncertainty</th><th>Publish times (UTC)</th></tr></thead>
      <tbody>${row(m.a, r.startA, r.endA, r.final.dA, r.final.uA, r.routeA)}${row(m.b, r.startB, r.endB, r.final.dB, r.final.uB, r.routeB)}</tbody>
    </table></div>
    ${r.notes?.length ? `<p class="help">Settlement: ${r.notes.map(escapeHtml).join(" ")}</p>` : ""}
    <p class="help">Rule: too close if |ΔA − ΔB| ≤ k·√(uA² + uB²), where u = √((conf/price)²start + (conf/price)²end). k = ${r.k}.</p>`;
  $("replayProof").innerHTML = "";
  $("replayVerify").hidden = !!r.simulated;
  $("replayVerify").textContent = r.sourceId === "hermes" ? "Verify with Pyth Benchmarks" : r.sourceId === "mixed" ? "Verify (Benchmarks + on-chain)" : "Show on-chain proof";
  $("replayVerify").onclick = () => verify(m);
  $("replayPlay").onclick = () => playReplay(r, m);
  if (!dlg.open) dlg.showModal();
  replayChart = replayChart || new RaceChart($("replayCanvas"));
  replayChart.resize();
  playReplay(r, m);

  return new Promise((resolve) => {
    let left = auto ? (TURBO ? 1 : 12) : 0;
    const next = $("replayNext");
    const isLast = !S.bracket.rounds[m.round + 1];
    const label = isLast ? "Crown the champion ⟶" : "Next match ⟶";
    next.textContent = label;
    const done = () => { clearInterval(timer); dlg.close(); resolve(); };
    next.onclick = done;
    $("replayClose").onclick = done;
    dlg.oncancel = (e) => { e.preventDefault(); done(); };
    let timer;
    if (auto) {
      timer = setInterval(() => {
        left -= TURBO ? 0.25 : 1;
        if (!TURBO) next.textContent = `${label} (${Math.max(0, Math.ceil(left))})`;
        if (left <= 0) done();
      }, TURBO ? 250 : 1000);
    }
  });
}
async function playReplay(r, m) {
  const total = r.ticks.length;
  const lastTickT = r.ticks.length ? r.ticks[r.ticks.length - 1].t : r.W;
  const opts = {
    duration: Math.max(r.tOT || r.W, lastTickT),
    buzzer: lastTickT > r.W ? r.W : 0,
    overtimeAt: r.otAt || 0,
    colorA: ASSETS[m.a].color, colorB: ASSETS[m.b].color, labelA: m.a, labelB: m.b,
  };
  const token = (playReplay.token = Symbol());
  const steps = Math.min(total, 60);
  S.rbars = S.rbars || new RaceBars($("replayBars"));
  S.rbars.start(m.a, m.b, ASSETS[m.a].color, ASSETS[m.b].color);
  Sfx.whoosh();
  for (let i = 1; i <= steps; i++) {
    if (playReplay.token !== token) return;
    const sl = r.ticks.slice(0, Math.ceil((i / steps) * total));
    replayChart.set(sl, opts);
    const tk = sl[sl.length - 1];
    if (tk) {
      const band = r.k * Math.sqrt(tk.uA ** 2 + tk.uB ** 2);
      const gap = Math.abs(tk.dA - tk.dB);
      S.rbars.update({ dA: tk.dA, dB: tk.dB, gap, band, leader: tk.dA >= tk.dB ? "a" : "b", tooClose: gap <= band });
    }
    await sleep(TURBO ? 5 : 25);
  }
  if (playReplay.token !== token) return;
  if (r.overtime) flash($("replayBars"), "ot-flash", 900);
  flash($("replayTitle"), "pop", 600);
  Sfx.ding();
}
async function verify(m) {
  const r = m.result;
  const out = $("replayProof");
  out.innerHTML = `<p class="muted">Fetching proofs…</p>`;
  const pts = [[m.a, "start", r.startA], [m.a, "end", r.endA], [m.b, "start", r.startB], [m.b, "end", r.endB]];
  const rows = [];
  for (const [sym, when, s] of pts) {
    try {
      const p = await S.source.proof(sym, s.publishTime);
      if (p.kind === "benchmarks") {
        const match = p.price != null && Math.abs(p.price - s.price) <= Math.max(s.conf, Math.abs(s.price) * 1e-9);
        rows.push(`<div class="proof-row"><strong>${sym} ${when}</strong> · ${p.source}: $${fmtPrice(p.price)} ± ${fmtPrice(p.conf)} @ ${p.publishTime}
          ${match ? "✓ matches the race" : "≈ nearest signed update"}<br><span class="muted">Signed update: ${p.signedUpdateBytes} bytes, sha256 ${short(p.signedUpdateHash)} (can be submitted to the Pyth contract with updatePriceFeeds)</span></div>`);
      } else if (p.kind === "solana") {
        rows.push(`<div class="proof-row"><strong>${sym} ${when}</strong> · ${p.source} <a href="${p.explorer}" target="_blank" rel="noopener">${p.account.slice(0, 8)}…</a> · publish_time ${p.publishTime}<br><span class="muted">${p.note}</span></div>`);
      } else rows.push(`<div class="proof-row">${p.note}</div>`);
    } catch (e) {
      rows.push(`<div class="proof-row"><strong>${sym} ${when}</strong>: ${e.message}</div>`);
    }
  }
  out.innerHTML = rows.join("");
}
function renderVault() {
  $("vault").innerHTML = S.replays
    .map((m, i) => `<li><button type="button" data-i="${i}">${m.result.suddenDeath ? "⚡ " : m.result.overtime ? "⏱ " : ""}<strong>${m.winner}</strong> def. ${m.winner === m.a ? m.b : m.a} <span class="muted">· ${ROUND_NAMES[S.bracket.size][m.round]}</span></button></li>`)
    .join("");
  $("vault").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => openReplay(S.replays[+b.dataset.i], false)));
}

/* -------------------------------------------------------------- */
/* side panels                                                     */
/* -------------------------------------------------------------- */
function logEntropy(d) {
  const li = document.createElement("li");
  li.innerHTML = `<b>#${d.seq}</b> ${d.purpose}<br>random ${short(d.random)} ${d.verified ? "✓" : "✗"}`;
  li.title = `commitment ${d.prevCommit}\nreveal ${d.providerReveal}\nuser ${d.userRandom}\nrandom ${d.random}`;
  $("entLog").prepend(li);
}
function renderMyPick() {
  if (!S.locked) {
    $("myPick").innerHTML = `<span class="muted">Watching without a bracket.</span>`;
    return;
  }
  const sc = scorePicks(S.bracket, S.picks);
  const champ = S.picks[S.picks.length - 1]?.[0];
  $("myPick").innerHTML = `<div><strong>${S.name}</strong></div><div class="big">${sc.score} pts</div>
    <div class="muted">${sc.correct} / ${sc.decided} correct · max possible ${sc.possible + 0}</div>
    <div>Champion pick: ${champ ? tok(champ) + " <strong>" + champ + "</strong>" : "—"}</div>`;
  $("scoreBadge").textContent = `PICK'EM ${sc.score} PTS`;
}
function loadLB() {
  try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch { return []; }
}
function renderLeaderboard() {
  const lb = loadLB();
  $("leaderboard").innerHTML = lb.length
    ? lb.slice(0, 10).map((e) => `<li>${escapeHtml(e.name)} <small class="muted">${escapeHtml(e.bracket)}${e.simulated ? " · sim" : ""}</small><span>${e.score}</span></li>`).join("")
    : `<li class="muted">No finished brackets yet.</li>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function updatePrize() {
  const usd = S.cfg?.prize ?? 100;
  const el = $("prize");
  if (!usd) { el.textContent = "No prize set."; return; }
  el.innerHTML = `<div class="big">$${usd.toLocaleString()}</div><small>Fetching Pyth DOGE/USD…</small>`;
  let p = null;
  try {
    if (S.avail.hermes) {
      const r = await fetch(`${PROXY}?route=latest&ids[]=${ASSETS.DOGE.feed.slice(2)}`).then((x) => x.json());
      const q = r.parsed[0].price;
      p = { price: q.price * 10 ** q.expo, conf: q.conf * 10 ** q.expo, publishTime: q.publish_time, source: "Pyth Hermes" };
    } else {
      p = await readEvmPythPrice(ASSETS.DOGE.feed);
    }
  } catch (e) {
    console.warn("DOGE price unavailable", e.message);
  }
  if (!p) {
    el.innerHTML = `<div class="big">$${usd.toLocaleString()}</div><small>DOGE/USD unavailable right now.</small>`;
    return;
  }
  const doge = usd / p.price;
  const lo = usd / (p.price + p.conf), hi = usd / (p.price - p.conf);
  const age = Date.now() / 1000 - p.publishTime;
  el.innerHTML = `<div class="big">≈ ${Math.round(doge).toLocaleString()} DOGE</div>
    <small>$${usd.toLocaleString()} at Pyth DOGE/USD $${fmtPrice(p.price)} ± ${fmtPrice(p.conf)} (range ${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()} DOGE)</small>
    <small>Real price · ${p.source} · published ${timeAgo(age)}${age > 900 ? " (stale: refresh before paying out)" : ""}</small>`;
}

/* -------------------------------------------------------------- */
/* champion                                                        */
/* -------------------------------------------------------------- */
async function crownChampion() {
  setState("done");
  const fin = S.bracket.rounds[S.bracket.rounds.length - 1][0];
  const champ = fin.winner;
  setPhase("final", "CHAMPION");
  banner(champ, "Oracle Madness champion", "champ", 2600);
  jackpot(champ, "Oracle Madness champion · refereed by Pyth");
  const sc = S.locked ? scorePicks(S.bracket, S.picks) : null;
  if (S.locked) {
    const lb = loadLB();
    lb.push({ name: S.name, score: sc.score, bracket: S.def.title, champion: champ, pick: S.picks[S.picks.length - 1][0], at: new Date().toISOString(), simulated: S.source.simulated });
    lb.sort((a, b) => b.score - a.score);
    localStorage.setItem(LB_KEY, JSON.stringify(lb.slice(0, 50)));
    renderLeaderboard();
  }
  const path = S.bracket.rounds.map((ms) => ms.find((m) => m.winner === champ && (m.a === champ || m.b === champ))).filter(Boolean);
  const box = $("champBox");
  box.hidden = false;
  box.innerHTML = `${tok(champ, "lg")}<h3>${champ} WINS IT ALL</h3>
    <p>${path.map((m) => `def. <strong>${m.a === champ ? m.b : m.a}</strong>${m.result.suddenDeath ? " (SD)" : m.result.overtime ? " (OT)" : ""}`).join(" → ")}</p>
    ${sc ? `<p><strong>${escapeHtml(S.name)}</strong> scored <strong>${sc.score}</strong> pick'em points (${sc.correct}/${sc.decided} correct).</p>` : ""}
    <p class="muted">Data: ${S.source.label}</p>
    <div class="cta-row" style="justify-content:center"><button type="button" class="btn btn-primary" id="againBtn">Run it back</button></div>`;
  $("againBtn").onclick = () => location.reload();
  updatePrize();
  S.source.stop();
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("confetti");
  const cols = ["#ffc400", "#8b5cf6", "#22e584", "#ff4d6d", "#e6dafe"];
  for (let i = 0; i < 120; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = cols[i % cols.length];
    p.style.animationDuration = 2 + Math.random() * 2.5 + "s";
    p.style.animationDelay = Math.random() * 0.8 + "s";
    c.appendChild(p);
  }
  setTimeout(() => (c.innerHTML = ""), 6000);
}
function setBadge() {
  const b = $("dataBadge");
  b.textContent = S.source.simulated ? "⚠ SIMULATED DATA" : S.source.short;
  b.className = "badge " + (S.source.simulated ? "badge-sim" : "badge-live");
  let per = "";
  if (S.source.routes) {
    const h = Object.keys(S.source.routes).filter((k) => S.source.routes[k] === "hermes");
    const so = Object.keys(S.source.routes).filter((k) => S.source.routes[k] === "solana");
    per = [h.length ? `Hermes: ${h.join(", ")}` : "", so.length ? `Solana on-chain: ${so.join(", ")}` : ""].filter(Boolean).join(" · ");
  }
  b.title = S.source.label + (per ? "\n" + per : "");
  $("srcLine").textContent = "Data: " + S.source.label + (per ? " — " + per : "");
  $("entBadge").textContent = S.entropy.short;
  $("entBadge").title = S.entropy.label;
}

/* -------------------------------------------------------------- */
/* wire-up                                                         */
/* -------------------------------------------------------------- */
function init() {
  initCasino();
  renderChoices();
  $("kInput").addEventListener("input", () => ($("kOut").textContent = (+$("kInput").value).toFixed(1) + "×"));
  $("srcSelect").addEventListener("change", refreshSetup);
  $("setupForm").addEventListener("submit", (e) => { e.preventDefault(); startSeeding(); });
  $("turboBtn").addEventListener("click", () => {
    const u = new URL(location.href);
    u.searchParams.set("demo", "turbo");
    u.searchParams.set("bracket", S.bracketId);
    location.href = u.toString();
  });
  $("chalkBtn").addEventListener("click", () => autoFill("chalk"));
  $("randBtn").addEventListener("click", () => autoFill("random"));
  $("clearBtn").addEventListener("click", () => { S.picks = S.bracket.rounds.map(() => []); renderBracket(); });
  $("lockBtn").addEventListener("click", lockPicks);
  $("watchBtn").addEventListener("click", () => { S.locked = false; beginTournament(); });

  for (const [k, id] of [["window", "winInput"], ["ot", "otInput"], ["k", "kInput"], ["prize", "prizeInput"], ["src", "srcSelect"]])
    if (params.has(k)) $(id).value = params.get(k);
  $("kOut").textContent = (+$("kInput").value).toFixed(1) + "×";
  if (TURBO) {
    $("srcSelect").value = "demo";
    if (!params.has("window")) $("winInput").value = 3;
    if (!params.has("ot")) $("otInput").value = 2;
  }
  refreshSetup();
  detectSources().then(() => { if (TURBO || params.get("autostart") === "1") startSeeding(); });
}
init();
