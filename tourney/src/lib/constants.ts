export const FORMATS = [
  "single_elim",
  "double_elim",
  "round_robin",
  "swiss",
] as const;

export type Format = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<Format, string> = {
  single_elim: "Single Elimination",
  double_elim: "Double Elimination",
  round_robin: "Round Robin",
  swiss: "Swiss",
};

export const FORMAT_BLURB: Record<Format, string> = {
  single_elim: "One loss and you are out. Fast, brutal, classic.",
  double_elim: "Two losses to fall. Winners and losers brackets.",
  round_robin: "Everyone plays everyone. Standings decide the pack.",
  swiss: "Pair by record each round. No rematches.",
};

export const STATUS_LABEL: Record<string, string> = {
  registration: "Registration",
  in_progress: "Live",
  completed: "Complete",
};

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "arena"}-${suffix}`;
}

export function makeInvoiceCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "DDL-";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function makeTreasury(slug: string) {
  const raw = `DLGnds${slug.replace(/[^a-zA-Z0-9]/g, "")}DEMO`;
  return (raw + "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX").slice(0, 34);
}

export function roundLabel(format: Format, side: string, round: number, maxRound: number) {
  if (format === "swiss") return `Swiss Round ${round}`;
  if (format === "round_robin") return `Round ${round}`;
  if (side === "grand") return round === 1 ? "Grand Final" : "Grand Final Reset";
  if (side === "losers") return `Losers R${round}`;
  if (side === "winners" || side === "main") {
    const fromEnd = maxRound - round;
    if (fromEnd === 0) return "Final";
    if (fromEnd === 1) return "Semifinals";
    if (fromEnd === 2) return "Quarterfinals";
    return `Round ${round}`;
  }
  return `Round ${round}`;
}
