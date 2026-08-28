import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import {
  FORMATS,
  makeInvoiceCode,
  makeTreasury,
  slugify,
  type Format,
} from "@/lib/constants";
import {
  defaultSwissRounds,
  generateDoubleElim,
  generateRoundRobin,
  generateSingleElim,
  pairSwissRound,
  type MatchDraft,
  type SwissPlayer,
} from "@/lib/bracket";
import type {
  Entry,
  Match,
  MatchSide,
  MatchStatus,
  Standing,
  Tournament,
  TournamentDetail,
  TournamentListItem,
  TournamentStatus,
} from "@/lib/types";

interface TournamentRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  format: string;
  status: string;
  entry_fee_doge: string | number;
  max_players: number;
  swiss_rounds: number;
  treasury: string;
  created_at: string;
}

interface EntryRow {
  id: number;
  tournament_id: number;
  handle: string;
  wallet: string;
  seed: number | null;
  paid: boolean;
  invoice_code: string;
  amount_doge: string | number;
  paid_at: string | null;
  created_at: string;
}

interface MatchRow {
  id: number;
  tournament_id: number;
  side: string;
  round: number;
  position: number;
  entry1_id: number | null;
  entry2_id: number | null;
  winner_id: number | null;
  score1: number | null;
  score2: number | null;
  status: string;
  winner_next_id: number | null;
  winner_next_slot: number | null;
  loser_next_id: number | null;
  loser_next_slot: number | null;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

function mapTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    format: row.format as Format,
    status: row.status as TournamentStatus,
    entryFeeDoge: num(row.entry_fee_doge),
    maxPlayers: row.max_players,
    swissRounds: row.swiss_rounds,
    treasury: row.treasury,
    createdAt: row.created_at,
  };
}

function mapEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    handle: row.handle,
    wallet: row.wallet,
    seed: row.seed,
    paid: Boolean(row.paid),
    invoiceCode: row.invoice_code,
    amountDoge: num(row.amount_doge),
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

function mapMatch(row: MatchRow): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    side: row.side as MatchSide,
    round: row.round,
    position: row.position,
    entry1Id: row.entry1_id,
    entry2Id: row.entry2_id,
    winnerId: row.winner_id,
    score1: row.score1,
    score2: row.score2,
    status: row.status as MatchStatus,
    winnerNextId: row.winner_next_id,
    winnerNextSlot: row.winner_next_slot,
    loserNextId: row.loser_next_id,
    loserNextSlot: row.loser_next_slot,
  };
}

function computeStandings(entries: Entry[], matches: Match[]): Standing[] {
  const byId = new Map<number, Standing>();
  for (const e of entries) {
    byId.set(e.id, {
      entryId: e.id,
      handle: e.handle,
      seed: e.seed,
      wins: 0,
      losses: 0,
      draws: 0,
      played: 0,
      points: 0,
      buchholz: 0,
      mapDiff: 0,
    });
  }
  const opps = new Map<number, number[]>();
  for (const m of matches) {
    if (m.status !== "complete" && m.status !== "bye") continue;
    const a = m.entry1Id;
    const b = m.entry2Id;
    if (a && b) {
      opps.set(a, [...(opps.get(a) ?? []), b]);
      opps.set(b, [...(opps.get(b) ?? []), a]);
    }
    if (m.status === "bye" && a) {
      const s = byId.get(a);
      if (s) {
        s.wins += 1;
        s.points += 3;
      }
      continue;
    }
    if (!a || !b) continue;
    const s1 = byId.get(a);
    const s2 = byId.get(b);
    if (!s1 || !s2) continue;
    s1.played += 1;
    s2.played += 1;
    const sc1 = m.score1 ?? (m.winnerId === a ? 1 : 0);
    const sc2 = m.score2 ?? (m.winnerId === b ? 1 : 0);
    s1.mapDiff += sc1 - sc2;
    s2.mapDiff += sc2 - sc1;
    if (m.winnerId === a) {
      s1.wins += 1;
      s1.points += 3;
      s2.losses += 1;
    } else if (m.winnerId === b) {
      s2.wins += 1;
      s2.points += 3;
      s1.losses += 1;
    } else {
      s1.draws += 1;
      s2.draws += 1;
      s1.points += 1;
      s2.points += 1;
    }
  }
  for (const [id, s] of byId) {
    const ids = opps.get(id) ?? [];
    s.buchholz = ids.reduce((sum, oid) => sum + (byId.get(oid)?.wins ?? 0), 0);
  }
  return [...byId.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    if (b.mapDiff !== a.mapDiff) return b.mapDiff - a.mapDiff;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });
}

