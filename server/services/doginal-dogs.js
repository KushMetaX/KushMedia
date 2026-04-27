'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MARKET_BASE = 'https://market.doginaldogs.com';
const BRAND_BASE = 'https://doginaldogs.com';

const BRAND_ASSET_MAP = Object.freeze({
  'collection-logo': `${MARKET_BASE}/collection_logo.png`,
  'doginal-logo': `${MARKET_BASE}/logo.png`,
  'doge-icon': `${MARKET_BASE}/DOGE.svg`
});

const DEFAULT_BRAND_COLORS = Object.freeze({
  accent: '#d4af37',
  background: '#000000',
  surface: '#111111',
  text: '#ffffff',
  black: '#000000',
  white: '#ffffff'
});

const CATALOG_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_CATALOG_PATH ? path.resolve(process.cwd(), process.env.DD_CATALOG_PATH) : null,
  path.resolve(__dirname, '..', 'data', 'DoginalDogsCatalog.json'),
  path.resolve(__dirname, '..', '..', 'assets', 'DoginalDogsCatalog.json')
].filter(Boolean));
const CATALOG_DISABLED = /^(1|true|yes)$/i.test(String(process.env.DD_DISABLE_CATALOG || ''));

const COLOR_KEYWORDS = Object.freeze({
  tan: '#c89f77',
  beige: '#d6b88f',
  sand: '#cfb17c',
  cream: '#efe2ba',
  gold: '#d4af37',
  yellow: '#ddb74a',
  orange: '#d67a33',
  brown: '#795548',
  chocolate: '#5d4037',
  red: '#c44536',
  crimson: '#8e2f3f',
  pink: '#da6f8f',
  magenta: '#b8488a',
  purple: '#7d57c2',
  violet: '#7466d6',
  blue: '#4a6dcf',
  navy: '#24408f',
  cyan: '#4ba9c8',
  teal: '#2f8f8a',
  green: '#4b8f4d',
  lime: '#8fbf57',
  olive: '#73824e',
  gray: '#7d8591',
  grey: '#7d8591',
  silver: '#c7ced9',
  white: '#f5f5f5',
  black: '#121212'
});

const FALLBACK_BACKGROUNDS = Object.freeze([
  'Tan',
  'Cream',
  'Gold',
  'Teal',
  'Gray',
  'Pink',
  'Navy',
  'Olive'
]);

const FALLBACK_PRIMARIES = Object.freeze([
  'Gray',
  'Blue',
  'Gold',
  'Purple',
  'Brown',
  'Orange',
  'Silver',
  'Cyan'
]);

const FALLBACK_ACCESSORIES = Object.freeze([
  'Dad Hat',
  'Sunglasses',
  'Dog Tag',
  'Chain Collar',
  'Bone Charm',
  'Bandana',
  'Gold Tooth',
  'Pixel Crown'
]);

const FALLBACK_HEADS = Object.freeze([
  'Street Cap',
  'Gold Visor',
  'Minimal Part',
  'Rare Crown',
  'Studio Fade'
]);

const FALLBACK_EYES = Object.freeze([
  'Studio Blink',
  'Laser Eyes',
  'Classic Stare',
  'Rare Glint',
  'Shades'
]);

const cache = new Map();
let catalogPromise = null;
let catalogWarningShown = false;

function warnCatalog(message) {
  if (catalogWarningShown) {
    return;
  }

  catalogWarningShown = true;
  console.warn(`[doginal-catalog] ${message}`);
}

function normalizeCatalogTraits(traits) {
  if (!traits || typeof traits !== 'object') {
    return null;
  }

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
          const raw = await fs.readFile(filePath, 'utf8');
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
  if (!catalog) {
    return null;
  }

  const entry = catalog.dogs[String(dogNumber)] || catalog.dogs[dogNumber] || null;
  if (!entry || entry.ok === false) {
    return null;
  }

  return normalizeCatalogTraits(entry.traits);
}

function getFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Node 18 or newer is required to run the Nail Designer API.');
  }

  return fetch.bind(globalThis);
}

