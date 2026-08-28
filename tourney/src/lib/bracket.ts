export type Side = "winners" | "losers" | "grand" | "group";

export interface MatchDraft {
  side: Side;
  round: number;
  position: number;
  entry1Id: number | null;
  entry2Id: number | null;
  winnerGoesTo?: { side: Side; round: number; position: number; slot: 1 | 2 };
  loserGoesTo?: { side: Side; round: number; position: number; slot: 1 | 2 };
  byeAdvanced?: boolean;
}

export function nextPowerOfTwo(n: number): number {
  if (n < 2) return 2;
  return 2 ** Math.ceil(Math.log2(n));
}

/** Standard bracket seed order for a power-of-two sized field. */
export function seedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const next: number[] = [];
    const sum = seeds.length * 2 + 1;
    for (const s of seeds) {
      next.push(s, sum - s);
    }
    seeds = next;
  }
  return seeds;
}

function slotKey(side: Side, round: number, position: number) {
  return `${side}:${round}:${position}`;
}

function wire(
  map: Map<string, MatchDraft>,
  from: MatchDraft,
  dest: { side: Side; round: number; position: number; slot: 1 | 2 },
  kind: "winner" | "loser",
) {
  if (kind === "winner") from.winnerGoesTo = dest;
  else from.loserGoesTo = dest;
  map.set(slotKey(from.side, from.round, from.position), from);
}

function ensure(
  map: Map<string, MatchDraft>,
  side: Side,
  round: number,
  position: number,
): MatchDraft {
  const k = slotKey(side, round, position);
  let m = map.get(k);
  if (!m) {
    m = { side, round, position, entry1Id: null, entry2Id: null };
    map.set(k, m);
  }
  return m;
}

function placePlayer(
  map: Map<string, MatchDraft>,
  dest: { side: Side; round: number; position: number; slot: 1 | 2 },
  entryId: number,
) {
  const m = ensure(map, dest.side, dest.round, dest.position);
  if (dest.slot === 1) m.entry1Id = entryId;
  else m.entry2Id = entryId;
}

/** Seeded single-elim tree. `seededIds` is ordered by seed (best first). */
export function generateSingleElim(seededIds: number[]): MatchDraft[] {
  const n = nextPowerOfTwo(seededIds.length);
  const wbRounds = Math.log2(n);
  const map = new Map<string, MatchDraft>();

  for (let r = 1; r <= wbRounds; r++) {
    const count = n / 2 ** r;
    for (let p = 1; p <= count; p++) {
      ensure(map, "winners", r, p);
    }
  }

  for (let r = 1; r < wbRounds; r++) {
    const count = n / 2 ** r;
    for (let p = 1; p <= count; p++) {
      const m = ensure(map, "winners", r, p);
      wire(map, m, {
        side: "winners",
        round: r + 1,
        position: Math.ceil(p / 2),
        slot: p % 2 === 1 ? 1 : 2,
      }, "winner");
    }
  }

  const order = seedOrder(n);
  const r1Count = n / 2;
  for (let p = 1; p <= r1Count; p++) {
    const m = ensure(map, "winners", 1, p);
    const s1 = order[(p - 1) * 2];
    const s2 = order[(p - 1) * 2 + 1];
    m.entry1Id = seededIds[s1 - 1] ?? null;
    m.entry2Id = seededIds[s2 - 1] ?? null;
  }

  resolveByes(map);
  return [...map.values()];
}

