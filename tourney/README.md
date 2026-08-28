# Legends Bracket

Challonge-style tournament arena for **Doginal Dogs Legends**.

Flame wallpaper + crest lockup, DOGE entry invoices, paid roster, then import into
single-elim, double-elim, Swiss, or round robin. Report scores and winners advance.

This is a working TanStack Start app (Vite + React + PGLite). **Do not rewrite it to Next.js.**

## Run in Cursor

```bash
cd tourney
npm install
npm run dev
```

Open [http://localhost:8080/tourney/](http://localhost:8080/tourney/) or the KushMedia site at `/tourney/`.

- Node 22+ recommended
- No Postgres required — embedded PGLite boots from `migrations/`
- Optional later: set `DATABASE_URL` to a real Postgres (see `.env.example`)

## What’s in the box

| Path | What it is |
|---|---|
| `public/flames.jpg` | Full-viewport art-deco flame wallpaper (also in `graphics/`) |
| `public/crest.jpg` | Circular bronze dog-in-flame crest |
| `public/og.jpg` | Open-graph card |
| `public/favicon.svg` | Favicon |
| `src/routes/` | Pages: home, create, tournament (`/t/$slug`) |
| `src/lib/bracket.ts` | Seeding, single/double elim, Swiss, round robin |
| `src/lib/tournaments.ts` | Server functions: create, pay, generate, report |
| `src/components/bracket-view.tsx` | Challonge-style columns + standings |
| `src/components/invoice-seal.tsx` | Geometric invoice seal |
| `src/styles.css` | Cinzel / Figtree / IBM Plex Mono + burnt-gold tokens |
| `migrations/0002_schema.sql` | tournaments, entries, matches |

## How to use the app

1. Home → **Host an arena** (or open a seeded demo like *Rise of the Pack Open*)
2. Set format + DOGE fee + max pack
3. Players **Enter** with a handle → unique invoice `DDL-…` → **Simulate DOGE payment**
4. **Roster** shows paid vs awaiting
5. **Import paid list to bracket** (min 4 paid)
6. Click a ready match → enter scores → winner seats in the next round

Demo arenas seed automatically when the database is empty.

## Stack (keep it)

- TanStack Start + React Router + TanStack Query
- Tailwind v4 (`src/styles.css` `@theme`)
- Server functions via `createServerFn`
- PGLite in-memory Postgres (or Neon/Postgres when `DATABASE_URL` is set)
- Zod validators on mutations

Auth is **off** (`VITE_AUTH_ENABLED=false` in `.grok/app-env.json`). Handles only — no emails.

## Next features (DOGE + SOL + live USD)

Open `CURSOR-NEXT.md` and paste that prompt into Cursor Agent (Grok 4.6) **on this repo**.
It extends this code. It does not start over.
