/**
 * DDL Companion catalog for the IRL table: card lookup, deck lock,
 * search-effect kinds, and hover/tap peeks.
 */
(function (global) {
  const SRC = [
    '/bracket/ddl-cards.js',
    '/ddl/data/ddl.js',
    'https://ddltcg.kushmetax.com/data/ddl.js',
  ];
  const CUSTOM_KEY = 'ddl-custom-decks';
  const DECK_SIZE = 40;
  const MAX_COPIES = 3;
  const CLASSES = ['Crown', 'Bow', 'Wizard', 'Zombie', 'Pirate'];

  let loadPromise = null;

  function catalog() {
    const pack = global.DDL;
    return pack && Array.isArray(pack.cards) ? pack : null;
  }

  function cards() {
    const pack = catalog();
    return pack ? pack.cards : [];
  }

  function byId(id) {
    const key = String(id || '').trim().toUpperCase();
    if (!key) return null;
    return cards().find((c) => String(c.id).toUpperCase() === key) || null;
  }

  function byName(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    return cards().find((c) => String(c.name).toLowerCase() === key) || null;
  }

  function load() {
    if (catalog()) return Promise.resolve(catalog());
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const urls = SRC.slice();
      const tryNext = () => {
        const url = urls.shift();
        if (!url) {
          loadPromise = null;
          reject(new Error('Companion catalog did not load'));
          return;
        }
        const el = document.createElement('script');
        el.src = url;
        el.async = true;
        el.dataset.ddlCatalog = '1';
        el.onload = () => {
          if (catalog()) resolve(catalog());
          else tryNext();
        };
        el.onerror = () => tryNext();
        document.head.appendChild(el);
      };
      tryNext();
    });
    return loadPromise;
  }

  function searchKindFromText(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    if (/\blook at\b/.test(t) && /\bhand\b/.test(t)) return 'hand';
    if (/\bgraveyard\b/.test(t)) return 'gy';
    if (/\bfrom your deck\b/.test(t) || /\bfrom deck\b/.test(t)) return 'deck';
    return '';
  }

  function searchKindForCard(card) {
    if (!card) return '';
    return searchKindFromText(card.text);
  }

  function statsLine(card) {
    if (!card) return '';
    if (card.type === 'Creature') {
      return `${card.mana} mana · ${card.attack}/${card.hp} · ${card.class || ''}`.trim();
    }
    return `${card.mana} mana · ${card.type}${card.class ? ` · ${card.class}` : ''}`;
  }

  function legalClass(card, heroes) {
    if (!card) return false;
    if (card.all_class) return true;
    const klass = String(card.class || '');
    if (klass === 'Neutral' || klass === 'All') return true;
    const allowed = (heroes || []).filter(Boolean);
    if (!allowed.length) return true;
    return allowed.includes(klass) || (card.classes || []).some((c) => allowed.includes(c));
  }

  function countMap(list) {
    const counts = {};
    (list || []).forEach((row) => {
      const id = String(row.id || row).toUpperCase();
      const qty = Math.max(0, Number(row.qty != null ? row.qty : 1) || 0);
      if (!id || !qty) return;
      counts[id] = (counts[id] || 0) + qty;
    });
    return counts;
  }

  function validateDeck(counts, heroes) {
    const map = counts && !Array.isArray(counts) ? counts : countMap(counts);
    const rows = [];
    let total = 0;
    const errors = [];
    Object.keys(map).sort().forEach((id) => {
      const qty = Math.max(0, Number(map[id]) || 0);
      if (!qty) return;
      total += qty;
      const card = byId(id);
      if (!card) errors.push(`Unknown ${id}`);
      else {
        if (qty > MAX_COPIES) errors.push(`${card.name} has ${qty} copies (max ${MAX_COPIES})`);
        if (!legalClass(card, heroes)) errors.push(`${card.name} is not legal for ${heroes.join('/')}`);
        rows.push({ id: card.id, name: card.name, qty, type: card.type, mana: card.mana });
      }
    });
    if (total !== DECK_SIZE) errors.push(`${total} cards — lists must be ${DECK_SIZE}`);
    return {
      ok: errors.length === 0 && total === DECK_SIZE,
      total,
      counts: map,
      rows: rows.sort((a, b) => a.mana - b.mana || a.name.localeCompare(b.name)),
      errors,
    };
  }

  function parseDeckText(raw) {
    const counts = {};
    String(raw || '').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const m = trimmed.match(/^(V\d{3})\s*[x×*]?\s*(\d{1,2})?$/i)
        || trimmed.match(/^(\d{1,2})\s*[x×]?\s*(V\d{3})$/i)
        || trimmed.match(/^(.+?)\s+[x×]?\s*(\d{1,2})$/);
      if (!m) {
        const named = byName(trimmed) || byId(trimmed);
        if (named) counts[named.id] = (counts[named.id] || 0) + 1;
        return;
      }
      let id = '';
      let qty = 1;
      if (/^V\d{3}$/i.test(m[1])) {
        id = m[1].toUpperCase();
        qty = Number(m[2]) || 1;
      } else if (/^V\d{3}$/i.test(m[2])) {
        id = m[2].toUpperCase();
        qty = Number(m[1]) || 1;
      } else {
        const card = byName(m[1]);
        if (!card) return;
        id = card.id;
        qty = Number(m[2]) || 1;
      }
      counts[id] = (counts[id] || 0) + qty;
    });
    return counts;
  }

  function customDecks() {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.map((d) => ({
        id: String(d.id || ''),
        name: String(d.name || 'Custom 40'),
        hero: String(d.hero || (d.heroes && d.heroes[0]) || ''),
        heroes: Array.isArray(d.heroes) && d.heroes.length ? d.heroes.map(String) : [String(d.hero || '')].filter(Boolean),
        cards: d.cards && typeof d.cards === 'object' ? d.cards : {},
      })).filter((d) => d.id || Object.keys(d.cards).length);
    } catch (_err) {
      return [];
    }
  }

  function deckSummary(pack) {
    if (!pack || !pack.ok) return pack && pack.errors ? pack.errors[0] : 'No list';
    return `${pack.total} cards · ${pack.rows.length} names`;
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function peekHtml(card, pinned) {
    if (!card) return '';
    const art = card.render
      ? `<img src="${esc(card.render)}" alt="${esc(card.name)}" width="260" height="347">`
      : '';
    const body = `<p class="irl-peek-kicker">${esc(card.id)} · ${esc(card.type)}</p>
      <p class="irl-peek-name">${esc(card.name)}</p>
      <p class="irl-peek-stats">${esc(statsLine(card))}</p>
      ${card.keyword ? `<p class="irl-peek-kw">${esc(card.keyword)}</p>` : ''}
      <p class="irl-peek-text">${esc(card.text || 'No printed rules text.')}</p>`;
    return `<button type="button" class="irl-peek-close" data-peek-close aria-label="Close">×</button>${art}
      <div class="irl-peek-body">${body}</div>
      ${pinned ? '<div class="irl-peek-actions"><button type="button" class="btn irl-peek-done" data-peek-close>Close</button><button type="button" class="btn ghost" data-peek-correct>Wrong card</button></div>' : ''}`;
  }

  function ensurePeek() {
    let css = document.getElementById('irl-peek-css');
    if (!css) {
      css = document.createElement('style');
      css.id = 'irl-peek-css';
      css.textContent = `#irl-card-peek{display:none;position:fixed;z-index:90;width:260px;pointer-events:none;filter:drop-shadow(0 16px 32px #000000aa)}
#irl-card-peek.is-on{display:block}
#irl-card-peek.is-pin{pointer-events:auto;width:min(320px,calc(100vw - 2rem))}
#irl-card-peek img{width:100%;height:auto;display:block;border-radius:8px;background:#0d0a07;position:relative;z-index:0}
#irl-card-peek-scrim{display:none;position:fixed;inset:0;background:#000000b8;z-index:89;cursor:pointer}
#irl-card-peek-scrim.is-on{display:block}
#irl-card-peek .irl-peek-close{position:absolute;top:6px;right:6px;z-index:4;width:36px;height:36px;border-radius:50%;border:1px solid #f3d27a;background:#1a1410;color:#f6d98a;font-size:22px;line-height:1;cursor:pointer}
#irl-card-peek .irl-peek-actions{display:flex;gap:8px;padding:8px 2px 2px}
#irl-card-peek .irl-peek-actions .btn{flex:1}`;
      document.head.appendChild(css);
    }
    let scrim = document.getElementById('irl-card-peek-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'irl-card-peek-scrim';
      document.body.appendChild(scrim);
    }
    let el = document.getElementById('irl-card-peek');
    if (!el) {
      el = document.createElement('div');
      el.id = 'irl-card-peek';
      el.setAttribute('role', 'tooltip');
      document.body.appendChild(el);
    }
    return { el, scrim };
  }

  let peekMode = null;
  let peekId = '';
  let peekHideTimer = 0;
  let peekGuardUntil = 0;
  let peekLane = '';
  let peekSeat = 0;
  let peekChromeBound = false;

  function hidePeek() {
    clearTimeout(peekHideTimer);
    peekMode = null;
    peekId = '';
    peekLane = '';
    peekSeat = 0;
    const { el, scrim } = ensurePeek();
    el.classList.remove('is-on', 'is-pin');
    el.innerHTML = '';
    scrim.classList.remove('is-on');
  }

  function placePeek(el, x, y) {
    const pad = 12;
    const w = el.offsetWidth || 260;
    const h = el.offsetHeight || 360;
    let left = x + 18;
    let top = y - h * 0.35;
    if (left + w > window.innerWidth - pad) left = x - w - 18;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function bindPeekChrome() {
    if (peekChromeBound) return;
    peekChromeBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !peekMode) return;
      hidePeek();
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-peek-close]')) {
        e.preventDefault();
        hidePeek();
        return;
      }
      if (!e.target.closest('[data-peek-correct]')) return;
      e.preventDefault();
      const detail = { lane: peekLane, seat: peekSeat, id: peekId };
      hidePeek();
      window.dispatchEvent(new CustomEvent('ddl-irl-peek-correct', { detail }));
    });
  }

  function showPeek(id, evOrAnchor, mode) {
    const card = byId(id);
    if (!card) return;
    bindPeekChrome();
    const { el, scrim } = ensurePeek();
    const laneEl = evOrAnchor && evOrAnchor.closest ? evOrAnchor.closest('[data-lane]') : null;
    peekLane = laneEl ? laneEl.getAttribute('data-lane') || '' : '';
    const cam = laneEl && laneEl.closest('[data-board-seat]');
    peekSeat = cam ? Number(cam.getAttribute('data-board-seat')) || 0 : 0;
    const reuse = peekId === id && peekMode === mode && el.classList.contains('is-on');
    peekMode = mode;
    peekId = id;
    if (!reuse) {
      el.innerHTML = peekHtml(card, mode === 'pin');
      const img = el.querySelector('img');
      if (img) {
        img.addEventListener('load', () => {
          if (peekId === id && mode === 'hover' && evOrAnchor && evOrAnchor.clientX != null) {
            placePeek(el, evOrAnchor.clientX, evOrAnchor.clientY);
          }
        }, { once: true });
      }
    }
    el.classList.add('is-on');
    el.classList.toggle('is-pin', mode === 'pin');
    if (mode === 'pin') {
      el.style.left = '50%';
      el.style.top = '50%';
      el.style.transform = 'translate(-50%, -50%)';
      scrim.classList.add('is-on');
      peekGuardUntil = Date.now() + 400;
    } else {
      el.style.transform = '';
      scrim.classList.remove('is-on');
      const x = evOrAnchor && evOrAnchor.clientX != null
        ? evOrAnchor.clientX
        : (evOrAnchor && evOrAnchor.getBoundingClientRect ? evOrAnchor.getBoundingClientRect().right : 40);
      const y = evOrAnchor && evOrAnchor.clientY != null
        ? evOrAnchor.clientY
        : (evOrAnchor && evOrAnchor.getBoundingClientRect ? evOrAnchor.getBoundingClientRect().top : 40);
      placePeek(el, x, y);
    }
  }

  function bindPeekRoot(root) {
    ensurePeek();
    bindPeekChrome();
    function peekTarget(e) {
      const ref = e.target.closest('[data-peek]');
      if (!ref || !root.contains(ref)) return null;
      const key = ref.getAttribute('data-lane');
      if (global.DdlIrlWatch && DdlIrlWatch.isPileLane(key)) return null;
      return ref;
    }
    const laterHide = () => {
      if (peekMode === 'pin') return;
      clearTimeout(peekHideTimer);
      peekHideTimer = setTimeout(hidePeek, 80);
    };
    root.addEventListener('mouseover', (e) => {
      if (peekMode === 'pin') return;
      const ref = peekTarget(e);
      if (!ref) return;
      clearTimeout(peekHideTimer);
      showPeek(ref.getAttribute('data-peek'), e, 'hover');
    });
    root.addEventListener('mousemove', (e) => {
      if (peekMode !== 'hover') return;
      const ref = peekTarget(e);
      if (!ref) return;
      const { el } = ensurePeek();
      if (el.classList.contains('is-on')) placePeek(el, e.clientX, e.clientY);
    });
    root.addEventListener('mouseout', (e) => {
      if (peekMode !== 'hover') return;
      const ref = peekTarget(e);
      if (!ref) return;
      if (e.relatedTarget && ref.contains(e.relatedTarget)) return;
      laterHide();
    });
    root.addEventListener('click', (e) => {
      if (Date.now() < peekGuardUntil) {
        e.preventDefault();
        return;
      }
      if (e.target.closest('[data-peek-close]') || e.target.id === 'irl-card-peek-scrim') {
        e.preventDefault();
        hidePeek();
        return;
      }
      const ref = peekTarget(e);
      if (!ref) return;
      e.preventDefault();
      showPeek(ref.getAttribute('data-peek'), ref, 'pin');
    });
    const scrim = document.getElementById('irl-card-peek-scrim');
    if (scrim && !scrim._irlBound) {
      scrim._irlBound = true;
      scrim.addEventListener('click', hidePeek);
    }
  }

  global.DdlIrlCatalog = {
    SRC,
    DECK_SIZE,
    MAX_COPIES,
    CLASSES,
    load,
    catalog,
    cards,
    byId,
    byName,
    searchKindFromText,
    searchKindForCard,
    statsLine,
    validateDeck,
    parseDeckText,
    customDecks,
    deckSummary,
    countMap,
    peekHtml,
    showPeek,
    hidePeek,
    bindPeekRoot,
  };
})(window);
