# Cursor / Grok 4.6 — add ONLY the IRL video table

You are editing an existing Doginal Dogs Legends tournament app (brackets, crypto entry fees, DOGE/SOL). The user unzipped `ddl-irl-table` next to (or inside) the repo.

## Goal

Add a two-player **verified IRL table**: WebRTC hand cams, on-device MediaPipe hand lock, synced 40 HP / 10 mana HUD. For paper tournaments at ddltcg.com.

## Hard rules — do not break the current app

DO NOT modify, rewrite, or “clean up”:

- Tournament create / list / brackets / seeding / Swiss / elim
- Crypto invoices, DOGE, SOL, USD quotes, entry lists
- Auth, theme, Tailwind tokens, existing CSS
- `reportScore` internals, database tables except the two `webrtc_*` tables below
- Any file outside the allow-list

If a file already exists at a destination path, **skip it** and adapt imports instead of overwriting.

## Allow-list (add these)

1. Copy the folder `src/irl-table/` from this pack to `src/irl-table/` in the app. Keep the `@/irl-table/...` imports.
2. If `src/routes/api/rtc.ts` does **not** exist, copy `examples/api.rtc.ts` there.
3. If using TanStack Start file routes, copy `examples/hearth.$slug.$matchId.tsx` to `src/routes/hearth.$slug.$matchId.tsx`. Fix `getTournament` / `reportScore` import paths to match THIS repo. If those functions have different names, map them — do not invent a second scoring system.
4. On the existing match card UI, add **only** a `Table` link (see `examples/table-link-snippet.tsx`) when the match already has two players. Do not restyle the card.
5. `npm install @mediapipe/tasks-vision`
6. Run `scripts/vendor-mediapipe.sh <app-root>` so `public/mediapipe/wasm` and `public/mediapipe/hand_landmarker.task` exist.

## IrlTable API (do not couple it to invoices)

```tsx
<IrlTable
  tableId={match.id}
  eventName={tournament.name}
  backHref={`/t/${tournament.slug}`}
  player1={p1 ? { id: p1.id, handle: p1.handle } : null}
  player2={p2 ? { id: p2.id, handle: p2.handle } : null}
  matchOpen={match.status === "ready"}
  matchComplete={match.status === "complete"}
  onWinner={optionalCallbackThatCallsExistingReportScore}
/>
```

If you omit `onWinner`, winner buttons do not render and scoring is untouched.

## Signaling

`handleSignaling` uses the app’s existing `getSql` from `@/lib/db`. It only `CREATE TABLE IF NOT EXISTS webrtc_peers` and `webrtc_signals`. Do not migrate or drop other tables.

If this app is **not** TanStack Start, mount the same `handleSignaling(request)` on `GET`+`POST` `/api/rtc` using the host framework. Client already posts to `/api/rtc`.

If `@/components/ui/button` or `sonner` or `@/lib/utils` `cn` live elsewhere, change **only those import paths** inside `src/irl-table/`.

## Done when

- Existing bracket + payment flows work unchanged
- Opening a match **Table** shows seat picker → two hand cams → HP/mana HUD
- Two browsers on the same table URL can see each other’s camera
- `Verified live` appears only when both feeds have a tracked hand
- Typecheck passes

Do not add card OCR, illegal-move detection, or extra pages.
