/**
 * DDScraper — Price Evaluation Engine
 *
 * Builds a trait-based pricing model from active listings on market.doginaldogs.com.
 * Caches a market snapshot and refreshes on a configurable interval (default 12h).
 *
 * Valuation approach:
 *  1. Fetch all active listings + DOGE/USD rate + trait metadata.
 *  2. For each listed dog, fetch its traits and bucket it by each trait value.
 *  3. Per trait value compute: floor, median, mean, count of listed dogs.
 *  4. Collection-wide stats: overall floor, median, mean, total listed.
 *  5. To evaluate a single dog:
 *     - Look up its traits
 *     - For each trait → get the trait-value floor price from the snapshot
 *     - Estimated value = weighted average of per-trait floors,
 *       adjusted by rarity rank percentile.
 *     - If the dog is currently listed, compare asking price to estimate.
 */

import {
  getDogecoinPrice,
  getTraitValues,
  getWalletData,
  getAllListings,
  getGlobalActivity,
  getAllGlobalActivity,
  getDogTraits,
  searchDog,
  normaliseListing,
  dogNumberFromName,
  rarityLabel,
  MARKET_BASE,
  TRAIT_KEYS
} from './api.js';
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_TRENDING_CONFIG = Object.freeze({
  manualMultipliers: Object.freeze({
    'head:Wizard': 1.5,
    'head:Beret': 1.25,
    'clothes:Suit': 1.5,
  }),
  refusedOffers: Object.freeze({}),
  autoTrend: Object.freeze({
    enabled: true,
    maxTraitCount: 800,
    minSaleCount: 2,
    minSalesPercent: 0.005,
    saleWeight: 0.06,
    salesPercentWeight: 10,
    listingWeight: 1.5,
    maxMultiplier: 2.5,
    disabledTrendKeys: Object.freeze([]),
  }),
  specialMultipliers: Object.freeze({
    colorMatch: Object.freeze({ enabled: true, multiplier: 1.10 }),
    minimalTiers: Object.freeze({
      black_classic_visor: Object.freeze({ enabled: true, multiplier: 1.20 }),
      black_classic: Object.freeze({ enabled: true, multiplier: 1.15 }),
      visor_minimal: Object.freeze({ enabled: true, multiplier: 1.15 }),
      ultra_clean: Object.freeze({ enabled: true, multiplier: 1.10 }),
      minimal_1: Object.freeze({ enabled: true, multiplier: 1.05 }),
      minimal_2: Object.freeze({ enabled: true, multiplier: 1.01 }),
    }),
    combos: Object.freeze([]),
    angelNumbers: Object.freeze({
      quadRepeater: Object.freeze({ enabled: true, multiplier: 1.25 }),
      tripleRepeater: Object.freeze({ enabled: true, multiplier: 1.15 }),
      trendNumbers: Object.freeze({
        '67': Object.freeze({ enabled: true, multiplier: 1.10 }),
        '69': Object.freeze({ enabled: true, multiplier: 1.10 }),
        '420': Object.freeze({ enabled: true, multiplier: 1.10 }),
      }),
    }),
  }),
  updatedAt: null,
  updatedBy: 'system',
});

const TRENDING_CONFIG_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_TRENDING_CONFIG_PATH ? resolve(process.cwd(), process.env.DD_TRENDING_CONFIG_PATH) : null,
  resolve(__dirname, '..', '..', 'server', 'data', 'dd-trending-config.json'),
].filter(Boolean));

const COMMUNITY_NOTES_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_COMMUNITY_NOTES_PATH ? resolve(process.cwd(), process.env.DD_COMMUNITY_NOTES_PATH) : null,
  resolve(__dirname, '..', '..', 'server', 'data', 'dd-community-notes.json'),
].filter(Boolean));

const EVALUATION_LOG_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_EVALUATION_LOG_PATH ? resolve(process.cwd(), process.env.DD_EVALUATION_LOG_PATH) : null,
  resolve(__dirname, '..', '..', 'server', 'data', 'dd-evaluation-log.ndjson'),
].filter(Boolean));

const RECENT_EVALUATION_LOOKBACK_HOURS = 48;

/** Positive values are direct multipliers (min 0.01); negative values use (1 + m), e.g. -0.2 → ×0.8. */
function normalizeSignedPriceMultiplier(m) {
  if (m == null || !Number.isFinite(Number(m))) {
    return 1;
  }
  const x = Number(m);
  if (x === 0) {
    return 1;
  }
  if (x > 0) {
    return Math.max(0.01, Math.min(100, x));
  }
  return Math.max(0.01, 1 + x);
}

let _trendingConfigCache = null;
let _trendingConfigLoadedAt = 0;
let _liveDogeUsdCache = { value: null, fetchedAt: 0 };

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSaleActivityState(sale) {
  const confirmedAt = sale?.confirmedAt || sale?.confirmed_at || null;
  const fallbackDate = sale?.createdAt || sale?.date || null;
  const saleDate = confirmedAt || fallbackDate;

  return {
    status: 'sale',
    confirmedAt: saleDate,
    date: saleDate,
    isConfirmed: true,
  };
}

function selectTopSales(sales, limit = 5) {
  const sorted = [...(Array.isArray(sales) ? sales : [])]
    .sort((left, right) => Number(right?.priceDoge || 0) - Number(left?.priceDoge || 0));
  return sorted.slice(0, limit);
}

function buildTopAllTimeSales(activities = [], limit = 5) {
  return selectTopSales((Array.isArray(activities) ? activities : [])
    .filter(activity => activity?.activityType === 'sale')
    .map(activity => {
      const saleState = normalizeSaleActivityState(activity);
      return {
        dogNumber: dogNumberFromName(activity?.dogName),
        name: activity?.dogName || null,
        priceDoge: Number(activity?.priceDoge),
        status: saleState.status,
        date: saleState.date,
        confirmedAt: saleState.confirmedAt,
        isConfirmed: saleState.isConfirmed,
        txid: activity?.txid || null,
      };
    }), limit);
}

// Color keywords for the color-match bonus metric
const COLOR_MATCH_WORDS = [
  'gold', 'silver', 'black', 'white', 'red', 'blue', 'green', 'yellow',
  'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'cyan', 'teal',
  'navy', 'cream', 'tan', 'beige', 'olive', 'diamond', 'crimson', 'violet',
];

function extractDominantColor(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const color of COLOR_MATCH_WORDS) {
    if (lower.includes(color)) return color;
  }
  return null;
}

// Base traits every dog has — only extras beyond these count toward the minimal-dog metric
const MINIMAL_BASE_KEYS = new Set(['background', 'furColor', 'furPattern', 'head']);
const MINIMAL_META_KEYS = new Set(['rarityRank', 'traitCounts']);

function traitCategoryLabel(key) {
  if (key === 'furColor') return 'Fur Color';
  if (key === 'furPattern') return 'Fur Pattern';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return null;
  return +number.toFixed(4);
}

function normalizeTrendKeyList(input) {
  const values = Array.isArray(input)
    ? input
    : (input && typeof input === 'object'
      ? Object.entries(input).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key)
      : []);
  const seen = new Set();
  const trendKeys = [];

  for (const rawValue of values) {
    const trendKey = String(rawValue || '').trim();
    if (!trendKey || seen.has(trendKey)) {
      continue;
    }
    seen.add(trendKey);
    trendKeys.push(trendKey);
  }

  return trendKeys;
}

function normalizeSpecialMultipliers(raw = {}) {
  const TIER_DEFAULTS = {
    black_classic_visor: 1.20,
    black_classic: 1.15,
    visor_minimal: 1.15,
    ultra_clean: 1.10,
    minimal_1: 1.05,
    minimal_2: 1.01,
  };

  const cmRaw = raw?.colorMatch && typeof raw.colorMatch === 'object' ? raw.colorMatch : {};
  const colorMatch = {
    enabled: cmRaw.enabled !== false,
    multiplier: Math.max(1.0, Number(cmRaw.multiplier) || 1.10),
  };

  const tiersSource = raw?.minimalTiers && typeof raw.minimalTiers === 'object' ? raw.minimalTiers : {};
  const minimalTiers = {};
  for (const [id, def] of Object.entries(TIER_DEFAULTS)) {
    const entry = tiersSource[id] && typeof tiersSource[id] === 'object' ? tiersSource[id] : {};
    minimalTiers[id] = {
      enabled: entry.enabled !== false,
      multiplier: Math.max(1.0, Number(entry.multiplier) || def),
    };
  }

  const combosSource = Array.isArray(raw?.combos) ? raw.combos : [];
  const combos = [];
  for (const combo of combosSource) {
    if (!combo || typeof combo !== 'object') continue;
    const conditions = Array.isArray(combo.conditions)
      ? combo.conditions.filter(c => {
          if (!c || typeof c !== 'object' || !c.trait) return false;
          const v = String(c.value ?? '').trim();
          return v.length > 0;
        })
      : [];
    if (conditions.length === 0) continue;
    const multiplier = Number(combo.multiplier);
    if (!Number.isFinite(multiplier) || multiplier === 0) continue;
    combos.push({
      id: String(combo.id || ''),
      label: String(combo.label || ''),
      conditions: conditions.map(c => ({
        trait: String(c.trait),
        op: c.op === 'contains' ? 'contains' : 'eq',
        value: String(c.value).trim(),
      })),
      multiplier,
      enabled: combo.enabled !== false,
    });
  }

  const angelRaw = raw?.angelNumbers && typeof raw.angelNumbers === 'object' ? raw.angelNumbers : {};
  const angelNumbers = {
    quadRepeater: {
      enabled: angelRaw.quadRepeater?.enabled !== false,
      multiplier: Math.max(1.0, Number(angelRaw.quadRepeater?.multiplier) || 1.25),
    },
    tripleRepeater: {
      enabled: angelRaw.tripleRepeater?.enabled !== false,
      multiplier: Math.max(1.0, Number(angelRaw.tripleRepeater?.multiplier) || 1.15),
    },
    trendNumbers: {
      '67': {
        enabled: angelRaw.trendNumbers?.['67']?.enabled !== false,
        multiplier: Math.max(1.0, Number(angelRaw.trendNumbers?.['67']?.multiplier) || 1.10),
      },
      '69': {
        enabled: angelRaw.trendNumbers?.['69']?.enabled !== false,
        multiplier: Math.max(1.0, Number(angelRaw.trendNumbers?.['69']?.multiplier) || 1.10),
      },
      '420': {
        enabled: angelRaw.trendNumbers?.['420']?.enabled !== false,
        multiplier: Math.max(1.0, Number(angelRaw.trendNumbers?.['420']?.multiplier) || 1.10),
      },
    },
  };

  return { colorMatch, minimalTiers, combos, angelNumbers };
}