async function getCachedValue(key, ttlMs, loader) {
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function buildTrpcUrl(procedure, input) {
  const payload = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  return `${MARKET_BASE}/api/trpc/${procedure}?batch=1&input=${payload}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await getFetch()(url, {
      headers: {
        accept: 'application/json',
        'trpc-accept': 'application/json'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await getFetch()(url, {
      headers: {
        accept: 'text/html, text/css;q=0.9, */*;q=0.1'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinary(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await getFetch()(url, {
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'image/png'
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHex(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();

  if (!trimmed.startsWith('#')) {
    return null;
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return null;
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex) || DEFAULT_BRAND_COLORS.accent;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToHex(red, green, blue) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hslToHex(hue, saturation, lightness) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const saturationRatio = saturation / 100;
  const lightnessRatio = lightness / 100;
  const chroma = (1 - Math.abs((2 * lightnessRatio) - 1)) * saturationRatio;
  const huePrime = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const matchLight = lightnessRatio - (chroma / 2);

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime >= 1 && huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime >= 3 && huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return rgbToHex(
    (red + matchLight) * 255,
    (green + matchLight) * 255,
    (blue + matchLight) * 255
  );
}

function mixHex(colorA, colorB, weight) {
  const first = hexToRgb(colorA);
  const second = hexToRgb(colorB);
  const ratio = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0.5;

  return rgbToHex(
    first.r + ((second.r - first.r) * ratio),
    first.g + ((second.g - first.g) * ratio),
    first.b + ((second.b - first.b) * ratio)
  );
}

function shiftHex(color, amount) {
  const rgb = hexToRgb(color);
  const delta = Math.max(-1, Math.min(1, amount || 0));
  const factor = delta >= 0 ? 255 : 0;

  return rgbToHex(
    rgb.r + ((factor - rgb.r) * Math.abs(delta)),
    rgb.g + ((factor - rgb.g) * Math.abs(delta)),
    rgb.b + ((factor - rgb.b) * Math.abs(delta))
  );
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function buildHashedColor(label, fallbackSeed) {
  const hash = stableHash(`${label || ''}-${fallbackSeed || ''}`);
  const hue = (Number.parseInt(hash.slice(0, 2), 16) / 255) * 360;
  const saturation = 52 + (Number.parseInt(hash.slice(2, 4), 16) % 28);
  const lightness = 42 + (Number.parseInt(hash.slice(4, 6), 16) % 22);
  return hslToHex(hue, saturation, lightness);
}

function uniqueColors(colors) {
  return [...new Set(colors.filter(Boolean))];
}

function extractHexColors(source) {
  return uniqueColors((source.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(normalizeHex));
}

function extractThemeColor(source) {
  const match = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(source);
  return normalizeHex(match ? match[1] : '');
}

function extractStylesheetLinks(html) {
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], BRAND_BASE).toString());
}

function chooseAccentCandidate(colors) {
  return colors.find((color) => {
    const rgb = hexToRgb(color);
    const luminance = ((0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)) / 255;
    return luminance > 0.45 && luminance < 0.92;
  }) || null;
}

function colorFromTraitName(name, fallbackSeed) {
  const normalized = String(name || '').trim().toLowerCase();

  if (!normalized) {
    return buildHashedColor('unknown', fallbackSeed);
  }

  if (COLOR_KEYWORDS[normalized]) {
    return COLOR_KEYWORDS[normalized];
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  for (const token of tokens) {
    if (COLOR_KEYWORDS[token]) {
      return COLOR_KEYWORDS[token];
    }
  }

  return buildHashedColor(normalized, fallbackSeed);
}

function chooseAccessory(traits) {
  return traits.accessory || traits.head || traits.clothes || traits.eyes || traits.mouth || 'Collector Mark';
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

function rarityLabel(rank) {
  if (!rank) {
    return 'Collector';
  }

  if (rank <= 100) {
    return 'Mythic';
  }

  if (rank <= 500) {
    return 'Legendary';
  }

  if (rank <= 1500) {
    return 'Rare';
  }

  if (rank <= 4000) {
    return 'Notable';
  }

  if (rank <= 7000) {
    return 'Collector';
  }

  return 'Classic';
}

function deriveAccentColor(backgroundColor, primaryColor, brandColors) {
  const brandAccent = brandColors.accent || DEFAULT_BRAND_COLORS.accent;
  return mixHex(mixHex(backgroundColor, primaryColor, 0.45), brandAccent, 0.35);
}

function createFallbackRecord(dogNumber, brandColors) {
  const backgroundName = FALLBACK_BACKGROUNDS[dogNumber % FALLBACK_BACKGROUNDS.length];
  const primaryName = FALLBACK_PRIMARIES[(dogNumber * 3) % FALLBACK_PRIMARIES.length];
  const accessoryName = FALLBACK_ACCESSORIES[(dogNumber * 5) % FALLBACK_ACCESSORIES.length];
  const headName = FALLBACK_HEADS[(dogNumber * 7) % FALLBACK_HEADS.length];
  const eyeName = FALLBACK_EYES[(dogNumber * 11) % FALLBACK_EYES.length];
  const backgroundColor = colorFromTraitName(backgroundName, `${dogNumber}-background`);
  const primaryColor = colorFromTraitName(primaryName, `${dogNumber}-primary`);
  const accentColor = deriveAccentColor(backgroundColor, primaryColor, brandColors);
  const rank = 1 + ((dogNumber * 173) % 10000);

  return {
    inscriptionNumber: dogNumber,
    name: `Doginal Dog #${dogNumber}`,
    inscriptionId: null,
    marketInscriptionNumber: null,
    imageUrl: '/assets/Kush.png',
    proxyImageUrl: '/assets/Kush.png',
    background: {
      name: backgroundName,
      color: backgroundColor
    },
    primary: {
      name: primaryName,
      color: primaryColor
    },
    accent: {
      name: 'Accent',
      color: accentColor
    },
    accessory: {
      name: accessoryName
    },
    traits: {
      background: backgroundName,
      furColor: primaryName,
      furPattern: 'Solid',
      head: headName,
      clothes: 'Studio Jacket',
      mouth: 'Classic Smile',
      eyes: eyeName,
      accessory: accessoryName
    },
    rarityRank: rank,
    rarityLabel: rarityLabel(rank),
    traitCounts: {},
    market: {
      isListed: false,
      priceDoge: null,
      listingId: null
    },
    brandColors,
    source: 'fallback',
    message: 'Design generated using default data'
  };
}

