/** Original P1-style mechanics, accelerated. 400ms real = 1 game minute. */

export const SAVE_KEY = 'doginal-gotchi-v1';
export const SAVE_VERSION = 1;
export const MS_PER_MIN = 400;

const EGG_MIN = 48;
const BABY_MIN = 7 * 60;
const CHILD_MIN = 11 * 60;
const TEEN_MIN = 14 * 60;
const STARVE_MIN = 8 * 60;
const SICK_DEATH_MIN = 8 * 60;
const HUNGER_EVERY = 120;
const HAPPY_EVERY = 180;
const POOP_DELAY = 70;
const NIGHT_START = 21;
const NIGHT_END = 8;

export const ICONS = ['food', 'lights', 'game', 'medicine', 'toilet', 'status', 'discipline'];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function isNight(state) {
  return state.clockH >= NIGHT_START || state.clockH < NIGHT_END;
}

export function isSleeping(state) {
  return state.screen === 'play' && state.stage !== 'egg' && state.stage !== 'dead' && isNight(state) && !state.lightsOn;
}

export function lifeMinutes(state) {
  if (state.stage === 'egg' || state.hatchAt == null) return 0;
  return Math.max(0, state.t - state.hatchAt);
}

export function stageForLife(life) {
  if (life < BABY_MIN) return 'baby';
  if (life < BABY_MIN + CHILD_MIN) return 'child';
  if (life < BABY_MIN + CHILD_MIN + TEEN_MIN) return 'teen';
  return 'adult';
}