function normalizeTrendingConfig(raw = {}) {
  const manualSource = raw?.manualMultipliers && typeof raw.manualMultipliers === 'object'
    ? raw.manualMultipliers
    : DEFAULT_TRENDING_CONFIG.manualMultipliers;
  const manualMultipliers = {};

  for (const [key, value] of Object.entries(manualSource)) {
    const normalized = normalizeMultiplier(value);
    if (normalized != null) {
      manualMultipliers[key] = normalized;
    }
  }

  const refusedSource = raw?.refusedOffers && typeof raw.refusedOffers === 'object'
    ? raw.refusedOffers
    : DEFAULT_TRENDING_CONFIG.refusedOffers;
  const refusedOffers = {};

  for (const [dogNumber, value] of Object.entries(refusedSource)) {
    const normalizedDogNumber = Number(dogNumber);
    if (!Number.isInteger(normalizedDogNumber) || normalizedDogNumber < 1 || normalizedDogNumber > 10000) {
      continue;
    }

    let entry = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const minOfferUsd = Number(value.minOfferUsd);
      const minOfferDoge = Number(value.minOfferDoge);
      if ((Number.isFinite(minOfferUsd) && minOfferUsd > 0) || (Number.isFinite(minOfferDoge) && minOfferDoge > 0)) {
        entry = {
          dogNumber: normalizedDogNumber,
          minOfferUsd: Number.isFinite(minOfferUsd) && minOfferUsd > 0 ? +minOfferUsd.toFixed(2) : null,
          minOfferDoge: Number.isFinite(minOfferDoge) && minOfferDoge > 0 ? Math.round(minOfferDoge) : null,
          note: String(value.note || '').trim() || null,
          updatedAt: value.updatedAt || null,
          updatedBy: value.updatedBy || null,
        };
      }
    } else {
      const minOfferDoge = Number(value);
      if (Number.isFinite(minOfferDoge) && minOfferDoge > 0) {
        entry = {
          dogNumber: normalizedDogNumber,
          minOfferDoge: Math.round(minOfferDoge),
          note: null,
          updatedAt: null,
          updatedBy: null,
        };
      }
    }

    if (entry) {
      refusedOffers[String(normalizedDogNumber)] = entry;
    }
  }

  const autoSource = raw?.autoTrend && typeof raw.autoTrend === 'object'
    ? raw.autoTrend
    : DEFAULT_TRENDING_CONFIG.autoTrend;
  const autoTrend = {
    enabled: autoSource.enabled !== false,
    maxTraitCount: Math.max(1, Number(autoSource.maxTraitCount) || DEFAULT_TRENDING_CONFIG.autoTrend.maxTraitCount),
    minSaleCount: Math.max(1, Number(autoSource.minSaleCount) || DEFAULT_TRENDING_CONFIG.autoTrend.minSaleCount),
    minSalesPercent: Math.max(0, Number(autoSource.minSalesPercent) || DEFAULT_TRENDING_CONFIG.autoTrend.minSalesPercent),
    saleWeight: Math.max(0, Number(autoSource.saleWeight) || DEFAULT_TRENDING_CONFIG.autoTrend.saleWeight),
    salesPercentWeight: Math.max(0, Number(autoSource.salesPercentWeight) || DEFAULT_TRENDING_CONFIG.autoTrend.salesPercentWeight),
    listingWeight: Math.max(0, Number(autoSource.listingWeight) || DEFAULT_TRENDING_CONFIG.autoTrend.listingWeight),
    maxMultiplier: Math.max(1, Number(autoSource.maxMultiplier) || DEFAULT_TRENDING_CONFIG.autoTrend.maxMultiplier),
    disabledTrendKeys: normalizeTrendKeyList(autoSource.disabledTrendKeys),
  };

  return {
    manualMultipliers,
    refusedOffers,
    autoTrend,
    specialMultipliers: normalizeSpecialMultipliers(raw?.specialMultipliers),
    updatedAt: raw?.updatedAt || DEFAULT_TRENDING_CONFIG.updatedAt,
    updatedBy: raw?.updatedBy || DEFAULT_TRENDING_CONFIG.updatedBy,
  };
}

function extractLoreEntryPayload(raw) {
  if (raw == null) {
    return { text: '', loreMultiplier: null };
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    return { text, loreMultiplier: null };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const loreRaw = raw.lore ?? raw.text ?? raw.body;
    const text = typeof loreRaw === 'string' ? loreRaw.trim() : '';
    let loreMultiplier = raw.loreMultiplier ?? raw.multiplier;
    if (loreMultiplier != null) {
      loreMultiplier = Number(loreMultiplier);
      if (!Number.isFinite(loreMultiplier)) {
        loreMultiplier = null;
      }
    }
    return { text, loreMultiplier };
  }
  return { text: '', loreMultiplier: null };
}

function lookupCommunityNoteEntry(notes, dogNumber) {
  if (!notes || typeof notes !== 'object' || dogNumber == null) {
    return null;
  }
  const n = Number(dogNumber);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    return null;
  }
  for (const k of [String(n), String(Math.trunc(n))]) {
    const v = notes[k];
    const payload = extractLoreEntryPayload(v);
    if (payload.text) {
      return payload;
    }
  }
  for (const [k, v] of Object.entries(notes)) {
    const payload = extractLoreEntryPayload(v);
    if (!payload.text) {
      continue;
    }
    const kn = Number(k);
    if (Number.isInteger(kn) && kn === n) {
      return payload;
    }
    if (String(k).trim() === String(n)) {
      return payload;
    }
  }
  return null;
}

/** @deprecated Use lookupCommunityNoteEntry; kept for older call sites */
function lookupLoreInNotesMap(notes, dogNumber) {
  const entry = lookupCommunityNoteEntry(notes, dogNumber);
  return entry?.text || null;
}

async function readCommunityLoreForDog(dogNumber) {
  for (const filePath of COMMUNITY_NOTES_CANDIDATE_PATHS) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const notes = parsed?.notes && typeof parsed.notes === 'object' ? { ...parsed.notes } : {};
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (k === 'version' || k === 'notes') continue;
          notes[k] = v;
        }
      }
      const entry = lookupCommunityNoteEntry(notes, dogNumber);
      if (entry && entry.text) {
        return {
          text: entry.text,
          loreMultiplier: entry.loreMultiplier,
        };
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }
  return null;
}

/** Mark trait breakdown rows that satisfied part of matched combo(s). */
function annotateTraitBreakdownForCombo(traitBreakdown, traits, matchedCombos) {
  if (!matchedCombos || matchedCombos.length === 0 || !Array.isArray(traitBreakdown)) return;
  const labels = matchedCombos.map(c => c.label).filter(Boolean);
  const comboLabel = labels.join(' · ') || 'Combo';
  const comboId = matchedCombos.length === 1 ? matchedCombos[0].id : 'combo-stack';
  for (const tb of traitBreakdown) {
    if (tb.isSynthetic) continue;
    const hit = matchedCombos.some(combo => {
      const conditions = Array.isArray(combo.conditions) ? combo.conditions : [];
      return conditions.some(cond => {
        if (!cond || cond.trait !== tb.trait) return false;
        const val = traits[tb.trait];
        if (val == null) return false;
        const sv = String(val).toLowerCase().trim();
        const cv = String(cond.value || '').toLowerCase().trim();
        if (!cv) return false;
        if (cv === 'any') return true;
        return cond.op === 'contains' ? sv.includes(cv) : sv === cv;
      });
    });
    if (hit) {
      tb.comboPart = { id: comboId, label: comboLabel };
    }
  }
}

async function getTrendingConfig(forceRefresh = false) {
  if (!forceRefresh && _trendingConfigCache && (Date.now() - _trendingConfigLoadedAt) < 10000) {
    return deepClone(_trendingConfigCache);
  }

  for (const filePath of TRENDING_CONFIG_CANDIDATE_PATHS) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const normalized = normalizeTrendingConfig(parsed);
      _trendingConfigCache = normalized;
      _trendingConfigLoadedAt = Date.now();
      return deepClone(normalized);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }

  const fallback = normalizeTrendingConfig(DEFAULT_TRENDING_CONFIG);
  _trendingConfigCache = fallback;
  _trendingConfigLoadedAt = Date.now();
  return deepClone(fallback);
}

async function updateTrendingConfig(nextConfig = {}) {
  const current = await getTrendingConfig(true);
  const updatedAt = new Date().toISOString();
  const updatedBy = nextConfig.updatedBy || current.updatedBy || 'admin';
  const nextRefusedOffers = nextConfig.refusedOffers && typeof nextConfig.refusedOffers === 'object'
    ? Object.fromEntries(Object.entries(nextConfig.refusedOffers).map(([dogNumber, value]) => {
        const currentEntry = current.refusedOffers?.[dogNumber] || {};
        const nextEntry = value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : { minOfferDoge: value };

        return [dogNumber, {
          ...currentEntry,
          ...nextEntry,
          updatedAt,
          updatedBy,
        }];
      }))
    : current.refusedOffers;
  const normalized = normalizeTrendingConfig({
    ...current,
    ...nextConfig,
    manualMultipliers: nextConfig.manualMultipliers ?? current.manualMultipliers,
    refusedOffers: nextRefusedOffers,
    autoTrend: {
      ...current.autoTrend,
      ...(nextConfig.autoTrend || {}),
    },
    specialMultipliers: nextConfig.specialMultipliers !== undefined
      ? nextConfig.specialMultipliers
      : current.specialMultipliers,
    updatedAt,
    updatedBy,
  });

  const targetPath = TRENDING_CONFIG_CANDIDATE_PATHS[0];
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  _trendingConfigCache = normalized;
  _trendingConfigLoadedAt = Date.now();
  return deepClone(normalized);
}