function parsePrice(searchResult) {
  const parsed = Number.parseFloat(searchResult.price || '');
  return Number.isFinite(parsed) ? parsed : null;
}

async function searchDogByNumber(dogNumber) {
  return getCachedValue(`search:${dogNumber}`, 300000, async () => {
    const response = await fetchJson(buildTrpcUrl('search.search', { query: String(dogNumber), limit: 1 }));
    const results = response && response[0] && response[0].result && response[0].result.data && response[0].result.data.json
      ? response[0].result.data.json.results
      : [];

    const match = Array.isArray(results)
      ? results.find((item) => Number(item.dogId) === dogNumber)
      : null;

    if (!match) {
      throw new Error('Live Doginal Dogs search did not return a matching inscription.');
    }

    return match;
  });
}

async function fetchDogTraits(dogNumber) {
  return getCachedValue(`traits:${dogNumber}`, 1800000, async () => {
    const catalogTraits = await getCatalogDogTraits(dogNumber);
    if (catalogTraits) {
      return catalogTraits;
    }

    const response = await fetchJson(buildTrpcUrl('wallet.getDogTraits', { dogNumber }));
    const traits = response && response[0] && response[0].result && response[0].result.data && response[0].result.data.json
      ? response[0].result.data.json
      : null;

    if (!traits || typeof traits !== 'object') {
      throw new Error('Live Doginal Dogs traits were unavailable.');
    }

    return traits;
  });
}

async function getBrandColors() {
  return getCachedValue('brand-colors', 3600000, async () => {
    let discovered = [];

    try {
      const brandHtml = await fetchText(BRAND_BASE);
      const themeColor = extractThemeColor(brandHtml);

      if (themeColor) {
        discovered.push(themeColor);
      }

      discovered = discovered.concat(extractHexColors(brandHtml));

      const stylesheetLinks = extractStylesheetLinks(brandHtml).slice(0, 2);
      for (const stylesheetLink of stylesheetLinks) {
        try {
          const stylesheet = await fetchText(stylesheetLink);
          discovered = discovered.concat(extractHexColors(stylesheet));
        } catch (error) {
        }
      }
    } catch (error) {
    }

    try {
      const marketHtml = await fetchText(MARKET_BASE);
      const marketTheme = extractThemeColor(marketHtml);

      if (marketTheme) {
        discovered.unshift(marketTheme);
      }

      discovered = discovered.concat(extractHexColors(marketHtml));
    } catch (error) {
    }

    discovered = uniqueColors(discovered);

    const accent = chooseAccentCandidate(discovered) || DEFAULT_BRAND_COLORS.accent;
    return {
      accent,
      background: DEFAULT_BRAND_COLORS.background,
      surface: mixHex(DEFAULT_BRAND_COLORS.background, accent, 0.08),
      text: DEFAULT_BRAND_COLORS.text,
      black: DEFAULT_BRAND_COLORS.black,
      white: DEFAULT_BRAND_COLORS.white,
      discovered: discovered.slice(0, 6)
    };
  });
}

