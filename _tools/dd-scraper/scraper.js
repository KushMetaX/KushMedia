#!/usr/bin/env node
/**
 * DDScraper — CLI tool to scrape Doginal Dogs data, images & live market prices.
 *
 * Usage:
 *   node scraper.js --dog 7742              Scrape a single dog
 *   node scraper.js --range 1 100           Scrape dogs 1–100
 *   node scraper.js --all                   Scrape all 10000 dogs
 *   node scraper.js --images                Download images for all scraped dogs
 *   node scraper.js --images --range 1 50   Download images for dogs 1–50
 *
 * Market / Price commands:
 *   node scraper.js --listings              Scrape all active listings with live prices
 *   node scraper.js --listings --trait background Yellow
 *   node scraper.js --floor                 Show current floor price
 *   node scraper.js --activity              Scrape recent sales / activity
 *   node scraper.js --traits                Dump all trait categories, values & counts
 *   node scraper.js --price                 Show live DOGE/USD price
 *
 * Options:
 *   --delay <ms>       Delay between requests (default: 200)
 *   --concurrency <n>  Parallel requests     (default: 3)
 *   --output <dir>     Output directory       (default: ./data)
 *   --img-dir <dir>    Image directory        (default: ./images)
 *   --sort <field>     Sort listings by       (default: price) — price | createdAt
 *   --order <dir>      Sort order             (default: asc)   — asc | desc
 *   --limit <n>        Limit results          (default: all)
 *   --trait <key> <v>  Filter listings by trait (repeatable)
 */

import fs from 'fs/promises';
import path from 'path';
import {
  getFullRecord,
  fetchDogImage,
  getDogecoinPrice,
  getTraitValues,
  getAllListings,
  getGlobalActivity,
  normaliseListing,
  TRAIT_KEYS
} from './api.js';

/* ---- CLI argument parsing ---- */

const args = process.argv.slice(2);

function getFlag(name) {
  return args.includes(`--${name}`);
}

function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function getArgPair(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 2 >= args.length) return null;
  return [Number(args[idx + 1]), Number(args[idx + 2])];
}

const DELAY       = Number(getArg('delay', 200));
const CONCURRENCY = Number(getArg('concurrency', 3));
const OUTPUT_DIR  = getArg('output', './data');
const IMG_DIR     = getArg('img-dir', './images');
const DO_IMAGES   = getFlag('images');
const DO_ALL      = getFlag('all');
const SINGLE_DOG  = getArg('dog', null);
const RANGE       = getArgPair('range');

/* New market flags */
const DO_LISTINGS  = getFlag('listings');
const DO_FLOOR     = getFlag('floor');
const DO_ACTIVITY  = getFlag('activity');
const DO_TRAITS    = getFlag('traits');
const DO_PRICE     = getFlag('price');
const SORT_BY      = getArg('sort', 'price');
const SORT_ORDER   = getArg('order', 'asc');
const RESULT_LIMIT = getArg('limit', null);

function getTraitFilters() {
  const filters = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trait' && i + 2 < args.length) {
      const key = args[i + 1];
      const val = args[i + 2];
      if (!filters[key]) filters[key] = [];
      filters[key].push(val);
      i += 2;
    }
  }
  return Object.keys(filters).length > 0 ? filters : null;
}
const TRAIT_FILTERS = getTraitFilters();

