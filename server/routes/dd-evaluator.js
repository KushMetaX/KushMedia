"use strict";

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const express = require('express');
const router = express.Router();

function getExpectedDdAdminPassword() {
  const envPassword = String(process.env.DD_ADMIN_PASSWORD || process.env.KUSH_ADMIN_PASSWORD || '').trim();
  if (envPassword) {
    return envPassword;
  }

  const filePath = process.env.DD_ADMIN_PASSWORD_FILE
    ? path.resolve(process.env.DD_ADMIN_PASSWORD_FILE)
    : path.resolve(__dirname, '..', '..', 'server', 'data', '.dd-admin-password');

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return raw ? String(raw).trim() : null;
}

function getDdRequestPassword(req) {
  return String(req.headers['x-dd-admin-password'] || req.query.password || '').trim();
}

function verifyDdAdminPassword(req, res) {
  const expected = getExpectedDdAdminPassword();
  if (!expected || getDdRequestPassword(req) !== expected) {
    res.status(401).json({ error: 'Invalid DD admin password.' });
    return false;
  }
  return true;
}

function getTrendingConfigPath() {
  if (process.env.DD_TRENDING_CONFIG_PATH) {
    return path.resolve(process.env.DD_TRENDING_CONFIG_PATH);
  }
  return path.resolve(__dirname, '..', '..', 'server', 'data', 'dd-trending-config.json');
}

function getEvaluationLogPath() {
  return path.resolve(__dirname, '..', '..', 'server', 'data', 'dd-evaluation-log.ndjson');
}

function readTrendingConfig() {
  const configPath = getTrendingConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function saveTrendingConfig(config) {
  const configPath = getTrendingConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function appendEvaluationLog(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Evaluations payload must be an array.');
  }

  const logPath = getEvaluationLogPath();
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }

  const lines = entries
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => JSON.stringify(entry))
    .filter(Boolean);

  if (lines.length === 0) {
    return 0;
  }

  fs.appendFileSync(logPath, lines.map(line => line + '\n').join(''), 'utf8');
  return lines.length;
}

/* -------------------------------------------------------------------
 *  ESM bridge — the evaluator & api modules use ESM import/export.
 *  We load them via dynamic import() from CJS.
 * ----------------------------------------------------------------- */

const ddRoot = path.resolve(__dirname, '..', '..', 'DD Price Evaluation', 'DDScraper');
const evaluatorUrl = pathToFileURL(path.join(ddRoot, 'evaluator.js')).href;
const apiUrl = pathToFileURL(path.join(ddRoot, 'api.js')).href;

let _mod = null;
let _apiMod = null;

async function loadEvaluator() {
  if (!_mod) _mod = await import(evaluatorUrl);
  return _mod;
}

async function loadApi() {
  if (!_apiMod) _apiMod = await import(apiUrl);
  return _apiMod;
}

function getLeaderboardTier(rank, hasTwitter) {
  const tiers = {
    diamond: {
      name: 'diamond',
      label: 'Orange',
      color: '#fb923c',
      colorLight: '#fdba74',
      colorDark: '#ea580c',
      glowColor: 'rgba(251, 146, 60, 0.5)',
      animated: true,
    },
    gold: {
      name: 'gold',
      label: 'Purple',
      color: '#c084fc',
      colorLight: '#d8b4fe',
      colorDark: '#a855f7',
      glowColor: 'rgba(192, 132, 252, 0.35)',
      animated: false,
    },
    silver: {
      name: 'silver',
      label: 'Blue',
      color: '#60a5fa',
      colorLight: '#93c5fd',
      colorDark: '#3b82f6',
      glowColor: 'rgba(96, 165, 250, 0.3)',
      animated: false,
    },
    grey: {
      name: 'grey',
      label: 'Grey',
      color: 'rgba(255, 255, 255, 0.4)',
      colorLight: 'rgba(255, 255, 255, 0.5)',
      colorDark: 'rgba(255, 255, 255, 0.2)',
      glowColor: 'transparent',
      animated: false,
    },
  };

  if (!hasTwitter || !Number.isFinite(rank)) {
    return tiers.grey;
  }
  if (rank <= 5) {
    return tiers.diamond;
  }
  if (rank <= 15) {
    return tiers.gold;
  }
  if (rank <= 35) {
    return tiers.silver;
  }
  return tiers.grey;
}

