import {
  createFallbackImageDataUrl,
  deriveAccentColor,
  mixHex,
  shiftHex
} from './sample-data.js';
import { buildStylePreset } from './style-selector.js';

const NAIL_ORDER = Object.freeze([
  { id: 'thumb', label: 'Thumb' },
  { id: 'index', label: 'Index' },
  { id: 'middle', label: 'Middle' },
  { id: 'ring', label: 'Ring' },
  { id: 'pinky', label: 'Pinky' }
]);

const BRAND_SLOGAN = 'WOOF! WOOF!';

const NAIL_MOTIF_OPTIONS = Object.freeze([
  { value: 'auto', label: 'Use preset motif' },
  { value: 'micro-french', label: 'Micro French' },
  { value: 'chrome-sweep', label: 'Chrome Sweep' },
  { value: 'airbrush-cloud', label: 'Airbrush Fade' },
  { value: 'cat-eye', label: 'Cat Eye' },
  { value: 'trait-swoop', label: 'Trait Swoop' },
  { value: 'logo-decals', label: 'Logo Decal' },
  { value: 'sticker-badge', label: 'Sticker Badge' },
  { value: 'rare-gems', label: 'Rare Gems' },
  { value: 'slogan-type', label: 'Slogan Type' },
  { value: 'ombre', label: 'Ombré Gradient' },
  { value: 'marble', label: 'Marble Vein' },
  { value: 'portrait', label: 'Portrait Crop' }
]);

const MOTIF_MAP = Object.freeze({
  'micro-french': {
    thumb: 'micro-french',
    index: 'logo-decals',
    middle: 'portrait',
    ring: 'trait-swoop',
    pinky: 'slogan-type'
  },
  'molten-chrome': {
    thumb: 'chrome-sweep',
    index: 'logo-decals',
    middle: 'portrait',
    ring: 'rare-gems',
    pinky: 'micro-french'
  },
  'airbrush-hype': {
    thumb: 'airbrush-cloud',
    index: 'logo-decals',
    middle: 'portrait',
    ring: 'sticker-badge',
    pinky: 'slogan-type'
  },
  'rare-velvet': {
    thumb: 'cat-eye',
    index: 'micro-french',
    middle: 'portrait',
    ring: 'rare-gems',
    pinky: 'slogan-type'
  },
  'portrait-suite': {
    thumb: 'airbrush-cloud',
    index: 'logo-decals',
    middle: 'portrait',
    ring: 'slogan-type',
    pinky: 'micro-french'
  },
  'ombre-set': {
    thumb: 'ombre',
    index: 'ombre',
    middle: 'portrait',
    ring: 'marble',
    pinky: 'ombre'
  },
  'marble-set': {
    thumb: 'marble',
    index: 'micro-french',
    middle: 'portrait',
    ring: 'marble',
    pinky: 'slogan-type'
  }
});

function compactLabel(text, fallback) {
  const value = String(text || fallback || '').trim();
  return value.length > 20 ? `${value.slice(0, 18)}…` : value;
}

function buildTraitSummary(record) {
  const traits = [
    record.traits && record.traits.background,
    record.traits && record.traits.furColor,
    record.accessory && record.accessory.name,
    record.rarityLabel
  ];

  return traits.filter(Boolean).slice(0, 4);
}

function createBaseDescriptor(overrides) {
  return {
    logoEnabled: false,
    logoAssetKey: 'gary',
    logoAssetScale: 1,
    logoOffsetX: 0,
    logoOffsetY: 0,
    logoFlipVertical: false,
    decalText: null,
    defaultSloganText: BRAND_SLOGAN,
    sloganAssetKey: 'woofwoof',
    sloganAssetScale: 1,
    sloganOffsetX: 0,
    sloganOffsetY: 0,
    sloganFlipVertical: false,
    gemCount: 0,
    badgeText: null,
    ribbonText: null,
    detailLevel: 0.5,
    ...overrides
  };
}