function findChampion(t: Tournament, entries: Entry[], matches: Match[]): { id: number; handle: string } | null {
  if (t.status !== "completed") return null;
  if (t.format === "single_elim" || t.format === "double_elim") {
    const finals = matches.filter((m) =>
      t.format === "double_elim" ? m.side === "grand" : m.side === "winners",
    );
    const last = finals.sort((a, b) => b.round - a.round || b.position - a.position)[0];
    if (last?.winnerId) {
      const e = entries.find((x) => x.id === last.winnerId);
      if (e) return { id: e.id, handle: e.handle };
    }
  }
  const table = computeStandings(entries.filter((e) => e.paid), matches);
  const top = table[0];
  if (top && top.played > 0) return { id: top.entryId, handle: top.handle };
  return null;
}

function matchStatusOf(draft: MatchDraft): MatchStatus {
  if (draft.byeAdvanced || (draft.entry1Id && !draft.entry2Id)) return "bye";
  if (draft.entry1Id && draft.entry2Id) return "ready";
  return "pending";
}

async function insertDrafts(tournamentId: number, drafts: MatchDraft[]) {
  const sql = await getSql();
  const idMap = new Map<string, number>();
  for (const d of drafts) {
    const status = matchStatusOf(d);
    const rows = await sql<{ id: number }>`
      insert into matches (
        tournament_id, side, round, position,
        entry1_id, entry2_id, winner_id, status
      ) values (
        ${tournamentId}, ${d.side}, ${d.round}, ${d.position},
        ${d.entry1Id}, ${d.entry2Id},
        ${d.byeAdvanced ? d.entry1Id : null},
        ${status}
      )
      returning id
    `;
    idMap.set(`${d.side}:${d.round}:${d.position}`, Number(rows[0].id));
  }
  for (const d of drafts) {
    const id = idMap.get(`${d.side}:${d.round}:${d.position}`);
    if (!id) continue;
    const w = d.winnerGoesTo
      ? (idMap.get(
          `${d.winnerGoesTo.side}:${d.winnerGoesTo.round}:${d.winnerGoesTo.position}`,
        ) ?? null)
      : null;
    const l = d.loserGoesTo
      ? (idMap.get(
          `${d.loserGoesTo.side}:${d.loserGoesTo.round}:${d.loserGoesTo.position}`,
        ) ?? null)
      : null;
    await sql`
      update matches set
        winner_next_id = ${w},
        winner_next_slot = ${d.winnerGoesTo ? d.winnerGoesTo.slot : null},
        loser_next_id = ${l},
        loser_next_slot = ${d.loserGoesTo ? d.loserGoesTo.slot : null}
      where id = ${id}
    `;
  }
}

async function loadTournamentBySlug(slug: string): Promise<TournamentDetail | null> {
  const sql = await getSql();
  const trows = await sql<TournamentRow>`
    select * from tournaments where slug = ${slug} limit 1
  `;
  if (!trows[0]) return null;
  const tournament = mapTournament(trows[0]);
  const erows = await sql<EntryRow>`
    select * from entries where tournament_id = ${tournament.id} order by seed nulls last, id
  `;
  const mrows = await sql<MatchRow>`
    select * from matches
    where tournament_id = ${tournament.id}
    order by
      case side when 'winners' then 0 when 'losers' then 1 when 'grand' then 2 else 3 end,
      round, position
  `;
  const entries = erows.map(mapEntry);
  const matches = mrows.map(mapMatch);
  const paid = entries.filter((e) => e.paid);
  const prizePool = paid.reduce((s, e) => s + e.amountDoge, 0);
  return {
    tournament,
    entries,
    matches,
    standings: computeStandings(paid, matches),
    prizePool,
    champion: findChampion(tournament, entries, matches),
  };
}

const DEMO_PACK = [
  "Ashpaw",
  "Emberfang",
  "Goldcollar",
  "Nighthowl",
  "Rustmane",
  "Solarbark",
  "Thornjaw",
  "Vexpack",
];