async function getLiveDogeUsd(ttlMs = 60000) {
  const now = Date.now();
  if (_liveDogeUsdCache.value != null && (now - _liveDogeUsdCache.fetchedAt) < ttlMs) {
    return _liveDogeUsdCache.value;
  }

  const liveValue = Number(await getDogecoinPrice().catch(() => NaN));
  if (Number.isFinite(liveValue) && liveValue > 0) {
    _liveDogeUsdCache = { value: liveValue, fetchedAt: now };
    return liveValue;
  }

  return _snapshot?.dogeUsd ?? null;
}

function buildTrendingSummary(snapshot, config) {
  const manualMultipliers = {};
  for (const [key, value] of Object.entries(config?.manualMultipliers || {})) {
    const normalized = normalizeMultiplier(value);
    if (normalized != null) {
      manualMultipliers[key] = normalized;
    }
  }

  const autoMultipliers = {};
  const autoConfig = config?.autoTrend || DEFAULT_TRENDING_CONFIG.autoTrend;
  const suppressedTrendKeys = new Set(autoConfig.disabledTrendKeys || []);
  const traitCounts = snapshot?.traitMeta?.counts || {};

  if (snapshot && autoConfig.enabled) {
    for (const traitKey of TRAIT_KEYS) {
      const category = traitCategoryLabel(traitKey);
      const values = traitCounts[category] || {};

      for (const [value, count] of Object.entries(values)) {
        const traitCount = Number(count);
        if (!Number.isFinite(traitCount) || traitCount < 1 || traitCount > autoConfig.maxTraitCount) {
          continue;
        }

        const saleCount = Number(snapshot.saleTraitStats?.[traitKey]?.[value]?.count || 0);
        const listedCount = Number(snapshot.traitStats?.[traitKey]?.[value]?.listed || 0);
        const salesPercent = saleCount / traitCount;
        const listedPercent = listedCount / traitCount;

        if (saleCount < autoConfig.minSaleCount && salesPercent < autoConfig.minSalesPercent) {
          continue;
        }

        const multiplier = Math.min(
          autoConfig.maxMultiplier,
          +(1 + (saleCount * autoConfig.saleWeight) + (salesPercent * autoConfig.salesPercentWeight) + (listedPercent * autoConfig.listingWeight)).toFixed(2)
        );
        if (multiplier <= 1) {
          continue;
        }

        autoMultipliers[`${traitKey}:${value}`] = {
          multiplier,
          saleCount,
          salesPercent: +salesPercent.toFixed(4),
          listedCount,
          listedPercent: +listedPercent.toFixed(4),
          traitCount,
        };
      }
    }
  }

  const effectiveMultipliers = {};
  const keys = new Set([...Object.keys(manualMultipliers), ...Object.keys(autoMultipliers)]);
  for (const key of keys) {
    const manual = manualMultipliers[key] ?? null;
    const auto = autoMultipliers[key]?.multiplier ?? null;
    const multiplier = manual ?? (suppressedTrendKeys.has(key) ? null : auto);
    if (multiplier == null) {
      continue;
    }
    effectiveMultipliers[key] = {
      ...(autoMultipliers[key] || {}),
      multiplier,
      manualMultiplier: manual,
      autoMultiplier: auto,
      source: manual != null ? 'manual' : 'auto',
    };
  }

  return { manualMultipliers, autoMultipliers, effectiveMultipliers };
}

function classifyTraitRarityBand(traitCount) {
  if (traitCount == null) return 'unknown';
  if (traitCount <= 100) return 'ultra-rare';
  if (traitCount <= 250) return 'very rare';
  if (traitCount <= 500) return 'rare';
  if (traitCount <= 800) return 'notable';
  if (traitCount <= 1500) return 'scarce';
  return 'common';
}

function formatTrendReason(entry) {
  if (!entry) return 'No trend applied.';

  if (entry.source === 'manual') {
    if (entry.manualMultiplier != null && entry.autoMultiplier != null) {
      return `Manual override ${entry.manualMultiplier.toFixed(2)}x over auto ${entry.autoMultiplier.toFixed(2)}x.`;
    }
    if (entry.manualMultiplier != null) {
      return `Manual override ${entry.manualMultiplier.toFixed(2)}x.`;
    }
  }

  if (entry.source === 'auto' && entry.autoMultiplier != null) {
    const notes = [];
    if (entry.autoMetrics?.salesPercent != null) {
      notes.push(`${(entry.autoMetrics.salesPercent * 100).toFixed(2)}% sold`);
    }
    if (entry.autoMetrics?.listedPercent != null) {
      notes.push(`${(entry.autoMetrics.listedPercent * 100).toFixed(2)}% listed`);
    }
    return `Auto trend ${entry.autoMultiplier.toFixed(2)}x from ${notes.join(' · ') || 'recent market activity'}.`;
  }

  if (entry.autoSuppressed) {
    return entry.autoMultiplier != null
      ? `Auto signal ${entry.autoMultiplier.toFixed(2)}x is suppressed in pricing.`
      : 'Auto signal is suppressed in pricing.';
  }

  return 'No trend applied.';
}

function buildTraitTopSaleMap(snapshot) {
  const map = Object.create(null);
  const recentSales = Array.isArray(snapshot?.recentSales) ? snapshot.recentSales : [];
  const traitMap = snapshot?.traitMap || {};

  for (const sale of recentSales) {
    const dogNumber = Number(sale?.dogNumber);
    const priceDoge = Number(sale?.priceDoge);
    if (!Number.isFinite(dogNumber) || !Number.isFinite(priceDoge) || priceDoge <= 0) {
      continue;
    }

    const traits = traitMap[dogNumber];
    if (!traits) continue;

    for (const traitKey of TRAIT_KEYS) {
      const value = traits[traitKey];
      if (!value) continue;
      const trendKey = `${traitKey}:${value}`;
      map[trendKey] = map[trendKey] != null ? Math.max(map[trendKey], priceDoge) : priceDoge;
    }
  }

  return map;
}

function resolveTraitTopSaleSignal({ trendKey, value, traitCount, saleStats, listingStats, rawTopSaleMap }) {
  let traitTopSale = rawTopSaleMap[trendKey] ?? null;
  const alwaysRare = new Set(['Diamond', 'Shiny']);

  if (traitTopSale == null || alwaysRare.has(value) || (traitCount != null && traitCount <= 100)) {
    return traitTopSale;
  }

  if (traitCount != null && traitCount <= 500) {
    if (saleStats?.median != null) {
      const cap = Math.max(saleStats.median * 2, listingStats?.floor ?? 0);
      return Math.min(traitTopSale, cap);
    }
    return traitTopSale;
  }

  if (saleStats?.median != null) {
    return saleStats.median;
  }

  return traitTopSale;
}

function describeBasePriceSignal(entry) {
  const evidence = [
    { source: 'top sale', value: entry.topSaleDoge },
    { source: 'sale median', value: entry.saleMedianDoge },
    { source: 'sale floor', value: entry.saleFloorDoge },
    { source: 'listing floor', value: entry.floorDoge },
  ].filter(signal => signal.value != null && Number.isFinite(Number(signal.value)) && Number(signal.value) > 0);

  const strongest = evidence.reduce((best, current) => {
    if (!best) return current;
    return Number(current.value) > Number(best.value) ? current : best;
  }, null);

  const marketEvidenceCount = (entry.listed > 0 ? 1 : 0) + (entry.saleCount > 0 ? 1 : 0);
  let baseProfile = 'unpriced';
  let baseReason = 'No strong listing or sales signal yet.';

  if (strongest) {
    baseProfile = strongest.source === 'listing floor' ? 'listing-backed' : 'sale-backed';
    baseReason = strongest.source === 'listing floor'
      ? 'Current listing floor is the strongest direct price anchor for this trait.'
      : 'Sales history is the strongest direct price anchor for this trait.';
  }

  if (entry.traitCount != null && entry.traitCount <= 250 && marketEvidenceCount <= 1) {
    baseProfile = 'rarity-led';
    baseReason = strongest
      ? `Direct ${strongest.source} data is thin; the price looks mostly driven by scarcity and stacked rarity.`
      : 'There is little direct market evidence, so the value looks driven mostly by scarcity and stacked rarity.';
  }

  return {
    baseProfile,
    baseReason,
    baseSignalSource: strongest?.source ?? null,
    baseSignalDoge: strongest?.value ?? null,
    marketEvidenceCount,
  };
}

