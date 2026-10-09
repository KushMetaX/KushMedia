/**
 * Build the JSON the DD Evaluator DDL TCG tab already requests:
 *   GET /api/ddl-market/cards
 *   GET /api/ddl-market/card/V023
 *
 * Sources, in order:
 *   1. listings.csv  (manual / pasted asks and solds — always wins on ties)
 *   2. eBay Finding API if EBAY_APP_ID is set
 *   3. pack-math estimate, labeled source=model, never sold
 *
 * Usage:
 *   node build-market.mjs
 *   EBAY_APP_ID=YourAppId node build-market.mjs
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ASK_DISCOUNT = 0.85;
const REFRESH_HOURS = 6;
const BOX_MSRP = 179;
const PACKS_PER_BOX = 24;

const CHECK_PATH = path.join(DIR, 'ddl-checklist.js');
if (!fs.existsSync(CHECK_PATH)) {
  fs.copyFileSync('/tmp/ddl-checklist.js', CHECK_PATH);
}
const CHECK = require(CHECK_PATH);

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const head = lines.shift().split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {};
    head.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function modelUsd(card, print) {
  if (card.tier === 'GIGA') return 90;
  if (card.tier === 'UR') return 45;
  if (print === 'holo') return 6;
  return 1.5;
}

function classifyPrint(title, card) {
  const t = title.toLowerCase();
  const chase = /full art|\bfart\b|giga|ultra rare|\bur\b/.test(t);
  const holo = /holo|foil/.test(t);
  if (card.chase || chase) return 'fa';
  if (holo) return 'holo';
  return 'base';
}

function classifyGrade(title) {
  const m = title.match(/\b(PSA|BGS|CGC|SGC|AGS)\s*(10|9\.5|9|8\.5|8|7|6|5)\b/i);
  if (!m) return 'raw';
  return `${m[1].toUpperCase()} ${m[2]}`;
}

function isLot(title) {
  return /\blot\b|\bplayset\b|\bset of\b|\bcomplete set\b|3 of every|cards total/i.test(title);
}

async function ebaySearch(keywords, sold) {
  const app = process.env.EBAY_APP_ID;
  if (!app) return [];
  const params = new URLSearchParams({
    'OPERATION-NAME': sold ? 'findCompletedItems' : 'findItemsByKeywords',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': app,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords,
    'paginationInput.entriesPerPage': '100',
    'sortOrder': sold ? 'EndTimeSoonest' : 'PricePlusShippingLowest',
  });
  if (sold) params.set('itemFilter(0).name', 'SoldItemsOnly');
  if (sold) params.set('itemFilter(0).value', 'true');
  const url = 'https://svcs.ebay.com/services/search/FindingService/v1?' + params.toString();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('eBay HTTP ' + res.status);
  const data = await res.json();
  const root = data.findItemsByKeywordsResponse || data.findCompletedItemsResponse;
  const items = root?.[0]?.searchResult?.[0]?.item || [];
  return items.map((it) => ({
    title: it.title?.[0] || '',
    url: it.viewItemURL?.[0] || '',
    usd: Number(it.sellingStatus?.[0]?.currentPrice?.[0]?.__value__),
    at: it.listingInfo?.[0]?.endTime?.[0] || new Date().toISOString(),
    status: sold ? 'sold' : 'ask',
    itemId: it.itemId?.[0] || '',
  })).filter((r) => Number.isFinite(r.usd) && r.usd > 0 && r.usd < 20000);
}

function matchCard(title) {
  const num = title.match(/\bV\s*0*(\d{1,3})\b/i);
  if (num) {
    const id = 'V' + String(num[1]).padStart(3, '0');
    const card = CHECK.cards.find((c) => c.id === id);
    if (card) return card;
  }
  const low = title.toLowerCase();
  const hits = CHECK.cards.filter((c) => {
    const names = [c.name, ...(c.aliases || [])];
    return names.some((n) => new RegExp('\\b' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low));
  });
  return hits.length === 1 ? hits[0] : null;
}

function emptyBook() {
  const byCard = new Map();
  CHECK.cards.forEach((c) => byCard.set(c.id, { card: c, rows: [] }));
  return byCard;
}

function addRow(book, row) {
  if (!row || !row.id || isLot(row.title || '')) return;
  const bucket = book.get(row.id);
  if (!bucket) return;
  const print = row.print && bucket.card.prints.includes(row.print) ? row.print : classifyPrint(row.title || '', bucket.card);
  if (!bucket.card.prints.includes(print)) return;
  const usd = Number(row.usd);
  if (!Number.isFinite(usd) || usd <= 0) return;
  bucket.rows.push({
    id: row.id,
    print,
    status: row.status === 'sold' ? 'sold' : 'ask',
    usd,
    title: row.title || bucket.card.name,
    url: row.url || '',
    at: row.at || new Date().toISOString(),
    grade: row.grade || classifyGrade(row.title || ''),
    note: row.note || '',
  });
}

function summarize(rows, estimate) {
  const raw = rows.filter((r) => r.grade === 'raw' || !r.grade);
  const sold = raw.filter((r) => r.status === 'sold');
  const asks = raw.filter((r) => r.status === 'ask');
  const soldPrices = sold.map((r) => r.usd);
  const askPrices = asks.map((r) => r.usd);
  const lowestAsk = askPrices.length ? Math.min(...askPrices) : null;
  if (soldPrices.length) {
    const usd = median(soldPrices);
    return {
      usd: round2(usd),
      source: 'sold',
      sold: soldPrices.length,
      asks: askPrices.length,
      low: round2(Math.min(...soldPrices)),
      high: round2(Math.max(...soldPrices)),
      lowestAskUsd: lowestAsk == null ? null : round2(lowestAsk),
      estimateUsd: estimate,
    };
  }
  if (lowestAsk != null) {
    return {
      usd: round2(lowestAsk * ASK_DISCOUNT),
      source: 'asks',
      sold: 0,
      asks: askPrices.length,
      low: round2(Math.min(...askPrices)),
      high: round2(Math.max(...askPrices)),
      lowestAskUsd: round2(lowestAsk),
      estimateUsd: estimate,
    };
  }
  return {
    usd: estimate,
    source: 'model',
    sold: 0,
    asks: 0,
    low: null,
    high: null,
    lowestAskUsd: null,
    estimateUsd: estimate,
  };
}

async function main() {
  const book = emptyBook();
  const csvPath = path.join(DIR, 'listings.csv');
  const manual = fs.existsSync(csvPath) ? parseCsv(fs.readFileSync(csvPath, 'utf8')) : [];
  const boxRows = [];
  const packRows = [];
  manual.forEach((row) => {
    if (row.id === 'BOX') boxRows.push(row);
    else if (row.id === 'PACK') packRows.push(row);
    else addRow(book, row);
  });

  let ebayOk = false;
  let ebayError = '';
  if (process.env.EBAY_APP_ID) {
    try {
      const queries = ['Doginal Dogs Legends TCG', 'DDL TCG Rise of the Pack', 'Doginal Dogs Legends full art'];
      const seen = new Set();
      for (const q of queries) {
        const sold = await ebaySearch(q, true);
        const asks = await ebaySearch(q, false);
        [...sold, ...asks].forEach((item) => {
          const key = item.itemId || item.url;
          if (seen.has(key)) return;
          seen.add(key);
          if (!/doginal|ddl|legends|rotp/i.test(item.title)) return;
          if (/\bbox\b|booster box/i.test(item.title) && !/\bV\d{3}\b/i.test(item.title)) {
            boxRows.push({ ...item, id: 'BOX' });
            return;
          }
          if (/\bpack\b/i.test(item.title) && !/\bbox\b/i.test(item.title) && !/\bV\d{3}\b/i.test(item.title)) {
            packRows.push({ ...item, id: 'PACK' });
            return;
          }
          const card = matchCard(item.title);
          if (!card) return;
          addRow(book, { ...item, id: card.id, print: classifyPrint(item.title, card), grade: classifyGrade(item.title) });
        });
      }
      ebayOk = true;
    } catch (err) {
      ebayError = err.message;
    }
  }

  const now = new Date();
  const next = new Date(now.getTime() + REFRESH_HOURS * 3600 * 1000);
  const details = {};
  let activeListings = 0;
  let matchedSold = 0;
  const cards = CHECK.cards.map((card) => {
    const rows = book.get(card.id).rows;
    const prints = {};
    const graded = {};
    card.prints.forEach((print) => {
      const mine = rows.filter((r) => r.print === print);
      prints[print] = summarize(mine, modelUsd(card, print));
      activeListings += mine.filter((r) => r.status === 'ask').length;
      matchedSold += mine.filter((r) => r.status === 'sold').length;
      const gmap = {};
      mine.filter((r) => r.grade && r.grade !== 'raw').forEach((r) => {
        gmap[r.grade] = gmap[r.grade] || [];
        gmap[r.grade].push(r);
      });
      Object.keys(gmap).forEach((g) => {
        graded[print] = graded[print] || {};
        const sold = gmap[g].filter((r) => r.status === 'sold');
        const use = sold.length ? sold : gmap[g];
        graded[print][g] = {
          usd: round2(median(use.map((r) => r.usd))),
          source: sold.length ? 'sold' : 'asks',
          sold: sold.length,
          asks: gmap[g].length - sold.length,
        };
      });
    });
    details[card.id] = {
      id: card.id,
      name: card.name,
      sold: rows.filter((r) => r.status === 'sold').map(publicRow),
      asks: rows.filter((r) => r.status === 'ask').map(publicRow),
    };
    return { id: card.id, name: card.name, tier: card.tier, prints, graded };
  });

  function bookProduct(rows, fallback) {
    const sold = rows.filter((r) => r.status === 'sold' && Number(r.usd) > 0);
    const asks = rows.filter((r) => r.status === 'ask' && Number(r.usd) > 0);
    const msrp = rows.filter((r) => r.status === 'msrp' && Number(r.usd) > 0);
    if (sold.length) return { usd: round2(median(sold.map((r) => Number(r.usd)))), source: 'sold', n: sold.length, msrpUsd: BOX_MSRP };
    if (asks.length) return { usd: round2(Math.min(...asks.map((r) => Number(r.usd)))), source: 'asks', n: asks.length, msrpUsd: BOX_MSRP };
    if (msrp.length) return { usd: round2(Number(msrp[0].usd)), source: 'msrp', n: 0, msrpUsd: round2(Number(msrp[0].usd)) };
    return fallback;
  }

  const box = bookProduct(boxRows, { usd: BOX_MSRP, source: 'msrp', n: 0, msrpUsd: BOX_MSRP });
  const pack = bookProduct(packRows, { usd: round2(box.usd / PACKS_PER_BOX), source: 'model', n: 0, msrpUsd: round2(BOX_MSRP / PACKS_PER_BOX) });

  const market = {
    configured: true,
    set: 'Rise of the Pack',
    edition: '1st Edition',
    refreshedAt: now.toISOString(),
    nextRefreshAt: next.toISOString(),
    refreshHours: REFRESH_HOURS,
    askDiscount: ASK_DISCOUNT,
    sources: { browse: { ok: ebayOk, error: ebayError, mode: process.env.EBAY_APP_ID ? 'finding-api' : 'listings.csv' } },
    box,
    pack,
    counts: { activeListings, matchedSold, names: CHECK.cards.length, master: CHECK.master },
    disclaimer: 'Sold comps beat asks. Asks are booked at 85% of the lowest single-card ask. Cards with no single-card listing stay on pack-math and are badged Estimate. Lots are ignored.',
    cards,
  };

  fs.writeFileSync(path.join(DIR, 'market.json'), JSON.stringify(market, null, 2));
  fs.writeFileSync(path.join(DIR, 'details.json'), JSON.stringify(details, null, 2));
  console.log(`wrote market.json · ${cards.length} cards · ${activeListings} asks · ${matchedSold} sold · ebay ${ebayOk ? 'ok' : 'off'}`);
}

function publicRow(r) {
  return { usd: r.usd, print: r.print, grade: r.grade, at: r.at, title: r.title, url: r.url, source: r.status };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
