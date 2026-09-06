# DDL IRL table — drop-in for Cursor

Verified two-player video table for **Doginal Dogs Legends** paper matches (ddltcg.com).

This pack is **only** the table: WebRTC hand cams, MediaPipe hand lock, 40 HP / 10 mana HUD. It does not include brackets, crypto, or entry lists.

## Upload into Cursor

1. Unzip this file.
2. Open **your existing tournament repo** in Cursor (not this pack as a new project).
3. Drop the unzipped folder into the chat, or paste **`CURSOR_PROMPT.md`** and attach `src/irl-table`.
4. Tell Grok 4.6: *follow CURSOR_PROMPT.md, add files only, do not rewrite my app.*

## What gets added

| Path | Role |
|---|---|
| `src/irl-table/` | Isolated module. Safe to delete later. |
| `src/routes/api/rtc.ts` | Signaling only if you do not already have it |
| `src/routes/hearth.$slug.$matchId.tsx` | Table page (optional) |
| One `Table` link on match cards | Entry point |
| `public/mediapipe/` | On-device hand model (after the vendor script) |

## What is not touched

Brackets, seeding, DOGE/SOL invoices, USD quotes, paid entry lists, auth, theme.

Winner buttons call **your** `onWinner` callback. If you skip it, the table never writes a score.

## Official DDL HUD

- Start life **40**
- Mana cap **10**
- Unspent mana does not carry (players tap mana themselves)

Hand tracking cannot auto-count illegal plays or card effects. That needs a card catalog.