async function getTrendingDashboardData() {
  if (!_snapshot) throw new Error('Snapshot not ready. Wait for first refresh.');

  const config = await getTrendingConfig();
  const summary = buildTrendingSummary(_snapshot, config);
  const suppressedTrendKeys = new Set(config?.autoTrend?.disabledTrendKeys || []);
  const liveDogeUsd = await getLiveDogeUsd().catch(() => _snapshot.dogeUsd);
  const recentEvaluations = (await getEvaluationLog({
    since: new Date(Date.now() - (RECENT_EVALUATION_LOOKBACK_HOURS * 3600000)).toISOString(),
  })).filter(entry => entry.source === 'kushmedia-backfill');
  const traitCounts = _snapshot?.traitMeta?.counts || {};
  const traits = [];
  const rawTopSaleMap = buildTraitTopSaleMap(_snapshot);
  const communityOffers = Object.values(config.refusedOffers || {})
    .map(entry => ({
      dogNumber: entry.dogNumber,
      name: `Doginal Dog #${entry.dogNumber}`,
      imageUrl: `${MARKET_BASE}/dogs/${entry.dogNumber}.png`,
      minOfferUsd: entry.minOfferUsd != null
        ? +Number(entry.minOfferUsd).toFixed(2)
        : (entry.minOfferDoge != null && liveDogeUsd ? +(entry.minOfferDoge * liveDogeUsd).toFixed(2) : null),
      minOfferDoge: entry.minOfferDoge != null
        ? Number(entry.minOfferDoge)
        : (entry.minOfferUsd != null && liveDogeUsd ? Math.round(Number(entry.minOfferUsd) / liveDogeUsd) : null),
      note: entry.note || null,
      updatedAt: entry.updatedAt || null,
      updatedBy: entry.updatedBy || null,
    }))
    .sort((left, right) => left.dogNumber - right.dogNumber);

  for (const traitKey of TRAIT_KEYS) {
    const category = traitCategoryLabel(traitKey);
    const values = traitCounts[category] || {};

    for (const [value, count] of Object.entries(values)) {
      const trendKey = `${traitKey}:${value}`;
      const listingStats = _snapshot.traitStats?.[traitKey]?.[value] || {};
      const saleStats = _snapshot.saleTraitStats?.[traitKey]?.[value] || {};
      const autoEntry = summary.autoMultipliers[trendKey] || null;
      const effectiveEntry = summary.effectiveMultipliers[trendKey] || null;
      const traitCount = Number(count);
      const listed = Number(listingStats.listed || 0);
      const saleCount = Number(saleStats.count || 0);
      const floorDoge = listingStats.floor ?? null;
      const saleFloorDoge = saleStats.floor ?? null;
      const saleMedianDoge = saleStats.median ?? null;
      const topSaleDoge = resolveTraitTopSaleSignal({
        trendKey,
        value,
        traitCount,
        saleStats,
        listingStats,
        rawTopSaleMap,
      });
      const autoMetrics = {
        salesPercent: traitCount > 0 ? +(saleCount / traitCount).toFixed(4) : null,
        listedPercent: traitCount > 0 ? +(listed / traitCount).toFixed(4) : null,
      };
      const source = effectiveEntry?.source || (suppressedTrendKeys.has(trendKey) ? 'suppressed' : 'none');
      const baseSignal = describeBasePriceSignal({
        traitCount,
        listed,
        saleCount,
        floorDoge,
        saleFloorDoge,
        saleMedianDoge,
        topSaleDoge,
      });

      traits.push({
        trendKey,
        trait: traitKey,
        value,
        traitCount,
        rarityBand: classifyTraitRarityBand(traitCount),
        listed,
        saleCount,
        floorDoge,
        floorUsd: floorDoge != null && liveDogeUsd ? +(floorDoge * liveDogeUsd).toFixed(2) : null,
        listingMedianDoge: listingStats.median ?? null,
        listingMeanDoge: listingStats.mean ?? null,
        saleFloorDoge,
        saleMedianDoge,
        topSaleDoge,
        topSaleUsd: topSaleDoge != null && liveDogeUsd ? +(topSaleDoge * liveDogeUsd).toFixed(2) : null,
        manualMultiplier: summary.manualMultipliers[trendKey] ?? null,
        autoMultiplier: autoEntry?.multiplier ?? null,
        autoMetrics,
        autoSuppressed: suppressedTrendKeys.has(trendKey),
        effectiveMultiplier: effectiveEntry?.multiplier ?? 1,
        source,
        trendReason: formatTrendReason({
          manualMultiplier: summary.manualMultipliers[trendKey] ?? null,
          autoMultiplier: autoEntry?.multiplier ?? null,
          autoMetrics,
          autoSuppressed: suppressedTrendKeys.has(trendKey),
          source,
        }),
        baseProfile: baseSignal.baseProfile,
        baseReason: baseSignal.baseReason,
        baseSignalSource: baseSignal.baseSignalSource,
        baseSignalDoge: baseSignal.baseSignalDoge,
        baseSignalUsd: baseSignal.baseSignalDoge != null && liveDogeUsd ? +(baseSignal.baseSignalDoge * liveDogeUsd).toFixed(2) : null,
        marketEvidenceCount: baseSignal.marketEvidenceCount,
      });
    }
  }

  traits.sort((left, right) => (
    left.traitCount - right.traitCount
    || left.trait.localeCompare(right.trait)
    || left.value.localeCompare(right.value)
  ));

  const trendingTraits = traits
    .filter(entry => entry.source !== 'none' || entry.autoSuppressed || entry.autoMultiplier != null)
    .sort((left, right) => (
      (Number(right.effectiveMultiplier || 0) - Number(left.effectiveMultiplier || 0))
      || (Number(right.autoMultiplier || 0) - Number(left.autoMultiplier || 0))
      || (left.traitCount - right.traitCount)
      || left.trait.localeCompare(right.trait)
      || left.value.localeCompare(right.value)
    ));

  const basePriceTraits = traits
    .filter(entry => entry.baseProfile !== 'unpriced')
    .sort((left, right) => (
      (Number(right.baseSignalDoge || 0) - Number(left.baseSignalDoge || 0))
      || (left.traitCount - right.traitCount)
      || left.trait.localeCompare(right.trait)
      || left.value.localeCompare(right.value)
    ));

  return {
    generatedAt: new Date().toISOString(),
    snapshot: {
      builtAt: _snapshot.builtAt,
      totalListed: _snapshot.collectionStats.totalListed,
      dogeUsd: liveDogeUsd,
    },
    config,
    communityOffers,
    recentEvaluations,
    trendingTraits,
    basePriceTraits,
    traits,
  };
}

function normalizeEvaluationLogEntry(entry = {}) {
  const dogNumber = Number(entry.dogNumber);
  if (!Number.isInteger(dogNumber) || dogNumber < 1 || dogNumber > 10000) {
    return null;
  }

  const evaluatedAtValue = entry.evaluatedAt ? new Date(entry.evaluatedAt) : new Date();
  const evaluatedAt = Number.isFinite(evaluatedAtValue.getTime())
    ? evaluatedAtValue.toISOString()
    : new Date().toISOString();
  const estimatedDoge = entry.estimatedDoge != null && Number.isFinite(Number(entry.estimatedDoge))
    ? Number(entry.estimatedDoge)
    : null;
  const estimatedUsd = entry.estimatedUsd != null && Number.isFinite(Number(entry.estimatedUsd))
    ? Number(entry.estimatedUsd)
    : null;
  const rarityRank = entry.rarityRank != null && Number.isFinite(Number(entry.rarityRank))
    ? Number(entry.rarityRank)
    : null;
  const source = String(entry.source || 'node').trim() || 'node';

  return {
    evaluatedAt,
    dogNumber,
    name: entry.name || `Doginal Dog #${dogNumber}`,
    inscriptionId: entry.inscriptionId || null,
    imageUrl: entry.imageUrl || `${MARKET_BASE}/dogs/${dogNumber}.png`,
    estimatedDoge,
    estimatedUsd,
    rarityRank,
    rarityLabel: entry.rarityLabel || null,
    isListed: Boolean(entry.isListed),
    source,
  };
}

function buildEvaluationLogEntry(result, source = 'node', overrides = {}) {
  if (!result || result.error || !Number.isFinite(Number(result.dogNumber))) {
    return null;
  }

  const estimation = result.estimation || {};
  const estimatedDoge = estimation.displayEstimatedDoge != null ? estimation.displayEstimatedDoge : estimation.estimatedDoge;
  const estimatedUsd = estimation.displayEstimatedUsd != null ? estimation.displayEstimatedUsd : estimation.estimatedUsd;

  return normalizeEvaluationLogEntry({
    evaluatedAt: result.evaluatedAt || new Date().toISOString(),
    dogNumber: Number(result.dogNumber),
    name: result.name || `Doginal Dog #${result.dogNumber}`,
    inscriptionId: result.inscriptionId || null,
    imageUrl: result.imageUrl || (result.dogNumber != null ? `${MARKET_BASE}/dogs/${result.dogNumber}.png` : null),
    estimatedDoge,
    estimatedUsd,
    rarityRank: result.rarityRank != null ? Number(result.rarityRank) : null,
    rarityLabel: result.rarityLabel || null,
    isListed: Boolean(result.isListed),
    source,
    ...overrides,
  });
}

async function logEvaluationResult(result, source = 'node', overrides = {}) {
  const entry = buildEvaluationLogEntry(result, source, overrides);
  if (!entry) return null;

  const targetPath = EVALUATION_LOG_CANDIDATE_PATHS[0];
  if (!targetPath) return entry;

  await mkdir(dirname(targetPath), { recursive: true });
  await appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

async function getEvaluationLog(options = 100) {
  const settings = typeof options === 'number'
    ? { limit: options }
    : (options && typeof options === 'object' ? options : {});
  const normalizedLimit = settings.limit == null
    ? null
    : Math.max(1, Math.min(5000, Number(settings.limit) || 100));
  const sinceMs = settings.since ? new Date(settings.since).getTime() : null;
  const reverse = settings.reverse !== false;

  for (const filePath of EVALUATION_LOG_CANDIDATE_PATHS) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const entries = lines.map(line => {
        try {
          return normalizeEvaluationLogEntry(JSON.parse(line));
        } catch (_error) {
          return null;
        }
      }).filter(Boolean).filter(entry => {
        if (!Number.isFinite(sinceMs)) return true;
        return new Date(entry.evaluatedAt).getTime() >= sinceMs;
      });

      const sliced = normalizedLimit == null ? entries : entries.slice(-normalizedLimit);
      return reverse ? [...sliced].reverse() : sliced;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }

  return [];
}