let seedLock: Promise<void> | null = null;

async function seedDemoIfEmpty() {
  if (!seedLock) seedLock = seedDemoOnce();
  await seedLock;
}

async function seedDemoOnce() {
  const sql = await getSql();
  const count = await sql<{ n: number }>`select count(*)::int as n from tournaments`;
  if ((count[0]?.n ?? 0) > 0) return;

  const demos: {
    name: string;
    description: string;
    format: Format;
    fee: number;
    max: number;
    swiss: number;
    handles: string[];
    generate: boolean;
    play?: [string, string, number, number][];
  }[] = [
    {
      name: "Rise of the Pack Open",
      description: "Flagship single-elim. Paid entries lock a seed. Winner takes the ember pot.",
      format: "single_elim",
      fee: 25,
      max: 16,
      swiss: 3,
      handles: DEMO_PACK,
      generate: true,
      play: [
        ["Ashpaw", "Vexpack", 2, 0],
        ["Goldcollar", "Rustmane", 2, 1],
      ],
    },
    {
      name: "Ember Swiss",
      description: "Swiss pairing by record. Entry in DOGE. Import the paid list when the hearth is full.",
      format: "swiss",
      fee: 10,
      max: 16,
      swiss: 4,
      handles: ["Cinderpelt", "Mossjaw", "Ironbark", "Duskwhelp", "Brighthowl", "Gravelpaw"],
      generate: false,
    },
    {
      name: "Hearth Round Robin",
      description: "Everyone faces everyone. Lowest fee, highest grind.",
      format: "round_robin",
      fee: 5,
      max: 8,
      swiss: 3,
      handles: ["Pike", "Marl", "Sable", "Quartz"],
      generate: false,
    },
  ];

  for (const d of demos) {
    const slug =
      d.format === "single_elim"
        ? "rise-of-the-pack-open"
        : d.format === "swiss"
          ? "ember-swiss"
          : "hearth-round-robin";
    const trows = await sql<TournamentRow>`
      insert into tournaments (
        slug, name, description, format, status,
        entry_fee_doge, max_players, swiss_rounds, treasury
      ) values (
        ${slug}, ${d.name}, ${d.description}, ${d.format}, 'registration',
        ${d.fee}, ${d.max}, ${d.swiss}, ${makeTreasury(slug)}
      )
      returning *
    `;
    const t = mapTournament(trows[0]);
    const ids: { handle: string; id: number }[] = [];
    for (let i = 0; i < d.handles.length; i++) {
      const handle = d.handles[i];
      const unpaid = d.format !== "single_elim" && i >= d.handles.length - 1;
      const rows = await sql<EntryRow>`
        insert into entries (
          tournament_id, handle, seed, paid, invoice_code, amount_doge, paid_at, wallet
        ) values (
          ${t.id}, ${handle}, ${i + 1}, ${!unpaid}, ${makeInvoiceCode()}, ${d.fee},
          ${unpaid ? null : new Date().toISOString()},
          ${unpaid ? "" : "DDemoWallet" + handle}
        )
        returning *
      `;
      ids.push({ handle, id: rows[0].id });
    }
    if (d.generate) {
      const paidIds = ids.map((x) => x.id);
      const drafts = generateSingleElim(paidIds);
      await insertDrafts(t.id, drafts);
      await sql`update tournaments set status = 'in_progress' where id = ${t.id}`;
      if (d.play) {
        const detail = await loadTournamentBySlug(t.slug);
        if (detail) {
          for (const [h1, h2, s1, s2] of d.play) {
            const e1 = detail.entries.find((e) => e.handle === h1);
            const e2 = detail.entries.find((e) => e.handle === h2);
            if (!e1 || !e2) continue;
            const match = detail.matches.find(
              (m) =>
                (m.entry1Id === e1.id && m.entry2Id === e2.id) ||
                (m.entry1Id === e2.id && m.entry2Id === e1.id),
            );
            if (!match) continue;
            const flipped = match.entry1Id === e2.id;
            await applyResult(
              match.id,
              flipped ? s2 : s1,
              flipped ? s1 : s2,
              flipped ? e2.id : e1.id,
            );
          }
        }
      }
    }
  }
}

