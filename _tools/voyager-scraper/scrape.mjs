#!/usr/bin/env node
/**
 * Voyager scraper CLI.
 *
 *   node scrape.mjs                          # default: --region nova-scotia
 *   node scrape.mjs --region nova-scotia
 *   node scrape.mjs --all                    # every region in config/regions.mjs
 *   node scrape.mjs --region nova-scotia --no-cache
 *   node scrape.mjs --region nova-scotia --dry-run
 *   node scrape.mjs --region nova-scotia --include-curated   # don't filter dupes against map/pois.js
 *
 * Output:
 *   data/out/pois-discovered.json          (canonical, used by the server)
 *   data/out/pois-discovered.<region>.json (per-region split)
 *   data/out/stats.json                    (counts per region/category)
 */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import { REGIONS, resolveRegionId } from "./config/regions.mjs";
import { fetchOverpass } from "./sources/overpass.mjs";
import { osmElementToPoi } from "./pipeline/normalize.mjs";
import { dedupe } from "./pipeline/dedupe.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
process.chdir(HERE);

const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) { printHelp(); process.exit(0); }

const targetRegions = ARGS.all
  ? Object.keys(REGIONS)
  : [ARGS.region || "nova-scotia"];

for (const r of targetRegions) {
  if (!REGIONS[r]) {
    console.error(`Unknown region "${r}". Known: ${Object.keys(REGIONS).join(", ")}`);
    process.exit(1);
  }
}

const log = (...m) => console.log(...m);
log(`voyager-scraper ${pkgVersion()} — regions: ${targetRegions.join(", ")}`);

const allPois = [];
const stats = { byRegion: {}, byCategory: {}, totalRaw: 0, totalKept: 0, totalDropped: 0 };

for (const macroRegionId of targetRegions) {
  const macro = REGIONS[macroRegionId];
  // Overpass times out on huge bbox + many filters, so fetch per-subregion.
  // This also makes regionId assignment deterministic (the queried bbox IS
  // the regionId) and gives us per-subregion caching.
  const subregions = Array.isArray(macro.subregions) && macro.subregions.length
    ? macro.subregions
    : [{ id: macroRegionId, name: macro.name, bbox: macro.bbox }];

  log(`\n[${macroRegionId}] ${subregions.length} subregion${subregions.length === 1 ? "" : "s"}`);
  stats.byRegion[macroRegionId] = { raw: 0, kept: 0, dropped: 0, subregions: {} };

  for (const sub of subregions) {
    log(`  → ${sub.id} bbox=${sub.bbox.join(",")}`);
    let elements = [];
    try {
      elements = await fetchOverpass(sub.bbox, { noCache: ARGS.noCache, verbose: true });
    } catch (err) {
      console.error(`    overpass failed for ${sub.id}: ${err.message}`);
      continue;
    }
    stats.totalRaw += elements.length;
    stats.byRegion[macroRegionId].raw += elements.length;

    let kept = 0;
    let dropped = 0;
    for (const el of elements) {
      const poi = osmElementToPoi(el);
      if (!poi) { dropped++; continue; }
      // Bbox-based region id — point may be on the edge of multiple subregion
      // bboxes; prefer the subregion we just queried, but fall back to the
      // resolver if the point sits outside (rare with rectangular bboxes).
      const resolved = resolveRegionId(poi.coordinates[0], poi.coordinates[1], macroRegionId);
      poi.regionId = resolved || sub.id;
      poi.macroRegionId = macroRegionId;
      allPois.push(poi);
      kept++;
      stats.byCategory[poi.category] = (stats.byCategory[poi.category] || 0) + 1;
    }
    stats.byRegion[macroRegionId].kept += kept;
    stats.byRegion[macroRegionId].dropped += dropped;
    stats.byRegion[macroRegionId].subregions[sub.id] = { raw: elements.length, kept, dropped };
    log(`    kept ${kept}, dropped ${dropped}`);
  }
}

