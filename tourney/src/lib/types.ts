import type { Format } from "./constants";

export type TournamentStatus = "registration" | "in_progress" | "completed";
export type MatchStatus = "pending" | "ready" | "complete" | "bye";
export type MatchSide = "winners" | "losers" | "grand" | "group";

export interface Tournament {
  id: number;
  slug: string;
  name: string;
  description: string;
  format: Format;
  status: TournamentStatus;
  entryFeeDoge: number;
  maxPlayers: number;
  swissRounds: number;
  treasury: string;
  createdAt: string;
}

export interface Entry {
  id: number;
  tournamentId: number;
  handle: string;
  wallet: string;
  seed: number | null;
  paid: boolean;
  invoiceCode: string;
  amountDoge: number;
  paidAt: string | null;
  createdAt: string;
}

export interface Match {
  id: number;
  tournamentId: number;
  side: MatchSide;
  round: number;
  position: number;
  entry1Id: number | null;
  entry2Id: number | null;
  winnerId: number | null;
  score1: number | null;
  score2: number | null;
  status: MatchStatus;
  winnerNextId: number | null;
  winnerNextSlot: number | null;
  loserNextId: number | null;
  loserNextSlot: number | null;
}

export interface Standing {
  entryId: number;
  handle: string;
  seed: number | null;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  points: number;
  buchholz: number;
  mapDiff: number;
}

export interface TournamentListItem extends Tournament {
  paidCount: number;
  entryCount: number;
  prizePool: number;
}

export interface TournamentDetail {
  tournament: Tournament;
  entries: Entry[];
  matches: Match[];
  standings: Standing[];
  prizePool: number;
  champion: { id: number; handle: string } | null;
}
