# voyager-scraper

POI scraper for **NovaScotiaVoyage**. Pulls open tourism data from
public, well-licensed sources and emits a Voyager-shaped JSON file
that the front-end merges underneath the hand-curated 134 POIs in
`map/pois.js`.

Designed to be **region-agnostic** — adding PEI / New Brunswick / Maine /
anywhere is a one-file change in `config/regions.mjs`.

> **Licensing:** Output includes data © **OpenStreetMap contributors**,
> available under the **Open Database License (ODbL 1.0)**. The map UI
> already renders Mapbox + OSM attribution. Keep that in place when you
> redistribute the JSON.

---

## Quick start

```bash
cd _tools/voyager-scraper

# Scrape Nova Scotia (default)
node scrape.mjs

# Specific region
node scrape.mjs --region nova-scotia

# Every region you've configured
node scrape.mjs --all

# Bypass the on-disk cache (force a fresh Overpass round-trip)
node scrape.mjs --no-cache

# Re-process every subregion even if the catalog says it's still fresh
node scrape.mjs --force

# Only reuse subregions scraped in the last 30 days (default is 14)
node scrape.mjs --max-age 30

# Preview first 5 normalised records without writing files
node scrape.mjs --dry-run
```

Output:

| File | What |
| --- | --- |
| `data/out/pois-discovered.json` | Canonical merged set — served by `/api/voyager/pois` |
| `data/out/pois-discovered.<region>.json` | Per-region split (handy for diff review) |
| `data/out/stats.json` | Counts per region/category, dupe count, fetch timestamp |
| `data/out/catalog.json` | Scrape catalog — when each subregion was last scraped (drives reuse) |
| `data/raw/overpass-<hash>.json` | Cached Overpass response per bbox (delete to refetch) |

### Incremental re-runs (the catalog)

Every run used to rebuild everything from scratch — query Overpass for all
seven Nova Scotia subregions (or read their bbox cache), then re-normalise and
re-dedupe the whole set. That's wasteful on the public Overpass servers and on
your CPU when nothing has changed.

The **scrape catalog** (`data/out/catalog.json`) records when each subregion was
last scraped and how many POIs it produced. On the next run, any subregion still
within `--max-age` days (default **14**) is **skipped entirely** — its POIs are
reused from `data/out/pois-discovered.json` instead of being re-fetched and
re-processed. The run log shows `reused N POIs … skipping Overpass` for those.

- `--max-age <days>` — change the reuse window (e.g. `0` to disable reuse).
- `--force` — ignore the catalog and re-scrape every subregion.
- `--no-cache` — implies `--force` *and* bypasses the raw Overpass cache.

So a weekly cron job only pays the Overpass cost for subregions that have
actually aged out, and a same-day re-run does almost no work.

After running, **restart the Node app** (or just hit `/api/voyager/pois`
once) — the front-end picks the new file up automatically and merges
into the live map.

---

## How the merge works

1. **Curated POIs (`map/pois.js`)** are authoritative. They have real
   ratings, hidden-gem flags, and tested booking links.