// Filter against curated map/pois.js so the same record doesn't appear twice.
let curatedNames = new Set();
if (!ARGS.includeCurated) {
  curatedNames = await loadCuratedNames();
  log(`\nLoaded ${curatedNames.size} curated names from map/pois.js — those will be suppressed in scraped output`);
}

const before = allPois.length;
const merged = dedupe(allPois, { curatedNames });
// Highest-quality records (verified website, contact info, etc.) first.
merged.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
const dupesRemoved = before - merged.length;
stats.totalKept = merged.length;
stats.totalDropped = stats.totalRaw - merged.length;
stats.dupesRemoved = dupesRemoved;
stats.qualityBuckets = bucketQuality(merged);
log(`\nMerged ${before} → ${merged.length} (removed ${dupesRemoved} duplicates / curated overlaps)`);
log(`Quality distribution: ${JSON.stringify(stats.qualityBuckets)}`);

if (ARGS.dryRun) {
  log("\n--dry-run: not writing files. Sample of first 5 records:");
  log(JSON.stringify(merged.slice(0, 5), null, 2));
  process.exit(0);
}

const outDir = path.resolve("data", "out");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "pois-discovered.json"),
  JSON.stringify(merged, null, 2));
for (const macroRegionId of targetRegions) {
  const subset = merged.filter((p) => p.macroRegionId === macroRegionId);
  await fs.writeFile(path.join(outDir, `pois-discovered.${macroRegionId}.json`),
    JSON.stringify(subset, null, 2));
}
await fs.writeFile(path.join(outDir, "stats.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), ...stats }, null, 2));

log(`\nWrote:
  ${path.relative(process.cwd(), path.join(outDir, "pois-discovered.json"))}  (${merged.length} POIs)
  ${path.relative(process.cwd(), path.join(outDir, "stats.json"))}`);
log("\nNext steps:");
log("  • Restart the Node app — /api/voyager/pois will pick up the new file automatically.");
log("  • Re-run with --no-cache after adding/removing OSM filter rules.");

/* =============================================================================
 * Helpers
 * ============================================================================= */
function parseArgs(argv) {
  const out = { region: null, all: false, dryRun: false, noCache: false, includeCurated: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region")           out.region = argv[++i];
    else if (a === "--all")         out.all = true;
    else if (a === "--dry-run")     out.dryRun = true;
    else if (a === "--no-cache")    out.noCache = true;
    else if (a === "--include-curated") out.includeCurated = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`voyager-scraper

Usage:
  node scrape.mjs [--region <id>] [--all] [--dry-run] [--no-cache] [--include-curated]

Flags:
  --region <id>        Scrape one macro-region (default: nova-scotia)
  --all                Scrape every region in config/regions.mjs
  --dry-run            Don't write files; print sample to stdout
  --no-cache           Bypass on-disk cache and refetch from Overpass
  --include-curated    Don't suppress POIs whose name matches map/pois.js
  --help, -h           Show this help

Add a new region: edit config/regions.mjs.
Add a new tag mapping: edit config/categories.mjs.
`);
}

async function loadCuratedNames() {
  // Best-effort: read the static curated list from /map/pois.js without executing it.
  // The file contains an array literal under window.VOYAGER_POIS — we just regex out
  // every `name:"..."` value.
  try {
    const poisPath = path.resolve("..", "..", "map", "pois.js");
    const text = await fs.readFile(poisPath, "utf8");
    const re = /\bname\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const names = new Set();
    let m;
    while ((m = re.exec(text))) {
      const n = m[1].toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]+/gu, "").trim();
      if (n) names.add(n);
    }
    return names;
  } catch (_e) {
    return new Set();
  }
}

async function pkgVersionAsync() {
  try {
    const json = JSON.parse(await fs.readFile("package.json", "utf8"));
    return json.version || "0.0.0";
  } catch { return "0.0.0"; }
}
function pkgVersion() { return "0.1.0"; }

function bucketQuality(list) {
  const out = { "5+": 0, "4": 0, "3": 0, "2": 0, "1": 0, "0": 0 };
  for (const p of list) {
    const q = p.qualityScore || 0;
    if (q >= 5) out["5+"]++;
    else out[String(q)]++;
  }
  return out;
}
