"use strict";

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const express = require('express');
const { timingSafeEqualString } = require('../security-utils');
const ddPaywall = require('./dd-paywall');
const doginalDogsService = require('../services/doginal-dogs');
const ddTraitCatalog = require('../services/dd-trait-catalog');
const router = express.Router();

const CLIENT_INTERNAL_ERROR = 'An unexpected error occurred.';

const serverDataDir = path.resolve(__dirname, '..', 'data');

function readTrimmedSecretFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw ? String(raw).trim() : null;
}

/** Env first, else single-line file (trimmed). */
function resolveSecret(envPrimary, legacyEnvKeys, fileEnvKey, defaultFilenameUnderServerData) {
  const direct = String(process.env[envPrimary] || '').trim();
  if (direct) return direct;
  for (const key of legacyEnvKeys || []) {
    const v = String(process.env[key] || '').trim();
    if (v) return v;
  }
  const fp = process.env[fileEnvKey]
    ? path.resolve(process.env[fileEnvKey])
    : path.join(serverDataDir, defaultFilenameUnderServerData);
  return readTrimmedSecretFromFile(fp);
}

function getAdminUiPassword() {
  return resolveSecret('DD_ADMIN_UI_PASSWORD', [], 'DD_ADMIN_UI_PASSWORD_FILE', '.dd-admin-ui-password');
}

function getExpectedDdAdminPassword() {
  return resolveSecret('DD_ADMIN_PASSWORD', ['KUSH_ADMIN_PASSWORD'], 'DD_ADMIN_PASSWORD_FILE', '.dd-admin-password');
}

function getCommunitySubmitPassword() {
  return resolveSecret('DD_COMMUNITY_PASSWORD', [], 'DD_COMMUNITY_PASSWORD_FILE', '.dd-community-password');
}

function resolveAdminHtmlGatePassword() {
  const ui = getAdminUiPassword();
  if (ui) return ui;
  const trait = getExpectedDdAdminPassword();
  return trait || null;
}

function decodeBasicPasswordSegment(authHeader) {
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) {
    return null;
  }
  try {
    const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    return colon >= 0 ? decoded.slice(colon + 1) : decoded;
  } catch (_err) {
    return null;
  }
}

function getDdRequestPassword(req) {
  const headerPw = String(req.headers['x-dd-admin-password'] || '').trim();
  if (headerPw) return headerPw;

  const basicPw = decodeBasicPasswordSegment(req.headers.authorization);
  const traitSecret = getExpectedDdAdminPassword();
  if (
    basicPw != null && traitSecret != null
    && timingSafeEqualString(traitSecret, basicPw)
  ) {
    return traitSecret;
  }

  return '';
}

function verifyDdAdminPassword(req, res) {
  const expected = getExpectedDdAdminPassword();
  const candidate = getDdRequestPassword(req);
  if (!expected || !timingSafeEqualString(expected, candidate)) {
    res.status(401).json({ error: 'Invalid DD admin password.' });
    return false;
  }
  return true;
}

function getTrendingConfigPath() {
  if (process.env.DD_TRENDING_CONFIG_PATH) {
    return path.resolve(process.env.DD_TRENDING_CONFIG_PATH);
  }
  return path.join(serverDataDir, 'dd-trending-config.json');
}

function getEvaluationLogPath() {
  if (process.env.DD_EVALUATION_LOG_PATH) {
    return path.resolve(process.env.DD_EVALUATION_LOG_PATH);
  }
  return path.join(serverDataDir, 'dd-evaluation-log.ndjson');
}

function getCommunitySuggestionsPath() {
  if (process.env.DD_COMMUNITY_SUGGESTIONS_PATH) {
    return path.resolve(process.env.DD_COMMUNITY_SUGGESTIONS_PATH);
  }
  return path.join(serverDataDir, 'dd-community-suggestions.json');
}

function getCommunityNotesPath() {
  if (process.env.DD_COMMUNITY_NOTES_PATH) {
    return path.resolve(process.env.DD_COMMUNITY_NOTES_PATH);
  }
  return path.join(serverDataDir, 'dd-community-notes.json');
}

const DD_TRAIT_KEYS = new Set([
  'background', 'furColor', 'furPattern', 'head',
  'clothes', 'mouth', 'eyes', 'accessory',
]);

const communitySubmitBuckets = new Map();

