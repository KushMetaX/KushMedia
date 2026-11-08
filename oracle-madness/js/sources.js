// SPDX-License-Identifier: Apache-2.0
// Pluggable price sources. Every source exposes the same shape:
//   id, label, short, live (bool), simulated (bool)
//   async init(symbols)   start polling / generating
//   latest(sym)           -> { price, conf, publishTime, recvMs } | null
//   stop()
//   async proof(sym, publishTime) -> proof object for the replay card (optional)
//   cadence(sym)          -> typical seconds between price updates (1 = Hermes, ~60 = Solana push)
//   async priceAt(sym, ts) -> price sample at (or just before) unix time ts, or null
import { ASSETS } from "./assets.js?v=20261022";

const strip0x = (h) => h.replace(/^0x/, "").toLowerCase();

// fetch() that gives up after `ms` (so a slow endpoint can't stall the setup screen)
export async function fetchT(url, opts = {}, ms = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
const COV_KEY = "oracleMadness.hermesCoverage.v1";

/* ------------------------------------------------------------------ */
/* 1. Pyth Hermes via proxy.php (needs a Pyth API key on the server)   */
/* ------------------------------------------------------------------ */
export class HermesProxySource {
  constructor(proxyUrl = "proxy.php", pollMs = 1000) {
    this.id = "hermes";
    this.proxyUrl = proxyUrl;
    this.pollMs = pollMs;
    this.label = "LIVE · Pyth Hermes (keyed, via proxy.php)";
    this.short = "LIVE · HERMES";
    this.live = true;
    this.simulated = false;
    this.cache = {};
    this.buffer = {};
    this.errors = 0;
  }
  cadence() {
    return 1;
  }
  // Price at unix time ts: from the local buffer if we polled around then,
  // otherwise the signed Benchmarks update for that exact second.
  async priceAt(sym, ts) {
    const buf = this.buffer[sym] || [];
    let best = null;
    for (const b of buf) if (b.publishTime <= ts) best = b;
    if (best && ts - best.publishTime <= 2) return { ...best, via: "Hermes (polled)" };
    try {
      const p = await this.proof(sym, ts);
      if (p.price != null) return { price: p.price, conf: p.conf, publishTime: p.publishTime, via: "Pyth Benchmarks" };
    } catch {}
    return best ? { ...best, via: "Hermes (nearest polled)" } : null;
  }
  static async available(proxyUrl = "proxy.php") {
    try {
      const r = await fetchT(`${proxyUrl}?route=health`, { cache: "no-store" }, 4000);
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j.ok && j.keyConfigured);
    } catch {
      return false;
    }
  }
  // Which symbols the proxy's key can actually read (a key may not cover every feed).
  // The proxy answers { parsed: [...], denied: [ids] }. Denied ids cost the proxy an extra
  // upstream round-trip each, so: small batches in parallel, a timeout, and a 30-minute
  // localStorage cache (re-checked in the background on the next load).
  static cachedCoverage() {
    try {
      const c = JSON.parse(localStorage.getItem(COV_KEY));
      if (c && Date.now() - c.at < 30 * 60 * 1000) return new Set(c.ok);
    } catch {}
    return null;
  }
  static async coverage(symbols, proxyUrl = "proxy.php", { batch = 5, timeoutMs = 7000 } = {}) {
    const ok = new Set();
    const groups = [];
    for (let i = 0; i < symbols.length; i += batch) groups.push(symbols.slice(i, i + batch));
    let answered = 0;
    const failed = [];
    const ask = async (g, ms) => {
      const byId = {};
      g.forEach((s) => (byId[strip0x(ASSETS[s].feed)] = s));
      const qs = Object.keys(byId).map((id) => "ids[]=" + id).join("&");
      try {
        const r = await fetchT(`${proxyUrl}?route=latest&${qs}`, { cache: "no-store" }, ms);
        if (!r.ok) return false;
        const j = await r.json();
        for (const p of j.parsed || []) if (byId[strip0x(p.id)]) ok.add(byId[strip0x(p.id)]);
        answered++;
        return true;
      } catch {
        return false;
      }
    };
    await Promise.all(groups.map(async (g) => { if (!(await ask(g, timeoutMs))) failed.push(g); }));
    // one slower retry for batches that timed out or errored (e.g. a busy shared host)
    for (const g of failed) await ask(g, 10000);
    if (answered === groups.length) {
      try { localStorage.setItem(COV_KEY, JSON.stringify({ at: Date.now(), ok: [...ok] })); } catch {}
    }
    return ok;
  }
  async init(symbols) {
    this.symbols = symbols;
    this.byId = {};
    symbols.forEach((s) => (this.byId[strip0x(ASSETS[s].feed)] = s));
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }
  async poll() {
    const qs = this.symbols.map((s) => "ids[]=" + strip0x(ASSETS[s].feed)).join("&");
    try {
      const r = await fetchT(`${this.proxyUrl}?route=latest&${qs}`, { cache: "no-store" }, 5000);
      if (!r.ok) throw new Error("proxy " + r.status);
      const j = await r.json();
      for (const p of j.parsed || []) {
        const sym = this.byId[strip0x(p.id)];
        if (!sym) continue;
        const e = Number(p.price.expo);
        const smp = {
          price: Number(p.price.price) * 10 ** e,
          conf: Number(p.price.conf) * 10 ** e,
          publishTime: Number(p.price.publish_time),
          recvMs: Date.now(),
        };
        this.cache[sym] = smp;
        // rolling 10-minute buffer so a match can be settled at any recent publish time
        const buf = (this.buffer[sym] = this.buffer[sym] || []);
        if (!buf.length || buf[buf.length - 1].publishTime !== smp.publishTime) buf.push(smp);
        while (buf.length && buf[0].publishTime < smp.publishTime - 600) buf.shift();
      }
      this.errors = 0;
    } catch (err) {
      this.errors++;
      if (this.errors === 3) console.warn("Hermes proxy polling failing:", err.message);
    }
  }
  latest(sym) {
    return this.cache[sym] || null;
  }
  stop() {
    clearInterval(this.timer);
  }
  // Signed historical update from Pyth Benchmarks for an exact publish time.
  async proof(sym, publishTime) {
    const id = strip0x(ASSETS[sym].feed);
    const r = await fetchT(`${this.proxyUrl}?route=history&ts=${Math.floor(publishTime)}&ids[]=${id}`, {}, 8000);
    if (!r.ok) throw new Error("Benchmarks via proxy failed: HTTP " + r.status);
    const j = await r.json();
    const p = (j.parsed || [])[0];
    const bin = (j.binary && j.binary.data && j.binary.data[0]) || "";
    const e = p ? Number(p.price.expo) : 0;
    return {
      kind: "benchmarks",
      source: j._source || "benchmarks.pyth.network",
      price: p ? Number(p.price.price) * 10 ** e : null,
      conf: p ? Number(p.price.conf) * 10 ** e : null,
      publishTime: p ? Number(p.price.publish_time) : null,
      signedUpdateBytes: bin.length / 2,
      signedUpdateHash: bin ? await sha256Hex(hexToBytes(bin)) : null,
    };
  }
}

