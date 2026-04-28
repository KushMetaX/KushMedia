const DEFAULT_BRAND_PALETTE = Object.freeze({
  accent: '#d4af37',
  surface: '#111111',
  background: '#000000',
  text: '#f7f4ea',
  white: '#ffffff',
  black: '#000000'
});

const COLOR_MAP = Object.freeze({
  tan: '#c89f77',
  beige: '#d6b88f',
  cream: '#efe2ba',
  gold: '#d4af37',
  yellow: '#ddb74a',
  orange: '#d97a34',
  brown: '#775548',
  chocolate: '#5d4037',
  red: '#c44536',
  crimson: '#8f2f44',
  pink: '#d86f8f',
  magenta: '#b7498a',
  purple: '#7b58c6',
  violet: '#7565d9',
  blue: '#4b6fd2',
  navy: '#243f8f',
  cyan: '#4aa9c8',
  teal: '#2f8f8b',
  green: '#4b8f4d',
  lime: '#8ebf57',
  olive: '#73824d',
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

function hexToRgb(color) {
  const normalized = normalizeHex(color) || DEFAULT_BRAND_PALETTE.accent;
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

function hashString(value) {
  let hash = 0;

  for (const character of String(value || '')) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildHashedColor(label, fallbackSeed) {
  const hash = hashString(`${label || ''}-${fallbackSeed || ''}`);
  const hue = hash % 360;
  const saturation = 52 + (hash % 28);
  const lightness = 44 + (hash % 20);
  return hslToHex(hue, saturation, lightness);
}

function mixHex(colorA, colorB, weight = 0.5) {
  const first = hexToRgb(colorA);
  const second = hexToRgb(colorB);
  const ratio = Math.max(0, Math.min(1, weight));

  return rgbToHex(
    first.r + ((second.r - first.r) * ratio),
    first.g + ((second.g - first.g) * ratio),
    first.b + ((second.b - first.b) * ratio)
  );
}

function shiftHex(color, amount = 0) {
  const rgb = hexToRgb(color);
  const delta = Math.max(-1, Math.min(1, amount));
  const factor = delta >= 0 ? 255 : 0;

  return rgbToHex(
    rgb.r + ((factor - rgb.r) * Math.abs(delta)),
    rgb.g + ((factor - rgb.g) * Math.abs(delta)),
    rgb.b + ((factor - rgb.b) * Math.abs(delta))
  );
}

function colorFromLabel(label, fallbackSeed) {
  const normalized = String(label || '').trim().toLowerCase();

  if (!normalized) {
    return buildHashedColor('unknown', fallbackSeed);
  }

  if (COLOR_MAP[normalized]) {
    return COLOR_MAP[normalized];
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (COLOR_MAP[token]) {
      return COLOR_MAP[token];
    }
  }

  return buildHashedColor(normalized, fallbackSeed);
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

function createFallbackImageDataUrl({ inscriptionNumber, backgroundColor, primaryColor, accentColor }) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="Fallback Doginal Dog avatar">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${backgroundColor}" />
          <stop offset="100%" stop-color="${shiftHex(backgroundColor, -0.15)}" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" fill="url(#bg)" />
      <rect x="44" y="56" width="232" height="208" rx="28" fill="${primaryColor}" />
      <circle cx="118" cy="120" r="24" fill="${accentColor}" />
      <circle cx="202" cy="120" r="24" fill="${accentColor}" />
      <rect x="92" y="174" width="136" height="24" rx="12" fill="#101010" opacity="0.85" />
      <rect x="112" y="188" width="96" height="18" rx="9" fill="${shiftHex(accentColor, 0.18)}" />
      <rect x="66" y="28" width="188" height="24" rx="12" fill="#101010" opacity="0.78" />
      <text x="160" y="196" text-anchor="middle" fill="#f7f4ea" font-family="Orbitron, sans-serif" font-size="18" letter-spacing="1.5">KUSH</text>
      <text x="160" y="296" text-anchor="middle" fill="#f7f4ea" font-family="Orbitron, sans-serif" font-size="24" letter-spacing="2">#${inscriptionNumber}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function deriveAccentColor(backgroundColor, primaryColor, brandPalette) {
  return mixHex(mixHex(backgroundColor, primaryColor, 0.45), brandPalette.accent || DEFAULT_BRAND_PALETTE.accent, 0.35);
}

function createFallbackDogRecord(inscriptionNumber, brandPalette = DEFAULT_BRAND_PALETTE) {
  const backgroundName = FALLBACK_BACKGROUNDS[inscriptionNumber % FALLBACK_BACKGROUNDS.length];
  const primaryName = FALLBACK_PRIMARIES[(inscriptionNumber * 3) % FALLBACK_PRIMARIES.length];
  const accessoryName = FALLBACK_ACCESSORIES[(inscriptionNumber * 5) % FALLBACK_ACCESSORIES.length];
  const headName = FALLBACK_HEADS[(inscriptionNumber * 7) % FALLBACK_HEADS.length];
  const eyeName = FALLBACK_EYES[(inscriptionNumber * 11) % FALLBACK_EYES.length];
  const backgroundColor = colorFromLabel(backgroundName, `${inscriptionNumber}-background`);
  const primaryColor = colorFromLabel(primaryName, `${inscriptionNumber}-primary`);
  const accentColor = deriveAccentColor(backgroundColor, primaryColor, brandPalette);
  const rank = 1 + ((inscriptionNumber * 173) % 10000);

  return {
    inscriptionNumber,
    name: `Doginal Dog #${inscriptionNumber}`,
    usedFallback: true,
    source: 'fallback',
    message: 'Design generated using default data',
    brandColors: brandPalette,
    imageUrl: createFallbackImageDataUrl({
      inscriptionNumber,
      backgroundColor,
      primaryColor,
      accentColor
    }),
    proxyImageUrl: null,
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
    market: {
      isListed: false,
      priceDoge: null,
      listingId: null
    }
  };
}

export {
  DEFAULT_BRAND_PALETTE,
  colorFromLabel,
  createFallbackDogRecord,
  createFallbackImageDataUrl,
  deriveAccentColor,
  hexToRgb,
  mixHex,
  normalizeHex,
  rarityLabel,
  shiftHex
};