function rateLimitCommunitySuggestions(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const windowMs = 15 * 60 * 1000;
  const max = 60;
  const now = Date.now();
  let bucket = communitySubmitBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    communitySubmitBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return res.status(429).json({ error: 'Too many submissions. Try again later.' });
  }
  next();
}

function readSuggestionsStore() {
  const configPath = getCommunitySuggestionsPath();
  if (!fs.existsSync(configPath)) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    return { version: 1, items: parsed.items };
  } catch (_err) {
    return { version: 1, items: [] };
  }
}

function writeSuggestionsStore(store) {
  const configPath = getCommunitySuggestionsPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  fs.writeFileSync(configPath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function normalizeCommunityLoreNoteValue(raw) {
  if (raw == null) {
    return '';
  }
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (typeof raw.lore === 'string') {
      return raw.lore.trim();
    }
    if (typeof raw.text === 'string') {
      return raw.text.trim();
    }
    if (typeof raw.body === 'string') {
      return raw.body.trim();
    }
  }
  return '';
}

/** Preserve `{ lore, loreMultiplier }` when present so edits round-trip. */
function coalesceCommunityNoteStoredValue(raw) {
  const text = normalizeCommunityLoreNoteValue(raw);
  if (!text) {
    return null;
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    let m = raw.loreMultiplier ?? raw.multiplier;
    if (m != null) {
      m = Number(m);
      if (Number.isFinite(m)) {
        return { lore: text, loreMultiplier: m };
      }
    }
  }
  return text;
}

function readCommunityNotesStore() {
  const configPath = getCommunityNotesPath();
  if (!fs.existsSync(configPath)) {
    return { version: 1, notes: {} };
  }
  try {
    let text = fs.readFileSync(configPath, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, notes: {} };
    }
    const notes = {};
    if (parsed.notes && typeof parsed.notes === 'object') {
      for (const [k, v] of Object.entries(parsed.notes)) {
        const entry = coalesceCommunityNoteStoredValue(v);
        if (entry) {
          notes[String(k)] = entry;
        }
      }
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (k === 'version' || k === 'notes') continue;
      const entry = coalesceCommunityNoteStoredValue(v);
      if (entry) {
        notes[String(k)] = entry;
      }
    }
    return { version: 1, notes };
  } catch (_err) {
    return { version: 1, notes: {} };
  }
}

