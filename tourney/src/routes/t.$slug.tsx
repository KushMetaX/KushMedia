import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Copy, Coins, Swords } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BracketView } from "@/components/bracket-view";
import { InvoiceSeal } from "@/components/invoice-seal";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FORMAT_LABEL } from "@/lib/constants";
import type { Entry } from "@/lib/types";
import {
  addParticipants,
  confirmPayment,
  generateBracket,
  getTournament,
  registerEntry,
  reportScore,
} from "@/lib/tournaments";
import { cn } from "@/lib/utils";

type Tab = "enter" | "roster" | "bracket";

export const Route = createFileRoute("/t/$slug")({
  loader: ({ params }) => getTournament({ data: { slug: params.slug } }),
  component: TournamentPage,
});

export function TournamentPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const { tournament, entries, matches, standings, prizePool, champion } = data;
  const [tab, setTab] = useState<Tab>(
    tournament.status === "registration" ? "enter" : "bracket",
  );

  async function refresh() {
    await router.invalidate();
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8">
      <p className="text-xs text-subtle">
        <Link to="/" className="hover:text-fg">
          Arenas
        </Link>
        <span className="mx-2">/</span>
        <span>{tournament.name}</span>
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl tracking-wide">{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
          </div>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {tournament.description || FORMAT_LABEL[tournament.format]}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 rounded-xl bg-surface/80 px-4 py-3 text-sm shadow-[var(--shadow-border)]">
          <div>
            <dt className="text-[11px] tracking-wide text-subtle uppercase">Fee</dt>
            <dd className="tabular-nums">{tournament.entryFeeDoge} DOGE</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-subtle uppercase">Pot</dt>
            <dd className="tabular-nums">{prizePool} DOGE</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-subtle uppercase">Paid</dt>
            <dd className="tabular-nums">
              {entries.filter((e) => e.paid).length}/{tournament.maxPlayers}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex gap-1 rounded-lg bg-surface/70 p-1 shadow-[var(--shadow-border)]">
        {(
          [
            ["enter", "Enter"],
            ["roster", "Roster"],
            ["bracket", "Bracket"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-11 flex-1 rounded-md text-sm",
              tab === id ? "bg-raised text-fg" : "text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "enter" ? (
          <EnterPanel entries={entries} onPaid={refresh} />
        ) : null}
        {tab === "roster" ? <RosterPanel onChanged={refresh} /> : null}
        {tab === "bracket" ? (
          <div className="space-y-6">
            {tournament.status === "registration" ? (
              <GenerateBar onGenerated={refresh} />
            ) : null}
            {standings.length > 0 &&
            (tournament.format === "swiss" || tournament.format === "round_robin") ? (
              <StandingsTable standings={standings} />
            ) : null}
            <BracketView
              tournament={tournament}
              entries={entries}
              matches={matches}
              champion={champion}
              onReported={async (matchId, score1, score2, winnerId) => {
                await reportScore({ data: { matchId, score1, score2, winnerId } });
                toast.success("Match locked");
                await refresh();
              }}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function EnterPanel({
  entries,
  onPaid,
}: {
  entries: Entry[];
  onPaid: () => Promise<void>;
}) {
  const { tournament } = Route.useLoaderData();
  const [handle, setHandle] = useState("");
  const [wallet, setWallet] = useState("");
  const [invoice, setInvoice] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = tournament.status !== "registration";

  async function register(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await registerEntry({
        data: { slug: tournament.slug, handle, wallet },
      });
      setInvoice(entry);
      if (entry.paid) {
        toast.success("Seat reserved");
        await onPaid();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enter");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!invoice) return;
    setConfirming(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const paid = await confirmPayment({ data: { invoiceCode: invoice.invoiceCode } });
      setInvoice(paid);
      toast.success("Payment confirmed — you are in the pack");
      await onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setConfirming(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form
        onSubmit={register}
        className="space-y-4 rounded-xl bg-surface/85 p-5 shadow-[var(--shadow-border)]"
      >
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-primary" />
          <h2 className="font-display text-lg tracking-wide">Pay to enter</h2>
        </div>
        <p className="text-sm text-muted">
          {closed
            ? "Registration is locked."
            : `Seat fee ${tournament.entryFeeDoge} DOGE. Demo network — confirm to simulate an on-chain payment.`}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="handle">Pack handle</Label>
          <Input
            id="handle"
            required
            minLength={2}
            maxLength={24}
            disabled={closed}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Emberfang"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wallet">Your DOGE wallet (optional)</Label>
          <Input
            id="wallet"
            disabled={closed}
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="D…"
            className="font-mono text-xs"
          />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy || closed}>
          {busy ? "Minting invoice…" : "Mint entry invoice"}
        </Button>
      </form>

      <div className="rounded-xl bg-surface/85 p-5 shadow-[var(--shadow-border)]">
        {invoice ? (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <InvoiceSeal code={invoice.invoiceCode} />
              <div className="min-w-0">
                <p className="font-display text-sm tracking-wide text-primary">Invoice</p>
                <p className="font-mono text-sm">{invoice.invoiceCode}</p>
                <p className="mt-2 text-2xl font-medium tabular-nums">
                  {invoice.amountDoge} <span className="text-sm text-muted">DOGE</span>
                </p>
                {invoice.paid ? (
                  <p className="mt-2 text-sm text-success">Paid · {invoice.handle} is in</p>
                ) : (
                  <p className="mt-2 text-sm text-muted">Awaiting confirmation</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Arena treasury (demo)</Label>
              <div className="flex gap-2">
                <Input readOnly value={tournament.treasury} className="font-mono text-[11px]" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(tournament.treasury, "Address")}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            {!invoice.paid ? (
              <Button className="w-full" disabled={confirming} onClick={pay}>
                {confirming ? "Confirming on demo chain…" : "Simulate DOGE payment"}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <p className="font-display text-lg tracking-wide">No invoice yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Claim a handle to mint a unique DOGE invoice for this hearth.
            </p>
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <h3 className="font-display text-sm tracking-[0.2em] text-muted uppercase">
          In the arena
        </h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between rounded-md bg-surface/80 px-3 py-2 text-sm shadow-[var(--shadow-border)]"
            >
              <span className="truncate">{e.handle}</span>
              <span className={e.paid ? "text-success" : "text-subtle"}>
                {e.paid ? "Paid" : "Unpaid"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RosterPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const { tournament, entries } = Route.useLoaderData();
  const [bulk, setBulk] = useState("");
  const [markPaid, setMarkPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const paid = entries.filter((e) => e.paid);
  const unpaid = entries.filter((e) => !e.paid);

  async function importList(e: FormEvent) {
    e.preventDefault();
    const handles = bulk
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (handles.length === 0) return;
    setBusy(true);
    try {
      const res = await addParticipants({
        data: { slug: tournament.slug, handles, markPaid },
      });
      toast.success(`Added ${res.added} pack member${res.added === 1 ? "" : "s"}`);
      setBulk("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-4">
        <h2 className="font-display text-lg tracking-wide">Paid ({paid.length})</h2>
        <ol className="space-y-2">
          {paid.map((e, i) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-md bg-surface/85 px-3 py-2 shadow-[var(--shadow-border)]"
            >
              <span className="w-6 font-mono text-xs text-subtle tabular-nums">{e.seed ?? i + 1}</span>
              <span className="flex-1 truncate">{e.handle}</span>
              <span className="font-mono text-[11px] text-subtle">{e.invoiceCode}</span>
            </li>
          ))}
        </ol>
        {unpaid.length > 0 ? (
          <>
            <h3 className="font-display pt-2 text-sm tracking-wide text-muted">Awaiting payment</h3>
            <ul className="space-y-2">
              {unpaid.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-md bg-surface/60 px-3 py-2 text-sm text-muted"
                >
                  <span>{e.handle}</span>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={async () => {
                      await confirmPayment({ data: { invoiceCode: e.invoiceCode } });
                      toast.success(`${e.handle} marked paid`);
                      await onChanged();
                    }}
                  >
                    Mark paid
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <form
        onSubmit={importList}
        className="space-y-3 rounded-xl bg-surface/85 p-5 shadow-[var(--shadow-border)]"
      >
        <h2 className="font-display text-lg tracking-wide">Import handles</h2>
        <p className="text-sm text-muted">
          One per line. Organizer list — check paid to skip invoices (comps, already collected).
        </p>
        <Textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={"Ashpaw\nEmberfang\nGoldcollar"}
          disabled={tournament.status !== "registration"}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={markPaid}
            onChange={(e) => setMarkPaid(e.target.checked)}
            className="size-4 accent-primary"
          />
          Mark imported as paid
        </label>
        <Button type="submit" disabled={busy || tournament.status !== "registration"}>
          {busy ? "Importing…" : "Add to roster"}
        </Button>
      </form>
    </div>
  );
}

function GenerateBar({ onGenerated }: { onGenerated: () => Promise<void> }) {
  const { tournament, entries } = Route.useLoaderData();
  const [shuffle, setShuffle] = useState(false);
  const [busy, setBusy] = useState(false);
  const paid = entries.filter((e) => e.paid).length;

  async function go() {
    setBusy(true);
    try {
      await generateBracket({ data: { slug: tournament.slug, shuffle } });
      toast.success("Bracket locked from the paid list");
      await onGenerated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface/85 p-4 shadow-[var(--shadow-border)] sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-display tracking-wide">Import paid list to bracket</p>
        <p className="text-sm text-muted">
          {paid} paid · {FORMAT_LABEL[tournament.format]} · minimum 4
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex h-11 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={shuffle}
            onChange={(e) => setShuffle(e.target.checked)}
            className="size-4 accent-primary"
          />
          Randomize seeds
        </label>
        <Button onClick={go} disabled={busy || paid < 4}>
          <Swords className="size-4" />
          {busy ? "Seeding…" : "Generate bracket"}
        </Button>
      </div>
    </div>
  );
}

function StandingsTable({
  standings,
}: {
  standings: {
    entryId: number;
    handle: string;
    wins: number;
    losses: number;
    points: number;
    buchholz: number;
    mapDiff: number;
  }[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-surface/85 shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-[11px] tracking-wide text-subtle uppercase">
          <tr>
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-2 py-3 font-medium">Handle</th>
            <th className="px-2 py-3 font-medium tabular-nums">W</th>
            <th className="px-2 py-3 font-medium tabular-nums">L</th>
            <th className="px-2 py-3 font-medium tabular-nums">Pts</th>
            <th className="px-2 py-3 font-medium tabular-nums">Buchholz</th>
            <th className="px-4 py-3 font-medium tabular-nums">+/-</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr key={s.entryId} className="border-t border-border/40">
              <td className="px-4 py-2 tabular-nums text-subtle">{i + 1}</td>
              <td className="px-2 py-2">{s.handle}</td>
              <td className="px-2 py-2 tabular-nums">{s.wins}</td>
              <td className="px-2 py-2 tabular-nums">{s.losses}</td>
              <td className="px-2 py-2 tabular-nums">{s.points}</td>
              <td className="px-2 py-2 tabular-nums">{s.buchholz}</td>
              <td className="px-4 py-2 tabular-nums">{s.mapDiff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