async function applyResult(
  matchId: number,
  score1: number,
  score2: number,
  winnerId: number,
) {
  const sql = await getSql();
  const rows = await sql<MatchRow>`select * from matches where id = ${matchId} limit 1`;
  const match = rows[0];
  if (!match) throw new Error("Match not found");
  if (match.status === "complete") throw new Error("Match already reported");
  if (winnerId !== match.entry1_id && winnerId !== match.entry2_id) {
    throw new Error("Winner must be one of the two pack members");
  }
  const loserId = winnerId === match.entry1_id ? match.entry2_id : match.entry1_id;

  await sql`
    update matches
    set score1 = ${score1}, score2 = ${score2}, winner_id = ${winnerId}, status = 'complete'
    where id = ${matchId}
  `;

  async function seat(nextId: number | null, slot: number | null, entryId: number | null) {
    const dest = nextId == null ? 0 : Number(nextId);
    const sl = slot == null ? 0 : Number(slot);
    const eid = entryId == null ? 0 : Number(entryId);
    if (!dest || !sl || !eid) return;
    if (sl === 1) {
      await sql`update matches set entry1_id = ${eid} where id = ${dest}`;
    } else {
      await sql`update matches set entry2_id = ${eid} where id = ${dest}`;
    }
    const next = await sql<MatchRow>`select * from matches where id = ${dest} limit 1`;
    const n = next[0];
    if (n && n.entry1_id && n.entry2_id && n.status === "pending") {
      await sql`update matches set status = 'ready' where id = ${dest}`;
    }
  }

  await seat(match.winner_next_id, match.winner_next_slot, winnerId);
  await seat(match.loser_next_id, match.loser_next_slot, loserId);

  const trows = await sql<TournamentRow>`
    select * from tournaments where id = ${match.tournament_id} limit 1
  `;
  const t = trows[0];
  if (!t) return;

  if (t.format === "single_elim") {
    const fin = await sql<MatchRow>`
      select * from matches
      where tournament_id = ${t.id} and side = 'winners'
      order by round desc, position asc
      limit 1
    `;
    if (fin[0]?.winner_id) {
      await sql`update tournaments set status = 'completed' where id = ${t.id}`;
    }
  }

  if (t.format === "double_elim") {
    const gf = await sql<MatchRow>`
      select * from matches
      where tournament_id = ${t.id} and side = 'grand'
      order by round desc
      limit 1
    `;
    if (gf[0]?.winner_id) {
      await sql`update tournaments set status = 'completed' where id = ${t.id}`;
    }
  }

  if (t.format === "round_robin") {
    const left = await sql<{ n: number }>`
      select count(*)::int as n from matches
      where tournament_id = ${t.id} and status <> 'complete'
    `;
    if ((left[0]?.n ?? 0) === 0) {
      await sql`update tournaments set status = 'completed' where id = ${t.id}`;
    }
  }

  if (t.format === "swiss") {
    const currentRound = match.round;
    const leftInRound = await sql<{ n: number }>`
      select count(*)::int as n from matches
      where tournament_id = ${t.id} and round = ${currentRound} and status <> 'complete' and status <> 'bye'
    `;
    if ((leftInRound[0]?.n ?? 0) === 0) {
      if (currentRound >= t.swiss_rounds) {
        await sql`update tournaments set status = 'completed' where id = ${t.id}`;
      } else {
        const detail = await loadTournamentBySlug(t.slug);
        if (detail) {
          const paid = detail.entries.filter((e) => e.paid);
          const table = computeStandings(paid, detail.matches);
          const players: SwissPlayer[] = paid.map((e) => {
            const s = table.find((x) => x.entryId === e.id);
            const played: number[] = [];
            for (const m of detail.matches) {
              if (m.entry1Id === e.id && m.entry2Id) played.push(m.entry2Id);
              if (m.entry2Id === e.id && m.entry1Id) played.push(m.entry1Id);
            }
            return {
              id: e.id,
              seed: e.seed ?? 99,
              wins: s?.wins ?? 0,
              losses: s?.losses ?? 0,
              buchholz: s?.buchholz ?? 0,
              played,
            };
          });
          const next = pairSwissRound(players, currentRound + 1);
          await insertDrafts(t.id, next);
        }
      }
    }
  }
}