const qsRpc = new URLSearchParams(location.search).get("solrpc");
// api.mainnet-beta.solana.com is NOT listed: it answers 403 to every browser Origin,
// so as a fallback it only produced console errors. A failed poll just keeps the last
// on-chain value and retries on the next tick.
export const SOLANA_RPCS = [
  ...(qsRpc ? [qsRpc] : []),
  "https://solana-rpc.publicnode.com",
];

/* ------------------------------------------------------------------ */
/* 2. Keyless live: Pyth push-oracle accounts on Solana mainnet        */
/*    (PriceUpdateV2 accounts kept fresh by Pyth's sponsored feeds)    */
/* ------------------------------------------------------------------ */
export class SolanaOnchainSource {
  // api.mainnet-beta.solana.com rejects browser Origins (HTTP 403), so the default is
  // PublicNode's free CORS-enabled endpoint (override with ?solrpc=).
  constructor(rpcs = SOLANA_RPCS, pollMs = 2000) {
    this.id = "solana";
    this.rpcs = Array.isArray(rpcs) ? rpcs : [rpcs];
    this.rpcIx = 0;
    this.pollMs = pollMs;
    this.label = "LIVE · Pyth on-chain (Solana push feeds, keyless)";
    this.short = "LIVE · ON-CHAIN";
    this.live = true;
    this.simulated = false;
    this.cache = {};
  }
  get rpc() {
    return this.rpcs[this.rpcIx % this.rpcs.length];
  }
  async fetchAccounts(symbols, tries = this.rpcs.length) {
    try {
      return await this.fetchAccountsOnce(symbols);
    } catch (err) {
      this.rpcIx++;
      if (tries > 1) return this.fetchAccounts(symbols, tries - 1);
      throw err;
    }
  }
  // Free RPCs cap getMultipleAccounts size (PublicNode rejects >10), so batch by 8.
  async fetchAccountsOnce(symbols) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 8) Object.assign(out, await this.fetchBatch(symbols.slice(i, i + 8)));
    return out;
  }
  async fetchBatch(symbols) {
    const r = await fetchT(this.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getMultipleAccounts",
        params: [symbols.map((s) => ASSETS[s].sol), { encoding: "base64", commitment: "confirmed" }],
      }),
    }, 5000);
    if (!r.ok) throw new Error("Solana RPC HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    const out = {};
    j.result.value.forEach((acc, i) => {
      if (acc) out[symbols[i]] = parsePriceUpdateV2(acc.data[0]);
    });
    return out;
  }
  // Returns { sym: ageSeconds | Infinity } so the UI can tell which feeds are fresh.
  async freshness(symbols) {
    const now = Date.now() / 1000;
    const data = await this.fetchAccounts(symbols);
    const ages = {};
    symbols.forEach((s) => (ages[s] = data[s] ? now - data[s].publishTime : Infinity));
    return ages;
  }
  cadence() {
    return 60; // Pyth's sponsored Solana push feeds: heartbeat ~60 s (or on a big move)
  }
  // Only the current on-chain value exists; return it if it was published at/before ts.
  async priceAt(sym, ts) {
    const h = (this.history[sym] || []).filter((x) => x.publishTime <= ts);
    return h.length ? { ...h[h.length - 1], via: "Solana on-chain" } : null;
  }
  async init(symbols) {
    this.symbols = symbols;
    this.history = {};
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }
  async poll() {
    try {
      const d = await this.fetchAccounts(this.symbols);
      for (const [s, v] of Object.entries(d)) {
        const h = (this.history[s] = this.history[s] || []);
        if (!h.length || h[h.length - 1].publishTime !== v.publishTime) h.push({ ...v, recvMs: Date.now() });
        if (h.length > 40) h.shift();
      }
      for (const [s, v] of Object.entries(d)) {
        const prev = this.cache[s];
        if (!prev || prev.publishTime !== v.publishTime) this.cache[s] = { ...v, recvMs: Date.now() };
      }
    } catch (err) {
      console.warn("Solana RPC poll failed:", err.message);
    }
  }
  latest(sym) {
    return this.cache[sym] || null;
  }
  stop() {
    clearInterval(this.timer);
  }
  async proof(sym, publishTime) {
    return {
      kind: "solana",
      source: "Pyth Solana Receiver (push oracle) account",
      account: ASSETS[sym].sol,
      explorer: `https://solscan.io/account/${ASSETS[sym].sol}`,
      publishTime,
      note: "Price, conf and publish_time were read from this on-chain account, which only Pyth-verified updates can write. (A signed Benchmarks proof needs a Pyth key entitled to this feed.)",
    };
  }
}

