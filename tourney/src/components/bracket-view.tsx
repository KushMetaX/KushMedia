import { useState } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORMAT_LABEL, roundLabel, type Format } from "@/lib/constants";
import type { Entry, Match, Tournament } from "@/lib/types";
import { cn } from "@/lib/utils";

function handleOf(entries: Entry[], id: number | null) {
  if (!id) return null;
  return entries.find((e) => e.id === id) ?? null;
}

function groupRounds(matches: Match[], side: Match["side"]) {
  const ofSide = matches.filter((m) => m.side === side);
  const max = ofSide.reduce((n, m) => Math.max(n, m.round), 0);
  const rounds: Match[][] = [];
  for (let r = 1; r <= max; r++) {
    rounds.push(ofSide.filter((m) => m.round === r).sort((a, b) => a.position - b.position));
  }
  return rounds.filter((r) => r.length > 0);
}

function SlotRow({
  entry,
  score,
  winner,
  empty,
}: {
  entry: Entry | null;
  score: number | null;
  winner: boolean;
  empty: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center justify-between gap-2 px-2.5 text-sm",
        winner ? "bg-primary/15 text-fg" : "text-muted",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {entry?.seed ? (
          <span className="w-4 shrink-0 font-mono text-[10px] text-subtle tabular-nums">
            {entry.seed}
          </span>
        ) : null}
        <span className={cn("truncate", !entry && "text-subtle italic")}>
          {entry?.handle ?? empty}
        </span>
      </span>
      <span className="font-mono text-xs tabular-nums">{score ?? ""}</span>
    </div>
  );
}

function MatchCard({
  match,
  entries,
  onSelect,
}: {
  match: Match;
  entries: Entry[];
  onSelect: (m: Match) => void;
}) {
  const p1 = handleOf(entries, match.entry1Id);
  const p2 = handleOf(entries, match.entry2Id);
  const clickable = match.status === "ready";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onSelect(match)}
      className={cn(
        "w-[220px] overflow-hidden rounded-md bg-surface text-left shadow-[var(--shadow-border)]",
        clickable && "hover:shadow-[var(--shadow-border-hover)]",
        match.status === "complete" && "opacity-95",
        match.status === "bye" && "opacity-70",
      )}
    >
      <SlotRow
        entry={p1}
        score={match.score1}
        winner={match.winnerId === match.entry1Id && match.status === "complete"}
        empty={match.status === "bye" ? "BYE" : "TBD"}
      />
      <div className="h-px bg-border/60" />
      <SlotRow
        entry={p2}
        score={match.score2}
        winner={match.winnerId === match.entry2Id && match.status === "complete"}
        empty={match.status === "bye" ? "BYE" : "TBD"}
      />
    </button>
  );
}