function writeCommunityNotesStore(store) {
  const configPath = getCommunityNotesPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  fs.writeFileSync(configPath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function communityNotesDogCount() {
  const ns = readCommunityNotesStore();
  return Object.keys(ns.notes || {}).length;
}

/** Match approved notes even if JSON keys differ slightly (e.g. "7742" vs 7742). */
function lookupCommunityLoreText(notes, dogNumber) {
  if (!notes || typeof notes !== 'object' || dogNumber == null) {
    return null;
  }
  const n = Number(dogNumber);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    return null;
  }
  const preferredKeys = [String(n), String(Math.trunc(n))];
  for (const k of preferredKeys) {
    const t = normalizeCommunityLoreNoteValue(notes[k]);
    if (t) {
      return t;
    }
  }
  for (const [k, v] of Object.entries(notes)) {
    const t = normalizeCommunityLoreNoteValue(v);
    if (!t) {
      continue;
    }
    const ks = String(k).trim();
    if (/^\d+$/.test(ks) && Number(ks) === n) {
      return t;
    }
  }
  return null;
}

function attachCommunityLoreFromDisk(result) {
  if (!result || result.error) {
    return;
  }
  if (result.dogNumber == null) {
    return;
  }
  const ns = readCommunityNotesStore();
  const text = lookupCommunityLoreText(ns.notes || {}, result.dogNumber);
  if (!text) {
    return;
  }
  if (!result.communityLore) {
    result.communityLore = text;
  }
  if (!result.estimation || typeof result.estimation !== 'object') {
    result.estimation = {};
  }
  if (!result.estimation.communityLore) {
    result.estimation.communityLore = text;
  }
}

function slugComboId(label, suggestionId) {
  const base = String(label || 'combo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const idFrag = String(suggestionId || '').replace(/-/g, '').slice(0, 12);
  return `${base || 'combo'}-${idFrag}`;
}

function validateSuggestionPayload(kind, raw) {
  if (!kind || typeof kind !== 'string') {
    throw new Error('Missing suggestion kind.');
  }
  const k = kind.trim();
  if (k === 'trait_multiplier') {
    const traitKey = String(raw.traitKey || '').trim();
    const traitValue = String(raw.traitValue || '').trim();
    const multiplier = Number(raw.multiplier);
    if (!DD_TRAIT_KEYS.has(traitKey)) {
      throw new Error('Invalid traitKey.');
    }
    if (!traitValue) {
      throw new Error('traitValue is required.');
    }
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      throw new Error('multiplier must be >= 1.');
    }
    return {
      traitKey,
      traitValue,
      multiplier: +multiplier.toFixed(4),
    };
  }
  if (k === 'combo') {
    const label = String(raw.label || '').trim();
    const multiplier = Number(raw.multiplier);
    const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
    if (!label) {
      throw new Error('label is required.');
    }
    if (!Number.isFinite(multiplier) || multiplier === 0) {
      throw new Error('combo multiplier must be a non-zero number.');
    }
    const normalizedCond = [];
    for (const c of conditions) {
      if (!c || typeof c !== 'object') continue;
      const trait = String(c.trait || '').trim();
      const valueRaw = String(c.value || '').trim();
      if (!DD_TRAIT_KEYS.has(trait) || !valueRaw) continue;
      const vl = valueRaw.toLowerCase();
      if (vl === 'any') continue; // wildcard / no constraint
      const normVal = vl === 'none' ? 'None' : valueRaw;
      normalizedCond.push({
        trait,
        op: c.op === 'contains' ? 'contains' : 'eq',
        value: normVal,
      });
    }
    const dogNumbers = [];
    const seenDogs = new Set();
    const dogSource = Array.isArray(raw.dogNumbers)
      ? raw.dogNumbers
      : (typeof raw.dogNumbers === 'string' ? String(raw.dogNumbers).split(/[\s,;]+/) : []);
    for (const entry of dogSource) {
      const n = Number.parseInt(String(entry).trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > 10000 || seenDogs.has(n)) continue;
      seenDogs.add(n);
      dogNumbers.push(n);
    }
    if (normalizedCond.length === 0 && dogNumbers.length === 0) {
      throw new Error('combo requires trait conditions and/or a dog # allowlist.');
    }
    return {
      label,
      multiplier,
      conditions: normalizedCond,
      dogNumbers,
    };
  }
  if (k === 'suppress_trend') {
    const trendKeyRaw = String(raw.trendKey || '').trim();
    const colonIdx = trendKeyRaw.indexOf(':');
    if (colonIdx < 1) {
      throw new Error('trendKey must look like trait:value.');
    }
    const tr = trendKeyRaw.slice(0, colonIdx).trim();
    const tv = trendKeyRaw.slice(colonIdx + 1).trim();
    if (!DD_TRAIT_KEYS.has(tr) || !tv) {
      throw new Error('Invalid trendKey.');
    }
    return { trendKey: `${tr}:${tv}` };
  }
  if (k === 'lore_only') {
    const dogNumber = Number(raw.dogNumber);
    const lore = String(raw.lore || '').trim();
    const submittedBy = String(raw.submittedBy || '').trim().slice(0, 120);
    let loreMultiplier = raw.loreMultiplier != null ? Number(raw.loreMultiplier) : null;
    if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
      throw new Error('dogNumber must be 1–10000.');
    }
    if (!lore) {
      throw new Error('lore is required.');
    }
    if (lore.length > 8000) {
      throw new Error('lore is too long.');
    }
    if (!submittedBy) {
      throw new Error('submittedBy is required.');
    }
    if (loreMultiplier != null && !Number.isFinite(loreMultiplier)) {
      throw new Error('loreMultiplier must be a finite number.');
    }
    if (loreMultiplier != null && (loreMultiplier > 100 || loreMultiplier < -0.99)) {
      throw new Error('loreMultiplier must be between -0.99 and 100.');
    }
    return { dogNumber, lore, loreMultiplier, submittedBy };
  }
  throw new Error('Unknown suggestion kind.');
}