// Layout: 8 discriminator, 32 write_authority, verification_level (1 byte Full, or 2 bytes Partial),
// then PriceFeedMessage: feed_id[32] price i64 conf u64 exponent i32 publish_time i64 ...
export function parsePriceUpdateV2(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dv = new DataView(bytes.buffer);
  let o = 8 + 32;
  o += bytes[o] === 0 ? 2 : 1;
  o += 32;
  const price = Number(dv.getBigInt64(o, true)); o += 8;
  const conf = Number(dv.getBigUint64(o, true)); o += 8;
  const expo = dv.getInt32(o, true); o += 4;
  const publishTime = Number(dv.getBigInt64(o, true));
  return { price: price * 10 ** expo, conf: conf * 10 ** expo, publishTime };
}

/* ------------------------------------------------------------------ */
/* 3. SIMULATED demo data. Never presented as live.                    */
/* ------------------------------------------------------------------ */
export class DemoSource {
  constructor({ tickMs = 250, windowSec = 30 } = {}) {
    this.id = "demo";
    this.label = "SIMULATED DATA · demo mode (not real prices)";
    this.short = "SIMULATED";
    this.live = false;
    this.simulated = true;
    this.tickMs = tickMs;
    this.windowSec = windowSec;
    this.cache = {};
  }
  async init(symbols) {
    this.symbols = symbols;
    // Target: each asset's % move over one match window has sd ~0.06% (memes a bit more).
    // Tuned so that at referee sensitivity 1.0 roughly 1 in 4 matches goes to overtime
    // and ~1 in 12 to sudden death.
    const steps = Math.max(4, (this.windowSec * 1000) / this.tickMs);
    this.state = {};
    for (const s of symbols) {
      const a = ASSETS[s];
      const volMult = a.kind === "meme" ? 1.25 : 0.75;
      this.state[s] = {
        price: a.demoPrice * (1 + (Math.random() - 0.5) * 0.01),
        stepSd: (0.0006 * volMult) / Math.sqrt(steps),
        confRatio: (a.kind === "meme" ? 0.0004 : 0.00025) * (0.7 + Math.random() * 0.6),
        drift: 0,
      };
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }
  tick() {
    const now = Date.now();
    for (const s of this.symbols) {
      const st = this.state[s];
      // light momentum so races have "runs"
      st.drift = st.drift * 0.85 + gauss() * st.stepSd * 0.35;
      st.price *= 1 + gauss() * st.stepSd + st.drift;
      const conf = st.price * st.confRatio * (0.8 + Math.random() * 0.4);
      this.cache[s] = { price: st.price, conf, publishTime: now / 1000, recvMs: now };
    }
  }
  latest(sym) {
    return this.cache[sym] || null;
  }
  cadence() {
    return 0.25;
  }
  async priceAt(sym) {
    return this.cache[sym] || null;
  }
  stop() {
    clearInterval(this.timer);
  }
  async proof() {
    return { kind: "simulated", source: "Simulated demo data", note: "No proof: these prices were generated in your browser. Run with a Pyth API key (proxy.php) to get signed Benchmarks proofs." };
  }
}

/* ------------------------------------------------------------------ */
/* 4. MIXED live: per-asset routing. Hermes where the key is entitled, */
/*    otherwise Pyth's Solana push feed. Both are real Pyth data.      */
/* ------------------------------------------------------------------ */
export class MixedSource {
  // routes: { SYM: "hermes" | "solana" }
  constructor(routes, proxyUrl = "proxy.php") {
    this.routes = routes;
    this.hermes = new HermesProxySource(proxyUrl);
    this.solana = new SolanaOnchainSource();
    const used = new Set(Object.values(routes));
    this.live = true;
    this.simulated = false;
    if (used.size > 1) {
      this.id = "mixed";
      this.short = "LIVE · MIXED";
      this.label = "LIVE · MIXED: Pyth Hermes (keyed) + Pyth Solana push feeds";
    } else if (used.has("hermes")) {
      this.id = "hermes";
      this.short = this.hermes.short;
      this.label = this.hermes.label;
    } else {
      this.id = "solana";
      this.short = this.solana.short;
      this.label = this.solana.label;
    }
  }
  src(sym) {
    return this.routes[sym] === "hermes" ? this.hermes : this.solana;
  }
  routeLabel(sym) {
    return this.routes[sym] === "hermes" ? "Hermes · ~1 s updates" : "Solana on-chain · ~60 s updates";
  }
  async init(symbols) {
    const h = symbols.filter((s) => this.routes[s] === "hermes");
    const so = symbols.filter((s) => this.routes[s] === "solana");
    await Promise.all([h.length ? this.hermes.init(h) : null, so.length ? this.solana.init(so) : null]);
  }
  latest(sym) {
    return this.src(sym).latest(sym);
  }
  cadence(sym) {
    return this.src(sym).cadence(sym);
  }
  priceAt(sym, ts) {
    return this.src(sym).priceAt(sym, ts);
  }
  proof(sym, ts) {
    return this.src(sym).proof(sym, ts);
  }
  stop() {
    this.hermes.stop();
    this.solana.stop();
  }
}

/* ------------------------------------------------------------------ */
/* Keyless DOGE/USD for the prize panel: read Pyth on Arbitrum.        */
/* ------------------------------------------------------------------ */
const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const ARB_PYTH = "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C";
export async function readEvmPythPrice(feedId) {
  const r = await fetchT(ARB_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      // getPriceUnsafe(bytes32) selector 0x96834ad3
      params: [{ to: ARB_PYTH, data: "0x96834ad3" + strip0x(feedId) }, "latest"],
    }),
  }, 5000);
  const j = await r.json();
  if (!j.result || j.result.length < 258) throw new Error("no on-chain price");
  const h = j.result.slice(2);
  const word = (i) => BigInt.asIntN(256, BigInt("0x" + h.slice(i * 64, i * 64 + 64)));
  const expo = Number(word(2));
  return {
    price: Number(word(0)) * 10 ** expo,
    conf: Number(word(1)) * 10 ** expo,
    publishTime: Number(word(3)),
    source: "Pyth on Arbitrum (getPriceUnsafe)",
  };
}

/* helpers */
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function hexToBytes(hex) {
  const h = strip0x(hex);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