async function buildWalletProfile(api, address, dogNumbers) {
  const profile = {
    displayName: null,
    username: null,
    verified: false,
    rank: null,
    nonListedCount: null,
    inscriptionCount: null,
    selectedDogNumber: Array.isArray(dogNumbers) && dogNumbers.length ? dogNumbers[0] : null,
    imageUrl: null,
    marketUrl: `${api.MARKET_BASE}/wallet/${encodeURIComponent(address)}`,
  };

  try {
    const searchResult = await api.searchWallet(address);
    if (searchResult) {
      profile.displayName = searchResult.twitterDisplayName || profile.displayName;
      profile.username = searchResult.twitterUsername || profile.username;
      profile.verified = Boolean(searchResult.twitterVerified);
    }
  } catch (_err) {
    // Keep wallet summaries resilient even if the market profile lookup fails.
  }

  try {
    const leaderboard = await api.getOwnersLeaderboard(false);
    const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries : [];
    const entry = entries.find(candidate => String(candidate?.ownerAddress || '') === address);
    if (entry) {
      profile.rank = Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : null;
      profile.nonListedCount = Number.isFinite(Number(entry.nonListedCount)) ? Number(entry.nonListedCount) : null;
      profile.inscriptionCount = Number.isFinite(Number(entry.inscriptionCount)) ? Number(entry.inscriptionCount) : null;
      profile.selectedDogNumber = Number.isFinite(Number(entry.selectedDogNumber)) ? Number(entry.selectedDogNumber) : profile.selectedDogNumber;
      if (entry.twitter) {
        profile.displayName = entry.twitter.displayName || profile.displayName;
        profile.username = entry.twitter.username || profile.username;
        profile.verified = Boolean(entry.twitter.verified);
      }
    }
  } catch (_err) {
    // The leaderboard is decorative for this route; don't fail the wallet response.
  }

  profile.tier = getLeaderboardTier(profile.rank, Boolean(profile.displayName || profile.username));
  profile.imageUrl = profile.selectedDogNumber
    ? `${api.MARKET_BASE}/dogs/${profile.selectedDogNumber}.png`
    : null;

  if (!profile.displayName) {
    profile.displayName = `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  return profile;
}

/**
 * Call once from server startup to build the initial snapshot and
 * schedule the 12-hour refresh cycle.
 */
async function initEvaluator(log = console.log) {
  const ev = await loadEvaluator();
  const hours = Number(process.env.DD_REFRESH_HOURS || 12);
  await ev.startRefreshLoop(hours * 60 * 60 * 1000, log);
}

/* ---- Middleware ---- */

async function requireSnapshot(_req, res, next) {
  const ev = await loadEvaluator();
  if (!ev.isReady()) {
    return res.status(503).json({ error: 'Market snapshot is still loading. Try again shortly.' });
  }
  next();
}

/* ---- Routes ---- */

// GET /api/dd-evaluator/evaluate/batch?dogs=1,2,3
router.get('/evaluate/batch', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const dogsParam = req.query.dogs || '';
  const numbers = String(dogsParam).split(',')
    .map(s => Number(s.trim()))
    .filter(n => n >= 1 && n <= 10000);

  if (numbers.length === 0) {
    return res.status(400).json({ error: 'Provide ?dogs=1,2,3 (comma-separated, 1–10000).' });
  }
  if (numbers.length > 25) {
    return res.status(400).json({ error: 'Maximum 25 dogs per batch request.' });
  }

  try {
    const results = await Promise.all(numbers.map(n => ev.evaluateDog(n)));
    res.json({ count: results.length, evaluations: results });
  } catch (err) {
    res.status(500).json({ error: `Batch evaluation failed: ${err.message}` });
  }
});

// GET /api/dd-evaluator/evaluate/:dogNumber
router.get('/evaluate/:dogNumber', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const dogNumber = Number(req.params.dogNumber);
  if (isNaN(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'Invalid dog number. Must be 1–10000.' });
  }
  try {
    const result = await ev.evaluateDog(dogNumber);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Evaluation failed: ${err.message}` });
  }
});