async function mergeApprovedSuggestion(item) {
  let cfg = readTrendingConfig();
  if (!cfg || typeof cfg !== 'object') {
    const ev = await loadEvaluator();
    cfg = await ev.getTrendingConfig(true);
  } else {
    cfg = JSON.parse(JSON.stringify(cfg));
  }

  const kind = item.kind;
  const payload = item.payload || {};
  let mergeResult = {};

  if (kind === 'trait_multiplier') {
    const multKey = `${payload.traitKey}:${payload.traitValue}`;
    cfg.manualMultipliers = { ...(cfg.manualMultipliers || {}), [multKey]: payload.multiplier };
    mergeResult = { manualMultiplierKey: multKey };
    saveTrendingConfig(cfg);
  } else if (kind === 'combo') {
    const comboId = slugComboId(payload.label, item.id);
    const combos = [...(((cfg.specialMultipliers || {}).combos) || [])];
    const idx = combos.findIndex(c => String(c.id) === comboId);
    const dogNumbers = Array.isArray(payload.dogNumbers) && payload.dogNumbers.length
      ? payload.dogNumbers
      : (idx >= 0 && Array.isArray(combos[idx]?.dogNumbers) ? combos[idx].dogNumbers : []);
    const entry = {
      id: comboId,
      label: payload.label,
      conditions: payload.conditions,
      dogNumbers,
      multiplier: payload.multiplier,
      enabled: true,
    };
    if (idx >= 0) {
      combos[idx] = entry;
    } else {
      combos.push(entry);
    }
    cfg.specialMultipliers = { ...(cfg.specialMultipliers || {}), combos };
    mergeResult = { comboId };
    saveTrendingConfig(cfg);
  } else if (kind === 'suppress_trend') {
    const keys = [...(((cfg.autoTrend || {}).disabledTrendKeys) || [])];
    if (!keys.includes(payload.trendKey)) {
      keys.push(payload.trendKey);
    }
    cfg.autoTrend = { ...(cfg.autoTrend || {}), disabledTrendKeys: keys };
    mergeResult = { suppressedTrendKey: payload.trendKey };
    saveTrendingConfig(cfg);
  } else if (kind === 'lore_only') {
    const ns = readCommunityNotesStore();
    const dn = String(payload.dogNumber);
    const submittedBy = payload.submittedBy ? String(payload.submittedBy).trim().slice(0, 120) : '';
    let stored = payload.lore;
    const hasMult = payload.loreMultiplier != null && Number.isFinite(Number(payload.loreMultiplier));
    if (hasMult || submittedBy) {
      stored = { lore: payload.lore };
      if (hasMult) stored.loreMultiplier = Number(payload.loreMultiplier);
      if (submittedBy) stored.submittedBy = submittedBy;
    }
    ns.notes = { ...(ns.notes || {}), [dn]: stored };
    writeCommunityNotesStore(ns);
    mergeResult = { dogNumber: payload.dogNumber };
  }

  const ev = await loadEvaluator();
  await ev.getTrendingConfig(true);
  return mergeResult;
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

const ddRoot = (() => {
  const a = path.resolve(__dirname, '..', '..', '_tools', 'dd-scraper');
  if (fs.existsSync(path.join(a, 'evaluator.js'))) {
    return a;
  }
  return path.resolve(__dirname, '..', '..', '..', '_tools', 'dd-scraper');
})();
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
 *
 * On low-memory CloudLinux / shared hosts, the first market fetch uses Node's fetch
 * (undici + wasm llhttp) and can throw RangeError OOM. Set DD_SKIP_STARTUP_REFRESH=1
 * to skip this so /api/auth and static pages still work; DD evaluator routes stay 503
 * until snapshot exists (e.g. run a worker on a machine with more RAM, or raise LVE limits).
 */
async function initEvaluator(log = console.log) {
  const skipRaw = String(process.env.DD_SKIP_STARTUP_REFRESH || '').trim().toLowerCase();
  if (
    skipRaw === '1'
    || skipRaw === 'true'
    || skipRaw === 'yes'
    || skipRaw === 'on'
  ) {
    log('[dd-evaluator] Skipping startup snapshot refresh (DD_SKIP_STARTUP_REFRESH).');
    return;
  }

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

router.get('/dogidex/rarity-order', async (_req, res) => {
  try {
    const order = await doginalDogsService.getCatalogRarityDogOrder();
    if (!order || order.length !== 10000) {
      return res.status(404).json({ ok: false, error: 'catalog_unavailable' });
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      ok: true,
      source: 'DoginalDogsCatalog',
      collectionSize: 10000,
      order,
    });
  } catch (err) {
    console.error('[dd-evaluator] dogidex/rarity-order:', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// GET /api/dd-evaluator/evaluate/batch?dogs=1,2,3
router.get('/evaluate/batch', requireSnapshot, ddPaywall.mwBatchEvaluate(), async (req, res) => {
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
    for (const r of results) {
      attachCommunityLoreFromDisk(r);
    }
    res.json({ count: results.length, evaluations: results });
  } catch (err) {
    console.error('[dd-evaluator] Batch evaluate:', err);
    res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
  }
});

// GET /api/dd-evaluator/evaluate/:dogNumber
router.get('/evaluate/:dogNumber', requireSnapshot, ddPaywall.mwEvaluateDog(), async (req, res) => {
  const ev = await loadEvaluator();
  const dogNumber = Number(req.params.dogNumber);
  if (isNaN(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'Invalid dog number. Must be 1–10000.' });
  }
  try {
    const result = await ev.evaluateDog(dogNumber);
    attachCommunityLoreFromDisk(result);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(result);
  } catch (err) {
    console.error('[dd-evaluator] Evaluate:', err);
    res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
  }
});

function extractDogNumbersFromHoldings(rawHoldings) {
  const seen = new Set();
  return (Array.isArray(rawHoldings) ? rawHoldings : [])
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
}

async function buildWalletHoldingsSummary(api, address) {
  const walletData = await api.getWalletData(address);
  const rawHoldings = Array.isArray(walletData?.holdings) ? walletData.holdings : [];
  const dogNumbers = extractDogNumbersFromHoldings(rawHoldings);
  const profile = await buildWalletProfile(api, address, dogNumbers);
  let tcgRegistry = { inspirations: [], holdings: [], multipliers: {} };
  try {
    const evaluator = await loadEvaluator();
    const config = await evaluator.getTrendingConfig();
    tcgRegistry = {
      inspirations: Array.isArray(config?.tcgInspirations) ? config.tcgInspirations : [],
      holdings: Array.isArray(config?.tcgCardHoldings) ? config.tcgCardHoldings : [],
      multipliers: config?.tcgInspirationMultipliers || {},
    };
  } catch (_err) {
    // Registry is optional; wallet lookup should still succeed.
  }
  return {
    address,
    totalHoldings: rawHoldings.length,
    totalDogs: dogNumbers.length,
    nonDoginalHoldings: Math.max(0, rawHoldings.length - dogNumbers.length),
    dogNumbers,
    balance: walletData?.balance || null,
    collections: Array.isArray(walletData?.collections) ? walletData.collections : [],
    profile,
    tcgRegistry,
    evaluatedAt: new Date().toISOString(),
  };
}

function normalizeOwnerQuery(raw) {
  return String(raw || '').trim().replace(/^@+/, '');
}

function isWalletAddressQuery(query) {
  return /^[A-Za-z0-9]{24,80}$/.test(query);
}

function isDogNumberQuery(query) {
  return /^[1-9]\d{0,4}$/.test(query) && Number(query) >= 1 && Number(query) <= 10000;
}

async function resolveOwnerSearch(api, query, listings = []) {
  const q = normalizeOwnerQuery(query);
  if (!q) {
    const err = new Error('Enter a wallet address, X handle, or listed dog number.');
    err.statusCode = 400;
    throw err;
  }

  let address = null;
  let matchType = null;
  let listedDog = null;
  let searchHits = [];

  if (isWalletAddressQuery(q)) {
    address = q;
    matchType = 'wallet';
  } else if (isDogNumberQuery(q)) {
    const dogNumber = Number(q);
    const listing = (Array.isArray(listings) ? listings : [])
      .find(item => Number(item?.dogNumber) === dogNumber);
    if (!listing || !listing.sellerAddress) {
      const err = new Error(
        'Owner wallet is only available for dogs currently listed on the marketplace. Search by wallet address or linked X handle instead.'
      );
      err.statusCode = 404;
      throw err;
    }
    address = String(listing.sellerAddress).trim();
    matchType = 'listedDog';
    listedDog = {
      dogNumber,
      priceDoge: listing.priceDoge != null ? Number(listing.priceDoge) : null,
      priceUsd: listing.priceUsd != null ? Number(listing.priceUsd) : null,
      listingId: listing.listingId || listing.id || null,
      marketUrl: `${api.MARKET_BASE}/dog/${dogNumber}`,
    };
  } else {
    const ownerSearch = typeof api.searchOwners === 'function'
      ? await api.searchOwners(q, 10)
      : null;
    const walletHit = ownerSearch?.wallet || null;
    searchHits = Array.isArray(ownerSearch?.results) ? ownerSearch.results : [];
    if (!walletHit?.address) {
      const err = new Error('No marketplace owner matched that X handle.');
      err.statusCode = 404;
      throw err;
    }
    address = String(walletHit.address).trim();
    matchType = 'twitter';
  }

  if (!isWalletAddressQuery(address)) {
    const err = new Error('Resolved owner address was invalid.');
    err.statusCode = 502;
    throw err;
  }

  const wallet = await buildWalletHoldingsSummary(api, address);
  return {
    query: q,
    matchType,
    listedDog,
    searchHits: searchHits
      .filter(hit => hit && hit.address)
      .slice(0, 5)
      .map(hit => ({
        address: String(hit.address),
        twitterUsername: hit.twitterUsername || null,
        twitterDisplayName: hit.twitterDisplayName || null,
        twitterVerified: Boolean(hit.twitterVerified),
      })),
    ...wallet,
  };
}

// GET /api/dd-evaluator/wallet/:address
router.get('/wallet/:address', requireSnapshot, ddPaywall.mwWallet(), async (req, res) => {
  const address = String(req.params.address || '').trim();
  if (!/^[A-Za-z0-9]{24,80}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  try {
    const api = await loadApi();
    const result = await buildWalletHoldingsSummary(api, address);
    res.json(result);
  } catch (err) {
    console.error('[dd-evaluator] Wallet:', err);
    res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
  }
});

// GET /api/dd-evaluator/owner-search?q=
router.get('/owner-search', requireSnapshot, ddPaywall.mwWallet(), async (req, res) => {
  const query = normalizeOwnerQuery(req.query.q || req.query.query || '');
  if (!query) {
    return res.status(400).json({ error: 'Enter a wallet address, X handle, or listed dog number.' });
  }

  try {
    const api = await loadApi();
    const ev = await loadEvaluator();
    const listings = ev.isReady() ? (ev.getSnapshot()?.listings || []) : [];
    const result = await resolveOwnerSearch(api, query, listings);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(result);
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err.message || 'Owner search failed.' });
    }
    console.error('[dd-evaluator] Owner search:', err);
    res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
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

// GET /api/dd-evaluator/trait-catalog — unique trait values for autocomplete
router.get('/trait-catalog', async (_req, res) => {
  try {
    const traits = await ddTraitCatalog.getCatalogTraitValues();
    if (!traits) {
      return res.status(503).json({ ok: false, error: 'Trait catalog unavailable. Ensure DoginalDogsCatalog.json is present.' });
    }
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ ok: true, traits, count: traits.length });
  } catch (err) {
    console.error('[dd-evaluator] trait-catalog:', err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      error: (err && err.message) ? String(err.message) : CLIENT_INTERNAL_ERROR
    });
  }
});

// GET /api/dd-evaluator/trait-search?q=Cowboy | ?trait=head&value=Cowboy
router.get('/trait-search', async (req, res) => {
  try {
    const result = await ddTraitCatalog.searchCatalogByTrait({
      q: req.query.q || req.query.query,
      traits: req.query.traits,
      traitKey: req.query.trait || req.query.traitKey,
      value: req.query.value,
      limit: req.query.limit,
      offset: req.query.offset
    });
    if (!result || result.ok === false) {
      const status = result && result.error === 'catalog_unavailable' ? 503 : 404;
      return res.status(status).json({
        ok: false,
        error: result && result.error === 'catalog_unavailable'
          ? 'Trait catalog unavailable. Ensure DoginalDogsCatalog.json is present.'
          : (result && result.error) || 'No matching trait found.',
        matches: (result && result.matches) || []
      });
    }
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(result);
  } catch (err) {
    console.error('[dd-evaluator] trait-search:', err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      error: (err && err.message) ? String(err.message) : CLIENT_INTERNAL_ERROR
    });
  }
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

router.get('/admin/trending', (req, res, next) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  next();
}, requireSnapshot, async (req, res) => {
  try {
    const evaluator = await loadEvaluator();
    const dashboard = await evaluator.getTrendingDashboardData();
    dashboard.saveEnabled = getExpectedDdAdminPassword() != null;
    res.set('Cache-Control', 'no-store');
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

  try {
    const evaluator = await loadEvaluator();
    await evaluator.updateTrendingConfig(config);
    const dashboard = await evaluator.getTrendingDashboardData();
    const saveEnabled = getExpectedDdAdminPassword() != null;
    dashboard.saveEnabled = saveEnabled;
    res.json({
      ok: true,
      savedAt: new Date().toISOString(),
      dashboard,
      saveEnabled,
    });
  } catch (err) {
    console.error('[dd-evaluator] admin/trending POST:', err);
    res.status(500).json({ error: 'Failed to save trending config.' });
  }
});

const LORE_MEDIA_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function resolveLoreMediaDir() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'lore-media'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'lore-media'),
  ];
  for (const dir of candidates) {
    const assetsParent = path.dirname(dir);
    if (fs.existsSync(assetsParent) && fs.statSync(assetsParent).isDirectory()) {
      return dir;
    }
  }
  return candidates[0];
}

