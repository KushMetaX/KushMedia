/**
 * AI nail art generation via Pollinations.ai (free, no API key).
 * Builds text prompts from inscription traits and returns Image promises.
 */

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const IMAGE_WIDTH = 380;
const IMAGE_HEIGHT = 560;

const FINGER_ROLES = Object.freeze({
  thumb:  { label: 'Thumb',  hint: 'soft gradient wash, minimal detail' },
  index:  { label: 'Index',  hint: 'bold geometric accent pattern' },
  middle: { label: 'Middle', hint: 'central showcase design, ornate detail' },
  ring:   { label: 'Ring',   hint: 'jewel-toned ornamental motif' },
  pinky:  { label: 'Pinky',  hint: 'delicate accent flourish' }
});

function buildPrompt(finger, record, shape, finish) {
  const bgColor = record.background?.name || 'neutral';
  const primaryColor = record.primary?.name || 'warm tone';
  const accentColor = record.accent?.name || 'gold';
  const rarity = record.rarityLabel || 'Collector';
  const accessory = record.accessory?.name || '';
  const role = FINGER_ROLES[finger] || FINGER_ROLES.thumb;

  const parts = [
    'abstract decorative pattern texture',
    `${bgColor} and ${primaryColor} color palette with ${accentColor} accents`,
    role.hint,
    `${finish} surface appearance`,
    `${rarity} tier luxury aesthetic`,
    accessory ? `${accessory} inspired motif` : '',
    'flat digital art, vertical composition, ornamental, elegant',
    'no people, no hands, no fingers, no nails, no text, no watermark'
  ].filter(Boolean);

  return parts.join(', ');
}

function buildImageUrl(prompt, seed) {
  const encoded = encodeURIComponent(prompt);
  return `${POLLINATIONS_BASE}/${encoded}?width=${IMAGE_WIDTH}&height=${IMAGE_HEIGHT}&nologo=true&seed=${seed}`;
}

function loadAiImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('AI image generation failed'));
    img.src = url;
  });
}

/**
 * Generate AI nail art images for all 5 fingers.
 * Returns { thumb: Image|null, index: Image|null, ... }
 * Non-blocking: each nail resolves independently.
 */
async function generateAiNails(record, shape = 'almond', finish = 'glazed') {
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  const results = {};

  const promises = fingers.map(async (finger, i) => {
    const prompt = buildPrompt(finger, record, shape, finish);
    const seed = (record.inscriptionNumber || 1) * 100 + i;
    const url = buildImageUrl(prompt, seed);

    try {
      results[finger] = await loadAiImage(url);
    } catch {
      results[finger] = null;
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * Generate a single AI nail image for one finger.
 */
async function generateSingleAiNail(finger, record, shape = 'almond', finish = 'glazed') {
  const prompt = buildPrompt(finger, record, shape, finish);
  const idx = ['thumb', 'index', 'middle', 'ring', 'pinky'].indexOf(finger);
  const seed = (record.inscriptionNumber || 1) * 100 + idx;
  const url = buildImageUrl(prompt, seed);
  return loadAiImage(url);
}

export {
  generateAiNails,
  generateSingleAiNail
};
