# Paste this into Cursor Agent (Grok 4.6) after unzipping this repo

You are extending **this existing TanStack Start app**. Do not rewrite to Next.js.
Do not restyle from scratch. Do not drop the flame wallpaper, crest, or Cinzel lockup.

## Goal
Add **multi-crypto entry fees** with **live USD quotes**.

Supported coins: **DOGE** and **SOL**.

## Product rules
1. When creating a tournament, organizer picks accepted crypto: DOGE or SOL.
2. Organizer sets the fee as a **USD value** (primary) — e.g. `$5.00`.
3. App **automatically fetches the live USD price** of the selected coin and shows:
   - `1 DOGE = $0.12` / `1 SOL = $142.50` (example numbers — use live)
   - `You charge $5.00 ≈ 41.67 DOGE` (recalc when ticker or USD amount changes)
4. Invoice is **frozen at mint time**: store `amount_crypto`, `amount_usd`, `spot_usd`, `crypto`.
   Player pays the quoted crypto amount even if the ticker moves later.
5. Roster, prize pot, and tournament cards show **crypto amount + USD**.
6. Prize pot = sum of paid `amount_crypto` in the tournament’s coin, plus live USD equivalent.
7. Keep simulated payments (this is a demo). Button label: `Simulate {DOGE|SOL} payment`.
8. Fee of $0 / 0 crypto still auto-pays.

## Live price
Server-side helper, cache ~20 seconds:

```
GET https://api.coingecko.com/api/v3/simple/price?ids=dogecoin,solana&vs_currencies=usd
```

Map: DOGE → `dogecoin`, SOL → `solana`.
Fallback to last good price. Never hang the UI — show last quote + “stale” if the fetch fails.
Poll the create form and invoice view every 30s.

## Schema changes (additive)
On `tournaments`:
- `crypto` text not null default 'DOGE'   -- 'DOGE' | 'SOL'
- `entry_fee_usd` numeric(12,2) not null default 0
- `price_usd_at_create` numeric(18,8)

Rename conceptually: `entry_fee_doge` becomes `entry_fee_crypto` (or keep the column and
treat it as native amount for whichever `crypto` is set — migrate existing rows to DOGE).

On `entries`:
- `amount_crypto` (use existing `amount_doge` or rename)
- `amount_usd`
- `spot_usd`
- `crypto` (inherit from tournament at mint)

Demo treasuries:
- DOGE: keep current `makeTreasury` (D… style demo address)
- SOL: base58-looking demo address, clearly labeled DEMO

## UI
Create form:
- Two coin toggle cards (DOGE / SOL) with live $/coin
- USD fee input is primary; show converted native amount live
- Native amount as a secondary editable field that back-solves USD is nice-to-have

Invoice card:
- Coin name + frozen quote
- Live ticker underneath: “Spot now $X (invoice locked at $Y)”
- Copy demo treasury

Home cards and roster: `25.00 DOGE · $3.12` (or SOL).

## Do not break
- Bracket generation / winner advancement (`src/lib/bracket.ts`, `insertDrafts` idMap + Number())
- Mobile inner-scroll on brackets (`overflow-x-auto` + `w-max`)
- Flame background (`/flames.jpg`) and crest (`/crest.jpg`)
- Demo seed tournaments
- Auth stays off

Typecheck must pass. Keep Cinzel / Figtree / burnt-gold theme.