router.post('/admin/lore-media', (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }

  const dogNumber = Number(req.body?.dogNumber);
  const contentType = String(req.body?.contentType || '').trim().toLowerCase();
  const dataBase64 = String(req.body?.dataBase64 || '').replace(/\s+/g, '');
  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'dogNumber must be 1–10000.' });
  }
  const ext = LORE_MEDIA_MIME[contentType];
  if (!ext) {
    return res.status(400).json({ error: 'Unsupported image type. Use PNG, JPEG, GIF, or WebP.' });
  }
  if (!dataBase64) {
    return res.status(400).json({ error: 'dataBase64 is required.' });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch (_err) {
    return res.status(400).json({ error: 'Invalid base64 image data.' });
  }
  if (!buffer.length || buffer.length > 2.5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image must be between 1 byte and 2.5 MB.' });
  }

  const dir = resolveLoreMediaDir();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    const name = `${dogNumber}-${Date.now()}${ext}`;
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, buffer);
    const imageUrl = `/assets/lore-media/${name}`;
    res.json({ ok: true, imageUrl, dogNumber });
  } catch (err) {
    console.error('[dd-evaluator] lore-media upload:', err);
    res.status(500).json({ error: 'Failed to save lore media.' });
  }
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
    console.error('[dd-evaluator] Evaluations import:', err);
    res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
  }
});

