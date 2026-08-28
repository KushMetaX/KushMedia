import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Coins, Swords, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { FORMAT_LABEL } from "@/lib/constants";
import { listTournaments } from "@/lib/tournaments";
import { asset } from "@/lib/utils";

export const Route = createFileRoute("/")({
  loader: () => listTournaments(),
  component: Home,
});

function Home() {
  const arenas = Route.useLoaderData();

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-14 pb-16 text-center sm:pt-20 sm:pb-24">
          <img
            src={asset("crest.jpg")}
            alt=""
            className="mb-6 size-24 rounded-full object-cover shadow-[var(--shadow-border)] sm:size-28"
          />
          <p className="font-display text-[11px] tracking-[0.42em] text-primary uppercase">
            Doginal Dogs Legends
          </p>
          <h1 className="font-display mt-3 max-w-xl text-4xl leading-[1.1] tracking-[0.12em] text-fg uppercase sm:text-6xl">
            Legends Bracket
          </h1>
          <p className="mt-4 max-w-lg text-base text-muted sm:text-lg">
            Host a pack tournament. Collect DOGE entry fees, lock the paid roster, then run
            single-elim, double-elim, Swiss, or round robin — Challonge-style.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/create">
                Host an arena
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#arenas">Browse arenas</a>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 pb-12 sm:grid-cols-3">
        {[
          {
            icon: Coins,
            title: "DOGE entry",
            body: "Each seat mints an invoice. Confirm payment and the handle joins the paid list.",
          },
          {
            icon: Users,
            title: "Paid roster",
            body: "See who is in. Import only confirmed entries when you lock the bracket.",
          },
          {
            icon: Swords,
            title: "Live brackets",
            body: "Report scores, advance winners, crown a champion. Four elimination styles.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-xl bg-surface/80 p-5 shadow-[var(--shadow-border)]"
          >
            <item.icon className="size-5 text-primary" />
            <h2 className="font-display mt-3 text-base tracking-wide">{item.title}</h2>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
          </div>
        ))}
      </section>

      <section id="arenas" className="mx-auto max-w-6xl px-4 pb-20">
        <div className="mb-5 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl tracking-wide">Open hearths</h2>
          <p className="text-sm text-subtle">{arenas.length} arenas</p>
        </div>
        {arenas.length === 0 ? (
          <p className="text-muted">No arenas yet. Host the first.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {arenas.map((t) => (
              <li key={t.id}>
                <Link
                  to="/t/$slug"
                  params={{ slug: t.slug }}
                  className="block rounded-xl bg-surface/85 p-5 shadow-[var(--shadow-border)] transition-shadow duration-150 hover:shadow-[var(--shadow-border-hover)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg leading-snug tracking-wide">{t.name}</h3>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted">{FORMAT_LABEL[t.format]}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] tracking-wide text-subtle uppercase">Paid</dt>
                      <dd className="tabular-nums">
                        {t.paidCount}
                        <span className="text-subtle">/{t.maxPlayers}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wide text-subtle uppercase">Fee</dt>
                      <dd className="tabular-nums">{t.entryFeeDoge} DOGE</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wide text-subtle uppercase">Pot</dt>
                      <dd className="tabular-nums">{t.prizePool} DOGE</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
