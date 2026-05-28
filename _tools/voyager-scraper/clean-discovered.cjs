"use strict";

/**
 * One-shot cleaner for the discovered-POI artifact.
 *
 * Applies the production curation engine (public/server/voyager-curate.js) to
 * `data/out/pois-discovered.json` IN PLACE, so the cleaned + de-noised +
 * free-priced set is what lives on disk. This means the front-end gets the
 * high-standard list even if the running server is older code that streams the
 * file verbatim. A raw copy is kept at `pois-discovered.raw.json` the first
 * time this runs.
 *
 *   node _tools/voyager-scraper/clean-discovered.js
 */

const fs = require("fs");
const path = require("path");

const { curateDiscoveredPois } = require("../../public/server/voyager-curate.js");

const OUT = path.join(__dirname, "data", "out", "pois-discovered.json");
const RAW = path.join(__dirname, "data", "out", "pois-discovered.raw.json");
const CURATED_POIS = path.join(__dirname, "..", "..", "map", "pois.js");

function curatedNameSet() {
  const set = new Set();
  try {
    const raw = fs.readFileSync(CURATED_POIS, "utf8");
    const re = /name\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(raw))) {
      const key = m[1]
        .replace(/\\"/g, '"')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, "")
        .replace(/\s+/g, " ")
        .replace(/^the /, "")
        .trim();
      if (key) set.add(key);
    }
  } catch (_e) { /* curated file optional */ }
  return set;
}

function main() {
  if (!fs.existsSync(OUT)) {
    console.error("No discovered file at", OUT);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(OUT, "utf8"));
  if (!Array.isArray(raw)) {
    console.error("Discovered file is not an array.");
    process.exit(1);
  }
  if (!fs.existsSync(RAW)) {
    fs.writeFileSync(RAW, JSON.stringify(raw));
    console.log("Saved raw backup ->", path.basename(RAW));
  }

  const before = raw.length;
  const cleaned = curateDiscoveredPois(raw, { curatedNames: curatedNameSet() });
  fs.writeFileSync(OUT, JSON.stringify(cleaned));

  const byCat = {};
  cleaned.forEach((p) => { byCat[p.category] = (byCat[p.category] || 0) + 1; });
  console.log(`Cleaned ${before} -> ${cleaned.length} POIs`);
  console.log("By category:", byCat);
  console.log("Wrote", OUT);
}

main();