function BracketColumns({
  matches,
  entries,
  side,
  format,
  onSelect,
}: {
  matches: Match[];
  entries: Entry[];
  side: Match["side"];
  format: Format;
  onSelect: (m: Match) => void;
}) {
  const rounds = groupRounds(matches, side);
  if (rounds.length === 0) return null;
  const maxRound = rounds.length;
  return (
    <div className="w-full min-w-0 overflow-x-auto pb-3">
      <div className="flex w-max gap-6">
        {rounds.map((roundMatches, i) => (
          <div key={`${side}-${i}`} className="flex min-w-[220px] flex-col">
            <p className="font-display mb-3 text-center text-[11px] tracking-[0.2em] text-primary uppercase">
              {roundLabel(format, side, roundMatches[0]?.round ?? i + 1, maxRound)}
            </p>
            <div className="flex flex-1 flex-col justify-around gap-4">
              {roundMatches.map((m) => (
                <div key={m.id} className="flex justify-center">
                  <MatchCard match={m} entries={entries} onSelect={onSelect} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BracketView({
  tournament,
  entries,
  matches,
  champion,
  onReported,
}: {
  tournament: Tournament;
  entries: Entry[];
  matches: Match[];
  champion: { id: number; handle: string } | null;
  onReported: (matchId: number, score1: number, score2: number, winnerId: number) => Promise<void>;
}) {
  const [active, setActive] = useState<Match | null>(null);
  const [score1, setScore1] = useState("2");
  const [score2, setScore2] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p1 = active ? handleOf(entries, active.entry1Id) : null;
  const p2 = active ? handleOf(entries, active.entry2Id) : null;

  async function submit(winnerId: number) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await onReported(active.id, Number(score1), Number(score2), winnerId);
      setActive(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not report");
    } finally {
      setBusy(false);
    }
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-xl bg-surface/80 px-5 py-10 text-center shadow-[var(--shadow-border)]">
        <p className="font-display text-lg tracking-wide">No bracket yet</p>
        <p className="mt-1 text-sm text-muted">
          Import the paid roster when registration is locked.
        </p>
      </div>
    );
  }

  const isTree = tournament.format === "single_elim" || tournament.format === "double_elim";

  return (
    <div className="space-y-8">
      {champion ? (
        <div className="flex items-center gap-3 rounded-xl bg-primary/12 px-4 py-3 shadow-[var(--shadow-border)]">
          <Trophy className="size-5 text-primary" />
          <div>
            <p className="font-display text-sm tracking-wide text-primary">Champion</p>
            <p className="text-fg">{champion.handle}</p>
          </div>
        </div>
      ) : null}

      {isTree ? (
        <>
          {tournament.format === "double_elim" ? (
            <section className="space-y-3">
              <h3 className="font-display text-sm tracking-[0.22em] text-muted uppercase">
                Winners bracket
              </h3>
              <BracketColumns
                matches={matches}
                entries={entries}
                side="winners"
                format={tournament.format}
                onSelect={(m) => {
                  setActive(m);
                  setScore1("2");
                  setScore2("0");
                  setError(null);
                }}
              />
            </section>
          ) : (
            <BracketColumns
              matches={matches}
              entries={entries}
              side="winners"
              format={tournament.format}
              onSelect={(m) => {
                setActive(m);
                setScore1("2");
                setScore2("0");
                setError(null);
              }}
            />
          )}
          {tournament.format === "double_elim" ? (
            <>
              <section className="space-y-3">
                <h3 className="font-display text-sm tracking-[0.22em] text-muted uppercase">
                  Losers bracket
                </h3>
                <BracketColumns
                  matches={matches}
                  entries={entries}
                  side="losers"
                  format={tournament.format}
                  onSelect={(m) => {
                    setActive(m);
                    setScore1("2");
                    setScore2("0");
                    setError(null);
                  }}
                />
              </section>
              <section className="space-y-3">
                <h3 className="font-display text-sm tracking-[0.22em] text-muted uppercase">
                  Grand final
                </h3>
                <BracketColumns
                  matches={matches}
                  entries={entries}
                  side="grand"
                  format={tournament.format}
                  onSelect={(m) => {
                    setActive(m);
                    setScore1("2");
                    setScore2("0");
                    setError(null);
                  }}
                />
              </section>
            </>
          ) : null}
        </>
      ) : (
        <div className="space-y-8">
          {groupRounds(matches, "group").map((roundMatches) => (
            <section key={roundMatches[0]?.round}>
              <h3 className="font-display mb-3 text-sm tracking-[0.22em] text-muted uppercase">
                {roundLabel(
                  tournament.format,
                  "group",
                  roundMatches[0]?.round ?? 1,
                  tournament.swissRounds,
                )}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {roundMatches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    entries={entries}
                    onSelect={(mm) => {
                      setActive(mm);
                      setScore1("2");
                      setScore2("0");
                      setError(null);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-subtle">
        {FORMAT_LABEL[tournament.format]} · tap a ready match to report the score.
      </p>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report match</DialogTitle>
            <DialogDescription>
              {p1?.handle ?? "TBD"} vs {p2?.handle ?? "TBD"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s1">{p1?.handle ?? "Player 1"}</Label>
              <Input
                id="s1"
                inputMode="numeric"
                value={score1}
                onChange={(e) => setScore1(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s2">{p2?.handle ?? "Player 2"}</Label>
              <Input
                id="s2"
                inputMode="numeric"
                value={score2}
                onChange={(e) => setScore2(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <div className="mt-5 flex flex-col gap-2">
            {p1 ? (
              <Button disabled={busy} onClick={() => submit(p1.id)}>
                {p1.handle} wins
              </Button>
            ) : null}
            {p2 ? (
              <Button variant="outline" disabled={busy} onClick={() => submit(p2.id)}>
                {p2.handle} wins
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
