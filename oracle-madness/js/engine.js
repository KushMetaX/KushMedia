// SPDX-License-Identifier: Apache-2.0
// Pure game logic: bracket structure, referee rules, pick'em scoring.
import { SEED_ORDER, ROUND_POINTS } from "./assets.js?v=20261022";

// Build an empty bracket from a seeded list (index 0 = seed 1).
export function buildBracket(seeded) {
  const n = seeded.length;
  const order = SEED_ORDER[n];
  const rounds = [];
  const first = [];
  for (let i = 0; i < order.length; i += 2) {
    first.push(match(0, i / 2, seeded[order[i] - 1], seeded[order[i + 1] - 1], order[i], order[i + 1]));
  }
  rounds.push(first);
  let size = first.length / 2;
  let r = 1;
  while (size >= 1) {
    const ms = [];
    for (let i = 0; i < size; i++) ms.push(match(r, i, null, null));
    rounds.push(ms);
    size /= 2;
    r++;
  }
  const seeds = {};
  seeded.forEach((s, i) => (seeds[s] = i + 1));
  return { size: n, rounds, seeds };
}
function match(round, idx, a, b, seedA, seedB) {
  return { round, idx, a, b, seedA, seedB, status: "pending", winner: null, result: null };
}

// Winner of rounds[r][i] goes to rounds[r+1][floor(i/2)], slot a if i even else b.
export function advance(bracket, m, winner) {
  m.winner = winner;
  m.status = "done";
  const next = bracket.rounds[m.round + 1];
  if (!next) return null;
  const nm = next[Math.floor(m.idx / 2)];
  if (m.idx % 2 === 0) {
    nm.a = winner;
    nm.seedA = bracket.seeds[winner];
  } else {
    nm.b = winner;
    nm.seedB = bracket.seeds[winner];
  }
  return nm;
}

export function allMatches(bracket) {
  return bracket.rounds.flat();
}

// --- Referee -----------------------------------------------------------
// % change of each asset from match start, with an uncertainty derived from
// Pyth's confidence intervals at start and end (normalised by price):
//   u = sqrt((conf_start/price_start)^2 + (conf_end/price_end)^2) * 100   [% points]
// The result is TOO CLOSE TO CALL when the gap between the two % changes is
// inside their combined uncertainty:  |dA - dB| <= k * sqrt(uA^2 + uB^2)
export function pctChange(start, cur) {
  return (cur.price / start.price - 1) * 100;
}
export function uncertainty(start, cur) {
  return Math.hypot(start.conf / start.price, cur.conf / cur.price) * 100;
}
export function judge(startA, endA, startB, endB, k = 1) {
  const dA = pctChange(startA, endA);
  const dB = pctChange(startB, endB);
  const uA = uncertainty(startA, endA);
  const uB = uncertainty(startB, endB);
  const gap = Math.abs(dA - dB);
  const band = k * Math.hypot(uA, uB);
  return {
    dA, dB, uA, uB, gap, band,
    tooClose: gap <= band,
    leader: dA === dB ? null : dA > dB ? "a" : "b",
  };
}

// --- Pick'em -----------------------------------------------------------
export function scorePicks(bracket, picks) {
  const pts = ROUND_POINTS[bracket.size];
  let score = 0, correct = 0, decided = 0, possible = 0;
  bracket.rounds.forEach((ms, r) =>
    ms.forEach((m, i) => {
      const p = picks?.[r]?.[i];
      if (m.status === "done") {
        decided++;
        if (p && p === m.winner) {
          score += pts[r];
          correct++;
          possible += pts[r];
        }
      } else if (p && !isEliminated(bracket, p, r)) {
        possible += pts[r];
      }
    })
  );
  return { score, correct, decided, possible };
}
function isEliminated(bracket, sym, beforeRound) {
  for (let r = 0; r < beforeRound + 1 && r < bracket.rounds.length; r++)
    for (const m of bracket.rounds[r])
      if (m.status === "done" && (m.a === sym || m.b === sym) && m.winner !== sym) return true;
  return false;
}

// Fill picks for downstream slots and clear picks that no longer make sense.
export function setPick(bracket, picks, r, i, sym) {
  picks[r] = picks[r] || [];
  picks[r][i] = sym;
  // clean downstream: any later pick that relied on a team no longer feeding that slot
  for (let rr = r + 1; rr < bracket.rounds.length; rr++) {
    picks[rr] = picks[rr] || [];
    bracket.rounds[rr].forEach((_, ii) => {
      const p = picks[rr][ii];
      if (!p) return;
      const feeders = [picks[rr - 1]?.[ii * 2], picks[rr - 1]?.[ii * 2 + 1]];
      if (!feeders.includes(p)) picks[rr][ii] = undefined;
    });
  }
  return picks;
}
// Who is in slot (r,i) according to the user's picks (round 0 = real seeds)
export function pickSlots(bracket, picks, r, i) {
  if (r === 0) return [bracket.rounds[0][i].a, bracket.rounds[0][i].b];
  return [picks[r - 1]?.[i * 2] || null, picks[r - 1]?.[i * 2 + 1] || null];
}
export function picksComplete(bracket, picks) {
  return bracket.rounds.every((ms, r) => ms.every((_, i) => !!picks?.[r]?.[i]));
}