async function clearEvaluationLog(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const source = typeof settings.source === 'string' && settings.source.trim()
    ? settings.source.trim()
    : null;
  const targetPath = EVALUATION_LOG_CANDIDATE_PATHS[0];

  if (!targetPath) {
    return { removedCount: 0, remainingCount: 0, source };
  }

  let raw;
  try {
    raw = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { removedCount: 0, remainingCount: 0, source };
    }
    throw error;
  }

  const keptLines = [];
  let removedCount = 0;

  raw.split(/\r?\n/).forEach(line => {
    if (!line.trim()) {
      return;
    }

    try {
      const entry = normalizeEvaluationLogEntry(JSON.parse(line));
      if (entry && (!source || entry.source === source)) {
        removedCount += 1;
        return;
      }
    } catch (_error) {
      // Preserve malformed lines rather than deleting data we cannot classify.
    }

    keptLines.push(line);
  });

  if (removedCount > 0) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, keptLines.length ? `${keptLines.join('\n')}\n` : '', 'utf8');
  }

  return {
    removedCount,
    remainingCount: keptLines.length,
    source,
  };
}

/* ---- Math helpers ---- */

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker())
  );

  return results;
}

function applyTraitDisplayOverrides(traitBreakdown, displayOverride) {
  if (!displayOverride?.traits) return;

  for (const [traitKey, traitOverride] of Object.entries(displayOverride.traits)) {
    const existing = traitBreakdown.find(entry => entry.trait === traitKey);
    if (existing) {
      existing.displayValue = traitOverride.displayValue ?? existing.value;
      existing.displayTraitCount = traitOverride.displayTraitCount ?? existing.traitCount;
      existing.displayBadge = traitOverride.displayBadge ?? null;
      continue;
    }

    traitBreakdown.push({
      trait: traitKey,
      value: traitOverride.value ?? null,
      floor: null,
      median: null,
      mean: null,
      listed: 0,
      saleFloor: null,
      saleMedian: null,
      saleCount: 0,
      topSale: null,
      traitCount: traitOverride.displayTraitCount ?? null,
      isTopSale: false,
      displayValue: traitOverride.displayValue ?? traitOverride.value ?? null,
      displayTraitCount: traitOverride.displayTraitCount ?? null,
      displayBadge: traitOverride.displayBadge ?? null,
      isSynthetic: true,
    });
  }
}

function resolveValueMultiplier(traitBreakdown, displayOverride) {
  const explicitMultiplier = displayOverride?.estimation?.valueMultiplier;
  if (explicitMultiplier != null) {
    return explicitMultiplier;
  }

  const hasOneOfOneTrait = traitBreakdown.some(entry => (
    entry.displayBadge === '1/1'
    || entry.displayTraitCount === 1
    || (!entry.isSynthetic && entry.traitCount === 1)
  ));

  return hasOneOfOneTrait ? 3 : 1;
}

function summarizeEvaluation(evaluation, dogeUsd) {
  const estimation = evaluation.estimation || {};
  const effectiveEstimatedDoge = estimation.displayEstimatedDoge ?? estimation.estimatedDoge ?? null;
  const effectiveEstimatedUsd = estimation.displayEstimatedUsd
    ?? estimation.estimatedUsd
    ?? (effectiveEstimatedDoge != null && dogeUsd ? +(effectiveEstimatedDoge * dogeUsd).toFixed(2) : null);
  const askingPriceDoge = evaluation.listingAnalysis?.askingPriceDoge ?? null;

  return {
    dogNumber: evaluation.dogNumber,
    name: evaluation.name,
    inscriptionId: evaluation.inscriptionId,
    imageUrl: evaluation.imageUrl,
    isListed: evaluation.isListed,
    rarityRank: evaluation.rarityRank,
    rarityLabel: evaluation.rarityLabel,
    estimatedDoge: effectiveEstimatedDoge,
    estimatedUsd: effectiveEstimatedUsd,
    askingPriceDoge,
    askingPriceUsd: askingPriceDoge != null && dogeUsd ? +(askingPriceDoge * dogeUsd).toFixed(2) : null,
    valueMultiplier: estimation.valueMultiplier ?? null,
    rarestTrait: estimation.rarestTrait ?? null,
    displayEstimatedUsdNote: estimation.displayEstimatedUsdNote ?? null,
  };
}

const DOG_DISPLAY_OVERRIDES = {
  9168: {
    traits: {
      mouth: {
        displayValue: 'Tongue In Mouth',
        displayTraitCount: 1,
        displayBadge: '1/1'
      }
    }
  },
  6164: {
    traits: {
      head: {
        displayValue: 'Wizard Head',
        displayTraitCount: 1,
        displayBadge: '1/1'
      }
    }
  }
};

/* ---- Snapshot cache ---- */

let _snapshot = null;
let _refreshTimer = null;
let _refreshing = false;

function getSnapshot() {
  return _snapshot;
}

function isReady() {
  return _snapshot !== null;
}

/**
 * Build a full market snapshot: listings, trait prices, collection stats.
 */
async function buildSnapshot(log = console.log) {
  log('[evaluator] Refreshing market snapshot...');
  const start = Date.now();

  // Parallel: listings, DOGE price, trait metadata, recent sales, all-time sales
  const [rawListings, dogeUsd, traitMeta, activityData, allActivityData] = await Promise.all([
    getAllListings({ sortBy: 'price', sortOrder: 'asc' }),
    getDogecoinPrice().catch(() => null),
    getTraitValues().catch(() => null),
    getGlobalActivity(100).catch(() => null),
    getAllGlobalActivity({ limit: 100, maxPages: 100 }).catch(() => [])
  ]);

  const listings = rawListings.map(normaliseListing);
  log(`[evaluator] Fetched ${listings.length} active listings. Enriching traits...`);

  // Fetch traits for every listed dog (batched, 5 concurrent)
  const traitMap = {};
  const queue = [...listings];
  const CONCURRENCY = 5;

  async function enrichWorker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item.dogNumber == null) continue;
      try {
        const traits = await getDogTraits(item.dogNumber);
        if (traits) traitMap[item.dogNumber] = traits;
      } catch { /* skip on error */ }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, listings.length) }, () => enrichWorker())
  );

  log(`[evaluator] Enriched traits for ${Object.keys(traitMap).length}/${listings.length} listings.`);

  // Build trait counts from enriched traits
  const traitCounts = {};
  for (const traits of Object.values(traitMap)) {
    for (const key of TRAIT_KEYS) {
      const val = traits[key];
      if (val) {
        if (!traitCounts[key]) traitCounts[key] = {};
        traitCounts[key][val] = (traitCounts[key][val] || 0) + 1;
      }
    }
  }

  // Use built counts if API didn't provide
  if (!traitMeta || !traitMeta.counts) {
    traitMeta = { counts: traitCounts };
  }

  // Build per-trait-value price buckets
  const traitPrices = {};   // { background: { Yellow: [prices...], Blue: [...] }, ... }
  const allPrices = [];

  for (const listing of listings) {
    const dn = listing.dogNumber;
    const price = listing.priceDoge;
    if (dn == null || !price) continue;
    allPrices.push(price);

    const traits = traitMap[dn];
    if (!traits) continue;

    for (const key of TRAIT_KEYS) {
      const val = traits[key];
      if (!val) continue;
      if (!traitPrices[key]) traitPrices[key] = {};
      if (!traitPrices[key][val]) traitPrices[key][val] = [];
      traitPrices[key][val].push(price);
    }
  }

  // Compute stats per trait value
  const traitStats = {};
  for (const [key, values] of Object.entries(traitPrices)) {
    traitStats[key] = {};
    for (const [val, prices] of Object.entries(values)) {
      const sorted = [...prices].sort((a, b) => a - b);
      traitStats[key][val] = {
        floor: sorted[0],
        median: median(sorted),
        mean: +mean(sorted).toFixed(2),
        p25: percentile(sorted, 25),
        p75: percentile(sorted, 75),
        listed: sorted.length,
      };
    }
  }

  // Collection-wide stats
  const sortedAll = [...allPrices].sort((a, b) => a - b);
  const collectionStats = {
    floor: sortedAll[0] || null,
    median: median(sortedAll),
    mean: +mean(sortedAll).toFixed(2),
    p25: percentile(sortedAll, 25),
    p75: percentile(sortedAll, 75),
    totalListed: listings.length,
    dogeUsd: dogeUsd,
  };

  // Recent sales
  const recentSales = (activityData?.activities || [])
    .filter(a => a.activityType === 'sale')
    .map(a => {
      const saleState = normalizeSaleActivityState(a);
      return {
        dogNumber: dogNumberFromName(a.dogName),
        name: a.dogName,
        priceDoge: Number(a.priceDoge),
        status: saleState.status,
        date: saleState.date,
        confirmedAt: saleState.confirmedAt,
        isConfirmed: saleState.isConfirmed,
        txid: a.txid,
      };
    });

  // Enrich traits for recently sold dogs so we can factor sale prices into valuations
  const saleDogs = recentSales.filter(s => s.dogNumber != null && s.priceDoge > 0);
  const saleTraitQueue = saleDogs.filter(s => !traitMap[s.dogNumber]);
  log(`[evaluator] Fetching traits for ${saleTraitQueue.length} recently sold dogs...`);

  const saleQueue = [...saleTraitQueue];
  async function saleEnrichWorker() {
    while (saleQueue.length > 0) {
      const item = saleQueue.shift();
      try {
        const traits = await getDogTraits(item.dogNumber);
        if (traits) traitMap[item.dogNumber] = traits;
      } catch { /* skip on error */ }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, saleQueue.length || 1) }, () => saleEnrichWorker())
  );

  // Build per-trait-value sale price buckets (mirrors traitPrices but from actual sales)
  const saleTraitPrices = {};  // { furColor: { Diamond: [prices...], ... }, ... }
  for (const sale of saleDogs) {
    const traits = traitMap[sale.dogNumber];
    if (!traits) continue;
    for (const key of TRAIT_KEYS) {
      const val = traits[key];
      if (!val) continue;
      if (!saleTraitPrices[key]) saleTraitPrices[key] = {};
      if (!saleTraitPrices[key][val]) saleTraitPrices[key][val] = [];
      saleTraitPrices[key][val].push(sale.priceDoge);
    }
  }

  // Compute stats per trait value from sales
  const saleTraitStats = {};
  for (const [key, values] of Object.entries(saleTraitPrices)) {
    saleTraitStats[key] = {};
    for (const [val, prices] of Object.entries(values)) {
      const sorted = [...prices].sort((a, b) => a - b);
      saleTraitStats[key][val] = {
        floor: sorted[0],
        median: median(sorted),
        mean: +mean(sorted).toFixed(2),
        count: sorted.length,
      };
    }
  }

  log(`[evaluator] Sale trait stats built for ${Object.keys(saleTraitStats).length} trait categories.`);

  // Build listing lookup by dog number
  const listingByDog = {};
  for (const l of listings) {
    if (l.dogNumber != null) listingByDog[l.dogNumber] = l;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`[evaluator] Snapshot built in ${elapsed}s.`);

  _snapshot = {
    builtAt: new Date().toISOString(),
    dogeUsd,
    collectionStats,
    traitStats,
    saleTraitStats,
    traitMeta,
    listings,
    listingByDog,
    traitMap,
    recentSales,
    topAllTimeSales: buildTopAllTimeSales(allActivityData, 5),
  };

  if (dogeUsd != null) {
    _liveDogeUsdCache = { value: dogeUsd, fetchedAt: Date.now() };
  }

  return _snapshot;
}

