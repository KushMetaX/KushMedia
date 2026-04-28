#!/usr/bin/env node
/**
 * DDScraper — REST API Server for price evaluation.
 *
 * Starts an HTTP server that external sites can query for real-time
 * Doginal Dogs price evaluations. Market data is refreshed every 12 hours.
 *
 * Usage:
 *   node server.js                     Start on default port 3000
 *   PORT=8080 node server.js           Start on custom port
 *
 * Endpoints:
 *   GET /api/evaluate/:dogNumber       Evaluate a single dog's value
 *   GET /api/evaluate/batch?dogs=1,2,3 Evaluate multiple dogs
 *   GET /api/listings                  Current active listings (paginated)
 *   GET /api/listings?trait=background:Yellow&trait=furColor:Black
 *   GET /api/floor                     Collection floor price
 *   GET /api/floor?background=Yellow   Floor filtered by trait
 *   GET /api/traits                    Trait categories, values & rarity counts
 *   GET /api/stats                     Collection-wide market stats
 *   GET /api/activity                  Recent sales
 *   GET /api/price                     Live DOGE/USD rate
 *   GET /api/snapshot/status           Snapshot age / health check
 */

import http from 'node:http';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRefreshLoop, stopRefreshLoop, getSnapshot, isReady, evaluateDog } from './evaluator.js';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 12);
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS || '*';

/* ---- Helpers ---- */

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=60',
  });
  res.end(body);
}

function errorResponse(res, message, status = 500) {
  jsonResponse(res, { error: message }, status);
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  const parts = url.slice(idx + 1).split('&');
  for (const part of parts) {
    const [k, v] = part.split('=').map(decodeURIComponent);
    if (params[k]) {
      if (!Array.isArray(params[k])) params[k] = [params[k]];
      params[k].push(v);
    } else {
      params[k] = v;
    }
  }
  return params;
}

function parsePath(url) {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function requireSnapshot(res) {
  if (!isReady()) {
    errorResponse(res, 'Market snapshot is still loading. Try again shortly.', 503);
    return false;
  }
  return true;
}

/* ---- Route handlers ---- */

async function handleEvaluate(res, dogNumber) {
  if (!requireSnapshot(res)) return;
  if (isNaN(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return errorResponse(res, 'Invalid dog number. Must be 1–10000.', 400);
  }
  try {
    const result = await evaluateDog(dogNumber);
    jsonResponse(res, result);
  } catch (err) {
    errorResponse(res, `Evaluation failed: ${err.message}`);
  }
}

async function handleEvaluateBatch(res, query) {
  if (!requireSnapshot(res)) return;
  const dogsParam = query.dogs || '';
  const numbers = String(dogsParam).split(',')
    .map(s => Number(s.trim()))
    .filter(n => n >= 1 && n <= 10000);

  if (numbers.length === 0) {
    return errorResponse(res, 'Provide ?dogs=1,2,3 (comma-separated, 1–10000).', 400);
  }
  if (numbers.length > 25) {
    return errorResponse(res, 'Maximum 25 dogs per batch request.', 400);
  }

  try {
    const results = await Promise.all(numbers.map(n => evaluateDog(n)));
    jsonResponse(res, { count: results.length, evaluations: results });
  } catch (err) {
    errorResponse(res, `Batch evaluation failed: ${err.message}`);
  }
}

function handleListings(res, query) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  let listings = snap.listings;

  // Trait filtering: ?trait=background:Yellow&trait=furColor:Black
  let traitFilters = query.trait;
  if (traitFilters) {
    if (!Array.isArray(traitFilters)) traitFilters = [traitFilters];
    for (const filter of traitFilters) {
      const [key, val] = filter.split(':');
      if (key && val) {
        listings = listings.filter(l => {
          const traits = snap.traitMap[l.dogNumber];
          return traits && traits[key] === val;
        });
      }
    }
  }

  // Pagination
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const start = (page - 1) * limit;
  const paged = listings.slice(start, start + limit);

  jsonResponse(res, {
    total: listings.length,
    page,
    limit,
    dogeUsd: snap.dogeUsd,
    listings: paged.map(l => ({
      ...l,
      priceUsd: snap.dogeUsd ? +(l.priceDoge * snap.dogeUsd).toFixed(2) : null,
      traits: snap.traitMap[l.dogNumber] || null,
    })),
  });
}

function handleFloor(res, query) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  let listings = snap.listings;

  // Optional trait filter via query params: ?background=Yellow&furColor=Black
  for (const key of ['background', 'furColor', 'furPattern', 'head', 'clothes', 'mouth', 'eyes', 'accessory']) {
    const val = query[key];
    if (val) {
      listings = listings.filter(l => {
        const traits = snap.traitMap[l.dogNumber];
        return traits && traits[key] === val;
      });
    }
  }

  if (listings.length === 0) {
    return jsonResponse(res, { floor: null, message: 'No listings match the given filters.' });
  }

  const floor = listings[0]; // already sorted by price asc
  jsonResponse(res, {
    floorDoge: floor.priceDoge,
    floorUsd: snap.dogeUsd ? +(floor.priceDoge * snap.dogeUsd).toFixed(2) : null,
    dog: floor.name,
    dogNumber: floor.dogNumber,
    inscriptionId: floor.inscriptionId,
    totalMatching: listings.length,
    dogeUsd: snap.dogeUsd,
    snapshotAge: snap.builtAt,
  });
}

