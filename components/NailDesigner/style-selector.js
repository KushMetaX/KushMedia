const DESIGN_STYLES = Object.freeze([
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'Glazed nude base, micro-French edges, and a discreet Doginal mark.',
    look: 'micro-french',
    defaultFinish: 'glazed',
    defaultShape: 'almond',
    defaultPortraitZoom: 82,
    detailBias: 54,
    chromeAmount: 0.18,
    auraAmount: 0.14,
    gemCountBase: 0,
    logoPlacement: ['ring'],
    sloganPlacement: ['thumb']
  },
  {
    value: 'luxury',
    label: 'Luxury',
    description: 'Molten black-and-gold chrome with logo decals and jewelry accents.',
    look: 'molten-chrome',
    defaultFinish: 'chrome',
    defaultShape: 'coffin',
    defaultPortraitZoom: 88,
    detailBias: 76,
    chromeAmount: 0.42,
    auraAmount: 0.24,
    gemCountBase: 2,
    logoPlacement: ['index', 'ring'],
    sloganPlacement: ['pinky']
  },
  {
    value: 'streetwear',
    label: 'Streetwear',
    description: 'Airbrush fades, sticker energy, and bold typography pulled from the brand.',
    look: 'airbrush-hype',
    defaultFinish: 'jelly',
    defaultShape: 'stiletto',
    defaultPortraitZoom: 92,
    detailBias: 72,
    chromeAmount: 0.2,
    auraAmount: 0.38,
    gemCountBase: 0,
    logoPlacement: ['index'],
    sloganPlacement: ['thumb', 'pinky']
  },
  {
    value: 'rare-trait',
    label: 'Rare Trait',
    description: 'Cat-eye depth, rarity foil, and gem placement around the standout trait.',
    look: 'rare-velvet',
    defaultFinish: 'velvet',
    defaultShape: 'almond',
    defaultPortraitZoom: 86,
    detailBias: 84,
    chromeAmount: 0.24,
    auraAmount: 0.34,
    gemCountBase: 3,
    logoPlacement: ['ring'],
    sloganPlacement: ['pinky']
  },
  {
    value: 'full-character',
    label: 'Full Character',
    description: 'Portrait-led set with branded support nails and a heavier middle focus.',
    look: 'portrait-suite',
    defaultFinish: 'glazed',
    defaultShape: 'coffin',
    defaultPortraitZoom: 98,
    detailBias: 68,
    chromeAmount: 0.24,
    auraAmount: 0.28,
    gemCountBase: 1,
    logoPlacement: ['index', 'middle'],
    sloganPlacement: ['ring']
  },
  {
    value: 'ombre',
    label: 'Ombré',
    description: 'Smooth gradient fade from cuticle to tip with marbled accent nails and soft tones.',
    look: 'ombre-set',
    defaultFinish: 'glazed',
    defaultShape: 'ballerina',
    defaultPortraitZoom: 90,
    detailBias: 66,
    chromeAmount: 0.14,
    auraAmount: 0.20,
    gemCountBase: 0,
    logoPlacement: ['ring'],
    sloganPlacement: ['pinky']
  },
  {
    value: 'marble',
    label: 'Marble',
    description: 'Elegant marble veining with gold accents, pearl finishes, and refined detail.',
    look: 'marble-set',
    defaultFinish: 'glazed',
    defaultShape: 'oval',
    defaultPortraitZoom: 86,
    detailBias: 72,
    chromeAmount: 0.18,
    auraAmount: 0.16,
    gemCountBase: 2,
    logoPlacement: ['index'],
    sloganPlacement: ['pinky']
  }
]);

const NAIL_SHAPES = Object.freeze([
  { value: 'almond', label: 'Almond' },
  { value: 'coffin', label: 'Coffin' },
  { value: 'stiletto', label: 'Stiletto' },
  { value: 'round', label: 'Round' },
  { value: 'oval', label: 'Oval' },
  { value: 'square', label: 'Square' },
  { value: 'ballerina', label: 'Ballerina' },
  { value: 'squoval', label: 'Squoval' }
]);

const NAIL_FINISHES = Object.freeze([
  { value: 'glazed', label: 'Glazed' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'jelly', label: 'Jelly' },
  { value: 'matte', label: 'Matte' },
  { value: 'holographic', label: 'Holographic' },
  { value: 'glitter', label: 'Glitter' }
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function populateStyleSelector(selectElement) {
  if (!selectElement) {
    return;
  }

  selectElement.innerHTML = '';

  for (const style of DESIGN_STYLES) {
    const option = document.createElement('option');
    option.value = style.value;
    option.textContent = style.label;
    option.dataset.description = style.description;
    selectElement.appendChild(option);
  }
}

function getStyleDefinition(value) {
  return DESIGN_STYLES.find((style) => style.value === value) || DESIGN_STYLES[0];
}

function getChoiceLabel(options, value, fallback) {
  const match = options.find((option) => option.value === value);
  return match ? match.label : fallback;
}

function buildStylePreset(value, dogRecord, editorState = {}) {
  const style = getStyleDefinition(value);
  const accentColor = dogRecord.accent && dogRecord.accent.color
    ? dogRecord.accent.color
    : (dogRecord.brandColors && dogRecord.brandColors.accent) || '#d4af37';

  const finish = NAIL_FINISHES.some((option) => option.value === editorState.finish)
    ? editorState.finish
    : style.defaultFinish;

  const shape = NAIL_SHAPES.some((option) => option.value === editorState.shape)
    ? editorState.shape
    : style.defaultShape;

  const detailLevel = clamp(Number(editorState.detailIntensity ?? style.detailBias) / 100, 0, 1);
  const portraitZoom = clamp(Number(editorState.portraitZoom ?? style.defaultPortraitZoom) / 100, 0.62, 1.18);

  const assetToggles = editorState.assetToggles && typeof editorState.assetToggles === 'object'
    ? { ...editorState.assetToggles }
    : {};
  const assetScales = editorState.assetScales && typeof editorState.assetScales === 'object'
    ? { ...editorState.assetScales }
    : {};

  return {
    ...style,
    accentColor,
    finish,
    finishLabel: getChoiceLabel(NAIL_FINISHES, finish, 'Glazed'),
    shape,
    shapeLabel: getChoiceLabel(NAIL_SHAPES, shape, 'Almond'),
    detailLevel,
    portraitZoom,
    assetToggles,
    assetScales,
    chromeAmount: clamp(style.chromeAmount + (detailLevel * 0.12), 0, 1),
    auraAmount: clamp(style.auraAmount + (detailLevel * 0.12), 0, 1),
    gemCount: Math.round(style.gemCountBase + (detailLevel * 3)),
    frameColor: style.value === 'luxury'
      ? accentColor
      : ((dogRecord.brandColors && dogRecord.brandColors.white) || '#ffffff'),
    contrastColor: style.value === 'streetwear'
      ? '#f7f4ea'
      : ((dogRecord.brandColors && dogRecord.brandColors.black) || '#050505'),
    shadowColor: style.value === 'streetwear'
      ? 'rgba(212, 175, 55, 0.24)'
      : 'rgba(255, 255, 255, 0.12)'
  };
}

export {
  DESIGN_STYLES,
  NAIL_FINISHES,
  NAIL_SHAPES,
  buildStylePreset,
  getStyleDefinition,
  populateStyleSelector
};