export const listTournaments = createServerFn({ method: "POST" }).handler(
  async (): Promise<TournamentListItem[]> => {
    await seedDemoIfEmpty();
    const sql = await getSql();
    const rows = await sql<
      TournamentRow & { paid_count: number; entry_count: number; prize_pool: string | number }
    >`
      select t.*,
        (select count(*)::int from entries e where e.tournament_id = t.id and e.paid) as paid_count,
        (select count(*)::int from entries e where e.tournament_id = t.id) as entry_count,
        coalesce((select sum(e.amount_doge) from entries e where e.tournament_id = t.id and e.paid), 0) as prize_pool
      from tournaments t
      order by t.created_at desc
    `;
    return rows.map((r) => ({
      ...mapTournament(r),
      paidCount: r.paid_count,
      entryCount: r.entry_count,
      prizePool: num(r.prize_pool),
    }));
  },
);

export const getTournament = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z.object({ slug: z.string().min(1) }).safeParse(data);
    if (!parsed.success) throw new Error("Tournament not found");
    return parsed.data;
  })
  .handler(async ({ data }): Promise<TournamentDetail> => {
    await seedDemoIfEmpty();
    const detail = await loadTournamentBySlug(data.slug);
    if (!detail) throw new Error("Tournament not found");
    return detail;
  });

export const createTournament = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(400).optional().default(""),
        format: z.enum(FORMATS),
        entryFeeDoge: z.coerce.number().min(0).max(100000),
        maxPlayers: z.coerce.number().int().min(4).max(64),
        swissRounds: z.coerce.number().int().min(3).max(12).optional(),
        hostPassword: z.string().min(1).max(200),
      })
      .safeParse(data);
    if (!parsed.success) throw new Error("Check the tournament fields and try again");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    const { assertHostPassword } = await import("./host-gate.server");
    assertHostPassword(data.hostPassword);
    const sql = await getSql();
    const slug = slugify(data.name);
    const swiss = data.swissRounds ?? defaultSwissRounds(data.maxPlayers);
    const rows = await sql<TournamentRow>`
      insert into tournaments (
        slug, name, description, format, status,
        entry_fee_doge, max_players, swiss_rounds, treasury
      ) values (
        ${slug}, ${data.name}, ${data.description}, ${data.format}, 'registration',
        ${data.entryFeeDoge}, ${data.maxPlayers}, ${swiss}, ${makeTreasury(slug)}
      )
      returning *
    `;
    return mapTournament(rows[0]);
  });

export const registerEntry = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z
      .object({
        slug: z.string().min(1),
        handle: z.string().trim().min(2).max(24),
        wallet: z.string().trim().max(48).optional().default(""),
      })
      .safeParse(data);
    if (!parsed.success) throw new Error("Enter a pack handle (2–24 characters)");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const trows = await sql<TournamentRow>`
      select * from tournaments where slug = ${data.slug} limit 1
    `;
    const t = trows[0];
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "registration") throw new Error("Registration is closed");
    const count = await sql<{ n: number }>`
      select count(*)::int as n from entries where tournament_id = ${t.id}
    `;
    if ((count[0]?.n ?? 0) >= t.max_players) throw new Error("This arena is full");
    const handle = data.handle.replace(/\s+/g, " ");
    const exists = await sql<{ n: number }>`
      select count(*)::int as n from entries
      where tournament_id = ${t.id} and lower(handle) = ${handle.toLowerCase()}
    `;
    if ((exists[0]?.n ?? 0) > 0) throw new Error("That handle is already in this arena");
    const fee = num(t.entry_fee_doge);
    const autoPay = fee === 0;
    const rows = await sql<EntryRow>`
      insert into entries (
        tournament_id, handle, wallet, paid, invoice_code, amount_doge, paid_at
      ) values (
        ${t.id}, ${handle}, ${data.wallet ?? ""}, ${autoPay}, ${makeInvoiceCode()}, ${fee},
        ${autoPay ? new Date().toISOString() : null}
      )
      returning *
    `;
    return mapEntry(rows[0]);
  });

export const confirmPayment = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z.object({ invoiceCode: z.string().min(4) }).safeParse(data);
    if (!parsed.success) throw new Error("Invoice not found");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<EntryRow>`
      select * from entries where invoice_code = ${data.invoiceCode} limit 1
    `;
    if (!rows[0]) throw new Error("Invoice not found");
    if (rows[0].paid) return mapEntry(rows[0]);
    const t = await sql<TournamentRow>`
      select * from tournaments where id = ${rows[0].tournament_id} limit 1
    `;
    if (t[0] && t[0].status !== "registration") {
      throw new Error("Registration is closed");
    }
    const updated = await sql<EntryRow>`
      update entries
      set paid = true, paid_at = ${new Date().toISOString()}
      where id = ${rows[0].id}
      returning *
    `;
    return mapEntry(updated[0]);
  });