function handleTraits(res) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  jsonResponse(res, {
    traitStats: snap.traitStats,
    traitMeta: snap.traitMeta,
    snapshotAge: snap.builtAt,
  });
}

function handleStats(res) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  jsonResponse(res, {
    ...snap.collectionStats,
    floorUsd: snap.dogeUsd && snap.collectionStats.floor
      ? +(snap.collectionStats.floor * snap.dogeUsd).toFixed(2) : null,
    medianUsd: snap.dogeUsd && snap.collectionStats.median
      ? +(snap.collectionStats.median * snap.dogeUsd).toFixed(2) : null,
    snapshotAge: snap.builtAt,
  });
}

function handleActivity(res, query) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  jsonResponse(res, {
    sales: snap.recentSales.slice(0, limit),
    dogeUsd: snap.dogeUsd,
    snapshotAge: snap.builtAt,
  });
}

function handlePrice(res) {
  if (!requireSnapshot(res)) return;
  const snap = getSnapshot();
  jsonResponse(res, { dogeUsd: snap.dogeUsd, snapshotAge: snap.builtAt });
}

function handleSnapshotStatus(res) {
  const snap = getSnapshot();
  jsonResponse(res, {
    ready: isReady(),
    builtAt: snap?.builtAt || null,
    totalListings: snap?.listings?.length || 0,
    traitsCovered: snap ? Object.keys(snap.traitMap).length : 0,
    dogeUsd: snap?.dogeUsd || null,
    refreshIntervalHours: REFRESH_HOURS,
  });
}

/* ---- Router ---- */

async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  const path = parsePath(req.url);
  const query = parseQuery(req.url);

  // /api/evaluate/batch?dogs=1,2,3
  if (path === '/api/evaluate/batch') return handleEvaluateBatch(res, query);

  // /api/evaluate/:dogNumber
  const evalMatch = path.match(/^\/api\/evaluate\/(\d+)$/);
  if (evalMatch) return handleEvaluate(res, Number(evalMatch[1]));

  if (path === '/api/listings') return handleListings(res, query);
  if (path === '/api/floor') return handleFloor(res, query);
  if (path === '/api/traits') return handleTraits(res);
  if (path === '/api/stats') return handleStats(res);
  if (path === '/api/activity') return handleActivity(res, query);
  if (path === '/api/price') return handlePrice(res);
  if (path === '/api/snapshot/status') return handleSnapshotStatus(res);

  // Health check
  if (path === '/health') {
    return jsonResponse(res, {
      service: 'DDScraper Price Evaluator',
      ready: isReady(),
      uptime: process.uptime(),
    });
  }

  // Serve frontend
  if (path === '/') {
    const filePath = nodePath.join(__dirname, 'index.html');
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      return res.end(html);
    } catch {
      return errorResponse(res, 'Frontend not found', 404);
    }
  }

  // Serve embeddable widget script
  if (path === '/dd-widget.js') {
    const filePath = nodePath.join(__dirname, 'dd-widget.js');
    try {
      const js = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
        'Cache-Control': 'public, max-age=300',
      });
      return res.end(js);
    } catch {
      return errorResponse(res, 'Widget script not found', 404);
    }
  }

  errorResponse(res, 'Not found', 404);
}

/* ---- Start ---- */

const server = http.createServer(handleRequest);

server.listen(PORT, async () => {
  console.log(`\n  DDScraper Price Evaluator API`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Refresh interval: ${REFRESH_HOURS}h\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET /api/evaluate/:dogNumber`);
  console.log(`    GET /api/evaluate/batch?dogs=1,2,3`);
  console.log(`    GET /api/listings`);
  console.log(`    GET /api/floor`);
  console.log(`    GET /api/traits`);
  console.log(`    GET /api/stats`);
  console.log(`    GET /api/activity`);
  console.log(`    GET /api/price`);
  console.log(`    GET /api/snapshot/status`);
  console.log(`    GET /health\n`);

  await startRefreshLoop(REFRESH_HOURS * 60 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopRefreshLoop();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  stopRefreshLoop();
  server.close(() => process.exit(0));
});