/* ---- Helpers ---- */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function loadExistingIndex() {
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveIndex(index) {
  await saveJson(path.join(OUTPUT_DIR, 'index.json'), index);
}

/* ---- Scrape logic ---- */

async function scrapeDog(dogNumber, index) {
  try {
    const record = await getFullRecord(dogNumber);
    const filename = `dog-${String(dogNumber).padStart(5, '0')}.json`;
    await saveJson(path.join(OUTPUT_DIR, filename), record);
    index[dogNumber] = {
      name: record.name,
      rarity: record.rarityLabel,
      rank: record.rarityRank,
      listed: record.isListed,
      priceDoge: record.price?.doge || null,
      priceUsd: record.price?.usd || null,
      background: record.traits?.background,
      furColor: record.traits?.furColor,
      file: filename
    };
    return { dogNumber, ok: true };
  } catch (err) {
    return { dogNumber, ok: false, error: err.message };
  }
}

async function downloadImage(dogNumber) {
  const imgPath = path.join(IMG_DIR, `${dogNumber}.png`);
  try {
    await fs.access(imgPath);
    return { dogNumber, ok: true, skipped: true };
  } catch { /* doesn't exist, download it */ }

  try {
    const { buffer } = await fetchDogImage(dogNumber);
    await fs.writeFile(imgPath, buffer);
    return { dogNumber, ok: true };
  } catch (err) {
    return { dogNumber, ok: false, error: err.message };
  }
}

async function processQueue(numbers, processFn) {
  const total = numbers.length;
  let completed = 0;
  let failed = 0;
  const queue = [...numbers];

  async function worker() {
    while (queue.length > 0) {
      const num = queue.shift();
      const result = await processFn(num);
      completed++;
      if (!result.ok) {
        failed++;
        process.stdout.write(`\r  [${completed}/${total}] #${num} FAILED: ${result.error}`);
      } else {
        process.stdout.write(`\r  [${completed}/${total}] #${num} ${result.skipped ? '(cached)' : 'OK'}        `);
      }
      if (queue.length > 0) await sleep(DELAY);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);
  console.log(`\n  Done: ${completed - failed} succeeded, ${failed} failed.`);
}

/* ---- Main ---- */

async function main() {
  /* ---- Quick market commands (no dog range needed) ---- */

  if (DO_PRICE) {
    const price = await getDogecoinPrice();
    console.log(`DOGE/USD: $${price}`);
    return;
  }

  if (DO_TRAITS) {
    const data = await getTraitValues();
    await ensureDir(OUTPUT_DIR);
    await saveJson(path.join(OUTPUT_DIR, 'traits.json'), data);
    console.log('Trait categories:', data.categories.join(', '));
    for (const cat of data.categories) {
      const vals = data.values[cat] || [];
      console.log(`  ${cat} (${vals.length}): ${vals.join(', ')}`);
    }
    console.log(`\nSaved to ${path.join(OUTPUT_DIR, 'traits.json')}`);
    return;
  }

  if (DO_FLOOR) {
    const [dogePrice, data] = await Promise.all([
      getDogecoinPrice(),
      getAllListings({ sortBy: 'price', sortOrder: 'asc', filters: TRAIT_FILTERS || undefined })
    ]);
    if (data.length === 0) {
      console.log('No active listings found.');
      return;
    }
    const floor = normaliseListing(data[0]);
    const filterNote = TRAIT_FILTERS ? ` (filtered: ${JSON.stringify(TRAIT_FILTERS)})` : '';
    console.log(`\nFloor price${filterNote}:`);
    console.log(`  ${floor.priceDoge.toLocaleString()} DOGE ($${(floor.priceDoge * (dogePrice || 0)).toFixed(2)} USD)`);
    console.log(`  Dog: ${floor.name}`);
    console.log(`  Inscription: ${floor.inscriptionId}`);
    console.log(`  Total listed: ${data.length}`);
    console.log(`  DOGE/USD rate: $${dogePrice}`);
    return;
  }

  if (DO_LISTINGS) {
    console.log('\n> Scraping all active listings...');
    const filterNote = TRAIT_FILTERS ? ` with filters ${JSON.stringify(TRAIT_FILTERS)}` : '';
    console.log(`  Sort: ${SORT_BY} ${SORT_ORDER}${filterNote}`);

    const [dogePrice, listings] = await Promise.all([
      getDogecoinPrice(),
      getAllListings({
        sortBy: SORT_BY,
        sortOrder: SORT_ORDER,
        filters: TRAIT_FILTERS || undefined,
        onPage: (page, count, total) => {
          process.stdout.write(`\r  Page ${page}: ${total} listings so far...`);
        }
      })
    ]);
    console.log(`\n  Found ${listings.length} active listings.`);

    const normalised = listings.map(normaliseListing);
    const limit = RESULT_LIMIT ? Number(RESULT_LIMIT) : normalised.length;
    const output = normalised.slice(0, limit);

    await ensureDir(OUTPUT_DIR);
    const result = {
      scrapedAt: new Date().toISOString(),
      dogeUsdRate: dogePrice,
      totalListings: listings.length,
      filters: TRAIT_FILTERS || null,
      sortBy: SORT_BY,
      sortOrder: SORT_ORDER,
      listings: output.map(l => ({
        ...l,
        priceUsd: +(l.priceDoge * (dogePrice || 0)).toFixed(2)
      }))
    };
    await saveJson(path.join(OUTPUT_DIR, 'listings.json'), result);
    console.log(`  Saved to ${path.join(OUTPUT_DIR, 'listings.json')}`);

    // Print summary table
    console.log(`\n  Top ${Math.min(10, output.length)} listings:`);
    output.slice(0, 10).forEach((l, i) => {
      const usd = (l.priceDoge * (dogePrice || 0)).toFixed(0);
      console.log(`    ${i + 1}. ${l.name} — ${l.priceDoge.toLocaleString()} DOGE ($${usd})`);
    });
    if (output.length > 10) console.log(`    ... and ${output.length - 10} more`);
    return;
  }

  if (DO_ACTIVITY) {
    console.log('\n> Scraping recent activity...');
    const limit = RESULT_LIMIT ? Number(RESULT_LIMIT) : 50;
    const data = await getGlobalActivity(limit);
    const activities = data?.activities || [];

    await ensureDir(OUTPUT_DIR);
    await saveJson(path.join(OUTPUT_DIR, 'activity.json'), {
      scrapedAt: new Date().toISOString(),
      activities
    });
    console.log(`  Found ${activities.length} activities.`);
    activities.slice(0, 10).forEach(a => {
      const price = a.priceDoge ? `${Number(a.priceDoge).toLocaleString()} DOGE` : '';
      console.log(`    [${a.activityType}] ${a.dogName} ${price} (${a.status})`);
    });
    console.log(`  Saved to ${path.join(OUTPUT_DIR, 'activity.json')}`);
    return;
  }

  /* ---- Original dog-scrape / image commands ---- */

  let numbers = [];

  if (SINGLE_DOG) {
    numbers = [Number(SINGLE_DOG)];
  } else if (RANGE) {
    const [start, end] = RANGE;
    for (let i = start; i <= end; i++) numbers.push(i);
  } else if (DO_ALL) {
    for (let i = 1; i <= 10000; i++) numbers.push(i);
  } else {
    console.log(`DDScraper — Doginal Dogs data & market scraper

Usage:
  node scraper.js --dog 7742              Scrape one dog (with live price)
  node scraper.js --range 1 100           Scrape dogs 1-100
  node scraper.js --all                   Scrape all 10,000 dogs
  node scraper.js --images --range 1 50   Download images for dogs 1-50

Market commands:
  node scraper.js --listings              Scrape all active listings with prices
  node scraper.js --listings --trait background Yellow
  node scraper.js --listings --trait furColor Black --trait head Crown
  node scraper.js --floor                 Show floor price
  node scraper.js --floor --trait background Yellow
  node scraper.js --activity              Recent sales / activity
  node scraper.js --traits                Dump all trait values & counts
  node scraper.js --price                 Live DOGE/USD price

Options:
  --delay <ms>          Delay between requests   (default: 200)
  --concurrency <n>     Parallel workers          (default: 3)
  --output <dir>        JSON output directory     (default: ./data)
  --img-dir <dir>       Image output directory    (default: ./images)
  --sort <field>        Sort listings by          (default: price)
  --order <dir>         Sort order                (default: asc)
  --limit <n>           Limit results
  --trait <key> <val>   Filter by trait (repeatable)
`);
    return;
  }

  console.log(`\nDDScraper — ${numbers.length} dog(s), delay=${DELAY}ms, concurrency=${CONCURRENCY}`);

  if (!DO_IMAGES || (DO_IMAGES && SINGLE_DOG) || (DO_IMAGES && RANGE) || (DO_IMAGES && DO_ALL)) {
    // Always scrape data first (unless --images only with no selector)
    await ensureDir(OUTPUT_DIR);
    const index = await loadExistingIndex();
    console.log('\n> Scraping data...');
    await processQueue(numbers, (n) => scrapeDog(n, index));
    await saveIndex(index);
    console.log(`  Index saved: ${path.join(OUTPUT_DIR, 'index.json')}`);
  }

  if (DO_IMAGES) {
    await ensureDir(IMG_DIR);
    console.log('\n> Downloading images...');
    await processQueue(numbers, downloadImage);
  }

  console.log('\nAll done.');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