export function generateDoubleElim(seededIds: number[]): MatchDraft[] {
  const n = nextPowerOfTwo(seededIds.length);
  const wbRounds = Math.log2(n);
  const lbRounds = Math.max(1, 2 * (wbRounds - 1));
  const map = new Map<string, MatchDraft>();

  for (let r = 1; r <= wbRounds; r++) {
    const count = n / 2 ** r;
    for (let p = 1; p <= count; p++) ensure(map, "winners", r, p);
  }

  for (let r = 1; r <= lbRounds; r++) {
    const pairIndex = Math.ceil(r / 2);
    const count = Math.max(1, n / 2 ** (pairIndex + 1));
    for (let p = 1; p <= count; p++) ensure(map, "losers", r, p);
  }

  ensure(map, "grand", 1, 1);

  for (let r = 1; r < wbRounds; r++) {
    const count = n / 2 ** r;
    for (let p = 1; p <= count; p++) {
      const m = ensure(map, "winners", r, p);
      wire(map, m, {
        side: "winners",
        round: r + 1,
        position: Math.ceil(p / 2),
        slot: p % 2 === 1 ? 1 : 2,
      }, "winner");
    }
  }

  const wf = ensure(map, "winners", wbRounds, 1);
  wire(map, wf, { side: "grand", round: 1, position: 1, slot: 1 }, "winner");
  if (lbRounds >= 1) {
    const lf = ensure(map, "losers", lbRounds, 1);
    wire(map, lf, { side: "grand", round: 1, position: 1, slot: 2 }, "winner");
  }

  for (let r = 1; r < lbRounds; r++) {
    const pairIndex = Math.ceil(r / 2);
    const count = Math.max(1, n / 2 ** (pairIndex + 1));
    for (let p = 1; p <= count; p++) {
      const m = ensure(map, "losers", r, p);
      if (r % 2 === 1) {
        wire(map, m, { side: "losers", round: r + 1, position: p, slot: 1 }, "winner");
      } else {
        wire(map, m, {
          side: "losers",
          round: r + 1,
          position: Math.ceil(p / 2),
          slot: p % 2 === 1 ? 1 : 2,
        }, "winner");
      }
    }
  }

  const r1Count = n / 2;
  for (let p = 1; p <= r1Count; p++) {
    const m = ensure(map, "winners", 1, p);
    m.loserGoesTo = {
      side: "losers",
      round: 1,
      position: Math.ceil(p / 2),
      slot: p % 2 === 1 ? 1 : 2,
    };
  }

  for (let r = 2; r <= wbRounds; r++) {
    const lbRound = 2 * (r - 1);
    const count = n / 2 ** r;
    for (let p = 1; p <= count; p++) {
      const m = ensure(map, "winners", r, p);
      m.loserGoesTo = {
        side: "losers",
        round: lbRound,
        position: count - p + 1,
        slot: 2,
      };
    }
  }

  const order = seedOrder(n);
  for (let p = 1; p <= r1Count; p++) {
    const m = ensure(map, "winners", 1, p);
    const s1 = order[(p - 1) * 2];
    const s2 = order[(p - 1) * 2 + 1];
    m.entry1Id = seededIds[s1 - 1] ?? null;
    m.entry2Id = seededIds[s2 - 1] ?? null;
  }

  resolveByes(map);
  return [...map.values()];
}

function resolveByes(map: Map<string, MatchDraft>) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 64) {
    changed = false;
    guard += 1;
    for (const m of map.values()) {
      if (m.byeAdvanced) continue;
      const a = m.entry1Id;
      const b = m.entry2Id;
      if (a && !b) {
        if (m.winnerGoesTo) placePlayer(map, m.winnerGoesTo, a);
        m.byeAdvanced = true;
        changed = true;
      } else if (!a && b) {
        if (m.winnerGoesTo) placePlayer(map, m.winnerGoesTo, b);
        m.entry1Id = b;
        m.entry2Id = null;
        m.byeAdvanced = true;
        changed = true;
      }
    }
  }
}

export function generateRoundRobin(seededIds: number[]): MatchDraft[] {
  const players = [...seededIds];
  const bye = -1;
  if (players.length % 2 === 1) players.push(bye);
  const n = players.length;
  const rounds = n - 1;
  const half = n / 2;
  const arr = [...players];
  const drafts: MatchDraft[] = [];

  for (let r = 0; r < rounds; r++) {
    let pos = 1;
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === bye || b === bye) continue;
      drafts.push({
        side: "group",
        round: r + 1,
        position: pos,
        entry1Id: a,
        entry2Id: b,
      });
      pos += 1;
    }
    const last = arr.pop();
    if (last !== undefined) arr.splice(1, 0, last);
  }
  return drafts;
}

export interface SwissPlayer {
  id: number;
  seed: number;
  wins: number;
  losses: number;
  buchholz: number;
  played: number[];
}

export function pairSwissRound(players: SwissPlayer[], round: number): MatchDraft[] {
  const sorted = [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    return a.seed - b.seed;
  });

  const drafts: MatchDraft[] = [];
  const used = new Set<number>();
  let pos = 1;

  if (sorted.length % 2 === 1) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (!used.has(sorted[i].id)) {
        used.add(sorted[i].id);
        drafts.push({
          side: "group",
          round,
          position: pos,
          entry1Id: sorted[i].id,
          entry2Id: null,
        });
        pos += 1;
        break;
      }
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].id)) continue;
    let partner = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j].id)) continue;
      if (sorted[i].played.includes(sorted[j].id)) continue;
      partner = j;
      break;
    }
    if (partner === -1) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!used.has(sorted[j].id)) {
          partner = j;
          break;
        }
      }
    }
    if (partner === -1) {
      drafts.push({
        side: "group",
        round,
        position: pos,
        entry1Id: sorted[i].id,
        entry2Id: null,
      });
      used.add(sorted[i].id);
      pos += 1;
      continue;
    }
    drafts.push({
      side: "group",
      round,
      position: pos,
      entry1Id: sorted[i].id,
      entry2Id: sorted[partner].id,
    });
    used.add(sorted[i].id);
    used.add(sorted[partner].id);
    pos += 1;
  }

  return drafts;
}

export function defaultSwissRounds(playerCount: number) {
  return Math.max(3, Math.ceil(Math.log2(Math.max(2, playerCount))));
}
