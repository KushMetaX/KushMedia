#!/usr/bin/env node
/**
 * build-rank-map.js — Generates a rank→dogNumber JSON map for all 10,000 Doginal Dogs.
 *
 * Fetches each dog's traits (which include rarityRank) from the market API
 * and writes the reverse mapping to api/data/rank-map.json.
 *
 * Usage:
 *   node "_tools/dd-scraper/build-rank-map.js"
 *
 * Options (env vars):
 *   CONCURRENCY  — parallel fetch workers (default 10)
 *   OUTPUT       — output file path (default api/data/rank-map.json)
 *   START        — first dog number (default 1)
 *   END          — last dog number  (default 10000)
 */

import { getDogTraits } from './api.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = Number(process.env.CONCURRENCY) || 10;
const OUTPUT = process.env.OUTPUT || resolve(__dirname, '..', '..', 'api', 'data', 'rank-map.json');
const START = Number(process.env.START) || 1;
const END = Number(process.env.END) || 10000;

// Load existing progress so we can resume
let rankMap = {};
if (existsSync(OUTPUT)) {
  try {
    rankMap = JSON.parse(readFileSync(OUTPUT, 'utf-8'));
    console.log(`[rank-map] Loaded existing map with ${Object.keys(rankMap).length} entries.`);
  } catch { /* start fresh */ }
}

// Build a set of dog numbers already resolved (reverse lookup from existing map)
const doneDogs = new Set(Object.values(rankMap).map(Number));

const queue = [];
for (let i = START; i <= END; i++) {
  if (!doneDogs.has(i)) queue.push(i);
}

console.log(`[rank-map] ${queue.length} dogs to fetch (${START}–${END}, concurrency ${CONCURRENCY}).`);

let completed = 0;
let failed = 0;
const total = queue.length;

function save() {
  // Sort by rank numerically
  const sorted = {};
  for (const key of Object.keys(rankMap).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = rankMap[key];
  }
  writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));
}

async function worker() {
  while (queue.length > 0) {
    const dogNumber = queue.shift();
    try {
      const traits = await getDogTraits(dogNumber);
      if (traits && traits.rarityRank) {
        rankMap[String(traits.rarityRank)] = dogNumber;
      }
      completed++;
    } catch {
      failed++;
    }

    // Progress + periodic save every 100 dogs
    if ((completed + failed) % 100 === 0) {
      const pct = (((completed + failed) / total) * 100).toFixed(1);
      console.log(`[rank-map] ${completed + failed}/${total} (${pct}%) — ${completed} ok, ${failed} failed, ${Object.keys(rankMap).length} ranks mapped.`);
      save();
    }
  }
}

const startTime = Date.now();
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

save();
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`[rank-map] Done in ${elapsed}s. ${Object.keys(rankMap).length} ranks mapped, ${failed} failures.`);
console.log(`[rank-map] Written to ${OUTPUT}`);
