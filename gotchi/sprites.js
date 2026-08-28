/**
 * Pixel identity quantized from the attached GARY / MARY portraits
 * onto a 25×25 nearest-neighbor grid. Cream #F5E49F → transparent (.).
 * K outline  F fur  D dark fur  T tan snout  W eye  B bow
 */

export const GARY_25 = [
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.......KKK......KK.......',
  '......KFFFKKKKKKFFK......',
  '.....KFFFKFFFFFFKFFK.....',
  '.....KFFKDFTFFFTFKFK.....',
  '......KKDFFDDFFDDKK......',
  '.......KFFFKWFFKWK.......',
  '.......KFFFFFFFFFFK......',
  '.......KTTFFFTKKTFK......',
  '........KTTTTTTTTTK......',
  '........KKTTTTTTTK.......',
  '.......KFDKKKKKKK........',
  '.......KFFDTTTTK.........',
  '......KFFFFDTTTK.........',
  '......KFFFFFDTTK.........',
  '.....KFFFFFFFTDDK........',
  '.....KFFFFFFFFFFK........',
  '....KFFFFFFFFFFFK........',
];

export const MARY_25 = [
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '.........................',
  '..........KK.KK..........',
  '.........KBBKBBK.........',
  '.......KKKBKBKBKKK.......',
  '......KFFKBBKBBKFFK......',
  '.....KFFFKKKFKKFKFFK.....',
  '.....KFFKDFTFFFTFKFK.....',
  '......KKDFFDDFFDDKK......',
  '.......KFFFKWFFKWK.......',
  '.......KFFFFFFFFFFK......',
  '.......KTTFFFTKKTFK......',
  '........KTTTTTTTTTK......',
  '........KKTTTTTTTK.......',
  '.......KFDKKKKKKK........',
  '.......KFFDTTTTK.........',
  '......KFFFFDTTTK.........',
  '......KFFFFFDTTK.........',
  '.....KFFFFFFFTDDK........',
  '.....KFFFFFFFFFFK........',
  '....KFFFFFFFFFFFK........',
];

/** Half-res gameplay walkers (~13px), derived from the same identity. */
export const GARY_WALK = [
  '...KK....KK..',
  '..KFFKKKKFFK.',
  '.KFFKFFFFKFFK',
  '.KFKTFFTFKFK.',
  '..KFFKWFFWK..',
  '..KFFFFFFFFK.',
  '..KTFFTKKTFK.',
  '...KTTTTTTK..',
  '..KFKKKKKK...',
  '..KFFTTTTK...',
  '.KFFFFDTTK...',
  '.KFFFFFFTDK..',
  'KFFFFFFFFFK..',
];

export const MARY_WALK = [
  '....KK.KK....',
  '...KBBKBBK...',
  '..KKKBKBKKK..',
  '..KFKBBKBFK..',
  '.KFFKKKFKKFK.',
  '.KFKTFFTFKFK.',
  '..KFFKWFFWK..',
  '..KFFFFFFFFK.',
  '..KTFFTKKTFK.',
  '...KTTTTTTK..',
  '..KFKKKKKK...',
  '..KFFTTTTK...',
  '.KFFFFDTTK...',
  '.KFFFFFFTDK..',
  'KFFFFFFFFFK..',
];

export const BABY_WALK = [
  '.KK...KK.',
  'KFFKKKFFK',
  'KFKFFFKFK',
  '.KFKWKWK.',
  '.KFFFFFFK',
  '.KTTFTTFK',
  '..KTTTTK.',
  '.KFKKKKK.',
  '.KFFTTTK.',
  'KFFFFFTK.',
];

export const CHILD_WALK = [
  '..KK...KK..',
  '.KFFKKKFFK.',
  'KFFKFFFKFFK',
  'KFKTFTTFKK.',
  '.KFFKWFWK..',
  '.KFFFFFFFFK',
  '.KTFFTKTFK.',
  '..KTTTTTK..',
  '.KFKKKKK...',
  '.KFFDTTK...',
  'KFFFFFTDK..',
];

export const EGG = [
  '....KKKK....',
  '...K....K...',
  '..K......K..',
  '.K........K.',
  '.K........K.',
  'K..........K',
  'K..........K',
  'K..........K',
  'K..........K',
  '.K........K.',
  '.K........K.',
  '..K......K..',
  '...K....K...',
  '....KKKK....',
];