// GET /api/dd-evaluator/wallet/:address
router.get('/wallet/:address', requireSnapshot, async (req, res) => {
  const address = String(req.params.address || '').trim();
  if (!/^[A-Za-z0-9]{24,80}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  try {
    const api = await loadApi();
    const walletData = await api.getWalletData(address);
    const rawHoldings = Array.isArray(walletData?.holdings) ? walletData.holdings : [];
    const seen = new Set();
    const dogNumbers = rawHoldings
      .map(holding => ({ dogNumber: Number(holding?.dogId), imageUrl: String(holding?.imageUrl || '') }))
      .filter(holding => Number.isInteger(holding.dogNumber) && holding.dogNumber >= 1 && holding.dogNumber <= 10000)
      .filter(holding => !holding.imageUrl || holding.imageUrl.startsWith('/dogs/'))
      .filter(holding => {
        if (seen.has(holding.dogNumber)) {
          return false;
        }
        seen.add(holding.dogNumber);
        return true;
      })
      .map(holding => holding.dogNumber)
      .sort((left, right) => left - right);
    const profile = await buildWalletProfile(api, address, dogNumbers);

    const result = {
      address,
      totalHoldings: rawHoldings.length,
      totalDogs: dogNumbers.length,
      nonDoginalHoldings: Math.max(0, rawHoldings.length - dogNumbers.length),
      dogNumbers,
      balance: walletData?.balance || null,
      collections: Array.isArray(walletData?.collections) ? walletData.collections : [],
      profile,
      evaluatedAt: new Date().toISOString(),
    };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Wallet evaluation failed: ${err.message}` });
  }
});

// GET /api/dd-evaluator/listings
router.get('/listings', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  let listings = snap.listings;

  // Trait filtering: ?trait=background:Yellow&trait=furColor:Black
  let traitFilters = req.query.trait;
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

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const start = (page - 1) * limit;
  const paged = listings.slice(start, start + limit);

  res.json({
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
});

// GET /api/dd-evaluator/floor
router.get('/floor', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  let listings = snap.listings;

  for (const key of ['background', 'furColor', 'furPattern', 'head', 'clothes', 'mouth', 'eyes', 'accessory']) {
    const val = req.query[key];
    if (val) {
      listings = listings.filter(l => {
        const traits = snap.traitMap[l.dogNumber];
        return traits && traits[key] === val;
      });
    }
  }

  if (listings.length === 0) {
    return res.json({ floor: null, message: 'No listings match the given filters.' });
  }

  const floor = listings[0];
  res.json({
    floorDoge: floor.priceDoge,
    floorUsd: snap.dogeUsd ? +(floor.priceDoge * snap.dogeUsd).toFixed(2) : null,
    dog: floor.name,
    dogNumber: floor.dogNumber,
    inscriptionId: floor.inscriptionId,
    totalMatching: listings.length,
    dogeUsd: snap.dogeUsd,
    snapshotAge: snap.builtAt,
  });
});

// GET /api/dd-evaluator/traits
router.get('/traits', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  res.json({ traitStats: snap.traitStats, traitMeta: snap.traitMeta, snapshotAge: snap.builtAt });
});

// GET /api/dd-evaluator/stats
router.get('/stats', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  res.json({
    ...snap.collectionStats,
    floorUsd: snap.dogeUsd && snap.collectionStats.floor
      ? +(snap.collectionStats.floor * snap.dogeUsd).toFixed(2) : null,
    medianUsd: snap.dogeUsd && snap.collectionStats.median
      ? +(snap.collectionStats.median * snap.dogeUsd).toFixed(2) : null,
    snapshotAge: snap.builtAt,
  });
});

// GET /api/dd-evaluator/activity
router.get('/activity', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  res.json({ sales: snap.recentSales.slice(0, limit), dogeUsd: snap.dogeUsd, snapshotAge: snap.builtAt });
});

// GET /api/dd-evaluator/price
router.get('/price', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  res.json({ dogeUsd: snap.dogeUsd, snapshotAge: snap.builtAt });
});

// GET /api/dd-evaluator/rank-lookup/:rank
router.get('/rank-lookup/:rank', requireSnapshot, async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  const rank = Number(req.params.rank);
  if (isNaN(rank) || rank < 1 || rank > 10000) {
    return res.status(400).json({ error: 'Invalid rank. Must be 1–10000.' });
  }

  // Search traitMap for a dog whose rarityRank matches
  for (const [dogNum, traits] of Object.entries(snap.traitMap)) {
    if (traits.rarityRank === rank) {
      return res.json({ rank, dogNumber: Number(dogNum), source: 'snapshot' });
    }
  }

  return res.status(404).json({
    error: `No dog with rarity rank ${rank} found in the current snapshot. Only listed dogs (${Object.keys(snap.traitMap).length} total) have rank data cached.`
  });
});

// GET /api/dd-evaluator/snapshot/status
router.get('/snapshot/status', async (req, res) => {
  const ev = await loadEvaluator();
  const snap = ev.getSnapshot();
  res.json({
    ready: ev.isReady(),
    builtAt: snap?.builtAt || null,
    totalListings: snap?.listings?.length || 0,
    traitsCovered: snap ? Object.keys(snap.traitMap).length : 0,
    dogeUsd: snap?.dogeUsd || null,
    refreshIntervalHours: Number(process.env.DD_REFRESH_HOURS || 12),
  });
});

router.get('/admin/trending', requireSnapshot, async (req, res) => {
  try {
    const evaluator = await loadEvaluator();
    const dashboard = await evaluator.getTrendingDashboardData();
    dashboard.saveEnabled = getExpectedDdAdminPassword() != null;
    res.json(dashboard);
  } catch (err) {
    console.error('Trending dashboard error:', err);
    res.status(500).json({ error: 'Failed to load trending dashboard.' });
  }
});

router.post('/admin/trending', async (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }

  const config = req.body;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }

  saveTrendingConfig(config);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

router.post('/admin/evaluations-import', async (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }

  let entries = req.body;
  if (!Array.isArray(entries)) {
    if (entries && Array.isArray(entries.evaluations)) {
      entries = entries.evaluations;
    } else {
      return res.status(400).json({ error: 'Request body must contain evaluations array.' });
    }
  }

  try {
    const imported = appendEvaluationLog(entries);
    res.json({ ok: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to import evaluation log.' });
  }
});

module.exports = router;
module.exports.initEvaluator = initEvaluator;