export function hasSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data && data.version === SAVE_VERSION && data.state;
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!data || data.version !== SAVE_VERSION || !data.state) return null;
    return data.state;
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      version: SAVE_VERSION,
      savedAt: Date.now(),
      state,
    }));
  } catch {
    /* quota / private mode */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function createTitleState() {
  return {
    screen: 'title',
    pet: 'gary',
    keepChoice: 'keep',
    clockH: 12,
    clockM: 0,
    clockField: 0,
    icon: 0,
    menu: null,
    menuOpt: 0,
    statusPage: 0,
    t: 0,
    hatchAt: null,
    stage: 'egg',
    hunger: 2,
    happy: 2,
    discipline: 0,
    weight: 5,
    lightsOn: true,
    sick: false,
    poops: 0,
    mealsToday: 0,
    snacksToday: 0,
    poopAt: [],
    calling: false,
    callReason: null,
    naughty: false,
    hungerEmptySince: null,
    happyEmptySince: null,
    sickSince: null,
    lastHungerTick: 0,
    lastHappyTick: 0,
    lifespan: randInt(6 * 24 * 60, 8 * 24 * 60),
    deathAge: 0,
    deathReason: null,
    careMistakes: 0,
    nightMistake: false,
    anim: null,
    walkX: 24,
    walkDir: 1,
    walkBob: 0,
    game: null,
  };
}

export function startEgg(state) {
  state.screen = 'play';
  state.stage = 'egg';
  state.t = 0;
  state.hatchAt = null;
  state.menu = null;
  state.anim = { type: 'egg', crack: 0 };
  state.hunger = 2;
  state.happy = 2;
  state.discipline = 0;
  state.weight = 5;
  state.sick = false;
  state.poops = 0;
  state.poopAt = [];
  state.mealsToday = 0;
  state.snacksToday = 0;
  state.calling = false;
  state.lightsOn = true;
  state.lifespan = randInt(6 * 24 * 60, 8 * 24 * 60);
}

function die(state, reason) {
  state.stage = 'dead';
  state.screen = 'dead';
  state.deathReason = reason;
  state.deathAge = Math.floor(lifeMinutes(state) / (24 * 60));
  state.calling = false;
  state.menu = null;
  state.anim = { type: 'dead' };
}

function refreshCall(state) {
  if (state.screen !== 'play' || state.stage === 'egg' || state.stage === 'dead') {
    state.calling = false;
    state.callReason = null;
    state.naughty = false;
    return;
  }

  const night = isNight(state);
  const sleeping = isSleeping(state);

  if (state.sick) {
    state.calling = true;
    state.callReason = 'sick';
    state.naughty = false;
    return;
  }
  if (state.poops >= 1) {
    state.calling = true;
    state.callReason = 'poop';
    state.naughty = false;
    return;
  }
  if (state.hunger <= 1) {
    state.calling = true;
    state.callReason = 'hungry';
    state.naughty = false;
    return;
  }
  if (state.happy <= 1) {
    state.calling = true;
    state.callReason = 'unhappy';
    state.naughty = false;
    return;
  }
  if (night && state.lightsOn) {
    state.calling = true;
    state.callReason = 'lights';
    state.naughty = false;
    return;
  }
  if (!night && !state.lightsOn && !sleeping) {
    state.calling = true;
    state.callReason = 'lights';
    state.naughty = false;
    return;
  }
  if (state.naughty) {
    state.calling = true;
    state.callReason = 'naughty';
    return;
  }
  state.calling = false;
  state.callReason = null;
}

function maybeNaughty(state) {
  if (state.stage === 'egg' || state.stage === 'dead') return;
  if (state.hunger >= 4 && state.happy >= 4 && !state.sick && state.poops === 0 && !isSleeping(state)) {
    if (state.t > 0 && state.t % (4 * 60) === 0) {
      state.naughty = true;
    }
  }
}

export function tickMinute(state) {
  if (state.screen !== 'play' && state.screen !== 'dead') return;
  if (state.stage === 'dead') return;

  const prevH = state.clockH;
  state.t += 1;
  state.clockM += 1;
  if (state.clockM >= 60) {
    state.clockM = 0;
    state.clockH = (state.clockH + 1) % 24;
  }
  if (prevH === 23 && state.clockH === 0) {
    state.mealsToday = 0;
    state.snacksToday = 0;
    state.nightMistake = false;
  }

  if (state.stage === 'egg') {
    if (state.t >= EGG_MIN - 8) state.anim = { type: 'egg', crack: 1 };
    if (state.t >= EGG_MIN - 3) state.anim = { type: 'egg', crack: 2 };
    if (state.t >= EGG_MIN) {
      state.stage = 'baby';
      state.hatchAt = state.t;
      state.anim = { type: 'hatch', until: performance.now() + 1600 };
      state.walkX = 26;
    }
    return;
  }

  const life = lifeMinutes(state);
  if (life >= state.lifespan) {
    die(state, 'old');
    return;
  }
  if (state.stage !== 'dead') {
    const next = stageForLife(life);
    if (next !== state.stage) state.stage = next;
  }

  const sleeping = isSleeping(state);
  if (isNight(state) && state.lightsOn && !state.nightMistake) {
    state.careMistakes += 1;
    state.nightMistake = true;
  }

  if (!sleeping) {
    if (state.t - state.lastHungerTick >= HUNGER_EVERY) {
      state.hunger = clamp(state.hunger - 1, 0, 4);
      state.lastHungerTick = state.t;
    }
    if (state.t - state.lastHappyTick >= HAPPY_EVERY) {
      state.happy = clamp(state.happy - 1, 0, 4);
      state.lastHappyTick = state.t;
    }
  } else if (state.t - state.lastHungerTick >= HUNGER_EVERY * 2) {
    state.hunger = clamp(state.hunger - 1, 0, 4);
    state.lastHungerTick = state.t;
  }

  if (state.hunger === 0) {
    if (state.hungerEmptySince == null) state.hungerEmptySince = state.t;
  } else state.hungerEmptySince = null;

  if (state.happy === 0) {
    if (state.happyEmptySince == null) state.happyEmptySince = state.t;
  } else state.happyEmptySince = null;

  if (state.sick) {
    if (state.sickSince == null) state.sickSince = state.t;
  } else state.sickSince = null;

  if (state.hungerEmptySince != null && state.t - state.hungerEmptySince >= STARVE_MIN) {
    die(state, 'starve');
    return;
  }
  if (state.happyEmptySince != null && state.t - state.happyEmptySince >= STARVE_MIN) {
    die(state, 'sad');
    return;
  }
  if (state.sickSince != null && state.t - state.sickSince >= SICK_DEATH_MIN) {
    die(state, 'sick');
    return;
  }

  const stillDue = [];
  for (const at of state.poopAt) {
    if (state.t >= at) state.poops = clamp(state.poops + 1, 0, 4);
    else stillDue.push(at);
  }
  state.poopAt = stillDue;
  if (state.poops >= 2 && !state.sick) {
    state.sick = true;
    state.sickSince = state.t;
  }

  maybeNaughty(state);
  refreshCall(state);
}

function closeMenu(state) {
  state.menu = null;
  state.menuOpt = 0;
  state.statusPage = 0;
}

function openMenu(state) {
  if (state.stage === 'egg') return 'ignore';
  const name = ICONS[state.icon];
  if (name === 'lights') {
    state.lightsOn = !state.lightsOn;
    refreshCall(state);
    return 'click';
  }
  if (name === 'medicine') {
    if (state.sick) {
      state.sick = false;
      state.sickSince = null;
      state.anim = { type: 'heal', until: performance.now() + 900 };
      refreshCall(state);
      return 'heal';
    }
    state.anim = { type: 'refuse', until: performance.now() + 700 };
    return 'refuse';
  }
  if (name === 'toilet') {
    if (state.poops > 0) {
      state.poops = 0;
      state.anim = { type: 'flush', until: performance.now() + 800 };
      refreshCall(state);
      return 'flush';
    }
    state.anim = { type: 'refuse', until: performance.now() + 600 };
    return 'refuse';
  }
  if (name === 'food') {
    state.menu = 'food';
    state.menuOpt = 0;
    return 'click';
  }
  if (name === 'game') {
    if (isSleeping(state)) {
      state.anim = { type: 'refuse', until: performance.now() + 600 };
      return 'refuse';
    }
    state.menu = 'game';
    state.game = { round: 0, wins: 0, pick: null, face: null, phase: 'wait' };
    return 'click';
  }
  if (name === 'status') {
    state.menu = 'status';
    state.statusPage = 0;
    return 'click';
  }
  if (name === 'discipline') {
    state.menu = 'discipline';
    return 'click';
  }
  return 'click';
}

function feed(state, snack) {
  if (state.stage === 'egg' || isSleeping(state)) return 'refuse';
  if (snack) {
    if (state.hunger >= 4 && state.happy >= 4) {
      state.anim = { type: 'refuse', until: performance.now() + 700 };
      return 'refuse';
    }
    state.hunger = clamp(state.hunger + 1, 0, 4);
    state.happy = clamp(state.happy + 1, 0, 4);
    state.weight += 2;
    state.snacksToday += 1;
    state.poopAt.push(state.t + POOP_DELAY);
    if (state.snacksToday >= 4 && !state.sick) {
      state.sick = true;
      state.sickSince = state.t;
    }
    state.anim = { type: 'eat', food: 'snack', until: performance.now() + 900 };
    closeMenu(state);
    refreshCall(state);
    return 'eat';
  }

  if (state.hunger >= 4 || state.mealsToday >= 4) {
    state.anim = { type: 'refuse', until: performance.now() + 700 };
    return 'refuse';
  }
  state.hunger = clamp(state.hunger + 1, 0, 4);
  state.weight += 1;
  state.mealsToday += 1;
  state.poopAt.push(state.t + POOP_DELAY);
  state.anim = { type: 'eat', food: 'meal', until: performance.now() + 900 };
  closeMenu(state);
  refreshCall(state);
  return 'eat';
}

function scold(state) {
  if (state.calling && state.naughty && state.callReason === 'naughty') {
    state.discipline = clamp(state.discipline + 1, 0, 4);
    state.naughty = false;
    closeMenu(state);
    refreshCall(state);
    return 'win';
  }
  state.happy = clamp(state.happy - 1, 0, 4);
  state.anim = { type: 'refuse', until: performance.now() + 700 };
  closeMenu(state);
  refreshCall(state);
  return 'lose';
}

function playGuess(state, dir) {
  const g = state.game;
  if (!g || g.phase !== 'wait') return 'ignore';
  g.pick = dir;
  g.face = Math.random() < 0.5 ? -1 : 1;
  g.phase = 'reveal';
  if (g.pick === g.face) g.wins += 1;
  g.round += 1;
  if (g.round >= 5) {
    g.phase = 'done';
    if (g.wins >= 3) {
      state.happy = clamp(state.happy + 2, 0, 4);
      state.weight = Math.max(1, state.weight - 1);
      return 'win';
    }
    return 'lose';
  }
  return g.pick === g.face ? 'click' : 'back';
}

export function pressA(state) {
  if (state.screen === 'title') return 'ignore';
  if (state.screen === 'continue') {
    state.keepChoice = state.keepChoice === 'keep' ? 'new' : 'keep';
    return 'click';
  }
  if (state.screen === 'select') {
    state.pet = state.pet === 'gary' ? 'mary' : 'gary';
    return 'click';
  }
  if (state.screen === 'clock') {
    if (state.clockField === 0) state.clockH = (state.clockH + 1) % 24;
    else state.clockM = (state.clockM + 1) % 60;
    return 'click';
  }
  if (state.screen === 'dead') return 'ignore';
  if (state.menu === 'food') {
    state.menuOpt = state.menuOpt ? 0 : 1;
    return 'click';
  }
  if (state.menu === 'game') {
    if (state.game && state.game.phase === 'wait') return playGuess(state, -1);
    if (state.game && state.game.phase === 'reveal') {
      state.game.phase = 'wait';
      state.game.pick = null;
      state.game.face = null;
      return 'click';
    }
    return 'ignore';
  }
  if (state.menu === 'status') {
    state.statusPage = (state.statusPage + 1) % 3;
    return 'click';
  }
  if (state.menu) return 'ignore';
  state.icon = (state.icon + 1) % 7;
  return 'click';
}

export function pressB(state) {
  if (state.screen === 'title') {
    state.screen = hasSave() ? 'continue' : 'select';
    state.keepChoice = 'keep';
    return 'click';
  }
  if (state.screen === 'continue') {
    if (state.keepChoice === 'keep') {
      const loaded = loadSave();
      if (loaded) {
        Object.keys(state).forEach((k) => { delete state[k]; });
        Object.assign(state, loaded);
        state.menu = null;
        state.anim = null;
        state.game = null;
        return 'click';
      }
    }
    clearSave();
    const pet = state.pet;
    Object.assign(state, createTitleState());
    state.pet = pet;
    state.screen = 'select';
    return 'click';
  }
  if (state.screen === 'select') {
    state.screen = 'clock';
    state.clockField = 0;
    return 'click';
  }
  if (state.screen === 'clock') {
    if (state.clockField === 0) {
      state.clockField = 1;
      return 'click';
    }
    startEgg(state);
    return 'click';
  }
  if (state.screen === 'dead') {
    const pet = state.pet;
    Object.assign(state, createTitleState());
    state.pet = pet;
    state.screen = 'select';
    clearSave();
    return 'click';
  }
  if (state.menu === 'food') return feed(state, state.menuOpt === 1);
  if (state.menu === 'game') {
    if (state.game && state.game.phase === 'reveal') {
      state.game.phase = 'wait';
      state.game.pick = null;
      state.game.face = null;
      return 'click';
    }
    if (state.game && state.game.phase === 'done') {
      closeMenu(state);
      refreshCall(state);
      return 'click';
    }
    return 'ignore';
  }
  if (state.menu === 'status') {
    state.statusPage = (state.statusPage + 1) % 3;
    return 'click';
  }
  if (state.menu === 'discipline') return scold(state);
  return openMenu(state);
}

export function pressC(state) {
  if (state.screen === 'title') return 'ignore';
  if (state.screen === 'continue') {
    state.keepChoice = state.keepChoice === 'keep' ? 'new' : 'keep';
    return 'click';
  }
  if (state.screen === 'select') {
    state.pet = state.pet === 'gary' ? 'mary' : 'gary';
    return 'click';
  }
  if (state.screen === 'clock') {
    if (state.clockField === 1) {
      state.clockField = 0;
      return 'back';
    }
    state.screen = 'select';
    return 'back';
  }
  if (state.screen === 'dead') return 'ignore';
  if (state.menu === 'game' && state.game && state.game.phase === 'wait') {
    return playGuess(state, 1);
  }
  if (state.menu === 'game' && state.game && state.game.phase === 'reveal') {
    state.game.phase = 'wait';
    state.game.pick = null;
    state.game.face = null;
    return 'click';
  }
  if (state.menu) {
    closeMenu(state);
    return 'back';
  }
  return 'back';
}

export function resetGame() {
  clearSave();
  return createTitleState();
}

export function snapshot(state) {
  const copy = { ...state, game: null, anim: null, menu: state.menu === 'game' ? null : state.menu };
  return copy;
}
