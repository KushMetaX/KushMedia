/**
 * Scrape catalog — a manifest of what each subregion last produced.
 *
 * The scraper used to rebuild everything from scratch on every run: hit
 * Overpass (or read its bbox cache) for all subregions, re-normalize, re-dedupe
 * and overwrite the output — even when nothing had changed. That is wasteful on
 * the public Overpass servers and on local CPU.
 *
 * This catalog records, per subregion, *when* it was last scraped and how many
 * raw elements / POIs it produced. On a re-run, any subregion that is still
 * "fresh" (scraped within `--max-age` days) is skipped entirely: its POIs are
 * reused from the existing `pois-discovered.json` instead of being re-fetched
 * and re-processed.
 *
 * Stored at `data/out/catalog.json`:
 * {
 *   "version": 1,
 *   "updatedAt": "2026-06-15T…",
 *   "subregions": {
 *     "halifax-metro": {
 *       "macroRegionId": "nova-scotia",
 *       "name": "Halifax & Central",
 *       "bbox": [44.35, -64.05, 45.05, -62.85],
 *       "lastScrapedAt": "2026-06-15T…",
 *       "rawElements": 1234,
 *       "keptPois": 567
 *     }
 *   }
 * }
 */
import fs from "node:fs/promises";
import path from "node:path";

export const CATALOG_VERSION = 1;

function catalogFile() {
  return path.resolve("data", "out", "catalog.json");
}

/** Load the catalog, or return an empty one if it does not exist yet. */
export async function loadCatalog() {
  try {
    const raw = await fs.readFile(catalogFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.subregions) {
      return parsed;
    }
  } catch (_e) { /* missing / unreadable → start fresh */ }
  return { version: CATALOG_VERSION, updatedAt: null, subregions: {} };
}

/** Persist the catalog to disk. Returns the absolute path written. */
export async function saveCatalog(catalog) {
  catalog.version = CATALOG_VERSION;
  catalog.updatedAt = new Date().toISOString();
  const file = catalogFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(catalog, null, 2));
  return file;
}

/** Age of an ISO timestamp in (fractional) days. Missing/invalid → Infinity. */
export function ageInDays(iso) {
  if (!iso) return Infinity;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 86_400_000;
}

/** True when the subregion was scraped within `maxAgeDays`. */
export function isFresh(catalog, subId, maxAgeDays) {
  const entry = catalog.subregions[subId];
  if (!entry || !entry.lastScrapedAt) return false;
  return ageInDays(entry.lastScrapedAt) <= maxAgeDays;
}

/** Record (or update) what a subregion produced on this run. */
export function recordSubregion(catalog, sub, macroRegionId, { rawElements, keptPois }) {
  catalog.subregions[sub.id] = {
    macroRegionId,
    name: sub.name,
    bbox: sub.bbox,
    lastScrapedAt: new Date().toISOString(),
    rawElements,
    keptPois
  };
}