export const EGG_CRACK1 = [
  '....KKKK....',
  '...K....K...',
  '..K...K..K..',
  '.K...K....K.',
  '.K..K.....K.',
  'K...K......K',
  'K..K.......K',
  'K.K........K',
  'K..........K',
  '.K........K.',
  '.K........K.',
  '..K......K..',
  '...K....K...',
  '....KKKK....',
];

export const EGG_CRACK2 = [
  '....KKKK....',
  '...K.K..K...',
  '..K.K.K..K..',
  '.K.K.K....K.',
  '.KK.K.....K.',
  'K..K.K.....K',
  'K.K...K....K',
  'KK.....K...K',
  'K.......K..K',
  '.K....K..K.',
  '.K...K...K.',
  '..K.K...K..',
  '...K.K.K...',
  '....KKKK....',
];

export const ICONS = {
  food: [
    '..KKKK..',
    '.K....K.',
    'K......K',
    '.KKKKKK.',
    'K......K',
    '.KKKKKK.',
    '..K..K..',
    '........',
  ],
  lights: [
    '...KK...',
    '..K..K..',
    '..K..K..',
    '...KK...',
    '...KK...',
    '..K..K..',
    '.K....K.',
    '........',
  ],
  game: [
    '.KK..KK.',
    'K..KK..K',
    'K.K..K.K',
    '.KK..KK.',
    '........',
    'K.K..K.K',
    '.K....K.',
    '........',
  ],
  medicine: [
    '...KK...',
    '...KK...',
    '.KKKKKK.',
    '.KKKKKK.',
    '...KK...',
    '...KK...',
    '........',
    '........',
  ],
  toilet: [
    '..KKKKK.',
    '..K...K.',
    '.K.....K',
    '.K.....K',
    '.KKKKKKK',
    '...KK...',
    '..KKKK..',
    '........',
  ],
  status: [
    '.KKKKKK.',
    'K......K',
    'K.KKK..K',
    'K......K',
    'K.KKKK.K',
    'K......K',
    '.KKKKKK.',
    '........',
  ],
  discipline: [
    '.KKKKK..',
    'K.....K.',
    '..KKK...',
    '.K...K..',
    'K.....K.',
    '.K.K.K..',
    '........',
    '........',
  ],
  attention: [
    '.KKKKKK.',
    'K......K',
    'K.KK...K',
    'K......K',
    '.KKKKKK.',
    '..KK....',
    '.K......',
    '........',
  ],
};

export const HAMBURGER = [
  '..KKKKKK..',
  '.K......K.',
  'KKKKKKKKKK',
  'K........K',
  'KKKKKKKKKK',
  '.K......K.',
  '..KKKKKK..',
];

export const CAKE = [
  '...KK.KK..',
  '..K..K..K.',
  '.KKKKKKKK.',
  'K........K',
  '.KKKKKKKK.',
  'K........K',
  '.KKKKKKKK.',
];

export const POOP = [
  '...KK...',
  '..K..K..',
  '.K.K..K.',
  'K......K',
  '.KKKKKK.',
];

export const SKULL = [
  '.KKKKKK.',
  'K......K',
  'K.K..K.K',
  'K......K',
  '.K.KK.K.',
  '..K..K..',
  '..K.KK..',
  '........',
];

export const ZZZ = [
  'KKK..KK.',
  '..K.K...',
  '.K...KKK',
  'K.......',
  '........',
];

export const ANGEL = [
  '......KK......',
  '.....K..K.....',
  '..KK..KK..KK..',
  '.K..KK..KK..K.',
  'K....K..K....K',
  '.K...KWWK...K.',
  '..K.K....K.K..',
  '...K.KKKK.K...',
  '....K....K....',
  '.....KKKK.....',
  '....K....K....',
  '...K......K...',
];

export const HEART = [
  '.K.K.',
  'KKKKK',
  'KKKKK',
  '.KKK.',
  '..K..',
];

export const HEART_EMPTY = [
  '.K.K.',
  'K.K.K',
  'K...K',
  '.K.K.',
  '..K..',
];

export const BAR = [
  'KKKKK',
  'KKKKK',
];

export const BAR_EMPTY = [
  'K...K',
  'KKKKK',
];