function isBrandAssetVisible(stylePreset, assetKey) {
  if (stylePreset.assetToggles && typeof stylePreset.assetToggles === 'object') {
    return stylePreset.assetToggles[assetKey] !== false;
  }
  return true;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePerNailOverride(value) {
  return value && typeof value === 'object' ? value : {};
}

function applyPerNailOverride(descriptor, stylePreset, override) {
  const resolved = {
    ...descriptor
  };
  const explicitLogoAsset = override.logoAssetChoice && override.logoAssetChoice !== 'inherit';
  const explicitSloganAsset = override.sloganAssetChoice && override.sloganAssetChoice !== 'inherit';

  if (override.motif && override.motif !== 'auto') {
    resolved.motif = override.motif;
  }

  if (override.finish && override.finish !== 'auto') {
    resolved.finish = override.finish;
  }

  if (Number.isFinite(override.detailIntensity)) {
    resolved.detailLevel = clamp(override.detailIntensity / 100, 0.2, 1);
  }

  if (Number.isFinite(override.portraitZoom)) {
    resolved.imageZoom = clamp(override.portraitZoom / 100, 0.62, 1.18);
  }

  if (override.logoMode === 'on') {
    resolved.logoEnabled = true;
  } else if (override.logoMode === 'off') {
    resolved.logoEnabled = false;
  }

  if (explicitLogoAsset) {
    if (override.logoAssetChoice === 'none') {
      resolved.logoEnabled = false;
    } else {
      resolved.logoEnabled = true;
      resolved.logoAssetKey = override.logoAssetChoice;
    }
  }

  if (override.sloganMode === 'on') {
    resolved.decalText = resolved.decalText || descriptor.defaultSloganText || BRAND_SLOGAN;
  } else if (override.sloganMode === 'off') {
    resolved.decalText = null;
  }

  if (explicitSloganAsset) {
    if (override.sloganAssetChoice === 'none') {
      resolved.decalText = null;
    } else {
      resolved.decalText = resolved.decalText || descriptor.defaultSloganText || BRAND_SLOGAN;
      resolved.sloganAssetKey = override.sloganAssetChoice;
    }
  }

  if (Number.isFinite(override.logoOffsetX)) {
    resolved.logoOffsetX = clamp(override.logoOffsetX, -30, 30);
  }

  if (Number.isFinite(override.logoOffsetY)) {
    resolved.logoOffsetY = clamp(override.logoOffsetY, -30, 30);
  }

  if (Number.isFinite(override.sloganOffsetX)) {
    resolved.sloganOffsetX = clamp(override.sloganOffsetX, -30, 30);
  }

  if (Number.isFinite(override.sloganOffsetY)) {
    resolved.sloganOffsetY = clamp(override.sloganOffsetY, -30, 30);
  }

  if (override.logoFlipVertical === true) {
    resolved.logoFlipVertical = true;
  }

  if (override.sloganFlipVertical === true) {
    resolved.sloganFlipVertical = true;
  }

  if (resolved.motif === 'logo-decals' && override.logoMode !== 'off' && override.logoAssetChoice !== 'none') {
    if (explicitLogoAsset) {
      resolved.logoEnabled = true;
    } else if (isBrandAssetVisible(stylePreset, resolved.logoAssetKey || 'gary')) {
      resolved.logoEnabled = true;
    }
  }

  if (resolved.motif === 'slogan-type' && override.sloganMode !== 'off' && override.sloganAssetChoice !== 'none') {
    if (explicitSloganAsset || isBrandAssetVisible(stylePreset, resolved.sloganAssetKey || 'woofwoof')) {
      resolved.decalText = resolved.decalText || descriptor.defaultSloganText || BRAND_SLOGAN;
    }
  }

  if (resolved.logoEnabled && !explicitLogoAsset && !isBrandAssetVisible(stylePreset, resolved.logoAssetKey)) {
    resolved.logoEnabled = false;
  }

  if (resolved.decalText && !explicitSloganAsset && !isBrandAssetVisible(stylePreset, resolved.sloganAssetKey || 'woofwoof')) {
    resolved.decalText = null;
  }

  if (resolved.motif !== 'rare-gems') {
    resolved.gemCount = Math.max(0, Math.round((resolved.gemCount || 0) * (0.4 + resolved.detailLevel)));
  } else {
    resolved.gemCount = Math.max(1, Math.round((resolved.gemCount || stylePreset.gemCount || 1) * (0.6 + resolved.detailLevel)));
  }

  return resolved;
}

function buildNails(record, stylePreset, perNail = {}) {
  const backgroundColor = record.background && record.background.color ? record.background.color : '#c89f77';
  const primaryColor = record.primary && record.primary.color ? record.primary.color : '#7d8591';
  const accentColor = record.accent && record.accent.color
    ? record.accent.color
    : deriveAccentColor(backgroundColor, primaryColor, record.brandColors || {});

  const motifSet = MOTIF_MAP[stylePreset.look] || MOTIF_MAP['micro-french'];
  const logoSet = new Set(stylePreset.logoPlacement || []);
  const sloganSet = new Set(stylePreset.sloganPlacement || []);
  const sheerBase = mixHex('#f0d7bf', primaryColor, 0.14);
  const mistBase = mixHex(sheerBase, backgroundColor, 0.16);
  const foilColor = mixHex(accentColor, '#fff0b3', 0.34);
  const defaultLogoKey = 'gary';
  const defaultSloganKey = 'woofwoof';
  const logoScale = (stylePreset.assetScales && stylePreset.assetScales[defaultLogoKey] || 100) / 100;
  const sloganScale = (stylePreset.assetScales && stylePreset.assetScales[defaultSloganKey] || 100) / 100;
  const middleImage = record.imageUrl || createFallbackImageDataUrl({
    inscriptionNumber: record.inscriptionNumber,
    backgroundColor,
    primaryColor,
    accentColor
  });

  return [
    createBaseDescriptor({
      id: 'thumb',
      label: 'Thumb',
      role: 'background',
      motif: motifSet.thumb,
      title: compactLabel(record.background && record.background.name, 'Background'),
      caption: 'Aura Base',
      chipText: compactLabel(record.background && record.background.name, 'Background'),
      baseColor: mistBase,
      secondaryColor: shiftHex(mistBase, 0.08),
      accentColor,
      auraColor: mixHex(backgroundColor, accentColor, 0.4),
      tipColor: backgroundColor,
      foilColor,
      detailLevel: stylePreset.detailLevel,
      shape: stylePreset.shape,
      finish: stylePreset.finish,
      logoAssetScale: logoScale,
      logoEnabled: logoSet.has('thumb') && isBrandAssetVisible(stylePreset, defaultLogoKey),
      logoAssetKey: defaultLogoKey,
      defaultSloganText: BRAND_SLOGAN,
      decalText: sloganSet.has('thumb') ? BRAND_SLOGAN : null,
      sloganAssetKey: defaultSloganKey,
      sloganAssetScale: sloganScale,
      sloganScale: 0.8
    }),
    createBaseDescriptor({
      id: 'index',
      label: 'Index',
      role: 'primary',
      motif: motifSet.index,
      title: compactLabel(record.primary && record.primary.name, 'Primary'),
      caption: 'Brand Decal',
      chipText: compactLabel(record.primary && record.primary.name, 'Primary'),
      baseColor: mixHex(sheerBase, primaryColor, 0.28),
      secondaryColor: shiftHex(primaryColor, 0.2),
      accentColor,
      auraColor: mixHex(primaryColor, accentColor, 0.36),
      tipColor: stylePreset.look === 'molten-chrome' ? foilColor : accentColor,
      foilColor,
      detailLevel: stylePreset.detailLevel,
      shape: stylePreset.shape,
      finish: stylePreset.finish,
      logoEnabled: (logoSet.has('index') && isBrandAssetVisible(stylePreset, defaultLogoKey))
        || (isBrandAssetVisible(stylePreset, defaultLogoKey) && motifSet.index === 'logo-decals'),
      logoAssetKey: defaultLogoKey,
      logoAssetScale: logoScale,
      defaultSloganText: 'DOGINAL DOGS',
      decalText: sloganSet.has('index') ? 'DOGINAL DOGS' : null,
      sloganAssetKey: defaultSloganKey,
      sloganAssetScale: sloganScale,
      sloganScale: 0.72
    }),
    createBaseDescriptor({
      id: 'middle',
      label: 'Middle',
      role: 'character',
      motif: motifSet.middle,
      title: compactLabel(record.name, `Doginal Dog #${record.inscriptionNumber}`),
      caption: 'Portrait',
      chipText: `#${record.inscriptionNumber}`,
      baseColor: mixHex(primaryColor, accentColor, 0.34),
      secondaryColor: mixHex(backgroundColor, accentColor, 0.44),
      accentColor,
      auraColor: mixHex(accentColor, '#ffffff', 0.18),
      tipColor: accentColor,
      foilColor,
      detailLevel: stylePreset.detailLevel,
      shape: stylePreset.shape,
      finish: stylePreset.finish,
      imageSrc: middleImage,
      imageZoom: stylePreset.portraitZoom,
      logoEnabled: logoSet.has('middle') && isBrandAssetVisible(stylePreset, defaultLogoKey),
      logoAssetKey: defaultLogoKey,
      logoAssetScale: logoScale,
      defaultSloganText: BRAND_SLOGAN,
      decalText: sloganSet.has('middle') ? BRAND_SLOGAN : null,
      sloganAssetKey: defaultSloganKey,
      sloganAssetScale: sloganScale,
      sloganScale: 0.82,
      badgeText: stylePreset.look === 'rare-velvet' ? compactLabel(record.rarityLabel, 'Rare') : null
    }),
    createBaseDescriptor({
      id: 'ring',
      label: 'Ring',
      role: 'trait',
      motif: motifSet.ring,
      title: compactLabel(record.accessory && record.accessory.name, 'Trait'),
      caption: 'Trait Accent',
      chipText: compactLabel(record.accessory && record.accessory.name, 'Trait'),
      badgeText: compactLabel(record.rarityLabel, 'Trait'),
      baseColor: mixHex(sheerBase, accentColor, 0.18),
      secondaryColor: mixHex(primaryColor, accentColor, 0.34),
      accentColor,
      auraColor: mixHex(accentColor, backgroundColor, 0.26),
      tipColor: foilColor,
      foilColor,
      detailLevel: stylePreset.detailLevel,
      shape: stylePreset.shape,
      finish: stylePreset.finish,
      logoEnabled: logoSet.has('ring') && isBrandAssetVisible(stylePreset, defaultLogoKey),
      logoAssetKey: defaultLogoKey,
      logoAssetScale: logoScale,
      defaultSloganText: BRAND_SLOGAN,
      decalText: sloganSet.has('ring') ? BRAND_SLOGAN : null,
      sloganAssetKey: defaultSloganKey,
      sloganAssetScale: sloganScale,
      sloganScale: 0.74,
      gemCount: stylePreset.look === 'molten-chrome' || stylePreset.look === 'rare-velvet'
        ? stylePreset.gemCount
        : Math.round(stylePreset.gemCount * 0.5)
    }),
    createBaseDescriptor({
      id: 'pinky',
      label: 'Pinky',
      role: 'accent',
      motif: motifSet.pinky,
      title: compactLabel(record.rarityLabel, 'Accent'),
      caption: 'Slogan Tip',
      chipText: record.rarityRank ? `Rank ${record.rarityRank}` : record.rarityLabel,
      badgeText: stylePreset.look === 'airbrush-hype' ? 'PACK' : null,
      baseColor: mixHex(sheerBase, accentColor, 0.26),
      secondaryColor: shiftHex(accentColor, 0.18),
      accentColor: shiftHex(accentColor, -0.08),
      auraColor: mixHex(accentColor, backgroundColor, 0.3),
      tipColor: accentColor,
      foilColor,
      detailLevel: stylePreset.detailLevel,
      shape: stylePreset.shape,
      finish: stylePreset.finish,
      logoEnabled: logoSet.has('pinky') && isBrandAssetVisible(stylePreset, defaultLogoKey),
      logoAssetKey: defaultLogoKey,
      logoAssetScale: logoScale,
      defaultSloganText: BRAND_SLOGAN,
      decalText: sloganSet.has('pinky') ? BRAND_SLOGAN : null,
      sloganAssetKey: defaultSloganKey,
      sloganAssetScale: sloganScale,
      sloganScale: 0.7
    })
  ].map((descriptor) => applyPerNailOverride(descriptor, stylePreset, normalizePerNailOverride(perNail[descriptor.id])));
}

function generateNailDesign(record, styleValue, editorState = {}) {
  const stylePreset = buildStylePreset(styleValue, record, editorState);
  const nails = buildNails(record, stylePreset, editorState.perNail);
  const hasSloganDecal = nails.some((descriptor) => Boolean(descriptor.decalText));

  return {
    key: `${record.inscriptionNumber}-${stylePreset.value}-${stylePreset.shape}-${stylePreset.finish}`,
    style: stylePreset,
    nails,
    summary: {
      title: `Doginal Dog #${record.inscriptionNumber}`,
      subtitle: record.usedFallback ? 'Fallback data set' : 'Live Doginal Dogs set',
      inscriptionNumber: record.inscriptionNumber,
      rarityRank: record.rarityRank,
      rarityLabel: record.rarityLabel,
      accessory: record.accessory && record.accessory.name,
      sourceLabel: record.usedFallback ? 'Fallback data' : 'Live market data',
      message: record.message,
      traitSummary: buildTraitSummary(record),
      finishLabel: stylePreset.finishLabel,
      shapeLabel: stylePreset.shapeLabel,
      slogan: hasSloganDecal ? BRAND_SLOGAN : ''
    }
  };
}

export {
  BRAND_SLOGAN,
  NAIL_MOTIF_OPTIONS,
  NAIL_ORDER,
  generateNailDesign
};
