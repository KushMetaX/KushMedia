import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FORMAT_BLURB, FORMAT_LABEL, FORMATS, type Format } from "@/lib/constants";
import { createTournament } from "@/lib/tournaments";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create")({
  component: CreatePage,
});

function CreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<Format>("single_elim");
  const [fee, setFee] = useState("25");
  const [maxPlayers, setMaxPlayers] = useState("16");
  const [swissRounds, setSwissRounds] = useState("4");
  const [hostPassword, setHostPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await createTournament({
        data: {
          name,
          description,
          format,
          entryFeeDoge: Number(fee),
          maxPlayers: Number(maxPlayers),
          swissRounds: format === "swiss" ? Number(swissRounds) : undefined,
          hostPassword,
        },
      });
      await navigate({ to: "/t/$slug", params: { slug: t.slug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create arena");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="font-display text-[11px] tracking-[0.32em] text-primary uppercase">
        Host
      </p>
      <h1 className="font-display mt-2 text-3xl tracking-wide">Create an arena</h1>
      <p className="mt-2 text-sm text-muted">
        Set the format and DOGE fee. Players pay in, you import the paid list to a bracket.
        Opening an arena requires the host password from Node (<code className="text-fg">TOURNEY_PASSWORD</code>).
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="host-password">Host password</Label>
          <Input
            id="host-password"
            type="password"
            required
            autoComplete="current-password"
            value={hostPassword}
            onChange={(e) => setHostPassword(e.target.value)}
            placeholder="Node TOURNEY_PASSWORD"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">Arena name</Label>
          <Input
            id="name"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rise of the Pack Open"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desc">Brief</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bo3, paper or digital, winner takes the pot."
            maxLength={400}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium tracking-wide text-muted">Format</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <label
                key={f}
                className={cn(
                  "cursor-pointer rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]",
                  format === f && "shadow-[var(--shadow-border-hover)] bg-raised",
                )}
              >
                <input
                  type="radio"
                  name="format"
                  className="sr-only"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                />
                <span className="block text-sm font-medium text-fg">{FORMAT_LABEL[f]}</span>
                <span className="mt-1 block text-xs text-muted">{FORMAT_BLURB[f]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fee">Entry fee (DOGE)</Label>
            <Input
              id="fee"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max">Max pack</Label>
            <Input
              id="max"
              inputMode="numeric"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>

        {format === "swiss" ? (
          <div className="space-y-1.5">
            <Label htmlFor="sw">Swiss rounds</Label>
            <Input
              id="sw"
              inputMode="numeric"
              value={swissRounds}
              onChange={(e) => setSwissRounds(e.target.value)}
              className="tabular-nums"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Opening hearth…" : "Open registration"}
        </Button>
      </form>
    </main>
  );
}