/** 3×5 bitmap font. */
export const FONT = {
  ' ': ['...', '...', '...', '...', '...'],
  A: ['.K.', 'K.K', 'KKK', 'K.K', 'K.K'],
  B: ['KK.', 'K.K', 'KK.', 'K.K', 'KK.'],
  C: ['.KK', 'K..', 'K..', 'K..', '.KK'],
  D: ['KK.', 'K.K', 'K.K', 'K.K', 'KK.'],
  E: ['KKK', 'K..', 'KK.', 'K..', 'KKK'],
  F: ['KKK', 'K..', 'KK.', 'K..', 'K..'],
  G: ['.KK', 'K..', 'K.K', 'K.K', '.KK'],
  H: ['K.K', 'K.K', 'KKK', 'K.K', 'K.K'],
  I: ['KKK', '.K.', '.K.', '.K.', 'KKK'],
  J: ['.KK', '..K', '..K', 'K.K', '.K.'],
  K: ['K.K', 'K.K', 'KK.', 'K.K', 'K.K'],
  L: ['K..', 'K..', 'K..', 'K..', 'KKK'],
  M: ['K.K', 'KKK', 'K.K', 'K.K', 'K.K'],
  N: ['K.K', 'KKK', 'KKK', 'K.K', 'K.K'],
  O: ['.K.', 'K.K', 'K.K', 'K.K', '.K.'],
  P: ['KK.', 'K.K', 'KK.', 'K..', 'K..'],
  Q: ['.K.', 'K.K', 'K.K', '.KK', '..K'],
  R: ['KK.', 'K.K', 'KK.', 'K.K', 'K.K'],
  S: ['.KK', 'K..', '.K.', '..K', 'KK.'],
  T: ['KKK', '.K.', '.K.', '.K.', '.K.'],
  U: ['K.K', 'K.K', 'K.K', 'K.K', 'KKK'],
  V: ['K.K', 'K.K', 'K.K', 'K.K', '.K.'],
  W: ['K.K', 'K.K', 'K.K', 'KKK', 'K.K'],
  X: ['K.K', 'K.K', '.K.', 'K.K', 'K.K'],
  Y: ['K.K', 'K.K', '.K.', '.K.', '.K.'],
  Z: ['KKK', '..K', '.K.', 'K..', 'KKK'],
  0: ['KKK', 'K.K', 'K.K', 'K.K', 'KKK'],
  1: ['.K.', 'KK.', '.K.', '.K.', 'KKK'],
  2: ['KKK', '..K', 'KKK', 'K..', 'KKK'],
  3: ['KKK', '..K', 'KKK', '..K', 'KKK'],
  4: ['K.K', 'K.K', 'KKK', '..K', '..K'],
  5: ['KKK', 'K..', 'KKK', '..K', 'KKK'],
  6: ['KKK', 'K..', 'KKK', 'K.K', 'KKK'],
  7: ['KKK', '..K', '..K', '..K', '..K'],
  8: ['KKK', 'K.K', 'KKK', 'K.K', 'KKK'],
  9: ['KKK', 'K.K', 'KKK', '..K', 'KKK'],
  ':': ['.', 'K', '.', 'K', '.'],
  '?': ['KKK', '..K', '.K.', '...', '.K.'],
  '!': ['.K.', '.K.', '.K.', '...', '.K.'],
  '-': ['...', '...', 'KKK', '...', '...'],
  '+': ['...', '.K.', 'KKK', '.K.', '...'],
  '/': ['..K', '..K', '.K.', 'K..', 'K..'],
  '.': ['...', '...', '...', '...', '.K.'],
  "'": ['.K.', '.K.', '...', '...', '...'],
  '<': ['..K', '.K.', 'K..', '.K.', '..K'],
  '>': ['K..', '.K.', '..K', '.K.', 'K..'],
};

export function cropSprite(rows) {
  let minX = 99;
  let minY = 99;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] !== '.') {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return rows;
  return rows.slice(minY, maxY + 1).map((row) => row.slice(minX, maxX + 1));
}

export const GARY_PORTRAIT = cropSprite(GARY_25);
export const MARY_PORTRAIT = cropSprite(MARY_25);

export function blinkSprite(rows) {
  return rows.map((row) => row.replace(/W/g, 'F'));
}

export function hideBow(rows) {
  return rows.map((row) => row.replace(/B/g, 'F'));
}
