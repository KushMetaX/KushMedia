import {
  DEFAULT_BRAND_PALETTE,
  colorFromLabel,
  createFallbackDogRecord,
  deriveAccentColor
} from './sample-data.js';

const PROXY_BASE = '/api/doginal-proxy.php';
const LAST_STATE_KEY = 'kush-nail-designer-state-v1';

const inscriptionCache = new Map();

let brandPalettePromise = null;

function clampInscriptionNumber(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    throw new Error('Invalid inscription number. Enter a whole number between 1 and 10000.');
  }

  return parsed;
}

function normalizeBrandPalette(payload) {
  const source = payload || DEFAULT_BRAND_PALETTE;

  return {
    accent: source.accent || DEFAULT_BRAND_PALETTE.accent,
    surface: source.surface || DEFAULT_BRAND_PALETTE.surface,
    background: source.background || DEFAULT_BRAND_PALETTE.background,
    text: source.text || DEFAULT_BRAND_PALETTE.text,
    white: source.white || DEFAULT_BRAND_PALETTE.white,
    black: source.black || DEFAULT_BRAND_PALETTE.black,
    discovered: Array.isArray(source.discovered) ? source.discovered.slice(0, 6) : []
  };
}

function withTimeout(timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear() {
      window.clearTimeout(timeout);
    }
  };
}

async function fetchJson(url, timeoutMs) {
  const timer = withTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'trpc-accept': 'application/json'
      },
      signal: timer.controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    timer.clear();
  }
}

const COLOR_KEYWORDS = Object.freeze({
  tan: '#c89f77', beige: '#d6b88f', sand: '#cfb17c', cream: '#efe2ba',
  gold: '#d4af37', yellow: '#ddb74a', orange: '#d67a33', brown: '#795548',
  chocolate: '#5d4037', red: '#c44536', crimson: '#8e2f3f', pink: '#da6f8f',
  magenta: '#b8488a', purple: '#7d57c2', violet: '#7466d6', blue: '#4a6dcf',
  navy: '#24408f', cyan: '#4ba9c8', teal: '#2f8f8a', green: '#4b8f4d',
  lime: '#8fbf57', olive: '#73824e', gray: '#7d8591', grey: '#7d8591',
  silver: '#c7ced9', white: '#f5f5f5', black: '#121212'
});

function colorFromTraitName(name, fallbackSeed) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return colorFromLabel('unknown', fallbackSeed);
  if (COLOR_KEYWORDS[normalized]) return COLOR_KEYWORDS[normalized];
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (COLOR_KEYWORDS[token]) return COLOR_KEYWORDS[token];
  }
  return colorFromLabel(normalized, fallbackSeed);
}

function normalizeTraits(rawTraits) {
  return {
    background: rawTraits.background || 'Unknown',
    furColor: rawTraits.furColor || 'Unknown',
    furPattern: rawTraits.furPattern || 'Unknown',
    head: rawTraits.head || 'None',
    clothes: rawTraits.clothes || 'None',
    mouth: rawTraits.mouth || 'None',
    eyes: rawTraits.eyes || 'None',
    accessory: rawTraits.accessory || 'None'
  };
}

function chooseAccessory(traits) {
  return traits.accessory || traits.head || traits.clothes || traits.eyes || traits.mouth || 'Collector Mark';
}

function rarityLabel(rank) {
  if (!rank) return 'Collector';
  if (rank <= 100) return 'Mythic';
  if (rank <= 500) return 'Legendary';
  if (rank <= 1500) return 'Rare';
  if (rank <= 4000) return 'Notable';
  if (rank <= 7000) return 'Collector';
  return 'Classic';
}

async function searchDogByNumber(dogNumber) {
  const response = await fetchJson(
    `${PROXY_BASE}?action=search&query=${dogNumber}`,
    7000
  );
  const results = response && response[0] && response[0].result && response[0].result.data && response[0].result.data.json
    ? response[0].result.data.json.results
    : [];
  const match = Array.isArray(results)
    ? results.find((item) => Number(item.dogId) === dogNumber)
    : null;
  if (!match) throw new Error('Live search did not return a matching inscription.');
  return match;
}

async function fetchDogTraits(dogNumber) {
  const response = await fetchJson(
    `${PROXY_BASE}?action=traits&dogNumber=${dogNumber}`,
    7000
  );
  const traits = response && response[0] && response[0].result && response[0].result.data && response[0].result.data.json
    ? response[0].result.data.json
    : null;
  if (!traits || typeof traits !== 'object') throw new Error('Live traits were unavailable.');
  return traits;
}

/* ---- public API ---- */

async function loadBrandPalette() {
  if (!brandPalettePromise) {
    brandPalettePromise = Promise.resolve(normalizeBrandPalette(DEFAULT_BRAND_PALETTE));
  }
  return brandPalettePromise;
}

async function fetchDesignSource(inscriptionNumber) {
  const normalizedNumber = clampInscriptionNumber(inscriptionNumber);

  if (inscriptionCache.has(normalizedNumber)) {
    return inscriptionCache.get(normalizedNumber);
  }

  const brandColors = await loadBrandPalette();

  try {
    const [searchResult, liveTraits] = await Promise.all([
      searchDogByNumber(normalizedNumber),
      fetchDogTraits(normalizedNumber)
    ]);

    const traits = normalizeTraits(liveTraits);
    const backgroundColor = colorFromTraitName(traits.background, `${normalizedNumber}-background`);
    const primaryTraitName = traits.furColor !== 'Unknown' ? traits.furColor : traits.furPattern;
    const primaryColor = colorFromTraitName(primaryTraitName, `${normalizedNumber}-primary`);
    const accentColor = deriveAccentColor(backgroundColor, primaryColor, brandColors);

    const proxyImageUrl = `${PROXY_BASE}?action=image&dogNumber=${normalizedNumber}`;

    const record = {
      inscriptionNumber: normalizedNumber,
      name: searchResult.name || `Doginal Dog #${normalizedNumber}`,
      inscriptionId: searchResult.inscriptionId || null,
      marketInscriptionNumber: searchResult.inscriptionNumber || null,
      imageUrl: proxyImageUrl,
      proxyImageUrl,
      background: { name: traits.background, color: backgroundColor },
      primary: { name: primaryTraitName, color: primaryColor },
      accent: { name: 'Accent', color: accentColor },
      accessory: { name: chooseAccessory(traits) },
      traits,
      rarityRank: liveTraits.rarityRank || null,
      rarityLabel: rarityLabel(liveTraits.rarityRank),
      traitCounts: liveTraits.traitCounts || {},
      market: {
        isListed: Boolean(searchResult.isListed),
        priceDoge: Number.isFinite(Number.parseFloat(searchResult.price)) ? Number.parseFloat(searchResult.price) : null,
        listingId: searchResult.listingId || null
      },
      brandColors,
      source: 'live',
      message: 'Live Doginal Dogs data loaded'
    };

    inscriptionCache.set(normalizedNumber, record);
    return record;
  } catch (error) {
    const fallback = createFallbackDogRecord(normalizedNumber, normalizeBrandPalette(brandColors));
    inscriptionCache.set(normalizedNumber, fallback);
    return fallback;
  }
}

function saveDesignerState(state) {
  try {
    window.localStorage.setItem(LAST_STATE_KEY, JSON.stringify(state));
  } catch (error) {
  }
}

function loadDesignerState() {
  try {
    const saved = window.localStorage.getItem(LAST_STATE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    return null;
  }
}

export {
  clampInscriptionNumber,
  fetchDesignSource,
  loadBrandPalette,
  loadDesignerState,
  saveDesignerState
};