router.get('/community/status', (req, res) => {
  res.json({ communityPasswordRequired: getCommunitySubmitPassword() != null });
});

router.get('/community/lore/:dogNumber', (req, res) => {
  const dogNumber = Number(req.params.dogNumber);
  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'Invalid dog number. Must be 1–10000.' });
  }
  const ns = readCommunityNotesStore();
  const text = lookupCommunityLoreText(ns.notes || {}, dogNumber);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ dogNumber, communityLore: text || null });
});

router.post('/community/suggestions', rateLimitCommunitySuggestions, async (req, res) => {
  const expectedComm = getCommunitySubmitPassword();
  const rawBody = req.body && typeof req.body === 'object' ? req.body : {};
  const headerComm = String(req.headers['x-dd-community-password'] || '').trim();
  const bodyComm = String(rawBody.communityPassword || '').trim();
  const provided = headerComm || bodyComm;

  const bodyCopy = { ...rawBody };
  delete bodyCopy.communityPassword;

  if (expectedComm) {
    if (!timingSafeEqualString(expectedComm, provided)) {
      return res.status(401).json({ error: 'Invalid community password.' });
    }
  }

  const kind = bodyCopy.kind;
  let payload;
  try {
    payload = validateSuggestionPayload(kind, bodyCopy);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid suggestion payload.' });
  }

  const store = readSuggestionsStore();
  const record = {
    id: crypto.randomUUID(),
    status: 'pending',
    kind: kind.trim(),
    payload,
    submittedAt: new Date().toISOString(),
  };
  store.items.push(record);
  writeSuggestionsStore(store);
  res.status(201).json({ ok: true, id: record.id });
});

