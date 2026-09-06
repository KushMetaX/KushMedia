/**
 * Optional TanStack Start route that mounts the IRL table on a bracket match.
 * Copy to src/routes/hearth.$slug.$matchId.tsx
 *
 * Winner lock calls YOUR existing reportScore. If you omit onWinner, the
 * table is video-only and never writes scores.
 */
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { IrlTable } from "@/irl-table";
import { getTournament, reportScore } from "@/lib/tournaments";

export const Route = createFileRoute("/hearth/$slug/$matchId")({
  loader: async ({ params }) => {
    const data = await getTournament({ data: { slug: params.slug } });
    const matchId = Number(params.matchId);
    const match = data.matches.find((m) => m.id === matchId);
    if (!match) throw notFound();
    const p1 = data.entries.find((e) => e.id === match.entry1Id) ?? null;
    const p2 = data.entries.find((e) => e.id === match.entry2Id) ?? null;
    return { ...data, match, p1, p2 };
  },
  component: HearthPage,
});

function HearthPage() {
  const router = useRouter();
  const { tournament, match, p1, p2 } = Route.useLoaderData();

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8">
      <IrlTable
        tableId={match.id}
        eventName={tournament.name}
        backHref={`/t/${tournament.slug}`}
        player1={p1 ? { id: p1.id, handle: p1.handle } : null}
        player2={p2 ? { id: p2.id, handle: p2.handle } : null}
        matchOpen={match.status === "ready"}
        matchComplete={match.status === "complete"}
        onWinner={async (winner) => {
          if (!p1 || !p2) return;
          const s1 = winner.id === p1.id ? 1 : 0;
          const s2 = winner.id === p2.id ? 1 : 0;
          await reportScore({
            data: { matchId: match.id, score1: s1, score2: s2, winnerId: Number(winner.id) },
          });
          await router.invalidate();
        }}
      />
      <p className="mt-8 text-center text-xs text-subtle">
        <Link to="/t/$slug" params={{ slug: tournament.slug }} className="hover:text-fg">
          Back to bracket
        </Link>
      </p>
    </main>
  );
}