2. **Discovered POIs (this scraper's output)** are pulled from
   OpenStreetMap, normalised, and **filtered against curated names** so
   you never see two records of "Peggy's Cove Lighthouse".
3. The browser fetches both, dedupes again client-side (id + name+region
   match), then renders. Curated always wins ties.

This means you can **edit `map/pois.js` whenever you want** and the
scraped layer adjusts around it. No data fights.

---

## Architecture

```
_tools/voyager-scraper/
├─ scrape.mjs               # CLI — orchestrates everything
├─ config/
│  ├─ regions.mjs           # WHERE to look (bbox + subregions)
│  └─ categories.mjs        # WHICH OSM tags map to which Voyager category
├─ sources/
│  └─ overpass.mjs          # Overpass API client (cached, polite, multi-mirror)
├─ pipeline/
│  ├─ normalize.mjs         # Raw OSM element → Voyager POI
│  ├─ dedupe.mjs            # Merge near-duplicates within ~80 m
│  └─ catalog.mjs           # Per-subregion "last scraped" manifest → skip fresh ones
└─ data/
   ├─ raw/                  # Per-bbox Overpass response cache (gitignored)
   └─ out/                  # Final JSON output + catalog.json (gitignored)
```

Six short, focused files. The pipeline is a one-way conveyor
(`fetch → normalize → resolve region → dedupe → write`) so adding a new
source never tangles the existing flow.

---

## Adding a new region (e.g. PEI)

Edit `config/regions.mjs`:

```js
export const REGIONS = {
  // ...existing entries...
  "prince-edward-island": {
    id: "prince-edward-island",
    name: "Prince Edward Island",
    country: "Canada",
    bbox: [45.95, -64.45, 47.07, -61.97],
    subregions: [
      { id: "pei-charlottetown", name: "Charlottetown & Central", bbox: [46.0, -63.5, 46.4, -62.8] },
      { id: "pei-north-shore",   name: "North Shore",             bbox: [46.4, -63.9, 46.8, -62.3] },
      { id: "pei-east",          name: "Points East",             bbox: [45.95, -62.8, 46.5, -61.97] },
      { id: "pei-west",          name: "Red Sands & Western",     bbox: [45.95, -64.45, 46.7, -63.5] }
    ]
  }
};
```

Then mirror those subregion ids (with colours, polygons, taglines) in
`map/data.js` so the front-end colour-codes the new polygons. After
that:

```bash
node scrape.mjs --region prince-edward-island
```

…and the new POIs land on the same map.

> Use [bboxfinder.com](http://bboxfinder.com) to get bbox coordinates.
> Click **CSV (lat,lng)** then convert to `[south, west, north, east]`.

---

## Adding a new source

Right now we use Overpass only. Suggested next sources, in priority
order:

| Source | What it adds | Effort | Notes |
| --- | --- | --- | --- |
| **Wikidata SPARQL** | Long-form descriptions, official sites, social handles | Low | Use `wikidata` tag from OSM as the join key — most named POIs already carry it |
| **Tourism Nova Scotia open data** | Curated provincial inventory | Medium | CSV/JSON from data.novascotia.ca; format varies, manual schema mapping |
| **Mapbox Geocoding** | Address normalisation, missing coords | Low | We already have a token (`MAPBOX_ACCESS_TOKEN`) |
| **Nominatim** | Reverse-geocode region names without bbox | Low | Free, OSM-hosted; rate-limited (1 req/s) |

Pattern for a new source: add `sources/<name>.mjs` exporting an async
`fetch<Name>(bbox)` that returns an array of records. Then add a
matching normalize step in `pipeline/normalize.mjs` (or its own file).
Finally call it from `scrape.mjs` after Overpass and feed its records
into the same `dedupe()` call.

**Wikidata SPARQL template** (drop into `sources/wikidata.mjs` later):

```js
export async function fetchWikidata(bbox) {
  const [s, w, n, e] = bbox;
  const query = `
    SELECT ?item ?itemLabel ?coord ?website ?desc WHERE {
      SERVICE wikibase:box {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
      }
      ?item wdt:P31/wdt:P279* wd:Q570116 .   # tourist attraction
      OPTIONAL { ?item wdt:P856 ?website. }
      OPTIONAL { ?item schema:description ?desc FILTER (lang(?desc) = "en"). }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 500`;
  // POST to https://query.wikidata.org/sparql with Accept: application/sparql-results+json
}
```

---

## Anti-scraping ethics

- **What we DO scrape:** OpenStreetMap (ODbL), Wikidata (CC0), provincial
  open data portals.
- **What we DON'T scrape:** TripAdvisor, Yelp, Google Maps, Booking.com.
  Their TOS forbid it and their data is their business model. If we want
  ratings, we either compute our own or partner.
- **Politeness:** the Overpass client has a 90-second timeout, retries
  three mirrors, sets a real `User-Agent`, and caches every response on
  disk so re-runs don't hit the public servers. On top of that, the
  **scrape catalog** skips subregions scraped within `--max-age` days, so a
  re-run typically makes **zero** Overpass calls. Don't disable the cache
  or use `--force` for casual development work.

---

## Running on the live server

The Express endpoint that serves the scraped JSON is **gated by the same
`VOYAGER_PASSWORD`** as the rest of `/map`. So:

1. SSH to the host (or use cPanel Terminal).
2. `cd ~/public_html/_tools/voyager-scraper && node scrape.mjs`
3. Touch the Node app to make it pick up the new file (cPanel → Setup
   Node.js App → Restart). Most clients will fetch fresh JSON anyway —
   we set `Cache-Control: no-store` on `/api/voyager/pois`.

You can run it as a cron job too (e.g. weekly) once you're happy with
the output.

---

## Roadmap (deliberately not built yet)

These are the obvious next moves once the scraper is paying its way:

### 1. Itinerary builder — "Planner" tab

The Planner tab currently shows a Coming Soon stub. The minimum viable
build is:

- **Day-by-day timeline UI** (3-day default, drag-to-extend).
- **POI bag**: drag from Discover/Map into a day slot. Persist in
  `localStorage` initially; later, sync to a Supabase table so users can
  share itineraries across devices.
- **Auto-routing**: use Mapbox Directions API (already keyed) to fill in
  travel-time between adjacent POIs. Show drive vs ferry vs walk.
- **Budget estimator**: sum of `priceRange` × travelers.
- **Export**: print-friendly HTML + ICS calendar export.

A clean shape for a saved itinerary:

```jsonc
{
  "id": "itin-2026-09-cape-breton",
  "title": "Cape Breton long weekend",
  "createdAt": "2026-09-12T01:14Z",
  "travelers": 2,
  "days": [
    { "date": "2026-09-19", "stops": [
        { "poiId": "skyline-trail",   "start": "09:00", "duration": "PT3H" },
        { "poiId": "cabot-trail",     "start": "13:00", "duration": "PT5H" }
      ]
    }
  ]
}
```

### 2. Cross-region rollout playbook

Pick the next region, then for each one:

1. Add bbox + subregions to `config/regions.mjs`.
2. Add the matching polygon + colour to `map/data.js`.
3. `node scrape.mjs --region <id>`.
4. Spot-check 10 random POIs (do they have real websites? Decent
   names?). Tune `config/categories.mjs` if a class of POIs is leaking
   in or being filtered out.
5. Promote a handful of standouts into the curated set in
   `map/pois.js` — those become your editorial picks for the region.

### 3. Quality signals (post-MVP)

- **Wikidata enrichment** — adds long-form descriptions and the
  Instagram / Facebook / website handles that OSM lacks.
- **Image fetching** — Wikipedia REST API gives a `thumbnail` URL for
  any wikidata-linked POI. Free, ToS-compliant, much nicer cards.
- **Trail integration** — `route=hiking` relations in OSM become
  multi-stop hike "experiences".
- **Heatmap re-derivation** — the static `heatClusterCenters` in
  `map/data.js` should be auto-generated from the live POI density.
