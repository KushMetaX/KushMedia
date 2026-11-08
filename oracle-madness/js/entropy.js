// SPDX-License-Identifier: Apache-2.0
// Pluggable randomness. Interface:
//   label, onchain (bool)
//   async init()
//   async request(purpose) -> { seq, purpose, commitment, userRandom, providerReveal,
//                               prevCommit, verified, random (hex), explorer? }
//
// SimulatedEntropy mirrors Pyth Entropy's commit-reveal design in the browser:
//   - The "provider" pre-generates a hash chain x_n -> ... -> x_0 and publishes x_0
//     (the commitment) BEFORE any draw.
//   - Each request i gets a fresh user random number; the provider then reveals x_i.
//   - Anyone can check SHA256(x_i) == x_(i-1), so the provider could not pick x_i
//     after seeing the user's number.
//   - random = SHA256(userRandom || x_i)
// It is NOT on-chain and NOT Pyth Entropy itself: it is clearly labelled as simulated.
// contracts/OracleMadnessEntropy.sol is the real Entropy v2 integration (testnet next).

const enc = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
async function sha(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
function cat(a, b) {
  const o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}

export class SimulatedEntropy {
  constructor(chainLength = 128) {
    this.label = "Simulated Entropy (testnet integration next)";
    this.short = "SIM ENTROPY";
    this.onchain = false;
    this.chainLength = chainLength;
  }
  async init() {
    let x = rand32();
    const chain = [x];
    for (let i = 0; i < this.chainLength; i++) {
      x = await sha(x);
      chain.push(x);
    }
    chain.reverse(); // chain[0] is the public commitment
    this.chain = chain;
    this.seq = 0;
    this.commitment = enc(chain[0]);
    return this.commitment;
  }
  async request(purpose) {
    if (!this.chain) await this.init();
    const seq = ++this.seq;
    if (seq >= this.chain.length) throw new Error("hash chain exhausted");
    const userRandom = rand32();
    const providerReveal = this.chain[seq];
    const prev = this.chain[seq - 1];
    const verified = enc(await sha(providerReveal)) === enc(prev);
    const random = enc(await sha(cat(userRandom, providerReveal)));
    return {
      seq,
      purpose,
      commitment: this.commitment,
      userRandom: enc(userRandom),
      providerReveal: enc(providerReveal),
      prevCommit: enc(prev),
      verified,
      random,
      at: Date.now(),
    };
  }
}

// Placeholder for the real thing: a wallet calls OracleMadnessEntropy.request*() on
// Base Sepolia and the UI waits for the callback event. Not wired up in v1.
export class OnchainEntropy {
  constructor({ contract, chain = "base-sepolia" } = {}) {
    this.label = "Pyth Entropy v2 (" + chain + ")";
    this.short = "PYTH ENTROPY";
    this.onchain = true;
    this.contract = contract;
  }
  async init() {
    throw new Error("On-chain Entropy is not wired up yet. See contracts/README.md.");
  }
  async request() {
    throw new Error("On-chain Entropy is not wired up yet. See contracts/README.md.");
  }
}

// Deterministic helpers that turn one random value into many.
export async function derive(randomHex, i) {
  const bytes = new TextEncoder().encode(randomHex + ":" + i);
  const h = await sha(bytes);
  return new DataView(h.buffer).getUint32(0);
}
export async function shuffle(arr, randomHex) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (await derive(randomHex, i)) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
