/**
 * DDScraper — tRPC client for market.doginaldogs.com
 *
 * Shared constants, helpers, and API wrappers used by the scraper
 * and any future tools you build on top of this data.
 */

import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MARKET_BASE = 'https://market.doginaldogs.com';

const COLOR_KEYWORDS = Object.freeze({
  tan: '#c89f77', beige: '#d6b88f', sand: '#cfb17c', cream: '#efe2ba',
  gold: '#d4af37', yellow: '#ddb74a', orange: '#d67a33', brown: '#795548',
  chocolate: '#5d4037', red: '#c44536', crimson: '#8e2f3f', pink: '#da6f8f',
  magenta: '#b8488a', purple: '#7d57c2', violet: '#7466d6', blue: '#4a6dcf',
  navy: '#24408f', cyan: '#4ba9c8', teal: '#2f8f8a', green: '#4b8f4d',
  lime: '#8fbf57', olive: '#73824e', gray: '#7d8591', grey: '#7d8591',
  silver: '#c7ced9', white: '#f5f5f5', black: '#121212'
});

const TRAIT_KEYS = Object.freeze([
  'background', 'furColor', 'furPattern', 'head',
  'clothes', 'mouth', 'eyes', 'accessory'
]);

const CATALOG_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_CATALOG_PATH ? resolve(process.cwd(), process.env.DD_CATALOG_PATH) : null,
  resolve(__dirname, 'data', 'DoginalDogsCatalog.json'),
  resolve(__dirname, '..', '..', 'server', 'data', 'DoginalDogsCatalog.json'),
  resolve(__dirname, '..', '..', 'assets', 'DoginalDogsCatalog.json')
].filter(Boolean));
const CATALOG_DISABLED = /^(1|true|yes)$/i.test(String(process.env.DD_DISABLE_CATALOG || ''));

let catalogPromise = null;
let catalogTraitValuesPromise = null;
let catalogWarningShown = false;

function warnCatalog(message) {
  if (catalogWarningShown) return;
  catalogWarningShown = true;
  console.warn(`[dd-catalog] ${message}`);
}

function traitCategoryLabel(key) {
  if (key === 'furColor') return 'Fur Color';
  if (key === 'furPattern') return 'Fur Pattern';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeCatalogTraits(traits) {
  if (!traits || typeof traits !== 'object') return null;
  return {
    ...traits,
    rarityRank: Number.isFinite(Number(traits.rarityRank)) ? Number(traits.rarityRank) : null,
    traitCounts: traits.traitCounts && typeof traits.traitCounts === 'object' ? traits.traitCounts : {}
  };
}

async function loadDogCatalog() {
  if (CATALOG_DISABLED) {
    return null;
  }

  if (!catalogPromise) {
    catalogPromise = (async () => {
      for (const filePath of CATALOG_CANDIDATE_PATHS) {
        try {
          const raw = await readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.dogs && typeof parsed.dogs === 'object') {
            return parsed;
          }
          warnCatalog(`Ignoring catalog at ${filePath}: missing dogs object.`);
          return null;
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            continue;
          }
          warnCatalog(`Failed to load catalog: ${error.message}`);
          return null;
        }
      }

      return null;
    })();
  }

  return catalogPromise;
}

async function getCatalogDogTraits(dogNumber) {
  const catalog = await loadDogCatalog();
  if (!catalog) return null;

  const entry = catalog.dogs[String(dogNumber)] || catalog.dogs[dogNumber] || null;
  if (!entry || entry.ok === false) return null;
  return normalizeCatalogTraits(entry.traits);
}

async function getCatalogTraitValues() {
  if (!catalogTraitValuesPromise) {
    catalogTraitValuesPromise = (async () => {
      const catalog = await loadDogCatalog();
      if (!catalog) return null;

      const counts = {};
      for (const key of TRAIT_KEYS) {
        counts[traitCategoryLabel(key)] = {};
      }

      for (const entry of Object.values(catalog.dogs || {})) {
        const traits = normalizeCatalogTraits(entry && entry.traits);
        if (!traits) continue;

        for (const key of TRAIT_KEYS) {
          const value = traits[key];
          if (!value) continue;

          const category = traitCategoryLabel(key);
          counts[category][value] = (counts[category][value] || 0) + 1;
        }
      }

      const categories = TRAIT_KEYS.map(traitCategoryLabel);
      const values = {};
      for (const category of categories) {
        values[category] = Object.keys(counts[category]).sort((left, right) => left.localeCompare(right));
      }

      return {
        categories,
        values,
        counts,
        source: 'catalog',
        createdAt: catalog.createdAt || null,
        lastUpdatedAt: catalog.lastUpdatedAt || null
      };
    })();
  }

  return catalogTraitValuesPromise;
}

/* ---- tRPC helpers ---- */

function buildTrpcUrl(procedure, input) {
  const payload = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  return `${MARKET_BASE}/api/trpc/${procedure}?batch=1&input=${payload}`;
}