async function getInscriptionRecord(dogNumber) {
  const brandColors = await getBrandColors();

  try {
    const [searchResult, liveTraits] = await Promise.all([
      searchDogByNumber(dogNumber),
      fetchDogTraits(dogNumber)
    ]);

    const traits = normalizeTraits(liveTraits);
    const backgroundColor = colorFromTraitName(traits.background, `${dogNumber}-background`);
    const primaryTraitName = traits.furColor !== 'Unknown' ? traits.furColor : traits.furPattern;
    const primaryColor = colorFromTraitName(primaryTraitName, `${dogNumber}-primary`);
    const accentColor = deriveAccentColor(backgroundColor, primaryColor, brandColors);

    return {
      inscriptionNumber: dogNumber,
      name: searchResult.name || `Doginal Dog #${dogNumber}`,
      inscriptionId: searchResult.inscriptionId || null,
      marketInscriptionNumber: searchResult.inscriptionNumber || null,
      imageUrl: searchResult.imageUrl ? `${MARKET_BASE}${searchResult.imageUrl}` : `${MARKET_BASE}/dogs/${dogNumber}.png`,
      proxyImageUrl: `/api/nail-designer/image/${dogNumber}`,
      background: {
        name: traits.background,
        color: backgroundColor
      },
      primary: {
        name: primaryTraitName,
        color: primaryColor
      },
      accent: {
        name: 'Accent',
        color: accentColor
      },
      accessory: {
        name: chooseAccessory(traits)
      },
      traits,
      rarityRank: liveTraits.rarityRank || null,
      rarityLabel: rarityLabel(liveTraits.rarityRank),
      traitCounts: liveTraits.traitCounts || {},
      market: {
        isListed: Boolean(searchResult.isListed),
        priceDoge: parsePrice(searchResult),
        listingId: searchResult.listingId || null
      },
      brandColors,
      source: 'live',
      message: 'Live Doginal Dogs data loaded'
    };
  } catch (error) {
    const fallback = createFallbackRecord(dogNumber, brandColors);
    fallback.error = error.message;
    return fallback;
  }
}

async function getDogImage(dogNumber) {
  try {
    const searchResult = await searchDogByNumber(dogNumber);
    const remoteUrl = searchResult.imageUrl ? `${MARKET_BASE}${searchResult.imageUrl}` : `${MARKET_BASE}/dogs/${dogNumber}.png`;
    return fetchBinary(remoteUrl);
  } catch (error) {
    const fallbackPath = path.resolve(__dirname, '..', '..', 'assets', 'Kush.png');
    return {
      buffer: await fs.readFile(fallbackPath),
      contentType: 'image/png'
    };
  }
}

async function getBrandAsset(assetName) {
  const normalizedName = String(assetName || '').trim().toLowerCase();
  const remoteUrl = BRAND_ASSET_MAP[normalizedName];

  if (!remoteUrl) {
    const error = new Error('Unknown brand asset requested.');
    error.statusCode = 404;
    throw error;
  }

  return getCachedValue(`brand-asset:${normalizedName}`, 3600000, async () => {
    try {
      return await fetchBinary(remoteUrl);
    } catch (error) {
      if (normalizedName !== 'collection-logo') {
        return fetchBinary(BRAND_ASSET_MAP['collection-logo']);
      }

      const fallbackPath = path.resolve(__dirname, '..', '..', 'assets', 'Kush.png');
      return {
        buffer: await fs.readFile(fallbackPath),
        contentType: 'image/png'
      };
    }
  });
}

module.exports = {
  getBrandColors,
  getBrandAsset,
  getDogImage,
  getInscriptionRecord
};