/**
 * Evaluate a single dog's estimated value.
 */
async function evaluateDog(dogNumber) {
  if (!_snapshot) throw new Error('Snapshot not ready. Wait for first refresh.');

  const displayOverride = DOG_DISPLAY_OVERRIDES[dogNumber] || null;

  const trendingConfig = await getTrendingConfig();
  const trendingSummary = buildTrendingSummary(_snapshot, trendingConfig);
  const refusedOfferFloor = trendingConfig?.refusedOffers?.[String(dogNumber)] || null;
  const { traitStats, saleTraitStats, collectionStats, listingByDog, recentSales } = _snapshot;
  const dogeUsd = await getLiveDogeUsd().catch(() => _snapshot.dogeUsd);
  const traitMeta = _snapshot.traitMeta;

  // Fetch this dog's traits (live, for accuracy — it's one call)
  const [traits, search, lorePack] = await Promise.all([
    getDogTraits(dogNumber),
    searchDog(dogNumber),
    readCommunityLoreForDog(dogNumber).catch(() => null),
  ]);
  const communityLore = lorePack?.text || null;
  const rawCommunityLoreMultiplier = lorePack?.loreMultiplier;

  if (!traits) {
    return { dogNumber, error: 'Could not fetch traits for this dog.' };
  }

  // Check if THIS dog has a recent sale
  const ownSales = recentSales.filter(s => s.dogNumber === dogNumber);
  const ownTopSale = ownSales.length > 0 ? Math.max(...ownSales.map(s => s.priceDoge)) : null;

  // Build trait breakdown with rarity counts and top sale prices
  const traitBreakdown = [];
  const traitCounts = traitMeta?.counts || {};

  for (const key of TRAIT_KEYS) {
    const val = traits[key];
    if (!val) continue;
    const listingStats = traitStats[key]?.[val];
    const saleStats = saleTraitStats[key]?.[val];

    // Trait rarity: how many dogs in the collection have this trait value
    const apiKey = key === 'furColor' ? 'Fur Color'
      : key === 'furPattern' ? 'Fur Pattern'
      : key.charAt(0).toUpperCase() + key.slice(1);
    const traitCount = traitCounts[apiKey]?.[val] ?? null;

    // Top sale = highest price paid for any dog with this trait
    const topSale = saleStats ? Math.max(...(Object.values(saleTraitStats[key][val] ? [saleStats.floor, saleStats.median, saleStats.mean] : [])).filter(v => v != null)) : null;
    // Actually get the raw max from saleTraitPrices — but we only have stats.
    // The "top sale" for a trait is the highest recorded sale price.
    // Since we stored floor/median/mean, the max individual sale is approximated
    // by looking at all sales in the snapshot for this trait.
    let traitTopSale = null;
    if (saleStats) {
      const salesWithTrait = recentSales.filter(s => {
        const st = _snapshot.traitMap[s.dogNumber];
        return st && st[key] === val;
      });
      if (salesWithTrait.length > 0) {
        traitTopSale = Math.max(...salesWithTrait.map(s => s.priceDoge));
      }
    }

    // Tiered topSale cap based on trait rarity so a Diamond dog's sale
    // doesn't inflate moderately-rare traits like Cowboy hat.
    // Always keep full topSale for Diamond, Shiny, or ultra-rare (count <= 100)
    const alwaysRare = new Set(['Diamond', 'Shiny']);
    if (alwaysRare.has(val) || (traitCount != null && traitCount <= 100)) {
      // Truly rare — keep full topSale
    } else if (traitCount != null && traitCount <= 500) {
      // Moderately rare — cap at 2× median or listing floor, whichever is higher
      if (traitTopSale != null && saleStats?.median != null) {
        const cap = Math.max(saleStats.median * 2, listingStats?.floor ?? 0);
        traitTopSale = Math.min(traitTopSale, cap);
      }
    } else {
      // Common trait — cap at median
      if (traitTopSale != null && saleStats?.median != null) {
        traitTopSale = saleStats.median;
      }
    }

    traitBreakdown.push({
      trait: key,
      value: val,
      floor: listingStats?.floor ?? null,
      median: listingStats?.median ?? null,
      mean: listingStats?.mean ?? null,
      listed: listingStats?.listed ?? 0,
      saleFloor: saleStats?.floor ?? null,
      saleMedian: saleStats?.median ?? null,
      saleCount: saleStats?.count ?? 0,
      topSale: traitTopSale,
      traitCount,
      isTopSale: false,  // will be set below
    });
  }

  applyTraitDisplayOverrides(traitBreakdown, displayOverride);
  traitBreakdown.sort((left, right) => TRAIT_KEYS.indexOf(left.trait) - TRAIT_KEYS.indexOf(right.trait));

  // Identify the rarest trait (lowest traitCount) — this drives the valuation
  let rarestTrait = null;
  let rarestCount = Infinity;
  for (const tb of traitBreakdown) {
    if (tb.isSynthetic) continue;
    if (tb.traitCount != null && tb.traitCount < rarestCount) {
      rarestCount = tb.traitCount;
      rarestTrait = tb;
    }
  }

  // Find the highest top-sale price across all traits for "TOP SALE" badge
  let globalTopSalePrice = 0;
  for (const tb of traitBreakdown) {
    if (tb.topSale != null && tb.topSale > globalTopSalePrice) {
      globalTopSalePrice = tb.topSale;
    }
  }
  // Mark traits that hold a significant top sale (exclude background & eyes)
  const topSaleExcluded = new Set(['background', 'eyes']);
  const topSaleThreshold = globalTopSalePrice * 0.5;
  for (const tb of traitBreakdown) {
    if (!topSaleExcluded.has(tb.trait) && tb.topSale != null && tb.topSale >= topSaleThreshold && globalTopSalePrice > 0) {
      tb.isTopSale = true;
    }
  }

  let trendingMultiplier = 1.0;
  const trendingHits = [];
  for (const tb of traitBreakdown) {
    const trendKey = `${tb.trait}:${tb.value}`;
    const trendEntry = trendingSummary.effectiveMultipliers[trendKey];
    if (trendEntry?.multiplier) {
      tb.trending = trendEntry.multiplier;
      tb.trendSource = trendEntry.source;
      trendingHits.push({
        trait: tb.trait,
        value: tb.value,
        multiplier: trendEntry.multiplier,
        source: trendEntry.source,
      });
      if (trendEntry.multiplier > trendingMultiplier) trendingMultiplier = trendEntry.multiplier;
    }
  }

  // --- Valuation logic ---
  // Base = highest of: rarest trait's listing floor, rarest trait's top sale
  let basePriceDoge = null;
  if (rarestTrait) {
    const rFloor = rarestTrait.floor;
    const rSale  = rarestTrait.topSale;
    if (rFloor != null && rSale != null) {
      basePriceDoge = Math.max(rFloor, rSale);
    } else if (rFloor != null) {
      basePriceDoge = rFloor;
    } else if (rSale != null) {
      basePriceDoge = rSale;
    }
  }

  // If this dog itself has sold, use the higher of own sale vs trait-based price
  if (ownTopSale != null) {
    basePriceDoge = basePriceDoge != null ? Math.max(basePriceDoge, ownTopSale) : ownTopSale;
  }

  // Other RARE traits can raise the value (skip common ones with count > 500)
  let traitBonus = 0;
  for (const tb of traitBreakdown) {
    if (tb === rarestTrait) continue;
    if (tb.isSynthetic) continue;
    if (tb.traitCount == null || tb.traitCount > 500) continue;
    const tbPrice = tb.topSale ?? tb.floor ?? null;
    if (tbPrice != null && basePriceDoge != null && tbPrice > basePriceDoge) {
      traitBonus += (tbPrice - basePriceDoge) * 0.2;
    }
  }

  // Rarity multiplier based on overall dog rank
  const rank = traits.rarityRank || 5000;
  const rankPct = rank / 10000;
  let rarityMultiplier = 1.0;
  if (rankPct <= 0.01) rarityMultiplier = 1.5;
  else if (rankPct <= 0.05) rarityMultiplier = 1.25;
  else if (rankPct <= 0.15) rarityMultiplier = 1.1;
  else if (rankPct <= 0.25) rarityMultiplier = 1.05;

  let estimatedDoge = null;
  if (basePriceDoge != null) {
    estimatedDoge = Math.round((basePriceDoge + traitBonus) * rarityMultiplier * trendingMultiplier);
  } else {
    // Fallback: average of available floors × rarity
    const validFloors = traitBreakdown.map(t => t.floor).filter(f => f != null);
    if (validFloors.length > 0) {
      estimatedDoge = Math.round(mean(validFloors) * rarityMultiplier * trendingMultiplier);
    }
  }

  // Never estimate below collection floor
  const collectionFloor = collectionStats.floor ?? null;
  if (estimatedDoge != null && collectionFloor != null && estimatedDoge < collectionFloor) {
    estimatedDoge = Math.round(collectionFloor);
  }

  // Scarcity bonus for dogs with many unlisted/unsold trait values
  const unlistedTraits = traitBreakdown.filter(t => !t.isSynthetic && t.listed === 0 && t.saleCount === 0).length;
  if (unlistedTraits >= 3 && estimatedDoge != null) {
    estimatedDoge = Math.round(estimatedDoge * 1.15);
  }

  const valueMultiplier = resolveValueMultiplier(traitBreakdown, displayOverride);
  if (estimatedDoge != null && valueMultiplier !== 1) {
    estimatedDoge = Math.round(estimatedDoge * valueMultiplier);
  }

  // --- Color match metric ---
  // Build a map of color word → trait categories that contain it
  const colorTraitMap = Object.create(null);
  for (const tb of traitBreakdown) {
    if (tb.isSynthetic) continue;
    const color = extractDominantColor(tb.value);
    if (color) {
      if (!colorTraitMap[color]) colorTraitMap[color] = [];
      if (!colorTraitMap[color].includes(tb.trait)) colorTraitMap[color].push(tb.trait);
    }
  }
  // Also check the raw background/furColor trait values directly since they may just be the color name
  for (const key of ['background', 'furColor']) {
    const val = traits[key];
    if (!val) continue;
    const color = extractDominantColor(val);
    if (color) {
      if (!colorTraitMap[color]) colorTraitMap[color] = [];
      if (!colorTraitMap[color].includes(key)) colorTraitMap[color].push(key);
    }
  }
  let colorMatch = null;
  for (const [color, traitKeys] of Object.entries(colorTraitMap)) {
    if (traitKeys.length >= 2) {
      colorMatch = { color, traits: traitKeys };
      break;
    }
  }
  // Suppress color match on Black Classic dogs — the black aesthetic is already
  // captured by the Black Classic minimal-dog multiplier; don't double-count it.
  const _isBlackClassicEarly =
    traits.furColor != null && String(traits.furColor).toLowerCase() === 'black' &&
    traits.furPattern != null && String(traits.furPattern).toLowerCase() === 'classic';
  if (_isBlackClassicEarly && colorMatch && colorMatch.color === 'black') colorMatch = null;

  // Read special multiplier config (falls back to defaults if absent)
  const smConfig = trendingConfig?.specialMultipliers || DEFAULT_TRENDING_CONFIG.specialMultipliers;
  const cmConfig = smConfig.colorMatch || {};
  let specialMultiplierDetails = [];
  if (colorMatch && cmConfig.enabled === false) colorMatch = null;
  const colorMatchMultiplier = colorMatch ? Math.max(1.0, Number(cmConfig.multiplier) || 1.10) : 1.0;
  if (colorMatch && estimatedDoge != null) {
    estimatedDoge = Math.round(estimatedDoge * colorMatchMultiplier);
    specialMultiplierDetails.push({
      type: 'color_match',
      label: `🎨 ${colorMatch.color.charAt(0).toUpperCase() + colorMatch.color.slice(1)} Match`,
      multiplier: colorMatchMultiplier,
    });
  }

  // --- Minimal dog metric (tiered by extra-trait count + aesthetic combos) ---
  const extraTraitCount = Object.entries(traits)
    .filter(([k, v]) => !MINIMAL_BASE_KEYS.has(k) && !MINIMAL_META_KEYS.has(k) && v != null && String(v).trim() !== '')
    .length;
  const hasVisor = traits.eyes != null && String(traits.eyes).toLowerCase().includes('visor');
  const isBlackClassic =
    traits.furColor != null && String(traits.furColor).toLowerCase() === 'black' &&
    traits.furPattern != null && String(traits.furPattern).toLowerCase() === 'classic';

  const smTiers = smConfig.minimalTiers || {};
  const _tier = (id, fallback) => {
    const t = smTiers[id] || {};
    return t.enabled !== false ? Math.max(1.0, Number(t.multiplier) || fallback) : 1.0;
  };

  let minimalMultiplier = 1.0;
  let minimalType = null;
  let minimalLabel = null;
  if (isBlackClassic && hasVisor) {
    const m = _tier('black_classic_visor', 1.20);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'black_classic_visor'; minimalLabel = '🎨 Black Classic Visor'; }
  } else if (isBlackClassic) {
    const m = _tier('black_classic', 1.15);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'black_classic'; minimalLabel = '🎨 Black Classic'; }
  } else if (hasVisor && extraTraitCount === 1) {
    const m = _tier('visor_minimal', 1.15);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'visor_minimal'; minimalLabel = '✨ Visor'; }
  } else if (extraTraitCount === 0) {
    const m = _tier('ultra_clean', 1.10);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'ultra_clean'; minimalLabel = '✨ Ultra Clean'; }
  } else if (extraTraitCount === 1) {
    const m = _tier('minimal_1', 1.05);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'minimal_1'; minimalLabel = '✨ Minimal'; }
  } else if (extraTraitCount === 2) {
    const m = _tier('minimal_2', 1.01);
    if (m > 1.0) { minimalMultiplier = m; minimalType = 'minimal_2'; minimalLabel = '✨ Minimal'; }
  }
  const isMinimalDog = minimalMultiplier > 1.0;
  if (isMinimalDog && estimatedDoge != null) {
    estimatedDoge = Math.round(estimatedDoge * minimalMultiplier);
    specialMultiplierDetails.push({
      type: minimalType,
      label: minimalLabel,
      multiplier: minimalMultiplier,
    });
  }

  // --- Custom combo multipliers (product of all matching enabled combos; "Any" = wildcard) ---
  const smCombos = Array.isArray(smConfig.combos) ? smConfig.combos : [];
  let comboMultiplier = 1.0;
  const matchedCombos = [];
  for (const combo of smCombos) {
    if (!combo || combo.enabled === false) continue;
    const conditions = Array.isArray(combo.conditions) ? combo.conditions : [];
    if (conditions.length === 0) continue;
    const allMatch = conditions.every(cond => {
      const val = traits[cond.trait];
      if (val == null) return false;
      const sv = String(val).toLowerCase().trim();
      const cv = String(cond.value || '').toLowerCase().trim();
      if (!cv) return false;
      if (cv === 'any') return true;
      return cond.op === 'contains' ? sv.includes(cv) : sv === cv;
    });
    if (allMatch) {
      const cm = Number(combo.multiplier);
      if (!Number.isFinite(cm) || cm === 0) continue;
      comboMultiplier *= normalizeSignedPriceMultiplier(cm);
      matchedCombos.push(combo);
    }
  }
  let matchedComboDisplay = matchedCombos.length === 0
    ? null
    : (matchedCombos.length === 1
      ? matchedCombos[0]
      : {
        id: 'combo-stack',
        label: matchedCombos.map(c => c.label).filter(Boolean).join(' · ') || 'Combo stack',
        conditions: [],
      });
  if (matchedCombos.length > 0 && estimatedDoge != null && comboMultiplier !== 1) {
    estimatedDoge = Math.round(estimatedDoge * comboMultiplier);
    specialMultiplierDetails.push({
      type: 'combo',
      label: matchedComboDisplay?.label || 'Combo',
      multiplier: comboMultiplier,
    });
  }
  annotateTraitBreakdownForCombo(traitBreakdown, traits, matchedCombos);

  // --- Angel numbers (quad/triple repeaters + trend numbers) ---
  const smAngel = smConfig.angelNumbers || {};
  let angelMultiplier = 1.0;
  let angelType = null;
  let angelLabel = null;

  // Check for quad repeater (1111-9999)
  const dogNumStr = String(dogNumber);
  const isQuadRepeater = dogNumStr.length === 4 && /^(.)\1{3}$/.test(dogNumStr);
  if (isQuadRepeater) {
    const quadConfig = smAngel.quadRepeater || {};
    if (quadConfig.enabled !== false) {
      const m = Math.max(1.0, Number(quadConfig.multiplier) || 1.25);
      if (m > angelMultiplier) { angelMultiplier = m; angelType = 'quad_repeater'; angelLabel = `🔢 Quad ${dogNumStr.charAt(0)}`; }
    }
  }

  // Check for triple repeater (111-999)
  const isTripleRepeater = dogNumStr.length === 3 && /^(.)\1{2}$/.test(dogNumStr);
  if (isTripleRepeater) {
    const tripleConfig = smAngel.tripleRepeater || {};
    if (tripleConfig.enabled !== false) {
      const m = Math.max(1.0, Number(tripleConfig.multiplier) || 1.15);
      if (m > angelMultiplier) { angelMultiplier = m; angelType = 'triple_repeater'; angelLabel = `🔢 Triple ${dogNumStr.charAt(0)}`; }
    }
  }

  // Check for trend numbers (67, 69, 420)
  const trendNumConfig = smAngel.trendNumbers || {};
  const trendNumbers = ['67', '69', '420'];
  for (const trendNum of trendNumbers) {
    if (dogNumStr === trendNum) {
      const config = trendNumConfig[trendNum] || {};
      if (config.enabled !== false) {
        const m = Math.max(1.0, Number(config.multiplier) || 1.10);
        if (m > angelMultiplier) { angelMultiplier = m; angelType = 'trend_number'; angelLabel = `🔢 ${trendNum}`; }
      }
      break; // Only one trend number can match
    }
  }

  const isAngelNumber = angelMultiplier > 1.0;
  if (isAngelNumber && estimatedDoge != null) {
    estimatedDoge = Math.round(estimatedDoge * angelMultiplier);
    specialMultiplierDetails.push({
      type: angelType,
      label: angelLabel,
      multiplier: angelMultiplier,
    });
  }

  const refusedOfferFloorDoge = refusedOfferFloor?.minOfferDoge != null
    ? Number(refusedOfferFloor.minOfferDoge)
    : (refusedOfferFloor?.minOfferUsd != null && dogeUsd ? Math.round(Number(refusedOfferFloor.minOfferUsd) / dogeUsd) : null);

  if (refusedOfferFloorDoge != null && (estimatedDoge == null || estimatedDoge < refusedOfferFloorDoge)) {
    estimatedDoge = Math.round(refusedOfferFloorDoge);
  }

  let communityLoreMultiplierFactor = null;
  if (communityLore && estimatedDoge != null) {
    const lf = normalizeSignedPriceMultiplier(rawCommunityLoreMultiplier);
    if (lf !== 1) {
      estimatedDoge = Math.round(estimatedDoge * lf);
      communityLoreMultiplierFactor = lf;
    }
  }

  // Current listing comparison
  const currentListing = listingByDog[dogNumber] || null;
  let listingAnalysis = null;
  if (currentListing && estimatedDoge) {
    const askingPrice = currentListing.priceDoge;
    const diff = askingPrice - estimatedDoge;
    const diffPct = +((diff / estimatedDoge) * 100).toFixed(1);
    listingAnalysis = {
      askingPriceDoge: askingPrice,
      estimatedDoge,
      diffDoge: diff,
      diffPercent: diffPct,
      verdict: diffPct < -10 ? 'undervalued' : diffPct > 15 ? 'overpriced' : 'fair',
    };
  }

  const displayEstimatedUsd = displayOverride?.estimation?.displayEstimatedUsd ?? null;
  const displayEstimatedDoge = displayEstimatedUsd && dogeUsd
    ? Math.round(displayEstimatedUsd / dogeUsd)
    : null;

  const comboInscriptionIds = search?.inscriptionId
    ? [String(search.inscriptionId)]
    : [];

  return {
    dogNumber,
    communityLore: communityLore || null,
    name: search?.name || `Doginal Dog #${dogNumber}`,
    inscriptionId: search?.inscriptionId || null,
    imageUrl: search?.imageUrl ? `${MARKET_BASE}${search.imageUrl}` : `${MARKET_BASE}/dogs/${dogNumber}.png`,
    isListed: search?.isListed || false,
    rarityRank: rank,
    rarityLabel: rarityLabel(rank),
    rarityMultiplier,
    traits: {
      background: traits.background || null,
      furColor: traits.furColor || null,
      furPattern: traits.furPattern || null,
      head: traits.head || null,
      eyes: traits.eyes || null,
      clothes: traits.clothes || null,
      mouth: traits.mouth || null,
      accessory: traits.accessory || null,
    },
    traitBreakdown,
    estimation: {
      estimatedDoge,
      estimatedUsd: estimatedDoge && dogeUsd ? +(estimatedDoge * dogeUsd).toFixed(2) : null,
      displayEstimatedDoge,
      displayEstimatedUsd: displayOverride?.estimation?.displayEstimatedUsd ?? null,
      displayEstimatedUsdNote: displayOverride?.estimation?.displayEstimatedUsdNote ?? null,
      valueMultiplier: valueMultiplier !== 1 ? valueMultiplier : null,
      basePriceDoge: basePriceDoge != null ? Math.round(basePriceDoge) : null,
      traitBonus: traitBonus > 0 ? Math.round(traitBonus) : 0,
      rarestTrait: rarestTrait ? { trait: rarestTrait.trait, value: rarestTrait.value, count: rarestTrait.traitCount } : null,
      trendingMultiplier: trendingMultiplier > 1 ? trendingMultiplier : null,
      trendingHits: trendingHits.length > 0 ? trendingHits : null,
      colorMatch,
      colorMatchMultiplier: colorMatch ? colorMatchMultiplier : null,
      minimalDog: isMinimalDog ? { type: minimalType, label: minimalLabel, extraTraitCount } : null,
      minimalMultiplier: isMinimalDog ? minimalMultiplier : null,
      comboMatch: matchedCombos.length > 0 ? {
        id: matchedComboDisplay.id,
        label: matchedComboDisplay.label,
        multiplier: comboMultiplier,
        inscriptionIds: comboInscriptionIds,
        dogNumber,
      } : null,
      comboMultiplier: matchedCombos.length > 0 ? comboMultiplier : null,
      angelNumber: isAngelNumber ? { type: angelType, label: angelLabel } : null,
      angelMultiplier: isAngelNumber ? angelMultiplier : null,
      specialMultiplier: specialMultiplierDetails.length > 0 ? specialMultiplierDetails.reduce((acc, detail) => acc * detail.multiplier, 1.0) : null,
      specialMultiplierDetails: specialMultiplierDetails.length > 0 ? specialMultiplierDetails : null,
      ownTopSale,
      refusedOfferFloor: refusedOfferFloor ? {
        dogNumber: refusedOfferFloor.dogNumber,
        minOfferDoge: refusedOfferFloorDoge,
        minOfferUsd: refusedOfferFloor.minOfferUsd != null
          ? +Number(refusedOfferFloor.minOfferUsd).toFixed(2)
          : (refusedOfferFloorDoge != null && dogeUsd ? +(refusedOfferFloorDoge * dogeUsd).toFixed(2) : null),
        note: refusedOfferFloor.note || null,
        updatedAt: refusedOfferFloor.updatedAt || null,
        updatedBy: refusedOfferFloor.updatedBy || null,
      } : null,
      collectionFloor: collectionStats.floor,
      dogeUsd,
      communityLore: communityLore || null,
      communityLoreMultiplier: communityLoreMultiplierFactor,
      method: [
        'rarest_trait_top_sale + trait_bonus + rarity_multiplier',
        valueMultiplier !== 1 ? 'one_of_one_multiplier' : null,
        colorMatch ? 'color_match_multiplier' : null,
        isMinimalDog ? 'minimal_dog_multiplier' : null,
        matchedCombos.length > 0 ? 'combo_multiplier' : null,
        isAngelNumber ? 'angel_number_multiplier' : null,
        communityLoreMultiplierFactor ? 'community_lore_multiplier' : null,
      ].filter(Boolean).join(' + '),
    },
    listingAnalysis,
    evaluatedAt: new Date().toISOString(),
  };
}