export const addParticipants = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z
      .object({
        slug: z.string().min(1),
        handles: z.array(z.string().trim().min(1).max(24)).min(1).max(64),
        markPaid: z.boolean().optional().default(false),
      })
      .safeParse(data);
    if (!parsed.success) throw new Error("Paste at least one handle");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const trows = await sql<TournamentRow>`
      select * from tournaments where slug = ${data.slug} limit 1
    `;
    const t = trows[0];
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "registration") throw new Error("Registration is closed");
    const fee = num(t.entry_fee_doge);
    let added = 0;
    for (const raw of data.handles) {
      const handle = raw.replace(/\s+/g, " ").trim();
      if (handle.length < 2) continue;
      const count = await sql<{ n: number }>`
        select count(*)::int as n from entries where tournament_id = ${t.id}
      `;
      if ((count[0]?.n ?? 0) >= t.max_players) break;
      const exists = await sql<{ n: number }>`
        select count(*)::int as n from entries
        where tournament_id = ${t.id} and lower(handle) = ${handle.toLowerCase()}
      `;
      if ((exists[0]?.n ?? 0) > 0) continue;
      const paid = data.markPaid || fee === 0;
      await sql`
        insert into entries (
          tournament_id, handle, paid, invoice_code, amount_doge, paid_at
        ) values (
          ${t.id}, ${handle}, ${paid}, ${makeInvoiceCode()}, ${fee},
          ${paid ? new Date().toISOString() : null}
        )
      `;
      added += 1;
    }
    return { added };
  });

export const generateBracket = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z
      .object({
        slug: z.string().min(1),
        shuffle: z.boolean().optional().default(false),
      })
      .safeParse(data);
    if (!parsed.success) throw new Error("Tournament not found");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const trows = await sql<TournamentRow>`
      select * from tournaments where slug = ${data.slug} limit 1
    `;
    const t = trows[0];
    if (!t) throw new Error("Tournament not found");
    if (t.status === "completed") throw new Error("This arena is already complete");
    const erows = await sql<EntryRow>`
      select * from entries where tournament_id = ${t.id} and paid = true order by id
    `;
    if (erows.length < 4) throw new Error("Need at least 4 paid entries to lock a bracket");
    let list = erows.map(mapEntry);
    if (data.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    } else {
      list = [...list].sort((a, b) => (a.seed ?? a.id) - (b.seed ?? b.id));
    }
    for (let i = 0; i < list.length; i++) {
      await sql`update entries set seed = ${i + 1} where id = ${list[i].id}`;
    }
    await sql`delete from matches where tournament_id = ${t.id}`;
    const ids = list.map((e) => e.id);
    let drafts: MatchDraft[] = [];
    if (t.format === "single_elim") drafts = generateSingleElim(ids);
    else if (t.format === "double_elim") drafts = generateDoubleElim(ids);
    else if (t.format === "round_robin") drafts = generateRoundRobin(ids);
    else {
      const players: SwissPlayer[] = list.map((e, i) => ({
        id: e.id,
        seed: i + 1,
        wins: 0,
        losses: 0,
        buchholz: 0,
        played: [],
      }));
      drafts = pairSwissRound(players, 1);
    }
    await insertDrafts(t.id, drafts);
    await sql`update tournaments set status = 'in_progress' where id = ${t.id}`;
    const detail = await loadTournamentBySlug(t.slug);
    if (!detail) throw new Error("Failed to load bracket");
    return detail;
  });

export const reportScore = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = z
      .object({
        matchId: z.coerce.number().int(),
        score1: z.coerce.number().int().min(0).max(99),
        score2: z.coerce.number().int().min(0).max(99),
        winnerId: z.coerce.number().int(),
      })
      .safeParse(data);
    if (!parsed.success) throw new Error("Enter both scores");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    await applyResult(data.matchId, data.score1, data.score2, data.winnerId);
    return { ok: true };
  });

