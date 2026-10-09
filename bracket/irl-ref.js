/**
 * Tournament referee sidecar. Reads locked scan hits + hand landmarks.
 * Does not identify cards and must not call or wrap DdlIrlWatch.scan.
 */
(function (global) {
  const PILE_KEYS = ['extra', 'deck', 'gy', 'banish', 'hand'];
  const CREATURE_KEYS = ['creature-0', 'creature-1', 'creature-2', 'creature-3', 'creature-4'];
  const SPELL_KEYS = ['spell-0', 'spell-1', 'spell-2', 'spell-3', 'spell-4'];
  const PLAY_KEYS = CREATURE_KEYS.concat(SPELL_KEYS);
  const mem = { 1: null, 2: null };

  function emptyPile() {
    return {
      occ: false,
      seen: false,
      occHits: 0,
      emptyHits: 0,
      lifted: false,
      handAt: 0,
    };
  }

  function emptyPiles() {
    const out = {};
    PILE_KEYS.forEach((key) => { out[key] = emptyPile(); });
    return out;
  }

  function seatMem(n) {
    const key = n === 2 ? 2 : 1;
    if (!mem[key]) {
      mem[key] = {
        ids: {},
        lanes: {},
        born: {},
        expectPile: '',
        expectPiles: [],
        expectOn: 0,
        expectSummons: 0,
        expectSummonFrom: '',
        expectMaxCost: null,
        expectClass: '',
        expectLeaves: 0,
        expectDraw: 0,
        drawUsed: 0,
        life: null,
        poison: {},
        piles: emptyPiles(),
        turnKey: '',
      };
    }
    return mem[key];
  }

  function otherSeat(n) {
    return n === 1 ? 2 : 1;
  }

  function cardOf(cat, id) {
    if (!id || !cat || typeof cat.byId !== 'function') return null;
    return cat.byId(id);
  }

  function textOf(card) {
    return String(card && card.text || '').toLowerCase();
  }

  function isPlayCard(card) {
    if (!card) return false;
    const pill = String(card.pill || '');
    const text = String(card.text || '');
    return pill === 'Play' || /^play:/i.test(text);
  }

  function keywordOf(card) {
    return String(card && card.keyword || '').trim();
  }

  function hasKeyword(card, word) {
    return keywordOf(card).toLowerCase() === String(word || '').toLowerCase();
  }

  function note(kind, level, seat, text) {
    return { kind, level, seat, text };
  }

  function pileLabel(kind) {
    if (kind === 'gy') return 'GY';
    if (kind === 'extra') return 'Extra';
    if (kind === 'banish') return 'Banish';
    if (kind === 'hand') return 'Hand';
    return 'Deck';
  }

  function searchKindFromText(text) {
    return effectFromText(text).pause;
  }

  function searchKindForCard(card) {
    return effectForCard(card).pause;
  }

  function drawCountFromText(t) {
    if (!t) return 0;
    if (/\bdraw that many\b/.test(t)) return 1;
    if (/\bdraw 3\b/.test(t) || /\bdraw three\b/.test(t)) return 3;
    if (/\bdraw 2\b/.test(t) || /\bdraw two\b/.test(t)) return 2;
    if (/\bdraw a card\b/.test(t) || /\bdraw 1\b/.test(t)) return 1;
    return 0;
  }

  function summonCountFromText(t) {
    if (!t || !/\bsummon\b/.test(t)) return 0;
    if (/\ball copies\b/.test(t)) return 9;
    const up = t.match(/up to (\d+)/);
    if (up) return Number(up[1]) || 0;
    return 1;
  }

  function effectFromText(text, card) {
    const t = String(text || '').toLowerCase();
    const type = card && card.type ? String(card.type) : '';
    const out = {
      pause: '',
      pauseOn: 'self',
      summons: 0,
      summonFrom: '',
      summonMaxCost: null,
      summonClass: '',
      allCopies: false,
      draws: 0,
      shuffle: false,
      leaves: 0,
      lockGy: false,
      lockDeck: false,
      noHeal: false,
      immune: false,
      poisonGrant: false,
      trap: type === 'Trap',
    };
    if (!t) return out;
    if (/\bcannot\b/.test(t) && /\bgraveyard\b/.test(t)) out.lockGy = true;
    if (/\bcannot\b/.test(t) && /\bfrom the deck\b/.test(t)) out.lockDeck = true;
    if (/\bcannot be healed\b/.test(t)) out.noHeal = true;
    if (/\bhero is immune\b/.test(t)) out.immune = true;
    if (/\bgive a friendly\b/.test(t) && /\bpoison\b/.test(t)) out.poisonGrant = true;
    if (out.lockGy || out.lockDeck) return out;
    if (/\blook at\b/.test(t) && /\bhand\b/.test(t)) {
      out.pause = 'hand';
      out.pauseOn = 'enemy';
      return out;
    }
    if (/\bshuffle\b/.test(t)) {
      out.shuffle = true;
      out.pause = 'deck';
    }
    if (/\bbanish\b/.test(t) && /\bgraveyard\b/.test(t)) {
      out.pause = 'gy';
      out.leaves = 0;
      return out;
    }
    const fromGy = /\bfrom (?:your |a |the |an )?graveyard\b/.test(t);
    const fromDeck = /\bfrom your deck\b/.test(t) || /\bfrom deck\b/.test(t);
    if (fromGy) {
      out.pause = 'gy';
      out.summonFrom = 'gy';
    } else if (fromDeck) {
      out.pause = 'deck';
      out.summonFrom = 'deck';
    }
    out.summons = summonCountFromText(t);
    if (/\ball copies\b/.test(t)) out.allCopies = true;
    const cost = t.match(/costs? (\d+) or less/);
    if (cost) out.summonMaxCost = Number(cost[1]);
    if (/\bzombie creature\b/.test(t)) out.summonClass = 'Zombie';
    if (/\bcrown creature\b/.test(t)) out.summonClass = 'Crown';
    if (/\bpirate creature\b/.test(t)) out.summonClass = 'Pirate';
    if (!out.summons) out.summonFrom = out.summonFrom && fromGy || fromDeck ? out.summonFrom : '';
    if (/\breturn a creature to its owner's hand\b/.test(t) || /\breturn that creature to their hand\b/.test(t)) {
      out.leaves = 1;
    }
    if (/\bshuffle it into\b/.test(t)) {
      out.pause = 'deck';
      out.leaves = 1;
    }
    if (isPlayCard(card) || !card) {
      const draws = drawCountFromText(t);
      if (draws && !fromGy) {
        out.draws = draws;
        if (!out.pause) out.pause = 'deck';
      }
    }
    if (out.pause === 'hand' || out.pause === 'gy' || out.pause === 'deck' || out.pause === 'banish') return out;
    return out;
  }

  function effectForCard(card) {
    if (!card) return effectFromText('');
    return effectFromText(card.text, card);
  }

  function laneId(boardSeat, key) {
    if (!boardSeat || !key) return '';
    if (key === 'extra') return (boardSeat.extra && boardSeat.extra.id) || '';
    if (key === 'banish') return (boardSeat.banish && boardSeat.banish.id) || '';
    const m = String(key).match(/^(creature|spell)-(\d)$/);
    if (!m) return '';
    const arr = m[1] === 'creature' ? boardSeat.creatures : boardSeat.spells;
    const slot = arr && arr[Number(m[2])];
    return (slot && slot.id) || '';
  }

  function creatureIndex(key) {
    const m = String(key || '').match(/^creature-(\d)$/);
    return m ? Number(m[1]) : -1;
  }

  function countIds(boardSeat) {
    const counts = {};
    PLAY_KEYS.forEach((key) => {
      const id = laneId(boardSeat, key);
      if (!id) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  function laneMap(boardSeat) {
    const out = {};
    PLAY_KEYS.forEach((key) => {
      const id = laneId(boardSeat, key);
      if (id) out[key] = id;
    });
    return out;
  }

  function addedIds(prev, next) {
    const out = [];
    Object.keys(next).forEach((id) => {
      const grow = (Number(next[id]) || 0) - (Number(prev[id]) || 0);
      for (let i = 0; i < grow; i += 1) out.push(id);
    });
    return out;
  }

  function boardHas(boardSeat, test) {
    return PLAY_KEYS.some((key) => {
      const id = laneId(boardSeat, key);
      return id && test(id, key);
    });
  }

  function cardsOn(boardSeat, cat) {
    return PLAY_KEYS.map((key) => {
      const id = laneId(boardSeat, key);
      return { key, id, card: cardOf(cat, id) };
    }).filter((row) => row.card);
  }

  function lockFlags(boardSeat, cat) {
    const flags = { lockGy: false, lockDeck: false, noHeal: false, immune: false, cookie: false };
    cardsOn(boardSeat, cat).forEach((row) => {
      const fx = effectForCard(row.card);
      if (fx.lockGy) flags.lockGy = true;
      if (fx.lockDeck) flags.lockDeck = true;
      if (fx.noHeal) flags.noHeal = true;
      if (fx.immune) flags.immune = true;
      if (String(row.card.name || '').toLowerCase() === 'cookie') flags.cookie = true;
    });
    return flags;
  }

  function creatureCount(boardSeat) {
    return CREATURE_KEYS.filter((key) => laneId(boardSeat, key)).length;
  }

  function spellCount(boardSeat) {
    return SPELL_KEYS.filter((key) => laneId(boardSeat, key)).length;
  }

  function samplePile(video, el) {
    const Watch = global.DdlIrlWatch;
    if (!Watch || !video || !el || typeof Watch.slotToVideoRect !== 'function') return null;
    const size = {
      vw: video.videoWidth || 0,
      vh: video.videoHeight || 0,
    };
    if (!size.vw || !size.vh) return null;
    const mapped = Watch.slotToVideoRect(video, el);
    if (!mapped) return null;
    const x = Math.max(0, Math.floor(mapped.x));
    const y = Math.max(0, Math.floor(mapped.y));
    const w = Math.min(size.vw - x, Math.ceil(mapped.w));
    const h = Math.min(size.vh - y, Math.ceil(mapped.h));
    if (w < 10 || h < 14) return null;
    const dw = 40;
    const dh = 56;
    const c = samplePile._c || (samplePile._c = document.createElement('canvas'));
    if (c.width !== dw) c.width = dw;
    if (c.height !== dh) c.height = dh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(video, x, y, w, h, 0, 0, dw, dh);
      return { data: ctx.getImageData(0, 0, dw, dh).data, rect: { x, y, w, h }, vw: size.vw, vh: size.vh };
    } catch (_err) {
      return null;
    }
  }

  function pileOccupied(sample) {
    if (!sample || !sample.data) return false;
    const data = sample.data;
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    let chroma = 0;
    for (let p = 0; p < data.length; p += 16) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const luma = r * 0.3 + g * 0.59 + b * 0.11;
      sum += luma;
      sum2 += luma * luma;
      n += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) chroma += 1;
    }
    if (!n) return false;
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    const chromaRatio = chroma / n;
    return variance > 260 || (variance > 150 && chromaRatio > 0.12);
  }

  function handOverRect(landmarks, rect, vw, vh) {
    if (!rect || !vw || !vh) return false;
    const hands = landmarks || [];
    if (!hands.length) return false;
    const padX = rect.w * 0.18;
    const padY = rect.h * 0.18;
    const x0 = rect.x - padX;
    const y0 = rect.y - padY;
    const x1 = rect.x + rect.w + padX;
    const y1 = rect.y + rect.h + padY;
    const tips = [0, 4, 8, 12, 16, 20];
    let hits = 0;
    hands.forEach((hand) => {
      tips.forEach((i) => {
        const pt = hand[i];
        if (!pt) return;
        const x = pt.x * vw;
        const y = pt.y * vh;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hits += 1;
      });
    });
    return hits >= 2;
  }

  function updatePile(st, occupied, handNear, now) {
    st.seen = true;
    if (handNear) st.handAt = now;
    if (occupied) {
      st.occHits += 1;
      st.emptyHits = 0;
      if (st.occHits >= 2) {
        st.occ = true;
        st.lifted = false;
      }
    } else {
      st.emptyHits += 1;
      st.occHits = 0;
      if (st.emptyHits >= 2 && st.occ) {
        st.occ = false;
        if (now - (st.handAt || 0) < 1800) st.lifted = true;
      }
    }
    return st;
  }

  function adjacentKeys(key) {
    const idx = creatureIndex(key);
    if (idx < 0) return [];
    const out = [];
    if (idx > 0) out.push(`creature-${idx - 1}`);
    if (idx < 4) out.push(`creature-${idx + 1}`);
    return out;
  }

  function bodyHas(boardSeat, key, cat, pred) {
    const card = cardOf(cat, laneId(boardSeat, key));
    return Boolean(card && pred(card, key));
  }

  function auraAdjacent(boardSeat, key, cat, test) {
    return adjacentKeys(key).some((adj) => {
      const card = cardOf(cat, laneId(boardSeat, adj));
      return card && test(card);
    });
  }

  function grantsTaunt(card) {
    return /adjacent creatures have taunt/i.test(String(card && card.text || ''));
  }

  function grantsRush(card) {
    return /adjacent creatures have rush/i.test(String(card && card.text || ''));
  }

  function hasTaunt(boardSeat, key, cat) {
    if (bodyHas(boardSeat, key, cat, (c) => hasKeyword(c, 'Taunt'))) return true;
    return auraAdjacent(boardSeat, key, cat, grantsTaunt);
  }

  function hasRush(boardSeat, key, cat) {
    if (bodyHas(boardSeat, key, cat, (c) => hasKeyword(c, 'Rush'))) return true;
    return auraAdjacent(boardSeat, key, cat, grantsRush);
  }

  function hasPoison(boardSeat, key, cat, poison) {
    if (poison && poison[key]) return true;
    return bodyHas(boardSeat, key, cat, (c) => hasKeyword(c, 'Poison'));
  }

  function anyTaunt(boardSeat, cat) {
    return CREATURE_KEYS.some((key) => laneId(boardSeat, key) && hasTaunt(boardSeat, key, cat));
  }

  function classOk(card, need) {
    if (!need) return true;
    if (!card) return false;
    if (card.all_class) return true;
    const klass = String(card.class || '');
    if (klass === need) return true;
    return (card.classes || []).indexOf(need) >= 0;
  }

  function canResume(seatN, kind) {
    const st = seatMem(seatN);
    const keys = kind ? [kind] : (st.expectPiles.length ? st.expectPiles : [st.expectPile]);
    const wanted = keys.filter(Boolean);
    if (!wanted.length) return { ok: true, missing: '' };
    const missing = wanted.find((key) => {
      const pile = st.piles[key];
      if (!pile || !pile.seen) return false;
      return !pile.occ;
    });
    if (!missing) return { ok: true, missing: '' };
    return { ok: false, missing };
  }

  function grantPoison(seatN, key) {
    const st = seatMem(seatN);
    if (!key) return;
    st.poison[key] = true;
  }

  function clearPoison(seatN) {
    seatMem(seatN).poison = {};
  }

  function phaseNotes(when, seatN, myBoard, cat) {
    const notes = [];
    const goji = boardHas(myBoard, (id, key) => {
      const card = cardOf(cat, id);
      return card && /adjacent creatures start of turn/i.test(textOf(card));
    });
    const meditation = boardHas(myBoard, (id) => {
      const card = cardOf(cat, id);
      return card && /crown creatures start of turn/i.test(textOf(card));
    });
    const scheme = boardHas(myBoard, (id) => {
      const card = cardOf(cat, id);
      return card && /wizard creatures end of turn/i.test(textOf(card));
    });
    const surgeKeys = CREATURE_KEYS.filter((key) => {
      const card = cardOf(cat, laneId(myBoard, key));
      return card && /adjacent creatures end of turn/i.test(textOf(card));
    });
    cardsOn(myBoard, cat).forEach((row) => {
      const t = textOf(row.card);
      const start = /\bat the start of your turn\b/.test(t);
      const end = /\bat the end of your turn\b/.test(t);
      if (when === 'start' && !start) return;
      if (when === 'end' && !end) return;
      let times = 1;
      const extras = [];
      if (when === 'start') {
        if (meditation && String(row.card.class || '') === 'Crown') {
          times += 1;
          extras.push('Meditation');
        }
        if (goji && CREATURE_KEYS.indexOf(row.key) >= 0 && auraAdjacent(myBoard, row.key, cat, (c) => /adjacent creatures start of turn/i.test(textOf(c)))) {
          times += 1;
          extras.push('Goji');
        }
      }
      if (when === 'end') {
        if (scheme && String(row.card.class || '') === 'Wizard') {
          times += 1;
          extras.push('Scheme');
        }
        if (CREATURE_KEYS.indexOf(row.key) >= 0 && adjacentKeys(row.key).some((adj) => surgeKeys.indexOf(adj) >= 0)) {
          times += 1;
          extras.push('Surge');
        }
      }
      const payload = String(row.card.text || '').replace(/^[^:]+:\s*/, '');
      const more = extras.length ? ` ×${times} (${extras.join(' + ')})` : (times > 1 ? ` ×${times}` : '');
      notes.push(note(
        when,
        'ok',
        seatN,
        `${when === 'start' ? 'Start' : 'End'}: ${row.card.name} — ${payload}${more}`,
      ));
    });
    if (when === 'end') {
      cardsOn(myBoard, cat).forEach((row) => {
        const t = textOf(row.card);
        if (/trigger the haunt effects of the adjacent/i.test(t)) {
          notes.push(note('end', 'ok', seatN, `End: ${row.card.name} — Haunt adjacent creatures.`));
        }
        if (/trigger the haunt effects of the zombie/i.test(t)) {
          notes.push(note('end', 'ok', seatN, `End: ${row.card.name} — Haunt your Zombies.`));
        }
      });
    }
    return notes;
  }

  function judgeAttack(opts) {
    const cat = (opts && opts.catalog) || global.DdlIrlCatalog;
    const notes = [];
    const seatN = opts && (opts.seatN === 2 ? 2 : 1);
    const myBoard = opts && opts.boardSeat;
    const enemyBoard = opts && opts.enemyBoard;
    const clock = (opts && opts.clock) || {};
    const attackers = (opts && opts.attackers) || [];
    const target = opts && opts.target;
    if (!attackers.length || !target) {
      return { ok: false, notes: [note('attack', 'illegal', seatN, 'Declare an attacker and a target.')] };
    }
    if (!clock.started || Number(clock.active) !== seatN) {
      return { ok: false, notes: [note('attack', 'illegal', seatN, 'Attacks are only on your turn.')] };
    }
    const enemySeat = otherSeat(seatN);
    const st = seatMem(seatN);
    const turnN = Number(clock.turns && clock.turns[seatN]) || 0;
    let atkSum = 0;
    let poisonHit = false;
    const names = [];
    for (let i = 0; i < attackers.length; i += 1) {
      const key = attackers[i];
      const id = laneId(myBoard, key);
      const card = cardOf(cat, id);
      if (!card || card.type !== 'Creature') {
        notes.push(note('attack', 'illegal', seatN, `${key} is not a creature.`));
        continue;
      }
      names.push(card.name);
      atkSum += Number(card.attack) || 0;
      const born = Number(st.born[key]) || 0;
      const sick = born === turnN;
      const rush = hasRush(myBoard, key, cat);
      if (sick && !rush) {
        notes.push(note('attack', 'illegal', seatN, `${card.name} has summoning sickness.`));
      }
      if (sick && rush && target.kind === 'hero') {
        notes.push(note('attack', 'illegal', seatN, `${card.name} has Rush — creatures this turn, not the hero.`));
      }
      if (hasPoison(myBoard, key, cat, st.poison)) poisonHit = true;
    }
    if (target.kind === 'hero') {
      if (Number(target.seat) !== enemySeat) {
        notes.push(note('attack', 'illegal', seatN, 'Face target must be the enemy hero.'));
      }
      if (anyTaunt(enemyBoard, cat)) {
        notes.push(note('attack', 'illegal', seatN, 'A Taunt is in the way. Hit a Taunt body first.'));
      }
      const illegal = notes.some((n) => n.level === 'illegal');
      if (!illegal) {
        notes.push(note('attack', 'ok', seatN, `${names.join(' + ')} (${atkSum} ATK) → hero. Apply face on the HUD.`));
      }
      return { ok: !illegal, notes, atk: atkSum, poison: poisonHit };
    }
    const tKey = target.key;
    const tId = laneId(enemyBoard, tKey);
    const tCard = cardOf(cat, tId);
    if (!tCard || tCard.type !== 'Creature') {
      notes.push(note('attack', 'illegal', seatN, 'Target lane has no creature.'));
      return { ok: false, notes };
    }
    if (anyTaunt(enemyBoard, cat) && !hasTaunt(enemyBoard, tKey, cat)) {
      notes.push(note('attack', 'illegal', seatN, `${tCard.name} is not Taunt. A Taunt must be attacked first.`));
    }
    const defHp = Number(tCard.hp) || 0;
    const equal = atkSum === defHp;
    const gate = poisonHit || atkSum >= defHp;
    if (!gate) {
      notes.push(note('attack', 'illegal', seatN, `Kill-gate: ${atkSum} ATK vs ${tCard.name} ${defHp} HP. Need ATK ≥ HP (or Poison).`));
    } else if (!notes.some((n) => n.level === 'illegal')) {
      const how = poisonHit ? 'Poison ignores the gate' : (equal ? 'equal ATK kills both' : 'ATK meets HP');
      notes.push(note('attack', 'ok', seatN, `${names.join(' + ')} (${atkSum} ATK) → ${tCard.name} (${defHp} HP). ${how}.`));
    }
    return { ok: !notes.some((n) => n.level === 'illegal'), notes, atk: atkSum, poison: poisonHit };
  }

  function observe(opts) {
    const seatN = opts && (opts.seatN === 2 ? 2 : opts.seatN === 1 ? 1 : 0);
    const notes = [];
    const out = {
      notes,
      searchKind: '',
      pickup: '',
      spendMana: null,
      coinHint: false,
      pickPoison: false,
      expectOn: 0,
    };
    if (!seatN) return out;
    const clock = opts.clock || {};
    const Cat = opts.catalog || global.DdlIrlCatalog;
    const Watch = global.DdlIrlWatch;
    const locked = opts.lockedCounts || null;
    const hits = opts.hits || [];
    const boardSeat = opts.boardSeat;
    const enemyBoard = opts.enemyBoard;
    const st = seatMem(seatN);
    const enemy = seatMem(otherSeat(seatN));
    const active = Boolean(clock.started && Number(clock.active) === seatN);
    const turnN = Number(clock.turns && clock.turns[seatN]) || 0;
    const turnKey = `${clock.started ? 1 : 0}|${clock.active || 0}|${clock.seq || 0}`;
    if (st.turnKey !== turnKey) {
      const prevActive = st.turnKey && Number(String(st.turnKey).split('|')[1]);
      if (prevActive === seatN) st.poison = {};
      st.turnKey = turnKey;
      if (active) {
        st.expectDraw = 1;
        st.drawUsed = 0;
      }
      if (!clock.searching) {
        st.expectPile = '';
        st.expectPiles = [];
        st.expectOn = 0;
      }
    }

    if (Watch && typeof Watch.alertsFromScan === 'function') {
      notes.push(...Watch.alertsFromScan(seatN, hits, boardSeat, clock, locked, Cat && Cat.byId));
    }

    const nowLanes = laneMap(boardSeat);
    const nowIds = countIds(boardSeat);
    const fresh = addedIds(st.ids, nowIds);
    const leftKeys = Object.keys(st.lanes).filter((key) => st.lanes[key] && !nowLanes[key]);
    CREATURE_KEYS.forEach((key) => {
      const id = nowLanes[key] || '';
      const prev = st.lanes[key] || '';
      if (id && prev !== id && (prev || st.seenBoard)) st.born[key] = turnN;
      if (!id) delete st.born[key];
    });
    st.seenBoard = true;
    if (st.expectLeaves && leftKeys.length) {
      st.expectLeaves = Math.max(0, st.expectLeaves - leftKeys.length);
    }
    st.ids = nowIds;
    st.lanes = nowLanes;

    if (clock.started && !active && fresh.length) {
      const names = fresh.map((id) => (cardOf(Cat, id) || {}).name || id);
      notes.push(note('offturn', 'illegal', seatN, `Seat ${seatN}: ${names.join(', ')} hit the mat off turn.`));
    }

    PLAY_KEYS.forEach((key) => {
      const id = nowLanes[key];
      const card = cardOf(Cat, id);
      if (!card) return;
      if (key.indexOf('creature-') === 0 && card.type !== 'Creature') {
        notes.push(note('lane', 'illegal', seatN, `${card.name} is a ${card.type} in a creature lane.`));
      }
      if (key.indexOf('spell-') === 0 && card.type === 'Creature') {
        notes.push(note('lane', 'illegal', seatN, `${card.name} is a Creature in a spell/trap slot.`));
      }
      if (key.indexOf('spell-') === 0 && card.type === 'Trap') {
        notes.push(note('trap', 'ok', seatN, `Seat ${seatN}: ${card.name} is face-up. Traps stay unnamed until they spring.`));
      }
    });

    const enemyLocks = lockFlags(enemyBoard, Cat);
    const myLocks = lockFlags(boardSeat, Cat);
    const lifeMap = opts.life || {};
    const myLife = Number(lifeMap[seatN]);
    if (Number.isFinite(myLife)) {
      if (st.life == null) st.life = myLife;
      const delta = myLife - st.life;
      if (delta > 0 && enemyLocks.noHeal) {
        notes.push(note('plague', 'illegal', seatN, `Seat ${seatN}: healed while Plague is in play (enemy hero cannot be healed).`));
      }
      if (delta < 0 && myLocks.immune) {
        notes.push(note('icy', 'illegal', seatN, `Seat ${seatN}: took face damage while Icy is in play (hero is immune).`));
      }
      st.life = myLife;
    }

    if (opts.offCam && active && !clock.searching) {
      notes.push(note('offcam', 'illegal', seatN, `Seat ${seatN}: hands off cam — possible extra card to hand.`));
    }

    let searchKind = '';
    if (active && fresh.length) {
      const paid = [];
      fresh.forEach((id) => {
        const card = cardOf(Cat, id);
        if (!card) return;
        const asSummon = st.expectSummons > 0
          && card.type === 'Creature'
          && (st.expectMaxCost == null || Number(card.mana) <= st.expectMaxCost)
          && classOk(card, st.expectClass);
        if (asSummon) {
          st.expectSummons -= 1;
          notes.push(note('summon', 'ok', seatN, `Seat ${seatN}: ${card.name} looks like the search summon.`));
          return;
        }
        paid.push(card);
        const fx = effectForCard(card);
        if (fx.lockGy || fx.lockDeck) return;
        if (!clock.searching && (fx.pause === 'gy' || fx.pause === 'deck' || fx.pause === 'hand' || fx.pause === 'banish')) {
          if (fx.pause === 'gy' && enemyLocks.lockGy) {
            notes.push(note('gummy', 'illegal', seatN, `Seat ${seatN}: ${card.name} searches GY while Gummy is in play.`));
          }
          if (fx.pause === 'deck' && enemyLocks.lockDeck) {
            notes.push(note('bamba', 'illegal', seatN, `Seat ${seatN}: ${card.name} searches Deck while Bamba is in play.`));
          }
          if (!searchKind) {
            searchKind = fx.pause;
            st.expectPile = fx.pause;
            st.expectOn = fx.pauseOn === 'enemy' ? otherSeat(seatN) : seatN;
            st.expectPiles = fx.pause === 'gy' ? ['gy', 'banish'] : [fx.pause];
            const who = st.expectOn === seatN ? pileLabel(fx.pause) : `enemy ${pileLabel(fx.pause)}`;
            notes.push(note('search', 'ok', seatN, `Seat ${seatN}: ${card.name} needs ${who} · timer pauses.`));
          }
        }
        if (fx.summons) {
          st.expectSummons = fx.allCopies ? 3 : fx.summons;
          st.expectSummonFrom = fx.summonFrom;
          st.expectMaxCost = fx.summonMaxCost;
          st.expectClass = fx.summonClass;
          if (creatureCount(boardSeat) >= 5) {
            notes.push(note('full', 'illegal', seatN, `Seat ${seatN}: creature row is full — no lane for ${card.name}'s summon.`));
          }
        }
        if (fx.draws) st.expectDraw = (st.expectDraw || 0) + fx.draws;
        if (fx.leaves) st.expectLeaves += fx.leaves;
        if (fx.poisonGrant) {
          out.pickPoison = true;
          notes.push(note('venom', 'ok', seatN, `Seat ${seatN}: Snake Venom — tap a Pirate you control to give Poison this turn.`));
        }
      });
      const playCard = paid[0] || null;
      if (playCard) {
        const cost = Number(playCard.mana) || 0;
        const avail = Math.max(0, Number(opts.available) || 0);
        const used = Math.max(0, Number(opts.used) || 0);
        const left = Math.max(0, avail - used);
        const second = Boolean(opts.wentSecond);
        const coinArmed = Boolean(opts.coinArmed);
        const coinSpent = Boolean(opts.coinSpent);
        if (cost > left) {
          if (second && !coinArmed && !coinSpent && cost === left + 1) {
            out.coinHint = true;
            notes.push(note('coin', 'ok', seatN, `Seat ${seatN}: ${playCard.name} costs ${cost}. Spend the Coin (+1) or it is over mana.`));
          } else {
            notes.push(note('mana', 'illegal', seatN, `Seat ${seatN}: ${playCard.name} costs ${cost}, ${left} mana left.`));
          }
        } else if (cost > 0) {
          out.spendMana = Math.min(avail, used + cost);
        }
      }
    }
    out.searchKind = searchKind;
    out.expectOn = st.expectOn || 0;

    const video = opts.video;
    const pileEls = opts.pileEls || [];
    const landmarks = opts.landmarks || [];
    const now = Date.now();
    PILE_KEYS.forEach((key) => {
      const el = pileEls.find((node) => node && node.getAttribute && node.getAttribute('data-lane') === key);
      if (!el) return;
      const sample = samplePile(video, el);
      if (!sample) return;
      const occupied = pileOccupied(sample);
      const handNear = handOverRect(landmarks, sample.rect, sample.vw, sample.vh);
      const pile = st.piles[key] || (st.piles[key] = emptyPile());
      updatePile(pile, occupied, handNear, now);
      if (key === 'extra' && pile.occ) {
        notes.push(note('extra-occ', 'illegal', seatN, `Seat ${seatN}: Extra pile looks occupied. DDL has no Extra deck.`));
      }
      const liftedNow = pile.lifted;
      if (!liftedNow) return;
      const allowedSelf = (Number(clock.searching) === seatN && (clock.searchKind === key || (clock.searchKind === 'gy' && key === 'banish')))
        || ((st.expectPiles || []).indexOf(key) >= 0 && (!st.expectOn || st.expectOn === seatN));
      const allowedIntel = key === 'hand' && enemy.expectPile === 'hand' && enemy.expectOn === seatN;
      const startDraw = key === 'deck' && active && st.expectDraw > 0 && st.drawUsed < st.expectDraw;
      if (allowedSelf || allowedIntel) {
        out.pickup = key;
        notes.push(note('pickup', 'ok', seatN, `Seat ${seatN}: hand lifted ${pileLabel(key)}.`));
        if (key === 'deck' && startDraw) st.drawUsed += 1;
        if (key === 'deck' && !startDraw && enemyLocks.cookie) {
          notes.push(note('cookie', 'ok', otherSeat(seatN), `Cookie: Seat ${otherSeat(seatN)} draws — enemy drew outside the draw phase.`));
        }
        if ((key === 'gy' || (key === 'deck' && st.expectSummonFrom === 'deck')) && enemyLocks.lockGy && key === 'gy') {
          notes.push(note('gummy', 'illegal', seatN, `Seat ${seatN}: GY lifted while Gummy is in play.`));
        }
        if (key === 'deck' && enemyLocks.lockDeck && st.expectPile === 'deck' && st.expectSummons > 0) {
          notes.push(note('bamba', 'illegal', seatN, `Seat ${seatN}: Deck lifted to summon/add while Bamba is in play.`));
        }
      } else if (startDraw) {
        st.drawUsed += 1;
        out.pickup = key;
        notes.push(note('draw', 'ok', seatN, `Seat ${seatN}: turn-start draw (deck lifted).`));
      } else if (active && (key === 'gy' || key === 'deck' || key === 'banish' || key === 'hand')) {
        notes.push(note('pickup-illegal', 'illegal', seatN, `Seat ${seatN}: ${pileLabel(key)} lifted with no search/draw card.`));
      }
    });

    return out;
  }

  global.DdlIrlRef = {
    observe,
    judgeAttack,
    phaseNotes,
    canResume,
    grantPoison,
    clearPoison,
    effectForCard,
    searchKindFromText,
    searchKindForCard,
    pileLabel,
    seatMem,
  };
})(window);
