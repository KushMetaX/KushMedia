# DDL TCG listed-price feed

Drop this folder on KushMedia so the evaluator's existing DDL TCG tab stops saying the market is offline.

The page already requests:

- `GET /api/ddl-market/cards`
- `GET /api/ddl-market/card/V023`

Both 404 today. This folder is that API.

## Install

1. Upload this folder to **one** of:
   - `public/api/ddl-market/`
   - `public/dd-evaluator/ddl-market/`
2. Confirm `https://kushmedia.xyz/api/ddl-market/cards` returns JSON, not "Not found."
3. Hard-refresh `https://kushmedia.xyz/dd-evaluator/#ddl-tcg`.

No change to `ddl-tcg.js` is required. LiteSpeed will use the included `.htaccess`.

## How a price is chosen

- Sold single-card comps: median, badged **Sold**.
- Active single-card asks: book = 85% of the lowest ask, badged **Asks**. Lowest ask is still shown.
- No single-card listing: pack-math placeholder, badged **Estimate**. Lots are ignored so a 5-card lot cannot set five prices.
- Official box price in `listings.csv` (`BOX`) feeds the booster-box tile. Pack tile is box / 24 until a pack listing exists.

## Refresh

Edit `listings.csv`, then:

```bash
node build-market.cjs
```

To pull eBay itself, create a Finding API app id at developer.ebay.com and run:

```bash
EBAY_APP_ID=YourAppId node build-market.cjs
```

Cron that every 6 hours. The page badges the feed as live only when that pull succeeds (`sources.browse.ok`).

CSV columns: `id,print,status,usd,title,url,at,grade,note`

- `id` is `V023` or `BOX` / `PACK`
- `print` is `base`, `holo`, or `fa`
- `status` is `ask` or `sold`
- `grade` is `raw` or `PSA 10`

## Seed in this build

Verified public single-card asks only:

- Hunter V023 full art, $125 ask (eBay 407268741866, 2026-10-06)
- Penny V063 full art, $100 ask (eBay 407268614874, 2026-10-06)
- Booster box, $179 official shop, sold out

Everything else is an Estimate until a real single-card row lands in the CSV or the eBay pull.