async function trpcFetch(procedure, input, timeoutMs = 10000) {
  const url = buildTrpcUrl(procedure, input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'trpc-accept': 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.[0]?.result?.data?.json ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---- Public API wrappers ---- */

async function searchDog(dogNumber) {
  const data = await trpcFetch('search.search', { query: String(dogNumber), limit: 1 });
  const results = data?.results;
  if (!Array.isArray(results)) return null;
  return results.find(r => Number(r.dogId) === dogNumber) ?? null;
}

async function getDogTraits(dogNumber) {
  const catalogTraits = await getCatalogDogTraits(dogNumber);
  if (catalogTraits) {
    return catalogTraits;
  }
  return trpcFetch('wallet.getDogTraits', { dogNumber });
}

async function fetchDogImage(dogNumber) {
  const search = await searchDog(dogNumber);
  const imageUrl = search?.imageUrl
    ? `${MARKET_BASE}${search.imageUrl}`
    : `${MARKET_BASE}/dogs/${dogNumber}.png`;

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/png',
    url: imageUrl
  };
}

/* ---- Market / Listings API ---- */

/**
 * Fetch live DOGE/USD price.
 */
async function getDogecoinPrice() {
  return trpcFetch('wallet.getDogecoinPrice', null);
}

/**
 * Fetch all trait categories, their possible values, and per-value counts.
 * Returns { categories, values, counts }.
 */
async function getTraitValues() {
  const catalogTraitValues = await getCatalogTraitValues();
  if (catalogTraitValues) {
    return catalogTraitValues;
  }
  return trpcFetch('wallet.getTraitValues', null);
}

/**
 * Fetch wallet holdings and balance data for a Dogecoin address.
 */
async function getWalletData(address) {
  return trpcFetch('wallet.getAllWalletData', { address });
}

/**
 * Search for a wallet profile by address.
 */
async function searchWallet(address) {
  const query = String(address || '').trim();
  const data = await trpcFetch('search.search', { query, limit: 5 });
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.find(result => result?.type === 'wallet' && String(result?.address || '') === query)
    ?? results.find(result => String(result?.address || '') === query)
    ?? null;
}

/**
 * Marketplace owner/profile search (wallet address or X/Twitter handle).
 * Returns the raw search payload plus the best wallet hit when present.
 */
async function searchOwners(query, limit = 10) {
  const q = String(query || '').trim().replace(/^@+/, '');
  if (!q) {
    return { searchType: null, results: [], wallet: null };
  }
  const data = await trpcFetch('search.search', { query: q, limit });
  const results = Array.isArray(data?.results) ? data.results : [];
  const needle = q.toLowerCase();
  const wallet = results.find(result => result?.type === 'wallet' && String(result?.address || '') === q)
    ?? results.find(result => {
      const username = String(result?.twitterUsername || '').trim().toLowerCase();
      return result?.type === 'wallet' && username && username === needle;
    })
    ?? results.find(result => result?.type === 'wallet' && result?.address)
    ?? results.find(result => result?.address)
    ?? null;
  return {
    searchType: data?.searchType || null,
    total: data?.total != null ? Number(data.total) : results.length,
    results,
    wallet,
  };
}

/**
 * Fetch the public Top 100 leaderboard entries.
 */
async function getOwnersLeaderboard(twitterOnly = false) {
  return trpcFetch('owners.getLeaderboard', { twitterOnly: !!twitterOnly });
}

/**
 * Fetch a page of active listings.
 * @param {object} opts
 * @param {number}  [opts.limit=100]
 * @param {string}  [opts.sortBy='price']    - 'price' | 'createdAt'
 * @param {string}  [opts.sortOrder='asc']   - 'asc' | 'desc'
 * @param {number}  [opts.cursor]            - pagination cursor from previous page
 * @param {object}  [opts.filters]           - trait filters, e.g. { background: ['Yellow'], furColor: ['Black','White'] }
 */
async function getListings({ limit = 100, sortBy = 'price', sortOrder = 'asc', cursor, filters } = {}) {
  const input = { limit, sortBy, sortOrder };
  if (cursor != null) input.cursor = cursor;
  if (filters && Object.keys(filters).length > 0) input.filters = filters;
  return trpcFetch('listings.getAll', input);
}

/**
 * Fetch ALL active listings by paginating through every page.
 */
async function getAllListings({ sortBy = 'price', sortOrder = 'asc', filters, onPage } = {}) {
  const all = [];
  let cursor;
  let page = 0;
  while (true) {
    const data = await getListings({ limit: 100, sortBy, sortOrder, cursor, filters });
    const listings = data?.listings || [];
    all.push(...listings);
    page++;
    if (typeof onPage === 'function') onPage(page, listings.length, all.length);
    if (!data?.nextCursor || listings.length === 0) break;
    cursor = data.nextCursor;
  }
  return all;
}

/**
 * Fetch global activity (recent sales, listings, cancellations).
 * @param {number} [limit=50]
 * @param {number} [cursor] - pagination cursor
 */
async function getGlobalActivity(limit = 50, cursor) {
  const input = { limit };
  if (cursor != null) input.cursor = cursor;
  return trpcFetch('activity.getGlobal', input);
}

/**
 * Fetch all global activity by following every page up to a safety cap.
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @param {number} [opts.maxPages=100]
 * @param {(page:number,count:number,total:number)=>void} [opts.onPage]
 */
async function getAllGlobalActivity({ limit = 100, maxPages = 100, onPage } = {}) {
  const all = [];
  let cursor;
  let page = 0;

  while (page < maxPages) {
    const data = await getGlobalActivity(limit, cursor);
    const activities = Array.isArray(data?.activities) ? data.activities : [];
    all.push(...activities);
    page += 1;
    if (typeof onPage === 'function') onPage(page, activities.length, all.length);
    if (!data?.nextCursor || activities.length === 0) break;
    cursor = data.nextCursor;
  }

  return all;
}

/**
 * Extract dog number from a listing's dogName field ("Doginal Dog #1234" -> 1234).
 */
function dogNumberFromName(dogName) {
  const m = String(dogName).match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Normalise a raw listing object into a cleaner shape.
 */
function normaliseListing(raw) {
  const dogNumber = dogNumberFromName(raw.dogName);
  return {
    dogNumber,
    name: raw.dogName,
    inscriptionId: raw.inscriptionId,
    inscriptionNumber: raw.inscriptionNumber,
    listingId: raw.id,
    priceDoge: Number(raw.priceDoge),
    priceUsd: Number(raw.priceUsd),
    sellerAddress: raw.sellerAddress,
    imageUrl: raw.imageUrl ? `${MARKET_BASE}${raw.imageUrl}` : null,
    status: raw.status,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
  };
}

/* ---- Colour / rarity helpers ---- */

function colorFromTrait(name) {
  const key = String(name || '').trim().toLowerCase();
  if (COLOR_KEYWORDS[key]) return COLOR_KEYWORDS[key];
  const tokens = key.split(/[^a-z0-9]+/);
  for (const t of tokens) {
    if (COLOR_KEYWORDS[t]) return COLOR_KEYWORDS[t];
  }
  return null;
}

function rarityLabel(rank) {
  if (!rank) return 'Unknown';
  if (rank <= 100) return 'Mythic';
  if (rank <= 500) return 'Legendary';
  if (rank <= 1500) return 'Rare';
  if (rank <= 4000) return 'Notable';
  if (rank <= 7000) return 'Collector';
  return 'Classic';
}

/**
 * Fetch full record for a single dog: search + traits + live price merged.
 */
async function getFullRecord(dogNumber) {
  const [search, traits, dogePrice] = await Promise.all([
    searchDog(dogNumber),
    getDogTraits(dogNumber),
    getDogecoinPrice().catch(() => null)
  ]);

  const bgColor = traits ? colorFromTrait(traits.background) : null;
  const furColor = traits ? colorFromTrait(traits.furColor) : null;
  const priceDoge = search?.price ? Number(search.price) : null;

  return {
    dogNumber,
    name: search?.name || `Doginal Dog #${dogNumber}`,
    inscriptionId: search?.inscriptionId || null,
    inscriptionNumber: search?.inscriptionNumber || null,
    imageUrl: search?.imageUrl ? `${MARKET_BASE}${search.imageUrl}` : `${MARKET_BASE}/dogs/${dogNumber}.png`,
    isListed: search?.isListed || false,
    price: priceDoge ? {
      doge: priceDoge,
      usd: dogePrice ? +(priceDoge * dogePrice).toFixed(2) : null,
      dogeUsdRate: dogePrice || null,
    } : null,
    listingId: search?.listingId || null,
    traits: traits ? {
      background: traits.background || null,
      furColor: traits.furColor || null,
      furPattern: traits.furPattern || null,
      head: traits.head || null,
      eyes: traits.eyes || null,
      clothes: traits.clothes || null,
      mouth: traits.mouth || null,
      accessory: traits.accessory || null
    } : null,
    colors: {
      background: bgColor,
      fur: furColor
    },
    rarityRank: traits?.rarityRank || null,
    rarityLabel: rarityLabel(traits?.rarityRank),
    traitCounts: traits?.traitCounts || {},
    scrapedAt: new Date().toISOString()
  };
}

export {
  MARKET_BASE,
  COLOR_KEYWORDS,
  TRAIT_KEYS,
  buildTrpcUrl,
  trpcFetch,
  searchDog,
  getDogTraits,
  fetchDogImage,
  getDogecoinPrice,
  getTraitValues,
  getWalletData,
  searchWallet,
  searchOwners,
  getOwnersLeaderboard,
  getListings,
  getAllListings,
  getGlobalActivity,
  getAllGlobalActivity,
  dogNumberFromName,
  normaliseListing,
  colorFromTrait,
  rarityLabel,
  getFullRecord
};