async function evaluateWallet(address) {
  if (!_snapshot) throw new Error('Snapshot not ready. Wait for first refresh.');

  const dogeUsd = await getLiveDogeUsd().catch(() => _snapshot.dogeUsd);

  const walletData = await getWalletData(address);
  const rawHoldings = Array.isArray(walletData?.holdings) ? walletData.holdings : [];
  const dogNumbers = [...new Set(rawHoldings
    .map(holding => Number(holding?.dogId))
    .filter(dogNumber => Number.isInteger(dogNumber) && dogNumber >= 1 && dogNumber <= 10000))];

  const evaluations = await mapWithConcurrency(dogNumbers, 5, async dogNumber => evaluateDog(dogNumber));
  const successfulEvaluations = evaluations.filter(result => result && !result.error);
  const holdings = successfulEvaluations
    .map(result => summarizeEvaluation(result, dogeUsd))
    .sort((left, right) => (right.estimatedDoge ?? 0) - (left.estimatedDoge ?? 0));

  const totals = holdings.reduce((summary, holding) => {
    summary.estimatedDoge += holding.estimatedDoge ?? 0;
    summary.estimatedUsd += holding.estimatedUsd ?? 0;
    summary.listedCount += holding.isListed ? 1 : 0;
    summary.listedAskingDoge += holding.askingPriceDoge ?? 0;
    summary.listedAskingUsd += holding.askingPriceUsd ?? 0;
    return summary;
  }, {
    estimatedDoge: 0,
    estimatedUsd: 0,
    listedCount: 0,
    listedAskingDoge: 0,
    listedAskingUsd: 0,
  });

  const floorEquivalentDoge = _snapshot.collectionStats.floor != null
    ? Math.round(_snapshot.collectionStats.floor * dogNumbers.length)
    : null;

  return {
    address,
    totalHoldings: rawHoldings.length,
    totalDogs: dogNumbers.length,
    nonDoginalHoldings: Math.max(0, rawHoldings.length - dogNumbers.length),
    balance: walletData?.balance ?? null,
    collections: Array.isArray(walletData?.collections) ? walletData.collections : [],
    dogeUsd,
    totals: {
      estimatedDoge: totals.estimatedDoge,
      estimatedUsd: dogeUsd ? +totals.estimatedUsd.toFixed(2) : null,
      listedCount: totals.listedCount,
      listedAskingDoge: totals.listedAskingDoge,
      listedAskingUsd: dogeUsd ? +totals.listedAskingUsd.toFixed(2) : null,
      floorEquivalentDoge,
      floorEquivalentUsd: floorEquivalentDoge != null && dogeUsd ? +(floorEquivalentDoge * dogeUsd).toFixed(2) : null,
    },
    holdings,
    failed: evaluations
      .filter(result => result?.error)
      .map(result => ({ dogNumber: result.dogNumber, error: result.error })),
    snapshotAge: _snapshot.builtAt,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Start the periodic refresh loop.
 * @param {number} intervalMs — milliseconds between refreshes (default 12 hours)
 */
async function startRefreshLoop(intervalMs = 12 * 60 * 60 * 1000, log = console.log) {
  // Initial build
  if (!_refreshing) {
    _refreshing = true;
    try {
      await buildSnapshot(log);
    } finally {
      _refreshing = false;
    }
  }

  // Schedule recurring
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(async () => {
    if (_refreshing) return;
    _refreshing = true;
    try {
      await buildSnapshot(log);
    } catch (err) {
      log(`[evaluator] Refresh failed: ${err.message}`);
    } finally {
      _refreshing = false;
    }
  }, intervalMs);

  log(`[evaluator] Refresh scheduled every ${(intervalMs / 3600000).toFixed(1)}h.`);
}

function stopRefreshLoop() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

export {
  buildSnapshot,
  clearEvaluationLog,
  getSnapshot,
  isReady,
  getEvaluationLog,
  getLiveDogeUsd,
  getTrendingConfig,
  updateTrendingConfig,
  getTrendingDashboardData,
  logEvaluationResult,
  evaluateDog,
  evaluateWallet,
  startRefreshLoop,
  stopRefreshLoop,
};
