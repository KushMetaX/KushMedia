const TOURNEY_API_BASES = ['/tourney-api', '/kmx-tourney', '/kk-tourney'];
const AUTH_API_BASES = ['/kmx-auth', '/kk-auth', '/api/auth', '/auth'];
const TOURNEY_API_KEY = 'ddl-tourney-api';
const AUTH_API_KEY = 'ddl-auth-api';

const root = document.getElementById('app');

/**
 * Admin state. `adminPassword` is only kept after the server has verified it.
 * Discord-linked hosts do not use this — they get tools on arenas they created.
 */
let hostPassword = '';
let hostMode = false;
let adminPassword = sessionStorage.getItem('ddl-admin-password') || '';
let adminMode = adminPassword !== '' && sessionStorage.getItem('ddl-admin-mode') === '1';
let serverStatus = null;
let playerUser = null;
let irlUnmount = null;
let arenasWarm = { p: null, at: 0, data: null };

function isSignedInUser(user) {
  return Boolean(user && (user.id || user.discordId || user.tourneyHandle || user.discordUsername));
}

function orderedBases(list, key) {
  const bases = list.slice();
  let saved = '';
  try { saved = sessionStorage.getItem(key) || ''; } catch (_err) {}
  if (saved && bases.includes(saved)) {
    bases.splice(bases.indexOf(saved), 1);
    bases.unshift(saved);
  }
  return bases;
}

function rememberBase(key, base) {
  try { sessionStorage.setItem(key, base); } catch (_err) {}
}

async function fetchText(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')))) {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const authApi = {
  async get(path) {
    let lastErr;
    for (const base of orderedBases(AUTH_API_BASES, AUTH_API_KEY)) {
      try {
        const { res, text } = await fetchText(`${base}${path}`, { credentials: 'same-origin' }, 8000);
        if (/^\s*</.test(text)) {
          lastErr = new Error('Auth API returned a web page');
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (res.status === 401) return null;
        if (res.status === 503) {
          lastErr = new Error(data.error || 'Auth unavailable');
          continue;
        }
        if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`);
        rememberBase(AUTH_API_KEY, base);
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Auth request failed');
  },
  async post(path, body) {
    let lastErr;
    for (const base of orderedBases(AUTH_API_BASES, AUTH_API_KEY)) {
      try {
        const { res, text } = await fetchText(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body || {}),
        }, 12000);
        if (/^\s*</.test(text) && !String(text).includes('"error"')) {
          lastErr = new Error('Auth API returned a web page');
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`);
        rememberBase(AUTH_API_KEY, base);
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Auth request failed');
  },
};

function routeParts() {
  const path = String(location.pathname || '');
  const stripped = path.replace(/^\/(?:__tourney_gate|tourney|bracket)\/?/i, '');
  const fromPath = stripped.split('/').filter(Boolean).map((part) => decodeURIComponent(String(part).split('?')[0]));
  const query = new URLSearchParams(location.search || '');
  const querySlug = query.get('t') || query.get('slug');
  const queryTable = query.get('table') || query.get('m');
  if (querySlug) {
    if (queryTable) return ['t', querySlug, 'table', queryTable];
    return ['t', querySlug];
  }
  if (fromPath[0] === 't' && fromPath[1]) return fromPath;
  const hash = (location.hash || '#/').replace(/^#/, '');
  return hash.split('/').filter(Boolean).map((part) => decodeURIComponent(part.split('?')[0])).filter(Boolean);
}

function arenaHref(slug) {
  return `/tourney/?t=${encodeURIComponent(slug)}`;
}

function arenaShareHref(slug) {
  return `/tourney/?t=${encodeURIComponent(slug)}`;
}

function tableHref(slug, matchId) {
  return `/tourney/?t=${encodeURIComponent(slug)}&table=${encodeURIComponent(String(matchId))}`;
}

function tourneyReturnPath() {
  const parts = routeParts();
  if (parts[0] === 't' && parts[1] && parts[2] === 'table' && parts[3]) {
    return tableHref(parts[1], parts[3]);
  }
  if (parts[0] === 't' && parts[1]) return arenaShareHref(parts[1]);
  if (parts[0] === 'player' && parts[1]) return `/tourney/#/player/${encodeURIComponent(parts[1])}`;
  if (parts[0] === 'records') return '/tourney/#/records';
  if (parts[0] === 'ledger') return '/tourney/#/ledger';
  if (parts[0] === 'create') return '/tourney/#/create';
  if (parts[0] === 'rules') return '/tourney/#/rules';
  return '/tourney/';
}

function goTourney(path) {
  const next = String(path || '/tourney/');
  if (`${location.pathname}${location.search}${location.hash}` === next) {
    route();
    return;
  }
  history.pushState(null, '', next);
  route();
}

function canonicalizeArenaUrl() {
  const parts = routeParts();
  if (!(parts[0] === 't' && parts[1])) return;
  const want = parts[2] === 'table' && parts[3] ? tableHref(parts[1], parts[3]) : arenaHref(parts[1]);
  const have = `${location.pathname}${location.search}`;
  if (have !== want || location.hash) {
    history.replaceState(null, '', want);
  }
}

function cleanHashForReturn() {
  let hash = location.hash || '#/';
  if (!hash.startsWith('#')) hash = `#${hash}`;
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return hash;
  const path = hash.slice(0, qIdx);
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  params.delete('auth_error');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function discordStartHref() {
  return `/kmx-auth/discord/start?return=${encodeURIComponent(tourneyReturnPath())}`;
}

function avatarUrlForUser(user) {
  if (!user) return '';
  if (user.avatarUrl) return String(user.avatarUrl);
  if (!user.discordId) return '';
  try {
    const idx = Number((BigInt(String(user.discordId)) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch (_err) {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

async function loadPlayerSession() {
  try {
    const data = await authApi.get('/me');
    playerUser = isSignedInUser(data && data.user) ? data.user : null;
  } catch (_err) {
    playerUser = null;
  }
  applyPlayerChrome();
  applyHostChrome();
}

function applyPlayerChrome() {
  if (typeof nudgeArenaChat === 'function') nudgeArenaChat();
  const signedIn = isSignedInUser(playerUser);
  const login = document.getElementById('discord-login');
  const sessionEl = document.getElementById('player-session');
  const nameEl = document.getElementById('player-name');
  const avatarEl = document.getElementById('player-avatar');
  if (login) {
    login.href = discordStartHref();
    login.hidden = signedIn;
  }
  if (sessionEl) {
    sessionEl.hidden = !signedIn;
    sessionEl.classList.toggle('is-on', signedIn);
  }
  if (nameEl) {
    if (signedIn) {
      const handle = playerUser.tourneyHandle || playerUser.discordUsername || 'Player';
      nameEl.classList.add('named-handle');
      nameEl.innerHTML = `${esc(handle)}${medalsInlineHtml(badgesFor(handle))}`;
      nameEl.href = playerUser.tourneyHandle ? `/tourney/#/player/${encodeURIComponent(playerUser.tourneyHandle)}` : '/tourney/#/records';
    } else {
      nameEl.classList.remove('named-handle');
      nameEl.textContent = '';
      nameEl.removeAttribute('href');
    }
  }
  if (avatarEl) {
    const src = signedIn ? avatarUrlForUser(playerUser) : '';
    if (src) {
      avatarEl.referrerPolicy = 'no-referrer';
      avatarEl.decoding = 'async';
      avatarEl.onerror = () => {
        const fallback = playerUser && playerUser.discordId
          ? (() => {
            try {
              const idx = Number((BigInt(String(playerUser.discordId)) >> 22n) % 6n);
              return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
            } catch (_e) {
              return 'https://cdn.discordapp.com/embed/avatars/0.png';
            }
          })()
          : '';
        if (fallback && avatarEl.src !== fallback) {
          avatarEl.onerror = () => { avatarEl.hidden = true; };
          avatarEl.src = fallback;
        } else {
          avatarEl.hidden = true;
        }
      };
      avatarEl.src = src;
      avatarEl.hidden = false;
    } else {
      avatarEl.removeAttribute('src');
      avatarEl.hidden = true;
    }
  }
}

function playerLink(handle, badges) {
  const h = String(handle || '').trim();
  if (!h) return '—';
  return `<a class="named-handle" href="/tourney/#/player/${encodeURIComponent(h)}">${esc(h)}${medalsInlineHtml(badgesFor(h, badges))}</a>`;
}

function hostingEnabled() {
  return !(serverStatus && serverStatus.hostingEnabled === false) && !(serverStatus && serverStatus.hostPasswordSet === false);
}

function isGrantedHost() {
  return Boolean(playerUser && playerUser.tourneyHost);
}

function isAdminMode() {
  return Boolean(adminMode && adminPassword);
}

function canCreateArena() {
  return isAdminMode() || (isGrantedHost() && hostingEnabled());
}

function syncHostMode() {
  hostMode = canCreateArena();
}

function hostHeaders() {
  return isAdminMode() ? { 'x-tourney-admin': adminPassword } : {};
}

function invoiceStorageKey(slug) {
  return `ddl-invoice-${slug}`;
}

function storedInvoice(slug) {
  try { return sessionStorage.getItem(invoiceStorageKey(slug)) || ''; } catch (_err) { return ''; }
}

function rememberInvoice(slug, code) {
  const value = String(code || '').trim();
  if (!value) return;
  try { sessionStorage.setItem(invoiceStorageKey(slug), value); } catch (_err) { /* private mode */ }
}

function tourneyHeaders(path) {
  const headers = { ...hostHeaders() };
  const match = String(path || '').match(/\/arenas\/([^/?]+)/);
  if (match) {
    const code = storedInvoice(decodeURIComponent(match[1]));
    if (code) headers['x-tourney-invoice'] = code;
  }
  return headers;
}

const api = {
  async get(path) {
    let lastErr;
    for (const base of orderedBases(TOURNEY_API_BASES, TOURNEY_API_KEY)) {
      try {
        const { res, text } = await fetchText(`${base}${path}`, {
          headers: tourneyHeaders(path),
          credentials: 'same-origin',
          cache: 'no-store',
        }, 8000);
        if (/^\s*</.test(text)) {
          lastErr = new Error(htmlErrorMessage(res.status, base));
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        rememberBase(TOURNEY_API_KEY, base);
        return data;
      } catch (err) {
        lastErr = err;
        if (err && /not found|rejected|locked/i.test(err.message)) throw err;
      }
    }
    throw lastErr || new Error('Request failed');
  },
  async post(path, body) {
    let lastErr;
    for (const base of orderedBases(TOURNEY_API_BASES, TOURNEY_API_KEY)) {
      try {
        const { res, text } = await fetchText(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...tourneyHeaders(path) },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify(body || {}),
        }, 25000);
        if ((res.status === 404 || /^\s*</.test(text)) && !String(text).includes('"error"')) {
          lastErr = new Error(htmlErrorMessage(res.status, base));
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        rememberBase(TOURNEY_API_KEY, base);
        return data;
      } catch (err) {
        lastErr = err;
        if (err && /rejected|locked|not found|too short|full|already/i.test(err.message)) throw err;
      }
    }
    throw lastErr || new Error('Request failed');
  },
};

/**
 * An HTML body means the request never reached the tourney router — usually a Node process
 * still running an older copy of the routes. Say that instead of leaking "404 HTML".
 */
function htmlErrorMessage(status, base) {
  if (status === 404) return `The tourney API at ${base} does not have this endpoint. Restart Node so it picks up the current routes.`;
  return `The tourney API at ${base} answered with a web page instead of data (${status}).`;
}

const FORMAT_LABEL = {
  single_elim: 'Single Elimination',
  double_elim: 'Double Elimination',
  round_robin: 'Round Robin',
  swiss: 'Swiss',
};

function isDuelArena(t, fieldSize) {
  if (t && t.eventKind === 'duel') return true;
  if (t && t.kind === 'duel') return true;
  if (fieldSize != null) return Number(fieldSize) === 2;
  if (t && t.fieldSize != null) return Number(t.fieldSize) === 2;
  return Boolean(t && t.status === 'completed' && Number(t.paidCount) === 2);
}

function looksLikeGrandTournament(name) {
  const n = String(name || '');
  return /\bddnyc\b/i.test(n) && /\b2026\b/.test(n) && /\birl\b/i.test(n);
}

function sanitizeEventKind(value, name) {
  if (value === 'duel') return 'duel';
  if (value === 'grand' || looksLikeGrandTournament(name)) return 'grand';
  return 'tournament';
}

function isGrandArena(t) {
  if (!t) return false;
  return sanitizeEventKind(t.eventKind || t.kind, t.name) === 'grand';
}

function kindLabel(t, fieldSize) {
  if (isDuelArena(t, fieldSize)) return 'Duel';
  if (isGrandArena(t)) return 'Grand Tournament';
  return 'Tournament';
}

function kindTagHtml(t, fieldSize) {
  const duel = isDuelArena(t, fieldSize);
  const grand = !duel && isGrandArena(t);
  const cls = duel ? 'kind-tag duel' : (grand ? 'kind-tag grand' : 'kind-tag');
  return `<span class="${cls}">${esc(kindLabel(t, fieldSize))}</span>`;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const MARK_ICONS = ['crown', 'flame', 'shield', 'star', 'laurel', 'crest'];
const BADGE_ICONS = MARK_ICONS.concat((typeof DDL_BADGES !== 'undefined' && DDL_BADGES.ART_ICONS) || []);
const BADGE_MOTIFS = ['gold', 'ember', 'cream', 'copper', 'verdant'];
const DDL_CLASS_IDS = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.CLASS_IDS) || ['Crown', 'Bow', 'Wizard', 'Zombie', 'Pirate', 'Neutral'];
const DDL_DEFAULT_CLASS = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.DEFAULT_CLASS) || 'Undeclared';
const MOTIF_PALETTE = {
  gold: { metal: '#f0c45a', metalDeep: '#8a5810', enamel: '#140a04', enamelLight: '#3a2410', charge: '#ffe9a8' },
  ember: { metal: '#e07a3a', metalDeep: '#7a2e10', enamel: '#1a0804', enamelLight: '#4a1810', charge: '#ffd0a8' },
  cream: { metal: '#f4e6c3', metalDeep: '#9a7a40', enamel: '#1c1408', enamelLight: '#3a2c14', charge: '#fff6e0' },
  copper: { metal: '#d4892a', metalDeep: '#7a4a08', enamel: '#1a0e04', enamelLight: '#3e240c', charge: '#ffd090' },
  verdant: { metal: '#9ec87a', metalDeep: '#3d5c28', enamel: '#0c1408', enamelLight: '#1c2c14', charge: '#e8f6d0' },
};

let medalSeq = 0;
let awardIndex = new Map();

function ingestAwards(awards) {
  const next = new Map();
  for (const award of awards || []) {
    const key = String(award.handle || '').toLowerCase();
    if (!key) continue;
    if (!next.has(key)) next.set(key, []);
    next.get(key).push(award);
  }
  awardIndex = next;
}

function badgesFor(handle, fallback) {
  const fromIndex = awardIndex.get(String(handle || '').toLowerCase()) || [];
  if (fromIndex.length) return fromIndex;
  return Array.isArray(fallback) ? fallback : [];
}

function starPoly(cx, cy, rOut, rIn, points, rotation) {
  const rot = rotation == null ? -Math.PI / 2 : rotation;
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = rot + (Math.PI * i) / points;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function beadCircles(cx, cy, r, count, br) {
  let markup = '';
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2;
    markup += `<circle cx="${(cx + r * Math.cos(a)).toFixed(2)}" cy="${(cy + r * Math.sin(a)).toFixed(2)}" r="${br}"/>`;
  }
  return markup;
}

function chargeMarkup(icon) {
  const key = BADGE_ICONS.includes(icon) ? icon : 'crest';
  if (key === 'crown') {
    return `<path d="M3.1 16.8h17.8v2.4H3.1z"/>
      <path d="M4.2 16.8 6.7 8.2l2.6 4.8L12 4.6l2.7 8.4 2.6-4.8 2.5 8.6z"/>
      <circle cx="6.7" cy="16.2" r="0.95"/><circle cx="12" cy="16.2" r="0.95"/><circle cx="17.3" cy="16.2" r="0.95"/>
      <path d="M11.35 2.2h1.3v2.4h-1.3z"/><path d="M10.55 2.95h2.9v1.05h-2.9z"/>
      <path d="M8.4 19.6h7.2v1.35H8.4z"/>`;
  }
  if (key === 'flame') {
    return `<path fill-rule="evenodd" d="M12 2.1c3.7 5 6.5 8.4 6.5 13.2A6.5 6.5 0 1 1 5.5 15.3C5.5 10.5 8.3 7.1 12 2.1zm0 7.4c1.55 0 2.65 1.2 2.65 2.7 0 2.15-2.65 4.35-2.65 4.35S9.35 14.35 9.35 12.2c0-1.5 1.1-2.7 2.65-2.7z"/>`;
  }
  if (key === 'shield') {
    return `<path fill-rule="evenodd" d="M12 2.3 4.2 6v6.3c0 5.1 3.5 8.6 7.8 10.4 4.3-1.8 7.8-5.3 7.8-10.4V6zm0 4.2 4.7 7.4H7.3z"/>`;
  }
  if (key === 'star') {
    return `<path d="${starPoly(12, 12, 10.5, 4.15, 8)}"/>`;
  }
  if (key === 'laurel') {
    return `<path d="M7.4 7.6c1.7 1.2 2.5 2.8 2.2 4.5-1.9-.9-3.1-2.4-3.5-4.3.45-.1.9-.2 1.3-.2z"/>
      <path d="M6.5 11.4c1.8 1.25 2.7 2.9 2.3 4.6-2.1-.9-3.3-2.5-3.7-4.4.47-.1.92-.2 1.4-.2z"/>
      <path d="M7 15.2c1.85 1.3 2.9 2.85 2.45 4.45-2.15-.85-3.5-2.25-3.9-4.25.5-.1.95-.2 1.45-.2z"/>
      <path d="M8.8 18.4c1.5 1.15 2.7 2.15 3.2 2.55-.75-1.35-1.55-2.5-2.35-3.3.4.2.75.48 1.15.75z"/>
      <path d="M16.6 7.6c-1.7 1.2-2.5 2.8-2.2 4.5 1.9-.9 3.1-2.4 3.5-4.3-.45-.1-.9-.2-1.3-.2z"/>
      <path d="M17.5 11.4c-1.8 1.25-2.7 2.9-2.3 4.6 2.1-.9 3.3-2.5 3.7-4.4-.47-.1-.92-.2-1.4-.2z"/>
      <path d="M17 15.2c-1.85 1.3-2.9 2.85-2.45 4.45 2.15-.85 3.5-2.25 3.9-4.25-.5-.1-.95-.2-1.45-.2z"/>
      <path d="M15.2 18.4c-1.5 1.15-2.7 2.15-3.2 2.55.75-1.35 1.55-2.5 2.35-3.3-.4.2-.75.48-1.15.75z"/>
      <path d="M9.6 19.7h4.8l.55 1.45H9.05z"/><path d="M8.7 21.35h6.6v1.15H8.7z"/>`;
  }
  return `<path d="M12 2.05c2.05 2.7 3.7 5.3 3.55 8.05 2.85-.8 5.15.05 5.45 2.7-2.7-.6-4.75.2-6.8 2.5v1.55h2.7v1.5H7.1v-1.5h2.7v-1.55c-2.05-2.3-4.1-3.1-6.8-2.5.3-2.65 2.6-3.5 5.45-2.7C8.3 7.35 9.95 4.75 12 2.05z"/>
    <path d="M8.15 18.7h7.7v1.4H8.15z"/><path d="M9.35 20.4h5.3v1.2H9.35z"/>`;
}

function badgeArtSrc(badge) {
  if (typeof DDL_BADGES === 'undefined') return '';
  return DDL_BADGES.artFor(badge) || '';
}

function medalHtml(badge, size) {
  if (!badge) return '';
  const motif = BADGE_MOTIFS.includes(badge.motif) ? badge.motif : 'gold';
  const pal = MOTIF_PALETTE[motif];
  const title = esc(badge.title || 'Badge');
  const uid = `md${++medalSeq}`;
  const sizeClass = size === 'lg' ? ' lg' : size === 'md' ? ' md' : '';
  const art = badgeArtSrc(badge);
  if (art) {
    const kind = String(badge.icon || badge.slug || '').startsWith('standing-') ? ' standing-art' : ' class-art';
    return `<span class="medal art ${motif}${kind}${sizeClass}" title="${title}" role="img" aria-label="${title}"><img src="${esc(art)}" alt=""></span>`;
  }
  return `<span class="medal ${motif}${sizeClass}" title="${title}" role="img" aria-label="${title}">
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}-metal" x1="16" y1="6" x2="64" y2="74" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff6d2"/>
          <stop offset=".2" stop-color="${pal.metal}"/>
          <stop offset=".52" stop-color="${pal.metalDeep}"/>
          <stop offset=".78" stop-color="${pal.metal}"/>
          <stop offset="1" stop-color="#5a3408"/>
        </linearGradient>
        <radialGradient id="${uid}-enamel" cx="36%" cy="30%" r="70%">
          <stop offset="0" stop-color="${pal.enamelLight}"/>
          <stop offset="1" stop-color="${pal.enamel}"/>
        </radialGradient>
        <linearGradient id="${uid}-charge" x1="22" y1="10" x2="58" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff6d8"/>
          <stop offset=".42" stop-color="${pal.charge}"/>
          <stop offset="1" stop-color="${pal.metalDeep}"/>
        </linearGradient>
      </defs>
      <path d="${starPoly(40, 40, 39.4, 33.2, 16)}" fill="url(#${uid}-metal)"/>
      <circle cx="40" cy="40" r="31.6" fill="url(#${uid}-metal)"/>
      <circle cx="40" cy="40" r="26.4" fill="url(#${uid}-enamel)"/>
      <circle cx="40" cy="40" r="24.6" fill="none" stroke="${pal.metal}" stroke-width=".85" opacity=".65"/>
      <circle cx="40" cy="40" r="22.2" fill="none" stroke="${pal.metalDeep}" stroke-width=".45" opacity=".45"/>
      <g fill="url(#${uid}-metal)">${beadCircles(40, 40, 29.1, 18, 1.55)}</g>
      <g transform="translate(40 40) scale(1.18) translate(-12 -12)" fill="url(#${uid}-charge)">${chargeMarkup(badge.icon)}</g>
      <path d="M20 27.5c7.5-9 22-11 33-4" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" opacity=".3"/>
    </svg>
  </span>`;
}

function medalSvg(icon) {
  return medalHtml({ title: icon, icon, motif: 'gold' }, 'md');
}

function medalsInlineHtml(badges, size) {
  const list = Array.isArray(badges) ? badges : [];
  if (!list.length) return '';
  return `<span class="medal-inline">${list.map((b) => medalHtml(b, size)).join('')}</span>`;
}

function namedHandleHtml(handle, badges, size) {
  const name = String(handle || '').trim();
  if (!name) return '';
  return `<span class="named-handle">${esc(name)}${medalsInlineHtml(badgesFor(name, badges), size)}</span>`;
}

function medalsRowHtml(badges, canRevoke) {
  const list = Array.isArray(badges) ? badges : [];
  if (!list.length) return '';
  return `<div class="medal-row">${list.map((b) => `
    <div class="medal-award">
      ${medalHtml(b, 'md')}
      <span class="medal-meta">
        <strong>${esc(b.title)}</strong>
        <span class="muted">${esc(b.note || b.blurb || '')}</span>
      </span>
      ${canRevoke && b.id ? `<button type="button" class="mini bad" data-revoke="${b.id}">Remove</button>` : ''}
    </div>`).join('')}</div>`;
}

function standingSpec(place) {
  return typeof DDL_BADGES !== 'undefined' ? DDL_BADGES.standingSpec(place) : null;
}

function parseDdlClass(value) {
  if (typeof DDL_BADGES !== 'undefined' && typeof DDL_BADGES.parseClass === 'function') {
    return DDL_BADGES.parseClass(value);
  }
  const id = String(value || '').trim();
  return { kind: id ? 'hero' : 'undeclared', ids: id ? [id] : [], label: id, stored: id || DDL_DEFAULT_CLASS };
}

function classLabelText(value) {
  if (typeof DDL_BADGES !== 'undefined' && typeof DDL_BADGES.classLabel === 'function') {
    return DDL_BADGES.classLabel(value);
  }
  return parseDdlClass(value).label || '';
}

function classLabelHtml(value) {
  const label = classLabelText(value);
  return label ? `<span class="class-tag">${esc(label)}</span>` : '';
}

function ddlCardById(id) {
  const key = String(id || '').trim().toUpperCase();
  if (!key || typeof DDL === 'undefined' || !Array.isArray(DDL.cards)) return null;
  return DDL.cards.find((c) => String(c.id).toUpperCase() === key) || null;
}

function ddlCardByName(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key || typeof DDL === 'undefined' || !Array.isArray(DDL.cards)) return null;
  return DDL.cards.find((c) => (
    String(c.id).toUpperCase() !== 'V029'
    && String(c.name).trim().toLowerCase().replace(/\s+/g, ' ') === key
  )) || null;
}

function ddlCardsReady() {
  return typeof DDL !== 'undefined' && Array.isArray(DDL.cards) && DDL.cards.length > 0;
}

function inferClassFromCounts(counts) {
  const tally = {};
  for (const [id, qty] of Object.entries(counts || {})) {
    const card = ddlCardById(id);
    if (!card) continue;
    const cls = String(card.class || '');
    if (!cls || cls === 'Neutral' || cls === 'All' || card.all_class) continue;
    tally[cls] = (tally[cls] || 0) + (Number(qty) || 0);
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return DDL_DEFAULT_CLASS;
  if (ranked.length === 1 || ranked[1][1] < 4) return ranked[0][0];
  return `${ranked[0][0]}/${ranked[1][0]}`;
}

const CatQuota = (typeof window !== 'undefined' && window.DdlIrlCatalog) || null;

function classQuotaOf(t) {
  if (CatQuota && typeof CatQuota.sanitizeClassQuota === 'function') {
    return CatQuota.sanitizeClassQuota(t && (t.deckClassQuota || t));
  }
  const raw = t && t.deckClassQuota ? t.deckClassQuota : t;
  const klass = DDL_CLASS_IDS.find((id) => id.toLowerCase() === String(raw && raw.class || '').toLowerCase());
  const percent = Math.min(100, Math.max(0, Math.round(Number(raw && raw.percent) || 0)));
  return klass && percent > 0 ? { class: klass, percent } : null;
}

function classQuotaLabel(quota) {
  if (CatQuota && typeof CatQuota.classQuotaLabel === 'function') {
    return CatQuota.classQuotaLabel(quota);
  }
  const rule = classQuotaOf({ deckClassQuota: quota });
  return rule ? `${rule.percent}% ${rule.class}` : '';
}

function classQuotaNoticeHtml(quota) {
  const rule = classQuotaOf({ deckClassQuota: quota });
  if (!rule) return '';
  const label = classQuotaLabel(rule);
  const extra = rule.class === 'Neutral'
    ? ' Neutral cards count toward this mix.'
    : ' Mini, Midi, and Mega count as that class. Neutral does not.';
  return `<p class="deck-quota-note" role="status"><strong>You need ${esc(label)} in this deck.</strong>${esc(extra)}</p>`;
}

function evaluateDeckQuota(counts, quota) {
  if (CatQuota && typeof CatQuota.evaluateClassQuota === 'function') {
    return CatQuota.evaluateClassQuota(counts, quota);
  }
  return { required: false, ok: true, rule: classQuotaOf({ deckClassQuota: quota }), need: 0, share: null, message: '' };
}

function classMixPillHtml(deck, quota) {
  const rule = classQuotaOf({ deckClassQuota: quota });
  if (!rule) return '';
  const mix = evaluateDeckQuota((deck && deck.counts) || {}, rule);
  const have = mix.share ? Math.round(mix.share.percent) : 0;
  const ok = Boolean(mix.ok);
  return `<span class="pd-pill ${ok ? '' : 'warn'}">${esc(rule.class)} ${have}%${ok ? '' : ` · need ${rule.percent}%`}</span>`;
}

function applyClassPick(rootEl, name, stored) {
  if (!rootEl) return;
  const parsed = parseDdlClass(stored);
  const value = parsed.kind === 'split' || parsed.ids.length > 1
    ? 'Split'
    : (parsed.kind === 'hero' ? parsed.stored : DDL_DEFAULT_CLASS);
  rootEl.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
  if (value === 'Split') {
    const a = rootEl.querySelector(`[name="${name}-a"]`);
    const b = rootEl.querySelector(`[name="${name}-b"]`);
    if (a && parsed.ids[0]) a.value = parsed.ids[0];
    if (b && parsed.ids[1]) b.value = parsed.ids[1];
  }
  bindClassPicker(rootEl);
}

function deckLinesHtml(deck) {
  const counts = (deck && deck.counts) || {};
  const ids = Object.keys(counts).sort((a, b) => {
    const na = (ddlCardById(a) && ddlCardById(a).name) || a;
    const nb = (ddlCardById(b) && ddlCardById(b).name) || b;
    return String(na).localeCompare(String(nb));
  });
  if (!ids.length) return '<p class="muted">No cards in this list.</p>';
  return `<div class="play-deck-lines">${ids.map((id) => {
    const card = ddlCardById(id);
    const name = (card && card.name) || id;
    const cls = card && card.class ? esc(String(card.class).toLowerCase()) : '';
    return `<div class="play-deck-line"><span>${esc(name)}${cls ? ` <small class="muted">${esc(card.class)}</small>` : ''}</span><b>×${counts[id]}</b></div>`;
  }).join('')}</div>`;
}

function registeredDeckSummaryHtml(deck) {
  if (!deck) return '';
  const count = Number(deck.cardCount) || 0;
  const ready = count === 40 || deck.ready;
  return `<strong>${esc(deck.name || 'Play list')}</strong>
    <span class="pd-pill ${ready ? '' : 'warn'}">${count}/40</span>
    ${deck.playName ? `<span class="muted"> · ${esc(deck.playName)}</span>` : ''}`;
}

function playCatalog() {
  return (typeof window !== 'undefined' && window.DdlIrlCatalog) || null;
}

function parsePlayListFallback(raw) {
  const unknown = [];
  const dropped = [];
  let deckName = '';
  let serials = [];
  const text = String(raw || '');
  const stripped = text.trim();
  if (stripped.charAt(0) === '[') {
    try {
      const arr = JSON.parse(stripped);
      if (Array.isArray(arr)) serials = arr.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    } catch (_err) {
      serials = [];
    }
  }
  if (!serials.length) {
    const fromLine = [];
    const fromBody = [];
    text.split(/\r?\n/).forEach((line) => {
      const s = String(line || '').trim();
      if (!s) return;
      const low = s.toLowerCase();
      if (low.indexOf('# name:') === 0) {
        deckName = s.split(':').slice(1).join(':').trim();
        return;
      }
      if (low.indexOf('# serials:') === 0) {
        const found = s.match(/\bV\d{3}\b/ig) || [];
        found.forEach((tok) => fromLine.push(tok.toUpperCase()));
        return;
      }
      if (s.charAt(0) === '#') return;
      const tokens = s.match(/\bV\d{3}\b/ig) || [];
      const restLetters = s.replace(/V\d{3}/ig, '').replace(/[^A-Za-z]/g, '');
      if (tokens.length && restLetters.length < 3) {
        tokens.forEach((tok) => fromBody.push(tok.toUpperCase()));
        return;
      }
      let count = 1;
      let label = s;
      let forcedSerial = '';
      let m = s.match(/^(.+?)\s+(V\d{3})\s*[·•|]\s*(\d+)\b/i);
      if (m) {
        label = m[1];
        forcedSerial = m[2].toUpperCase();
        count = parseInt(m[3], 10) || 1;
      } else {
        m = s.match(/^(V\d{3})\s*[·•|]\s*(\d+)\b/i);
        if (m) {
          forcedSerial = m[1].toUpperCase();
          count = parseInt(m[2], 10) || 1;
          label = forcedSerial;
        } else {
          m = s.match(/^\s*(\d+)\s*[x×]\s*(.+?)\s*$/i);
          if (m) {
            count = parseInt(m[1], 10) || 1;
            label = m[2];
          } else {
            m = s.match(/^\s*(.+?)\s*[x×]\s*(\d+)\s*$/i);
            if (m) {
              label = m[1];
              count = parseInt(m[2], 10) || 1;
            } else {
              m = s.match(/^\s*(\d+)\s+(.+?)\s*$/);
              if (m) {
                count = parseInt(m[1], 10) || 1;
                label = m[2];
              }
            }
          }
        }
      }
      label = String(label || '').replace(/\s+/g, ' ').replace(/\s*\(V\d{3}\)\s*$/i, '').trim();
      const named = forcedSerial
        ? ddlCardById(forcedSerial)
        : (ddlCardByName(label) || (/^V\d{3}$/i.test(label) ? ddlCardById(label) : null));
      if (!named) {
        if (/^V\d{3}$/i.test(label)) fromBody.push(label.toUpperCase());
        else unknown.push(label || s);
        return;
      }
      const n = Math.max(1, Math.min(3, count | 0));
      for (let i = 0; i < n; i += 1) fromBody.push(named.id);
    });
    serials = fromLine.length ? fromLine : fromBody;
    if (fromLine.length) unknown.length = 0;
  }
  const out = [];
  const seen = {};
  const packReady = ddlCardsReady();
  serials.forEach((s) => {
    const key = String(s || '').trim().toUpperCase();
    if (!/^V\d{3}$/.test(key)) return;
    if (key === 'V029') {
      dropped.push(key);
      return;
    }
    if (packReady && !ddlCardById(key)) {
      unknown.push(key);
      return;
    }
    const n = seen[key] | 0;
    if (n >= 3) return;
    seen[key] = n + 1;
    out.push(key);
  });
  const counts = {};
  out.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
  return {
    ok: out.length > 0,
    serials: out,
    name: deckName,
    unknown,
    dropped,
    count: out.length,
    counts,
  };
}

/** Same text ddltcg.com/play writes, so anything we hand back pastes straight into their builder. */
function playDeckExportText(deck, playName) {
  const Cat = playCatalog();
  const pack = {
    name: deck && deck.name,
    playName: playName || (deck && deck.playName) || '',
    counts: (deck && deck.counts) || {},
    cardCount: deck && deck.cardCount,
    heroes: deck && deck.heroes,
  };
  if (Cat && typeof Cat.exportDeckText === 'function') return Cat.exportDeckText(pack);
  const counts = pack.counts || {};
  const serials = [];
  Object.keys(counts).sort().forEach((id) => {
    for (let i = 0; i < Math.min(3, Number(counts[id]) || 0); i += 1) serials.push(id);
  });
  const by = {};
  serials.forEach((id) => { by[id] = (by[id] || 0) + 1; });
  const lines = ['# DDL TCG', `# name: ${pack.name || 'Custom'}`, `# count: ${serials.length}/40`, ''];
  Object.keys(by)
    .sort((a, b) => {
      const na = (ddlCardById(a) && ddlCardById(a).name) || a;
      const nb = (ddlCardById(b) && ddlCardById(b).name) || b;
      return String(na).localeCompare(String(nb));
    })
    .forEach((id) => {
      const card = ddlCardById(id);
      lines.push(`${by[id]}× ${(card && card.name) || id}`);
    });
  lines.push('');
  lines.push(`# serials: ${serials.join(',')}`);
  return `${lines.join('\n')}\n`;
}

async function exportPlayDeck(deck, playName, action, btn) {
  if (!deck) return;
  const text = playDeckExportText(deck, playName);
  const Cat = playCatalog();
  const file = Cat && typeof Cat.deckFileName === 'function'
    ? Cat.deckFileName(playName || deck.playName, deck.name)
    : 'ddl-play-deck.txt';
  if (action === 'download') {
    if (Cat && typeof Cat.downloadText === 'function') Cat.downloadText(file, text);
    else {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
    return;
  }
  if (Cat && typeof Cat.copyText === 'function') {
    await Cat.copyText(text, btn);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    }
  } catch (_err) {
    window.prompt('Copy this list', text);
  }
}

const DECK_PASTE_PLACEHOLDER = '3× Blade\nGary V004 · 1 · Creature\nV015\nV015\nV015';

const PLAY_EXPORT_STEPS = `Export a 40 from the official builder, then paste it here. Hidden Play presets cannot be looked up.
  <a href="https://ddltcg.com/play" target="_blank" rel="noopener">ddltcg.com/play</a>
  · <a href="https://ddltcg.kushmetax.com/" target="_blank" rel="noopener">ddltcg.kushmetax.com</a>.
  Accepts Copy decklist, Copy serials (V-codes), Companion lines like <code>Gary V004 · 1 · Creature</code>, or <code>3× Blade</code>.`;

/** Read a pasted ddltcg.com export into a deck we can show, lock, and hand back unchanged. */
function parseDeckPaste(text) {
  const Cat = playCatalog();
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'Paste a builder export. Hidden Play decks cannot be looked up by Hero name.' };
  if (Cat && typeof Cat.load === 'function' && !ddlCardsReady()) {
    Cat.load().catch(() => {});
  }
  const parsed = Cat && typeof Cat.parsePlayList === 'function'
    ? Cat.parsePlayList(raw)
    : parsePlayListFallback(raw);
  if (!parsed || !parsed.count) {
    if (!ddlCardsReady() && !(parsed && parsed.serials && parsed.serials.length)) {
      return { ok: false, loading: true, error: 'Card catalog is still loading. Give it a second and try again.' };
    }
    return {
      ok: false,
      error: parsed && parsed.unknown && parsed.unknown.length
        ? `Could not read: ${parsed.unknown.slice(0, 4).join(', ')}`
        : 'That does not look like a DDL list. Export from the builder and paste. Name lookup will fail on hidden decks.',
    };
  }
  const deck = {
    name: parsed.name || 'Play list',
    counts: parsed.counts,
    serials: parsed.serials,
    cardCount: parsed.count,
    ready: parsed.count === 40,
  };
  if (parsed.count !== 40) {
    return { ok: false, deck, error: `That list is ${parsed.count}/40. Export a full 40 from the builder.` };
  }
  if (parsed.unknown.length) {
    return { ok: false, deck, error: `Could not read: ${parsed.unknown.slice(0, 4).join(', ')}` };
  }
  return { ok: true, deck, dropped: parsed.dropped || [] };
}

function deckPasteFieldHtml(prefix, opts) {
  const o = opts || {};
  return `<div class="play-deck-field" data-play-deck="${esc(prefix)}">
    ${classQuotaNoticeHtml(o.quota)}
    ${o.hideName ? '' : `<label for="${esc(prefix)}-name">DDL TCG in-game name <span class="muted">(optional)</span></label>
    <div class="play-deck-row">
      <div class="handle-typeahead play-name-typeahead">
        <input id="${esc(prefix)}-name" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="Hero name on Play" value="${esc(o.playName || '')}" minlength="3"
          aria-autocomplete="list" aria-controls="${esc(prefix)}-suggest" aria-expanded="false">
        <ul id="${esc(prefix)}-suggest" class="handle-suggest" hidden role="listbox"></ul>
      </div>
    </div>`}
    <label for="${esc(prefix)}-text">Deck list ${o.required ? '<span class="req">*</span>' : ''}</label>
    <textarea id="${esc(prefix)}-text" class="deck-paste" data-deck-text rows="6" spellcheck="false"
      autocomplete="off" placeholder="${esc(DECK_PASTE_PLACEHOLDER)}"></textarea>
    <p class="hint">${PLAY_EXPORT_STEPS}</p>
    <div class="row wrap">
      <button type="button" class="btn ghost" data-check-deck>Check list</button>
    </div>
    <div class="play-deck-picked" data-deck-picked hidden></div>
    <p class="err play-deck-err" hidden></p>
  </div>`;
}

function bindDeckPasteField(rootEl, opts) {
  const box = rootEl && rootEl.querySelector('[data-play-deck]');
  if (!box) return { get: () => ({ playName: '', deckText: '', deck: null }), check: () => null };
  const o = opts || {};
  const nameEl = box.querySelector('input[id$="-name"]');
  const textEl = box.querySelector('[data-deck-text]');
  const pickedEl = box.querySelector('[data-deck-picked]');
  const errEl = box.querySelector('.play-deck-err');
  const rule = classQuotaOf({ deckClassQuota: o.quota });
  let deck = null;
  bindPlayNameTypeahead(nameEl, box.querySelector('.handle-suggest'));

  const showError = (message) => {
    if (!errEl) throw new Error(message);
    errEl.hidden = false;
    errEl.textContent = message;
  };
  const clearError = () => {
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  };
  const showDeck = (next, note) => {
    deck = next;
    if (!pickedEl) return;
    if (!next) {
      pickedEl.hidden = true;
      pickedEl.innerHTML = '';
      return;
    }
    pickedEl.hidden = false;
    pickedEl.innerHTML = `${registeredDeckSummaryHtml(next)} ${classMixPillHtml(next, rule)}
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}
      ${deckLinesHtml(next)}`;
    if (typeof o.onPick === 'function') o.onPick(next);
  };

  const check = () => {
    clearError();
    const result = parseDeckPaste(textEl && textEl.value);
    if (!result.ok && result.loading) {
      const Cat = playCatalog();
      if (Cat && typeof Cat.load === 'function' && !box._catalogRetry) {
        box._catalogRetry = true;
        showError(result.error);
        Cat.load().then(() => {
          box._catalogRetry = false;
          check();
        }).catch(() => {
          box._catalogRetry = false;
          showError('Card catalog failed to load. Refresh the page.');
        });
        return null;
      }
    }
    if (!result.ok) {
      showDeck(result.deck || null);
      showError(result.error);
      return null;
    }
    const mix = evaluateDeckQuota(result.deck.counts, rule);
    const note = result.dropped.length
      ? `${result.dropped.length} card${result.dropped.length === 1 ? '' : 's'} are out of play and were dropped.`
      : '';
    showDeck(result.deck, note);
    if (mix.required && !mix.ok) {
      showError(mix.message);
      return null;
    }
    return result.deck;
  };

  const checkBtn = box.querySelector('[data-check-deck]');
  if (checkBtn) checkBtn.onclick = (event) => { event.preventDefault(); check(); };
  if (textEl) {
    textEl.addEventListener('input', () => {
      clearError();
      showDeck(null);
    });
    textEl.addEventListener('paste', () => { window.setTimeout(check, 0); });
  }

  return {
    check,
    get() {
      return {
        playName: nameEl ? String(nameEl.value || '').trim() : '',
        deckText: textEl ? String(textEl.value || '').trim() : '',
        deck,
      };
    },
  };
}

function deckChipHtml(entry) {
  const deck = entry && entry.registeredDeck;
  if (!deck || !deck.name) return '';
  return `<button type="button" class="chip deck-chip" data-view-deck="${entry.id}">${esc(deck.name)} · ${Number(deck.cardCount) || 0}/40</button>`;
}

function openLockedDeckModal(entry) {
  const deck = entry && entry.registeredDeck;
  if (!deck) return;
  const overlay = openModal(`
    <h2>${esc(deck.name || 'Registered deck')}</h2>
    <p class="muted">${esc(entry.handle)} · locked from ${esc(deck.playName || 'Play')}${deck.lockedAt ? ` · ${esc(new Date(deck.lockedAt).toLocaleString())}` : ''}</p>
    ${deckLinesHtml(deck)}
    <div class="row wrap">
      <button type="button" class="btn ghost" id="deck-copy">Copy list</button>
      <button type="button" class="btn ghost" id="deck-download">Download .txt</button>
      <button type="button" class="btn ghost" id="deck-close">Close</button>
    </div>`);
  overlay.querySelector('.scorecard').classList.add('deck-sheet');
  overlay.querySelector('#deck-close').onclick = () => overlay.remove();
  overlay.querySelector('#deck-copy').onclick = (event) => {
    exportPlayDeck(deck, deck.playName || entry.playName, 'copy', event.currentTarget);
  };
  overlay.querySelector('#deck-download').onclick = (event) => {
    exportPlayDeck(deck, deck.playName || entry.playName, 'download', event.currentTarget);
  };
}

/** Ask for one pasted ddltcg.com export and hand back `{ playName, deckText, deck }`. */
function openDeckPasteModal(opts) {
  const o = opts || {};
  const overlay = openModal(`
    <h2>${esc(o.title || 'Lock a deck list')}</h2>
    <p class="muted">${o.subtitle ? `${esc(o.subtitle)} ` : ''}${PLAY_EXPORT_STEPS}</p>
    ${deckPasteFieldHtml('modal-deck', { required: true, quota: o.quota, playName: o.playName })}
    <div class="row wrap">
      <button type="button" class="btn" data-confirm>Lock this list</button>
      <button type="button" class="btn ghost" data-cancel>Cancel</button>
    </div>`);
  overlay.querySelector('.scorecard').classList.add('deck-sheet');
  const field = bindDeckPasteField(overlay, { quota: o.quota });
  return new Promise((resolve) => {
    const finish = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-cancel]').onclick = () => finish(null);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.querySelector('[data-confirm]').onclick = () => {
      if (!field.check()) return;
      finish(field.get());
    };
  });
}

function bindPlayNameTypeahead(input, listEl) {
  if (!input || !listEl) return;
  let items = [];
  let seq = 0;
  let timer = 0;
  const hide = () => {
    listEl.hidden = true;
    listEl.innerHTML = '';
    items = [];
    input.setAttribute('aria-expanded', 'false');
  };
  const paintList = () => {
    if (!items.length) { hide(); return; }
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    listEl.innerHTML = items.map((row, i) => {
      const name = row.username || row.callsign;
      return `<li role="option"><strong>${esc(name)}</strong>${row.callsign && row.callsign !== name ? `<small>${esc(row.callsign)}</small>` : ''}</li>`;
    }).join('');
    listEl.querySelectorAll('li').forEach((li, i) => {
      li.onmousedown = (event) => {
        event.preventDefault();
        input.value = items[i].username || items[i].callsign;
        hide();
      };
    });
  };
  const run = async (query) => {
    const id = ++seq;
    const q = String(query || '').trim();
    if (q.length < 2) { hide(); return; }
    try {
      const pack = await api.get(`/play/search?q=${encodeURIComponent(q)}`);
      if (id !== seq) return;
      items = pack.items || [];
      if (!items.length) {
        listEl.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        listEl.innerHTML = `<li class="muted">Decks are hidden — export from the builder and paste.</li>`;
        return;
      }
      paintList();
    } catch (_err) {
      if (id !== seq) return;
      hide();
    }
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(input.value), 180);
  });
}

function standingBadgeHtml(place, size) {
  const spec = standingSpec(place);
  if (!spec) return '';
  return medalHtml(spec, size);
}

function entryMarksHtml(entry, size) {
  if (!entry) return '';
  return medalsInlineHtml(badgesFor(entry.handle, entry.badges), size);
}

function classPickMarkHtml(item) {
  if (item && item.file) return medalHtml(item, 'md');
  if (item && item.id === 'Split') return '<span class="class-mark split" aria-hidden="true"><i></i><i></i></span>';
  return '<span class="class-mark undeclared" aria-hidden="true"></span>';
}

function classPickerHtml(name, selected) {
  const parsed = parseDdlClass(selected);
  const currentId = parsed.kind === 'split' || parsed.ids.length > 1
    ? 'Split'
    : (parsed.kind === 'hero' ? parsed.stored : DDL_DEFAULT_CLASS);
  const options = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.REGISTRATION)
    || [{ id: 'Undeclared', title: 'Undeclared' }].concat(DDL_CLASS_IDS.map((id) => ({ id, title: id, icon: `class-${id.toLowerCase()}` }))).concat([{ id: 'Split', title: 'Split' }]);
  const heroes = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.CLASSES)
    || DDL_CLASS_IDS.map((id) => ({ id, title: id }));
  const splitA = parsed.ids[0] || (heroes[0] && heroes[0].id) || 'Crown';
  const splitB = parsed.ids[1] || (heroes[1] && heroes[1].id) || 'Bow';
  const heroOptions = (picked) => heroes.map((h) => `<option value="${esc(h.id)}" ${h.id === picked ? 'selected' : ''}>${esc(h.title || h.id)}</option>`).join('');
  return `<div class="class-field">
    <div class="class-pick" role="radiogroup" aria-label="Class">
      ${options.map((c) => `
        <label class="class-pick-opt ${currentId === c.id ? 'on' : ''}" title="${esc(c.blurb || c.title || c.id)}">
          <input type="radio" name="${esc(name)}" value="${esc(c.id)}" ${currentId === c.id ? 'checked' : ''}>
          ${classPickMarkHtml(c)}
          <span>${esc(c.title || c.id)}</span>
        </label>`).join('')}
    </div>
    <div class="split-pick" ${currentId === 'Split' ? '' : 'hidden'}>
      <span class="lbl">Split of</span>
      <div class="split-pick-row">
        <select name="${esc(name)}-a" aria-label="First class">${heroOptions(splitA)}</select>
        <span class="split-amp">/</span>
        <select name="${esc(name)}-b" aria-label="Second class">${heroOptions(splitB)}</select>
      </div>
    </div>
    <p class="hint">Listed on the roster only. Class medals are earned by a podium finish, not by signing up.</p>
  </div>`;
}

function bindClassPicker(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('.class-pick').forEach((group) => {
    const field = group.closest('.class-field') || group.parentElement;
    const splitBox = field && field.querySelector('.split-pick');
    const sync = () => {
      group.querySelectorAll('.class-pick-opt').forEach((opt) => {
        const input = opt.querySelector('input');
        opt.classList.toggle('on', Boolean(input && input.checked));
      });
      const picked = group.querySelector('input:checked');
      if (splitBox) splitBox.hidden = !picked || picked.value !== 'Split';
    };
    group.addEventListener('change', sync);
    sync();
  });
}

function readClassPick(rootEl, name) {
  const picked = rootEl && rootEl.querySelector(`input[name="${name}"]:checked`);
  const value = (picked && picked.value) || DDL_DEFAULT_CLASS;
  if (value !== 'Split') {
    return (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.normalizeClass(value)) || value;
  }
  const a = rootEl.querySelector(`[name="${name}-a"]`);
  const b = rootEl.querySelector(`[name="${name}-b"]`);
  const stored = `${(a && a.value) || 'Crown'}/${(b && b.value) || 'Bow'}`;
  return (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.normalizeClass(stored)) || stored;
}

function marksGalleryHtml() {
  if (typeof DDL_BADGES === 'undefined') return '';
  const standings = DDL_BADGES.STANDINGS.map((b) => `
    <figure class="mark-tile">
      ${medalHtml(b, 'lg')}
      <figcaption><strong>${esc(b.ribbon)}</strong><span>${esc(b.kicker)}</span></figcaption>
    </figure>`).join('');
  const classes = DDL_BADGES.CLASSES.map((b) => `
    <figure class="mark-tile">
      ${medalHtml(b, 'lg')}
      <figcaption><strong>${esc(b.title)}</strong><span>Class</span></figcaption>
    </figure>`).join('');
  return `<section class="marks-gallery">
    <h2 class="section-title">Standings badges</h2>
    <p class="muted">Official tournament finishes pin these on a handle. 1st through 5th land when a field of 3+ closes. Duels do not pin standing badges.</p>
    <div class="mark-grid standing">${standings}</div>
    <h2 class="section-title">Class badges</h2>
    <p class="muted">These marks are for people who podium with a class. Registering a deck does not pin one on your handle.</p>
    <div class="mark-grid classes">${classes}</div>
  </section>`;
}

function prestigeStarSvg() {
  return `<svg class="prestige-star" viewBox="0 0 24 24" aria-hidden="true"><path d="${starPoly(12, 12, 11, 4.2, 8)}" fill="currentColor"/></svg>`;
}

function championCrestSvg() {
  const spec = standingSpec(1);
  if (spec) {
    return `<span class="champ-crest art">${medalHtml(spec, 'lg')}</span>`;
  }
  const uid = `cr${++medalSeq}`;
  return `<svg class="champ-crest" viewBox="0 0 96 96" aria-hidden="true">
    <defs>
      <linearGradient id="${uid}-m" x1="18" y1="8" x2="78" y2="88" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff6d2"/><stop offset=".22" stop-color="#f0c45a"/><stop offset=".55" stop-color="#8a5810"/><stop offset="1" stop-color="#f0c45a"/>
      </linearGradient>
      <radialGradient id="${uid}-e" cx="38%" cy="30%" r="70%">
        <stop offset="0" stop-color="#3a180c"/><stop offset="1" stop-color="#120804"/>
      </radialGradient>
    </defs>
    <path d="${starPoly(48, 48, 47, 39.5, 16)}" fill="url(#${uid}-m)"/>
    <circle cx="48" cy="48" r="37" fill="url(#${uid}-m)"/>
    <circle cx="48" cy="48" r="31" fill="url(#${uid}-e)"/>
    <circle cx="48" cy="48" r="28.5" fill="none" stroke="#f0c45a" stroke-width="1.2" opacity=".7"/>
    <path d="M48 22c7 10 12 16 12 26a12 12 0 1 1-24 0c0-10 5-16 12-26z" fill="url(#${uid}-m)"/>
    <path d="M48 36c3.2 4.4 5 7.2 5 11.2A5 5 0 1 1 43 47.2C43 43.2 44.8 40.4 48 36z" fill="#1a0c04" opacity=".45"/>
    <path d="M48 18.5v8M44.5 21h7" fill="none" stroke="#fff6d2" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

function formatRecord(value) {
  const text = String(value || '').trim();
  return text ? text.replace(/-/g, '–') : '';
}

function matchRecordHtml(value) {
  const text = formatRecord(value);
  if (!text) return '';
  return `<p class="match-record"><span>Record</span><strong>${esc(text)}</strong></p>`;
}

function podiumPersonHtml(person) {
  if (!person || !person.handle) return '<strong class="muted">—</strong>';
  return `<div class="podium-person">
    <strong>${playerLink(person.handle)}</strong>
    ${matchRecordHtml(person.record)}
  </div>`;
}

function duelResultHtml(podium, rewards) {
  const first = podium.first;
  const second = podium.second;
  const prize = (n) => {
    const text = prizeForPlace(rewards, n);
    return text ? `<p class="prize-won">${esc(text)}</p>` : '';
  };
  const side = (person, tone, kicker, n) => `<article class="duel-side ${tone}">
    <p class="rank-kicker">${kicker}</p>
    ${podiumPersonHtml(person)}
    ${prize(n)}
  </article>`;
  return `<section class="duel-result" ${tip('1v1 result. Winner and runner-up — no third place.')}>
    ${side(first, 'gold', 'Winner', 1)}
    <div class="duel-vs" aria-hidden="true">vs</div>
    ${second && second.handle ? side(second, 'silver', 'Runner-up', 2) : '<article class="duel-side muted-side"><p class="muted">Waiting on result</p></article>'}
  </section>`;
}

function tournamentPodiumHtml(podium, rewards) {
  const first = podium.first;
  const second = podium.second;
  const thirds = Array.isArray(podium.third) ? podium.third.filter((p) => p && p.handle) : [];
  const prize = (n) => {
    const text = prizeForPlace(rewards, n);
    return text ? `<p class="prize-won">${esc(text)}</p>` : '';
  };
  const card = (tone, kicker, rank, inner, n) => `<article class="place ${tone}">
    ${standingBadgeHtml(n, 'md')}
    <p class="rank-kicker">${kicker}</p>
    <p class="rank">${rank}</p>
    ${inner}
    ${prize(n)}
  </article>`;
  const gold = card('gold', 'Champion', '1st', podiumPersonHtml(first), 1);
  if (!second && !thirds.length) {
    return `<section class="podium prestige has-1" ${tip('Final results.')}>${gold}</section>`;
  }
  const silver = second && second.handle
    ? card('silver', 'Runner-up', '2nd', podiumPersonHtml(second), 2)
    : '';
  const bronze = thirds.length
    ? card('copper', thirds.length > 1 ? 'Tied 3rd' : 'Bronze', '3rd', thirds.map(podiumPersonHtml).join(''), 3)
    : '';
  const count = 1 + (silver ? 1 : 0) + (bronze ? 1 : 0);
  return `<section class="podium prestige has-${count}" ${tip('Final results. 3rd place uses the placement match when that option is on.')}>
    ${silver}${gold}${bronze}
  </section>`;
}

function prestigePodiumHtml(podium, rewards, t, confirmedCount) {
  if (!podium || !podium.first || !podium.first.handle) return '';
  if (isDuelArena(t, confirmedCount)) return duelResultHtml(podium, rewards);
  return tournamentPodiumHtml(podium, rewards);
}

function arenaCardHref(event) {
  if (!event || event.manual || Number(event.tournamentId) < 0 || String(event.slug || '').startsWith('manual-')) return '';
  return arenaHref(event.slug);
}

const STATUS_LABEL = {
  registration: 'Registration',
  check_in: 'Check-in',
  in_progress: 'Live',
  live: 'Live',
  complete: 'Complete',
  completed: 'Complete',
  pending: 'Unpaid',
  confirmed: 'Paid',
  no_show: 'No-show',
  ready: 'Ready',
  complete_match: 'Done',
  bye: 'Bye',
};

const PAY_TO = {
  DOGE: 'D92759tetUUkf6Hn6Gk9mVKZqST32fN9iT',
  USDC_SOL: '3tNZfWyvPBhx6KsaTuCBoChajrK7fbLME2eC4mKwrWgW',
};
const DOGE_ADDRESS_RE = /^D[1-9A-HJ-NP-Za-km-z]{25,39}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function sanitizeDogeAddressInput(value) {
  const addr = String(value || '').trim();
  return DOGE_ADDRESS_RE.test(addr) ? addr : '';
}
function sanitizeSolanaAddressInput(value) {
  const addr = String(value || '').trim();
  if (!SOLANA_ADDRESS_RE.test(addr)) return '';
  if (DOGE_ADDRESS_RE.test(addr)) return '';
  if (addr === USDC_SOL_MINT) return '';
  return addr;
}
function sanitizeXHandleInput(value) {
  const raw = String(value || '').trim().replace(/^@+/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(raw) ? raw : '';
}
function xHandleOf(t) {
  return sanitizeXHandleInput(t && t.xHandle);
}
function acceptsDoge(t) {
  return !t || t.acceptDoge !== false;
}
function acceptsXmoney(t) {
  return Boolean(xHandleOf(t));
}
function solanaTreasuryOf(t, payTo) {
  return sanitizeSolanaAddressInput((payTo && payTo.USDC_SOL) || (t && t.solanaTreasury))
    || (t && t.acceptUsdcSol ? PAY_TO.USDC_SOL : '');
}
function acceptsUsdcSol(t, payTo) {
  return Boolean(t && t.acceptUsdcSol) && Boolean(solanaTreasuryOf(t, payTo));
}
function xmoneyHref(handle) {
  const x = sanitizeXHandleInput(handle);
  return x ? `https://xmoney.to/?to=${encodeURIComponent(x)}` : 'https://xmoney.to/';
}
function phantomUsdcHref(address, usd) {
  const addr = sanitizeSolanaAddressInput(address);
  if (!addr) return '';
  const q = new URLSearchParams({ recipient: addr, splToken: USDC_SOL_MINT });
  if (Number(usd) > 0) q.set('amount', String(Number(usd)));
  return `https://phantom.app/ul/v1/transfer?${q}`;
}
function solscanAccountHref(address) {
  const addr = sanitizeSolanaAddressInput(address);
  return addr ? `https://solscan.io/account/${encodeURIComponent(addr)}` : 'https://solscan.io/';
}
function isHostConfirmPay(asset) {
  return asset === 'XMONEY' || asset === 'USDC_SOL';
}
function enabledPayRails(t, payTo) {
  const rails = [];
  if (acceptsDoge(t)) rails.push('DOGE');
  if (acceptsUsdcSol(t, payTo)) rails.push('USDC_SOL');
  if (acceptsXmoney(t)) rails.push('XMONEY');
  return rails;
}
function defaultPayRail(t, payTo) {
  return enabledPayRails(t, payTo)[0] || 'DOGE';
}

function unpaidPayHint(entry, t) {
  if (!entry || entry.paid) return 'You are on the roster.';
  if (entry.payAsset === 'XMONEY' || (!acceptsDoge(t) && !acceptsUsdcSol(t) && acceptsXmoney(t))) {
    const hostX = xHandleOf(t) || String(entry.payTo || '').replace(/^@/, '');
    const from = entry.xPayerHandle ? `@${entry.xPayerHandle}` : 'your X @handle';
    return `Send ${formatUsd(entry.amountUsd || feeUsd(t))} to @${hostX} on XMoney from ${from}. The host marks PAID when they see it.`;
  }
  if (entry.payAsset === 'USDC_SOL' || (!acceptsDoge(t) && acceptsUsdcSol(t))) {
    const dest = sanitizeSolanaAddressInput(entry.payTo) || solanaTreasuryOf(t);
    return `Send ${formatUsd(entry.amountUsd || feeUsd(t))} USDC on Solana to ${dest}. The host marks PAID when they see it.`;
  }
  return 'Send the quoted DOGE. The host marks PAID after the chain confirms.';
}
const K9SWAP_URL = 'https://k9swap.com';

const BEST_OF = [1, 3, 5];
const GAMES = ['Doginal Dogs Legends TCG', 'Doginal Dogs', 'Other'];
const TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { id: 'America/Halifax', label: 'Atlantic (AST/ADT)' },
  { id: 'America/Chicago', label: 'Central (CST/CDT)' },
  { id: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Europe/London', label: 'UK (GMT/BST)' },
];

const TIPS_KEY = 'ddl-tips-mode';
let tipsOn = localStorage.getItem(TIPS_KEY) !== '0';
let tipTarget = null;
let lastPointer = 'mouse';

function setTreeMode(on) {
  const active = Boolean(on);
  document.body.classList.toggle('has-tree', active);
  document.documentElement.classList.toggle('has-tree', active);
  if (!active) setBracketFs(false);
}

const KICK_MIN_KEY = 'ddl-kick-min';
let kickWantAudio = false;
let kickStreamMin = localStorage.getItem(KICK_MIN_KEY) === '1';

function kickLinkOf(raw) {
  if (typeof KickUrl === 'undefined' || typeof KickUrl.parseKickMedia !== 'function') {
    return { href: '', kind: '', channel: '', label: '' };
  }
  return KickUrl.parseKickMedia(raw) || { href: '', kind: '', channel: '', label: '' };
}

function kickWatchUrl(channel) {
  return `https://kick.com/${encodeURIComponent(channel)}`;
}

function kickPlayerSrc(channel, withAudio) {
  const params = new URLSearchParams({
    autoplay: 'true',
    muted: withAudio ? 'false' : 'true',
  });
  return `https://player.kick.com/${encodeURIComponent(channel)}?${params}`;
}

function hideKickStream() {
  const dock = document.getElementById('kick-stream');
  if (!dock) return;
  const frame = dock.querySelector('iframe');
  if (frame) frame.src = 'about:blank';
  dock.hidden = true;
  dock.classList.remove('is-min');
  document.body.classList.remove('has-kick-stream');
}

function ensureKickStreamDock() {
  let dock = document.getElementById('kick-stream');
  if (dock) return dock;
  dock = document.createElement('aside');
  dock.id = 'kick-stream';
  dock.className = 'kick-stream';
  dock.hidden = true;
  const main = document.getElementById('app');
  if (main && main.parentNode) main.parentNode.insertBefore(dock, main);
  else document.body.appendChild(dock);
  return dock;
}

function bindKickStreamDock(dock, channel) {
  const audioBtn = dock.querySelector('#kick-audio');
  const toggleBtn = dock.querySelector('#kick-toggle');
  const chatBtn = dock.querySelector('#kick-chat');
  const frame = dock.querySelector('iframe');
  if (audioBtn) {
    audioBtn.onclick = () => {
      kickWantAudio = true;
      if (frame) {
        frame.src = kickPlayerSrc(channel, true);
        frame.title = `Kick livestream — ${channel} (audio on)`;
      }
      audioBtn.hidden = true;
    };
  }
  if (chatBtn) {
    chatBtn.onclick = () => {
      chatUnread = 0;
      if (chatWide()) setChatMin(false);
      else {
        chatMin = false;
        chatSheetOpen = true;
        applyChatChrome();
      }
    };
  }
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      kickStreamMin = !kickStreamMin;
      localStorage.setItem(KICK_MIN_KEY, kickStreamMin ? '1' : '0');
      dock.classList.toggle('is-min', kickStreamMin);
      toggleBtn.textContent = kickStreamMin ? 'Show player' : 'Hide player';
      toggleBtn.setAttribute('aria-expanded', kickStreamMin ? 'false' : 'true');
    };
  }
}

function syncKickStream(t) {
  const kick = kickLinkOf(t && t.streamUrl);
  const live = t && t.status === 'in_progress' && kick.kind === 'live' && kick.channel;
  if (!live) {
    hideKickStream();
    return;
  }
  const channel = kick.channel;
  const dock = ensureKickStreamDock();
  const nextSrc = kickPlayerSrc(channel, kickWantAudio);
  const frame = dock.querySelector('iframe');
  const sameChannel = frame && frame.getAttribute('data-channel') === channel.toLowerCase();
  if (sameChannel && !dock.hidden) {
    dock.classList.toggle('is-min', kickStreamMin);
    document.body.classList.add('has-kick-stream');
    const audioBtn = dock.querySelector('#kick-audio');
    if (audioBtn) audioBtn.hidden = kickWantAudio;
    const open = dock.querySelector('#kick-open');
    if (open) open.href = kick.href || kickWatchUrl(channel);
    return;
  }
  dock.hidden = false;
  dock.classList.toggle('is-min', kickStreamMin);
  document.body.classList.add('has-kick-stream');
  dock.innerHTML = `<div class="kick-stream-bar">
      <span class="kick-live">Live</span>
      <strong>${esc(kick.label || `kick.com/${channel}`)}</strong>
      <div class="kick-stream-acts">
        <button type="button" class="btn" id="kick-audio" ${kickWantAudio ? 'hidden' : ''} ${tip('Play the stream here with sound. Browsers start muted until you ask for audio.')}>Watch with audio</button>
        <a class="btn ghost" id="kick-open" href="${esc(kick.href || kickWatchUrl(channel))}" target="_blank" rel="noopener noreferrer" ${tip('Opens the Kick channel in a new tab.')}>Open on Kick</a>
        <button type="button" class="btn ghost" id="kick-chat" ${tip('Talk with other viewers on this bracket while the stream plays.')}>Chat</button>
        <button type="button" class="btn ghost" id="kick-toggle" aria-expanded="${kickStreamMin ? 'false' : 'true'}">${kickStreamMin ? 'Show player' : 'Hide player'}</button>
      </div>
    </div>
    <div class="kick-stream-stage">
      <iframe data-channel="${esc(channel.toLowerCase())}" src="${esc(nextSrc)}" title="Kick livestream — ${esc(channel)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen scrolling="no" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>`;
  bindKickStreamDock(dock, channel);
}

function kickReplayHtml(t) {
  const kick = kickLinkOf(t && t.streamUrl);
  if (!kick.href) return '';
  if (t.status === 'registration') return '';
  if (t.status === 'in_progress' && kick.kind === 'live') return '';
  const badge = kick.kind === 'clip' ? 'Clip' : kick.kind === 'vod' ? 'Replay' : 'Stream';
  const action = kick.kind === 'live' ? 'Open on Kick' : 'Watch on Kick';
  const hint = kick.kind === 'live'
    ? 'Opens the Kick channel this tournament was streamed on.'
    : 'Opens the Kick recording of this tournament.';
  return `<aside class="kick-replay">
    <span class="kick-vod">${badge}</span>
    <strong>${esc(kick.label)}</strong>
    <a class="btn" href="${esc(kick.href)}" target="_blank" rel="noopener noreferrer" ${tip(hint)}>${action}</a>
  </aside>`;
}

function arenaStreamLinkHtml(t) {
  if (!t || t.status !== 'completed') return '';
  const kick = kickLinkOf(t.streamUrl);
  if (!kick.href) return '';
  return `<p class="muted">${kick.kind === 'live' ? 'Stream saved on this bracket' : 'Replay saved on this bracket'}</p>`;
}

const CHAT_MIN_KEY = 'ddl-chat-min';
const CHAT_VIEWER_KEY = 'ddl-chat-viewer';
const CHAT_POLL_MS = 2500;
const CHAT_HIDDEN_MS = 8000;
let chatMin = localStorage.getItem(CHAT_MIN_KEY) === '1';
let chatSheetOpen = false;
let chatTimer = 0;
let chatSlug = '';
let chatRev = 0;
let chatLastId = 0;
let chatUnread = 0;
let chatPinned = true;
let chatBusy = false;
let chatCanPost = null;
let chatSignedIn = null;

function chatViewerToken() {
  try {
    let id = sessionStorage.getItem(CHAT_VIEWER_KEY);
    if (!id || !/^[a-zA-Z0-9_-]{4,24}$/.test(id)) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(CHAT_VIEWER_KEY, id);
    }
    return id;
  } catch (_err) {
    return 'anon';
  }
}

function chatWide() {
  return window.matchMedia && window.matchMedia('(min-width: 960px)').matches;
}

function chatVisible() {
  if (chatMin) return false;
  if (chatWide()) return true;
  return chatSheetOpen;
}

function stopArenaChatPoll() {
  window.clearTimeout(chatTimer);
  chatTimer = 0;
}

function hideArenaChat() {
  stopArenaChatPoll();
  chatSlug = '';
  chatRev = 0;
  chatLastId = 0;
  chatUnread = 0;
  chatSheetOpen = false;
  chatBusy = false;
  chatCanPost = null;
  chatSignedIn = null;
  const dock = document.getElementById('arena-chat');
  if (dock) {
    dock.hidden = true;
    dock.innerHTML = '';
  }
  const fab = document.getElementById('chat-fab');
  if (fab) fab.hidden = true;
  document.body.classList.remove('has-arena-chat', 'chat-min', 'chat-open');
}

function setChatMin(on) {
  chatMin = Boolean(on);
  try { localStorage.setItem(CHAT_MIN_KEY, chatMin ? '1' : '0'); } catch (_err) {}
  if (chatMin) chatSheetOpen = false;
  else if (!chatWide()) chatSheetOpen = true;
  applyChatChrome();
}

function applyChatChrome() {
  const dock = document.getElementById('arena-chat');
  const fab = document.getElementById('chat-fab');
  const open = Boolean(chatSlug) && chatVisible();
  document.body.classList.toggle('has-arena-chat', Boolean(chatSlug));
  document.body.classList.toggle('chat-min', Boolean(chatSlug) && chatMin);
  document.body.classList.toggle('chat-open', Boolean(chatSlug) && chatSheetOpen && !chatWide());
  if (dock) dock.hidden = !open;
  if (fab) {
    const showFab = Boolean(chatSlug) && (!chatWide() || chatMin) && !open;
    fab.hidden = !showFab;
    fab.classList.toggle('has-unread', chatUnread > 0);
    fab.textContent = chatUnread > 0 ? `Chat (${chatUnread > 9 ? '9+' : chatUnread})` : 'Chat';
  }
  const toggle = dock && dock.querySelector('#chat-toggle');
  if (toggle) {
    toggle.textContent = chatWide() ? 'Hide' : 'Close';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  const count = dock && dock.querySelector('#chat-unread');
  if (count) {
    count.hidden = !(chatUnread > 0);
    count.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
  }
}

function chatTimeLabel(iso) {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return '';
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (_err) {
    return '';
  }
}

function chatRoleLabel(role) {
  if (role === 'host') return 'Host';
  if (role === 'player') return 'Player';
  return '';
}

function chatRowHtml(msg, viewerId, canModerate) {
  const mine = viewerId && Number(msg.userId) === Number(viewerId);
  const canDrop = Boolean(canModerate || mine);
  const role = chatRoleLabel(msg.role);
  const href = msg.handle ? `/tourney/#/player/${encodeURIComponent(msg.handle)}` : '';
  const who = href
    ? `<a class="arena-chat-name" href="${esc(href)}">${esc(msg.handle)}</a>`
    : `<span class="arena-chat-name">${esc(msg.handle || 'Player')}</span>`;
  const avatar = pfpHtml({ avatarUrl: msg.avatarUrl }, msg.handle, 22);
  return `<article class="arena-chat-row ${mine ? 'is-mine' : ''}" data-chat-id="${Number(msg.id)}">
    ${avatar}
    <div class="arena-chat-body">
      <header>
        ${who}
        ${role ? `<span class="arena-chat-role">${esc(role)}</span>` : ''}
        <time>${esc(chatTimeLabel(msg.createdAt))}</time>
        ${canDrop ? `<button type="button" class="arena-chat-del" data-chat-del="${Number(msg.id)}" aria-label="Remove message">×</button>` : ''}
      </header>
      <p>${esc(msg.body)}</p>
    </div>
  </article>`;
}

function chatComposeHtml(pack) {
  if (pack && pack.canPost) {
    return `<form id="chat-form" class="arena-chat-compose">
      <input id="chat-input" maxlength="280" autocomplete="off" placeholder="Message the arena…" aria-label="Arena chat message">
      <button class="btn" type="submit">Send</button>
    </form>
    <p class="arena-chat-hint" id="chat-err" hidden></p>`;
  }
  const label = pack && pack.signedIn
    ? 'Set a tourney handle on your account to chat.'
    : 'Sign in with Discord to chat.';
  const action = pack && pack.signedIn
    ? `<a class="btn ghost" href="/tourney/#/records">Set handle</a>`
    : `<a class="btn" href="${esc(discordStartHref())}">Sign in with Discord</a>`;
  return `<div class="arena-chat-compose is-locked">
    <p>${esc(label)}</p>
    ${action}
  </div>`;
}

function renderChatDock(pack) {
  const dock = document.getElementById('arena-chat');
  if (!dock) return;
  const watching = Number(pack && pack.watching) || 0;
  const watchLabel = watching > 0 ? `${watching} watching` : 'Live chat';
  dock.innerHTML = `<div class="arena-chat-bar">
      <strong>Arena chat</strong>
      <span class="arena-chat-watch" id="chat-watching">${esc(watchLabel)}</span>
      <span class="arena-chat-unread" id="chat-unread" hidden>0</span>
      <button type="button" class="btn ghost" id="chat-toggle">Hide</button>
    </div>
    <div class="arena-chat-log" id="chat-log" role="log" aria-live="polite"></div>
    <div id="chat-compose">${chatComposeHtml(pack)}</div>`;
  bindChatDock(dock);
}

function bindChatDock(dock) {
  const toggle = dock.querySelector('#chat-toggle');
  if (toggle) {
    toggle.onclick = () => {
      if (chatWide()) setChatMin(true);
      else {
        chatSheetOpen = false;
        applyChatChrome();
      }
    };
  }
  const log = dock.querySelector('#chat-log');
  if (log) {
    log.onscroll = () => {
      const gap = log.scrollHeight - log.scrollTop - log.clientHeight;
      chatPinned = gap < 36;
      if (chatPinned) {
        chatUnread = 0;
        applyChatChrome();
      }
    };
  }
  bindChatCompose(dock);
}

function bindChatCompose(dock) {
  const form = dock.querySelector('#chat-form');
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const input = dock.querySelector('#chat-input');
    const errEl = dock.querySelector('#chat-err');
    const body = String((input && input.value) || '').trim();
    if (!body || chatBusy || !chatSlug) return;
    chatBusy = true;
    if (errEl) errEl.hidden = true;
    try {
      const pack = await api.post(`/arenas/${encodeURIComponent(chatSlug)}/chat`, { body });
      if (input) input.value = '';
      applyChatPack(pack, true);
    } catch (err) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = err.message || 'Could not send.';
      }
    } finally {
      chatBusy = false;
      if (input) input.focus();
    }
  };
  dock.querySelectorAll('[data-chat-del]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute('data-chat-del'));
      if (!id || !chatSlug) return;
      try {
        const pack = await api.post(`/arenas/${encodeURIComponent(chatSlug)}/chat/delete`, { id });
        applyChatPack(pack, true);
      } catch (err) {
        window.alert(err.message);
      }
    };
  });
}

function paintChatMessages(pack, forceBottom) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const messages = (pack && pack.messages) || [];
  const viewerId = pack && pack.viewerId;
  const canModerate = Boolean(pack && pack.canModerate);
  const atBottom = chatPinned || forceBottom;
  log.innerHTML = messages.length
    ? messages.map((msg) => chatRowHtml(msg, viewerId, canModerate)).join('')
    : `<p class="arena-chat-empty">No messages yet. Say hi while the bracket is up.</p>`;
  bindChatCompose(document.getElementById('arena-chat'));
  if (atBottom) {
    log.scrollTop = log.scrollHeight;
    chatPinned = true;
  }
}

function applyChatPack(pack, fromSend) {
  if (!pack || !chatSlug) return;
  const watching = document.getElementById('chat-watching');
  const compose = document.getElementById('chat-compose');
  if (watching) {
    const n = Number(pack.watching) || 0;
    watching.textContent = n > 0 ? `${n} watching` : 'Live chat';
  }
  if (compose) {
    const canPost = Boolean(pack.canPost);
    const signedIn = Boolean(pack.signedIn);
    if (chatCanPost !== canPost || chatSignedIn !== signedIn || !compose.childElementCount) {
      chatCanPost = canPost;
      chatSignedIn = signedIn;
      compose.innerHTML = chatComposeHtml(pack);
      bindChatCompose(document.getElementById('arena-chat'));
    }
  }
  if (!pack.unchanged) {
    const incoming = Array.isArray(pack.messages) ? pack.messages : [];
    const lastId = incoming.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0);
    const grew = lastId > chatLastId;
    if (grew && !chatPinned && !fromSend && chatVisible()) {
      chatUnread += incoming.filter((msg) => Number(msg.id) > chatLastId).length;
    } else if (fromSend || chatPinned) {
      chatUnread = 0;
    }
    paintChatMessages(pack, fromSend || chatPinned);
    chatLastId = lastId;
    chatRev = Number(pack.rev) || chatRev;
  }
  applyChatChrome();
}

async function pullArenaChat(force) {
  if (!chatSlug) return;
  try {
    const rev = force ? 0 : chatRev;
    const pack = await api.get(`/arenas/${encodeURIComponent(chatSlug)}/chat?rev=${encodeURIComponent(rev)}&viewer=${encodeURIComponent(chatViewerToken())}`);
    applyChatPack(pack, false);
  } catch (_err) {
    /* keep the last good log; the next tick retries */
  }
}

function scheduleArenaChat() {
  stopArenaChatPoll();
  if (!chatSlug) return;
  const wait = document.hidden ? CHAT_HIDDEN_MS : CHAT_POLL_MS;
  chatTimer = window.setTimeout(async () => {
    await pullArenaChat(false);
    scheduleArenaChat();
  }, wait);
}

function ensureArenaChatDock() {
  let dock = document.getElementById('arena-chat');
  if (!dock) {
    dock = document.createElement('aside');
    dock.id = 'arena-chat';
    dock.className = 'arena-chat';
    dock.hidden = true;
    const main = document.getElementById('app');
    if (main && main.parentNode) main.parentNode.insertBefore(dock, main);
    else document.body.appendChild(dock);
  }
  let fab = document.getElementById('chat-fab');
  if (!fab) {
    fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'chat-fab';
    fab.className = 'chat-fab';
    fab.textContent = 'Chat';
    fab.hidden = true;
    document.body.appendChild(fab);
  }
  let backdrop = document.getElementById('chat-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.id = 'chat-backdrop';
    backdrop.className = 'chat-backdrop';
    backdrop.setAttribute('aria-label', 'Close chat');
    document.body.appendChild(backdrop);
  }
  const openChat = () => {
    chatUnread = 0;
    if (chatWide()) setChatMin(false);
    else {
      chatMin = false;
      chatSheetOpen = true;
      applyChatChrome();
    }
    const log = document.getElementById('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    chatPinned = true;
  };
  fab.onclick = openChat;
  backdrop.onclick = () => {
    chatSheetOpen = false;
    applyChatChrome();
  };
  return dock;
}

function syncArenaChat(t, hostMode) {
  if (!t || !t.slug) {
    hideArenaChat();
    return;
  }
  const same = chatSlug === t.slug;
  chatSlug = t.slug;
  const dock = ensureArenaChatDock();
  if (!same || !dock.querySelector('#chat-log')) {
    chatRev = 0;
    chatLastId = 0;
    chatUnread = 0;
    chatPinned = true;
    chatCanPost = null;
    chatSignedIn = null;
    renderChatDock({ watching: 0, canPost: isSignedInUser(playerUser) && Boolean((playerUser.tourneyHandle || playerUser.discordUsername || '').trim()), signedIn: isSignedInUser(playerUser) });
  }
  applyChatChrome();
  if (!same || !chatTimer) {
    void pullArenaChat(true).then(() => scheduleArenaChat());
  }
}

function nudgeArenaChat() {
  if (!chatSlug) return;
  void pullArenaChat(true);
}

function applyTipsMode() {
  document.body.classList.toggle('tips-on', tipsOn);
  const btn = document.getElementById('tips-toggle');
  if (!btn) return;
  btn.classList.toggle('on', tipsOn);
  btn.setAttribute('aria-pressed', tipsOn ? 'true' : 'false');
  btn.textContent = tipsOn ? 'Tips on' : 'Tips off';
}

function hideTip() {
  const bubble = document.getElementById('tip-bubble');
  if (bubble) bubble.hidden = true;
  if (tipTarget) tipTarget.classList.remove('tip-active');
  tipTarget = null;
}

function showTip(el) {
  const bubble = document.getElementById('tip-bubble');
  const text = el && el.getAttribute('data-tip');
  if (!bubble || !text) return;
  if (tipTarget && tipTarget !== el) tipTarget.classList.remove('tip-active');
  tipTarget = el;
  el.classList.add('tip-active');
  bubble.hidden = false;
  bubble.textContent = text;
  const r = el.getBoundingClientRect();
  const place = () => {
    const br = bubble.getBoundingClientRect();
    let top = r.bottom + 10;
    let left = r.left;
    if (top + br.height > window.innerHeight - 12) top = Math.max(12, r.top - br.height - 10);
    if (left + br.width > window.innerWidth - 12) left = window.innerWidth - br.width - 12;
    if (left < 12) left = 12;
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
  };
  place();
  requestAnimationFrame(place);
}

function initTips() {
  applyTipsMode();
  const btn = document.getElementById('tips-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      tipsOn = !tipsOn;
      localStorage.setItem(TIPS_KEY, tipsOn ? '1' : '0');
      applyTipsMode();
      hideTip();
    });
  }
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType || 'mouse';
  }, true);
  document.addEventListener('pointerover', (e) => {
    if (!tipsOn || lastPointer === 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (!tipsOn || lastPointer === 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const next = e.relatedTarget;
    if (next && (el.contains(next) || (typeof next.closest === 'function' && next.closest('#tip-bubble')))) return;
    if (tipTarget === el) hideTip();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#tips-toggle')) return;
    if (!tipsOn) {
      hideTip();
      return;
    }
    const el = e.target.closest('[data-tip]');
    if (!el) {
      hideTip();
      return;
    }
    if (lastPointer !== 'touch') return;
    if (tipTarget === el) return;
    e.preventDefault();
    e.stopPropagation();
    showTip(el);
  }, true);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}

function initNav() {
  let compact = false;
  const scrollYNow = () => Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0,
  );
  const paintCompact = () => {
    const y = scrollYNow();
    if (!compact && y > 48) compact = true;
    else if (compact && y < 12) compact = false;
    const head = document.querySelector('.site-head');
    if (head) head.classList.toggle('is-compact', compact);
    document.documentElement.classList.toggle('compact-nav', compact);
  };
  window.addEventListener('scroll', paintCompact, { passive: true });
  document.addEventListener('scroll', paintCompact, { passive: true, capture: true });
  paintCompact();
}

function tip(text) {
  return `data-tip="${esc(text)}"`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Admin / host session
// ---------------------------------------------------------------------------

function setAdminSession(password) {
  adminPassword = String(password ?? '').trim();
  adminMode = adminPassword !== '';
  sessionStorage.setItem('ddl-admin-password', adminPassword);
  sessionStorage.setItem('ddl-admin-mode', adminMode ? '1' : '0');
  sessionStorage.removeItem('ddl-host-password');
  sessionStorage.removeItem('ddl-host-mode');
  hostPassword = '';
  syncHostMode();
  applyHostChrome();
}

function clearAdminSession() {
  adminPassword = '';
  adminMode = false;
  sessionStorage.removeItem('ddl-admin-password');
  sessionStorage.removeItem('ddl-admin-mode');
  sessionStorage.removeItem('ddl-host-password');
  sessionStorage.removeItem('ddl-host-mode');
  hostPassword = '';
  syncHostMode();
  applyHostChrome();
}

function setHostSession(password) {
  setAdminSession(password);
}

function clearHostSession() {
  clearAdminSession();
}

function setAdminPassword(value) {
  adminPassword = String(value ?? '').trim();
  sessionStorage.setItem('ddl-admin-password', adminPassword);
}

function applyHostChrome() {
  syncHostMode();
  document.body.classList.toggle('host-mode', hostMode);
  document.body.classList.toggle('admin-mode', isAdminMode());
  const toggle = document.getElementById('host-toggle');
  if (toggle) {
    toggle.textContent = isAdminMode() ? 'Admin mode on' : 'Admin';
    toggle.classList.toggle('on', isAdminMode());
    toggle.setAttribute('data-tip', isAdminMode()
      ? 'You are signed in as admin. Click to sign out. Admin can manage every arena and the ledger.'
      : 'Sign in with DD_ADMIN_PASSWORD to manage every arena, grant hosts, and write the ledger.');
  }
  const create = document.getElementById('nav-create');
  if (create) {
    create.hidden = false;
    create.textContent = 'Host';
  }
  const ledger = document.getElementById('nav-ledger');
  if (ledger) ledger.hidden = !isAdminMode();
}

/**
 * Password field that browsers will not fill from saved site logins. Chrome ignores
 * `autocomplete="off"` on password inputs, so these use `new-password`.
 */
function secretFieldHtml(id, value) {
  return `<input id="${id}" name="${id}" type="password" value="${esc(value)}"
    autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-secret>`;
}

function openModal(innerHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  overlay.innerHTML = `<div class="scorecard" role="dialog" aria-modal="true">${innerHtml}</div>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

/** Admin sign-in. Resolves true once DD_ADMIN_PASSWORD is accepted. */
function openAdminSignIn() {
  return new Promise((resolve) => {
    const locked = serverStatus && serverStatus.adminPasswordSet === false;
    const overlay = openModal(`
      <div class="row">
        <div>
          <p class="muted">Admin</p>
          <h2>Unlock admin tools</h2>
        </div>
        <button type="button" class="copy" id="hs-close">Close</button>
      </div>
      <p class="muted">Admin can manage every arena, grant Discord hosts, write the ledger, and delete arenas. Hosts only change tournaments they created — they sign in with Discord, not this password.</p>
      ${locked ? `<p class="err">This server has no admin password yet. Set <code>DD_ADMIN_PASSWORD</code> in Node (same as DD Evaluator), then restart.</p>` : ''}
      <div><label for="hs-pw">Admin password</label>${secretFieldHtml('hs-pw', '')}</div>
      <p class="err" id="hs-err" hidden></p>
      <button class="btn" type="button" id="hs-go">Sign in as admin</button>`);
    const input = overlay.querySelector('#hs-pw');
    const errEl = overlay.querySelector('#hs-err');
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(ok);
    };
    overlay.querySelector('#hs-close').onclick = () => finish(false);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    const submit = async () => {
      errEl.hidden = true;
      const candidate = input.value.trim();
      if (!candidate) {
        errEl.hidden = false;
        errEl.textContent = 'Enter the admin password.';
        return;
      }
      try {
        await api.post('/admin-auth', { adminPassword: candidate });
        setAdminSession(candidate);
        finish(true);
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
    overlay.querySelector('#hs-go').onclick = submit;
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };
    input.focus();
  });
}

function openHostSignIn() {
  return openAdminSignIn();
}

/** Host password unlocks hosting on the signed-in Discord account. */
function openHostUnlock() {
  return new Promise((resolve) => {
    const locked = !hostingEnabled();
    const overlay = openModal(`
      <div class="row">
        <div>
          <h2>Unlock hosting</h2>
        </div>
        <button type="button" class="copy" id="hs-close">Close</button>
      </div>
      ${!isSignedInUser(playerUser) ? `<p class="err">Sign in with Discord first.</p>` : ''}
      ${locked ? `<p class="err">Hosting isn’t available right now.</p>` : ''}
      <div><label for="hs-pw">Password</label>${secretFieldHtml('hs-pw', '')}</div>
      <p class="err" id="hs-err" hidden></p>
      <button class="btn" type="button" id="hs-go">Unlock</button>`);
    const input = overlay.querySelector('#hs-pw');
    const errEl = overlay.querySelector('#hs-err');
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(ok);
    };
    overlay.querySelector('#hs-close').onclick = () => finish(false);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    const submit = async () => {
      errEl.hidden = true;
      if (!isSignedInUser(playerUser)) {
        errEl.hidden = false;
        errEl.textContent = 'Sign in with Discord first.';
        return;
      }
      const candidate = input.value.trim();
      if (!candidate) {
        errEl.hidden = false;
        errEl.textContent = 'Enter the password.';
        return;
      }
      try {
        const result = await api.post('/host-unlock', { hostPassword: candidate });
        if (result && result.user) playerUser = result.user;
        applyPlayerChrome();
        applyHostChrome();
        finish(true);
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
    overlay.querySelector('#hs-go').onclick = submit;
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function badge(status) {
  const extra = status === 'in_progress' || status === 'live' ? 'live'
    : status === 'pending' || status === 'no_show' ? 'pending'
    : status === 'confirmed' || status === 'complete' || status === 'completed' ? 'ok' : '';
  const label = status === 'complete' && extra === 'ok' ? 'Complete' : (STATUS_LABEL[status] || status);
  return `<span class="badge ${extra}">${esc(label)}</span>`;
}

function phaseOf(t) {
  if (t && t.phase) return t.phase;
  if (!t) return 'registration';
  if (t.status === 'completed') return 'complete';
  if (t.status === 'in_progress') return 'live';
  return 'registration';
}

function scheduleLine(t) {
  const parts = scheduleParts(t);
  const bits = [];
  if (parts.when && parts.when !== 'TBD' && parts.when !== 'Time TBA') bits.push(parts.when);
  if (parts.tentative) bits.push('tentative');
  if (parts.relative) bits.push(parts.relative);
  return bits.filter(Boolean).join(' · ') || parts.when || 'TBD';
}

function scheduleClockHtml(t, opts) {
  const parts = scheduleParts(t);
  const live = (opts && opts.live) || phaseOf(t) === 'live';
  const wantTimer = !(opts && opts.timer === false) && !live && Number.isFinite(parts.startMs);
  const timer = wantTimer ? nightTimerHtml(parts.startMs) : '';
  const chips = [
    parts.date ? `<span>${esc(parts.date)}</span>` : '',
    parts.time ? `<span>${esc(parts.time)}</span>` : '',
    parts.offset ? `<span>${esc(parts.offset)}</span>` : '',
    !timer && parts.relative ? `<span>${esc(parts.relative)}</span>` : '',
    parts.tentative ? `<span>tentative</span>` : '',
  ].filter(Boolean).join('');
  if (!chips && !timer) return opts && opts.plain ? 'Time TBA' : '<p class="muted">Time TBA</p>';
  if (opts && opts.plain) return [parts.when, parts.tentative ? 'tentative' : '', !timer ? parts.relative : ''].filter(Boolean).join(' · ') || 'TBD';
  return `${chips ? `<p class="nightboard-meta">${chips}</p>` : ''}${timer}`;
}

function cityFromTimezone(tz) {
  const parts = String(tz || '').replace(/_/g, ' ').split('/');
  return parts[parts.length - 1] || '';
}

function padClock(n) {
  return String(n).padStart(2, '0');
}

function eventTimeApi() {
  return (typeof globalThis !== 'undefined' && globalThis.LBEventTime) || {};
}

function eventStartMs(startAt, timeZone) {
  const api = eventTimeApi();
  if (api.eventStartMs) return api.eventStartMs(startAt, timeZone);
  const ms = Date.parse(startAt);
  return Number.isFinite(ms) ? ms : NaN;
}

function hostDefaultTz() {
  const api = eventTimeApi();
  return api.hostDefaultTimeZone ? api.hostDefaultTimeZone() : 'America/New_York';
}

function timezoneSelectHtml(selected) {
  const host = hostDefaultTz();
  const cur = selected || host;
  const known = TIMEZONES.map((z) => z.id);
  const extras = [];
  const pushExtra = (id) => {
    if (!id || known.indexOf(id) !== -1 || extras.some((z) => z.id === id)) return;
    extras.push({ id, label: id.replace(/_/g, ' ') });
  };
  pushExtra(host);
  pushExtra(cur);
  return extras.concat(TIMEZONES).map((z) => {
    let label = z.label;
    if (z.id === host) label += ' — your zone';
    else if (z.id === 'America/New_York') label += ' — EST';
    return `<option value="${esc(z.id)}"${z.id === cur ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function countdownParts(ms) {
  const api = eventTimeApi();
  if (api.countdownParts) return api.countdownParts(ms);
  const left = Number(ms) - Date.now();
  if (!Number.isFinite(Number(ms)) || left <= 0) return null;
  const total = Math.floor(left / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

function nightTimerHtml(ms) {
  const api = eventTimeApi();
  if (api.timerHtml) return api.timerHtml(ms);
  const parts = countdownParts(ms);
  if (!parts) return '';
  const cell = (n, label) => `<span><b>${padClock(n)}</b><small>${label}</small></span>`;
  return `<div class="night-timer" data-count-ms="${esc(String(ms))}" role="timer" aria-label="Countdown to start">${cell(parts.d, 'days')}${cell(parts.h, 'hrs')}${cell(parts.m, 'min')}${cell(parts.s, 'sec')}</div>`;
}

function scheduleParts(t) {
  const api = eventTimeApi();
  const view = api.viewerPartsOf
    ? api.viewerPartsOf(t)
    : (() => {
      const tz = (t && t.schedule && t.schedule.timezone) || (t && t.timezone) || '';
      const startAt = (t && t.startAt) || (t && t.schedule && t.schedule.startAt) || '';
      const startMs = eventStartMs(startAt, tz);
      const formatted = api.formatViewerParts
        ? api.formatViewerParts(startMs)
        : { date: '', time: '', offset: '', abbr: '', line: 'TBD' };
      return {
        date: formatted.date || '',
        time: formatted.time || '',
        offset: formatted.offset || '',
        abbr: formatted.abbr || '',
        line: formatted.line || 'TBD',
        relative: (t && t.schedule && t.schedule.relative) || '',
        startMs,
        tentative: Boolean((t && t.schedule && t.schedule.tentative) || (t && t.startTentative)),
        timezone: tz,
      };
    })();
  const when = (Number.isFinite(view.startMs) && view.line && view.line !== 'TBD')
    ? view.line
    : 'Time TBA';
  return {
    date: view.date || '',
    time: view.time || '',
    offset: view.offset || '',
    city: cityFromTimezone(view.timezone),
    localAbbr: view.abbr || '',
    eventTime: '',
    eventAbbr: '',
    sameZone: true,
    when,
    relative: view.relative || '',
    tentative: Boolean(view.tentative),
    startAt: (t && t.startAt) || (t && t.schedule && t.schedule.startAt) || '',
    startMs: view.startMs,
    timezone: view.timezone || '',
  };
}

function hasLockedList(entry) {
  if (!entry) return false;
  if (entry.listSubmitted) return true;
  const deck = entry.registeredDeck;
  if (!deck) return false;
  if (deck.ready || deck.hidden) return Number(deck.cardCount || 40) >= 40 || Boolean(deck.ready || deck.hidden);
  return Number(deck.cardCount) === 40;
}

function paidReceipt(entry) {
  if (!entry || !entry.paid) return '';
  const when = entry.payVerifiedAt || entry.paidAt;
  if (!when) return 'PAID';
  try {
    return `PAID ${new Date(when).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  } catch (_err) {
    return 'PAID';
  }
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function feeUsd(t) {
  if (!t || t.feeMode === 'free') return 0;
  const n = Number(t.entryFeeUsd);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatUsdRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

const MAX_PAYOUT_PLACES = 8;
const PRIZE_POOL_PERCENT = 65;
const HOUSE_RETAIN_PERCENT = 35;

function placeLabel(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 1) return '';
  const mod100 = v % 100;
  const mod10 = v % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  if (mod10 === 1) return `${v}st`;
  if (mod10 === 2) return `${v}nd`;
  if (mod10 === 3) return `${v}rd`;
  return `${v}th`;
}

function addedPotUsdOf(t, rewards) {
  const n = Number((rewards && rewards.addedPotUsd) ?? (t && t.addedPotUsd));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function payoutRowFrom(p, mode, pool) {
  const prize = String((p && p.prize) || '').trim();
  const addedUsd = Math.max(0, Math.round((Number(p && p.addedUsd) || 0) * 100) / 100);
  if (mode === 'prize') {
    if (!prize) return null;
    return {
      place: p.place,
      label: placeLabel(p.place),
      text: prize,
      prize,
      addedUsd: 0,
    };
  }
  const percent = Number(p && p.percent) || 0;
  if (!(percent > 0) && !prize && !(addedUsd > 0)) return null;
  const amountUsd = Math.round(pool * percent) / 100;
  return {
    place: p.place,
    label: placeLabel(p.place),
    text: percent > 0 ? `${percent}%` : prize,
    prize,
    amountUsd,
    addedUsd,
    totalUsd: Math.round((amountUsd + addedUsd) * 100) / 100,
    percent,
  };
}

function rewardsOf(data, t) {
  if (data && data.rewards && data.rewards.mode) {
    return {
      poolPercent: PRIZE_POOL_PERCENT,
      retainPercent: HOUSE_RETAIN_PERCENT,
      potFundMode: potFundModeOf(t, data.rewards),
      feesCollected: 0,
      houseRetainUsd: 0,
      addedPotUsd: 0,
      feePoolUsd: 0,
      ...data.rewards,
    };
  }
  if (t && t.rewards && t.rewards.mode) {
    return {
      poolPercent: PRIZE_POOL_PERCENT,
      retainPercent: HOUSE_RETAIN_PERCENT,
      potFundMode: potFundModeOf(t, t.rewards),
      feesCollected: 0,
      houseRetainUsd: 0,
      addedPotUsd: 0,
      feePoolUsd: 0,
      ...t.rewards,
    };
  }
  const mode = t && t.rewardMode === 'prize' ? 'prize' : 'pot';
  const pool = Number((data && data.prizePool) ?? (t && t.prizePool)) || 0;
  const potFundMode = potFundModeOf(t);
  const payouts = Array.isArray(t && t.payouts) ? t.payouts : [];
  const rows = payouts.map((p) => payoutRowFrom(p, mode, pool)).filter(Boolean);
  return {
    mode,
    pool,
    addedPotUsd: potFundMode === 'percent' ? addedPotUsdOf(t) : 0,
    feePoolUsd: 0,
    potFundMode,
    poolPercent: PRIZE_POOL_PERCENT,
    retainPercent: HOUSE_RETAIN_PERCENT,
    feesCollected: 0,
    houseRetainUsd: 0,
    rows,
  };
}

function potFundModeOf(t, rewards) {
  const raw = (rewards && rewards.potFundMode) || (t && t.potFundMode);
  if (raw === 'percent' || raw === 'usd') return raw;
  if (Number(t && t.hostPotUsd) > 0) return 'usd';
  if (t && (t.feeMode === 'free' || !(Number(t.entryFeeUsd) > 0))) return 'usd';
  return 'percent';
}

function formatPlaceReward(rewards, row) {
  if (!row) return '';
  if (rewards && rewards.mode === 'prize') return row.text || row.prize || '';
  const share = Number(row.amountUsd) || 0;
  const added = Number(row.addedUsd) || 0;
  const prize = String(row.prize || '').trim();
  const parts = [];
  if (share > 0) parts.push(formatUsd(share));
  if (added > 0) parts.push(formatUsd(added));
  if (prize) parts.push(prize);
  if (parts.length) return parts.join(' + ');
  if (row.amountUsd != null) return formatUsd(row.amountUsd);
  return row.text || '';
}

function prizeForPlace(rewards, place) {
  const row = rewards && (rewards.rows || []).find((r) => Number(r.place) === Number(place));
  return formatPlaceReward(rewards, row);
}

function hasAddedRewards(rewards) {
  return (rewards && rewards.rows ? rewards.rows : []).some((row) => (
    Number(row.addedUsd) > 0 || String(row.prize || '').trim()
  ));
}

function prizeTexts(rewards) {
  return (rewards && rewards.rows ? rewards.rows : [])
    .map((r) => String(r.text || '').trim())
    .filter(Boolean);
}

function prizeItemKey(rest) {
  return String(rest || '')
    .toLowerCase()
    .replace(/\bpacks?\b/g, 'pack')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPrizeQty(total, rest) {
  const n = Number(total);
  const qty = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  const word = n === 1 ? 'Pack' : 'Packs';
  if (/^packs?\b/i.test(rest)) return `${qty} ${rest.replace(/^packs?\b/i, word)}`;
  return `${qty} ${rest}`;
}

function compactPrizeLine(texts) {
  const list = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length) return '';
  const groups = [];
  const byKey = new Map();
  for (const text of list) {
    const hit = text.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!hit) {
      const key = `:${text.toLowerCase()}`;
      if (!byKey.has(key)) {
        const row = { total: null, rest: text };
        byKey.set(key, row);
        groups.push(row);
      }
      continue;
    }
    const qty = Number(hit[1]);
    const rest = hit[2].trim();
    const key = prizeItemKey(rest);
    let row = byKey.get(key);
    if (!row) {
      row = { total: 0, rest };
      byKey.set(key, row);
      groups.push(row);
    }
    row.total += qty;
  }
  return groups.map((row) => (row.total == null ? row.rest : formatPrizeQty(row.total, row.rest))).join(', ');
}

function rewardMetaHtml(rewards) {
  const rows = rewards && rewards.rows ? rewards.rows : [];
  if (rewards && rewards.mode === 'prize') return '';
  const percentPool = rewards && rewards.potFundMode === 'percent';
  const addedPot = addedPotUsdOf(null, rewards);
  const poolTip = percentPool
    ? `${Number(rewards.poolPercent) || PRIZE_POOL_PERCENT}% of paid entries is redistributed${addedPot > 0 ? `, plus ${formatUsd(addedPot)} added` : ''}. This is the pot, not total raised.`
    : 'Dollar amount players share. Entry fees are not added on top.';
  const pool = `<div ${tip(poolTip)}><dt>Pot</dt><dd>${formatUsd(rewards && rewards.pool)}</dd></div>`;
  if (!rows.length) return pool;
  const split = rows.map((r) => {
    const extras = [];
    if (Number(r.percent) > 0) extras.push(`${r.percent}%`);
    const shown = formatPlaceReward(rewards, r);
    return `${r.label}${extras.length ? ` ${extras[0]}` : ''}${shown ? ` ${shown}` : ''}`;
  }).join(' · ');
  return `${pool}<div><dt>Payout</dt><dd>${esc(split)}</dd></div>`;
}

function payoutHasValue(row, mode) {
  if (mode === 'prize') return Boolean(String(row && row.prize || '').trim());
  return Number(row && row.percent) > 0
    || Number(row && row.addedUsd) > 0
    || Boolean(String(row && row.prize || '').trim());
}

function filledPayouts(payload) {
  const mode = payload && payload.rewardMode === 'prize' ? 'prize' : 'pot';
  return (payload && payload.payouts ? payload.payouts : []).filter((row) => payoutHasValue(row, mode));
}

function assertRewardsSaved(payload, next) {
  const t = next && next.tournament;
  const rewards = next && next.rewards;
  if (!t) return;
  const mode = (t.rewardMode || (rewards && rewards.mode) || 'pot');
  if (payload.rewardMode === 'prize' && mode !== 'prize') {
    throw new Error('Prize did not save. Upload public/server/routes/tourney-bracket.js and restart Node, then save again.');
  }
  const sent = filledPayouts(payload);
  const stored = Array.isArray(t.payouts) ? t.payouts : [];
  const shown = rewards && Array.isArray(rewards.rows) ? rewards.rows : [];
  if (sent.length && !stored.length && !shown.length) {
    throw new Error('Place payouts did not save. Restart Node after uploading the tourney API file, then save again.');
  }
}

function rewardBreakdownHtml(rewards) {
  const rows = rewards && rewards.rows ? rewards.rows : [];
  const addedPot = addedPotUsdOf(null, rewards);
  if (!rows.length && !(rewards && rewards.mode !== 'prize' && (rewards.potFundMode === 'percent' || addedPot > 0))) return '';
  const prizeMode = rewards.mode === 'prize';
  if (prizeMode && !rows.length) return '';
  const percentPool = !prizeMode && rewards.potFundMode === 'percent';
  const poolPct = Number(rewards.poolPercent) || PRIZE_POOL_PERCENT;
  const retainPct = Number(rewards.retainPercent) || HOUSE_RETAIN_PERCENT;
  const potNote = percentPool
    ? `Pot is ${poolPct}% of paid entries${addedPot > 0 ? ` plus ${formatUsd(addedPot)} added` : ''} — what gets redistributed, not total raised.`
    : '';
  return `<section class="payouts" ${tip(prizeMode
    ? 'Host-set prizes for each place. Entry fees are not this prize list.'
    : percentPool
      ? `${poolPct}% of paid entry fees is redistributed by place${addedPot > 0 ? `, plus ${formatUsd(addedPot)} added to that pot` : ''}. The house retains ${retainPct}%. Extra cash or prizes on a place sit on top of that split.`
      : 'How the host-set dollar pot splits by place. Extra cash or prizes on a place sit on top of that split.')}>
    <h2>${prizeMode ? 'Prizes' : 'Pot breakdown'}</h2>
    ${potNote ? `<p class="muted">${esc(potNote)}</p>` : ''}
    ${rows.length ? `<ol>
      ${rows.map((row) => {
        const shown = formatPlaceReward(rewards, row);
        const bits = [];
        if (!prizeMode && Number(row.percent) > 0) bits.push(`${row.percent}%`);
        return `<li>
        <span>${esc(row.label)}</span>
        <strong>${esc(shown)}</strong>
        ${bits.length ? `<small>${esc(bits.join(' '))}</small>` : ''}
      </li>`;
      }).join('')}
    </ol>` : ''}
  </section>`;
}

function rewardCardHtml(t) {
  const rewards = rewardsOf(t, t);
  if (rewards.mode === 'prize') {
    const texts = prizeTexts(rewards);
    if (!texts.length) return '';
    const line = compactPrizeLine(texts);
    return `<p class="muted prize-line" title="${esc(`Prize(s): ${texts.join(', ')}`)}">Prize(s): ${esc(line)}</p>`;
  }
  const pool = Number((rewards && rewards.pool) ?? (t && t.prizePool)) || 0;
  const extras = hasAddedRewards(rewards) ? ' + added prizes' : '';
  if (rewards.potFundMode === 'percent') {
    const pct = Number(rewards.poolPercent) || PRIZE_POOL_PERCENT;
    return `<p class="muted">${pool > 0 ? `Pot ${formatUsd(pool)}` : `Pot ${pct}% of entries`}${extras}</p>`;
  }
  if (pool > 0) {
    return `<p class="muted">Pot ${formatUsd(pool)}${extras}</p>`;
  }
  if (extras) return `<p class="muted">Added prizes</p>`;
  return '';
}

function payoutRowHtml(place, percent, prize, addedUsd) {
  const pct = percent === 0 || percent ? String(percent) : '';
  const added = addedUsd === 0 || addedUsd ? String(addedUsd) : '';
  return `<div class="payout-row" data-place="${place}">
    <span class="payout-place">${esc(placeLabel(place))}</span>
    <div class="payout-value">
      <span class="payout-percent-wrap"><input class="payout-percent" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(pct)}" placeholder="0" aria-label="${esc(placeLabel(place))} percent of pot"><span class="muted">%</span></span>
      <span class="payout-added-wrap"><span class="muted">+$</span><input class="payout-added" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(added)}" placeholder="0" aria-label="${esc(placeLabel(place))} added cash"></span>
      <input class="payout-prize" maxlength="120" value="${esc(prize || '')}" placeholder="Added prize (packs, merch…)" aria-label="${esc(placeLabel(place))} added prize">
    </div>
    <button type="button" class="mini" data-payout-remove>Remove</button>
  </div>`;
}

function payoutRowsFrom(d, creating) {
  const existing = Array.isArray(d && d.payouts) ? d.payouts : [];
  const byPlace = new Map(existing.map((p) => [Number(p.place), p]));
  const maxPlace = existing.length ? Math.max(3, ...existing.map((p) => Number(p.place) || 0)) : 3;
  const rows = [];
  for (let i = 1; i <= Math.min(MAX_PAYOUT_PLACES, maxPlace); i++) {
    const row = byPlace.get(i);
    const defaultFirst = creating && i === 1 && (!d || d.rewardMode !== 'prize') && !existing.length;
    rows.push({
      place: i,
      percent: row && row.percent != null && row.percent !== '' ? row.percent : (defaultFirst ? 100 : ''),
      addedUsd: row && row.addedUsd != null && row.addedUsd !== '' ? row.addedUsd : '',
      prize: row && row.prize ? row.prize : '',
    });
  }
  return rows;
}

function formatCrypto(asset, value) {
  const n = Number(value) || 0;
  if (asset === 'SOL') return `${n.toFixed(6)} SOL`;
  if (asset === 'XMONEY') return `${formatUsd(n)} via XMoney`;
  if (asset === 'USDC_SOL') return `${n.toFixed(2)} USDC`;
  return `${n.toFixed(2)} DOGE`;
}

function paySettingsError(payload) {
  if (!payload || payload.feeMode === 'free') return '';
  const doge = String(payload.treasury || '').trim();
  const xHandle = sanitizeXHandleInput(payload.xHandle);
  const sol = String(payload.solanaTreasury || '').trim();
  const usdcOn = Boolean(payload.acceptUsdcSol);
  if (payload.acceptDoge !== false && doge && !sanitizeDogeAddressInput(doge)) {
    return 'Enter a valid DOGE address (starts with D).';
  }
  if (usdcOn && sol && !sanitizeSolanaAddressInput(sol)) {
    return 'Enter a valid Solana wallet address for USDC.';
  }
  if (payload.acceptDoge === false && !xHandle && !usdcOn) {
    return 'Add an XMoney @handle, turn on USDC on Solana, or turn DOGE back on.';
  }
  return '';
}

function wantsLosers(t) {
  if (!t) return false;
  if (t.losersBracket != null) return Boolean(t.losersBracket);
  return t.format === 'double_elim' || t.playoffFormat === 'double_elim';
}

function canHaveThirdPlace(t) {
  if (!t || isDuelArena(t)) return false;
  if (wantsLosers(t)) return false;
  if (t.stageType === 'two') return true;
  return t.format === 'single_elim';
}

function hasFinalsSeries(t) {
  if (!t || isDuelArena(t)) return false;
  if (t.stageType === 'two' || wantsLosers(t)) return true;
  return t.format === 'single_elim';
}

function seriesBlurb(t) {
  const def = BEST_OF.includes(Number(t && t.bestOf)) ? Number(t.bestOf) : 3;
  const finals = BEST_OF.includes(Number(t && t.finalsBestOf)) ? Number(t.finalsBestOf) : null;
  if (finals && finals !== def) return `${bestOfLabel(def)}, ${bestOfLabel(finals)} finals`;
  return bestOfLabel(def);
}

function formatTitle(t) {
  if (isDuelArena(t, t && t.fieldSize)) {
    const bo = t && BEST_OF.includes(Number(t.bestOf)) ? bestOfLabel(t.bestOf) : '';
    return bo ? `Duel · ${bo}` : 'Duel';
  }
  const key = t && t.format === 'double_elim' ? 'single_elim' : (t && t.format);
  const base = FORMAT_LABEL[key] || key || 'Tournament';
  const bits = [];
  if (t && t.stageType === 'two') bits.push('two stage');
  if (wantsLosers(t)) bits.push('losers bracket');
  else if (t && t.breakTies) bits.push('3rd place');
  const series = seriesBlurb(t);
  if (series) bits.push(series);
  return bits.length ? `${base} · ${bits.join(' · ')}` : base;
}

function formatBlurb(t) {
  const key = t && t.format === 'double_elim' ? 'single_elim' : (t && t.format);
  const base = FORMAT_LABEL[key] || key || 'bracket';
  const extras = [];
  if (wantsLosers(t)) {
    extras.push(key === 'swiss' || key === 'round_robin'
      ? 'a losers-bracket playoff after standings'
      : 'a losers bracket');
  } else if (t && t.breakTies && canHaveThirdPlace(t)) {
    extras.push('a 3rd place match');
  }
  const series = seriesBlurb(t);
  if (series) extras.push(series);
  if (!extras.length) return `${base} bracket`;
  return `${base} with ${extras.join(', ')}`;
}

function nextPowerOfTwo(n) {
  if (n < 2) return 2;
  return 2 ** Math.ceil(Math.log2(n));
}

function byeNote(t, n) {
  if (!usesElimTree(t) || n < 2) return '';
  const size = nextPowerOfTwo(n);
  const byes = size - n;
  if (!byes) return '';
  return ` ${n} players fill a ${size}-slot tree, so ${byes} top seed${byes === 1 ? '' : 's'} get a first-round bye.`;
}

function bracketHasPlay(matches) {
  return (matches || []).some((m) => (
    m.status === 'complete'
    || (Array.isArray(m.games) && m.games.length)
    || Number(m.score1) > 0
    || Number(m.score2) > 0
  ));
}

function winsNeeded(bestOf) {
  const n = BEST_OF.includes(Number(bestOf)) ? Number(bestOf) : 3;
  return Math.ceil(n / 2);
}

function bestOfLabel(bestOf) {
  const n = BEST_OF.includes(Number(bestOf)) ? Number(bestOf) : 3;
  return n === 1 ? 'Best of 1' : `Best of ${n}`;
}

function roundKey(side, round) {
  return `${side}:${Number(round) || 1}`;
}

function roundLabel(format, side, round, maxRound) {
  if (format === 'swiss') return `Swiss Round ${round}`;
  if (format === 'round_robin') return `Round ${round}`;
  if (side === 'title') return 'Title match';
  if (side === 'grand') return round === 1 ? 'Grand Final' : 'Grand Final Reset';
  if (side === 'placement') return '3rd place match';
  if (side === 'losers') return `Losers R${round}`;
  const fromEnd = (maxRound || round) - round;
  if (fromEnd === 0) return 'Finals';
  if (fromEnd === 1) return 'Semi Finals';
  if (fromEnd === 2) return 'Quarter finals';
  if (round === 1) return '1st round';
  return `Round ${round}`;
}

function expectedRounds(format, playerCount, swissRounds, losersBracket, breakTies) {
  const n = Math.max(2, playerCount);
  const rows = [];
  const tree = losersBracket || format === 'double_elim';
  if (format === 'single_elim' || format === 'double_elim') {
    if (tree) {
      const wb = Math.log2(nextPowerOfTwo(n));
      const lb = Math.max(1, 2 * (wb - 1));
      for (let r = 1; r <= wb; r++) rows.push({ side: 'winners', round: r, label: `Winners · ${roundLabel('double_elim', 'winners', r, wb)}` });
      for (let r = 1; r <= lb; r++) rows.push({ side: 'losers', round: r, label: `Losers R${r}` });
      rows.push({ side: 'grand', round: 1, label: 'Grand Final' });
    } else {
      const max = Math.log2(nextPowerOfTwo(n));
      for (let r = 1; r <= max; r++) rows.push({ side: 'winners', round: r, label: roundLabel(format, 'winners', r, max) });
      if (breakTies && n >= 4) rows.push({ side: 'placement', round: 1, label: '3rd place match' });
    }
  } else if (format === 'round_robin') {
    const rounds = n % 2 === 0 ? n - 1 : n;
    for (let r = 1; r <= rounds; r++) rows.push({ side: 'group', round: r, label: `Round ${r}` });
  } else {
    const sr = swissRounds || Math.max(3, Math.ceil(Math.log2(n)));
    for (let r = 1; r <= sr; r++) rows.push({ side: 'group', round: r, label: `Swiss Round ${r}` });
  }
  if (tree && (format === 'round_robin' || format === 'swiss')) {
    const wb = Math.log2(nextPowerOfTwo(n));
    const lb = Math.max(1, 2 * (wb - 1));
    for (let r = 1; r <= wb; r++) rows.push({ side: 'winners', round: r, label: `Playoff · ${roundLabel('double_elim', 'winners', r, wb)}` });
    for (let r = 1; r <= lb; r++) rows.push({ side: 'losers', round: r, label: `Playoff · Losers R${r}` });
    rows.push({ side: 'grand', round: 1, label: 'Playoff · Grand Final' });
  }
  if (breakTies && !tree && format !== 'single_elim' && format !== 'double_elim') {
    rows.push({ side: 'placement', round: 1, label: '3rd place match' });
  }
  return rows;
}

function entryOf(entries, id) {
  return entries.find((e) => e.id === id) || null;
}

function fieldEntries(entries) {
  return (entries || []).filter((e) => e.paid && !e.noShow && (!e.whitelist || e.subbedIn))
    .sort((a, b) => (Number(a.seed) || 99) - (Number(b.seed) || 99)
      || String(a.handle || '').localeCompare(String(b.handle || '')));
}

/** Roster picker for the belt holder. The champ still has to be a confirmed entry so we can seat them. */
function champOptions(field, t) {
  if (!field.length) return '<p class="muted">Confirm at least one player first — the champ has to be on the roster.</p>';
  const current = String(t.reigningChampEntryId || '');
  return `<label for="champ-pick">Belt holder</label>
    <select id="champ-pick">
      <option value="">Choose a player</option>
      ${field.map((e) => `<option value="${esc(String(e.id))}" ${current === String(e.id) ? 'selected' : ''}>${esc(`#${e.seed || '–'} ${e.handle}`)}</option>`).join('')}
    </select>`;
}

function swapSelectHtml(id, field, selected) {
  const current = String(selected || '');
  return `<select id="${esc(id)}">
    <option value="">Choose a player</option>
    ${field.map((e) => {
      const value = String(e.id);
      return `<option value="${esc(value)}" ${current === value ? 'selected' : ''}>${esc(`#${e.seed || '–'} ${e.handle}`)}</option>`;
    }).join('')}
  </select>`;
}

function seatKey(matchId, slot) {
  return `${matchId}:${slot}`;
}

function parseSeatKey(value) {
  const parts = String(value || '').split(':');
  const matchId = Number(parts[0]);
  const slot = Number(parts[1]) === 2 ? 2 : Number(parts[1]) === 1 ? 1 : 0;
  if (!Number.isFinite(matchId) || matchId <= 0 || !slot) return null;
  return { matchId, slot };
}

function matchEditable(match) {
  return Boolean(match && match.status !== 'complete');
}

function editableSeats(t, matches, entries) {
  const fmt = wantsLosers(t) ? 'double_elim' : (t && t.format);
  const rows = [];
  for (const match of matches || []) {
    if (!matchEditable(match)) continue;
    const maxRound = (matches || []).filter((m) => m.side === match.side).reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
    const round = roundLabel(fmt, match.side, match.round, maxRound);
    for (const slot of [1, 2]) {
      const entry = entryOf(entries, slot === 1 ? match.entry1Id : match.entry2Id);
      const who = entry ? `#${entry.seed || '–'} ${entry.handle}` : (match.status === 'bye' ? 'BYE' : 'TBD');
      rows.push({
        key: seatKey(match.id, slot),
        matchId: match.id,
        slot,
        label: `${round} · M${match.position} · ${slot === 1 ? 'top' : 'bottom'} · ${who}`,
      });
    }
  }
  return rows;
}

function swapBlockedReason(t, seats) {
  if (!t || t.status === 'registration') return 'Lock the bracket first, then edit.';
  if (!seats.length) return 'Unlock a locked series to edit that round.';
  return '';
}

function hostRoundOptions(t, matches) {
  const fmt = wantsLosers(t) ? 'double_elim' : (t && t.format);
  const seen = new Set();
  const rows = [];
  for (const match of matches || []) {
    const side = match && match.side;
    if (!['winners', 'losers', 'grand', 'placement'].includes(side)) continue;
    const key = `${side}:${match.round}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const maxRound = (matches || []).filter((m) => m.side === side).reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
    const group = (matches || []).filter((m) => m.side === side && Number(m.round) === Number(match.round));
    rows.push({
      key,
      side,
      round: Number(match.round) || 1,
      label: roundLabel(fmt, side, match.round, maxRound),
      seated: group.some((m) => m.entry1Id || m.entry2Id),
      open: group.some((m) => m.status !== 'complete'),
    });
  }
  return rows;
}

function parseRoundKey(value) {
  const parts = String(value || '').split(':');
  const side = parts[0];
  const round = Number(parts[1]);
  if (!side || !Number.isFinite(round) || round <= 0) return null;
  return { side, round };
}

function defaultPairRoundKey(options) {
  const list = options || [];
  const semi = list.find((o) => o.label === 'Semi Finals' || String(o.label).endsWith('Semi Finals'));
  if (semi && semi.seated) return semi.key;
  const winners = list.filter((o) => o.side === 'winners' && o.seated && o.open);
  if (winners.length) return winners.reduce((a, b) => (a.round >= b.round ? a : b)).key;
  const seatedOpen = list.find((o) => o.seated && o.open);
  return (seatedOpen || list[0] || {}).key || '';
}

function swapFormHtml(seats, field, canEdit, opts) {
  if (!canEdit) {
    return `<p class="muted">${esc((opts && opts.reason) || 'Editing is not available.')}</p>
      <p class="err" id="swap-err" hidden></p>`;
  }
  const rounds = (opts && opts.rounds) || [];
  const currentRound = String((opts && opts.pairRound) || '');
  return `<p class="muted">Set the round to Semi Finals, pick two players, press the gold button. They play each other in that round.</p>
    <div class="swap-picks">
      <div><label for="pair-round">Round</label>
        <select id="pair-round">${rounds.map((r) => `<option value="${esc(r.key)}" ${r.key === currentRound ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="swap-picks">
      <div><label for="pair-a">Player A</label>${swapSelectHtml('pair-a', field, opts && opts.pairA)}</div>
      <div><label for="pair-b">Player B</label>${swapSelectHtml('pair-b', field, opts && opts.pairB)}</div>
    </div>
    <div class="row wrap">
      <button class="btn" type="button" id="pair-btn">They play each other</button>
    </div>
    <p class="err" id="swap-err" hidden></p>`;
}

function seatSelectHtml(id, seats, selected) {
  const current = String(selected || '');
  return `<select id="${esc(id)}">
    <option value="">Choose a seat</option>
    ${(seats || []).map((s) => `<option value="${esc(s.key)}" ${current === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
  </select>`;
}

function bestOfSelect(id, value) {
  return `<select id="${esc(id)}" data-bestof>
    ${BEST_OF.map((n) => `<option value="${n}" ${Number(value) === n ? 'selected' : ''}>${esc(bestOfLabel(n))}</option>`).join('')}
  </select>`;
}

function finalsBestOfSelect(id, value) {
  const selected = BEST_OF.includes(Number(value)) ? Number(value) : '';
  return `<select id="${esc(id)}">
    <option value="" ${selected === '' ? 'selected' : ''}>Same as default</option>
    ${BEST_OF.map((n) => `<option value="${n}" ${selected === n ? 'selected' : ''}>${esc(bestOfLabel(n))}</option>`).join('')}
  </select>`;
}

function isFinalsRuleRow(row) {
  if (!row) return false;
  if (row.side === 'grand') return true;
  if (row.side !== 'winners') return false;
  return row.label === 'Finals' || String(row.label).endsWith('· Finals');
}

function k9swapCard() {
  return `<a class="k9swap" href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer" data-tip="Need DOGE for the entry fee? K9SWAP is a Doginal Dogs powered, walletless crypto swapper.">
    <header>
      <img class="k9swap-mark" src="/bracket/k9swap-logo.png" alt="" width="56" height="56">
      <div class="k9swap-title">
        <span class="k9swap-kicker">Doginal Dogs powered</span>
        <strong>K9SWAP</strong>
      </div>
      <div class="k9swap-otf">
        <span class="k9swap-credit">@OTFMediaX</span>
        <img class="k9swap-mark" src="/bracket/otf-logo.png" alt="OTF" width="56" height="56">
      </div>
    </header>
    <p>Need DOGE? Swap any token, walletless, then send the quoted amount to the address above.</p>
    <div class="k9swap-preview" aria-hidden="true">
      <span>Any token</span>
      <span class="k9swap-arrows">⇄</span>
      <span>DOGE</span>
    </div>
    <span class="k9swap-cta">Swap to DOGE on K9SWAP</span>
  </a>`;
}

function payBoxes(payTo, t, opts) {
  const o = opts || {};
  const only = o.only || '';
  const dogeOn = acceptsDoge(t) && ((payTo && payTo.DOGE) || sanitizeDogeAddressInput(t && t.treasury) || PAY_TO.DOGE);
  const xHandle = (payTo && payTo.xHandle) || xHandleOf(t);
  const usdcAddr = solanaTreasuryOf(t, payTo);
  const charity = t && t.feeMode === 'charity';
  const who = charity ? (t.charityName || 'charity') : 'entry';
  const doge = dogeOn || '';
  const showDoge = doge && only !== 'XMONEY' && only !== 'USDC_SOL';
  const showX = xHandle && only !== 'DOGE' && only !== 'USDC_SOL';
  const showUsdc = usdcAddr && acceptsUsdcSol(t, payTo) && only !== 'DOGE' && only !== 'XMONEY';
  const parts = [];
  if (showDoge) {
    parts.push(`<article>
      <div class="row"><strong>DOGE</strong><button type="button" class="copy" data-copy="${esc(doge)}">Copy</button></div>
      <code class="mono">${esc(doge)}</code>
    </article>`);
  }
  if (showUsdc) {
    parts.push(`<article class="usdc-sol-pay">
      <div class="row"><strong>USDC on Solana</strong><button type="button" class="copy" data-copy="${esc(usdcAddr)}">Copy</button></div>
      <code class="mono">${esc(usdcAddr)}</code>
      <p class="muted">Send the USD fee as <strong>USDC</strong> on Solana (SPL). Not USDT, and not USDC on Ethereum or another chain.</p>
      <p><a class="btn" href="${esc(phantomUsdcHref(usdcAddr, feeUsd(t)))}" target="_blank" rel="noopener noreferrer">Open Phantom</a>
        <a class="btn ghost" href="${esc(solscanAccountHref(usdcAddr))}" target="_blank" rel="noopener noreferrer">Solscan</a></p>
    </article>`);
  }
  if (showX) {
    parts.push(`<article class="xmoney-pay">
      <div class="row"><strong>XMoney</strong><button type="button" class="copy" data-copy="@${esc(xHandle)}">Copy @</button></div>
      <p class="x-handle">@${esc(xHandle)}</p>
      <p class="muted">Send the USD fee in USDT, BNB, or another BEP-20 token to that @handle on X. Use the same X account you register with so the host can match it.</p>
      <p><a class="btn" href="${esc(xmoneyHref(xHandle))}" target="_blank" rel="noopener noreferrer">Open XMoney</a></p>
    </article>`);
  }
  if (!parts.length) return '';
  return `<div class="pay">
    <p class="muted">${charity
      ? `Donate to <strong>${esc(who)}</strong>. The host marks PAID after they see it.`
      : 'Send the entry, then the host marks PAID. We do not auto-charge.'}</p>
    ${parts.join('')}
    ${showDoge && !o.compact ? `<p class="hint">Need DOGE? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">Swap on K9SWAP</a>.</p>` : ''}
  </div>`;
}

function payWatchLabel(entry) {
  if (!entry) return '';
  if (entry.paid || entry.payWatchStatus === 'confirmed') {
    return entry.payTxid
      ? `Payment confirmed on the Dogecoin chain (${String(entry.payTxid).slice(0, 12)}…).`
      : 'Payment confirmed.';
  }
  if (entry.payWatchStatus === 'seen') return 'Payment seen on-chain. Waiting for 1 confirmation.';
  if (entry.payWatchStatus === 'mismatch') return 'That transaction was sent from a different wallet than the one on file. Update the sending address to the input address on the explorer.';
  return 'Watching the Dogecoin chain for your quoted amount from that wallet.';
}

function paymentWatchHtml(entry, payTo, usd, t) {
  if (!(usd > 0) || !entry) return '';
  if (entry.payAsset === 'XMONEY' || (entry.payAsset !== 'DOGE' && entry.payAsset !== 'USDC_SOL' && xHandleOf(t) && !acceptsDoge(t) && !acceptsUsdcSol(t, payTo))) {
    const hostX = xHandleOf(t) || String(entry.payTo || '').replace(/^@/, '');
    const status = entry.paid ? 'confirmed' : (entry.payWatchStatus || '');
    return `${payBoxes(payTo, t, { only: 'XMONEY' })}
      <div class="pay-watch is-${esc(status || 'watching')}">
        <p><strong>${entry.paid ? 'Paid' : 'XMoney'}</strong></p>
        <p class="muted">${entry.paid
          ? 'The host marked this paid.'
          : `Send ${esc(formatUsd(entry.amountUsd || usd))} to @${esc(hostX)} on XMoney, then tell us the @handle you paid from.`}</p>
        ${entry.paid ? '' : `<div><label for="watch-xhandle">Your X @handle</label>
          <input id="watch-xhandle" value="${esc(entry.xPayerHandle || '')}" required maxlength="16" autocomplete="off" spellcheck="false" placeholder="@you"></div>
        <p class="err" id="watch-err" hidden></p>
        <p class="ok" id="watch-ok" hidden></p>
        <div class="row wrap">
          <a class="btn ghost" href="${esc(xmoneyHref(hostX))}" target="_blank" rel="noopener noreferrer">Open XMoney</a>
          <button class="btn" type="button" id="watch-check">I've sent it</button>
        </div>
        <p class="hint">XMoney is matched by the host — there is no chain watcher. This flags your seat as sent.</p>`}
      </div>`;
  }
  if (entry.payAsset === 'USDC_SOL') {
    const dest = sanitizeSolanaAddressInput(entry.payTo) || solanaTreasuryOf(t, payTo);
    const status = entry.paid ? 'confirmed' : (entry.payWatchStatus || '');
    return `${payBoxes(payTo, t, { only: 'USDC_SOL' })}
      <div class="pay-watch is-${esc(status || 'watching')}">
        <p><strong>${entry.paid ? 'Paid' : 'USDC on Solana'}</strong></p>
        <p class="muted">${entry.paid
          ? 'The host marked this paid.'
          : `Send <strong>${esc(formatUsd(entry.amountUsd || usd))}</strong> as USDC on Solana to the address above, then tell us the wallet you paid from.`}</p>
        ${entry.paid ? '' : `<div><label for="watch-wallet">Your Solana wallet</label>
          <input id="watch-wallet" class="mono" value="${esc(entry.fromWallet || '')}" required maxlength="44" spellcheck="false" autocomplete="off" placeholder="The wallet you send FROM"></div>
        <div><label for="watch-txid">Transaction signature <span class="muted">(optional)</span></label>
          <input id="watch-txid" class="mono" value="${esc(entry.payTxid || '')}" maxlength="88" spellcheck="false" autocomplete="off" placeholder="Solana signature"></div>
        <p class="err" id="watch-err" hidden></p>
        <p class="ok" id="watch-ok" hidden></p>
        <div class="row wrap">
          <a class="btn ghost" href="${esc(phantomUsdcHref(dest, entry.amountUsd || usd))}" target="_blank" rel="noopener noreferrer">Open Phantom</a>
          <a class="btn ghost" href="${esc(solscanAccountHref(dest))}" target="_blank" rel="noopener noreferrer">Solscan</a>
          <button class="btn" type="button" id="watch-check">I've sent it</button>
        </div>
        <p class="hint">USDC on Solana is matched by the host — there is no chain watcher. Send the SPL USDC mint, not USDT.</p>`}
      </div>`;
  }
  const status = entry.paid ? 'confirmed' : (entry.payWatchStatus || 'watching');
  return `${payBoxes(payTo, t, { only: 'DOGE', compact: true })}
    <div class="pay-watch is-${esc(status)}">
      <p><strong>${entry.paid ? 'Paid' : 'Automatic payment watch'}</strong></p>
      <p class="muted">${esc(payWatchLabel(entry))}</p>
      ${entry.paid ? '' : `<p>Send <strong>${esc(formatCrypto(entry.payAsset || 'DOGE', entry.amountCrypto))}</strong> (${esc(formatUsd(entry.amountUsd))}). Invoice <code class="mono">${esc(entry.invoiceCode || '')}</code></p>
        <div><label for="watch-wallet">DOGE wallet this payment comes from</label>
          <input id="watch-wallet" value="${esc(entry.fromWallet || '')}" required minlength="8" maxlength="64" spellcheck="false" autocomplete="off" placeholder="D…"></div>
        <div><label for="watch-txid">Transaction ID <span class="muted">(optional)</span></label>
          <input id="watch-txid" value="${esc(entry.payTxid || '')}" maxlength="64" spellcheck="false" autocomplete="off" placeholder="64-character txid"></div>
        <p class="err" id="watch-err" hidden></p>
        <p class="ok" id="watch-ok" hidden></p>
        <p class="hint" id="watch-auto" hidden></p>
        <div class="row wrap">
          <button class="btn" type="button" id="watch-check">I've sent it — check the chain</button>
        </div>
        <p class="hint">We check the chain every 30 seconds, up to 4 times. Need DOGE? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">K9SWAP</a>.</p>`}
    </div>`;
}

function bindCopy(rootEl) {
  rootEl.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.onclick = async () => {
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = label; }, 1200);
      } catch (_err) {
        btn.textContent = 'Select & copy';
      }
    };
  });
}

function bindBracketViewport(scope) {
  (scope || document).querySelectorAll('.bracket-stage').forEach((stage) => {
    if (stage.dataset.bound === '1') return;
    const port = stage.querySelector('.bracket-port');
    const sizer = stage.querySelector('.bracket-sizer');
    const tree = stage.querySelector('.bracket-tree');
    if (!port || !sizer || !tree) return;
    stage.dataset.bound = '1';

    const MIN = 0.28;
    const MAX = 1.85;
    let scale = 1;
    const pointers = new Map();
    let pinch = null;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const measure = () => {
      const prev = tree.style.transform;
      tree.style.transform = 'none';
      const w = Math.max(tree.scrollWidth, tree.offsetWidth, 1);
      const h = Math.max(tree.scrollHeight, tree.offsetHeight, 1);
      tree.style.transform = prev;
      return { w, h };
    };

    const apply = (nextScale, originX, originY) => {
      const prev = scale;
      scale = Math.min(MAX, Math.max(MIN, nextScale));
      const { w, h } = measure();
      sizer.style.width = `${Math.round(w * scale)}px`;
      sizer.style.height = `${Math.round(h * scale)}px`;
      tree.style.transform = scale === 1 ? '' : `scale(${scale})`;
      if (originX != null && prev > 0 && scale !== prev) {
        const ratio = scale / prev;
        port.scrollLeft = (port.scrollLeft + originX) * ratio - originX;
        port.scrollTop = (port.scrollTop + originY) * ratio - originY;
      }
    };

    const fit = () => {
      const { w, h } = measure();
      const cs = getComputedStyle(port);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const availW = Math.max(48, port.clientWidth - padX);
      const availH = Math.max(48, port.clientHeight - padY);
      apply(Math.min(MAX, availW / w, availH / h), 0, 0);
      port.scrollLeft = 0;
      port.scrollTop = 0;
    };

    const zoomAt = (next, clientX, clientY) => {
      const rect = port.getBoundingClientRect();
      apply(next, clientX - rect.left, clientY - rect.top);
    };

    apply(1);
    stage.bracketFit = fit;
    requestAnimationFrame(() => fit());

    stage.querySelectorAll('[data-bracket-zoom]').forEach((btn) => {
      btn.onclick = () => {
        const op = btn.getAttribute('data-bracket-zoom');
        if (op === 'fit') fit();
        else if (op === 'in') apply(scale * 1.18, port.clientWidth / 2, port.clientHeight / 2);
        else apply(scale / 1.18, port.clientWidth / 2, port.clientHeight / 2);
      };
    });

    port.addEventListener('wheel', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomAt(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX, event.clientY);
    }, { passive: false });

    const interactive = (node) => node.closest('button, a, input, select, textarea, label, .match-card-hit, .slot, .mini');

    port.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (interactive(event.target)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        port.classList.add('is-panning');
      } else if (pointers.size === 2) {
        dragging = false;
        const pts = [...pointers.values()];
        pinch = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          scale,
        };
      }
      try { port.setPointerCapture(event.pointerId); } catch (_err) { /* ignore */ }
    });

    port.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinch.dist > 8) {
          const cx = (pts[0].x + pts[1].x) / 2;
          const cy = (pts[0].y + pts[1].y) / 2;
          zoomAt(pinch.scale * (dist / pinch.dist), cx, cy);
        }
        event.preventDefault();
        return;
      }
      if (!dragging) return;
      port.scrollLeft -= event.clientX - lastX;
      port.scrollTop -= event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      event.preventDefault();
    }, { passive: false });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        dragging = false;
        port.classList.remove('is-panning');
      }
    };
    port.addEventListener('pointerup', endPointer);
    port.addEventListener('pointercancel', endPointer);

    port.addEventListener('gesturestart', (event) => event.preventDefault());
    port.addEventListener('gesturechange', (event) => event.preventDefault());

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (bracketFs) fit();
        else apply(scale);
      });
      ro.observe(port);
    }
  });
}

let bracketFs = false;
let bracketFsLock = false;
let bracketFsListening = false;

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestFs(el) {
  if (!el) return Promise.resolve();
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return Promise.resolve();
  return Promise.resolve(fn.call(el)).catch(() => {});
}

function exitNativeFs() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!fn || !fsElement()) return Promise.resolve();
  return Promise.resolve(fn.call(document)).catch(() => {});
}

function fitBracketStages(root) {
  (root || document).querySelectorAll('.bracket-stage').forEach((stage) => {
    if (typeof stage.bracketFit === 'function') stage.bracketFit();
  });
}

function scheduleBracketFit(root) {
  const run = () => fitBracketStages(root);
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

function syncBracketFsUi() {
  document.body.classList.toggle('bracket-fs', bracketFs);
  document.documentElement.classList.toggle('bracket-fs', bracketFs);
  document.querySelectorAll('[data-bracket-fs]').forEach((btn) => {
    const label = bracketFs ? 'Exit' : 'Full screen';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', bracketFs ? 'true' : 'false');
    btn.setAttribute('aria-label', bracketFs ? 'Exit full screen' : 'Show bracket full screen');
  });
}

function setBracketFs(on) {
  const next = Boolean(on);
  if (!next && !bracketFs) {
    syncBracketFsUi();
    return;
  }
  bracketFs = next;
  syncBracketFsUi();
  const display = document.getElementById('bracket-display');
  if (bracketFs) {
    if (!fsElement()) {
      requestFs(document.documentElement).finally(() => {
        scheduleBracketFit(display);
      });
    } else {
      scheduleBracketFit(display);
    }
    return;
  }
  exitNativeFs();
}

function onBracketFsChange() {
  if (bracketFsLock) return;
  if (!fsElement() && bracketFs) {
    bracketFs = false;
    syncBracketFsUi();
  }
}

function ensureBracketFsListeners() {
  if (bracketFsListening) return;
  bracketFsListening = true;
  document.addEventListener('fullscreenchange', onBracketFsChange);
  document.addEventListener('webkitfullscreenchange', onBracketFsChange);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !bracketFs) return;
    if (fsElement()) return;
    setBracketFs(false);
  });
}

function bindBracketFs(scope) {
  ensureBracketFsListeners();
  (scope || document).querySelectorAll('[data-bracket-fs]').forEach((btn) => {
    btn.onclick = () => setBracketFs(!bracketFs);
  });
  if (bracketFs) {
    syncBracketFsUi();
    const display = document.getElementById('bracket-display');
    if (!fsElement()) requestFs(document.documentElement);
    requestAnimationFrame(() => scheduleBracketFit(display));
  }
}

function wrapBracketDisplay(html, t) {
  if (!html || !/bracket-stage|bracket-section/.test(html)) return html || '';
  return `<div class="bracket-display" id="bracket-display">
    <div class="bracket-display-bar">
      <div class="bracket-display-copy">
        <img src="/bracket/crest.jpg" alt="">
        <div>
          <p class="bracket-display-kicker">Legends Brackets · IRL display</p>
          <strong>${esc(t && t.name ? t.name : 'Bracket')}</strong>
        </div>
      </div>
      <div class="bracket-stage-acts">
        <button type="button" class="mini" data-bracket-fs aria-pressed="false" ${tip('Fill the screen for an IRL display. Esc exits.')}>Full screen</button>
      </div>
    </div>
    ${html}
  </div>`;
}

function groupRounds(matches, side) {
  const ofSide = matches.filter((m) => m.side === side);
  const max = ofSide.reduce((n, m) => Math.max(n, m.round), 0);
  const rounds = [];
  for (let r = 1; r <= max; r++) {
    const list = ofSide.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
    if (list.length) rounds.push(list);
  }
  if (side === 'winners') return layoutElimRounds(rounds);
  return rounds;
}

function matchHasPlayer(match, entryId) {
  const id = Number(entryId);
  return Number(match.entry1Id) === id || Number(match.entry2Id) === id || Number(match.winnerId) === id;
}

function layoutPrevRound(prev, later) {
  const used = new Set();
  const next = [];
  for (const dest of later || []) {
    const ids = [dest.entry1Id, dest.entry2Id].filter((id) => Number(id));
    const pair = [];
    for (const id of ids) {
      const src = (prev || []).find((m) => !used.has(m.id) && matchHasPlayer(m, id));
      if (src) {
        used.add(src.id);
        pair.push(src);
      }
    }
    if (pair.length < 2) {
      for (const src of prev || []) {
        const d = src.winnerGoesTo;
        if (used.has(src.id) || !d || d.side !== dest.side || Number(d.round) !== Number(dest.round) || Number(d.position) !== Number(dest.position)) continue;
        used.add(src.id);
        pair.push(src);
        if (pair.length >= 2) break;
      }
    }
    next.push(...pair);
  }
  for (const match of prev || []) {
    if (!used.has(match.id)) next.push(match);
  }
  return next;
}

function layoutElimRounds(rounds) {
  if (!rounds || rounds.length < 2) return rounds;
  const ordered = rounds.map((list) => list.slice());
  for (let r = ordered.length - 1; r >= 1; r -= 1) {
    const later = ordered[r];
    const prev = ordered[r - 1];
    if (!later.length || later.some((m) => !m.entry1Id || !m.entry2Id)) continue;
    ordered[r - 1] = layoutPrevRound(prev, later);
  }
  return ordered;
}

function reseatCompletePair(roundRows, wantedA, wantedB) {
  const idA = Number(wantedA);
  const idB = Number(wantedB);
  if (!idA || !idB || idA === idB || !roundRows || roundRows.length !== 2) return false;
  if (roundRows.some((m) => matchHasPlayer(m, idA) && matchHasPlayer(m, idB) && Number(m.entry1Id) && Number(m.entry2Id) && (Number(m.entry1Id) === idA || Number(m.entry1Id) === idB) && (Number(m.entry2Id) === idA || Number(m.entry2Id) === idB))) return false;
  if (!roundRows.every((m) => m.status === 'complete' && m.entry1Id && m.entry2Id)) return false;
  const home = roundRows.find((m) => Number(m.entry1Id) === idA || Number(m.entry2Id) === idA)
    || roundRows.find((m) => Number(m.entry1Id) === idB || Number(m.entry2Id) === idB);
  const other = roundRows.find((m) => m !== home);
  if (!home || !other) return false;
  const homeKeep = Number(home.entry1Id) === idA || Number(home.entry2Id) === idA ? idA : idB;
  const wantIn = homeKeep === idA ? idB : idA;
  if (!(Number(other.entry1Id) === wantIn || Number(other.entry2Id) === wantIn)) return false;
  const homeLeave = Number(home.entry1Id) === homeKeep ? home.entry2Id : home.entry1Id;
  const swapId = (match, fromId, toId) => {
    if (Number(match.entry1Id) === Number(fromId)) match.entry1Id = toId;
    else if (Number(match.entry2Id) === Number(fromId)) match.entry2Id = toId;
    if (Number(match.winnerId) === Number(fromId)) match.winnerId = toId;
  };
  swapId(home, homeLeave, wantIn);
  swapId(other, wantIn, homeLeave);
  return true;
}

function applyBracketLayoutFixes(data) {
  if (!data || !Array.isArray(data.matches)) return data;
  const t = data.tournament;
  const slug = String(t && t.slug || '');
  const named = /ddnyc 2026/i.test(String(t && t.name || ''));
  if (slug === 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs' || named) {
    const entries = data.entries || [];
    const idOf = (handle) => {
      const row = entries.find((e) => String(e.handle || '').toLowerCase() === handle);
      return row ? row.id : 0;
    };
    const winners = data.matches.filter((m) => m.side === 'winners');
    const max = winners.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
    const semis = winners.filter((m) => Number(m.round) === max - 1).sort((a, b) => a.position - b.position);
    reseatCompletePair(semis, idOf('dickthedev'), idOf('hofer'));
  }
  return data;
}

function matchShareLine(match, entries) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  if (!p1 && !p2) return '';
  const n1 = p1 ? p1.handle : 'TBD';
  const n2 = p2 ? p2.handle : (match.status === 'bye' ? 'BYE' : 'TBD');
  const scored = match.status === 'complete' || (match.games || []).length;
  if (scored && p1 && p2) return `${p1.handle} vs ${p2.handle} ${match.score1 ?? 0}/${match.score2 ?? 0}`;
  if (match.status === 'bye') return `${p1 ? p1.handle : p2.handle} vs BYE`;
  if (p1 && p2) return `${p1.handle} vs ${p2.handle}`;
  return p1 ? n1 : n2;
}

function matchPairingLine(match, entries) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  if (!p1 && !p2) return '';
  if (match.status === 'bye') return `${(p1 || p2).handle} vs BYE`;
  const n1 = p1 ? p1.handle : 'TBD';
  const n2 = p2 ? p2.handle : 'TBD';
  return `${n1} vs ${n2}`;
}

function pairingRoundOptions(t, matches) {
  const fmt = wantsLosers(t) ? 'double_elim' : (t && t.format);
  const list = matches || [];
  const rows = [];
  const push = (key, label, roundMatches) => {
    const ordered = (roundMatches || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    if (!ordered.length) return;
    rows.push({
      key,
      label,
      matches: ordered,
      seated: ordered.some((m) => m.entry1Id || m.entry2Id),
      open: ordered.some((m) => m.status !== 'complete' && m.status !== 'bye'),
    });
  };
  const namedGroups = [...new Set(list.map((m) => m.group).filter(Boolean))];
  for (const g of namedGroups) {
    const ofG = list.filter((m) => m.group === g);
    const maxR = ofG.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
    for (let r = 1; r <= maxR; r += 1) {
      push(`pool:${g}:${r}`, `Group ${g} · ${roundLabel(fmt, 'group', r, maxR)}`, ofG.filter((m) => Number(m.round) === r));
    }
  }
  for (const roundMatches of groupRounds(list.filter((m) => m.side === 'group' && !m.group), 'group')) {
    const r = Number(roundMatches[0].round) || 1;
    push(`group:${r}`, roundLabel(fmt, 'group', r, t && t.swissRounds), roundMatches);
  }
  for (const side of ['winners', 'losers', 'grand', 'placement', 'title']) {
    const ofSide = list.filter((m) => m.side === side);
    const maxR = ofSide.reduce((n, m) => Math.max(n, Number(m.round) || 0), 0);
    for (const roundMatches of groupRounds(list, side)) {
      const r = Number(roundMatches[0].round) || 1;
      push(`${side}:${r}`, roundLabel(fmt, side, r, maxR), roundMatches);
    }
  }
  return rows;
}

function defaultPairingRoundKey(options) {
  const list = options || [];
  const seatedOpen = list.filter((o) => o.seated && o.open);
  if (seatedOpen.length) return seatedOpen[seatedOpen.length - 1].key;
  const seated = list.filter((o) => o.seated);
  if (seated.length) return seated[seated.length - 1].key;
  return (list[0] && list[0].key) || '';
}

function pairingsSection(data, roundOpt) {
  if (!roundOpt) return null;
  const entries = (data && data.entries) || [];
  const rows = (roundOpt.matches || []).map((m) => matchPairingLine(m, entries)).filter(Boolean);
  if (!rows.length) return null;
  return { label: roundOpt.label, rows, featured: true };
}

function pairingsText(data, roundOpt) {
  const t = data && data.tournament;
  const lines = ['Doginal Dogs Legends Brackets'];
  if (t && t.name) lines.push(String(t.name).trim());
  const section = pairingsSection(data, roundOpt);
  if (!section) {
    lines.push('', 'No pairings for this round yet.');
    return lines.join('\n');
  }
  lines.push('', section.label, ...section.rows);
  return lines.join('\n');
}

function roundistsLabel(format, side, round, maxRound) {
  if (side === 'title') return 'Battling reigning champ';
  if (format === 'swiss') return `Swiss Round ${round}`;
  if (format === 'round_robin') return `Round ${round}`;
  if (side === 'grand') return Number(round) === 1 ? 'Grand Finalists' : 'Grand Final Reset';
  if (side === 'placement') return '3rd place';
  if (side === 'losers') return `Losers R${round}`;
  const depth = Math.max(1, (maxRound || round) - round + 1);
  const remaining = 2 ** depth;
  if (remaining === 2) return 'Finalists';
  if (remaining === 4) return 'Semi-Finalists';
  if (remaining === 8) return 'Quarter Finalists';
  return `Round of ${remaining}`;
}

function roundResultsSections(data) {
  const t = data && data.tournament;
  const entries = (data && data.entries) || [];
  const matches = (data && data.matches) || [];
  const sections = [];
  if (!t || !matches.length) return sections;
  const emit = (label, list) => {
    const rows = (list || []).map((m) => matchShareLine(m, entries)).filter(Boolean);
    if (!rows.length) return;
    sections.push({ label, rows, featured: /Finalists|Semi-Finalists|Quarter Finalists|reigning champ/i.test(label) });
  };
  const groups = [...new Set(matches.map((m) => m.group).filter(Boolean))];
  for (const g of groups) {
    const ofG = matches.filter((m) => m.group === g).sort((a, b) => a.round - b.round || a.position - b.position);
    const maxR = ofG.reduce((n, m) => Math.max(n, m.round), 0);
    for (let r = 1; r <= maxR; r++) {
      const list = ofG.filter((m) => m.round === r);
      if (list.length) emit(`Group ${g} · ${roundistsLabel(t.format, 'group', r, maxR)}`, list);
    }
  }
  for (const roundMatches of groupRounds(matches.filter((m) => m.side === 'group' && !m.group), 'group')) {
    emit(roundistsLabel(t.format, 'group', roundMatches[0].round, t.swissRounds), roundMatches);
  }
  const treeFmt = wantsLosers(t) ? 'double_elim' : t.format;
  for (const side of ['winners', 'losers', 'grand', 'placement']) {
    const ofSide = matches.filter((m) => m.side === side);
    const maxR = ofSide.reduce((n, m) => Math.max(n, m.round), 0);
    for (const roundMatches of groupRounds(matches, side)) {
      emit(roundistsLabel(treeFmt, side, roundMatches[0].round, maxR), roundMatches);
    }
  }
  if (t.reigningChamp) {
    const champ = entries.find((e) => e.id === Number(t.reigningChampEntryId));
    const titleMatches = matches.filter((m) => m.side === 'title');
    const rows = titleMatches.map((m) => matchShareLine(m, entries)).filter(Boolean);
    if (!rows.length) rows.push(champ ? champ.handle : 'The reigning champ');
    sections.push({ label: 'Battling reigning champ', rows, featured: true });
  }
  if (t.status === 'completed' && data.champion && data.champion.handle) {
    sections.push({ label: 'Champion', rows: [data.champion.handle], featured: true });
  }
  return sections;
}

function roundResultsText(data, sections) {
  const t = data && data.tournament;
  const list = sections || roundResultsSections(data);
  const lines = ['Doginal Dogs Legends Brackets'];
  if (t && t.name) lines.push(String(t.name).trim());
  if (!list.length) {
    lines.push('', 'No completed matches yet.');
    return lines.join('\n');
  }
  for (const section of list) {
    lines.push('', section.label);
    lines.push(...section.rows);
  }
  return lines.join('\n');
}

function sectionsForShareCard(sections) {
  const list = sections || [];
  const champ = list.filter((s) => /reigning champ/i.test(s.label));
  const featured = list.filter((s) => s.featured && !/reigning champ/i.test(s.label));
  if (featured.length) {
    const latest = featured[featured.length - 1];
    const prev = featured[featured.length - 2];
    const pick = [];
    if (prev && latest.rows.length <= 2 && prev.rows.length <= 4) pick.push(prev);
    pick.push(latest);
    const champion = pick.filter((s) => s.label === 'Champion');
    const others = pick.filter((s) => s.label !== 'Champion');
    return others.concat(champ, champion);
  }
  const rest = list.filter((s) => !/reigning champ/i.test(s.label)).slice(-1);
  return rest.concat(champ);
}

const SHARE_CARD_W = 1200;
const SHARE_CARD_H = 630;
const SHARE_GOLD = '#e8a317';
const SHARE_CREAM = '#f6e7c8';
const SHARE_MUTED = '#c4a574';

function loadShareImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function coverDraw(ctx, img, x, y, w, h) {
  if (!img || !img.width) return;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function canvasWrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const trial = `${current} ${words[i]}`;
    if (ctx.measureText(trial).width <= maxWidth) current = trial;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function fitCanvasFont(ctx, text, family, weight, start, floor, maxWidth) {
  let size = start;
  while (size > floor) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return floor;
}

async function drawRoundResultsCard(data, sections) {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready.catch(() => {});
  }
  const [flames, crest] = await Promise.all([
    loadShareImg('/bracket/flames.jpg').catch(() => null),
    loadShareImg('/bracket/crest.jpg').catch(() => null),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_W;
  canvas.height = SHARE_CARD_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#120804';
  ctx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);
  if (flames) coverDraw(ctx, flames, 0, 0, SHARE_CARD_W, SHARE_CARD_H);
  ctx.fillStyle = 'rgba(12, 6, 2, 0.38)';
  ctx.fillRect(0, 0, SHARE_CARD_W, SHARE_CARD_H);

  const crestSize = 236;
  const pad = 56;
  const gap = 36;
  const textX = pad + crestSize + gap;
  const textMax = SHARE_CARD_W - textX - pad;
  const serif = 'Cinzel, Palatino, serif';
  const sans = '"Source Sans 3", system-ui, sans-serif';
  const eventName = String((data && data.tournament && data.tournament.name) || '').trim();
  const shareSections = sectionsForShareCard(sections);
  const rows = [];
  for (const section of shareSections) {
    if (rows.length) rows.push({ kind: 'gap' });
    rows.push({ kind: 'label', text: section.label });
    for (const line of section.rows) rows.push({ kind: 'row', text: line });
  }
  if (!rows.length) rows.push({ kind: 'row', text: 'No completed matches yet.' });

  ctx.textBaseline = 'top';
  const kickerSize = 26;
  const titleSize = fitCanvasFont(ctx, 'LEGENDS BRACKETS', serif, 900, 52, 28, textMax);
  ctx.font = `600 24px ${serif}`;
  const nameLines = eventName ? canvasWrap(ctx, eventName.toUpperCase(), textMax).slice(0, 2) : [];
  let fontSize = 28;
  const headerH = kickerSize + 12 + titleSize + 16 + (nameLines.length ? nameLines.length * 32 + 10 : 0);
  const available = SHARE_CARD_H - 96 - Math.max(crestSize, headerH);
  const measureRows = (size) => {
    let h = 0;
    for (const row of rows) {
      if (row.kind === 'gap') h += size * 0.4;
      else h += size * (row.kind === 'label' ? 1.2 : 1.32);
    }
    return h;
  };
  while (fontSize > 16 && measureRows(fontSize) > available) fontSize -= 1;
  const blockH = Math.max(crestSize, headerH + measureRows(fontSize));
  let y = Math.max(48, Math.round((SHARE_CARD_H - blockH) / 2));
  const crestY = y + Math.round((Math.max(crestSize, headerH) - crestSize) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(12, 6, 2, 0.8)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  if (crest) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(pad + crestSize / 2, crestY + crestSize / 2, crestSize / 2 - 3, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    coverDraw(ctx, crest, pad, crestY, crestSize, crestSize);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(pad + crestSize / 2, crestY + crestSize / 2, crestSize / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = SHARE_GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  ctx.fillStyle = SHARE_GOLD;
  ctx.font = `700 ${kickerSize}px ${serif}`;
  ctx.fillText('DOGINAL DOGS', textX, y);
  y += kickerSize + 12;
  ctx.fillStyle = SHARE_CREAM;
  ctx.font = `900 ${titleSize}px ${serif}`;
  ctx.fillText('LEGENDS BRACKETS', textX, y);
  y += titleSize + 16;
  if (nameLines.length) {
    ctx.fillStyle = SHARE_MUTED;
    ctx.font = `600 24px ${serif}`;
    for (const line of nameLines) {
      ctx.fillText(line, textX, y);
      y += 32;
    }
    y += 10;
  }
  for (const row of rows) {
    if (row.kind === 'gap') {
      y += fontSize * 0.4;
      continue;
    }
    if (row.kind === 'label') {
      ctx.fillStyle = SHARE_GOLD;
      ctx.font = `700 ${fontSize}px ${serif}`;
      ctx.fillText(String(row.text || '').toUpperCase(), textX, y);
      y += fontSize * 1.2;
    } else {
      ctx.fillStyle = SHARE_CREAM;
      ctx.font = `600 ${Math.max(18, fontSize - 1)}px ${sans}`;
      const wrapped = canvasWrap(ctx, row.text, textMax);
      for (const line of wrapped.slice(0, 2)) {
        ctx.fillText(line, textX, y);
        y += fontSize * 1.32;
      }
    }
  }
  ctx.restore();
  return canvas;
}

async function copyCanvasPng(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not build image');
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard images are not supported here');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  } catch (_err) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blob) })]);
  }
}

function downloadBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function isOpeningMatch(t, match) {
  if (!match || Number(match.round) !== 1) return false;
  return match.side === 'winners' || match.side === 'group';
}

function usesElimTree(t) {
  if (!t) return false;
  if (t.stage === 'playoff') return true;
  if (t.stage === 'groups') return false;
  return t.format !== 'swiss' && t.format !== 'round_robin';
}

function lateSeatOptions(t, matches, entries) {
  if (!usesElimTree(t)) {
    return [{
      value: 'auto',
      label: t.format === 'round_robin' || t.stage === 'groups'
        ? 'Add matches against the field'
        : 'Join the field for the next round',
    }];
  }
  const opening = (matches || []).filter((m) => isOpeningMatch(t, m) && m.status !== 'complete');
  const out = [];
  for (const m of opening) {
    const p1 = entryOf(entries, m.entry1Id);
    const p2 = entryOf(entries, m.entry2Id);
    if (m.status === 'bye') {
      const who = p1 || p2;
      out.push({ value: `${m.id}:${p1 ? 2 : 1}`, label: `Play ${who ? who.handle : 'BYE'} (fill bye)` });
    } else if (!p1 || !p2) {
      out.push({
        value: `${m.id}:${p1 ? 2 : 1}`,
        label: `Fill empty slot${p1 || p2 ? ` vs ${(p1 || p2).handle}` : ''}`,
      });
    } else if (m.status === 'ready') {
      out.push({ value: `${m.id}:1`, label: `Replace ${p1.handle} (vs ${p2.handle})` });
      out.push({ value: `${m.id}:2`, label: `Replace ${p2.handle} (vs ${p1.handle})` });
    }
  }
  return out;
}

function flashBtn(btn, okText, failText) {
  const label = btn.textContent;
  btn.textContent = okText;
  setTimeout(() => { btn.textContent = failText || label; }, 1400);
}

function openExportSheet(data, slug) {
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  const sections = roundResultsSections(data);
  const body = roundResultsText(data, sections);
  const fileBase = `${slug || 'arena'}-round-results`;
  overlay.innerHTML = `<div class="scorecard export-sheet" role="dialog" aria-modal="true">
    <div class="row">
      <h2>Round results</h2>
      <button type="button" class="copy" id="ex-close">Close</button>
    </div>
    <p class="muted">Share card for X and other apps. Copy the image, or copy the text under it.</p>
    <div class="export-preview-wrap">
      <img class="export-preview is-wait" id="ex-preview" alt="Doginal Dogs Legends Brackets round results">
    </div>
    <details class="export-text-fold">
      <summary>Text for X</summary>
      <pre class="export-text" id="ex-text">${esc(body)}</pre>
    </details>
    <div class="sc-actions">
      <button class="btn" type="button" id="ex-copy-img">Copy image</button>
      <button class="btn ghost" type="button" id="ex-copy-text">Copy text</button>
      <button class="btn ghost" type="button" id="ex-download-img">Download image</button>
    </div>
  </div>`;
  overlay.querySelector('#ex-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector('#ex-copy-text').onclick = async (event) => {
    const btn = event.currentTarget;
    try {
      await navigator.clipboard.writeText(body);
      flashBtn(btn, 'Copied');
    } catch (_err) {
      flashBtn(btn, 'Select & copy');
    }
  };
  let cardCanvas = null;
  const preview = overlay.querySelector('#ex-preview');
  const ready = drawRoundResultsCard(data, sections).then((canvas) => {
    cardCanvas = canvas;
    preview.src = canvas.toDataURL('image/png');
    preview.classList.remove('is-wait');
    return canvas;
  }).catch(() => {
    preview.alt = 'Could not draw the share card';
    return null;
  });
  overlay.querySelector('#ex-copy-img').onclick = async (event) => {
    const btn = event.currentTarget;
    try {
      const canvas = cardCanvas || await ready;
      if (!canvas) throw new Error('missing');
      await copyCanvasPng(canvas);
      flashBtn(btn, 'Copied — paste in X');
    } catch (_err) {
      flashBtn(btn, 'Save the image');
    }
  };
  overlay.querySelector('#ex-download-img').onclick = async () => {
    const canvas = cardCanvas || await ready;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${fileBase}.png`);
    }, 'image/png');
  };
  document.body.appendChild(overlay);
}

function openPairingsExportSheet(data, slug) {
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  const t = data && data.tournament;
  const rounds = pairingRoundOptions(t, data && data.matches);
  let currentKey = defaultPairingRoundKey(rounds);
  const roundOf = (key) => rounds.find((r) => r.key === key) || rounds[0] || null;
  const slugSafe = String(slug || 'arena').replace(/[^\w.-]+/g, '-');
  const fileSlug = (round) => {
    const label = String((round && round.label) || 'round')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'round';
    return `${slugSafe}-who-plays-who-${label}`;
  };
  overlay.innerHTML = `<div class="scorecard export-sheet" role="dialog" aria-modal="true">
    <div class="row">
      <h2>Who plays who</h2>
      <button type="button" class="copy" id="ex-close">Close</button>
    </div>
    <p class="muted">Pick a round to share the matchups. Copy the image or the text list.</p>
    <div class="export-round-pick">
      <label for="ex-round">Round</label>
      <select id="ex-round"${rounds.length ? '' : ' disabled'}>
        ${rounds.length
          ? rounds.map((r) => `<option value="${esc(r.key)}" ${r.key === currentKey ? 'selected' : ''}>${esc(r.label)}</option>`).join('')
          : '<option value="">No rounds yet</option>'}
      </select>
    </div>
    <div class="export-preview-wrap">
      <img class="export-preview is-wait" id="ex-preview" alt="Doginal Dogs Legends Brackets who plays who">
    </div>
    <details class="export-text-fold" open>
      <summary>Matchup list</summary>
      <pre class="export-text" id="ex-text"></pre>
    </details>
    <div class="sc-actions">
      <button class="btn" type="button" id="ex-copy-img" ${rounds.length ? '' : 'disabled'}>Copy image</button>
      <button class="btn ghost" type="button" id="ex-copy-text" ${rounds.length ? '' : 'disabled'}>Copy text</button>
      <button class="btn ghost" type="button" id="ex-download-img" ${rounds.length ? '' : 'disabled'}>Download image</button>
    </div>
  </div>`;
  overlay.querySelector('#ex-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const textEl = overlay.querySelector('#ex-text');
  const preview = overlay.querySelector('#ex-preview');
  const roundSelect = overlay.querySelector('#ex-round');
  let cardCanvas = null;
  let body = '';
  let drawToken = 0;
  let ready = Promise.resolve(null);

  const refresh = () => {
    const round = roundOf(currentKey);
    body = pairingsText(data, round);
    textEl.textContent = body;
    const section = pairingsSection(data, round) || {
      label: (round && round.label) || 'Who plays who',
      rows: ['No pairings for this round yet.'],
      featured: true,
    };
    const sections = [section];
    const token = ++drawToken;
    preview.classList.add('is-wait');
    cardCanvas = null;
    ready = drawRoundResultsCard(data, sections).then((canvas) => {
      if (token !== drawToken) return null;
      cardCanvas = canvas;
      preview.src = canvas.toDataURL('image/png');
      preview.classList.remove('is-wait');
      return canvas;
    }).catch(() => {
      if (token !== drawToken) return null;
      preview.alt = 'Could not draw the share card';
      preview.classList.remove('is-wait');
      return null;
    });
    return ready;
  };

  if (roundSelect) {
    roundSelect.onchange = () => {
      currentKey = roundSelect.value;
      refresh();
    };
  }
  refresh();

  overlay.querySelector('#ex-copy-text').onclick = async (event) => {
    const btn = event.currentTarget;
    try {
      await navigator.clipboard.writeText(body);
      flashBtn(btn, 'Copied');
    } catch (_err) {
      flashBtn(btn, 'Select & copy');
    }
  };
  overlay.querySelector('#ex-copy-img').onclick = async (event) => {
    const btn = event.currentTarget;
    try {
      const canvas = cardCanvas || await ready;
      if (!canvas) throw new Error('missing');
      await copyCanvasPng(canvas);
      flashBtn(btn, 'Copied — paste in X');
    } catch (_err) {
      flashBtn(btn, 'Save the image');
    }
  };
  overlay.querySelector('#ex-download-img').onclick = async () => {
    const canvas = cardCanvas || await ready;
    if (!canvas) return;
    const round = roundOf(currentKey);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${fileSlug(round)}.png`);
    }, 'image/png');
  };
  document.body.appendChild(overlay);
}

function avatarHtml(name) {
  const letter = String(name || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
  return `<span class="avatar" aria-hidden="true">${esc(letter)}</span>`;
}

function pfpHtml(user, name, size) {
  const display = String(name || (user && (user.tourneyHandle || user.discordUsername)) || '?');
  const src = avatarUrlForUser(user);
  if (!src) return avatarHtml(display);
  const dim = Number(size) || 32;
  const letter = esc((display.replace(/[^a-zA-Z0-9]/g, '').slice(0, 1) || '?').toUpperCase());
  return `<img class="player-pfp" src="${esc(src)}" alt="" width="${dim}" height="${dim}" style="width:${dim}px;height:${dim}px" referrerpolicy="no-referrer" decoding="async" onerror="this.onerror=null;this.outerHTML='<span class=\\'avatar\\' aria-hidden=\\'true\\'>${letter}</span>'">`;
}

function playerSuggestHandle(player) {
  return String((player && (player.tourneyHandle || player.discordUsername)) || '').trim();
}

function pickSuggestedPlayer(input, player) {
  if (!input) return;
  const handle = playerSuggestHandle(player);
  if (handle) input.value = handle;
  input.dataset.userId = player && player.id ? String(player.id) : '';
}

function pickedUserId(input) {
  const stored = Number(input && input.dataset && input.dataset.userId);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const typed = String((input && input.value) || '').trim().toLowerCase();
  const items = (input && input._kmxItems) || [];
  const hits = items.filter((player) => {
    const handle = playerSuggestHandle(player).toLowerCase();
    const discord = String(player.discordUsername || '').toLowerCase();
    return typed && (handle === typed || discord === typed);
  });
  const id = hits.length === 1 ? Number(hits[0].id) : 0;
  return id > 0 ? id : undefined;
}

function entryAvatarHtml(entry, size) {
  const user = entry && entry.discordUser;
  if (user && (user.avatarUrl || user.discordId)) return pfpHtml(user, entry.handle, size || 28);
  return avatarHtml(entry && entry.handle);
}

/**
 * Host "Add a player" typeahead: Discord-connected handles and Discord names
 * that contain the letters typed. Host-only — the search route checks the host password.
 */
function bindHandleTypeahead(input, listEl, takenHandles) {
  if (!input || !listEl) return;
  const wrap = input.closest('.handle-typeahead') || input.parentElement;
  const taken = new Set((takenHandles || []).map((h) => String(h || '').trim().toLowerCase()).filter(Boolean));
  let items = [];
  let active = -1;
  let seq = 0;
  let timer = 0;

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const hide = () => {
    listEl.hidden = true;
    listEl.innerHTML = '';
    items = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    setExpanded(false);
  };

  const paintList = () => {
    if (!items.length) {
      hide();
      return;
    }
    listEl.hidden = false;
    setExpanded(true);
    listEl.innerHTML = items.map((player, i) => {
      const handle = playerSuggestHandle(player);
      const discord = String(player.discordUsername || '').trim();
      const sub = discord && discord.toLowerCase() !== handle.toLowerCase()
        ? `<small>Discord · ${esc(discord)}</small>`
        : '<small>Discord connected</small>';
      const optId = `${input.id || 'handle'}-opt-${i}`;
      return `<li id="${optId}" role="option" aria-selected="${i === active ? 'true' : 'false'}">
        ${pfpHtml(player, handle, 28)}
        <span class="handle-suggest-text"><strong class="named-handle">${esc(handle)}${medalsInlineHtml(badgesFor(handle))}</strong>${sub}</span>
      </li>`;
    }).join('');
    listEl.querySelectorAll('li').forEach((li, i) => {
      li.onmousedown = (event) => {
        event.preventDefault();
        pickSuggestedPlayer(input, items[i]);
        hide();
        input.focus();
      };
    });
    const current = listEl.querySelector(`#${CSS.escape(input.id || 'handle')}-opt-${active}`);
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const runSearch = async (query) => {
    const id = ++seq;
    const q = String(query || '').trim();
    if (q.length < 1) {
      hide();
      return;
    }
    try {
      const pack = await api.get(`/players/search?q=${encodeURIComponent(q)}`);
      if (id !== seq) return;
      items = (pack.players || []).filter((player) => {
        const handle = playerSuggestHandle(player);
        return handle && !taken.has(handle.toLowerCase());
      });
      input._kmxItems = items;
      active = items.length ? 0 : -1;
      paintList();
    } catch (_err) {
      if (id !== seq) return;
      hide();
    }
  };

  input.addEventListener('input', () => {
    input.dataset.userId = '';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => runSearch(input.value), 160);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) runSearch(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (listEl.hidden || !items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % items.length;
      paintList();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + items.length) % items.length;
      paintList();
    } else if (event.key === 'Enter' && active >= 0) {
      pickSuggestedPlayer(input, items[active]);
      hide();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });
  if (wrap) {
    wrap.addEventListener('focusout', (event) => {
      if (!wrap.contains(event.relatedTarget)) hide();
    });
  }
}

function organizerDisplayName(t, hostUser) {
  return String(
    (hostUser && (hostUser.tourneyHandle || hostUser.discordUsername))
    || (t && t.hostName)
    || 'KushMetaX'
  ).trim() || 'KushMetaX';
}

function organizerHref(hostUser) {
  if (!hostUser) return '';
  const handle = String(hostUser.tourneyHandle || '').trim();
  if (handle) return `/tourney/#/player/${encodeURIComponent(handle)}`;
  if (hostUser.discordId) return `https://discord.com/users/${encodeURIComponent(String(hostUser.discordId))}`;
  return '';
}

function organizerHtml(t, hostUser) {
  const name = organizerDisplayName(t, hostUser);
  const href = organizerHref(hostUser);
  const inner = `${pfpHtml(hostUser, name, 32)}
            <div><small class="muted">Organized by</small><div class="org-name named-handle">${esc(name)}${medalsInlineHtml(badgesFor(name))}</div></div>`;
  const extra = href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
  if (href) {
    return `<a class="organizer" href="${esc(href)}"${extra} ${tip('Organizer of this hearth.')}>${inner}</a>`;
  }
  return `<div class="organizer" ${tip('Organizer of this hearth.')}>${inner}</div>`;
}

function resolveHostUser(t, apiHostUser) {
  if (apiHostUser && (apiHostUser.avatarUrl || apiHostUser.discordId || apiHostUser.tourneyHandle)) {
    return apiHostUser;
  }
  if (playerUser) {
    const name = String((t && t.hostName) || '').trim().toLowerCase();
    const aliases = [playerUser.tourneyHandle, playerUser.discordUsername]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase());
    if (name && aliases.includes(name)) return playerUser;
  }
  return apiHostUser || null;
}

// ---------------------------------------------------------------------------
// Bracket rendering
// ---------------------------------------------------------------------------

function matchTip(match, asHost, playerCanReport) {
  if (match.status === 'ready' && (match.games || []).length) {
    const running = `In progress ${match.score1 ?? 0}–${match.score2 ?? 0}.`;
    return asHost ? `${running} Open the scorecard to finish and lock the series.` : running;
  }
  if (match.status === 'ready') {
    if (asHost) return 'Ready match. Open the scorecard and report each game.';
    if (playerCanReport) return 'Your match. Submit the score — your opponent confirms, or the host overrides.';
    return 'Ready to play.';
  }
  if (match.status === 'bye') return 'Bye — this player advances because the other slot is empty.';
  if (match.status === 'complete') return asHost ? 'Series locked. Open to unlock and edit this round.' : 'Series locked. Gold check marks the winner.';
  return 'Waiting for a player from the previous round.';
}

function matchCardHtml(match, entries, votes, opts) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  const hostEdit = Boolean(opts && opts.hostEdit);
  const asHost = Boolean(opts && (opts.asHost || opts.hostEdit));
  const swapPick = Boolean(opts && opts.swapPick);
  const picked = new Set((opts && opts.swapSelected || []).map((id) => String(id)));
  const pairPicked = new Set((opts && opts.pairSelected || []).map((id) => String(id)));
  const canEdit = hostEdit && matchEditable(match);
  const playerCanReport = Boolean(opts && opts.playerMatchIds && opts.playerMatchIds.has(match.id) && match.status === 'ready');
  const clickable = !hostEdit && !swapPick && (asHost || playerCanReport) && (match.status === 'ready' || (asHost && match.status === 'complete'));
  const empty = match.status === 'bye' ? 'BYE' : 'TBD';
  const field = fieldEntries(entries);
  const v1 = (votes || []).filter((v) => v.matchId === match.id && v.winnerId === match.entry1Id).length;
  const v2 = (votes || []).filter((v) => v.matchId === match.id && v.winnerId === match.entry2Id).length;
  const slotInner = (entry, score, fallback) => `${entry
    ? `<em>${entry.seed || ''}</em>${avatarHtml(entry.handle)}<span class="who"><span class="who-name">${esc(entry.handle)}</span>${entryMarksHtml(entry)}</span>`
    : `<span class="who tbd">${fallback}</span>`}
      <span class="pts">${score ?? ''}</span>
      <span class="mark">✓</span>`;
  const slotPicker = (entry, slotNum) => {
    const current = entry ? String(entry.id) : '';
    return `<select class="slot-edit" data-place-match="${match.id}" data-place-slot="${slotNum}" aria-label="${entry ? `Who should play ${entry.handle}` : `Seat ${slotNum}`}">
      <option value="">TBD</option>
      ${field.map((e) => `<option value="${esc(String(e.id))}" ${String(e.id) === current ? 'selected' : ''}>${esc(`#${e.seed || '–'} ${e.handle}`)}</option>`).join('')}
    </select>`;
  };
  const slot = (entry, score, won, fallback, slotNum) => {
    if (canEdit) {
      const key = seatKey(match.id, slotNum);
      const pairId = entry ? String(entry.id) : '';
      const pickedClass = (swapPick ? picked.has(key) : pairId && pairPicked.has(pairId)) ? ' picked' : '';
      const emptyClass = entry ? '' : ' empty';
      const pickBtn = swapPick
        ? `<button type="button" class="slot swap-slot${won ? ' winner' : ''}${pickedClass}${emptyClass}" data-swap-seat="${esc(key)}" ${tip(entry ? `Select ${entry.handle}` : 'Select empty seat')}>${slotInner(entry, score, fallback)}</button>`
        : `<button type="button" class="slot swap-slot${won ? ' winner' : ''}${pickedClass}${emptyClass}" ${pairId ? `data-pair-entry="${esc(pairId)}"` : 'disabled'} ${tip(entry ? `Tap ${entry.handle}, then tap who they should play` : 'Empty seat — use the list below to fill it')}>${slotInner(entry, score, fallback)}</button>`;
      return `${pickBtn}${slotPicker(entry, slotNum)}`;
    }
    return `<div class="slot ${won ? 'winner' : ''}">${slotInner(entry, score, fallback)}</div>`;
  };
  const live = match.status === 'ready' && (match.games || []).length > 0;
  const slug = opts && opts.slug;
  const twoSeated = Boolean(match.entry1Id && match.entry2Id);
  const tableOk = twoSeated && (match.status === 'ready' || match.status === 'complete');
  const tableLink = slug && tableOk
    ? `<a class="table-link" href="${esc(tableHref(slug, match.id))}" ${tip(match.status === 'complete' ? 'Open the table archive — lists and the locked score stay here.' : 'Open the IRL table. Only the Discord owner of this seat can sit.')}>Table</a>`
    : '';
  const classes = [
    'match-card',
    clickable || (hostEdit && match.status === 'ready') ? 'ready' : '',
    hostEdit || swapPick ? 'swap-mode' : '',
    canEdit ? 'host-edit' : '',
    live ? 'live' : '',
    match.status,
    opts && opts.finals ? 'finals' : '',
  ].filter(Boolean).join(' ');
  const actions = (hostEdit || playerCanReport) ? [
    match.status === 'ready' ? `<button type="button" class="mini go" data-match="${match.id}">${hostEdit ? 'Report series' : 'Submit score'}</button>` : '',
    hostEdit && match.status === 'complete' ? `<button type="button" class="mini" data-reset-match="${match.id}" ${tip('Unlock this series and later matches that used it, so you can edit this round.')}>Unlock series</button>` : '',
  ].filter(Boolean).join('') : (swapPick && match.status === 'complete'
    ? `<button type="button" class="mini" data-reset-match="${match.id}">Unlock series</button>`
    : '');
  const body = `${slot(p1, match.score1, match.winnerId === match.entry1Id && match.status === 'complete', empty, 1)}
    ${slot(p2, match.score2, match.winnerId === match.entry2Id && match.status === 'complete', empty, 2)}
    ${v1 + v2 ? `<div class="votes">Votes ${v1}–${v2}</div>` : ''}
    ${actions}`;
  if (hostEdit || swapPick) return `<div class="${classes}">${body}${tableLink}</div>`;
  const hit = clickable
    ? `<button type="button" class="match-card-hit" data-match="${match.id}" ${tip(matchTip(match, asHost, playerCanReport))}>${body}</button>`
    : `<div class="match-card-hit">${body}</div>`;
  return `<div class="${classes}">${hit}${tableLink}</div>`;
}

function bracketColumnsHtml(matches, entries, side, format, votes, opts) {
  const rounds = groupRounds(matches, side);
  if (!rounds.length) return '';
  const maxRound = rounds.length;
  return `<div class="bracket-stage">
    <div class="bracket-stage-bar">
      <span class="bracket-stage-hint">Pan the tree</span>
      <div class="bracket-stage-acts">
        <button type="button" class="mini" data-bracket-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="mini" data-bracket-zoom="fit" aria-label="Fit bracket in view">Fit</button>
        <button type="button" class="mini" data-bracket-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" class="mini" data-bracket-fs aria-pressed="false" ${tip('Fill the screen for an IRL display. Esc exits.')}>Full screen</button>
      </div>
    </div>
    <div class="bracket-port" tabindex="0" aria-label="Tournament bracket. Drag or scroll to pan.">
      <div class="bracket-sizer">
        <div class="bracket-tree${rounds[0].length >= 16 ? ' slots-xl' : rounds[0].length >= 8 ? ' slots-lg' : ''}" style="--slots:${rounds[0].length}">
          ${rounds.map((roundMatches, i) => {
            const next = rounds[i + 1];
            const feed = !next ? 'end' : (next.length === roundMatches.length ? 'line' : 'pair');
            const label = roundLabel(format, side, roundMatches[0].round, maxRound);
            const bo = bestOfLabel(roundMatches[0].bestOf);
            const finals = /final/i.test(label);
            return `<div class="bracket-round feed-${feed}${finals ? ' is-final' : ''}">
              <header ${tip(`${label} is ${bo}.`)}>
                <span>${esc(label)}</span>
                <span class="round-tag">${esc(bo)}</span>
              </header>
              <div class="bracket-slots">
                ${roundMatches.map((m) => `<div class="bracket-slot">
                  <i class="in-line" aria-hidden="true"></i>
                  ${matchCardHtml(m, entries, votes, { ...opts, finals })}
                  <i class="out-h" aria-hidden="true"></i>
                  <i class="out-v" aria-hidden="true"></i>
                </div>`).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function bracketHtml(data, opts) {
  const { tournament: t, entries, matches, votes } = data;
  const nextOpts = { ...(opts || {}), slug: t.slug };
  if (!matches.length) {
    if (t && t.restoredFromRecords) {
      return `<p class="muted">This arena was rebuilt from official records. The live match tree was not in the archive, so the roster and standings are the source of truth.</p>`;
    }
    return '';
  }
  const treeMatches = matches.filter((m) => m.side === 'winners' || m.side === 'losers' || m.side === 'grand' || m.side === 'placement');
  const tree = treeMatches.length > 0 || t.format === 'single_elim' || t.format === 'double_elim' || t.stage === 'playoff';
  const playoffFormat = wantsLosers(t) ? 'double_elim' : 'single_elim';
  let body = '';
  const groups = [...new Set(matches.map((m) => m.group).filter(Boolean))];
  if (groups.length) {
    body += groups.map((g) => `
      <section class="bracket-section">
        <h2>Group ${g}</h2>
        <div class="grid cards">${matches.filter((m) => m.group === g).map((m) => matchCardHtml(m, entries, votes, nextOpts)).join('')}</div>
      </section>`).join('');
  }
  const groupSide = matches.filter((m) => m.side === 'group' && !m.group);
  if (groupSide.length) {
    body += groupRounds(groupSide, 'group').map((roundMatches) => `
      <section class="bracket-section">
        <h2>${esc(roundLabel(t.format, 'group', roundMatches[0].round, t.swissRounds))}
          <small>${esc(bestOfLabel(roundMatches[0].bestOf))}</small>
        </h2>
        <div class="grid cards">${roundMatches.map((m) => matchCardHtml(m, entries, votes, nextOpts)).join('')}</div>
      </section>`).join('');
  }
  if (tree && playoffFormat === 'double_elim' && matches.some((m) => m.side === 'losers' || m.side === 'grand')) {
    body += `<section class="bracket-section"><h2>Winners</h2>${bracketColumnsHtml(matches, entries, 'winners', playoffFormat, votes, nextOpts)}</section>
      <section class="bracket-section"><h2>Losers</h2>${bracketColumnsHtml(matches, entries, 'losers', playoffFormat, votes, nextOpts)}</section>
      <section class="bracket-section"><h2>Grand Final</h2>${bracketColumnsHtml(matches, entries, 'grand', playoffFormat, votes, nextOpts)}</section>`;
  } else if (tree && treeMatches.length) {
    body += bracketColumnsHtml(matches.filter((m) => !m.group && m.side !== 'group'), entries, 'winners', playoffFormat, votes, nextOpts);
    if (matches.some((m) => m.side === 'placement')) {
      body += `<section class="bracket-section"><h2>3rd place</h2>${bracketColumnsHtml(matches, entries, 'placement', playoffFormat, votes, nextOpts)}</section>`;
    }
  }
  if (matches.some((m) => m.side === 'title')) {
    const champEntry = entries.find((e) => e.id === Number(t.reigningChampEntryId));
    const champName = (champEntry && champEntry.handle) || 'The reigning champ';
    body += `<section class="bracket-section title-section">
      <h2>Title match <small>${esc(champName)} defends the belt</small></h2>
      <p class="muted">The champ sits out the field. Whoever wins the bracket takes this seat.</p>
      <div class="grid cards">${matches.filter((m) => m.side === 'title').map((m) => matchCardHtml(m, entries, votes, nextOpts)).join('')}</div>
    </section>`;
  }
  return body;
}

function readRoundBestOf(panel) {
  const out = {};
  panel.querySelectorAll('[data-round-bestof]').forEach((sel) => {
    out[sel.getAttribute('data-round-bestof')] = Number(sel.value);
  });
  return out;
}

function roundRulesHtml(format, count, swissRounds, bestOf, roundBestOf, losersBracket, breakTies, finalsBestOf) {
  const rows = expectedRounds(format, count, swissRounds, losersBracket, breakTies);
  if (!rows.length) return '';
  return `<div class="round-rules">
    ${rows.map((row) => {
      const key = roundKey(row.side, row.round);
      const finals = BEST_OF.includes(Number(finalsBestOf)) ? Number(finalsBestOf) : null;
      const value = (roundBestOf && roundBestOf[key]) || (isFinalsRuleRow(row) && finals) || bestOf || 3;
      return `<label class="rule-row"><span>${esc(row.label)}</span>
        <select data-round-bestof="${esc(key)}">
          ${BEST_OF.map((n) => `<option value="${n}" ${Number(value) === n ? 'selected' : ''}>${esc(bestOfLabel(n))}</option>`).join('')}
        </select>
      </label>`;
    }).join('')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Settings sheet (host only)
// ---------------------------------------------------------------------------

function defaultsFrom(t, creating) {
  const d = t || {};
  return {
    eventKind: sanitizeEventKind(d.eventKind, d.name),
    hostName: d.hostName || (playerUser && (playerUser.tourneyHandle || playerUser.discordUsername)) || 'KushMetaX',
    treasury: sanitizeDogeAddressInput(d.treasury) || PAY_TO.DOGE,
    name: d.name || '',
    slug: d.slug || '',
    description: d.description || '',
    streamUrl: d.streamUrl || '',
    game: d.game || 'Doginal Dogs Legends TCG',
    stageType: d.stageType || 'single',
    format: d.format === 'double_elim' ? 'single_elim' : (d.format || 'single_elim'),
    losersBracket: d.losersBracket != null ? Boolean(d.losersBracket) : d.format === 'double_elim' || d.playoffFormat === 'double_elim',
    playoffFormat: d.playoffFormat || 'single_elim',
    breakTies: Boolean(d.breakTies),
    registrationMode: d.registrationMode === 'list' ? 'list' : 'signup',
    whitelistOn: Number(d.whitelistSpots) > 0 || d.registrationMode === 'whitelist',
    whitelistSpots: Number(d.whitelistSpots) > 0 ? Number(d.whitelistSpots) : 2,
    feeMode: d.feeMode === 'charity' ? 'charity' : (d.feeMode || (Number(d.entryFeeUsd) > 0 ? 'paid' : 'free')),
    charityName: d.charityName || '',
    xHandle: d.xHandle || '',
    acceptDoge: d.acceptDoge !== false,
    acceptUsdcSol: Boolean(d.acceptUsdcSol),
    solanaTreasury: sanitizeSolanaAddressInput(d.solanaTreasury) || PAY_TO.USDC_SOL,
    listsDueAt: d.listsDueAt ? String(d.listsDueAt).slice(0, 16) : '',
    listsPublicReveal: Boolean(d.listsPublicReveal),
    listsRevealOnMatchComplete: d.listsRevealOnMatchComplete !== false,
    entryFeeUsd: Number(d.entryFeeUsd) || 0,
    rewardMode: d.rewardMode === 'prize' ? 'prize' : 'pot',
    potFundMode: potFundModeOf(d),
    hostPotUsd: Number(d.hostPotUsd) || 0,
    addedPotUsd: Number(d.addedPotUsd) || 0,
    payouts: Array.isArray(d.payouts) ? d.payouts : [],
    requireTeams: Boolean(d.requireTeams),
    capPlayers: d.capPlayers !== false,
    maxPlayers: d.maxPlayers || 16,
    startAt: d.startAt ? String(d.startAt).slice(0, 16) : '',
    startTentative: Boolean(d.startTentative),
    timezone: d.timezone || hostDefaultTz(),
    requireCheckIn: Boolean(d.requireCheckIn),
    votingEnabled: Boolean(d.votingEnabled),
    predictionsEnabled: Boolean(d.predictionsEnabled),
    shareImages: Boolean(d.shareImages),
    requireVerifiedEmail: Boolean(d.requireVerifiedEmail),
    requireAccount: d.requireAccount !== false,
    official: d.official !== false,
    semiIrl: Boolean(d.semiIrl),
    requireRegisteredDeck: Boolean(d.requireRegisteredDeck),
    deckClassQuota: classQuotaOf(d),
    countryLock: Boolean(d.countryLock),
    allowedCountries: d.allowedCountries || '',
    predictionCustomFields: Boolean(d.predictionCustomFields),
    groupSize: d.groupSize || 4,
    advancePerGroup: d.advancePerGroup || 2,
    bestOf: BEST_OF.includes(Number(d.bestOf)) ? Number(d.bestOf) : 3,
    finalsBestOf: BEST_OF.includes(Number(d.finalsBestOf)) ? Number(d.finalsBestOf) : null,
  };
}

function radio(name, value, checked, label, hint) {
  return `<label><input type="radio" name="${esc(name)}" value="${esc(value)}" ${checked ? 'checked' : ''}> <span>${label}${hint ? `<small class="hint">${hint}</small>` : ''}</span></label>`;
}

function settingsHostFieldHtml(t, d, opts) {
  const creating = Boolean(opts && opts.creating);
  if (creating) {
    if (playerUser) {
      const name = playerUser.tourneyHandle || playerUser.discordUsername || d.hostName;
      return `<div>
            <div class="organizer organizer-preview">
              ${pfpHtml(playerUser, name, 32)}
              <div><small class="muted">Organized by</small><div class="org-name named-handle">${esc(name)}${medalsInlineHtml(badgesFor(name))}</div></div>
            </div>
            <input type="hidden" id="s-host" value="${esc(name)}">
            <p class="hint">Taken from Discord.</p>
          </div>`;
    }
    return `<div><input id="s-host" value="${esc(d.hostName)}" ${tip('Shown as the organizer on the public bracket page.')}>
          <p class="hint">Sign in with Discord so Organized by imports your name and PFP. Host as your handle to keep pack stats on this hearth.</p></div>`;
  }
  const hostUser = (opts && opts.hostUser) || resolveHostUser(t, opts && opts.hostUser);
  const name = organizerDisplayName(t, hostUser);
  return `<div>
            ${organizerHtml(t, hostUser)}
            <input type="hidden" id="s-host" value="${esc(name)}">
            <p class="hint">This stays the Discord account that created the arena. Admin saves do not change the host.</p>
          </div>`;
}

function settingsFormHtml(t, opts) {
  const creating = Boolean(opts && opts.creating);
  const d = defaultsFrom(t, creating);
  const payoutRows = payoutRowsFrom(d, creating);
  return `<section class="panel">
      <div class="panel-h">Basic info</div>
      <div class="panel-b">
        <div class="form-row"><span class="lbl">Host</span>
          ${settingsHostFieldHtml(t, d, opts)}
        </div>
        <div class="form-row"><label for="s-name">Tournament name <span class="req">*</span></label>
          <input id="s-name" required minlength="2" value="${esc(d.name)}" placeholder="Doginal Dogs Legends TCG Open" ${tip('Public title at the top of the bracket.')}></div>
        <div class="form-row"><span class="lbl">URL</span>
          <div class="slug-row">
            <span>/tourney/?t=</span>
            <input id="s-slug" value="${esc(d.slug)}" placeholder="auto" ${creating ? '' : 'readonly'} ${tip('Share this path. Shuffle makes a random code.')}>
            ${creating ? `<button type="button" class="copy" id="slug-shuffle" ${tip('Randomize the URL code.')}>Shuffle</button>` : ''}
          </div>
        </div>
        <div class="form-row"><label for="s-desc">Description</label>
          <textarea id="s-desc" maxlength="2000" ${tip('Rules, prize split, and notes. Players see this under the title.')}>${esc(d.description)}</textarea></div>
        <div class="form-row"><label for="s-stream">Kick stream</label>
          <div>
            <input id="s-stream" value="${esc(d.streamUrl)}" placeholder="https://kick.com/yourchannel" maxlength="240" ${tip('Paste a Kick channel while the arena is live, or a Kick VOD/clip after it ends. The link stays on this bracket.')}>
            <p class="hint">Live arenas embed Kick. After the night, paste the VOD if you want it kept on this bracket.</p>
          </div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h">Pot &amp; prizes</div>
      <div class="panel-b">
        <div class="form-row"><span class="lbl">Reward</span>
          <div>
            <div class="seg" id="reward-seg">
              <button type="button" data-reward="pot" class="${d.rewardMode !== 'prize' ? 'on' : ''}">Pot</button>
              <button type="button" data-reward="prize" class="${d.rewardMode === 'prize' ? 'on' : ''}">Prize</button>
            </div>
            <input type="hidden" id="s-reward" value="${esc(d.rewardMode)}">
            <p class="hint" id="reward-hint">${d.rewardMode === 'prize'
              ? 'Type what each place wins. Entry fees stay the entry — this list is the prize, not the pot.'
              : 'Choose a dollar pot or 65% of paid entries. Place percents split that redistributed pot. Extra cash or prizes on a place sit on top of it.'}</p>
          </div>
        </div>
        <div class="form-row" id="hostpot-row" style="${d.rewardMode === 'prize' ? 'display:none' : ''}"><span class="lbl">Prize pool</span>
          <div>
            <div class="seg" id="potfund-seg">
              <button type="button" data-potfund="usd" class="${d.potFundMode !== 'percent' ? 'on' : ''}">$</button>
              <button type="button" data-potfund="percent" class="${d.potFundMode === 'percent' ? 'on' : ''}">%</button>
            </div>
            <input type="hidden" id="s-potfund" value="${esc(d.potFundMode)}">
            <div id="hostpot-usd" style="${d.potFundMode === 'percent' ? 'display:none' : ''}">
              <label for="s-hostpot">Amount (USD)</label>
              <input id="s-hostpot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(d.hostPotUsd || 0)}" ${tip('This dollar amount is the pot players share. Entry fees are not added on top.')}>
              <p class="hint">Shows as Pot on the public page. Not total raised — only this redistributed amount.</p>
            </div>
            <div id="hostpot-pct" style="${d.potFundMode === 'percent' ? '' : 'display:none'}">
              <p class="hint">${PRIZE_POOL_PERCENT}% of paid entry fees is redistributed as the pot. The house retains ${HOUSE_RETAIN_PERCENT}%. Public Pot is that share, not total raised.</p>
              <label for="s-addedpot">Added to pot (USD)</label>
              <input id="s-addedpot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(d.addedPotUsd || 0)}" ${tip('Extra cash is added to the 65% pot, then split by the place percents below.')}>
              <p class="hint">Sponsor or host cash that joins the 65% pool. For a bonus that is not split, use +$ or Added prize on a place.</p>
            </div>
          </div>
        </div>
        <div class="form-row"><span class="lbl">By place</span>
          <div id="reward-fields" data-mode="${esc(d.rewardMode)}">
            <div id="payout-rows">
              ${payoutRows.map((row) => payoutRowHtml(row.place, row.percent, row.prize, row.addedUsd)).join('')}
            </div>
            <div class="row wrap" style="margin-top:10px">
              <button type="button" class="mini" id="payout-add">Add place</button>
            </div>
            <p class="hint" id="payout-extras-hint" style="${d.rewardMode === 'prize' ? 'display:none' : ''}">% splits the pot. +$ is extra cash for that winner. Added prize is packs, merch, or other extras — they stay on top of the percentage pool.</p>
            <p class="hint" id="payout-sum"></p>
            <div class="reward-preview" id="reward-preview"></div>
          </div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h">Game info</div>
      <div class="panel-b">
        <div class="form-row"><label for="s-game">Game <span class="req">*</span></label>
          <div><input id="s-game" list="game-list" value="${esc(d.game)}" ${tip('Helps people find this arena. Default is Doginal Dogs Legends TCG.')}>
          <datalist id="game-list">${GAMES.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
        </div>
        <div class="form-row"><span class="lbl">Type</span>
          <div class="choice" ${tip('A tournament is a field of 3+. A Grand Tournament is a flagship IRL event. A duel is a 1v1 series — winner and runner-up only.')}>
            ${radio('s-kind', 'tournament', d.eventKind !== 'duel' && d.eventKind !== 'grand', 'Tournament')}
            ${radio('s-kind', 'grand', d.eventKind === 'grand', 'Grand Tournament — flagship IRL events.')}
            ${radio('s-kind', 'duel', d.eventKind === 'duel', 'Duel — two players, one series.')}
          </div>
        </div>
        <div class="form-row tourney-only"><span class="lbl">Stages</span>
          <div class="choice" ${tip('Single stage is one bracket. Two stage runs groups first, then a playoff.')}>
            ${radio('s-stage', 'single', d.stageType !== 'two', 'Single stage tournament')}
            ${radio('s-stage', 'two', d.stageType === 'two', 'Two stage tournament — groups compete separately, winners proceed to a final stage.')}
          </div>
        </div>
        <div class="form-row two-only tourney-only"><label for="s-group">Group size</label>
          <input id="s-group" type="number" min="2" max="16" value="${d.groupSize}"></div>
        <div class="form-row two-only tourney-only"><label for="s-advance">Advance per group</label>
          <input id="s-advance" type="number" min="1" max="8" value="${d.advancePerGroup}"></div>
        <div class="form-row tourney-only"><label for="s-format">Format <span class="req">*</span></label>
          <div><select id="s-format" ${tip('Single elim is a knockout tree. Swiss and round robin use standings. Losers bracket is a separate switch.')}>
            <option value="single_elim" ${d.format === 'single_elim' || d.format === 'double_elim' ? 'selected' : ''}>Single Elimination</option>
            <option value="round_robin" ${d.format === 'round_robin' ? 'selected' : ''}>Round Robin</option>
            <option value="swiss" ${d.format === 'swiss' ? 'selected' : ''}>Swiss</option>
          </select>
          <label class="check"><input type="checkbox" id="s-losers" ${d.losersBracket ? 'checked' : ''}> Losers bracket</label>
          <p class="hint" id="s-losers-hint">One loss drops a player into a losers bracket instead of eliminating them. On Swiss and round robin this seeds a double-elim playoff after standings.</p>
          <div id="s-break-row">
            <label class="check"><input type="checkbox" id="s-break" ${d.breakTies && !d.losersBracket ? 'checked' : ''}> 3rd place match</label>
            <p class="hint">The two semi-final losers play for bronze. Needs at least 4 players. 1st and 2nd still come from the final.</p>
          </div></div>
        </div>
        <div class="form-row"><label for="s-bestof">Default series</label>
          <div>${bestOfSelect('s-bestof', d.bestOf)}
            <p class="hint">Every round uses this unless Finals is set differently.</p>
          </div>
        </div>
        <div class="form-row" id="s-finals-row"><label for="s-finalsbestof">Finals series</label>
          <div>${finalsBestOfSelect('s-finalsbestof', d.finalsBestOf)}
            <p class="hint">Championship match only. Example: Best of 1 for the bracket, Best of 3 in the final.</p>
          </div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h">Registration</div>
      <div class="panel-b">
        <div class="form-row"><span class="lbl">Registration</span>
          <div class="choice" ${tip('Sign-up page lets players join themselves. Participant list means you add every name on the Players tab. Whitelist is a separate switch — it works with paid or free.')}>
            ${radio('s-reg', 'list', d.registrationMode === 'list', 'I add the participants myself')}
            ${radio('s-reg', 'signup', d.registrationMode !== 'list', 'Host a sign-up page — players register with handle.')}
          </div>
        </div>
        <div class="form-row tourney-only"><span class="lbl">Whitelist</span>
          <div>
            <label class="check"><input type="checkbox" id="s-wl" ${d.whitelistOn ? 'checked' : ''}> Reserve whitelist spots for first-round no-shows</label>
            <div id="wl-spots-row" style="${d.whitelistOn ? '' : 'display:none'}">
              <label for="s-wl-spots">Spots</label>
              <input id="s-wl-spots" type="number" min="1" max="16" value="${d.whitelistSpots || 2}" style="max-width:8rem">
              <p class="hint">Paid or free is the fee toggle below — whitelist does not replace public sign-up. These names sit on the Whitelist tab until you drop one into round 1.</p>
            </div>
          </div>
        </div>
        <div class="form-row"><span class="lbl">Registration fee <span class="req">*</span></span>
          <div><div class="seg" id="fee-seg">
            <button type="button" data-fee="free" class="${d.feeMode === 'free' ? 'on' : ''}">Free</button>
            <button type="button" data-fee="paid" class="${d.feeMode === 'paid' || (!d.feeMode && d.feeMode !== 'free' && d.feeMode !== 'charity') ? 'on' : ''}">Paid</button>
            <button type="button" data-fee="charity" class="${d.feeMode === 'charity' ? 'on' : ''}">Charity</button>
          </div>
          <input type="hidden" id="s-fee" value="${esc(d.feeMode === 'charity' ? 'charity' : d.feeMode === 'free' ? 'free' : 'paid')}">
          <div id="fee-paid" style="${d.feeMode === 'free' ? 'display:none' : ''}">
            <label for="s-usd">${d.feeMode === 'charity' ? 'Donation (USD)' : 'USD amount'}</label>
            <input id="s-usd" type="number" min="0" step="0.01" value="${d.entryFeeUsd || 10}">
            <div id="fee-charity" style="${d.feeMode === 'charity' ? '' : 'display:none'}">
              <label for="s-charity">Charity name</label>
              <input id="s-charity" maxlength="80" value="${esc(d.charityName || '')}" placeholder="Fund name">
            </div>
            <label class="check"><input type="checkbox" id="s-doge-on" ${d.acceptDoge !== false ? 'checked' : ''}> Accept DOGE</label>
            <div id="fee-doge" style="${d.acceptDoge !== false ? '' : 'display:none'}">
              <label for="s-doge">DOGE pay-to address</label>
              <input id="s-doge" class="mono" value="${esc(d.treasury)}" maxlength="48" spellcheck="false" autocomplete="off" ${tip('Players send entry DOGE to this address. Each arena can use a different wallet. Already-quoted invoices keep the address they were given.') }>
            </div>
            <label class="check"><input type="checkbox" id="s-usdc-sol-on" ${d.acceptUsdcSol ? 'checked' : ''}> Accept USDC on Solana</label>
            <div id="fee-usdc-sol" style="${d.acceptUsdcSol ? '' : 'display:none'}">
              <label for="s-solana">Solana wallet for USDC</label>
              <input id="s-solana" class="mono" value="${esc(d.solanaTreasury)}" maxlength="44" spellcheck="false" autocomplete="off" placeholder="Solana address" ${tip('Players send the USD fee as USDC (SPL) on Solana to this wallet. You mark them paid on the Players tab — USDC is not auto-watched.') }>
              <p class="hint">Players send USDC on Solana only (not USDT, not USDC on another chain). You mark them paid on the Players tab.</p>
            </div>
            <label class="check"><input type="checkbox" id="s-xmoney-on" ${d.xHandle ? 'checked' : ''}> Accept XMoney (@handle on X)</label>
            <div id="fee-xmoney" style="${d.xHandle ? '' : 'display:none'}">
              <label for="s-xhandle">Your X handle</label>
              <input id="s-xhandle" maxlength="16" value="${esc(d.xHandle ? `@${d.xHandle}` : '')}" placeholder="@yourhandle" autocomplete="off" spellcheck="false">
              <p class="hint">Players send the USD fee to this handle on <a href="https://xmoney.to/" target="_blank" rel="noopener noreferrer">xmoney.to</a> (USDT, BNB, or another BEP-20 token). You mark them paid on the Players tab — XMoney is not auto-watched.</p>
            </div>
          </div>
          <p class="hint">Paid seats can take DOGE, USDC on Solana, XMoney, or any mix. People without XMoney can still pay in USDC. You confirm XMoney and USDC on the Players tab. Free seats confirm themselves.</p></div>
        </div>
        <div class="form-row"><span class="lbl">Participants</span>
          <div>
            <label class="check"><input type="checkbox" id="s-teams" ${d.requireTeams ? 'checked' : ''}> Require participants to register as a team</label>
            <label class="check"><input type="checkbox" id="s-cap" ${d.capPlayers ? 'checked' : ''}> Specify a maximum number of participants</label>
            <input id="s-max" type="number" min="2" max="32" step="1" value="${Math.min(32, d.maxPlayers || 16)}" style="max-width:8rem;margin-top:8px">
            <p class="hint">Cap is registration only. The tree sizes to the next power of 2 of the paid field (8 / 16 / 32) — 14 paid players make a 16-tree, not a hollow 64.</p>
          </div>
        </div>
        <div class="form-row"><label for="s-start">Start time <span class="req">*</span></label>
          <div><input id="s-start" type="datetime-local" value="${esc(d.startAt)}" ${tip('This clock is in the zone you pick. Visitors always see their own UTC offset.')}>
          <label class="check"><input type="checkbox" id="s-tentative" ${d.startTentative ? 'checked' : ''}> Mark as tentative</label>
          <label for="s-tz">Time zone for this clock</label>
          <select id="s-tz">${timezoneSelectHtml(d.timezone)}</select>
          <p class="hint" id="tz-preview">Visitors always see this in their own UTC offset.</p></div>
        </div>
        <div class="form-row"><span class="lbl">Check-in</span>
          <label class="check"><input type="checkbox" id="s-checkin" ${d.requireCheckIn ? 'checked' : ''}> Require participants to check in before the bracket locks</label>
        </div>
        <div class="form-row"><label for="s-lists-due">Lists due</label>
          <div>
            <input id="s-lists-due" type="datetime-local" value="${esc(d.listsDueAt || '')}">
            <label class="check"><input type="checkbox" id="s-lists-reveal" ${d.listsPublicReveal ? 'checked' : ''}> Publicly reveal locked lists</label>
            <label class="check"><input type="checkbox" id="s-lists-match" ${d.listsRevealOnMatchComplete !== false ? 'checked' : ''}> Show lists on a completed table archive</label>
            <p class="hint">Same zone as the start clock. Players paste a builder export. After lock they cannot edit. Judges see lists after lock. Public reveal stays off until you turn it on (or the event completes if you check the table archive option).</p>
          </div>
        </div>
        <div class="form-row"><span class="lbl">Accounts</span>
          <div>
            <label class="check"><input type="checkbox" id="s-account" ${d.requireAccount ? 'checked' : ''}> Require Discord sign-in to register (walk-ins can still be added by the host)</label>
            <label class="check"><input type="checkbox" id="s-official" ${d.official ? 'checked' : ''}> Count this arena toward records and accolades</label>
            <label class="check"><input type="checkbox" id="s-lock-deck" ${d.requireRegisteredDeck ? 'checked' : ''}> Players must paste a 40 when they register</label>
            <label class="check"><input type="checkbox" id="s-class-quota" ${d.deckClassQuota ? 'checked' : ''}> Locked decks must be at least a set % of one class</label>
            <div id="class-quota-row" class="class-quota-row" style="${d.deckClassQuota ? '' : 'display:none'}">
              <div>
                <label for="s-quota-class">Class</label>
                <select id="s-quota-class">
                  ${DDL_CLASS_IDS.map((id) => `<option value="${esc(id)}" ${d.deckClassQuota && d.deckClassQuota.class === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label for="s-quota-pct">Minimum %</label>
                <input id="s-quota-pct" type="number" min="1" max="100" step="1" value="${esc((d.deckClassQuota && d.deckClassQuota.percent) || 50)}">
              </div>
              <p class="hint">Example: 60% Wizard means at least 24 of 40 cards must be Wizard. Mini, Midi, and Mega count as every hero class. Neutral only counts when Neutral is the required class. Turns on Play-deck lock.</p>
            </div>
            <label class="check"><input type="checkbox" id="s-semi-irl" ${d.semiIrl ? 'checked' : ''}> Semi-IRL / verified holder table (lock Play or Companion 40-card lists, 60s turns, hand + lane watch)</label>
            <p class="hint">Paste a builder export is the source of truth — hidden ddlTCG presets cannot be looked up. Uncheck official for a scrim (hidden from public Arenas). Semi-IRL tables require that pasted 40 before a player can sit.</p>
          </div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h">Predictions and voting</div>
      <div class="panel-b">
        <label class="check"><input type="checkbox" id="s-vote" ${d.votingEnabled ? 'checked' : ''}> Enable voting for open matches</label>
        <label class="check"><input type="checkbox" id="s-pred" ${d.predictionsEnabled ? 'checked' : ''}> Enable bracket predictions</label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h">Experimental</div>
      <div class="panel-b">
        <label class="check"><input type="checkbox" id="s-images" ${d.shareImages ? 'checked' : ''}> Share images for match results</label>
        <label class="check"><input type="checkbox" id="s-email" ${d.requireVerifiedEmail ? 'checked' : ''}> Require an email before joining</label>
        <label class="check"><input type="checkbox" id="s-country" ${d.countryLock ? 'checked' : ''}> Limit registration to countries</label>
        <input id="s-countries" placeholder="US, CA, GB" value="${esc(d.allowedCountries)}" ${tip('Comma-separated country names or codes.')}>
        <label class="check"><input type="checkbox" id="s-predfields" ${d.predictionCustomFields ? 'checked' : ''}> Custom note on predictions</label>
      </div>
    </section>`;
}

function bindSettingsChrome(form) {
  const paid = form.querySelector('#fee-paid');
  const hidden = form.querySelector('#s-fee');
  const potFundHidden = form.querySelector('#s-potfund');
  const setPotFund = (mode) => {
    const fund = mode === 'percent' ? 'percent' : 'usd';
    if (potFundHidden) potFundHidden.value = fund;
    form.querySelectorAll('[data-potfund]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-potfund') === fund);
    });
    const usdBox = form.querySelector('#hostpot-usd');
    const pctBox = form.querySelector('#hostpot-pct');
    if (usdBox) usdBox.style.display = fund === 'usd' ? '' : 'none';
    if (pctBox) pctBox.style.display = fund === 'percent' ? '' : 'none';
    updatePayoutSum();
  };
  form.querySelectorAll('[data-fee]').forEach((btn) => {
    btn.onclick = () => {
      form.querySelectorAll('[data-fee]').forEach((b) => b.classList.toggle('on', b === btn));
      hidden.value = btn.getAttribute('data-fee');
      paid.style.display = hidden.value === 'free' ? 'none' : '';
      const charityBox = form.querySelector('#fee-charity');
      if (charityBox) charityBox.style.display = hidden.value === 'charity' ? '' : 'none';
      const hostAmt = Number(form.querySelector('#s-hostpot')?.value || 0);
      if (hidden.value === 'free' && potFundHidden && potFundHidden.value === 'percent') {
        setPotFund('usd');
      } else if (hidden.value === 'paid' && !(hostAmt > 0)) {
        setPotFund('percent');
      }
    };
  });
  const dogeOn = form.querySelector('#s-doge-on');
  const dogeInput = form.querySelector('#s-doge');
  const dogeBox = form.querySelector('#fee-doge');
  const xOn = form.querySelector('#s-xmoney-on');
  const xBox = form.querySelector('#fee-xmoney');
  const usdcOn = form.querySelector('#s-usdc-sol-on');
  const usdcBox = form.querySelector('#fee-usdc-sol');
  const solInput = form.querySelector('#s-solana');
  const syncPayRails = () => {
    const dogeChecked = Boolean(dogeOn && dogeOn.checked);
    if (dogeInput) dogeInput.disabled = !dogeChecked;
    if (dogeBox) dogeBox.style.display = dogeChecked ? '' : 'none';
    if (xBox) xBox.style.display = xOn && xOn.checked ? '' : 'none';
    if (usdcBox) usdcBox.style.display = usdcOn && usdcOn.checked ? '' : 'none';
    if (solInput && usdcOn && usdcOn.checked && !String(solInput.value || '').trim()) {
      solInput.value = PAY_TO.USDC_SOL;
    }
  };
  if (dogeOn) dogeOn.onchange = syncPayRails;
  if (xOn) xOn.onchange = syncPayRails;
  if (usdcOn) usdcOn.onchange = syncPayRails;
  syncPayRails();
  const stageSync = () => {
    const two = form.querySelector('input[name="s-stage"]:checked')?.value === 'two';
    form.querySelectorAll('.two-only').forEach((el) => { el.style.display = two ? '' : 'none'; });
  };
  form.querySelectorAll('input[name="s-stage"]').forEach((el) => { el.onchange = stageSync; });
  stageSync();
  const kindSync = () => {
    const duel = form.querySelector('input[name="s-kind"]:checked')?.value === 'duel';
    form.querySelectorAll('.tourney-only').forEach((el) => { el.style.display = duel ? 'none' : ''; });
    if (duel) {
      const cap = form.querySelector('#s-cap');
      const max = form.querySelector('#s-max');
      if (cap) cap.checked = true;
      if (max) max.value = 2;
      const losers = form.querySelector('#s-losers');
      if (losers) losers.checked = false;
    }
    stageSync();
    losersSync();
  };
  form.querySelectorAll('input[name="s-kind"]').forEach((el) => { el.onchange = kindSync; });
  const losers = form.querySelector('#s-losers');
  const breakRow = form.querySelector('#s-break-row');
  const finalsRow = form.querySelector('#s-finals-row');
  const losersHint = form.querySelector('#s-losers-hint');
  const formatSel = form.querySelector('#s-format');
  const losersSync = () => {
    const on = Boolean(losers && losers.checked);
    const duel = form.querySelector('input[name="s-kind"]:checked')?.value === 'duel';
    const two = form.querySelector('input[name="s-stage"]:checked')?.value === 'two';
    const fmt = formatSel ? formatSel.value : 'single_elim';
    const canBronze = !duel && !on && (two || fmt === 'single_elim');
    const canFinals = !duel && (two || on || fmt === 'single_elim');
    if (breakRow) breakRow.style.display = canBronze ? '' : 'none';
    if (finalsRow) finalsRow.style.display = canFinals ? '' : 'none';
    if (losersHint && formatSel) {
      losersHint.textContent = fmt === 'swiss' || fmt === 'round_robin'
        ? 'After standings, the field is seeded into a winners / losers / grand-final playoff.'
        : 'One loss drops a player into a losers bracket. Two losses and they are out. Grand final crowns the pack.';
    }
  };
  if (losers) losers.onchange = losersSync;
  if (formatSel) formatSel.onchange = losersSync;
  form.querySelectorAll('input[name="s-stage"]').forEach((el) => {
    const prev = el.onchange;
    el.onchange = () => { if (prev) prev(); losersSync(); };
  });
  losersSync();
  kindSync();
  const shuffle = form.querySelector('#slug-shuffle');
  if (shuffle) shuffle.onclick = () => {
    form.querySelector('#s-slug').value = Math.random().toString(36).slice(2, 10);
  };
  const rewardFields = form.querySelector('#reward-fields');
  const rewardHidden = form.querySelector('#s-reward');
  const rewardHint = form.querySelector('#reward-hint');
  const payoutRowsEl = form.querySelector('#payout-rows');
  const payoutSum = form.querySelector('#payout-sum');
  const syncRewardMode = () => {
    const mode = rewardHidden && rewardHidden.value === 'prize' ? 'prize' : 'pot';
    if (rewardFields) rewardFields.dataset.mode = mode;
    if (rewardHint) {
      rewardHint.textContent = mode === 'prize'
        ? 'Type what each place wins. Entry fees stay the entry — this list is the prize, not the pot.'
        : 'Choose a dollar pot or 65% of paid entries. Place percents split that redistributed pot. Extra cash or prizes on a place sit on top of it.';
    }
    const hostpotRow = form.querySelector('#hostpot-row');
    if (hostpotRow) hostpotRow.style.display = mode === 'prize' ? 'none' : '';
    const extrasHint = form.querySelector('#payout-extras-hint');
    if (extrasHint) extrasHint.style.display = mode === 'prize' ? 'none' : '';
    updatePayoutSum();
  };
  const renumberPayouts = () => {
    if (!payoutRowsEl) return;
    payoutRowsEl.querySelectorAll('.payout-row').forEach((row, i) => {
      const place = i + 1;
      row.dataset.place = String(place);
      const label = row.querySelector('.payout-place');
      if (label) label.textContent = placeLabel(place);
      const pct = row.querySelector('.payout-percent');
      const added = row.querySelector('.payout-added');
      const prize = row.querySelector('.payout-prize');
      if (pct) pct.setAttribute('aria-label', `${placeLabel(place)} percent of pot`);
      if (added) added.setAttribute('aria-label', `${placeLabel(place)} added cash`);
      if (prize) prize.setAttribute('aria-label', `${placeLabel(place)} added prize`);
    });
  };
  const updatePayoutSum = () => {
    if (!payoutSum || !rewardHidden) return;
    const mode = rewardHidden.value === 'prize' ? 'prize' : 'pot';
    const rows = [...form.querySelectorAll('.payout-row')].map((row, i) => ({
      place: i + 1,
      label: placeLabel(i + 1),
      percent: Number(row.querySelector('.payout-percent')?.value || 0),
      addedUsd: Number(row.querySelector('.payout-added')?.value || 0),
      prize: String(row.querySelector('.payout-prize')?.value || '').trim(),
    }));
    const filled = rows.filter((r) => payoutHasValue(r, mode));
    const preview = form.querySelector('#reward-preview');
    const fund = form.querySelector('#s-potfund')?.value === 'percent' ? 'percent' : 'usd';
    const addedPot = Number(form.querySelector('#s-addedpot')?.value || 0);
    const placePreview = (r) => {
      const bits = [];
      if (mode !== 'prize' && r.percent > 0) bits.push(`${r.percent}%`);
      if (mode !== 'prize' && r.addedUsd > 0) bits.push(formatUsd(r.addedUsd));
      if (r.prize) bits.push(r.prize);
      return `${r.label} ${bits.join(' + ')}`;
    };
    if (preview) {
      if (!filled.length) {
        preview.textContent = mode === 'prize'
          ? 'Players will still see Pot until you type prizes and save.'
          : (fund === 'percent'
            ? `Players will see the redistributed pot (${PRIZE_POOL_PERCENT}% of paid entries${addedPot > 0 ? ` plus ${formatUsd(addedPot)} added` : ''}), not total raised.`
            : 'Players will see the host-set dollar pot. Entry fees are not added on top.');
      } else if (mode === 'prize') {
        preview.textContent = `Arena cards list Prize(s): ${compactPrizeLine(filled.map((r) => r.prize))} — opening the tournament still shows 1st / 2nd / 3rd.`;
      } else {
        const potLabel = fund === 'percent'
          ? `the ${PRIZE_POOL_PERCENT}% redistributed pot${addedPot > 0 ? ` plus ${formatUsd(addedPot)} added` : ''}`
          : 'the host-set dollar pot';
        preview.textContent = `Players will see ${potLabel} plus payout: ${filled.map(placePreview).join(' · ')}`;
      }
    }
    if (mode === 'prize') {
      payoutSum.textContent = 'Save options to put this list on the public arena page.';
      return;
    }
    const total = rows.reduce((sum, row) => sum + (row.percent || 0), 0);
    if (!(total > 0)) {
      payoutSum.textContent = fund === 'percent'
        ? `No split yet — the public page shows ${PRIZE_POOL_PERCENT}% of paid entries${addedPot > 0 ? ` plus ${formatUsd(addedPot)} added` : ''} as the pot.`
        : 'No split yet — the public page shows the dollar pot only.';
      return;
    }
    const rounded = Math.round(total * 100) / 100;
    payoutSum.textContent = rounded === 100
      ? 'Splits add up to 100% of the redistributed pot. +$ and added prizes are extra.'
      : `Splits add up to ${rounded}% of the redistributed pot. +$ and added prizes are extra.`;
  };
  form.querySelectorAll('[data-reward]').forEach((btn) => {
    btn.onclick = () => {
      form.querySelectorAll('[data-reward]').forEach((b) => b.classList.toggle('on', b === btn));
      if (rewardHidden) rewardHidden.value = btn.getAttribute('data-reward');
      syncRewardMode();
    };
  });
  form.querySelectorAll('[data-potfund]').forEach((btn) => {
    btn.onclick = () => setPotFund(btn.getAttribute('data-potfund'));
  });
  if (payoutRowsEl) {
    payoutRowsEl.addEventListener('input', updatePayoutSum);
    payoutRowsEl.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-payout-remove]');
      if (!remove) return;
      const rows = payoutRowsEl.querySelectorAll('.payout-row');
      if (rows.length <= 1) {
        const only = rows[0];
        if (only) {
          const pct = only.querySelector('.payout-percent');
          const added = only.querySelector('.payout-added');
          const prize = only.querySelector('.payout-prize');
          if (pct) pct.value = '';
          if (added) added.value = '';
          if (prize) prize.value = '';
        }
        updatePayoutSum();
        return;
      }
      remove.closest('.payout-row')?.remove();
      renumberPayouts();
      updatePayoutSum();
    });
  }
  const addPlace = form.querySelector('#payout-add');
  if (addPlace && payoutRowsEl) {
    addPlace.onclick = () => {
      const count = payoutRowsEl.querySelectorAll('.payout-row').length;
      if (count >= MAX_PAYOUT_PLACES) return;
      payoutRowsEl.insertAdjacentHTML('beforeend', payoutRowHtml(count + 1, '', '', ''));
      updatePayoutSum();
    };
  }
  const addedPotEl = form.querySelector('#s-addedpot');
  if (addedPotEl) addedPotEl.addEventListener('input', updatePayoutSum);
  syncRewardMode();
  const wlRow = form.querySelector('#wl-spots-row');
  const wlCheck = form.querySelector('#s-wl');
  const syncWl = () => {
    if (wlRow) wlRow.style.display = wlCheck && wlCheck.checked ? '' : 'none';
  };
  if (wlCheck) wlCheck.onchange = syncWl;
  syncWl();
  const lockDeck = form.querySelector('#s-lock-deck');
  const quotaCheck = form.querySelector('#s-class-quota');
  const quotaRow = form.querySelector('#class-quota-row');
  const syncQuota = () => {
    const on = Boolean(quotaCheck && quotaCheck.checked);
    if (quotaRow) quotaRow.style.display = on ? '' : 'none';
    if (on && lockDeck && !lockDeck.checked) lockDeck.checked = true;
  };
  if (quotaCheck) quotaCheck.onchange = syncQuota;
  if (lockDeck) {
    lockDeck.addEventListener('change', () => {
      if (!lockDeck.checked && quotaCheck && quotaCheck.checked) {
        quotaCheck.checked = false;
        syncQuota();
      }
    });
  }
  syncQuota();
  const startEl = form.querySelector('#s-start');
  const tzEl = form.querySelector('#s-tz');
  const preview = form.querySelector('#tz-preview');
  const paintTzPreview = () => {
    if (!preview) return;
    const api = eventTimeApi();
    if (!startEl || !tzEl || !api.eventStartMs || !api.formatViewerParts) {
      preview.textContent = 'Visitors always see this in their own UTC offset.';
      return;
    }
    const ms = api.eventStartMs(startEl.value, tzEl.value);
    if (!Number.isFinite(ms)) {
      preview.textContent = 'Pick a start time. Visitors always see it in their own UTC offset.';
      return;
    }
    const view = api.formatViewerParts(ms);
    preview.textContent = `On your clock that is ${view.time} ${view.offset}. Everyone else sees their own UTC offset.`;
  };
  if (startEl) startEl.addEventListener('input', paintTzPreview);
  if (tzEl) tzEl.addEventListener('change', paintTzPreview);
  paintTzPreview();
}

function collectSettings(form) {
  const feeMode = form.querySelector('#s-fee')?.value || 'paid';
  const usd = feeMode === 'free' ? 0 : Number(form.querySelector('#s-usd')?.value || 0);
  const rewardMode = form.querySelector('#s-reward')?.value === 'prize' ? 'prize' : 'pot';
  const payouts = [...form.querySelectorAll('.payout-row')].map((row, i) => ({
    place: i + 1,
    percent: Number(row.querySelector('.payout-percent')?.value || 0),
    addedUsd: Number(row.querySelector('.payout-added')?.value || 0),
    prize: String(row.querySelector('.payout-prize')?.value || '').trim(),
  }));
  return {
    hostPassword: adminPassword,
    adminPassword,
    hostName: form.querySelector('#s-host')?.value,
    treasury: form.querySelector('#s-doge')?.value,
    name: form.querySelector('#s-name')?.value,
    slug: form.querySelector('#s-slug')?.value,
    description: form.querySelector('#s-desc')?.value,
    streamUrl: form.querySelector('#s-stream')?.value,
    game: form.querySelector('#s-game')?.value,
    eventKind: sanitizeEventKind(form.querySelector('input[name="s-kind"]:checked')?.value, form.querySelector('#s-name')?.value),
    stageType: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel'
      ? 'single'
      : form.querySelector('input[name="s-stage"]:checked')?.value,
    format: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel'
      ? 'single_elim'
      : form.querySelector('#s-format')?.value,
    losersBracket: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel'
      ? false
      : form.querySelector('#s-losers')?.checked,
    playoffFormat: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' || !form.querySelector('#s-losers')?.checked
      ? 'single_elim'
      : 'double_elim',
    breakTies: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' || form.querySelector('#s-losers')?.checked || (form.querySelector('#s-format')?.value !== 'single_elim' && form.querySelector('input[name="s-stage"]:checked')?.value !== 'two')
      ? false
      : Boolean(form.querySelector('#s-break')?.checked),
    finalsBestOf: (() => {
      const raw = form.querySelector('#s-finalsbestof')?.value;
      if (raw === '' || raw == null) return null;
      const n = Number(raw);
      return BEST_OF.includes(n) ? n : null;
    })(),
    registrationMode: form.querySelector('input[name="s-reg"]:checked')?.value === 'list' ? 'list' : 'signup',
    whitelistSpots: form.querySelector('#s-wl')?.checked ? Number(form.querySelector('#s-wl-spots')?.value || 2) : 0,
    feeMode,
    entryFeeUsd: usd,
    rewardMode,
    acceptDoge: form.querySelector('#s-doge-on') ? Boolean(form.querySelector('#s-doge-on').checked) : true,
    xHandle: form.querySelector('#s-xmoney-on')?.checked ? form.querySelector('#s-xhandle')?.value : '',
    acceptUsdcSol: Boolean(form.querySelector('#s-usdc-sol-on')?.checked),
    solanaTreasury: form.querySelector('#s-solana')?.value,
    potFundMode: form.querySelector('#s-potfund')?.value === 'percent' ? 'percent' : 'usd',
    hostPotUsd: Number(form.querySelector('#s-hostpot')?.value || 0),
    addedPotUsd: Number(form.querySelector('#s-addedpot')?.value || 0),
    payouts,
    requireTeams: form.querySelector('#s-teams')?.checked,
    capPlayers: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' ? true : form.querySelector('#s-cap')?.checked,
    maxPlayers: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' ? 2 : Math.min(32, Number(form.querySelector('#s-max')?.value || 16)),
    startAt: form.querySelector('#s-start')?.value || null,
    startTentative: form.querySelector('#s-tentative')?.checked,
    timezone: form.querySelector('#s-tz')?.value,
    requireCheckIn: form.querySelector('#s-checkin')?.checked,
    listsDueAt: form.querySelector('#s-lists-due')?.value || null,
    listsPublicReveal: form.querySelector('#s-lists-reveal')?.checked,
    listsRevealOnMatchComplete: form.querySelector('#s-lists-match')?.checked,
    charityName: form.querySelector('#s-charity')?.value,
    votingEnabled: form.querySelector('#s-vote')?.checked,
    predictionsEnabled: form.querySelector('#s-pred')?.checked,
    shareImages: form.querySelector('#s-images')?.checked,
    requireVerifiedEmail: form.querySelector('#s-email')?.checked,
    requireAccount: form.querySelector('#s-account')?.checked,
    official: form.querySelector('#s-official')?.checked,
    requireRegisteredDeck: form.querySelector('#s-lock-deck')?.checked,
    deckClassQuota: form.querySelector('#s-class-quota')?.checked
      ? {
        class: form.querySelector('#s-quota-class')?.value,
        percent: Number(form.querySelector('#s-quota-pct')?.value || 50),
      }
      : null,
    semiIrl: form.querySelector('#s-semi-irl')?.checked,
    countryLock: form.querySelector('#s-country')?.checked,
    allowedCountries: form.querySelector('#s-countries')?.value,
    predictionCustomFields: form.querySelector('#s-predfields')?.checked,
    groupSize: Number(form.querySelector('#s-group')?.value || 4),
    advancePerGroup: Number(form.querySelector('#s-advance')?.value || 2),
    bestOf: Number(form.querySelector('#s-bestof')?.value || 3),
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function route() {
  if (irlUnmount) {
    try { irlUnmount(); } catch (_err) {}
    irlUnmount = null;
  }
  const parts = routeParts();
  if (parts[0] === 't' && parts[1]) canonicalizeArenaUrl();
  if (!(parts[0] === 't' && parts[1])) {
    hideKickStream();
    hideArenaChat();
  }
  if (parts[0] === 'create') return renderCreate();
  if (parts[0] === 'records') return renderRecords();
  if (parts[0] === 'ledger') return renderLedger();
  if (parts[0] === 'rules') return renderRules();
  if (parts[0] === 'player' && parts[1]) return renderPlayer(parts[1]);
  if (parts[0] === 't' && parts[1] && parts[2] === 'table' && parts[3]) return renderIrlTable(parts[1], parts[3]);
  if (parts[0] === 't' && parts[1]) return renderArena(parts[1]);
  return renderHome();
}

async function renderIrlTable(slug, matchId) {
  hideKickStream();
  hideArenaChat();
  setTreeMode(false);
  root.innerHTML = `<p class="muted">Opening table…</p>`;
  let data;
  try {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
    applyBracketLayoutFixes(data);
  } catch (err) {
    root.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }
  const match = (data.matches || []).find((m) => String(m.id) === String(matchId));
  if (!match) {
    root.innerHTML = `<p class="err">That match is not on this arena. <a href="${esc(arenaHref(slug))}">Back to bracket</a></p>`;
    return;
  }
  const p1 = entryOf(data.entries, match.entry1Id);
  const p2 = entryOf(data.entries, match.entry2Id);
  const mine = playerUser && (p1 || p2) ? (
    (p1 && Number(p1.userId) === Number(playerUser.id)) ? p1
      : (p2 && Number(p2.userId) === Number(playerUser.id)) ? p2
        : (p1 && p1.discordUser && String(p1.discordUser.discordId) === String(playerUser.discordId)) ? p1
          : (p2 && p2.discordUser && String(p2.discordUser.discordId) === String(playerUser.discordId)) ? p2
            : null
  ) : null;
  if (typeof DdlIrlTable === 'undefined' || !DdlIrlTable.mount) {
    root.innerHTML = `<p class="err">Table scripts failed to load. Upload <code>bracket/irl-table.js</code>.</p>`;
    return;
  }
  root.innerHTML = '';
  irlUnmount = DdlIrlTable.mount(root, {
    tableId: `a${data.tournament.id}m${match.id}`,
    eventName: data.tournament.name,
    backHref: arenaHref(slug),
    player1: p1 ? {
      id: p1.id,
      handle: p1.handle,
      userId: p1.userId,
      discordUser: p1.discordUser,
      playName: p1.playName || (p1.registeredDeck && p1.registeredDeck.playName) || '',
      registeredDeck: p1.registeredDeck || null,
      listSubmitted: Boolean(p1.listSubmitted),
    } : null,
    player2: p2 ? {
      id: p2.id,
      handle: p2.handle,
      userId: p2.userId,
      discordUser: p2.discordUser,
      playName: p2.playName || (p2.registeredDeck && p2.registeredDeck.playName) || '',
      registeredDeck: p2.registeredDeck || null,
      listSubmitted: Boolean(p2.listSubmitted),
    } : null,
    viewer: playerUser,
    discordHref: discordStartHref(),
    matchOpen: match.status === 'ready',
    matchComplete: match.status === 'complete',
    score1: match.score1,
    score2: match.score2,
    winnerId: match.winnerId,
    listsPublic: Boolean(data.listsPublic),
    reportProposal: match.reportProposal || null,
    bestOf: match.bestOf,
    semiIrl: Boolean(data.tournament.semiIrl),
    deckClassQuota: classQuotaOf(data.tournament),
    canReport: () => Boolean(data.viewerIsHost || mine),
    onHostGate: () => data.viewerIsHost ? Promise.resolve(true) : openAdminSignIn(),
    onResult: async ({ score1, score2, bestOf }) => {
      await api.post(`/arenas/${encodeURIComponent(slug)}/table-lock`, {
        adminPassword,
        matchId: match.id,
        score1,
        score2,
        bestOf,
      });
      goTourney(arenaHref(slug));
    },
  });
}

function upcomingStartRank(t) {
  const tz = (t && t.schedule && t.schedule.timezone) || (t && t.timezone) || '';
  const startAt = (t && t.startAt) || (t && t.schedule && t.schedule.startAt) || '';
  const ms = eventStartMs(startAt, tz);
  if (!Number.isFinite(ms)) return Number.MAX_SAFE_INTEGER;
  if (ms < Date.now() - 60000) return ms + 1e15;
  return ms;
}

function featuredArena(arenas) {
  const list = Array.isArray(arenas) ? arenas : [];
  const hot = list.find((t) => phaseOf(t) === 'live' && kickLinkOf(t.streamUrl).kind === 'live');
  if (hot) return { arena: hot, mode: 'live' };
  const upcoming = list
    .filter((t) => t.official !== false && (phaseOf(t) === 'registration' || phaseOf(t) === 'check_in'))
    .sort((a, b) => upcomingStartRank(a) - upcomingStartRank(b));
  if (upcoming[0]) return { arena: upcoming[0], mode: 'next' };
  const live = list.find((t) => phaseOf(t) === 'live');
  if (live) return { arena: live, mode: 'live' };
  return null;
}

function featuredHeroHtml(pack) {
  if (!pack || !pack.arena) {
    return `<p class="hero-lead">Pick a night, sign in on Discord, and send DOGE if the seat is paid. Lists come from the official builder. Wins land on Records.</p>`;
  }
  const t = pack.arena;
  const p = scheduleParts(t);
  const live = pack.mode === 'live';
  const kick = kickLinkOf(t.streamUrl);
  const timer = !live && Number.isFinite(p.startMs) ? nightTimerHtml(p.startMs) : '';
  return `<a class="nightboard${live ? ' is-live' : ''}" href="${esc(arenaHref(t.slug))}">
    <div class="nightboard-copy">
      <p class="nightboard-kicker"><i></i> ${live ? 'Live now' : 'Next official'}</p>
      <h2 class="nightboard-title">${esc(t.name)}</h2>
      <p class="nightboard-meta">${
        (p.date ? `<span>${esc(p.date)}</span>` : '') +
        (p.time ? `<span>${esc(p.time)}</span>` : '') +
        (p.offset ? `<span>${esc(p.offset)}</span>` : '') +
        (live && kick.channel ? '<span>Stream is hot</span>' : (!timer && p.relative ? `<span>${esc(p.relative)}</span>` : '')) +
        (p.tentative ? '<span>tentative</span>' : '')
      }</p>
      ${timer}
    </div>
    <span class="btn nightboard-cta">${live ? 'Watch' : 'Register'}</span>
  </a>`;
}

let nightboardClock = 0;
function bindNightboardClock(scope) {
  if (nightboardClock) {
    clearInterval(nightboardClock);
    nightboardClock = 0;
  }
  const els = scope ? Array.from(scope.querySelectorAll('[data-count-ms]')) : [];
  if (!els.length) return;
  const tick = () => {
    els.forEach((el) => {
      const startMs = Number(el.getAttribute('data-count-ms'));
      const parts = countdownParts(startMs);
      if (!parts) {
        el.hidden = true;
        return;
      }
      const vals = [parts.d, parts.h, parts.m, parts.s];
      el.querySelectorAll('b').forEach((node, i) => { node.textContent = padClock(vals[i]); });
    });
  };
  tick();
  nightboardClock = setInterval(tick, 1000);
}

function hostHomePanelHtml() {
  if (isAdminMode()) {
    return `<section class="host-panel" style="margin-top:36px">
      <div class="host-flag">Admin</div>
      <h2>Admin</h2>
      <p class="muted">You can manage every arena. Discord hosts only change nights they created.</p>
      <div class="row wrap" style="margin-bottom:14px"><a class="btn" href="/tourney/#/create">New tournament</a></div>
      <article>
        <h3>Grant a host</h3>
        <p class="muted">Search a Discord handle, then grant or revoke hosting. Hosts never see the ledger or other people’s arenas.</p>
        <div class="stack">
          <label for="host-grant-q">Discord handle</label>
          <input id="host-grant-q" autocomplete="off" placeholder="Handle or Discord name">
          <div class="row wrap">
            <button class="btn" type="button" id="host-grant-btn">Grant hosting</button>
            <button class="btn ghost" type="button" id="host-revoke-btn">Revoke</button>
          </div>
          <p class="err" id="host-grant-err" hidden></p>
          <p class="ok" id="host-grant-ok" hidden></p>
          <div id="host-grant-list"></div>
        </div>
      </article>
      <article>
        <h3>Cleanup</h3>
        <button class="btn ghost" type="button" id="purge-btn">Purge leftover demo arenas</button>
        <p class="err" id="admin-err" hidden></p>
        <p class="ok" id="admin-ok" hidden></p>
      </article>
    </section>`;
  }
  if (canCreateArena()) {
    return `<section class="host-panel" style="margin-top:36px">
      <div class="host-flag">Host</div>
      <h2>Your arenas</h2>
      <p class="muted">You can only change nights you create.</p>
      <div class="row wrap"><a class="btn" href="/tourney/#/create">New arena</a></div>
    </section>`;
  }
  return `<section class="host-panel" style="margin-top:36px">
      <div class="host-flag">Host</div>
      <h2>Host a night</h2>
      <p class="muted">Sign in with Discord, then open Host.</p>
      <div class="row wrap"><a class="btn" href="/tourney/#/create">Host</a></div>
    </section>`;
}

async function bindHostHomePanel(rootEl) {
  const purge = rootEl.querySelector('#purge-btn');
  if (purge) {
    purge.onclick = async () => {
      const errEl = document.getElementById('admin-err');
      const okEl = document.getElementById('admin-ok');
      if (errEl) errEl.hidden = true;
      if (okEl) okEl.hidden = true;
      try {
        const result = await api.post('/control/purge-demos', { adminPassword });
        if (okEl) {
          okEl.hidden = false;
          okEl.textContent = result.removed ? `Removed ${result.removed} demo arena(s).` : 'No demo arenas left.';
        }
        if (result.removed) route();
      } catch (err) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        }
      }
    };
  }
  const grantBtn = rootEl.querySelector('#host-grant-btn');
  const revokeBtn = rootEl.querySelector('#host-revoke-btn');
  const paintHosts = async () => {
    const box = document.getElementById('host-grant-list');
    if (!box) return;
    try {
      const pack = await api.get('/hosts');
      const hosts = pack.hosts || [];
      box.innerHTML = hosts.length
        ? `<p class="muted">Current hosts</p><ul class="rank-list">${hosts.map((h) => `<li><span></span><div>${esc(h.tourneyHandle || h.discordUsername || 'Host')}</div><span class="muted">${esc(h.discordUsername || '')}</span></li>`).join('')}</ul>`
        : '<p class="muted">No Discord hosts granted yet.</p>';
    } catch (_err) {
      box.innerHTML = '';
    }
  };
  const runGrant = async (enabled) => {
    const errEl = document.getElementById('host-grant-err');
    const okEl = document.getElementById('host-grant-ok');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    if (okEl) { okEl.hidden = true; okEl.textContent = ''; }
    const handle = String((document.getElementById('host-grant-q') || {}).value || '').trim();
    if (handle.length < 2) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Enter a Discord handle.'; }
      return;
    }
    try {
      await api.post('/hosts', { adminPassword, handle, host: enabled });
      if (okEl) {
        okEl.hidden = false;
        okEl.textContent = enabled ? `Hosting granted to ${handle}.` : `Hosting revoked from ${handle}.`;
      }
      await paintHosts();
    } catch (err) {
      if (errEl) { errEl.hidden = false; errEl.textContent = err.message; }
    }
  };
  if (grantBtn) grantBtn.onclick = () => runGrant(true);
  if (revokeBtn) revokeBtn.onclick = () => runGrant(false);
  if (grantBtn) await paintHosts();
}

function recordEventToArena(event) {
  const field = Number(event && event.fieldSize) || 0;
  return {
    slug: event.slug,
    name: event.name,
    status: 'completed',
    format: event.format || 'single_elim',
    eventKind: event.kind || event.eventKind,
    maxPlayers: field,
    paidCount: field,
    entryCount: field,
    capPlayers: true,
    entryFeeUsd: 0,
    champion: event.champion || null,
    restoredFromRecords: true,
  };
}

function featuredPlaceholderHtml() {
  return `<a class="nightboard is-wait" href="/tourney/">
    <div class="nightboard-copy">
      <p class="nightboard-kicker"><i></i> Next official</p>
      <h2 class="nightboard-title">Loading tonight’s card…</h2>
      <p class="nightboard-meta"><span>Live trees, paid seats, records after the last match</span></p>
    </div>
    <span class="btn nightboard-cta">Wait</span>
  </a>`;
}

function enterIdentHtml() {
  if (!playerUser) return '';
  const handle = playerUser.tourneyHandle || playerUser.discordUsername || 'Player';
  const src = avatarUrlForUser(playerUser);
  return `<div class="enter-ident">
    ${src ? `<img src="${esc(src)}" alt="" width="48" height="48" referrerpolicy="no-referrer">` : '<span class="enter-ident-mark">★</span>'}
    <div>
      <strong>${esc(handle)}</strong>
      <span>${playerUser.tourneyHandle ? 'This name is locked across every arena' : 'Choose a handle below — it stays yours'}</span>
    </div>
  </div>`;
}

function enterTicketHtml(t, usd) {
  const p = scheduleParts(t);
  const when = [p.date, p.time].filter(Boolean).join(' · ') || 'TBA';
  return `<ul class="enter-ticket">
    <li><span>Entry</span><b>${usd > 0 ? esc(formatUsd(usd)) : 'Free'}</b></li>
    <li><span>Format</span><b>${esc(formatTitle(t))}</b></li>
    <li><span>When</span><b>${esc(when)}</b></li>
  </ul>`;
}

function warmArenas() {
  if (arenasWarm.data && Date.now() - arenasWarm.at < 6000) return Promise.resolve(arenasWarm.data);
  if (arenasWarm.p) return arenasWarm.p;
  arenasWarm.p = api.get('/arenas').then((data) => {
    arenasWarm = { p: null, at: Date.now(), data };
    return data;
  }).catch((err) => {
    arenasWarm.p = null;
    throw err;
  });
  return arenasWarm.p;
}

async function arenasFromRecordsFallback() {
  const pack = await api.get('/records');
  return (pack.events || []).filter((event) => event && event.slug).map(recordEventToArena);
}

async function renderHome() {
  setTreeMode(false);
  root.innerHTML = `${featuredPlaceholderHtml()}<p class="muted">Loading arenas…</p>`;
  try {
    let arenas = await warmArenas();
    if (!Array.isArray(arenas)) arenas = [];
    if (!arenas.length) {
      try { arenas = await arenasFromRecordsFallback(); } catch (_err) {}
    }
    let filter = 'open';
    const paintList = () => {
      const featured = featuredArena(arenas);
      const rows = arenas.filter((t) => {
        const phase = phaseOf(t);
        if (filter === 'live') return phase === 'live';
        if (filter === 'upcoming') return phase === 'registration' || phase === 'check_in';
        if (filter === 'complete') return phase === 'complete';
        if (filter === 'grands') return isGrandArena(t);
        if (filter === 'duels') return isDuelArena(t);
        if (filter === 'official') return t.official !== false;
        return phase !== 'complete';
      });
      const filters = [
        ['open', 'Open'],
        ['live', 'Live'],
        ['upcoming', 'Upcoming'],
        ['complete', 'Complete'],
        ['grands', 'Grands'],
        ['duels', 'Duels'],
        ['official', 'Official only'],
      ];
      root.innerHTML = `${featuredHeroHtml(featured)}
    <p class="muted"><a href="/tourney/#/records">Records</a> · <a href="/tourney/#/rules">Rules</a>${isAdminMode() ? ` · <a href="/tourney/#/ledger">Write the ledger</a>` : ''}</p>
    <h2 class="section-title">Arenas</h2>
    <div class="arena-filters">${filters.map(([id, label]) => `<button type="button" class="mini ${filter === id ? 'on' : ''}" data-filter="${id}">${esc(label)}</button>`).join('')}</div>
    <div class="grid cards">${rows.map((t) => `
      <a class="card plaque" data-status="${esc(t.status)}" href="${arenaHref(t.slug)}">
        <div class="card-top">
          <h3>${esc(t.name)}</h3>
          <div class="card-tags">${kindTagHtml(t)}${badge(phaseOf(t))}</div>
        </div>
        <p class="muted">${esc(formatTitle(t))} · ${feeUsd(t) > 0 ? `${t.feeMode === 'charity' ? `Donate ${formatUsd(feeUsd(t))}` : `${formatUsd(feeUsd(t))} entry`}` : 'Free entry'}${classQuotaOf(t) ? ` · ${esc(classQuotaLabel(classQuotaOf(t)))} lists` : ''}</p>
        ${scheduleClockHtml(t)}
        <p class="muted">${t.paidCount}${t.capPlayers !== false ? ` / ${t.maxPlayers}` : ''} ${isDuelArena(t) ? 'duelists' : 'players'} in${t.viewerIsHost && Math.max(0, (t.entryCount || 0) - t.paidCount) ? ` · ${Math.max(0, (t.entryCount || 0) - t.paidCount)} awaiting payment` : ''}</p>
        ${rewardCardHtml(t)}
        ${phaseOf(t) === 'complete' && t.champion && t.champion.handle ? `<p class="muted">${isDuelArena(t, t.paidCount) ? 'Winner' : 'Champion'}: ${namedHandleHtml(t.champion.handle)}</p>` : ''}
        ${arenaStreamLinkHtml(t)}
      </a>`).join('') || '<p class="muted">No arenas in this filter.</p>'}</div>
    ${hostHomePanelHtml()}`;
      root.querySelectorAll('[data-filter]').forEach((btn) => {
        btn.onclick = () => { filter = btn.getAttribute('data-filter'); paintList(); };
      });
      bindHostHomePanel(root);
      bindNightboardClock(root);
    };
    paintList();
  } catch (err) {
    root.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}

function renderRules() {
  setTreeMode(false);
  root.innerHTML = `<div class="form-page">
    <p class="form-kicker">Doginal Dogs</p>
    <h1>Rules</h1>
    <p class="muted">Official events count toward Records. Uncheck Official when creating to keep a scrim off the public Arenas list. Hosts still see their own scrims when signed in.</p>
    <h2>Entry</h2>
    <p>Paid and charity arenas take the rails the host turns on: quoted DOGE (auto-watched on-chain), USDC on Solana, and/or XMoney. Send exactly what that rail asks for — Solana USDC is not USDT and not USDC on another chain. The host marks PAID after they verify the send. We do not auto-charge. Swap on K9SWAP if you need DOGE.</p>
    <h2>Lists</h2>
    <p>ddlTCG.com now hides Play presets. Export a 40 from the official builder (Copy decklist, Copy serials, or Companion lines) and paste it on the arena. Hidden name lookup will fail — paste instead. Lists stay private until the host lock time. After lock, hosts and judges can see them. Public reveal is off until the host turns it on. Sitting a Semi-IRL table needs that pasted 40.</p>
    <h2>Check-in and no-shows</h2>
    <p>If the host turns on check-in, you must check in before the bracket locks. No-shows can be dropped from the paid field.</p>
    <h2>Reporting and disputes</h2>
    <p>Either seated Discord account can submit a game score. The opponent confirms it. That closes the table and writes the bracket. The host can override with a note. Spectators never sit another player's seat.</p>
    <h2>Prizes</h2>
    <p>Prize movement follows the host's posted split. Charity arenas donate through the posted rails to the named fund. Finished official events crown 1st / 2nd / 3rd on Records automatically.</p>
    <p><a href="/tourney/">Back to Arenas</a></p>
  </div>`;
}

async function renderCreate() {
  setTreeMode(false);
  if (!canCreateArena()) {
    const signedIn = isSignedInUser(playerUser);
    const handle = signedIn ? (playerUser.tourneyHandle || playerUser.discordUsername || '') : '';
    root.innerHTML = `<div class="host-gate">
      <h1>Host a night</h1>
      ${!signedIn ? `<p>Sign in with Discord.</p>
        <p><a class="btn" href="${esc(discordStartHref())}">Sign in with Discord</a></p>` : ''}
      ${signedIn && !isGrantedHost() ? `<p>${handle ? esc(handle) + ' isn’t a host yet.' : 'This account isn’t a host yet.'}</p>
        <p><button class="btn" type="button" id="unlock-host-btn">Unlock</button></p>` : ''}
      ${signedIn && isGrantedHost() && !hostingEnabled() ? `<p class="err">Hosting isn’t available right now.</p>` : ''}
    </div>`;
    const unlock = document.getElementById('unlock-host-btn');
    if (unlock) unlock.onclick = async () => { if (await openHostUnlock()) renderCreate(); };
    return;
  }
  root.innerHTML = `<div class="form-page create-page">
    <header class="create-head">
      <p class="form-kicker">Host</p>
      <h1>New arena</h1>
    </header>
    <form id="create-form">
      ${settingsFormHtml(null, { creating: true })}
      <p class="err" id="create-err" hidden></p>
      <div class="save-bar"><button class="btn" type="submit">Create</button></div>
    </form>
  </div>`;
  const form = document.getElementById('create-form');
  bindSettingsChrome(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errEl = document.getElementById('create-err');
    errEl.hidden = true;
    const payload = collectSettings(form);
    const payErr = paySettingsError(payload);
    if (payErr) {
      errEl.hidden = false;
      errEl.textContent = payErr;
      return;
    }
    if (form.querySelector('#s-xmoney-on')?.checked && !sanitizeXHandleInput(payload.xHandle)) {
      errEl.hidden = false;
      errEl.textContent = 'Enter the X @handle that should receive XMoney.';
      return;
    }
    if (form.querySelector('#s-usdc-sol-on')?.checked && !sanitizeSolanaAddressInput(payload.solanaTreasury)) {
      errEl.hidden = false;
      errEl.textContent = 'Enter the Solana wallet that should receive USDC.';
      return;
    }
    try {
      const t = await api.post('/arenas', payload);
      goTourney(arenaHref(t.slug));
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------------
// Scorecard (host only)
// ---------------------------------------------------------------------------

function openScorecard(data, slug, match, onSaved, opts) {
  const p1 = entryOf(data.entries, match.entry1Id);
  const p2 = entryOf(data.entries, match.entry2Id);
  const closed = match.status === 'complete';
  const asHost = Boolean(opts && Object.prototype.hasOwnProperty.call(opts, 'asHost') ? opts.asHost : data.viewerIsHost);
  const mine = opts && opts.entry;
  const proposal = match.reportProposal;
  let bestOf = BEST_OF.includes(Number(match.bestOf)) ? Number(match.bestOf) : 3;
  const games = (match.games || []).map((g) => Number(g.winnerSlot));
  if (!games.length && proposal && Array.isArray(proposal.games) && proposal.games.length) {
    proposal.games.forEach((g, i) => { games[i] = Number(g.winnerSlot); });
  }
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  const paintCard = () => {
    const need = winsNeeded(bestOf);
    const s1 = games.filter((slot) => slot === 1).length;
    const s2 = games.filter((slot) => slot === 2).length;
    const done = s1 >= need || s2 >= need;
    const waitingConfirm = Boolean(proposal && mine && Number(proposal.byEntryId) !== Number(mine.id));
    overlay.innerHTML = `<div class="scorecard" role="dialog" aria-modal="true">
      <div class="row">
        <div>
          <p class="muted">${esc(bestOfLabel(bestOf))} · first to ${need}${closed ? ' · locked' : (waitingConfirm ? ' · opponent submitted' : '')}</p>
          <h2>${esc(p1?.handle || 'TBD')} vs ${esc(p2?.handle || 'TBD')}</h2>
        </div>
        <button type="button" class="copy" id="sc-close">Close</button>
      </div>
      ${closed ? '' : `<label>This round
        <select id="sc-bestof">
          ${BEST_OF.map((n) => `<option value="${n}" ${n === bestOf ? 'selected' : ''}>${esc(bestOfLabel(n))}</option>`).join('')}
        </select>
      </label>
      <div class="games">
        ${Array.from({ length: bestOf }, (_, i) => {
          const winner = games[i];
          const locked = done && winner == null;
          return `<div class="game-row">
            <span>Game ${i + 1}</span>
            <button type="button" class="${winner === 1 ? 'on' : ''}" data-game="${i}" data-slot="1" ${locked ? 'disabled' : ''}>${esc(p1?.handle || 'P1')}</button>
            <button type="button" class="${winner === 2 ? 'on' : ''}" data-game="${i}" data-slot="2" ${locked ? 'disabled' : ''}>${esc(p2?.handle || 'P2')}</button>
          </div>`;
        }).join('')}
      </div>`}
      <p class="series">${s1} — ${s2}</p>
      <p class="muted">${closed
        ? 'Series locked. Unlock it to move people in this round. Later matches that used this result unlock too.'
        : done
          ? asHost
            ? `${esc((s1 > s2 ? p1 : p2)?.handle || 'Winner')} wins the series — lock it to advance them.`
            : waitingConfirm
              ? 'Confirm if this score is correct. That closes the table and writes the bracket.'
              : 'Submit this score. Your opponent confirms it, or the host can override.'
          : `Tap each game as it finishes. Locking needs a series winner: ${need - Math.max(s1, s2)} more game${need - Math.max(s1, s2) === 1 ? '' : 's'}.`}</p>
      ${asHost && !closed ? `<div><label for="sc-reason">Override note <span class="muted">(optional)</span></label><input id="sc-reason" maxlength="160" placeholder="tx / table / dispute"></div>` : ''}
      <p class="err" id="sc-err" hidden></p>
      <div class="sc-actions">
        ${closed
          ? (asHost ? `<button class="btn" type="button" id="sc-unlock" ${tip('Unlock this series and later matches that used it.')}>Unlock series</button>` : '')
          : `<button class="btn ghost" type="button" id="sc-save" ${games.length && asHost ? '' : 'disabled'} ${asHost ? '' : 'hidden'} ${tip('Save game wins so far. The match stays open and the bracket keeps the running score.')}>Save progress</button>
        <button class="btn" type="button" id="sc-lock" ${done ? '' : 'disabled'}>${asHost ? 'Lock series' : (waitingConfirm ? 'Confirm score' : 'Submit score')}</button>`}
      </div>
    </div>`;
    overlay.querySelector('#sc-close').onclick = () => overlay.remove();
    const bestOfEl = overlay.querySelector('#sc-bestof');
    if (bestOfEl) {
      bestOfEl.onchange = (event) => {
        bestOf = Number(event.target.value);
        games.length = 0;
        paintCard();
      };
    }
    overlay.querySelectorAll('[data-game]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-game'));
        const slot = Number(btn.getAttribute('data-slot'));
        games[idx] = games[idx] === slot ? undefined : slot;
        const cleaned = [];
        for (let i = 0; i < bestOf; i++) {
          if (games[i] !== 1 && games[i] !== 2) break;
          cleaned.push(games[i]);
          const a = cleaned.filter((s) => s === 1).length;
          const b = cleaned.filter((s) => s === 2).length;
          if (a >= winsNeeded(bestOf) || b >= winsNeeded(bestOf)) break;
        }
        games.length = 0;
        games.push(...cleaned);
        paintCard();
      };
    });
    const send = async (path) => {
      const errEl = overlay.querySelector('#sc-err');
      errEl.hidden = true;
      const recorded = games.filter((slot) => slot === 1 || slot === 2).map((winnerSlot) => ({ winnerSlot }));
      const s1 = recorded.filter((g) => g.winnerSlot === 1).length;
      const s2 = recorded.filter((g) => g.winnerSlot === 2).length;
      try {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/${path}`, {
          hostPassword,
          matchId: match.id,
          bestOf,
          games: recorded,
          score1: s1,
          score2: s2,
          reason: overlay.querySelector('#sc-reason')?.value,
        });
        overlay.remove();
        onSaved(next);
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
    const saveBtn = overlay.querySelector('#sc-save');
    if (saveBtn) saveBtn.onclick = () => send('games');
    const lockBtn = overlay.querySelector('#sc-lock');
    if (lockBtn) lockBtn.onclick = () => send('report');
    const unlockBtn = overlay.querySelector('#sc-unlock');
    if (unlockBtn) {
      unlockBtn.onclick = async () => {
        if (!window.confirm('Unlock this series? Later matches that already used this result will unlock too.')) return;
        const errEl = overlay.querySelector('#sc-err');
        errEl.hidden = true;
        try {
          const next = await api.post(`/arenas/${encodeURIComponent(slug)}/reset-match`, {
            hostPassword,
            matchId: match.id,
          });
          overlay.remove();
          onSaved(next);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        }
      };
    }
  };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  paintCard();
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

async function renderArena(slug) {
  hideKickStream();
  if (chatSlug && chatSlug !== slug) hideArenaChat();
  root.innerHTML = `<p class="muted">Loading ${esc(slug)}…</p>`;
  let data;
  try {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
    applyBracketLayoutFixes(data);
  } catch (err) {
    root.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }

  let hostMode = Boolean(data.viewerIsHost);
  const openForSignup = () => data.tournament.status === 'registration' && data.tournament.registrationMode !== 'list';
  let tab = openForSignup() && !hostMode ? 'enter' : 'bracket';
  let quoteTimer = 0;
  let payWatchTimer = 0;
  let payWatchAutoUsed = 0;
  let payWatchChecking = false;
  let payWatchGen = 0;
  const PAY_WATCH_AUTO_MAX = 4;
  const PAY_WATCH_AUTO_MS = 30000;
  const stopPayWatchTimer = () => {
    window.clearTimeout(payWatchTimer);
    window.clearInterval(payWatchTimer);
    payWatchTimer = 0;
  };
  let shuffle = false;
  let swapA = '';
  let swapB = '';
  let pairA = '';
  let pairB = '';
  let pairRound = '';
  let swapPick = false;
  let placeEntry = '';
  let hostSavedMsg = '';
  let rosterFilter = 'unpaid';
  let standingsTab = 'place';
  let bestOf = BEST_OF.includes(Number(data.tournament.bestOf)) ? Number(data.tournament.bestOf) : 3;
  let finalsBestOf = BEST_OF.includes(Number(data.tournament.finalsBestOf)) ? Number(data.tournament.finalsBestOf) : null;
  let breakTies = Boolean(data.tournament.breakTies) && canHaveThirdPlace(data.tournament);
  let roundBestOf = { ...(data.tournament.roundBestOf || {}) };

  const reload = async () => {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
    applyBracketLayoutFixes(data);
    hostMode = Boolean(data.viewerIsHost);
  };

  /** Runs a host request, signing in first if needed, then repaints with the fresh arena. */
  const hostAction = async (errEl, run) => {
    if (errEl) errEl.hidden = true;
    if (!hostMode) {
      if (isGrantedHost() && !isAdminMode()) {
        const msg = 'You can only change tournaments you created.';
        if (errEl) { errEl.hidden = false; errEl.textContent = msg; }
        else window.alert(msg);
        return;
      }
      const ok = await openAdminSignIn();
      if (!ok) return;
      await reload();
      if (!hostMode) {
        const msg = 'Admin tools are on, but this request still failed ownership. Try again.';
        if (errEl) { errEl.hidden = false; errEl.textContent = msg; }
        else window.alert(msg);
        return;
      }
    }
    try {
      const next = await run();
      if (next && next.tournament) {
        applyBracketLayoutFixes(next);
        data = next;
        hostMode = Boolean(data.viewerIsHost);
      }
      else await reload();
      paint();
    } catch (err) {
      if (!errEl) {
        window.alert(err.message);
        return;
      }
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  };

  function myArenaEntry() {
    if (playerUser) {
      const uid = Number(playerUser.id);
      if (uid) {
        const hit = data.entries.find((e) => Number(e.userId) === uid);
        if (hit) return hit;
      }
      const handle = String(playerUser.tourneyHandle || '').trim().toLowerCase();
      if (handle) {
        const hit = data.entries.find((e) => String(e.handle || '').toLowerCase() === handle);
        if (hit) return hit;
      }
    }
    const code = storedInvoice(slug);
    if (code) {
      const hit = data.entries.find((e) => e.invoiceCode === code);
      if (hit) return hit;
    }
    return null;
  }

  function canChangeDeck(t, entry, isMine) {
    if (!t) return false;
    if (t.status === 'completed') return false;
    if (hostMode) return true;
    if (!isMine) return false;
    if (data.listsLocked) return false;
    if (t.status === 'in_progress') return false;
    return true;
  }

  function nextMatchFor(entry) {
    if (!entry) return null;
    const open = (data.matches || []).filter((m) => (
      m.status === 'ready'
      && (Number(m.entry1Id) === Number(entry.id) || Number(m.entry2Id) === Number(entry.id))
    ));
    return open[0] || null;
  }

  function playerMatchIds() {
    const mine = myArenaEntry();
    const ids = new Set();
    if (!mine) return ids;
    for (const m of data.matches || []) {
      if (Number(m.entry1Id) === Number(mine.id) || Number(m.entry2Id) === Number(mine.id)) ids.add(m.id);
    }
    return ids;
  }

  function bindDeckChips(scope) {
    (scope || document).querySelectorAll('[data-view-deck]').forEach((btn) => {
      btn.onclick = () => {
        const entry = data.entries.find((e) => String(e.id) === btn.getAttribute('data-view-deck'));
        if (entry) openLockedDeckModal(entry);
      };
    });
    (scope || document).querySelectorAll('[data-lock-deck]').forEach((btn) => {
      btn.onclick = async () => {
        const entry = data.entries.find((e) => String(e.id) === btn.getAttribute('data-lock-deck'));
        if (!entry) return;
        try {
          await promptLockDeck(entry);
        } catch (err) {
          window.alert(err.message);
        }
      };
    });
  }

  async function promptLockDeck(entry) {
    const chosen = await openDeckPasteModal({
      title: `Lock a deck for ${entry.handle}`,
      subtitle: 'Paste the list they exported.',
      playName: String((entry && entry.playName) || '').trim(),
      quota: classQuotaOf(data.tournament),
    });
    if (!chosen) return;
    const next = await api.post(`/arenas/${encodeURIComponent(slug)}/register-deck`, {
      hostPassword,
      entryId: entry.id,
      playName: chosen.playName,
      deckText: chosen.deckText,
      ddlClass: inferClassFromCounts(chosen.deck && chosen.deck.counts),
    });
    if (next && next.tournament) {
      applyBracketLayoutFixes(next);
      data = next;
    } else await reload();
    paint();
  }

  const paint = () => {
    bracketFsLock = true;
    window.clearInterval(quoteTimer);
    stopPayWatchTimer();
    quoteTimer = 0;
    const t = data.tournament;
    const confirmed = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow);
    const pending = data.entries.filter((e) => !e.paid && !e.whitelist);
    const whitelist = data.entries.filter((e) => e.whitelist);
    const live = t.status !== 'registration';
    const phase = data.phase || phaseOf(t);
    const mine = myArenaEntry();
    setTreeMode(live && tab === 'bracket');
    syncKickStream(t);
    syncArenaChat(t, hostMode);
    const predCount = (data.predictions || []).length;
    const nav = [
      ['bracket', 'Bracket'],
      openForSignup() ? ['enter', mine ? 'My Arena' : 'Register'] : (mine ? ['enter', 'My Arena'] : null),
      ['players', hostMode && pending.length ? `Players (${pending.length} unpaid)` : `Players (${confirmed.length})`],
      Number(t.whitelistSpots) > 0 ? ['whitelist', `Whitelist (${whitelist.length}/${t.whitelistSpots || 0})`] : null,
      live ? ['standings', 'Standings'] : null,
      t.predictionsEnabled && predCount > 0 ? ['predict', `Predictions (${predCount})`] : null,
      hostMode ? ['host', 'TO desk'] : null,
    ].filter(Boolean);
    if (!nav.some(([id]) => id === tab)) tab = 'bracket';
    const rewards = rewardsOf(data, t);
    const podium = data.podium && t.status === 'completed' && data.podium.first
      ? prestigePodiumHtml(data.podium, rewards, t, confirmed.length)
      : '';
    const treeNote = t.bracketSize
      ? `${confirmed.length} paid · ${t.bracketSize}-slot tree`
      : `${confirmed.length} paid${t.capPlayers !== false ? ` / ${t.maxPlayers} cap` : ''}`;
    const slimEnter = tab === 'enter' && openForSignup() && !mine;
    root.innerHTML = `<div class="arena-shell">
      <nav class="arena-nav">
        ${nav.map(([id, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''} ${id === 'host' ? 'is-host' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div>
        <header class="arena-head${slimEnter ? ' is-enter' : ''}">
          <div class="arena-lockup">
            ${slimEnter ? '' : `<div class="hero-crest arena-crest">
              <img src="/bracket/crest.jpg" alt="">
            </div>`}
            <div class="arena-copy">
              <p class="hero-kicker">${slimEnter ? 'Register' : (isGrandArena(t) ? 'Grand Tournament' : 'Doginal Dogs')}</p>
              <h1>${esc(t.name)} ${kindTagHtml(t)} ${badge(phase)}</h1>
              ${slimEnter ? `<p class="muted">${esc(formatTitle(t))} · ${feeUsd(t) > 0 ? `${esc(formatUsd(feeUsd(t)))} entry` : 'Free'} · ${esc(treeNote)}</p>${scheduleClockHtml(t)}` : `<i class="ornament tight" aria-hidden="true"><span></span></i>
              <p class="share-line">
                <span class="mono muted">${esc(location.origin)}${arenaShareHref(slug)}</span>
                <button type="button" class="copy" data-copy="${esc(`${location.origin}${arenaShareHref(slug)}`)}" ${tip('Canonical share link. One URL — query, not hash.')}>Copy link</button>
              </p>
              <dl class="meta">
                <div><dt>Players</dt><dd>${esc(treeNote)}</dd></div>
                <div><dt>Format</dt><dd>${esc(formatTitle(t))}</dd></div>
                <div><dt>Entry</dt><dd>${feeUsd(t) > 0 ? `${t.feeMode === 'charity' ? `Donate ${formatUsd(feeUsd(t))}${t.charityName ? ` to ${t.charityName}` : ''}` : `${formatUsd(feeUsd(t))} USD`}` : 'Free'}</dd></div>
                <div><dt>When</dt><dd>${scheduleClockHtml(t)}</dd></div>
                ${classQuotaOf(t) ? `<div ${tip('Locked lists must meet this class mix.')}><dt>Decks</dt><dd>${esc(classQuotaLabel(classQuotaOf(t)))}</dd></div>` : ''}
                ${rewardMetaHtml(rewards)}
              </dl>
              <p class="muted"><a href="/tourney/#/rules">Rules</a> — official vs scrim, list lock, on-chain entry, no-show, dispute.</p>`}
            </div>
          </div>
          ${slimEnter ? '' : organizerHtml(t, resolveHostUser(t, data.hostUser))}
        </header>
        ${slimEnter ? '' : `${t.description ? `<p class="muted">${esc(t.description)}</p>` : ''}
        ${rewardBreakdownHtml(rewards)}
        ${kickReplayHtml(t)}
        ${podium}`}
        <div id="panel"></div>
      </div>
    </div>`;
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => { tab = btn.getAttribute('data-tab'); paint(); };
    });
    bindCopy(root);
    const panel = document.getElementById('panel');
    if (tab === 'enter') paintEnter(panel, t);
    else if (tab === 'players') paintPlayers(panel, t);
    else if (tab === 'whitelist') paintWhitelist(panel, t);
    else if (tab === 'standings') paintStandings(panel);
    else if (tab === 'predict') paintPredict(panel, t);
    else if (tab === 'bracket') paintBracket(panel, t);
    else paintHostTools(panel, t);
    bindNightboardClock(root);
    bracketFsLock = false;
  };

  const goTab = (next) => { tab = next; paint(); };

  function bindPaymentWatch(panel, entry) {
    if (!entry || entry.paid || !(feeUsd(data.tournament) > 0)) return;
    if (entry.payAsset === 'XMONEY' || entry.payAsset === 'USDC_SOL') {
      const errEl = panel.querySelector('#watch-err');
      const okEl = panel.querySelector('#watch-ok');
      const checkBtn = panel.querySelector('#watch-check');
      if (checkBtn) {
        checkBtn.onclick = async () => {
          if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
          checkBtn.disabled = true;
          try {
            const next = await api.post(`/arenas/${encodeURIComponent(slug)}/check-payment`, entry.payAsset === 'USDC_SOL'
              ? {
                invoiceCode: entry.invoiceCode || storedInvoice(slug),
                fromWallet: document.getElementById('watch-wallet')?.value || entry.fromWallet,
                txid: document.getElementById('watch-txid')?.value || entry.payTxid,
              }
              : {
                invoiceCode: entry.invoiceCode || storedInvoice(slug),
                xPayerHandle: document.getElementById('watch-xhandle')?.value || entry.xPayerHandle,
              });
            if (next && next.tournament) {
              applyBracketLayoutFixes(next);
              data = next;
            }
            if (okEl) {
              okEl.hidden = false;
              okEl.textContent = entry.payAsset === 'USDC_SOL'
                ? 'Marked as sent. The host will confirm when they see the USDC on Solana.'
                : 'Marked as sent. The host will confirm when they see it on XMoney.';
            }
            paint();
          } catch (err) {
            if (errEl) { errEl.hidden = false; errEl.textContent = err.message; }
          } finally {
            checkBtn.disabled = false;
          }
        };
      }
      return;
    }
    const gen = ++payWatchGen;
    payWatchChecking = false;
    const errEl = panel.querySelector('#watch-err');
    const okEl = panel.querySelector('#watch-ok');
    const autoEl = panel.querySelector('#watch-auto');
    const checkBtn = panel.querySelector('#watch-check');
    const box = panel.querySelector('.pay-watch');
    const label = panel.querySelector('.pay-watch > .muted');
    const checkLabel = "I've sent it — check the chain";

    const setAutoNote = (text) => {
      if (!autoEl) return;
      autoEl.textContent = text || '';
      autoEl.hidden = !text;
    };

    const showLive = (live, next) => {
      if (label) label.textContent = payWatchLabel(live);
      if (box) {
        const status = live.paid ? 'confirmed' : (live.payWatchStatus || 'watching');
        box.className = `pay-watch is-${status}`;
      }
      if (next && next.mismatchFrom) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = `That transaction was sent from ${next.mismatchFrom}. Put that address in the sending wallet field.`;
        }
        if (okEl) okEl.hidden = true;
        return 'mismatch';
      }
      if (next && next.watchError && !live.paid) {
        if (errEl) { errEl.hidden = false; errEl.textContent = next.watchError; }
        if (okEl) okEl.hidden = true;
        return 'error';
      }
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (okEl) {
        okEl.hidden = false;
        okEl.textContent = live.paid
          ? 'Payment confirmed on the Dogecoin chain.'
          : live.payWatchStatus === 'seen'
            ? 'Payment seen. Waiting on 1 confirmation.'
            : payWatchAutoUsed >= PAY_WATCH_AUTO_MAX
              ? 'No matching payment yet. Automatic checks stopped — tap the button to check again, or ask the host to confirm.'
              : 'No matching payment yet. Send the quoted amount, then wait for the next automatic check.';
      }
      if (next && next.fromWallet) {
        const walletEl = document.getElementById('watch-wallet');
        if (walletEl && !walletEl.value) walletEl.value = next.fromWallet;
      }
      return live.paid ? 'paid' : (live.payWatchStatus || 'watching');
    };

    const scheduleAuto = () => {
      if (gen !== payWatchGen) return;
      stopPayWatchTimer();
      if (payWatchAutoUsed >= PAY_WATCH_AUTO_MAX) {
        setAutoNote('Automatic checks stopped after 4 tries. If the DOGE is already on-chain, tap the button to confirm, or ask the host to confirm.');
        return;
      }
      const nextN = payWatchAutoUsed + 1;
      setAutoNote(`Watching the chain — automatic check ${nextN} of ${PAY_WATCH_AUTO_MAX} in 30 seconds.`);
      payWatchTimer = window.setTimeout(() => { void runCheck({ auto: true }); }, PAY_WATCH_AUTO_MS);
    };

    const runCheck = async ({ auto } = {}) => {
      if (gen !== payWatchGen || payWatchChecking) return;
      stopPayWatchTimer();
      payWatchChecking = true;
      let stopAuto = false;
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = auto
          ? `Checking the chain (${Math.min(payWatchAutoUsed + 1, PAY_WATCH_AUTO_MAX)} of ${PAY_WATCH_AUTO_MAX})…`
          : 'Checking the chain…';
      }
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (okEl) { okEl.hidden = true; okEl.textContent = ''; }
      if (auto) setAutoNote(`Checking the Dogecoin chain (${Math.min(payWatchAutoUsed + 1, PAY_WATCH_AUTO_MAX)} of ${PAY_WATCH_AUTO_MAX})…`);
      try {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/check-payment`, {
          invoiceCode: entry.invoiceCode || storedInvoice(slug),
          fromWallet: document.getElementById('watch-wallet')?.value || entry.fromWallet,
          txid: document.getElementById('watch-txid')?.value || entry.payTxid,
        });
        if (auto) payWatchAutoUsed += 1;
        if (next && next.tournament) {
          applyBracketLayoutFixes(next);
          data = next;
        }
        const live = (next && next.entries || data.entries || []).find((row) => Number(row.id) === Number(entry.id)) || entry;
        const state = showLive(live, next);
        if (live.paid) {
          payWatchAutoUsed = PAY_WATCH_AUTO_MAX;
          stopAuto = true;
          paint();
          return;
        }
        if (state === 'mismatch') {
          payWatchAutoUsed = PAY_WATCH_AUTO_MAX;
          stopAuto = true;
          setAutoNote('Automatic checks paused. Update the sending wallet, then tap the button.');
          return;
        }
      } catch (err) {
        if (errEl) { errEl.hidden = false; errEl.textContent = err.message; }
        else window.alert(err.message);
      } finally {
        if (gen !== payWatchGen) return;
        payWatchChecking = false;
        if (checkBtn && checkBtn.isConnected) {
          checkBtn.disabled = false;
          checkBtn.textContent = checkLabel;
        }
        if (!stopAuto) {
          const liveNow = myArenaEntry() || entry;
          if (!liveNow.paid) scheduleAuto();
        }
      }
    };

    if (checkBtn) {
      checkBtn.onclick = () => {
        if (payWatchAutoUsed >= PAY_WATCH_AUTO_MAX) payWatchAutoUsed = 0;
        void runCheck({ auto: true });
      };
    }
    scheduleAuto();
  }

  function paintEnter(panel, t) {
    const usd = feeUsd(t);
    const needsAccount = t.requireAccount !== false;
    const mine = myArenaEntry();
    if (needsAccount && !playerUser) {
      panel.innerHTML = `<div class="enter-card enter-card-gate">
          <p class="enter-kicker">Registration</p>
          <h2>Take a seat</h2>
          ${enterTicketHtml(t, usd)}
          <p class="muted">${usd > 0 ? `${esc(formatUsd(usd))} to sit. Sign in with Discord — we never store a tournament password.` : 'Sign in with Discord to register. We never store a tournament password.'}</p>
          <p><a class="btn enter-go" href="${esc(discordStartHref())}">Sign in with Discord</a></p>
        </div>`;
      bindCopy(panel);
      return;
    }
    if (mine) {
      const canSwap = canChangeDeck(t, mine, true);
      const deckLocked = hasLockedList(mine);
      const next = nextMatchFor(mine);
      const opp = next ? entryOf(data.entries, Number(next.entry1Id) === Number(mine.id) ? next.entry2Id : next.entry1Id) : null;
      const phase = data.phase || phaseOf(t);
      const chips = [
        ['Registered', true],
        [mine.paid ? paidReceipt(mine) || 'Paid' : 'Unpaid', mine.paid],
        [deckLocked ? 'List submitted' : 'No list', deckLocked],
        t.requireCheckIn ? [mine.checkedIn ? 'Checked in' : 'Not checked in', mine.checkedIn] : null,
      ].filter(Boolean);
      const deckBlock = deckLocked
        ? `<div class="play-deck-picked is-locked">
          ${registeredDeckSummaryHtml(mine.registeredDeck)}
          <div class="row wrap" style="margin-top:8px">
            ${mine.registeredDeck && !mine.registeredDeck.hidden ? `<button type="button" class="btn ghost" data-view-deck="${mine.id}">View list</button>` : ''}
            ${canSwap ? '<button type="button" class="btn" data-change-mine>Change deck</button>' : '<p class="hint">This list is locked for the arena.</p>'}
          </div>
        </div>`
        : (canSwap
          ? `${deckPasteFieldHtml('mine-deck', { required: Boolean(t.requireRegisteredDeck), playName: mine.playName || '', quota: classQuotaOf(t) })}
          <p class="err" id="enter-err" hidden></p>
          <button type="button" class="btn" id="lock-mine">Save this 40</button>`
          : `<p class="muted">Export from the ddlTCG builder and paste on this page before lists lock.${t.semiIrl ? ' You cannot sit a table without a pasted 40.' : ''}</p>`);
      panel.innerHTML = `<div class="enter-card enter-card-mine">
          <p class="enter-kicker">My Arena</p>
          <h2>${esc(mine.handle)}</h2>
          <div class="my-arena-status">${chips.map(([label, on]) => `<span class="chip ${on ? 'on' : ''}">${esc(label)}</span>`).join('')}</div>
          <p class="muted">${esc(unpaidPayHint(mine, t))}${!deckLocked ? ' Paste a builder export to lock your 40.' : ''}</p>
        </div>
        ${usd > 0 ? paymentWatchHtml(mine, data.payTo, usd, t) : ''}
        ${t.requireCheckIn && phase === 'check_in' && mine.paid && !mine.checkedIn ? `<div class="row wrap"><button type="button" class="btn" id="checkin-mine">Check in</button></div>` : ''}
        ${next ? `<div class="notice">
          <p><strong>Next match</strong> · ${esc(bestOfLabel(next.bestOf))}</p>
          <p>${esc(opp && opp.handle ? opp.handle : 'TBD')}</p>
          <p><a class="btn" href="${esc(tableHref(slug, next.id))}">Open table</a>
            ${next.status === 'ready' ? `<button type="button" class="btn ghost" data-report-mine="${next.id}">Submit score</button>` : ''}</p>
        </div>` : (t.status === 'in_progress' ? '<p class="muted">No open match yet — hang tight.</p>' : '')}
        <h3>Your 40</h3>
        ${deckBlock}`;
      bindCopy(panel);
      bindDeckChips(panel);
      if (usd > 0) bindPaymentWatch(panel, mine);
      const checkinBtn = panel.querySelector('#checkin-mine');
      if (checkinBtn) {
        checkinBtn.onclick = async () => {
          try {
            const nextData = await api.post(`/arenas/${encodeURIComponent(slug)}/check-in`, { entryIds: [mine.id] });
            if (nextData && nextData.tournament) {
              applyBracketLayoutFixes(nextData);
              data = nextData;
            } else await reload();
            paint();
          } catch (err) {
            window.alert(err.message);
          }
        };
      }
      const reportBtn = panel.querySelector('[data-report-mine]');
      if (reportBtn) {
        reportBtn.onclick = () => {
          const match = data.matches.find((m) => String(m.id) === reportBtn.getAttribute('data-report-mine'));
          if (!match) return;
          openScorecard(data, slug, match, (nextData) => {
            applyBracketLayoutFixes(nextData);
            data = nextData;
            paint();
          }, { asHost: false, entry: mine });
        };
      }
      if (canSwap && !deckLocked) {
        const field = bindDeckPasteField(panel, {
          quota: classQuotaOf(t),
          onPick: (deck) => applyClassPick(panel, 'enter-class', inferClassFromCounts(deck.counts)),
        });
        const lockBtn = panel.querySelector('#lock-mine');
        if (lockBtn) lockBtn.onclick = async () => {
          const errEl = panel.querySelector('#enter-err') || panel.querySelector('.play-deck-err');
          if (errEl) errEl.hidden = true;
          try {
            if (!field.check()) return;
            const locked = field.get();
            const nextData = await api.post(`/arenas/${encodeURIComponent(slug)}/register-deck`, {
              playName: locked.playName,
              deckText: locked.deckText,
              ddlClass: inferClassFromCounts(locked.deck && locked.deck.counts),
            });
            if (nextData && nextData.tournament) {
              applyBracketLayoutFixes(nextData);
              data = nextData;
            } else await reload();
            paint();
          } catch (err) {
            if (errEl) {
              errEl.hidden = false;
              errEl.textContent = err.message;
            } else window.alert(err.message);
          }
        };
      }
      const changeBtn = panel.querySelector('[data-change-mine]');
      if (changeBtn) changeBtn.onclick = async () => {
        try {
          await promptLockDeck(mine);
        } catch (err) {
          window.alert(err.message);
        }
      };
      return;
    }
    const lockedHandle = playerUser && playerUser.tourneyHandle;
    const needHandle = playerUser && !playerUser.tourneyHandle;
    const needDeck = Boolean(t.requireRegisteredDeck);
    const charity = t.feeMode === 'charity';
    const dogeOn = usd > 0 && acceptsDoge(t);
    const xOn = usd > 0 && acceptsXmoney(t);
    const usdcOn = usd > 0 && acceptsUsdcSol(t, data.payTo);
    const usdcAddr = solanaTreasuryOf(t, data.payTo);
    const defaultRail = defaultPayRail(t, data.payTo);
    const railCount = [dogeOn, usdcOn, xOn].filter(Boolean).length;
    const showRails = railCount > 1;
    const handleLabel = t.requireTeams && !playerUser ? 'Team name' : 'Handle';
    const railRadios = [
      dogeOn ? `<label class="pay-rail ${defaultRail === 'DOGE' ? 'on' : ''}"><input type="radio" name="pay-rail" value="DOGE" ${defaultRail === 'DOGE' ? 'checked' : ''}><strong>DOGE</strong><span>Quoted on-chain after you register.</span></label>` : '',
      usdcOn ? `<label class="pay-rail ${defaultRail === 'USDC_SOL' ? 'on' : ''}"><input type="radio" name="pay-rail" value="USDC_SOL" ${defaultRail === 'USDC_SOL' ? 'checked' : ''}><strong>USDC</strong><span>Send on Solana.</span></label>` : '',
      xOn ? `<label class="pay-rail ${defaultRail === 'XMONEY' ? 'on' : ''}"><input type="radio" name="pay-rail" value="XMONEY" ${defaultRail === 'XMONEY' ? 'checked' : ''}><strong>XMoney</strong><span>Send to @${esc(xHandleOf(t))} on X.</span></label>` : '',
    ].filter(Boolean).join('');
    const payStep = usd <= 0 ? '' : `<li>
        <p class="enter-step-n">02</p>
        <h3>${charity ? `Donate ${esc(formatUsd(usd))}` : `${esc(formatUsd(usd))} to sit`}</h3>
        ${charity && t.charityName ? `<p class="muted">Minimum to ${esc(t.charityName)}.</p>` : ''}
        ${charity ? `<div><label for="donate-usd">Donate (USD)</label>
          <input id="donate-usd" type="number" min="${usd}" step="0.01" value="${usd}"></div>` : ''}
        ${showRails ? `<div class="pay-rails" id="pay-rails">${railRadios}</div>` : ''}
        <div data-rail-panel="DOGE" ${defaultRail !== 'DOGE' ? 'hidden' : ''}>
          ${dogeOn ? `<p class="muted">You’ll get the live DOGE amount after you take the seat.</p>` : ''}
        </div>
        <div data-rail-panel="USDC_SOL" ${defaultRail !== 'USDC_SOL' ? 'hidden' : ''}>
          ${usdcOn ? `<div class="usdc-sol-pay">
            <p class="muted">Send ${esc(formatUsd(usd))} as <strong>USDC on Solana</strong> (not USDT, not another chain) to</p>
            <code class="mono">${esc(usdcAddr)}</code>
            <p><a class="btn ghost" href="${esc(phantomUsdcHref(usdcAddr, usd))}" target="_blank" rel="noopener noreferrer">Open Phantom</a>
              <button type="button" class="copy" data-copy="${esc(usdcAddr)}">Copy</button>
              <a class="btn ghost" href="${esc(solscanAccountHref(usdcAddr))}" target="_blank" rel="noopener noreferrer">Solscan</a></p>
            <div><label for="sol-from">Your Solana wallet</label>
              <input id="sol-from" class="mono" maxlength="44" autocomplete="off" spellcheck="false" placeholder="The wallet you send FROM"></div>
            <p class="hint">Pay from that same wallet. The host marks PAID when they see the USDC — this rail is not auto-watched.</p>
          </div>` : ''}
        </div>
        <div data-rail-panel="XMONEY" ${defaultRail !== 'XMONEY' ? 'hidden' : ''}>
          ${xOn ? `<div class="xmoney-pay">
            <p class="muted">Send ${esc(formatUsd(usd))} in USDT, BNB, or another BEP-20 token to</p>
            <p class="x-handle">@${esc(xHandleOf(t))}</p>
            <p><a class="btn ghost" href="${esc(xmoneyHref(xHandleOf(t)))}" target="_blank" rel="noopener noreferrer">Open XMoney</a>
              <button type="button" class="copy" data-copy="@${esc(xHandleOf(t))}">Copy @</button></p>
            <div><label for="x-payer">Your X @handle</label>
              <input id="x-payer" maxlength="16" autocomplete="off" spellcheck="false" placeholder="@you"></div>
            <p class="hint">Pay from that same account. The host marks PAID when they see it — XMoney is not auto-watched.</p>
          </div>` : ''}
        </div>
      </li>`;
    const enterBlurb = needDeck
      ? (usd > 0
        ? (railCount === 1 && xOn
          ? `Pay ${esc(formatUsd(usd))} via XMoney to @${esc(xHandleOf(t))}, then paste your 40.`
          : (railCount === 1 && usdcOn
            ? `Send ${esc(formatUsd(usd))} USDC on Solana, then paste your 40.`
            : `Name, pay ${esc(formatUsd(usd))}, and paste your 40.`))
        : 'Free entry — paste your 40 when you register.')
      : (usd > 0
        ? (railCount === 1 && xOn
          ? `Pay ${esc(formatUsd(usd))} via XMoney to @${esc(xHandleOf(t))}, then you’re on the list.`
          : (railCount === 1 && usdcOn
            ? `Send ${esc(formatUsd(usd))} USDC on Solana, then you’re on the list.`
            : `Name, pay ${esc(formatUsd(usd))}, sit. Deck can wait.`))
        : 'Free entry — you’re in as soon as you register.');
    const deckStep = needDeck ? `<li>
            <p class="enter-step-n">${usd > 0 ? '03' : '02'}</p>
            <h3>Paste your 40</h3>
            ${deckPasteFieldHtml('enter-play', { required: true, quota: classQuotaOf(t) })}
          </li>` : '';
    panel.innerHTML = `<div class="enter-card">
      <p class="enter-kicker">Registration</p>
      <h2>Take a seat</h2>
      ${enterIdentHtml()}
      ${enterTicketHtml(t, usd)}
      <p class="muted">${enterBlurb}</p>
      <form id="enter-form">
        <ol class="enter-steps">
          <li>
            <p class="enter-step-n">01</p>
            <h3>${esc(handleLabel)}</h3>
            ${needHandle ? `<p class="muted">This name is yours across every arena. 2–24 characters.</p>` : ''}
            <div><label for="handle" class="sr-only">${esc(handleLabel)}</label>
            <input id="handle" required minlength="2" maxlength="24" placeholder="PackName" value="${esc(t.requireTeams && !playerUser ? '' : (lockedHandle || ''))}" ${playerUser && lockedHandle ? 'readonly' : ''}></div>
            ${t.requireTeams ? `<div><label for="team">${playerUser ? 'Team name' : 'Captain handle'}</label><input id="team" ${playerUser ? '' : 'required'} minlength="2" maxlength="24" value="${esc(playerUser ? '' : (lockedHandle || ''))}"></div>` : ''}
            ${t.requireVerifiedEmail ? `<div><label for="email">Email</label><input id="email" type="email" required></div>` : ''}
            ${t.countryLock ? `<div><label for="country">Country</label><input id="country" required placeholder="${esc(t.allowedCountries || 'Country')}"></div>` : ''}
            ${classQuotaOf(t)
              ? `<div><span class="lbl">Class</span>${classPickerHtml('enter-class', DDL_DEFAULT_CLASS)}</div>`
              : `<details class="enter-more"><summary>Class on the roster</summary>${classPickerHtml('enter-class', DDL_DEFAULT_CLASS)}</details>`}
          </li>
          ${payStep}
          ${deckStep}
        </ol>
        <p class="err" id="enter-err" hidden></p>
        <div class="ok" id="enter-ok" hidden></div>
        <button class="btn enter-go" type="submit">${usd > 0 ? 'Register & pay' : 'Take my seat'}</button>
      </form>
    </div>`;
    bindCopy(panel);
    bindClassPicker(panel);
    const playField = needDeck ? bindDeckPasteField(panel, {
      quota: classQuotaOf(t),
      onPick: (deck) => applyClassPick(panel, 'enter-class', inferClassFromCounts(deck.counts)),
    }) : null;
    const syncRails = () => {
      const rail = panel.querySelector('input[name="pay-rail"]:checked')?.value || defaultRail;
      panel.querySelectorAll('.pay-rail').forEach((el) => {
        el.classList.toggle('on', el.querySelector('input')?.value === rail);
      });
      panel.querySelectorAll('[data-rail-panel]').forEach((el) => {
        el.hidden = el.getAttribute('data-rail-panel') !== rail;
      });
    };
    panel.querySelectorAll('input[name="pay-rail"]').forEach((el) => { el.onchange = syncRails; });
    syncRails();
    const form = document.getElementById('enter-form');
    if (form) form.onsubmit = async (event) => {
      event.preventDefault();
      const errEl = document.getElementById('enter-err');
      const okEl = document.getElementById('enter-ok');
      errEl.hidden = true;
      try {
        if (needDeck && (!playField || !playField.check())) {
          throw new Error('Paste the 40-card list you exported from ddltcg.com/play.');
        }
        const picked = playField ? playField.get() : { playName: '', deckText: '' };
        if (playerUser && !playerUser.tourneyHandle) {
          const saved = await authApi.post('/me/handle', { handle: document.getElementById('handle').value });
          playerUser = saved.user;
          applyPlayerChrome();
        }
        const payAsset = panel.querySelector('input[name="pay-rail"]:checked')?.value || defaultRail;
        if (payAsset === 'XMONEY' && !sanitizeXHandleInput(document.getElementById('x-payer')?.value)) {
          throw new Error('Enter the X @handle you will send from.');
        }
        if (payAsset === 'USDC_SOL' && !sanitizeSolanaAddressInput(document.getElementById('sol-from')?.value)) {
          throw new Error('Enter the Solana wallet you will send USDC from.');
        }
        const entry = await api.post(`/arenas/${encodeURIComponent(slug)}/enter`, {
          handle: document.getElementById('handle').value,
          team: document.getElementById('team')?.value,
          email: document.getElementById('email')?.value,
          country: document.getElementById('country')?.value,
          fromWallet: document.getElementById('sol-from')?.value || document.getElementById('from-wallet')?.value || '',
          txid: document.getElementById('pay-txid')?.value,
          xPayerHandle: document.getElementById('x-payer')?.value || '',
          payAsset,
          donateUsd: document.getElementById('donate-usd')?.value,
          ddlClass: readClassPick(form, 'enter-class'),
          playName: picked.playName || '',
          deckText: picked.deckText || undefined,
        });
        rememberInvoice(slug, entry.invoiceCode);
        window.clearInterval(quoteTimer);
        form.querySelector('button[type="submit"]').disabled = true;
        okEl.hidden = false;
        const xPay = payAsset === 'XMONEY';
        const usdcPay = payAsset === 'USDC_SOL';
        okEl.innerHTML = usd > 0
          ? (xPay
            ? `<strong>${esc(entry.handle)}</strong> is registered. Send <strong>${esc(formatUsd(entry.amountUsd))}</strong> to <strong>@${esc(xHandleOf(t))}</strong> on XMoney from <strong>@${esc(entry.xPayerHandle || sanitizeXHandleInput(document.getElementById('x-payer')?.value))}</strong>, then tap I’ve sent it.`
            : (usdcPay
              ? `<strong>${esc(entry.handle)}</strong> is registered. Send <strong>${esc(formatUsd(entry.amountUsd))}</strong> USDC on Solana to <code class="mono">${esc(entry.payTo || usdcAddr)}</code> from <code class="mono">${esc(entry.fromWallet || document.getElementById('sol-from')?.value || '')}</code>, then tap I’ve sent it.`
              : `<strong>${esc(entry.handle)}</strong> is registered and waiting on payment.<br>
             Send <strong>${esc(formatCrypto(entry.payAsset, entry.amountCrypto))}</strong> (${esc(formatUsd(entry.amountUsd))} at ${esc(formatUsdRate(entry.usdPerCoin))}/DOGE).<br>
             Quote your invoice <span class="mono">${esc(entry.invoiceCode)}</span> if the host needs to find your payment.<br>
             Need DOGE first? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">Swap on K9SWAP</a> — a Doginal Dogs powered, walletless crypto swapper.`))
          : `<strong>${esc(entry.handle)}</strong> is in${entry.registeredDeck ? ` · locked <strong>${esc(entry.registeredDeck.name)}</strong>` : ''}. See you on the bracket.`;
        await reload();
        paint();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
  }

  /**
   * The one roster in this app. Visitors see who is playing; the host also sees the
   * payment details and the buttons that confirm them.
   */
  function paintPlayers(panel, t) {
    const confirmed = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow);
    const pending = data.entries.filter((e) => !e.paid && !e.whitelist);
    const paidFee = feeUsd(t) > 0;
    const ordered = [...pending, ...data.entries.filter((e) => (e.paid || e.noShow) && !e.whitelist)];
    const canMarkPaid = hostMode && t.status !== 'completed';
    const canEdit = hostMode && t.status === 'registration';
    const canAddLate = hostMode && t.status === 'in_progress';
    const lateSlots = canAddLate ? lateSeatOptions(t, data.matches, data.entries) : [];
    const canAdd = canEdit || (canAddLate && lateSlots.length);
    if (!pending.length && rosterFilter === 'unpaid') rosterFilter = 'paid';

    const row = (e) => {
      const details = [];
      if (hostMode) {
        if (paidFee && e.paid) details.push(`<span>${esc(paidReceipt(e))}</span>`);
        if (paidFee && !e.paid && e.payAsset === 'XMONEY') details.push(`<span>XMoney ${esc(formatUsd(e.amountUsd))} to ${esc(e.payTo || `@${xHandleOf(t)}`)}</span>`);
        else if (paidFee && !e.paid && e.payAsset === 'USDC_SOL') details.push(`<span>USDC on Solana ${esc(formatUsd(e.amountUsd))} to <code class="mono">${esc(e.payTo || solanaTreasuryOf(t, data.payTo))}</code></span>`);
        else if (paidFee && !e.paid) details.push(`<span>Should have sent <strong>${esc(formatCrypto(e.payAsset || 'DOGE', e.amountCrypto))}</strong> (${esc(formatUsd(e.amountUsd))})</span>`);
        if (e.xPayerHandle) details.push(`<span>X @${esc(e.xPayerHandle)}</span>`);
        if (e.fromWallet) details.push(`<span>From <code class="mono">${esc(e.fromWallet)}</code></span>`);
        if (e.payNote) details.push(`<span>Note <code class="mono">${esc(e.payNote)}</code></span>`);
        if (e.payAsset === 'XMONEY' && e.payWatchStatus === 'seen') details.push('<span>Player says they sent on XMoney</span>');
        else if (e.payAsset === 'USDC_SOL' && e.payWatchStatus === 'seen') details.push('<span>Player says they sent USDC on Solana</span>');
        else if (e.payWatchStatus === 'seen') details.push('<span>Seen on-chain, waiting for a confirmation</span>');
        else if (e.payWatchStatus === 'mismatch') details.push('<span>Needs review — sending address mismatch</span>');
        else if (e.payTxid && (e.paid || e.payWatchStatus === 'confirmed')) details.push(`<span>On-chain <code class="mono">${esc(String(e.payTxid).slice(0, 12))}…</code></span>`);
        else if (paidFee && !e.paid && e.payAsset === 'XMONEY') details.push('<span>Waiting on you to confirm XMoney</span>');
        else if (paidFee && !e.paid && e.payAsset === 'USDC_SOL') details.push('<span>Waiting on you to confirm USDC on Solana</span>');
        else if (paidFee && !e.paid) details.push('<span>Watching the chain</span>');
        if (e.invoiceCode && !e.addedByHost) details.push(`<span>Invoice <code class="mono">${esc(e.invoiceCode)}</code></span>`);
        if (e.email) details.push(`<span>${esc(e.email)}</span>`);
        if (e.addedByHost) details.push('<span>Added by you</span>');
        if (e.lateEntry) details.push('<span>Added after lock</span>');
        if (e.userId || (e.discordUser && e.discordUser.discordId)) details.push('<span>Discord linked</span>');
        else details.push('<span>Discord not linked</span>');
        if (hasLockedList(e)) details.push('<span>List submitted</span>');
        else details.push('<span>No list</span>');
      }
      return `<div class="roster-row ${e.paid ? '' : 'is-pending'}">
        <div class="who">${entryAvatarHtml(e)}${namedHandleHtml(e.handle, e.badges)}${classLabelHtml(e.ddlClass)}${deckChipHtml(e)}${badge(e.noShow ? 'no_show' : e.paid ? 'confirmed' : 'pending')}</div>
        ${canMarkPaid || (hostMode && canChangeDeck(t, e, false)) ? `<div class="roster-acts">
          ${canMarkPaid && !e.paid ? `<button type="button" class="mini go" data-confirm="${e.id}" ${tip(e.payAsset === 'XMONEY' ? 'Marks PAID after you see the XMoney send from their X @handle.' : (e.payAsset === 'USDC_SOL' ? 'Marks PAID after you see the USDC on Solana from their sending wallet.' : 'Marks PAID after you verified the chain. Optional tx hash note.'))}>Mark paid</button>` : ''}
          ${canEdit && e.paid ? `<button type="button" class="mini" data-unconfirm="${e.id}" ${tip('Move back to unpaid.')}>Unpaid</button>` : ''}
          ${canChangeDeck(t, e, false) ? `<button type="button" class="mini" data-lock-deck="${e.id}" ${tip(e.registeredDeck ? 'Replace the pasted 40 while lists are unlocked.' : 'Paste this player’s exported 40.')}>${e.registeredDeck ? 'Change deck' : 'Paste 40'}</button>` : ''}
          ${canEdit ? `<button type="button" class="mini bad" data-remove="${e.id}" ${tip('Delete this entry from the arena.')}>Remove</button>` : ''}
        </div>` : ''}
        ${details.length ? `<div class="roster-pay">${details.join('')}</div>` : ''}
      </div>`;
    };

    const review = ordered.filter((e) => !e.paid && (e.payWatchStatus === 'seen' || e.payWatchStatus === 'mismatch' || e.payTxid));
    const shown = rosterFilter === 'unpaid' ? pending
      : rosterFilter === 'review' ? review
      : ordered.filter((e) => e.paid && !e.whitelist);

    panel.innerHTML = `
      ${hostMode && pending.length && paidFee ? `<div class="host-panel">
        <div class="host-flag">Host only</div>
        <p><strong>${pending.length} ${pending.length === 1 ? 'entry is' : 'entries are'} waiting on payment</strong></p>
        <p class="muted">${pending.some((e) => isHostConfirmPay(e.payAsset))
          ? 'DOGE seats can auto-confirm on-chain. XMoney and USDC-on-Solana seats wait for you to mark PAID after you see the send.'
          : 'The chain watcher marks people paid when it sees the quoted DOGE from their sending wallet. You can still confirm by hand.'}</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="watch-scan">Check the chain now</button>
          <button class="btn" type="button" id="confirm-all">Payment received for all ${pending.length}</button>
        </div>
        <p class="err" id="players-err" hidden></p>
      </div>` : `<p class="err" id="players-err" hidden></p>`}
      ${hostMode ? `<div class="roster-filters">${[['unpaid', `Unpaid (${pending.length})`], ['paid', `Paid (${confirmed.length})`], ['review', `Needs review (${review.length})`]].map(([id, label]) => `<button type="button" class="mini ${rosterFilter === id ? 'on' : ''}" data-roster="${id}">${esc(label)}</button>`).join('')}</div>` : ''}
      <p class="muted">${confirmed.length} confirmed${paidFee && pending.length && !hostMode ? ` · ${pending.length} awaiting payment` : ''}${t.capPlayers !== false ? ` · room for ${t.maxPlayers}` : ''}</p>
      <div class="roster">${shown.map(row).join('') || '<p class="muted">Nobody in this filter.</p>'}</div>
      ${canAdd ? `<div class="host-panel" style="margin-top:16px">
        <div class="host-flag">Host only</div>
        <p><strong>${canAddLate ? 'Add a player to the locked bracket' : 'Add a player yourself'}</strong></p>
        <p class="muted">${canAddLate
          ? (usesElimTree(t)
            ? 'Walk-ins and no-show replacements go into a first-round slot. Filling a bye makes that player play for their spot.'
            : (t.format === 'round_robin' || t.stage === 'groups'
              ? 'They join the live field and get matches against everyone still in.'
              : 'They join the live field and pair in the next Swiss round.'))
          : (t.registrationMode === 'list' ? 'This arena has no public sign-up, so add every participant here.' : 'For walk-ins or anyone who paid you another way. Added players count as confirmed.')}</p>
        <form class="stack" id="add-form" style="gap:8px">
          <div class="handle-typeahead">
            <input id="add-handle" placeholder="${t.requireTeams ? 'Team name' : 'Start typing a handle'}" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="add-handle-list" aria-expanded="false">
            <ul id="add-handle-list" class="handle-suggest" hidden role="listbox"></ul>
          </div>
          <div><span class="lbl">Class</span>${classPickerHtml('add-class', DDL_DEFAULT_CLASS)}</div>
          ${deckPasteFieldHtml('add-play', { required: false, quota: classQuotaOf(t) })}
          ${canAddLate && usesElimTree(t) ? `<div><label for="add-slot">Put them</label>
            <select id="add-slot">${lateSlots.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>
          </div>` : ''}
          <button class="btn ghost" type="submit">${canAddLate ? 'Add to bracket' : 'Add'}</button>
        </form>
        <p class="hint">Discord-connected handles appear as you type. You can still add a walk-in name that is not in the list.</p>
      </div>` : canAddLate ? `<p class="muted" style="margin-top:16px">No open first-round slots left. Use the Whitelist tab to swap a no-show if every first-round match is already locked.</p>` : ''}`;

    panel.querySelectorAll('[data-roster]').forEach((btn) => {
      btn.onclick = () => { rosterFilter = btn.getAttribute('data-roster'); paint(); };
    });
    const errEl = panel.querySelector('#players-err');
    const watchScan = panel.querySelector('#watch-scan');
    if (watchScan) watchScan.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/check-payment`, {}));
    const confirmAll = panel.querySelector('#confirm-all');
    if (confirmAll) confirmAll.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/confirm`, {
      hostPassword,
      entryIds: pending.map((e) => e.id),
    }));
    panel.querySelectorAll('[data-confirm]').forEach((btn) => {
      btn.onclick = () => {
        const note = window.prompt('Optional tx hash / note for this PAID mark', '') || '';
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/confirm`, {
          hostPassword,
          entryIds: [Number(btn.getAttribute('data-confirm'))],
          note,
          txid: note,
        }));
      };
    });
    panel.querySelectorAll('[data-unconfirm]').forEach((btn) => {
      btn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/confirm`, {
        hostPassword,
        entryIds: [Number(btn.getAttribute('data-unconfirm'))],
        paid: false,
      }));
    });
    panel.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this entry from the arena?')) return;
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/remove-entry`, {
          hostPassword,
          entryId: Number(btn.getAttribute('data-remove')),
        }));
      };
    });
    const addForm = panel.querySelector('#add-form');
    if (addForm) {
      bindClassPicker(addForm);
      bindHandleTypeahead(
        panel.querySelector('#add-handle'),
        panel.querySelector('#add-handle-list'),
        data.entries.map((e) => e.handle),
      );
      const addPlay = bindDeckPasteField(addForm, {
        quota: classQuotaOf(t),
        onPick: (deck) => applyClassPick(addForm, 'add-class', inferClassFromCounts(deck.counts)),
      });
      addForm.onsubmit = (event) => {
        event.preventDefault();
        const handleInput = panel.querySelector('#add-handle');
        const handle = handleInput.value;
        const slotEl = panel.querySelector('#add-slot');
        const [matchId, slot] = String((slotEl && slotEl.value) || 'auto').split(':');
        const picked = addPlay.get();
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/add-entry`, {
          hostPassword,
          handle,
          userId: pickedUserId(handleInput),
          ddlClass: readClassPick(addForm, 'add-class'),
          playName: picked.playName || undefined,
          deckText: picked.deckText || undefined,
          matchId: matchId && matchId !== 'auto' ? Number(matchId) : undefined,
          slot: slot ? Number(slot) : undefined,
        }));
      };
    }
    bindDeckChips(panel);
  }

  function paintStandings(panel) {
    const rows = data.standings || [];
    const entryById = new Map((data.entries || []).map((e) => [e.id, e]));
    const showClass = rows.some((s) => {
      const entry = entryById.get(s.entryId);
      return classLabelHtml((entry && entry.ddlClass) || s.ddlClass);
    });
    const showDeck = rows.some((s) => {
      const entry = entryById.get(s.entryId);
      return entry && entry.registeredDeck && !entry.registeredDeck.hidden;
    });
    const ordered = standingsTab === 'points'
      ? [...rows].sort((a, b) => (b.points || 0) - (a.points || 0) || (b.mapDiff || 0) - (a.mapDiff || 0) || String(a.handle).localeCompare(String(b.handle)))
      : rows;
    panel.innerHTML = `<h2>Standings</h2>
      <div class="standings-tabs">${[['place', 'Placement'], ['points', 'Points']].map(([id, label]) => `<button type="button" class="mini ${standingsTab === id ? 'on' : ''}" data-stand="${id}">${esc(label)}</button>`).join('')}</div>
      <div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>Handle</th>${showClass ? '<th>Class</th>' : ''}${showDeck ? '<th>Deck</th>' : ''}<th>Record</th>${standingsTab === 'points' ? '<th>Pts</th><th>+/-</th>' : ''}</tr></thead><tbody>
      ${ordered.map((s, i) => {
        const place = standingsTab === 'place' ? (Number(s.placement) || i + 1) : (i + 1);
        const entry = entryById.get(s.entryId);
        const deck = entry && entry.registeredDeck && !entry.registeredDeck.hidden ? entry.registeredDeck : null;
        return `<tr>
          <td class="standings-place">${standingBadgeHtml(place) || place}</td>
          <td>${namedHandleHtml(s.handle)}</td>
          ${showClass ? `<td>${classLabelHtml((entry && entry.ddlClass) || s.ddlClass) || '—'}</td>` : ''}
          ${showDeck ? `<td>${deck ? `<button type="button" class="linkish" data-view-deck="${entry.id}">${esc(deck.name)}</button>` : '—'}</td>` : ''}
          <td class="record-cell">${esc(formatRecord(`${s.wins}-${s.losses}`))}</td>
          ${standingsTab === 'points' ? `<td>${s.points}</td><td>${s.mapDiff}</td>` : ''}
        </tr>`;
      }).join('') || '<tr><td colspan="6">No matches yet.</td></tr>'}
      </tbody></table></div>`;
    panel.querySelectorAll('[data-stand]').forEach((btn) => {
      btn.onclick = () => { standingsTab = btn.getAttribute('data-stand'); paint(); };
    });
    bindDeckChips(panel);
  }

  function paintPredict(panel, t) {
    const preds = data.predictions || [];
    const counts = {};
    for (const p of preds) counts[p.championId] = (counts[p.championId] || 0) + 1;
    panel.innerHTML = `<h2>Predictions</h2>
      <form class="stack" id="pred-form">
        <div><label for="pred-voter">Your handle</label><input id="pred-voter" required minlength="2" maxlength="24"></div>
        <div><label for="pred-champ">Champion pick</label>
          <select id="pred-champ">${data.entries.map((e) => `<option value="${e.id}">${esc(e.handle)}</option>`).join('')}</select>
        </div>
        ${t.predictionCustomFields ? `<div><label for="pred-note">Note</label><input id="pred-note" maxlength="140"></div>` : ''}
        <button class="btn" type="submit">Save prediction</button>
        <p class="err" id="pred-err" hidden></p>
      </form>
      <h3>Board</h3>
      <ul>${Object.entries(counts).map(([id, n]) => {
        const e = data.entries.find((row) => String(row.id) === String(id));
        return `<li>${namedHandleHtml(e?.handle || id)} — ${n}</li>`;
      }).join('') || '<li class="muted">No picks yet.</li>'}</ul>`;
    document.getElementById('pred-form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        data = await api.post(`/arenas/${encodeURIComponent(slug)}/predict`, {
          voter: document.getElementById('pred-voter').value,
          championId: Number(document.getElementById('pred-champ').value),
          note: document.getElementById('pred-note')?.value,
        });
        paint();
      } catch (err) {
        const el = document.getElementById('pred-err');
        el.hidden = false;
        el.textContent = err.message;
      }
    };
  }

  const bindSwapControls = (root) => {
    const aEl = root.querySelector('#swap-a');
    const bEl = root.querySelector('#swap-b');
    const pairRoundEl = root.querySelector('#pair-round');
    const pairAEl = root.querySelector('#pair-a');
    const pairBEl = root.querySelector('#pair-b');
    const pairBtn = root.querySelector('#pair-btn');
    const pickEl = root.querySelector('#swap-pick');
    const btn = root.querySelector('#swap-btn');
    const placeEl = root.querySelector('#place-entry');
    const placeBtn = root.querySelector('#place-btn');
    const errEl = root.querySelector('#swap-err');
    const playerName = (id) => {
      const entry = entryOf(data.entries, id);
      return entry ? entry.handle : 'that player';
    };
    const runPair = (idA, idB, matchId) => {
      const a = Number(idA);
      const b = Number(idB);
      if (!a || !b || a === b) {
        const msg = 'Pick two different players.';
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = msg;
        }
        window.alert(msg);
        return;
      }
      if (pairRoundEl) pairRound = pairRoundEl.value;
      const roundRef = parseRoundKey(pairRound);
      if (!window.confirm(`${playerName(a)} will play ${playerName(b)}.`)) {
        pairA = '';
        pairB = '';
        paint();
        return;
      }
      hostAction(errEl, async () => {
        try {
          const next = await api.post(`/arenas/${encodeURIComponent(slug)}/they-play`, {
            hostPassword,
            entryIdA: a,
            entryIdB: b,
            matchId: Number(matchId) || undefined,
            side: roundRef && roundRef.side,
            round: roundRef && roundRef.round,
          });
          pairA = '';
          pairB = '';
          return next;
        } catch (err) {
          window.alert(err.message);
          throw err;
        }
      });
    };
    const seatName = (key) => {
      const seat = parseSeatKey(key);
      if (!seat) return 'that seat';
      const match = (data.matches || []).find((m) => m.id === seat.matchId);
      if (!match) return 'that seat';
      const entry = entryOf(data.entries, seat.slot === 2 ? match.entry2Id : match.entry1Id);
      return entry ? entry.handle : 'empty seat';
    };
    const runSwap = (aKey, bKey) => {
      const a = parseSeatKey(aKey);
      const b = parseSeatKey(bKey);
      if (!a || !b || (a.matchId === b.matchId && a.slot === b.slot)) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = 'Pick two different seats.';
        }
        return;
      }
      if (!window.confirm(`Swap ${seatName(aKey)} and ${seatName(bKey)}?`)) return;
      hostAction(errEl, async () => {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/swap-slots`, {
          hostPassword,
          matchIdA: a.matchId,
          slotA: a.slot,
          matchIdB: b.matchId,
          slotB: b.slot,
        });
        swapA = '';
        swapB = '';
        return next;
      });
    };
    if (aEl) aEl.onchange = () => { swapA = aEl.value; };
    if (bEl) bEl.onchange = () => { swapB = bEl.value; };
    if (pairAEl) pairAEl.onchange = () => { pairA = pairAEl.value; };
    if (pairBEl) pairBEl.onchange = () => { pairB = pairBEl.value; };
    if (pairRoundEl) pairRoundEl.onchange = () => { pairRound = pairRoundEl.value; };
    if (placeEl) placeEl.onchange = () => { placeEntry = placeEl.value; };
    if (pairBtn) pairBtn.onclick = () => runPair(pairAEl && pairAEl.value, pairBEl && pairBEl.value);
    if (pickEl) {
      pickEl.onchange = () => {
        swapPick = pickEl.checked;
        paint();
      };
    }
    if (btn) btn.onclick = () => runSwap(aEl && aEl.value, bEl && bEl.value);
    if (placeBtn) {
      placeBtn.onclick = () => {
        const a = parseSeatKey(aEl && aEl.value);
        const entryId = Number(placeEl && placeEl.value);
        if (!a || !entryId) {
          if (errEl) {
            errEl.hidden = false;
            errEl.textContent = 'Pick a seat and a player.';
          }
          return;
        }
        const who = fieldEntries(data.entries).find((e) => e.id === entryId);
        if (!window.confirm(`Put ${who ? who.handle : 'that player'} in ${seatName(aEl.value)}?`)) return;
        hostAction(errEl, async () => {
          const next = await api.post(`/arenas/${encodeURIComponent(slug)}/place-entry`, {
            hostPassword,
            entryId,
            matchId: a.matchId,
            slot: a.slot,
          });
          placeEntry = '';
          return next;
        });
      };
    }
    root.querySelectorAll('[data-place-match]').forEach((sel) => {
      sel.onclick = (event) => event.stopPropagation();
      sel.onchange = () => {
        const matchId = Number(sel.getAttribute('data-place-match'));
        const slot = Number(sel.getAttribute('data-place-slot'));
        const entryId = Number(sel.value) || 0;
        const match = (data.matches || []).find((m) => m.id === matchId);
        const occupantId = match ? (slot === 2 ? match.entry2Id : match.entry1Id) : null;
        const otherId = match ? (slot === 2 ? match.entry1Id : match.entry2Id) : null;
        const who = entryId ? fieldEntries(data.entries).find((e) => e.id === entryId) : null;
        const label = who ? who.handle : 'TBD';
        if (!entryId) {
          if (!window.confirm('Clear this seat?')) {
            paint();
            return;
          }
          hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/place-entry`, {
            hostPassword,
            matchId,
            slot,
            entryId: null,
          }));
          return;
        }
        if (occupantId && Number(occupantId) === entryId) return;
        if (otherId && Number(otherId) === entryId) {
          paint();
          return;
        }
        if (occupantId) {
          runPair(occupantId, entryId, matchId);
          return;
        }
        if (!window.confirm(`Put ${label} in this empty seat?`)) {
          paint();
          return;
        }
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/place-entry`, {
          hostPassword,
          matchId,
          slot,
          entryId,
        }));
      };
    });
    root.querySelectorAll('[data-pair-entry]').forEach((el) => {
      el.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = String(el.getAttribute('data-pair-entry') || '');
        if (!id) return;
        if (pairA === id) {
          pairA = '';
          paint();
          return;
        }
        if (!pairA) {
          pairA = id;
          paint();
          return;
        }
        if (pairA && id !== pairA) {
          pairB = id;
          paint();
          runPair(pairA, id);
        }
      };
    });
    root.querySelectorAll('[data-swap-seat]').forEach((el) => {
      el.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = String(el.getAttribute('data-swap-seat') || '');
        if (!key) return;
        if (swapA === key) {
          swapA = '';
          paint();
          return;
        }
        if (!swapA) {
          swapA = key;
          paint();
          return;
        }
        if (swapA && key !== swapA) {
          swapB = key;
          paint();
          runSwap(swapA, key);
        }
      };
    });
    root.querySelectorAll('[data-reset-match]').forEach((el) => {
      el.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const matchId = Number(el.getAttribute('data-reset-match'));
        if (!matchId) return;
        if (!window.confirm('Unlock this series? Later matches that already used this result will unlock too.')) return;
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/reset-match`, {
          hostPassword,
          matchId,
        }));
      };
    });
  };

  /** Registration-stage bracket tab: a waiting notice for visitors, one lock card for the host. */
  function paintPreLock(panel, t) {
    const confirmed = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow);
    const pending = data.entries.filter((e) => !e.paid && !e.whitelist);
    if (!hostMode) {
      panel.innerHTML = `<div class="notice">
        <p><strong>Registration is open</strong></p>
        <p class="muted">${confirmed.length} ${confirmed.length === 1 ? 'player is' : 'players are'} in so far. ${esc(t.hostName || 'The host')} locks the bracket once the field is set, and matches appear here.</p>
        <div class="row wrap">
          ${openForSignup() ? '<button class="btn" type="button" data-go="enter">Register</button>' : ''}
          <button class="btn ghost" type="button" data-go="players">See who is playing</button>
        </div>
      </div>`;
      panel.querySelectorAll('[data-go]').forEach((btn) => {
        btn.onclick = () => goTab(btn.getAttribute('data-go'));
      });
      return;
    }
    const ready = confirmed.length >= 2;
    const lockT = { ...t, bestOf, finalsBestOf, breakTies };
    const showBronze = canHaveThirdPlace(t);
    const showFinals = hasFinalsSeries(t);
    panel.innerHTML = `<div class="host-panel">
      <div class="host-flag">Host only</div>
      <p><strong>Lock the bracket</strong></p>
      <p class="muted">${ready
        ? `${confirmed.length} confirmed ${confirmed.length === 1 ? 'player' : 'players'} will be seeded into a ${esc(formatBlurb(lockT))}. Locking closes registration.${esc(byeNote(t, confirmed.length))}${showBronze && confirmed.length < 4 ? ' A 3rd place match needs 4 players, so it is skipped for this field.' : ''}`
        : `You need at least 2 confirmed players. ${confirmed.length} so far.`}</p>
      ${classQuotaOf(t) ? `<p class="muted">Locked lists must be at least ${esc(classQuotaLabel(classQuotaOf(t)))}. Players without a matching Play deck cannot be seeded.</p>` : ''}
      ${pending.length ? `<p class="muted">${pending.length} ${pending.length === 1 ? 'entry has' : 'entries have'} not paid and will be left out — <button type="button" class="linkish" data-go="players">confirm payments</button> first if that is wrong.</p>` : ''}
      ${confirmed.length ? `<p class="chips">${confirmed.map((e) => `<span class="chip named-handle">${esc(e.handle)}${classLabelHtml(e.ddlClass)}${deckChipHtml(e)}${medalsInlineHtml(badgesFor(e.handle, e.badges))}</span>`).join('')}</p>` : ''}
      ${t.rewardMode !== 'prize' ? `<div>
        <span class="lbl">Prize pool</span>
        <div class="seg" id="lock-potfund-seg">
          <button type="button" data-lock-potfund="usd" class="${potFundModeOf(t) !== 'percent' ? 'on' : ''}">$</button>
          <button type="button" data-lock-potfund="percent" class="${potFundModeOf(t) === 'percent' ? 'on' : ''}">%</button>
        </div>
        <input type="hidden" id="lock-potfund" value="${esc(potFundModeOf(t))}">
        <div id="lock-pot-usd" style="${potFundModeOf(t) === 'percent' ? 'display:none' : ''}">
          <label for="lock-pot">Amount (USD)</label>
          <input id="lock-pot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(Number(t.hostPotUsd) || 0)}" ${tip('This dollar amount is the pot players share. Entry fees are not added on top.')}>
          <p class="hint">Shows as Pot. Not total raised — only this redistributed amount.</p>
        </div>
        <div id="lock-pot-pct" style="${potFundModeOf(t) === 'percent' ? '' : 'display:none'}">
          <p class="hint">${PRIZE_POOL_PERCENT}% of paid entry fees is redistributed. The house retains ${HOUSE_RETAIN_PERCENT}%. Public Pot is that share, not total raised.</p>
          <label for="lock-addedpot">Added to pot (USD)</label>
          <input id="lock-addedpot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(Number(t.addedPotUsd) || 0)}" ${tip('Extra cash is added to the 65% pot, then split by the place percents from Host tools.')}>
          <p class="hint">Joins the 65% pool. Per-place +$ and added prizes are in Host tools → Tournament options.</p>
        </div>
        <div class="host-money">
          <button type="button" class="btn ghost" id="save-pot">Save pool</button>
        </div>
      </div>` : ''}
      <label class="check"><input type="checkbox" id="shuffle" ${shuffle ? 'checked' : ''}> Random draw (ignore records / titles)</label>
      <p class="hint">Default seeds by official titles, then any host seed pins. ${esc(byeNote(t, confirmed.length) || `${confirmed.length} paid players make a ${nextPowerOfTwo(Math.max(2, confirmed.length))}-slot tree.`)}</p>
      ${t.eventKind === 'duel' ? '' : `<details class="advanced" ${t.reigningChamp ? 'open' : ''}>
        <summary>Reigning Champ mode</summary>
        <p class="muted">Hold one player out of the draw. The rest fight it out, and the winner of that bracket plays the champ for the belt.</p>
        <label class="check"><input type="checkbox" id="lock-champ-on" ${t.reigningChamp ? 'checked' : ''}> The champ defends the belt</label>
        <div id="lock-champ-pick" style="max-width:20rem;${t.reigningChamp ? '' : 'display:none'}">
          ${champOptions(confirmed, t)}
        </div>
      </details>`}
      ${showBronze ? `<label class="check"><input type="checkbox" id="lock-break" ${breakTies ? 'checked' : ''}> 3rd place match — semi-final losers play for bronze</label>` : ''}
      <div style="max-width:16rem"><label for="lock-bestof">Default series</label>${bestOfSelect('lock-bestof', bestOf)}</div>
      ${showFinals ? `<div style="max-width:16rem"><label for="lock-finalsbestof">Finals series</label>${finalsBestOfSelect('lock-finalsbestof', finalsBestOf)}
        <p class="hint">Championship only. Set Best of 1 above and Best of 3 here for a BO1 bracket with a BO3 final.</p>
      </div>` : ''}
      <details class="advanced">
        <summary>Different series length per round</summary>
        ${roundRulesHtml(t.format, Math.max(2, confirmed.length), t.swissRounds, bestOf, roundBestOf, wantsLosers(t), showBronze && breakTies, finalsBestOf)}
      </details>
      <div class="row wrap">
        <button class="btn" type="button" id="lock-btn" ${ready ? '' : 'disabled'}>Lock bracket &amp; start</button>
        <button class="btn ghost" type="button" data-go="players">Players &amp; payments</button>
      </div>
      <p class="err" id="lock-err" hidden></p>
    </div>`;
    panel.querySelectorAll('[data-go]').forEach((btn) => {
      btn.onclick = () => goTab(btn.getAttribute('data-go'));
    });
    const errEl = panel.querySelector('#lock-err');
    const readLocal = () => {
      shuffle = panel.querySelector('#shuffle').checked;
      bestOf = Number(panel.querySelector('#lock-bestof').value);
      const finalsEl = panel.querySelector('#lock-finalsbestof');
      finalsBestOf = finalsEl && finalsEl.value !== '' ? Number(finalsEl.value) : null;
      const breakEl = panel.querySelector('#lock-break');
      if (breakEl) breakTies = breakEl.checked;
      roundBestOf = readRoundBestOf(panel);
    };
    panel.querySelector('#lock-bestof').onchange = () => {
      readLocal();
      paint();
    };
    const finalsEl = panel.querySelector('#lock-finalsbestof');
    if (finalsEl) finalsEl.onchange = () => { readLocal(); paint(); };
    const breakEl = panel.querySelector('#lock-break');
    if (breakEl) breakEl.onchange = () => { readLocal(); paint(); };
    panel.querySelector('#shuffle').onchange = readLocal;
    panel.querySelectorAll('[data-round-bestof]').forEach((el) => { el.onchange = readLocal; });
    const champOn = panel.querySelector('#lock-champ-on');
    if (champOn) champOn.onchange = () => {
      const box = panel.querySelector('#lock-champ-pick');
      if (box) box.style.display = champOn.checked ? '' : 'none';
    };
    const lockPotFund = panel.querySelector('#lock-potfund');
    const setLockPotFund = (mode) => {
      const fund = mode === 'percent' ? 'percent' : 'usd';
      if (lockPotFund) lockPotFund.value = fund;
      panel.querySelectorAll('[data-lock-potfund]').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-lock-potfund') === fund);
      });
      const usdBox = panel.querySelector('#lock-pot-usd');
      const pctBox = panel.querySelector('#lock-pot-pct');
      if (usdBox) usdBox.style.display = fund === 'usd' ? '' : 'none';
      if (pctBox) pctBox.style.display = fund === 'percent' ? '' : 'none';
    };
    panel.querySelectorAll('[data-lock-potfund]').forEach((btn) => {
      btn.onclick = () => setLockPotFund(btn.getAttribute('data-lock-potfund'));
    });
    const lockPotPayload = () => {
      const fund = panel.querySelector('#lock-potfund')?.value === 'percent' ? 'percent' : 'usd';
      const payload = {
        potFundMode: fund,
        hostPotUsd: Number(panel.querySelector('#lock-pot')?.value ?? t.hostPotUsd ?? 0),
      };
      if (fund === 'percent') {
        payload.addedPotUsd = Number(panel.querySelector('#lock-addedpot')?.value ?? t.addedPotUsd ?? 0);
      }
      return payload;
    };
    const savePot = panel.querySelector('#save-pot');
    if (savePot) {
      savePot.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/settings`, {
        hostPassword,
        ...lockPotPayload(),
      }));
    }
    panel.querySelector('#lock-btn').onclick = () => {
      readLocal();
      const wantsChamp = Boolean(champOn && champOn.checked);
      const champId = Number((panel.querySelector('#champ-pick') || {}).value || 0);
      if (wantsChamp && !champId) {
        errEl.hidden = false;
        errEl.textContent = 'Pick which confirmed player holds the belt, or turn Reigning Champ off.';
        return;
      }
      hostAction(errEl, async () => {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/generate`, {
          hostPassword,
          shuffle,
          seedBy: shuffle ? 'random' : 'records',
          confirmSelected: false,
          checkInSelected: true,
          entryIds: data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow).map((e) => e.id),
          bestOf,
          finalsBestOf,
          roundBestOf,
          ...(champOn ? { reigningChamp: wantsChamp, reigningChampEntryId: wantsChamp ? champId : null } : {}),
          ...(panel.querySelector('#lock-break') ? { breakTies } : {}),
          ...lockPotPayload(),
        });
        tab = 'bracket';
        return next;
      });
    };
    bindDeckChips(panel);
  }

  function paintBracket(panel, t) {
    if (t.status === 'registration') {
      paintPreLock(panel, t);
      return;
    }
    const kick = kickLinkOf(t.streamUrl);
    const finished = t.status === 'completed';
    const canShuffle = hostMode && t.status === 'in_progress' && !bracketHasPlay(data.matches);
    const field = fieldEntries(data.entries);
    const seats = editableSeats(t, data.matches, data.entries);
    const canEdit = hostMode && t.status !== 'registration';
    const rounds = hostRoundOptions(t, data.matches);
    if (!pairRound || !rounds.some((r) => r.key === pairRound)) pairRound = defaultPairRoundKey(rounds);
    const swapOpts = {
      asHost: hostMode,
      hostEdit: canEdit,
      swapPick: Boolean(swapPick) && canEdit,
      swapSelected: [swapA, swapB].filter(Boolean),
      pairSelected: [pairA, pairB].filter(Boolean),
      playerMatchIds: playerMatchIds(),
    };
    panel.innerHTML = `${hostMode ? `<div class="host-panel">
        <div class="host-flag">Host only</div>
        <p><strong>Shuffle bracket</strong></p>
        <p class="muted">${t.status !== 'in_progress'
          ? 'This arena is finished.'
          : canShuffle
            ? 'Redraws every matchup from a random seed order. This is blocked once any series has been reported.'
            : 'Shuffle is locked because a series has already been reported.'}</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="reshuffle-btn" ${canShuffle ? '' : 'disabled'}>Random shuffle</button>
          <button class="btn ghost" type="button" id="reseed-btn" ${canShuffle ? '' : 'disabled'}>Re-seed by records</button>
        </div>
        <p class="err" id="reshuffle-err" hidden></p>
        <p><strong>They play each other</strong></p>
        ${swapFormHtml(seats, field, canEdit, {
          rounds,
          pairRound,
          pairA,
          pairB,
          reason: swapBlockedReason(t, seats),
        })}
      </div>
      <div class="host-panel kick-host">
        <div class="host-flag">Host only</div>
        <p><strong>${finished ? 'Kick replay' : 'Kick livestream'}</strong></p>
        <p class="muted">${finished
          ? (kick.href
            ? `This ${kick.kind === 'live' ? 'channel' : 'replay'} is saved on this bracket. Paste the Kick VOD or clip of the stream you played if you want this page to open that recording.`
            : 'Paste the Kick VOD or clip of the stream you played. It stays on this bracket so anyone can watch it later.')
          : (kick.href
            ? `Viewers see ${esc(kick.label)} on this bracket. They can watch here with audio or open Kick. Anyone signed in with Discord can chat on this page while they watch.`
            : 'Paste a Kick channel or livestream link. While this arena is live, the bracket shows an embedded player with audio, plus buttons to open Kick and chat here.')}</p>
        <form class="row wrap" id="kick-form" style="gap:8px">
          <input id="kick-url" value="${esc(t.streamUrl || '')}" placeholder="${finished ? 'https://kick.com/yourchannel/videos/...' : 'https://kick.com/yourchannel'}" maxlength="240" aria-label="${finished ? 'Kick replay URL' : 'Kick stream URL'}">
          <button class="btn" type="submit">${finished ? 'Save replay' : (kick.href ? 'Update stream' : 'Show stream')}</button>
          ${kick.href ? `<button class="btn ghost" type="button" id="kick-clear">${finished ? 'Remove replay' : 'Remove'}</button>` : ''}
        </form>
        <p class="err" id="kick-err" hidden></p>
      </div>` : ''}
      <div class="row wrap bracket-toolbar">
          <button class="btn ghost" type="button" id="export-rounds" ${tip('Copy a share card for X. Quarter Finalists, Semi-Finalists, Finalists, and battling the reigning champ if that mode is on.')}>Export round results</button>
          <button class="btn ghost" type="button" id="export-pairings" ${tip('Share who plays who for one round — pick Semi Finals, Swiss Round 2, and so on.')}>Export who plays who</button>
        <button class="btn ghost" type="button" data-bracket-fs aria-pressed="false" ${tip('Fill the screen for an IRL display. Esc exits.')}>Full screen</button>
      </div>
      ${wrapBracketDisplay(bracketHtml(data, swapOpts), t)}`;
    const kickForm = panel.querySelector('#kick-form');
    if (kickForm) {
      const kickErr = panel.querySelector('#kick-err');
      kickForm.onsubmit = (event) => {
        event.preventDefault();
        hostAction(kickErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/settings`, {
          hostPassword,
          streamUrl: panel.querySelector('#kick-url').value,
        }));
      };
      const clearBtn = panel.querySelector('#kick-clear');
      if (clearBtn) {
        clearBtn.onclick = () => hostAction(kickErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/settings`, {
          hostPassword,
          streamUrl: '',
        }));
      }
    }
    const exportBtn = panel.querySelector('#export-rounds');
    if (exportBtn) exportBtn.onclick = () => openExportSheet(data, slug);
    const pairingsBtn = panel.querySelector('#export-pairings');
    if (pairingsBtn) pairingsBtn.onclick = () => openPairingsExportSheet(data, slug);
    const reshuffleBtn = panel.querySelector('#reshuffle-btn');
    if (reshuffleBtn) {
      const reshuffleErr = panel.querySelector('#reshuffle-err');
      reshuffleBtn.onclick = () => {
        if (!window.confirm('Shuffle redraws every matchup from a random seed order. You can only do this before any series is reported. Continue?')) return;
        hostAction(reshuffleErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/reshuffle`, { hostPassword, seedBy: 'random' }));
      };
    }
    const reseedBtn = panel.querySelector('#reseed-btn');
    if (reseedBtn) {
      reseedBtn.onclick = () => {
        if (!window.confirm('Re-seed by official titles, then host pins? This redraws the tree. Only before any series is reported.')) return;
        hostAction(panel.querySelector('#reshuffle-err'), () => api.post(`/arenas/${encodeURIComponent(slug)}/reshuffle`, { hostPassword, seedBy: 'records', shuffle: false }));
      };
    }
    bindSwapControls(panel);
    bindBracketViewport(panel);
    bindBracketFs(panel);
    panel.querySelectorAll('[data-match]').forEach((btn) => {
      btn.onclick = () => {
        const match = data.matches.find((m) => String(m.id) === btn.getAttribute('data-match'));
        const mine = myArenaEntry();
        const seated = Boolean(mine && match && (Number(match.entry1Id) === Number(mine.id) || Number(match.entry2Id) === Number(mine.id)));
        if (!match || !(hostMode || seated)) return;
        if (match.status !== 'ready' && !(hostMode && match.status === 'complete')) return;
        openScorecard(data, slug, match, (next) => {
          applyBracketLayoutFixes(next);
          data = next;
          paint();
        }, { asHost: hostMode, entry: mine });
      };
    });
    bindDeckChips(panel);
  }

  function paintWhitelist(panel, t) {
    const spots = Number(t.whitelistSpots) || 0;
    const list = data.entries.filter((e) => e.whitelist);
    const unused = list.filter((e) => !e.subbedIn && !e.noShow);
    const live = t.status === 'in_progress';
    const opening = (data.matches || []).filter((m) => isOpeningMatch(t, m) && m.status !== 'complete');
    const slotOptions = opening.flatMap((m) => {
      const p1 = entryOf(data.entries, m.entry1Id);
      const p2 = entryOf(data.entries, m.entry2Id);
      const rows = [];
      if (m.status === 'bye') {
        const who = p1 || p2;
        rows.push({ value: `${m.id}:${p1 ? 2 : 1}`, label: `Play ${who ? who.handle : 'BYE'} (fill empty slot)` });
        return rows;
      }
      if (!p1) rows.push({ value: `${m.id}:1`, label: `${p2 ? `${p2.handle} vs TBD` : 'Empty match'} — fill empty slot` });
      else rows.push({ value: `${m.id}:1`, label: `${p1.handle} vs ${p2?.handle || 'TBD'} — replace ${p1.handle}` });
      if (!p2) rows.push({ value: `${m.id}:2`, label: `${p1 ? `${p1.handle} vs TBD` : 'Empty match'} — fill empty slot` });
      else rows.push({ value: `${m.id}:2`, label: `${p1?.handle || 'TBD'} vs ${p2.handle} — replace ${p2.handle}` });
      return rows;
    });
    panel.innerHTML = `
      <h2>Whitelist</h2>
      <p class="muted">${spots
        ? `${list.length} of ${spots} substitute spot${spots === 1 ? '' : 's'} filled. These names stay off the bracket until you drop one into a first-round no-show or an empty slot.`
        : 'Set how many substitute spots this arena holds, then add names.'}</p>
      ${hostMode ? `<div class="host-panel">
        <div class="host-flag">Host only</div>
        <p><strong>Whitelist spots</strong></p>
        <form class="row wrap" id="wl-spots-form" style="gap:8px">
          <input id="wl-spots" type="number" min="0" max="16" value="${spots}" style="max-width:8rem" aria-label="Whitelist spots">
          <button class="btn ghost" type="submit">Save spots</button>
        </form>
        <p class="err" id="wl-spots-err" hidden></p>
      </div>` : ''}
      <div class="roster">${list.map((e) => {
        const state = e.subbedIn ? 'In round 1' : e.noShow ? 'Sat out' : 'On deck';
        return `<div class="roster-row">
          <div class="who">${entryAvatarHtml(e)}${namedHandleHtml(e.handle, e.badges)}${classLabelHtml(e.ddlClass)}${deckChipHtml(e)}${badge(e.subbedIn ? 'confirmed' : e.noShow ? 'no_show' : 'pending')}</div>
          <span class="muted">${esc(state)}</span>
          ${hostMode && !e.subbedIn && !e.noShow ? `<div class="roster-acts">
            <button type="button" class="mini bad" data-wl-remove="${e.id}">Remove</button>
          </div>` : ''}
        </div>`;
      }).join('') || '<p class="muted">No whitelist players yet.</p>'}</div>
      ${hostMode && list.length < spots ? `<div class="host-panel" style="margin-top:16px">
        <div class="host-flag">Host only</div>
        <p><strong>Add a substitute</strong></p>
        <p class="muted">${live ? 'They sit on deck until you put them in a first-round no-show or empty slot.' : 'They will not be seeded when you lock the bracket.'}</p>
        <form class="row wrap" id="wl-add-form" style="gap:8px">
          <div class="handle-typeahead">
            <input id="wl-handle" placeholder="Start typing a handle" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="wl-handle-list" aria-expanded="false">
            <ul id="wl-handle-list" class="handle-suggest" hidden role="listbox"></ul>
          </div>
          <button class="btn ghost" type="submit">Add to whitelist</button>
        </form>
        <p class="err" id="wl-add-err" hidden></p>
      </div>` : ''}
      ${hostMode && live ? `<div class="host-panel" style="margin-top:16px">
        <div class="host-flag">Host only</div>
        <p><strong>Put a substitute in round 1</strong></p>
        <p class="muted">Pick an empty slot or a no-show, then the substitute. Filling a bye makes that player play for their spot. The series resets if any games were already entered.</p>
        ${slotOptions.length && (unused.length || list.length < spots) ? `<form class="stack" id="wl-sub-form">
          <div><label for="wl-slot">Slot</label>
            <select id="wl-slot">${slotOptions.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>
          </div>
          ${unused.length ? `<div><label for="wl-entry">With whitelist player</label>
            <select id="wl-entry">${unused.map((e) => `<option value="${e.id}">${esc(e.handle)}</option>`).join('')}</select>
          </div>` : `<div><label for="wl-new">With handle</label>
            <input id="wl-new" required minlength="2" maxlength="24" placeholder="Substitute handle">
          </div>`}
          <p class="err" id="wl-sub-err" hidden></p>
          <button class="btn" type="submit">Put them in round 1</button>
        </form>` : `<p class="muted">${!slotOptions.length ? 'No open first-round slots left to fill.' : list.length >= spots && !unused.length ? 'Every whitelist spot is already used.' : 'Add a whitelist player first.'}</p>`}
      </div>` : ''}
      <p class="err" id="wl-err" hidden></p>`;

    const errEl = panel.querySelector('#wl-err');
    const spotsForm = panel.querySelector('#wl-spots-form');
    if (spotsForm) spotsForm.onsubmit = (event) => {
      event.preventDefault();
      const spotsErr = panel.querySelector('#wl-spots-err');
      hostAction(spotsErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/settings`, {
        hostPassword,
        whitelistSpots: Number(panel.querySelector('#wl-spots').value || 0),
      }));
    };
    const addForm = panel.querySelector('#wl-add-form');
    if (addForm) {
      bindHandleTypeahead(
        panel.querySelector('#wl-handle'),
        panel.querySelector('#wl-handle-list'),
        data.entries.map((e) => e.handle),
      );
      addForm.onsubmit = (event) => {
        event.preventDefault();
        const addErr = panel.querySelector('#wl-add-err');
        const handleInput = panel.querySelector('#wl-handle');
        hostAction(addErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/add-entry`, {
          hostPassword,
          handle: handleInput.value,
          userId: pickedUserId(handleInput),
          whitelist: true,
        }));
      };
    }
    panel.querySelectorAll('[data-wl-remove]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this whitelist player?')) return;
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/remove-entry`, {
          hostPassword,
          entryId: Number(btn.getAttribute('data-wl-remove')),
        }));
      };
    });
    const subForm = panel.querySelector('#wl-sub-form');
    if (subForm) subForm.onsubmit = (event) => {
      event.preventDefault();
      const subErr = panel.querySelector('#wl-sub-err');
      const [matchId, slot] = String(panel.querySelector('#wl-slot').value || '').split(':');
      const entrySel = panel.querySelector('#wl-entry');
      const handleInput = panel.querySelector('#wl-new');
      hostAction(subErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/sub-round1`, {
        hostPassword,
        matchId: Number(matchId),
        slot: Number(slot),
        entryId: entrySel ? Number(entrySel.value) : undefined,
        handle: handleInput ? handleInput.value : undefined,
      }));
    };
    bindDeckChips(panel);
  }

  function paintHostTools(panel, t) {
    const live = t.status !== 'registration';
    const field = fieldEntries(data.entries);
    const seats = editableSeats(t, data.matches, data.entries);
    const canEdit = t.status !== 'registration';
    const rounds = hostRoundOptions(t, data.matches);
    if (!pairRound || !rounds.some((r) => r.key === pairRound)) pairRound = defaultPairRoundKey(rounds);
    const unpaidOps = data.entries.filter((e) => !e.paid && !e.whitelist && !e.noShow);
    const noListOps = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow && !hasLockedList(e));
    const notInOps = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow && t.requireCheckIn && !e.checkedIn);
    const inMatchOps = (data.matches || []).filter((m) => m.status === 'ready' && m.entry1Id && m.entry2Id);
    const busyIds = new Set(inMatchOps.flatMap((m) => [m.entry1Id, m.entry2Id]));
    const idleOps = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow && t.status === 'in_progress' && !busyIds.has(e.id));
    const disputeOps = (data.matches || []).filter((m) => m.reportProposal);
    panel.innerHTML = `<div class="host-steps">
      <article>
        <div class="host-flag">Host only</div>
        <h3>${isAdminMode() ? 'Signed in as admin' : 'You host this arena'}</h3>
        <p class="muted">${isAdminMode()
          ? 'Admin can confirm payments, lock the bracket, and report scores on every arena. Discord hosts can only do that on arenas they created.'
          : 'Confirm payments on the Players tab, lock the bracket from the Bracket tab, and report scores by tapping a match. You can only change tournaments you created.'}</p>
        <div class="row wrap">
          ${isAdminMode() ? '<button class="btn ghost" type="button" id="signout-btn">Leave admin view</button>' : ''}
        </div>
      </article>
      <article>
        <h3>Command center</h3>
        <p class="muted">Owner and judges. Ledger stays admin-only.</p>
        <div class="ops-desk">
          ${[
            ['Unpaid', unpaidOps.length],
            ['No list', noListOps.length],
            ['Not checked in', notInOps.length],
            ['In match', inMatchOps.length],
            ['Idle', idleOps.length],
            ['Dispute', disputeOps.length],
          ].map(([label, n]) => `<span class="chip ${n ? 'on' : ''}">${esc(label)} · ${n}</span>`).join('')}
        </div>
        ${noListOps.length ? `<p class="muted">No list: ${noListOps.map((e) => esc(e.handle)).join(', ')}</p>` : ''}
        ${unpaidOps.length ? `<p class="muted">Unpaid: ${unpaidOps.map((e) => esc(e.handle)).join(', ')}</p>` : ''}
        ${inMatchOps.length ? `<p class="muted">Feature / table: ${inMatchOps.map((m) => {
          const a = entryOf(data.entries, m.entry1Id);
          const b = entryOf(data.entries, m.entry2Id);
          return `<a href="${esc(tableHref(slug, m.id))}">${esc((a && a.handle) || 'TBD')} vs ${esc((b && b.handle) || 'TBD')}</a>`;
        }).join(' · ')}</p>` : ''}
        ${t.requireCheckIn ? `<div class="row wrap" style="margin-top:8px">
          <button class="btn ghost" type="button" id="noshow-dq">DQ no-shows</button>
        </div>` : ''}
      </article>
      ${!live ? `<article>
        <h3>Grand tournament</h3>
        <p class="muted">Pull official past champions into this roster. Handles that already have a Discord account are linked automatically.</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="add-champs-btn">Add past champions</button>
        </div>
        <p class="err" id="champs-err" hidden></p>
        <p class="ok" id="champs-ok" hidden></p>
      </article>` : ''}
      ${(data.claims || []).filter((c) => c.status === 'pending').length ? `<article>
        <h3>Handle claims</h3>
        <p class="muted">Players asked to attach a walk-in result to their Discord account.</p>
        ${(data.claims || []).filter((c) => c.status === 'pending').map((c) => `
          <div class="roster-row">
            <div class="who"><strong>${esc(c.tourneyHandle || c.resultHandle)}</strong><span class="muted">claims ${esc(c.resultHandle)} (entry ${c.entryId})</span></div>
            <div class="roster-acts">
              <button type="button" class="mini go" data-claim="${c.id}" data-approve="1">Approve</button>
              <button type="button" class="mini bad" data-claim="${c.id}" data-approve="0">Reject</button>
            </div>
          </div>`).join('')}
        <p class="err" id="claim-err" hidden></p>
      </article>` : ''}
      ${live ? `<article>
        <h3>Shuffle bracket</h3>
        <p class="muted">${t.status === 'in_progress' && !bracketHasPlay(data.matches)
          ? 'Redraws every matchup from a random seed order. Blocked once a series has been reported.'
          : 'Shuffle is locked because a series has already been reported, or this arena is finished.'}</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="reshuffle-btn" ${t.status === 'in_progress' && !bracketHasPlay(data.matches) ? '' : 'disabled'}>Shuffle bracket</button>
        </div>
        <p class="err" id="reshuffle-err" hidden></p>
      </article>
      <article>
        <h3>They play each other</h3>
        ${swapFormHtml(seats, field, canEdit, {
          rounds,
          pairRound,
          pairA,
          pairB,
          reason: swapBlockedReason(t, seats),
        })}
      </article>` : ''}
      ${t.eventKind === 'duel' ? '' : `<article>
        <h3>Reigning Champ</h3>
        <p class="muted">The champ sits out the bracket and defends the belt against whoever wins the field. If the field empties out, the champ keeps the belt by walkover.</p>
        ${champOptions(field, t)}
        <div class="row wrap">
          <button class="btn" type="button" id="champ-set">${t.reigningChamp ? 'Change champ' : 'Set champ'}</button>
          ${t.reigningChamp ? '<button class="btn ghost" type="button" id="champ-clear">Turn off</button>' : ''}
        </div>
        <p class="err" id="champ-err" hidden></p>
      </article>`}
      ${live ? `<article>
        <h3>Fix a stuck bracket</h3>
        <p class="muted">Re-runs the tree against every reported result: collapses empty seats, pushes byes forward, and closes the arena if nothing is left to play. Use this after hand-editing seats.</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="repair-btn">Rebuild from results</button>
          <button class="btn ghost" type="button" id="repair-force">Force close</button>
        </div>
        <p class="muted small">Force close also resolves matches that can never be played — a seat with nobody in it hands the win to the other side.</p>
        <p class="err" id="repair-err" hidden></p>
      </article>` : ''}
      ${live ? `<article>
        <h3>Series length per round</h3>
        <p class="muted">Applies to matches that have not been locked yet.</p>
        ${roundRulesHtml(t.format, Math.max(2, data.entries.filter((e) => e.paid).length), t.swissRounds, t.bestOf, t.roundBestOf, wantsLosers(t), t.breakTies, t.finalsBestOf)}
        <button class="btn ghost" type="button" id="rules-btn">Save series lengths</button>
      </article>` : ''}
      <article>
        <h3>Tournament options</h3>
        <p class="muted">Changes apply to this arena immediately.</p>
        ${hostSavedMsg ? `<p class="ok">${esc(hostSavedMsg)}</p>` : ''}
        <form id="settings-form">${settingsFormHtml(t, { creating: false, hostUser: data.hostUser })}
          <p class="err" id="set-err" hidden></p>
          <div class="save-bar"><button class="btn" type="submit">Save options</button></div>
        </form>
      </article>
      ${isAdminMode() ? `<article>
        <h3>Arena host</h3>
        <p class="muted">Public Organized by stays on the Discord account that created this arena. Reassign it here if an admin created it for someone else.</p>
        <label for="assign-host-q">Discord handle</label>
        <input id="assign-host-q" autocomplete="off" placeholder="Home">
        <div class="row wrap" style="margin-top:10px">
          <button class="btn" type="button" id="assign-host-btn">Assign host</button>
        </div>
        <p class="err" id="assign-host-err" hidden></p>
        <p class="ok" id="assign-host-ok" hidden></p>
      </article>` : ''}
      <article>
        <h3>Delete this arena</h3>
        <p class="muted">Removes the arena and its roster for good. Uses the DD Evaluator admin password, not the host password.</p>
        <label for="apw">Admin password</label>
        ${secretFieldHtml('apw', adminPassword)}
        <button class="btn ghost" type="button" id="del-btn">Remove this arena</button>
        <p class="err" id="admin-err" hidden></p>
      </article>
      <p class="err" id="host-err" hidden></p>
    </div>`;
    const errEl = document.getElementById('host-err');
    const signoutBtn = document.getElementById('signout-btn');
    if (signoutBtn) {
      signoutBtn.onclick = async () => {
        clearAdminSession();
        tab = 'bracket';
        await reload();
        paint();
      };
    }
    const noshowBtn = document.getElementById('noshow-dq');
    if (noshowBtn) {
      noshowBtn.onclick = () => {
        const ids = notInOps.map((e) => e.id);
        if (!ids.length) return;
        if (!window.confirm(`Mark ${ids.length} no-show${ids.length === 1 ? '' : 's'}? They drop from the paid field.`)) return;
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/check-in`, {
          hostPassword,
          entryIds: ids,
          noShow: true,
        }));
      };
    }
    const settingsForm = document.getElementById('settings-form');
    bindSettingsChrome(settingsForm);
    settingsForm.onsubmit = (event) => {
      event.preventDefault();
      const setErr = document.getElementById('set-err');
      const payload = collectSettings(settingsForm);
      const payErr = paySettingsError(payload);
      if (payErr) {
        if (setErr) { setErr.hidden = false; setErr.textContent = payErr; }
        return;
      }
      if (settingsForm.querySelector('#s-usdc-sol-on')?.checked && !sanitizeSolanaAddressInput(payload.solanaTreasury)) {
        if (setErr) { setErr.hidden = false; setErr.textContent = 'Enter the Solana wallet that should receive USDC.'; }
        return;
      }
      hostAction(setErr, async () => {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/settings`, { ...payload, hostPassword });
        assertRewardsSaved(payload, next);
        hostSavedMsg = payload.rewardMode === 'prize'
          ? 'Prizes saved. The header now says Prizes instead of Pot.'
          : payload.potFundMode === 'percent'
            ? `Prize pool is ${PRIZE_POOL_PERCENT}% of paid entries${Number(payload.addedPotUsd) > 0 ? ` plus ${formatUsd(payload.addedPotUsd)} added` : ''}. Place +$ and prizes sit on top of that split.`
            : Number(payload.hostPotUsd) > 0
              ? 'Prize pool saved. The header shows this dollar amount — not entry fees.'
              : filledPayouts(payload).length
                ? 'Pot split saved. The header still shows the redistributed pot; Payout lists the place breakdown.'
                : 'Options saved.';
        return next;
      });
    };
    const rulesBtn = document.getElementById('rules-btn');
    if (rulesBtn) rulesBtn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/round-rules`, {
      hostPassword,
      bestOf: t.bestOf,
      finalsBestOf: t.finalsBestOf,
      roundBestOf: readRoundBestOf(panel),
    }));
    const reshuffleBtn = document.getElementById('reshuffle-btn');
    if (reshuffleBtn) {
      const reshuffleErr = document.getElementById('reshuffle-err');
      reshuffleBtn.onclick = () => {
        if (!window.confirm('Shuffle redraws every matchup from a random seed order. You can only do this before any series is reported. Continue?')) return;
        hostAction(reshuffleErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/reshuffle`, { hostPassword }));
      };
    }
    bindSwapControls(panel);
    const champSet = document.getElementById('champ-set');
    if (champSet) {
      const champErr = document.getElementById('champ-err');
      champSet.onclick = () => {
        const sel = document.getElementById('champ-pick');
        const entryId = Number(sel && sel.value);
        if (!entryId) {
          if (champErr) { champErr.hidden = false; champErr.textContent = 'Pick the champ from the confirmed roster.'; }
          return;
        }
        hostAction(champErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/reigning-champ`, {
          hostPassword,
          entryId,
        }));
      };
    }
    const champClear = document.getElementById('champ-clear');
    if (champClear) champClear.onclick = () => {
      if (!window.confirm('Turn off Reigning Champ mode? The title match is removed and the champ rejoins the field.')) return;
      hostAction(document.getElementById('champ-err'), () => api.post(`/arenas/${encodeURIComponent(slug)}/reigning-champ`, {
        hostPassword,
        clear: true,
      }));
    };
    const repairBtn = document.getElementById('repair-btn');
    if (repairBtn) repairBtn.onclick = () => hostAction(document.getElementById('repair-err'), () => (
      api.post(`/arenas/${encodeURIComponent(slug)}/repair-bracket`, { hostPassword })
    ));
    const repairForce = document.getElementById('repair-force');
    if (repairForce) repairForce.onclick = () => {
      if (!window.confirm('Force close resolves every match that cannot be played and finishes the arena. Continue?')) return;
      hostAction(document.getElementById('repair-err'), () => (
        api.post(`/arenas/${encodeURIComponent(slug)}/repair-bracket`, { hostPassword, force: true })
      ));
    };
    const assignBtn = document.getElementById('assign-host-btn');
    if (assignBtn) {
      assignBtn.onclick = () => {
        const assignErr = document.getElementById('assign-host-err');
        const handle = String((document.getElementById('assign-host-q') || {}).value || '').trim();
        if (handle.length < 2) {
          if (assignErr) { assignErr.hidden = false; assignErr.textContent = 'Enter a Discord handle.'; }
          return;
        }
        hostAction(assignErr, async () => {
          const next = await api.post(`/arenas/${encodeURIComponent(slug)}/assign-host`, { adminPassword, handle });
          hostSavedMsg = `Host is now ${handle}.`;
          return next;
        });
      };
    }
    document.getElementById('del-btn').onclick = async () => {
      const adminErr = document.getElementById('admin-err');
      adminErr.hidden = true;
      setAdminPassword(document.getElementById('apw').value);
      if (!window.confirm('Remove this arena and its roster? This cannot be undone.')) return;
      try {
        await api.post('/control/remove-arena', { adminPassword, slug });
        location.assign('/tourney/');
      } catch (err) {
        adminErr.hidden = false;
        adminErr.textContent = err.message;
      }
    };
    const champsBtn = document.getElementById('add-champs-btn');
    if (champsBtn) champsBtn.onclick = async () => {
      const errEl = document.getElementById('champs-err');
      const okEl = document.getElementById('champs-ok');
      errEl.hidden = true;
      okEl.hidden = true;
      try {
        const pack = await api.get('/records/champions');
        const champs = pack.champions || [];
        if (!champs.length) {
          errEl.hidden = false;
          errEl.textContent = 'No official champions on record yet.';
          return;
        }
        const existing = new Set(data.entries.map((e) => String(e.handle || '').toLowerCase()));
        let added = 0;
        let skipped = 0;
        for (const champ of champs) {
          const handle = String(champ.handle || '').trim();
          if (!handle || existing.has(handle.toLowerCase())) {
            skipped += 1;
            continue;
          }
          try {
            const next = await api.post(`/arenas/${encodeURIComponent(slug)}/add-entry`, { hostPassword, handle });
            data = next;
            existing.add(handle.toLowerCase());
            added += 1;
          } catch (_errAdd) {
            skipped += 1;
          }
        }
        okEl.hidden = false;
        okEl.textContent = added ? `Added ${added} champion${added === 1 ? '' : 's'}.${skipped ? ` Skipped ${skipped}.` : ''}` : 'Every past champion is already in this arena.';
        if (added) {
          await reload();
          paint();
        }
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
    panel.querySelectorAll('[data-claim]').forEach((btn) => {
      btn.onclick = () => hostAction(document.getElementById('claim-err'), () => api.post(
        `/arenas/${encodeURIComponent(slug)}/claims/${encodeURIComponent(btn.getAttribute('data-claim') || '')}/resolve`,
        { hostPassword, approve: btn.getAttribute('data-approve') === '1' },
      ));
    });
  }

  paint();
}

function eventPlacesHtml(event) {
  const duel = isDuelArena(event, event.fieldSize);
  const first = event.champion && event.champion.handle ? namedHandleHtml(event.champion.handle) : '';
  const second = event.runnerUp && event.runnerUp.handle ? namedHandleHtml(event.runnerUp.handle) : '';
  if (duel) {
    if (first && second) {
      return `<p class="result-places">${first} <span class="duel-def">def.</span> ${second}${event.champion.record ? ` · ${esc(formatRecord(event.champion.record))}` : ''}</p>`;
    }
    return first ? `<p class="result-places">Winner ${first}</p>` : '<p class="muted">No result recorded</p>';
  }
  const thirds = Array.isArray(event.third) ? event.third.filter((p) => p && p.handle) : [];
  const bits = [];
  if (first) bits.push(`<span><em>1st</em> ${first}</span>`);
  if (second) bits.push(`<span><em>2nd</em> ${second}</span>`);
  if (thirds.length) bits.push(`<span><em>3rd</em> ${thirds.map((p) => namedHandleHtml(p.handle)).join(', ')}</span>`);
  return bits.length ? `<p class="result-places">${bits.join('')}</p>` : '<p class="muted">No podium recorded</p>';
}

function resultRowHtml(event) {
  const href = arenaCardHref(event);
  const duel = isDuelArena(event, event.fieldSize);
  const tag = event.manual
    ? '<span class="badge ok">Recorded</span>'
    : (event.official ? '<span class="badge ok">Official</span>' : '<span class="badge">Scrim</span>');
  const title = href
    ? `<h3><a href="${href}">${esc(event.name)}</a></h3>`
    : `<h3>${esc(event.name)}</h3>`;
  return `<article class="result-row">
    <time datetime="${esc(event.completedAt || '')}">${esc(shortDate(event.completedAt) || '—')}</time>
    <div class="result-main">
      <div class="result-title">
        ${title}
        ${kindTagHtml(event, event.fieldSize)}
        ${tag}
      </div>
      <p class="muted">${esc(duel ? 'Duel' : (FORMAT_LABEL[event.format] || event.format || 'Record'))}${event.manual ? ' · Handwritten title' : ` · ${event.fieldSize} players`}</p>
      ${eventPlacesHtml(event)}
    </div>
  </article>`;
}

function eventCardHtml(event) {
  return resultRowHtml(event);
}

async function renderRecords() {
  setTreeMode(false);
  root.innerHTML = `<div class="records-page">
    <p class="form-kicker">Doginal Dogs</p>
    <h1>Records</h1>
    <p class="muted">Loading…</p>
  </div>`;
  try {
    const pack = await api.get('/records');
    ingestAwards(pack.awards);
    const events = pack.events || [];
    const champions = pack.champions || [];
    const duelists = pack.duelists || [];
    const mentions = pack.mentions || [];
    const ledgers = pack.ledgers || [];
    const stats = pack.stats || {};
    let tab = 'results';
    let kind = 'all';
    let format = 'all';
    let officialOnly = true;
    let query = '';

    const formats = [...new Set(events.map((e) => e.format).filter(Boolean))];

    const bindHost = () => {
      if (!isAdminMode()) return;
      const restoreBtn = root.querySelector('#restore-arenas-btn');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          const errEl = document.getElementById('restore-arenas-err');
          const okEl = document.getElementById('restore-arenas-ok');
          if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
          if (okEl) { okEl.hidden = true; okEl.textContent = ''; }
          try {
            const next = await api.post('/records/restore-arenas', { hostPassword });
            const added = Number(next && next.restored) || 0;
            const snaps = Number(next && next.snapshots) || 0;
            const upgraded = Number(next && next.upgraded) || 0;
            const sealed = Number(next && next.sealed) || 0;
            if (okEl) {
              okEl.hidden = false;
              okEl.textContent = added || snaps || upgraded || sealed
                ? `Restored ${added} arena${added === 1 ? '' : 's'} from the SQLite archive${upgraded ? `, rebuilt ${upgraded} bracket${upgraded === 1 ? '' : 's'}` : ''}${snaps ? ', applied known snapshots' : ''}${sealed ? `, sealed ${sealed} result${sealed === 1 ? '' : 's'}` : ''}. Open Arenas to view them.`
                : 'Nothing missing — every recorded arena is already on the list.';
            }
          } catch (err) {
            if (errEl) {
              errEl.hidden = false;
              errEl.textContent = err.message;
            } else {
              window.alert(err.message);
            }
          }
        };
      }
      root.querySelectorAll('[data-remove-champ]').forEach((btn) => {
        btn.onclick = async () => {
          const handle = btn.getAttribute('data-remove-champ');
          if (!window.confirm(`Remove ${handle} from tournament titles? Official arenas they won become scrims. Handwritten titles are deleted.`)) return;
          try {
            await api.post('/records/host', { hostPassword, op: 'removeChampion', handle });
            renderRecords();
          } catch (err) {
            window.alert(err.message);
          }
        };
      });
      root.querySelectorAll('[data-del-mention]').forEach((btn) => {
        btn.onclick = async () => {
          if (!window.confirm('Remove this honourable mention?')) return;
          try {
            await api.post('/records/host', { hostPassword, op: 'deleteMention', id: Number(btn.getAttribute('data-del-mention')) });
            renderRecords();
          } catch (err) {
            window.alert(err.message);
          }
        };
      });
    };

    const filteredEvents = () => events.filter((event) => {
      if (kind === 'duel' && event.kind !== 'duel') return false;
      if (kind === 'tournament' && event.kind === 'duel') return false;
      if (format !== 'all' && event.format !== format) return false;
      if (officialOnly && !event.official && !event.manual) return false;
      if (query) {
        const hay = `${event.name} ${event.champion && event.champion.handle || ''} ${event.runnerUp && event.runnerUp.handle || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const resultsPanel = () => {
      const rows = filteredEvents();
      return `<div class="records-filters">
        <div class="seg" role="group" aria-label="Kind">
          ${[['all', 'All'], ['tournament', 'Tournaments'], ['duel', 'Duels']].map(([id, label]) => `<button type="button" data-kind="${id}" class="${kind === id ? 'on' : ''}">${label}</button>`).join('')}
        </div>
        <label class="records-search"><span class="lbl">Search</span>
          <input id="records-q" type="search" placeholder="Name or handle" value="${esc(query)}">
        </label>
        <label class="records-format"><span class="lbl">Format</span>
          <select id="records-format">
            <option value="all" ${format === 'all' ? 'selected' : ''}>All formats</option>
            ${formats.map((f) => `<option value="${esc(f)}" ${format === f ? 'selected' : ''}>${esc(FORMAT_LABEL[f] || f)}</option>`).join('')}
          </select>
        </label>
        <label class="check"><input type="checkbox" id="records-official" ${officialOnly ? 'checked' : ''}> Official only</label>
      </div>
      <div class="result-list">${rows.map(resultRowHtml).join('') || '<p class="muted">No matching results on the ledger yet.</p>'}</div>`;
    };

    const titlesPanel = () => `<p class="muted">Tournament titles only — 1st place in a field of 3 or more. Duel wins live on the Duel board.</p>
      ${isAdminMode() ? '<p class="muted">Admin: Remove takes that name off titles. Real arenas become scrims. <a href="/tourney/#/ledger">Write the ledger</a>.</p>' : ''}
      <ol class="rank-list title-list">${champions.map((c, i) => `
        <li>
          <span class="place">${i + 1}</span>
          <div>${isAdminMode()
            ? `<a class="named-handle" href="/tourney/#/player/${encodeURIComponent(c.handle)}">${namedHandleHtml(c.handle, c.badges)}</a>`
            : `<a class="named-handle" href="/tourney/#/player/${encodeURIComponent(c.handle)}">${namedHandleHtml(c.handle, c.badges)}</a>`}
            ${isAdminMode() ? `<div class="hall-acts"><button type="button" class="mini bad" data-remove-champ="${esc(c.handle)}">Remove</button></div>` : ''}</div>
          <span class="rank-seal gold">${c.titles} title${c.titles === 1 ? '' : 's'}</span>
        </li>`).join('') || '<li><span></span><p class="muted">No tournament champions yet.</p><span></span></li>'}</ol>`;

    const duelsPanel = () => `<p class="muted">Official 1v1 results. A completed arena with two confirmed players counts as a duel.</p>
      <div class="table-scroll"><table class="results-table">
        <thead><tr><th>#</th><th>Player</th><th>W–L</th><th>Win %</th></tr></thead>
        <tbody>${duelists.map((d, i) => {
          const played = Number(d.played) || ((Number(d.wins) || 0) + (Number(d.losses) || 0));
          const pct = played ? Math.round((Number(d.wins) || 0) * 100 / played) : 0;
          return `<tr>
            <td>${i + 1}</td>
            <td><a class="named-handle" href="/tourney/#/player/${encodeURIComponent(d.handle)}">${namedHandleHtml(d.handle, d.badges)}</a></td>
            <td class="record-cell">${esc(formatRecord(d.record) || '0–0')}</td>
            <td>${played ? `${pct}%` : '—'}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4" class="muted">No official duels yet.</td></tr>'}</tbody>
      </table></div>
      <h2 class="section-title">Recent duels</h2>
      <div class="result-list">${events.filter((e) => e.kind === 'duel').map(resultRowHtml).join('') || '<p class="muted">No completed duels on the ledger.</p>'}</div>`;

    const honoursPanel = () => `${marksGalleryHtml()}
      <h2 class="section-title">Honourable mentions</h2>
      <div class="grid cards">${mentions.map((m) => {
        const inner = `<div class="row"><h3>${namedHandleHtml(m.handle, m.badges)}</h3><span class="rank-seal honour">Mention</span></div>
          <p class="muted">${esc(m.title)}</p>
          ${m.blurb ? `<p class="muted">${esc(m.blurb)}</p>` : ''}
          ${isAdminMode() ? `<div class="hall-acts"><button type="button" class="mini bad" data-del-mention="${m.id}">Remove</button></div>` : ''}`;
        return isAdminMode()
          ? `<article class="card plaque honour-card">${inner}</article>`
          : `<a class="card plaque honour-card" href="/tourney/#/player/${encodeURIComponent(m.handle)}">${inner}</a>`;
      }).join('') || '<p class="muted">No honourable mentions recorded yet.</p>'}</div>
      ${ledgers.map((board) => `
        <h2 class="section-title">${esc(board.name)}</h2>
        ${board.blurb ? `<p class="muted">${esc(board.blurb)}</p>` : ''}
        <div class="card">
          <ol class="rank-list">${(board.entries || []).map((row) => `
            <li>
              <span class="place">${row.rank != null ? esc(placeLabel(row.rank)) : '—'}</span>
              <div><a class="named-handle" href="/tourney/#/player/${encodeURIComponent(row.handle)}">${esc(row.handle)}${medalsInlineHtml(badgesFor(row.handle))}</a>${row.note ? `<p class="muted" style="margin:2px 0 0">${esc(row.note)}</p>` : ''}</div>
              <span></span>
            </li>`).join('') || '<li><span></span><p class="muted">No names on this board yet.</p><span></span></li>'}</ol>
          ${(board.mentions || []).length ? `<p class="muted" style="margin:14px 0 8px">Honourable mentions</p>
            <div class="chips">${board.mentions.map((row) => `<a class="chip named-handle" href="/tourney/#/player/${encodeURIComponent(row.handle)}">${esc(row.handle)}${medalsInlineHtml(badgesFor(row.handle))}${row.note ? ` · ${esc(row.note)}` : ''}</a>`).join('')}</div>` : ''}
        </div>`).join('')}`;

    const paint = () => {
      const panelHtml = tab === 'titles' ? titlesPanel() : tab === 'duels' ? duelsPanel() : tab === 'honours' ? honoursPanel() : resultsPanel();
      root.innerHTML = `<div class="records-page">
        <header class="records-head">
          <p class="form-kicker">Doginal Dogs</p>
          <h1>Records</h1>
          <p class="muted">Tournaments crown a field of three or more. Grand Tournaments are flagship IRL events. Duels are 1v1 series. Official finishes land here; scrims stay off the boards unless you ask to see them.</p>
          ${isAdminMode() ? `<p class="muted">Admin: titles can be removed from the Titles tab. Live arenas are mirrored in SQLite — if the JSON list is empty, restore it from that archive. <a href="/tourney/#/ledger">Write the ledger</a>.</p>
            <div class="row wrap" style="margin-top:12px">
              <button class="btn ghost" type="button" id="restore-arenas-btn">Restore arenas from records</button>
            </div>
            <p class="err" id="restore-arenas-err" hidden></p>
            <p class="ok" id="restore-arenas-ok" hidden></p>` : ''}
          ${pack.warning ? `<p class="err">${esc(pack.warning)}</p>` : ''}
          <ul class="stat-strip">
            <li><strong>${Number(stats.tournaments) || 0}</strong><span>Tournaments</span></li>
            <li><strong>${Number(stats.duels) || 0}</strong><span>Duels</span></li>
            <li><strong>${champions.length}</strong><span>Champions</span></li>
            <li><strong>${duelists.length}</strong><span>Duelists</span></li>
          </ul>
        </header>
        <nav class="records-tabs" aria-label="Records sections">
          ${[['results', 'Results'], ['titles', 'Titles'], ['duels', 'Duel board'], ['honours', 'Honours']].map(([id, label]) => `<button type="button" data-rtab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}
        </nav>
        <div id="records-panel">${panelHtml}</div>
      </div>`;
      root.querySelectorAll('[data-rtab]').forEach((btn) => {
        btn.onclick = () => { tab = btn.getAttribute('data-rtab'); paint(); };
      });
      root.querySelectorAll('[data-kind]').forEach((btn) => {
        btn.onclick = () => { kind = btn.getAttribute('data-kind'); paint(); };
      });
      const qEl = document.getElementById('records-q');
      if (qEl) {
        qEl.oninput = () => { query = String(qEl.value || '').trim().toLowerCase(); };
        qEl.onchange = () => { query = String(qEl.value || '').trim().toLowerCase(); paint(); };
        qEl.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            query = String(qEl.value || '').trim().toLowerCase();
            paint();
            const next = document.getElementById('records-q');
            if (next) next.focus();
          }
        };
      }
      const fmtEl = document.getElementById('records-format');
      if (fmtEl) fmtEl.onchange = () => { format = fmtEl.value || 'all'; paint(); };
      const offEl = document.getElementById('records-official');
      if (offEl) offEl.onchange = () => { officialOnly = offEl.checked; paint(); };
      bindHost();
    };

    paint();
  } catch (err) {
    root.innerHTML = `<div class="records-page"><h1>Records</h1><p class="err">${esc(err.message)}</p></div>`;
  }
}

async function renderPlayer(handle) {
  setTreeMode(false);
  root.innerHTML = `<div class="form-page"><p class="muted">Loading ${esc(handle)}…</p></div>`;
  try {
    const pack = await api.get(`/records/players/${encodeURIComponent(handle)}`);
    const mine = playerUser && pack.handle && playerUser.tourneyHandle
      && String(playerUser.tourneyHandle).toLowerCase() === String(pack.handle).toLowerCase();
    let unclaimed = [];
    if (mine) {
      try {
        const u = await api.get('/records/unclaimed');
        unclaimed = u.results || [];
      } catch (_err) {}
    }
    const place = (n, kind) => {
      if (!n) return 'Played';
      if (kind === 'duel') return Number(n) === 1 ? 'Won' : (Number(n) === 2 ? 'Lost' : esc(placeLabel(n)));
      return `<span class="place-cell">${standingBadgeHtml(n)}${esc(placeLabel(n))}</span>`;
    };
    const duelBits = Number(pack.duelWins) > 0 || String(pack.duelRecord || '') !== '0-0'
      ? ` · Duel ${esc(formatRecord(pack.duelRecord) || '0–0')}`
      : '';
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">Player</p>
      <div class="organizer" style="margin-bottom:16px">
        ${pfpHtml(pack.user, pack.handle, 48)}
        <div>
          <h1 style="margin:0" class="named-handle">${esc(pack.handle)}${medalsInlineHtml(pack.badges)}</h1>
          <p class="muted">${pack.titles} tournament title${pack.titles === 1 ? '' : 's'} · ${pack.appearances} official appearance${pack.appearances === 1 ? '' : 's'}${duelBits}</p>
        </div>
      </div>
      ${(pack.badges || []).length ? `<h2>Badges</h2>
      ${isAdminMode() ? '<p class="muted">Admin: remove a mark that was pinned by mistake.</p>' : ''}
      ${medalsRowHtml(pack.badges, isAdminMode())}` : ''}
      <h2>Accolades</h2>
      <div class="chips">${(pack.accolades || []).map((a) => `<span class="chip" title="${esc(a.blurb)}">${esc(a.title)}</span>`).join('') || '<p class="muted">No official accolades yet.</p>'}</div>
      ${pack.mention ? `<p class="muted" style="margin-top:12px">Honourable mention — ${esc(pack.mention.title)}${pack.mention.blurb ? `: ${esc(pack.mention.blurb)}` : ''}</p>` : ''}
      <h2>Results</h2>
      <div class="table-scroll"><table class="results-table"><thead><tr><th>Arena</th><th>Type</th><th>Format</th><th>Place</th><th>Record</th></tr></thead>
      <tbody>${(pack.results || []).map((r) => `
        <tr>
          <td>${String(r.slug || '').startsWith('manual-') || Number(r.tournamentId) < 0
            ? esc(r.name)
            : `<a href="${arenaHref(r.slug)}">${esc(r.name)}</a>`}${r.official ? '' : ' <span class="muted">scrim</span>'}</td>
          <td>${esc(kindLabel(r, r.fieldSize))}</td>
          <td>${esc(r.kind === 'duel' ? '1v1' : (FORMAT_LABEL[r.format] || r.format || '—'))}</td>
          <td>${place(r.placement, r.kind)}</td>
          <td class="record-cell">${esc(formatRecord(r.record) || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No results on the ledger.</td></tr>'}</tbody></table></div>
      ${unclaimed.length ? `<h2>Claim a walk-in result</h2>
        <p class="muted">These finishes used your handle but were not linked to Discord. Ask the host to approve.</p>
        ${unclaimed.map((r) => `<div class="roster-row">
          <div class="who"><strong>${esc(r.name)}</strong><span class="muted">${place(r.placement)}</span></div>
          <button type="button" class="mini go" data-claim-entry="${r.entryId}" data-claim-t="${r.tournamentId}">Claim</button>
        </div>`).join('')}
        <p class="err" id="claim-self-err" hidden></p>
        <p class="ok" id="claim-self-ok" hidden></p>` : ''}
    </div>`;
    if (isAdminMode()) {
      root.querySelectorAll('[data-revoke]').forEach((btn) => {
        btn.onclick = async () => {
          if (!window.confirm('Remove this badge from this handle?')) return;
          try {
            const next = await api.post('/records/host', {
              adminPassword,
              op: 'revokeAward',
              id: Number(btn.getAttribute('data-revoke')),
            });
            ingestAwards(next.awards);
            applyPlayerChrome();
            renderPlayer(handle);
          } catch (err) {
            window.alert(err.message);
          }
        };
      });
    }
    root.querySelectorAll('[data-claim-entry]').forEach((btn) => {
      btn.onclick = async () => {
        const errEl = document.getElementById('claim-self-err');
        const okEl = document.getElementById('claim-self-ok');
        errEl.hidden = true;
        okEl.hidden = true;
        try {
          await api.post('/records/claim', {
            tournamentId: Number(btn.getAttribute('data-claim-t')),
            entryId: Number(btn.getAttribute('data-claim-entry')),
          });
          okEl.hidden = false;
          okEl.textContent = 'Claim sent. The host has to approve it.';
          btn.disabled = true;
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        }
      };
    });
  } catch (err) {
    root.innerHTML = `<div class="form-page"><h1>${esc(handle)}</h1><p class="err">${esc(err.message)}</p></div>`;
  }
}

async function renderLedger() {
  setTreeMode(false);
  if (!isAdminMode()) {
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">Admin only</p>
      <h1>The ledger</h1>
      <p class="muted">Sign in as admin to write champions, leaderboards, badges, and honourable mentions. Discord hosts cannot edit the ledger.</p>
      <button class="btn" type="button" id="ledger-signin">Admin sign in</button>
    </div>`;
    const btn = document.getElementById('ledger-signin');
    if (btn) btn.onclick = async () => { if (await openAdminSignIn()) renderLedger(); };
    return;
  }

  root.innerHTML = `<div class="form-page"><p class="muted">Loading the ledger…</p></div>`;
  let pack;
  try {
    pack = await api.get('/records');
  } catch (err) {
    root.innerHTML = `<div class="form-page"><h1>The ledger</h1><p class="err">${esc(err.message)}</p></div>`;
    return;
  }

  let tab = 'records';
  let badgeDraft = { title: '', blurb: '', icon: 'crest', motif: 'gold' };

  const run = async (op, extra, errId) => {
    const errEl = errId ? document.getElementById(errId) : null;
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    try {
      pack = await api.post('/records/host', { adminPassword, op, ...extra });
      ingestAwards(pack.awards);
      applyPlayerChrome();
      paint();
      return true;
    } catch (err) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      } else {
        window.alert(err.message);
      }
      return false;
    }
  };

  const handleField = (id) => `<div class="handle-typeahead">
    <input id="${id}" autocomplete="off" placeholder="Handle" aria-autocomplete="list">
    <ul class="handle-suggest" hidden></ul>
  </div>`;

  const paint = () => {
    ingestAwards(pack.awards);
    const events = pack.events || [];
    const ledgers = pack.ledgers || [];
    const mentions = pack.mentions || [];
    const badges = pack.badges || [];
    const allAwards = pack.awards || [];

    const recordsTab = `<section class="host-panel wide">
      <div class="host-flag">Host only</div>
      <h2 style="margin:0">Champions and arenas</h2>
      <p class="muted">Finals winners crown automatically. Promote a scrim, or write a title by hand if the arena never landed on the ledger.</p>
      <form id="title-form" class="stack wide">
        <div class="form-row"><label for="title-handle">Champion</label>${handleField('title-handle')}</div>
        <div class="form-row"><label for="title-arena">Arena or title</label><input id="title-arena" placeholder="SHOCK VS DICK - THE FINALS"></div>
        <div class="row wrap"><button class="btn" type="submit">Add champion</button></div>
        <p class="err" id="title-err" hidden></p>
      </form>
      <div class="grid cards" style="margin-top:12px">${events.map((e) => `
        <div class="card">
          <div class="row"><h3>${esc(e.name)}</h3>${e.official ? '<span class="badge ok">Official</span>' : '<span class="badge">Scrim</span>'}</div>
          <p class="muted">${e.champion && e.champion.handle ? `Champion: ${namedHandleHtml(e.champion.handle)}` : 'No champion recorded'} · ${e.manual ? 'Handwritten' : `${e.fieldSize} players`}</p>
          <div class="roster-acts" style="margin-top:10px">
            ${e.official
              ? `<button type="button" class="mini" data-official="0" data-tid="${e.tournamentId}">Mark scrim</button>`
              : `<button type="button" class="mini go" data-official="1" data-tid="${e.tournamentId}">Crown official</button>`}
            ${e.manual ? `<button type="button" class="mini bad" data-remove-title="${e.tournamentId}">Remove</button>` : ''}
          </div>
        </div>`).join('') || '<p class="muted">No completed arenas yet.</p>'}</div>
    </section>`;

    const boardsTab = `<section class="host-panel wide">
      <div class="host-flag">Host only</div>
      <h2 style="margin:0">Leaderboards</h2>
      <p class="muted">Name a board, then rank players. Honourable mentions on a board sit under the ranking.</p>
      <form id="board-form" class="stack wide">
        <div class="form-row"><label for="board-name">Board name</label><input id="board-name" placeholder="Season 1 standings"></div>
        <div class="form-row"><label for="board-blurb">Blurb</label><input id="board-blurb" placeholder="Optional line under the title"></div>
        <div class="row wrap"><button class="btn" type="submit">Create leaderboard</button></div>
        <p class="err" id="board-err" hidden></p>
      </form>
      ${ledgers.map((board) => `
        <article class="card" style="margin-top:14px">
          <div class="row"><h3>${esc(board.name)}</h3><button type="button" class="mini bad" data-del-board="${board.id}">Delete board</button></div>
          ${board.blurb ? `<p class="muted">${esc(board.blurb)}</p>` : ''}
          <ol class="rank-list">${(board.entries || []).map((row) => `
            <li>
              <span class="place">${row.rank != null ? esc(placeLabel(row.rank)) : '—'}</span>
              <div><strong class="named-handle">${esc(row.handle)}${medalsInlineHtml(badgesFor(row.handle))}</strong>${row.note ? `<p class="muted" style="margin:2px 0 0">${esc(row.note)}</p>` : ''}</div>
              <button type="button" class="mini bad" data-del-row="${row.id}">Remove</button>
            </li>`).join('') || '<li><span></span><p class="muted">Empty board.</p><span></span></li>'}</ol>
          ${(board.mentions || []).length ? `<p class="muted" style="margin:12px 0 6px">Honourable mentions</p>
            <div class="chips">${board.mentions.map((row) => `<span class="chip named-handle">${esc(row.handle)}${medalsInlineHtml(badgesFor(row.handle))}${row.note ? ` · ${esc(row.note)}` : ''} <button type="button" class="linkish" data-del-row="${row.id}">remove</button></span>`).join('')}</div>` : ''}
          <form class="row wrap" style="margin-top:12px" data-board-row="${board.id}">
            ${handleField(`row-handle-${board.id}`)}
            <input type="number" min="1" max="99" value="${(board.entries || []).length + 1}" id="row-rank-${board.id}" style="max-width:5.5rem" aria-label="Rank">
            <input placeholder="Note" id="row-note-${board.id}" style="flex:1 1 10rem">
            <button class="mini go" type="submit">Add rank</button>
            <button class="mini" type="submit" data-kind="honour">Add mention</button>
          </form>
          <p class="err" id="row-err-${board.id}" hidden></p>
        </article>`).join('')}
    </section>`;

    const mentionsTab = `<section class="host-panel wide">
      <div class="host-flag">Host only</div>
      <h2 style="margin:0">Honourable mentions</h2>
      <p class="muted">These sit on the Hall of records under Champions — for names that deserve the flame without a title.</p>
      <form id="mention-form" class="stack wide">
        <div class="form-row"><label for="mention-handle">Player</label>${handleField('mention-handle')}</div>
        <div class="form-row"><label for="mention-title">Line</label><input id="mention-title" placeholder="Sportsmanship, clutch run, host's pick…"></div>
        <div class="form-row"><label for="mention-blurb">Note</label><input id="mention-blurb" placeholder="Optional"></div>
        <div class="row wrap"><button class="btn" type="submit">Add mention</button></div>
        <p class="err" id="mention-err" hidden></p>
      </form>
      <div class="grid cards" style="margin-top:12px">${mentions.map((m) => `
        <div class="card honour-card">
          <div class="row"><h3>${namedHandleHtml(m.handle, m.badges)}</h3><button type="button" class="mini bad" data-del-mention="${m.id}">Remove</button></div>
          <p class="muted">${esc(m.title)}</p>
          ${m.blurb ? `<p class="muted">${esc(m.blurb)}</p>` : ''}
        </div>`).join('') || '<p class="muted">None recorded yet.</p>'}</div>
    </section>`;

    const standingIcons = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.STANDING_ICONS) || [];
    const classIcons = (typeof DDL_BADGES !== 'undefined' && DDL_BADGES.CLASS_ICONS) || [];
    const pickIcons = (icons, label) => icons.length ? `<div class="form-row"><span class="lbl">${label}</span>
      <div class="icon-pick">${icons.map((icon) => `
        <button type="button" data-icon="${icon}" class="${badgeDraft.icon === icon ? 'on' : ''}" title="${icon}">${medalHtml({ title: icon, icon, motif: badgeDraft.motif }, 'md')}</button>`).join('')}
      </div>
    </div>` : '';
    const playedClassAwards = allAwards.filter((a) => String(a.slug || '').startsWith('class-') && /^Played /i.test(a.note || ''));
    const badgesTab = `<section class="host-panel wide">
      <div class="host-flag">Host only</div>
      <h2 style="margin:0">Badge builder</h2>
      <p class="muted">Standings and class marks are already in the hall. Award them here, or forge a custom medallion. Revoke a chip if it was pinned by mistake.</p>
      ${playedClassAwards.length ? `<div class="notice">
        <p><strong>${playedClassAwards.length} class medal${playedClassAwards.length === 1 ? '' : 's'} from signup</strong></p>
        <p class="muted">These were pinned just for playing a class, not for a podium. Strip them without touching 1st–3rd class medals or anything you awarded by hand.</p>
        <button type="button" class="btn ghost" id="strip-played-class">Strip signup class medals</button>
      </div>` : ''}
      <div class="badge-preview">
        ${medalHtml({ title: badgeDraft.title || 'New badge', icon: badgeDraft.icon, motif: badgeDraft.motif }, 'lg')}
        <div class="medal-meta">
          <p class="form-kicker" style="margin:0">Preview</p>
          <h3>${esc(badgeDraft.title || 'Untitled badge')}</h3>
          <p class="muted">${esc(badgeDraft.blurb || 'A mark for the hall.')}</p>
        </div>
      </div>
      <form id="badge-form" class="stack wide">
        ${pickIcons(standingIcons, 'Standings')}
        ${pickIcons(classIcons, 'Classes')}
        <div class="form-row"><span class="lbl">Custom mark</span>
          <div class="icon-pick">${MARK_ICONS.map((icon) => `
            <button type="button" data-icon="${icon}" class="${badgeDraft.icon === icon ? 'on' : ''}" title="${icon}">${medalHtml({ title: icon, icon, motif: badgeDraft.motif }, 'md')}</button>`).join('')}
          </div>
        </div>
        <div class="form-row"><span class="lbl">Fire</span>
          <div class="swatch-pick">${BADGE_MOTIFS.map((motif) => `
            <button type="button" class="${motif}${badgeDraft.motif === motif ? ' on' : ''}" data-motif="${motif}" title="${motif}"></button>`).join('')}
          </div>
        </div>
        <div class="form-row"><label for="badge-title">Title</label><input id="badge-title" value="${esc(badgeDraft.title)}" placeholder="Flamebound"></div>
        <div class="form-row"><label for="badge-blurb">Blurb</label><input id="badge-blurb" value="${esc(badgeDraft.blurb)}" placeholder="Won the first official finals."></div>
        <div class="row wrap"><button class="btn" type="submit">Save badge</button></div>
        <p class="err" id="badge-err" hidden></p>
      </form>
      ${badges.map((b) => {
        const holders = allAwards.filter((a) => a.badgeId === b.id);
        return `
        <article class="card" style="margin-top:14px">
          <div class="row">
            <div class="medal-row">${medalHtml(b, 'md')}<span class="medal-meta"><strong>${esc(b.title)}</strong><span class="muted">${esc(b.blurb || '')}${b.system ? ' · system' : ''} · ${holders.length} awarded</span></span></div>
            <div class="roster-acts">
              ${holders.length ? `<button type="button" class="mini bad" data-clear-awards="${b.id}" data-title="${esc(b.title)}">Clear all</button>` : ''}
              ${b.system ? '' : `<button type="button" class="mini bad" data-del-badge="${b.id}">Delete</button>`}
            </div>
          </div>
          <form class="award-row" style="margin-top:12px" data-award="${b.id}">
            ${handleField(`award-handle-${b.id}`)}
            <button class="mini go" type="submit">Award</button>
          </form>
          <p class="err" id="award-err-${b.id}" hidden></p>
          <div class="chips" style="margin-top:10px">${holders.map((a) => `
            <span class="chip named-handle">${esc(a.handle)}${a.note ? `<span class="muted"> · ${esc(a.note)}</span>` : ''} <button type="button" class="mini bad" data-revoke="${a.id}">Remove</button></span>`).join('') || '<span class="muted">Not awarded yet.</span>'}</div>
        </article>`;
      }).join('') || '<p class="muted" style="margin-top:12px">No badges forged yet.</p>'}
    </section>`;

    const tabHtml = {
      records: recordsTab,
      boards: boardsTab,
      mentions: mentionsTab,
      badges: badgesTab,
    };

    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">Doginal Dogs</p>
      <h1>The ledger</h1>
      <p class="muted">Write what the bracket missed. Champions from a finals still land on their own — this page is for everything you need to put on the hall by hand.</p>
      <p class="muted"><a href="/tourney/#/records">Back to Hall of records</a></p>
      ${pack.warning ? `<p class="err">${esc(pack.warning)}</p>` : ''}
      <div class="tabs">
        <button type="button" data-tab="records" class="${tab === 'records' ? 'on' : ''}">Champions</button>
        <button type="button" data-tab="boards" class="${tab === 'boards' ? 'on' : ''}">Leaderboards</button>
        <button type="button" data-tab="mentions" class="${tab === 'mentions' ? 'on' : ''}">Mentions</button>
        <button type="button" data-tab="badges" class="${tab === 'badges' ? 'on' : ''}">Badges</button>
      </div>
      ${tabHtml[tab] || recordsTab}
    </div>`;

    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => { tab = btn.getAttribute('data-tab'); paint(); };
    });

    root.querySelectorAll('input[id$="-handle"], input[id^="row-handle-"], input[id^="award-handle-"], #title-handle, #mention-handle').forEach((input) => {
      const list = input.parentElement && input.parentElement.querySelector('.handle-suggest');
      bindHandleTypeahead(input, list, []);
    });

    const titleForm = document.getElementById('title-form');
    if (titleForm) titleForm.onsubmit = (event) => {
      event.preventDefault();
      run('addTitle', {
        handle: document.getElementById('title-handle').value,
        arenaName: document.getElementById('title-arena').value,
      }, 'title-err');
    };
    root.querySelectorAll('[data-official]').forEach((btn) => {
      btn.onclick = () => run('setOfficial', {
        tournamentId: Number(btn.getAttribute('data-tid')),
        official: btn.getAttribute('data-official') === '1',
      });
    });
    root.querySelectorAll('[data-remove-title]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this handwritten title?')) return;
        run('removeTitle', { tournamentId: Number(btn.getAttribute('data-remove-title')) });
      };
    });

    const boardForm = document.getElementById('board-form');
    if (boardForm) boardForm.onsubmit = (event) => {
      event.preventDefault();
      run('saveBoard', {
        name: document.getElementById('board-name').value,
        blurb: document.getElementById('board-blurb').value,
      }, 'board-err');
    };
    root.querySelectorAll('[data-del-board]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Delete this leaderboard?')) return;
        run('deleteBoard', { id: Number(btn.getAttribute('data-del-board')) });
      };
    });
    root.querySelectorAll('[data-del-row]').forEach((btn) => {
      btn.onclick = () => run('removeBoardRow', { id: Number(btn.getAttribute('data-del-row')) });
    });
    root.querySelectorAll('form[data-board-row]').forEach((form) => {
      form.onsubmit = (event) => {
        event.preventDefault();
        const id = form.getAttribute('data-board-row');
        const honour = event.submitter && event.submitter.getAttribute('data-kind') === 'honour';
        run('addBoardRow', {
          ledgerId: Number(id),
          handle: document.getElementById(`row-handle-${id}`).value,
          rank: Number(document.getElementById(`row-rank-${id}`).value || 1),
          note: document.getElementById(`row-note-${id}`).value,
          kind: honour ? 'honour' : 'entry',
        }, `row-err-${id}`);
      };
    });

    const mentionForm = document.getElementById('mention-form');
    if (mentionForm) mentionForm.onsubmit = (event) => {
      event.preventDefault();
      run('saveMention', {
        handle: document.getElementById('mention-handle').value,
        title: document.getElementById('mention-title').value,
        blurb: document.getElementById('mention-blurb').value,
      }, 'mention-err');
    };
    root.querySelectorAll('[data-del-mention]').forEach((btn) => {
      btn.onclick = () => run('deleteMention', { id: Number(btn.getAttribute('data-del-mention')) });
    });

    root.querySelectorAll('[data-icon]').forEach((btn) => {
      btn.onclick = () => {
        const icon = btn.getAttribute('data-icon');
        badgeDraft.icon = icon;
        const spec = typeof DDL_BADGES !== 'undefined' ? DDL_BADGES.specFor({ icon }) : null;
        if (spec) {
          badgeDraft.title = spec.title;
          badgeDraft.blurb = spec.blurb;
        } else {
          badgeDraft.title = document.getElementById('badge-title')?.value || badgeDraft.title;
          badgeDraft.blurb = document.getElementById('badge-blurb')?.value || badgeDraft.blurb;
        }
        paint();
      };
    });
    root.querySelectorAll('[data-motif]').forEach((btn) => {
      btn.onclick = () => {
        badgeDraft.motif = btn.getAttribute('data-motif');
        badgeDraft.title = document.getElementById('badge-title')?.value || badgeDraft.title;
        badgeDraft.blurb = document.getElementById('badge-blurb')?.value || badgeDraft.blurb;
        paint();
      };
    });
    const badgeTitle = document.getElementById('badge-title');
    const badgeBlurb = document.getElementById('badge-blurb');
    if (badgeTitle) badgeTitle.oninput = () => {
      badgeDraft.title = badgeTitle.value;
      const el = root.querySelector('.badge-preview h3');
      if (el) el.textContent = badgeDraft.title || 'Untitled badge';
    };
    if (badgeBlurb) badgeBlurb.oninput = () => {
      badgeDraft.blurb = badgeBlurb.value;
      const el = root.querySelector('.badge-preview .muted');
      if (el) el.textContent = badgeDraft.blurb || 'A mark for the hall.';
    };
    const badgeForm = document.getElementById('badge-form');
    if (badgeForm) badgeForm.onsubmit = (event) => {
      event.preventDefault();
      badgeDraft.title = document.getElementById('badge-title').value;
      badgeDraft.blurb = document.getElementById('badge-blurb').value;
      run('saveBadge', { ...badgeDraft }, 'badge-err').then((ok) => {
        if (ok) {
          badgeDraft = { title: '', blurb: '', icon: badgeDraft.icon, motif: badgeDraft.motif };
          paint();
        }
      });
    };
    root.querySelectorAll('[data-del-badge]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Delete this badge and every award?')) return;
        run('deleteBadge', { id: Number(btn.getAttribute('data-del-badge')) });
      };
    });
    const stripBtn = document.getElementById('strip-played-class');
    if (stripBtn) {
      stripBtn.onclick = () => {
        if (!window.confirm(`Strip ${playedClassAwards.length} class medal${playedClassAwards.length === 1 ? '' : 's'} that were pinned just for playing? Podium class medals stay.`)) return;
        run('stripPlayedClassAwards');
      };
    }
    root.querySelectorAll('[data-clear-awards]').forEach((btn) => {
      btn.onclick = () => {
        const title = btn.getAttribute('data-title') || 'this badge';
        if (!window.confirm(`Remove every ${title} medal from every handle?`)) return;
        run('clearBadgeAwards', { badgeId: Number(btn.getAttribute('data-clear-awards')) });
      };
    });
    root.querySelectorAll('form[data-award]').forEach((form) => {
      form.onsubmit = (event) => {
        event.preventDefault();
        const id = form.getAttribute('data-award');
        run('awardBadge', {
          badgeId: Number(id),
          handle: document.getElementById(`award-handle-${id}`).value,
        }, `award-err-${id}`);
      };
    });
    root.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this badge from this handle?')) return;
        run('revokeAward', { id: Number(btn.getAttribute('data-revoke')) });
      };
    });
  };

  paint();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const EVENT_TIME_SRC = '/bracket/event-time.js?v=bracket-ui-139';

function loadEventTime() {
  if (globalThis.LBEventTime && typeof globalThis.LBEventTime.eventStartMs === 'function') {
    return Promise.resolve(globalThis.LBEventTime);
  }
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = EVENT_TIME_SRC;
    s.onload = () => resolve(globalThis.LBEventTime || {});
    s.onerror = () => resolve({});
    document.head.appendChild(s);
  });
}

async function loadAwardIndex() {
  try {
    const pack = await api.get('/records/awards');
    ingestAwards(pack.awards);
  } catch (_err) {}
}

async function boot() {
  void loadEventTime();
  void warmArenas();
  if (window.DdlIrlCatalog && typeof DdlIrlCatalog.load === 'function') {
    DdlIrlCatalog.load().catch(() => {});
  }
  applyHostChrome();
  applyPlayerChrome();
  const toggle = document.getElementById('host-toggle');
  if (toggle) {
    toggle.onclick = async () => {
      if (isAdminMode()) {
        clearAdminSession();
        route();
        return;
      }
      if (await openAdminSignIn()) route();
    };
  }
  const signout = document.getElementById('player-signout');
  if (signout) {
    signout.onclick = async () => {
      playerUser = null;
      applyPlayerChrome();
      applyHostChrome();
      try { await authApi.post('/logout', {}); } catch (_err) {}
      playerUser = null;
      applyPlayerChrome();
      applyHostChrome();
      route();
    };
  }
  initTips();
  initNav();
  window.addEventListener('hashchange', () => {
    applyPlayerChrome();
    route();
  });
  window.addEventListener('popstate', () => {
    applyPlayerChrome();
    route();
  });
  document.addEventListener('visibilitychange', () => {
    if (!chatSlug) return;
    if (!document.hidden) void pullArenaChat(false);
    scheduleArenaChat();
  });
  window.addEventListener('resize', () => {
    if (chatSlug) applyChatChrome();
  });
  // Awards and Discord session can finish after first paint.
  void loadAwardIndex();
  route();
  void loadPlayerSession().then(() => {
    applyPlayerChrome();
    applyHostChrome();
    route();
  });
  try {
    serverStatus = await api.get('/status');
  } catch (_err) {
    serverStatus = null;
  }
  const params = new URLSearchParams(String(location.hash || '').split('?')[1] || '');
  const authError = params.get('auth_error');
  if (authError) {
    const clean = cleanHashForReturn();
    history.replaceState(null, '', `${location.pathname}${location.search}${clean}`);
    // Stale error from an earlier failed attempt often rides along after a successful login.
    if (!playerUser) {
      window.alert(authError);
    }
  }
  // A stored admin password from a previous tab is only trusted after the server agrees.
  sessionStorage.removeItem('ddl-host-password');
  sessionStorage.removeItem('ddl-host-mode');
  if (isAdminMode()) {
    try {
      await api.post('/admin-auth', { adminPassword });
    } catch (_err) {
      clearAdminSession();
      route();
    }
  }
}

boot();