router.get('/admin/community-notes/list', (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  const ns = readCommunityNotesStore();
  const notes = ns.notes || {};
  const entries = Object.entries(notes)
    .map(([k, v]) => {
      const loreStr = normalizeCommunityLoreNoteValue(v);
      if (!loreStr) {
        return null;
      }
      const ks = String(k).trim();
      if (!/^\d+$/.test(ks)) {
        return null;
      }
      const dn = Number(ks);
      if (!Number.isInteger(dn) || dn < 1 || dn > 10000) {
        return null;
      }
      let loreMultiplier = null;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const m = v.loreMultiplier ?? v.multiplier;
        if (m != null && Number.isFinite(Number(m))) {
          loreMultiplier = Number(m);
        }
      }
      return { dogNumber: dn, lore: loreStr, loreMultiplier };
    })
    .filter(Boolean)
    .sort((a, b) => a.dogNumber - b.dogNumber);
  res.set('Cache-Control', 'no-store');
  res.json({ entries, count: entries.length });
});

router.post('/admin/community-notes/save', (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  const dogNumber = Number(req.body?.dogNumber);
  const lore = req.body?.lore != null ? String(req.body.lore).trim() : '';
  let loreMultiplier = req.body?.loreMultiplier != null ? Number(req.body.loreMultiplier) : null;
  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'dogNumber must be 1–10000.' });
  }
  if (!lore) {
    return res.status(400).json({ error: 'lore is required.' });
  }
  if (lore.length > 8000) {
    return res.status(400).json({ error: 'lore is too long (max 8000 characters).' });
  }
  if (loreMultiplier != null && !Number.isFinite(loreMultiplier)) {
    return res.status(400).json({ error: 'loreMultiplier must be a finite number.' });
  }
  if (loreMultiplier != null && (loreMultiplier > 100 || loreMultiplier < -0.99)) {
    return res.status(400).json({ error: 'loreMultiplier must be between -0.99 and 100.' });
  }
  const ns = readCommunityNotesStore();
  const notes = { ...(ns.notes || {}) };
  for (const k of Object.keys(notes)) {
    if (Number(k) === dogNumber || String(k) === String(dogNumber)) {
      delete notes[k];
    }
  }
  notes[String(dogNumber)] = loreMultiplier != null && Number.isFinite(loreMultiplier)
    ? { lore, loreMultiplier }
    : lore;
  writeCommunityNotesStore({ ...ns, notes });
  res.json({
    ok: true,
    dogNumber,
    communityNotesDogCount: communityNotesDogCount(),
  });
});

router.post('/admin/community-notes/delete', async (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  const dogNumber = Number(req.body?.dogNumber);
  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return res.status(400).json({ error: 'dogNumber must be 1–10000.' });
  }
  const ns = readCommunityNotesStore();
  const notes = { ...(ns.notes || {}) };
  let removed = false;
  for (const k of Object.keys(notes)) {
    if (Number(k) === dogNumber || String(k) === String(dogNumber)) {
      delete notes[k];
      removed = true;
    }
  }
  writeCommunityNotesStore({ ...ns, notes });
  res.json({
    ok: true,
    dogNumber,
    removed,
    communityNotesDogCount: communityNotesDogCount(),
  });
});

router.get('/admin/suggestions', async (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  const statusFilter = String(req.query.status || '').trim().toLowerCase();
  const store = readSuggestionsStore();
  let items = store.items || [];
  if (statusFilter === 'pending' || statusFilter === 'approved' || statusFilter === 'rejected') {
    items = items.filter(it => it.status === statusFilter);
  }
  res.json({
    items,
    communityNotesDogCount: communityNotesDogCount(),
  });
});

router.post('/admin/suggestions/:id/review', async (req, res) => {
  if (!verifyDdAdminPassword(req, res)) {
    return;
  }
  const suggestionId = String(req.params.id || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || '').trim().toLowerCase();
  const note = body.note != null ? String(body.note).trim() : '';

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'action must be approve or reject.' });
  }

  const store = readSuggestionsStore();
  const idx = store.items.findIndex(it => String(it.id) === suggestionId);
  if (idx < 0) {
    return res.status(404).json({ error: 'Suggestion not found.' });
  }

  const item = store.items[idx];
  if (item.status !== 'pending') {
    return res.status(400).json({ error: 'Suggestion is not pending.' });
  }

  const reviewedAt = new Date().toISOString();

  if (action === 'reject') {
    item.status = 'rejected';
    item.reviewedAt = reviewedAt;
    item.reviewNote = note || null;
    store.items[idx] = item;
    writeSuggestionsStore(store);
    return res.json({ ok: true, suggestion: item });
  }

  try {
    const mergeResult = await mergeApprovedSuggestion(item);
    item.status = 'approved';
    item.reviewedAt = reviewedAt;
    item.reviewNote = note || null;
    item.mergeResult = mergeResult;
    store.items[idx] = item;
    writeSuggestionsStore(store);
    return res.json({ ok: true, suggestion: item });
  } catch (err) {
    console.error('Approve suggestion merge failed:', err);
    return res.status(500).json({ error: CLIENT_INTERNAL_ERROR });
  }
});

module.exports = router;
module.exports.initEvaluator = initEvaluator;
module.exports.getExpectedDdAdminPassword = getExpectedDdAdminPassword;
module.exports.getAdminUiPassword = getAdminUiPassword;
module.exports.getCommunitySubmitPassword = getCommunitySubmitPassword;
module.exports.resolveAdminHtmlGatePassword = resolveAdminHtmlGatePassword;
