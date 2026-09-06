const TOURNEY_API_BASES = ['/tourney-api', '/kmx-tourney', '/kk-tourney'];

const root = document.getElementById('app');

/**
 * Host state. `hostPassword` is only kept after the server has verified it, so every
 * "am I the host" check in the UI is a real answer instead of "did someone type something".
 */
let hostPassword = sessionStorage.getItem('ddl-host-password') || '';
let hostMode = hostPassword !== '' && sessionStorage.getItem('ddl-host-mode') === '1';
let adminPassword = sessionStorage.getItem('ddl-admin-password') || '';
let serverStatus = null;
let playerUser = null;
let irlUnmount = null;

const AUTH_API_BASES = ['/kmx-auth', '/kk-auth', '/dd-evaluator/auth'];

function isSignedInUser(user) {
  return Boolean(user && (user.id || user.discordId || user.tourneyHandle || user.discordUsername));
}

const authApi = {
  async get(path) {
    let lastErr;
    for (const base of AUTH_API_BASES) {
      try {
        const res = await fetch(`${base}${path}`, { credentials: 'same-origin' });
        const text = await res.text();
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
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Auth request failed');
  },
  async post(path, body) {
    let lastErr;
    for (const base of AUTH_API_BASES) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body || {}),
        });
        const text = await res.text();
        if (/^\s*</.test(text) && !String(text).includes('"error"')) {
          lastErr = new Error('Auth API returned a web page');
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`);
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
  if (fromPath[0] === 't' && fromPath[1]) return fromPath;
  const querySlug = new URLSearchParams(location.search || '').get('t') || new URLSearchParams(location.search || '').get('slug');
  if (querySlug) return ['t', querySlug];
  const hash = (location.hash || '#/').replace(/^#/, '');
  return hash.split('/').filter(Boolean).map((part) => decodeURIComponent(part.split('?')[0])).filter(Boolean);
}

function arenaHref(slug) {
  return `/tourney/#/t/${encodeURIComponent(slug)}`;
}

function arenaShareHref(slug) {
  return `/tourney/?t=${encodeURIComponent(slug)}`;
}

function tourneyReturnPath() {
  const parts = routeParts();
  if (parts[0] === 't' && parts[1] && parts[2] === 'table' && parts[3]) {
    return `/tourney/#/t/${encodeURIComponent(parts[1])}/table/${encodeURIComponent(parts[3])}`;
  }
  if (parts[0] === 't' && parts[1]) return arenaShareHref(parts[1]);
  if (parts[0] === 'player' && parts[1]) return `/tourney/#/player/${encodeURIComponent(parts[1])}`;
  if (parts[0] === 'records') return '/tourney/#/records';
  if (parts[0] === 'ledger') return '/tourney/#/ledger';
  if (parts[0] === 'create') return '/tourney/#/create';
  return '/tourney/';
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
}

function applyPlayerChrome() {
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

function hostHeaders() {
  return hostMode && hostPassword ? { 'x-tourney-host': hostPassword } : {};
}

const api = {
  async get(path) {
    let lastErr;
    for (const base of TOURNEY_API_BASES) {
      try {
        const res = await fetch(`${base}${path}`, { headers: hostHeaders(), credentials: 'same-origin', cache: 'no-store' });
        const text = await res.text();
        if (/^\s*</.test(text)) {
          lastErr = new Error(htmlErrorMessage(res.status, base));
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
    for (const base of TOURNEY_API_BASES) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...hostHeaders() },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify(body || {}),
        });
        const text = await res.text();
        if ((res.status === 404 || /^\s*</.test(text)) && !String(text).includes('"error"')) {
          lastErr = new Error(htmlErrorMessage(res.status, base));
          continue;
        }
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = {}; }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
  in_progress: 'Live',
  completed: 'Complete',
  pending: 'Unpaid',
  confirmed: 'Paid',
  no_show: 'No-show',
  ready: 'Ready',
  complete: 'Done',
  bye: 'Bye',
};

const PAY_TO = {
  DOGE: 'DD4KcuppEUBR8vETG46d4w8BcgvDkzbss2',
};
const K9SWAP_URL = 'https://k9swap.com';

const BEST_OF = [1, 3, 5];
const GAMES = ['Doginal Dogs Legends TCG', 'Doginal Dogs', 'Other'];
const TIMEZONES = ['America/Halifax', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC', 'Europe/London'];

const TIPS_KEY = 'ddl-tips-mode';
let tipsOn = localStorage.getItem(TIPS_KEY) !== '0';
let tipTarget = null;
let lastPointer = 'mouse';

function setTreeMode(on) {
  const active = Boolean(on);
  document.body.classList.toggle('has-tree', active);
  document.documentElement.classList.toggle('has-tree', active);
}

const KICK_RESERVED = new Set([
  'about', 'api', 'browse', 'categories', 'category', 'channel', 'channels',
  'clip', 'clips', 'community', 'dashboard', 'directory', 'embed', 'explore',
  'following', 'help', 'home', 'live', 'login', 'messages', 'notifications',
  'player', 'plus', 'premium', 'privacy', 'register', 'search', 'settings',
  'signup', 'terms', 'video', 'videos',
]);
const KICK_MIN_KEY = 'ddl-kick-min';
let kickWantAudio = false;
let kickStreamMin = localStorage.getItem(KICK_MIN_KEY) === '1';

function kickChannelOf(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^[A-Za-z0-9_-]{3,32}$/.test(text) && !KICK_RESERVED.has(text.toLowerCase())) return text;
  let parsed;
  try {
    parsed = new URL(text.includes('://') ? text : `https://${text}`);
  } catch (_err) {
    return '';
  }
  const host = String(parsed.hostname || '').replace(/^www\./i, '').toLowerCase();
  if (host !== 'kick.com' && host !== 'player.kick.com') return '';
  const parts = String(parsed.pathname || '').split('/').filter(Boolean);
  if (!parts.length) return '';
  let slug = parts[0];
  if (slug.toLowerCase() === 'embed' && parts[1]) slug = parts[1];
  if (KICK_RESERVED.has(slug.toLowerCase())) return '';
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(slug)) return '';
  return slug;
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
  const live = t && t.status === 'in_progress';
  const channel = kickChannelOf(t && t.streamUrl);
  if (!live || !channel) {
    hideKickStream();
    return;
  }
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
    if (open) open.href = kickWatchUrl(channel);
    return;
  }
  dock.hidden = false;
  dock.classList.toggle('is-min', kickStreamMin);
  document.body.classList.add('has-kick-stream');
  dock.innerHTML = `<div class="kick-stream-bar">
      <span class="kick-live">Live</span>
      <strong>kick.com/${esc(channel)}</strong>
      <div class="kick-stream-acts">
        <button type="button" class="btn" id="kick-audio" ${kickWantAudio ? 'hidden' : ''} ${tip('Play the stream here with sound. Browsers start muted until you ask for audio.')}>Watch with audio</button>
        <a class="btn ghost" id="kick-open" href="${esc(kickWatchUrl(channel))}" target="_blank" rel="noopener noreferrer" ${tip('Opens the Kick channel in a new tab.')}>Open on Kick</a>
        <button type="button" class="btn ghost" id="kick-toggle" aria-expanded="${kickStreamMin ? 'false' : 'true'}">${kickStreamMin ? 'Show player' : 'Hide player'}</button>
      </div>
    </div>
    <div class="kick-stream-stage">
      <iframe data-channel="${esc(channel.toLowerCase())}" src="${esc(nextSrc)}" title="Kick livestream — ${esc(channel)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen scrolling="no" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>`;
  bindKickStreamDock(dock, channel);
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
  const btn = document.getElementById('nav-toggle');
  const nav = document.getElementById('top-nav');
  if (!btn || !nav) return;
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#top-nav, #nav-toggle')) setOpen(false);
  });
  window.addEventListener('hashchange', () => setOpen(false));
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
// Host session
// ---------------------------------------------------------------------------

function setHostSession(password) {
  hostPassword = String(password ?? '').trim();
  hostMode = hostPassword !== '';
  sessionStorage.setItem('ddl-host-password', hostPassword);
  sessionStorage.setItem('ddl-host-mode', hostMode ? '1' : '0');
  applyHostChrome();
}

function clearHostSession() {
  hostPassword = '';
  hostMode = false;
  sessionStorage.removeItem('ddl-host-password');
  sessionStorage.removeItem('ddl-host-mode');
  applyHostChrome();
}

function setAdminPassword(value) {
  adminPassword = String(value ?? '').trim();
  sessionStorage.setItem('ddl-admin-password', adminPassword);
}

function applyHostChrome() {
  document.body.classList.toggle('host-mode', hostMode);
  const toggle = document.getElementById('host-toggle');
  if (toggle) {
    toggle.textContent = hostMode ? 'Host mode on' : 'Host sign in';
    toggle.classList.toggle('on', hostMode);
    toggle.setAttribute('data-tip', hostMode
      ? 'You are signed in as host. Click to sign out and see the page as a visitor.'
      : 'Sign in with TOURNEY_PASSWORD to confirm payments, lock brackets and report scores.');
  }
  const create = document.getElementById('nav-create');
  if (create) create.hidden = !hostMode;
  const ledger = document.getElementById('nav-ledger');
  if (ledger) ledger.hidden = !hostMode;
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

/** Single sign-in point for every host action. Resolves true once the server accepts. */
function openHostSignIn() {
  return new Promise((resolve) => {
    const locked = serverStatus && serverStatus.hostPasswordSet === false;
    const overlay = openModal(`
      <div class="row">
        <div>
          <p class="muted">Host sign in</p>
          <h2>Unlock host tools</h2>
        </div>
        <button type="button" class="copy" id="hs-close">Close</button>
      </div>
      <p class="muted">One sign-in covers everything: confirming payments, locking the bracket, reporting scores and editing settings. Players never need this.</p>
      ${locked ? `<p class="err">This server has no host password yet. Set <code>TOURNEY_PASSWORD</code> in Node, or put it on line 1 of <span class="mono">public/server/data/.tourney-password</span>, then restart.</p>` : ''}
      <div><label for="hs-pw">Host password</label>${secretFieldHtml('hs-pw', '')}</div>
      <p class="err" id="hs-err" hidden></p>
      <button class="btn" type="button" id="hs-go">Sign in as host</button>`);
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
        errEl.textContent = 'Enter the host password.';
        return;
      }
      try {
        const previous = { hostPassword, hostMode };
        hostPassword = candidate;
        hostMode = true;
        try {
          await api.post('/host-auth', { hostPassword: candidate });
        } catch (err) {
          hostPassword = previous.hostPassword;
          hostMode = previous.hostMode;
          throw err;
        }
        setHostSession(candidate);
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
  const extra = status === 'in_progress' ? 'live'
    : status === 'pending' || status === 'no_show' ? 'pending'
    : status === 'confirmed' ? 'ok' : '';
  return `<span class="badge ${extra}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
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

function rewardsOf(data, t) {
  if (data && data.rewards && data.rewards.mode) return data.rewards;
  if (t && t.rewards && t.rewards.mode) return t.rewards;
  const mode = t && t.rewardMode === 'prize' ? 'prize' : 'pot';
  const pool = Number((data && data.prizePool) ?? (t && t.prizePool)) || 0;
  const payouts = Array.isArray(t && t.payouts) ? t.payouts : [];
  const rows = payouts.map((p) => {
    if (mode === 'prize') {
      return p.prize ? { place: p.place, label: placeLabel(p.place), text: p.prize } : null;
    }
    const percent = Number(p.percent) || 0;
    if (!(percent > 0)) return null;
    return {
      place: p.place,
      label: placeLabel(p.place),
      text: `${percent}%`,
      amountUsd: Math.round(pool * percent) / 100,
      percent,
    };
  }).filter(Boolean);
  return { mode, pool, rows };
}

function prizeForPlace(rewards, place) {
  const row = rewards && (rewards.rows || []).find((r) => Number(r.place) === Number(place));
  if (!row) return '';
  if (rewards.mode === 'prize') return row.text || '';
  if (row.amountUsd != null) return formatUsd(row.amountUsd);
  return row.text || '';
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
  const pool = `<div><dt>Pot</dt><dd>${formatUsd(rewards && rewards.pool)}</dd></div>`;
  if (!rows.length) return pool;
  const split = rows.map((r) => {
    const cash = Number(rewards.pool) > 0 ? ` ${formatUsd(r.amountUsd)}` : '';
    return `${r.label} ${r.percent}%${cash}`;
  }).join(' · ');
  return `${pool}<div><dt>Payout</dt><dd>${esc(split)}</dd></div>`;
}

function filledPayouts(payload) {
  const mode = payload && payload.rewardMode === 'prize' ? 'prize' : 'pot';
  return (payload && payload.payouts ? payload.payouts : []).filter((row) => (
    mode === 'prize' ? Boolean(String(row.prize || '').trim()) : Number(row.percent) > 0
  ));
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
  if (!rows.length) return '';
  const prizeMode = rewards.mode === 'prize';
  return `<section class="payouts" ${tip(prizeMode
    ? 'Host-set prizes for each place. Entry fees are not this prize list.'
    : 'How the paid entry pot splits by place.')}>
    <h2>${prizeMode ? 'Prizes' : 'Pot breakdown'}</h2>
    <ol>
      ${rows.map((row) => `<li>
        <span>${esc(row.label)}</span>
        <strong>${esc(prizeMode ? row.text : formatUsd(row.amountUsd))}</strong>
        ${!prizeMode && row.percent != null ? `<small>${esc(String(row.percent))}%</small>` : ''}
      </li>`).join('')}
    </ol>
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
  if (Number(t && t.prizePool) > 0) {
    return `<p class="muted">Pot ${formatUsd(t.prizePool)}</p>`;
  }
  return '';
}

function payoutRowHtml(place, percent, prize) {
  const pct = percent === 0 || percent ? String(percent) : '';
  return `<div class="payout-row" data-place="${place}">
    <span class="payout-place">${esc(placeLabel(place))}</span>
    <div class="payout-value">
      <span class="payout-percent-wrap"><input class="payout-percent" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(pct)}" placeholder="0" aria-label="${esc(placeLabel(place))} percent of pot"><span class="muted">%</span></span>
      <input class="payout-prize" maxlength="120" value="${esc(prize || '')}" placeholder="Card, merch, DOGE…" aria-label="${esc(placeLabel(place))} prize">
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
      prize: row && row.prize ? row.prize : '',
    });
  }
  return rows;
}

function formatCrypto(asset, value) {
  const n = Number(value) || 0;
  if (asset === 'SOL') return `${n.toFixed(6)} SOL`;
  return `${n.toFixed(2)} DOGE`;
}

function feeUsd(tournament) {
  const n = Number(tournament && tournament.entryFeeUsd);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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

function payBoxes(payTo) {
  const doge = (payTo && payTo.DOGE) || PAY_TO.DOGE;
  return `<div class="pay">
    <p class="muted">Entry is DOGE only. Send the live quoted amount, then enter the DOGE wallet you sent from. No password.</p>
    <article>
      <div class="row"><strong>DOGE</strong><button type="button" class="copy" data-copy="${esc(doge)}">Copy</button></div>
      <code class="mono">${esc(doge)}</code>
    </article>
    ${k9swapCard()}
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
      const availW = Math.max(48, port.clientWidth - 12);
      const availH = Math.max(48, port.clientHeight - 12);
      apply(Math.min(1, availW / w, availH / h), 0, 0);
      port.scrollLeft = 0;
      port.scrollTop = 0;
    };

    const zoomAt = (next, clientX, clientY) => {
      const rect = port.getBoundingClientRect();
      apply(next, clientX - rect.left, clientY - rect.top);
    };

    apply(1);

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
      const ro = new ResizeObserver(() => apply(scale));
      ro.observe(port);
    }
  });
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

function matchResultLine(match, entries) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  if (!p1 || !p2) return '';
  if (match.status !== 'complete' && !(match.games || []).length) return '';
  const s1 = match.score1 ?? 0;
  const s2 = match.score2 ?? 0;
  return `${p1.handle} vs ${p2.handle} ${s1}/${s2}`;
}

function roundResultsText(data) {
  const t = data && data.tournament;
  const entries = (data && data.entries) || [];
  const matches = (data && data.matches) || [];
  if (!t || !matches.length) return '';
  const lines = [];
  const emit = (label, list) => {
    const rows = (list || []).map((m) => matchResultLine(m, entries)).filter(Boolean);
    if (!rows.length) return;
    if (lines.length) lines.push('');
    lines.push(label);
    lines.push(...rows);
  };
  const groups = [...new Set(matches.map((m) => m.group).filter(Boolean))];
  for (const g of groups) {
    const ofG = matches.filter((m) => m.group === g).sort((a, b) => a.round - b.round || a.position - b.position);
    const maxR = ofG.reduce((n, m) => Math.max(n, m.round), 0);
    for (let r = 1; r <= maxR; r++) {
      const list = ofG.filter((m) => m.round === r);
      if (list.length) emit(`Group ${g} · ${roundLabel(t.format, 'group', r, maxR)}`, list);
    }
  }
  for (const roundMatches of groupRounds(matches.filter((m) => m.side === 'group' && !m.group), 'group')) {
    emit(roundLabel(t.format, 'group', roundMatches[0].round, t.swissRounds), roundMatches);
  }
  const treeFmt = wantsLosers(t) ? 'double_elim' : t.format;
  for (const side of ['winners', 'losers', 'grand', 'placement']) {
    const ofSide = matches.filter((m) => m.side === side);
    const maxR = ofSide.reduce((n, m) => Math.max(n, m.round), 0);
    for (const roundMatches of groupRounds(matches, side)) {
      emit(roundLabel(treeFmt, side, roundMatches[0].round, maxR), roundMatches);
    }
  }
  return lines.join('\n');
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

function openExportSheet(text, slug) {
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  const body = text || 'No completed matches yet.';
  overlay.innerHTML = `<div class="scorecard export-sheet" role="dialog" aria-modal="true">
    <div class="row">
      <h2>Round results</h2>
      <button type="button" class="copy" id="ex-close">Close</button>
    </div>
    <pre class="export-text" id="ex-text">${esc(body)}</pre>
    <div class="sc-actions">
      <button class="btn ghost" type="button" id="ex-copy">Copy text</button>
      <button class="btn" type="button" id="ex-download">Download .txt</button>
    </div>
  </div>`;
  overlay.querySelector('#ex-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector('#ex-copy').onclick = async (event) => {
    const btn = event.currentTarget;
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(body);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = label; }, 1200);
    } catch (_err) {
      btn.textContent = 'Select & copy';
    }
  };
  overlay.querySelector('#ex-download').onclick = () => {
    const blob = new Blob([`${body}\n`], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${slug || 'arena'}-round-results.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
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

function tableHref(slug, matchId) {
  return `/tourney/#/t/${encodeURIComponent(slug)}/table/${encodeURIComponent(String(matchId))}`;
}

function matchTip(match) {
  if (match.status === 'ready' && (match.games || []).length) {
    const running = `In progress ${match.score1 ?? 0}–${match.score2 ?? 0}.`;
    return hostMode ? `${running} Open the scorecard to finish and lock the series.` : running;
  }
  if (match.status === 'ready') {
    return hostMode ? 'Ready match. Open the scorecard and report each game.' : 'Ready to play — the host reports the result here.';
  }
  if (match.status === 'bye') return 'Bye — this player advances because the other slot is empty.';
  if (match.status === 'complete') return hostMode ? 'Series locked. Open to unlock and edit this round.' : 'Series locked. Gold check marks the winner.';
  return 'Waiting for a player from the previous round.';
}

function matchCardHtml(match, entries, votes, opts) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  const hostEdit = Boolean(opts && opts.hostEdit);
  const swapPick = Boolean(opts && opts.swapPick);
  const picked = new Set((opts && opts.swapSelected || []).map((id) => String(id)));
  const pairPicked = new Set((opts && opts.pairSelected || []).map((id) => String(id)));
  const canEdit = hostEdit && matchEditable(match);
  const clickable = !hostEdit && !swapPick && hostMode && (match.status === 'ready' || match.status === 'complete');
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
    ? `<a class="table-link" href="${esc(tableHref(slug, match.id))}" ${tip('Open the IRL table. Sit as your handle, then link your hand cam.')}>Table</a>`
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
  const actions = hostEdit ? [
    match.status === 'ready' ? `<button type="button" class="mini go" data-match="${match.id}">Report series</button>` : '',
    match.status === 'complete' ? `<button type="button" class="mini" data-reset-match="${match.id}" ${tip('Unlock this series and later matches that used it, so you can edit this round.')}>Unlock series</button>` : '',
  ].filter(Boolean).join('') : (swapPick && match.status === 'complete'
    ? `<button type="button" class="mini" data-reset-match="${match.id}">Unlock series</button>`
    : '');
  const body = `${slot(p1, match.score1, match.winnerId === match.entry1Id && match.status === 'complete', empty, 1)}
    ${slot(p2, match.score2, match.winnerId === match.entry2Id && match.status === 'complete', empty, 2)}
    ${v1 + v2 ? `<div class="votes">Votes ${v1}–${v2}</div>` : ''}
    ${actions}`;
  if (hostEdit || swapPick) return `<div class="${classes}">${body}${tableLink}</div>`;
  const hit = clickable
    ? `<button type="button" class="match-card-hit" data-match="${match.id}" ${tip(matchTip(match))}>${body}</button>`
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
      </div>
    </div>
    <div class="bracket-port" tabindex="0" aria-label="Tournament bracket. Drag or scroll to pan.">
      <div class="bracket-sizer">
        <div class="bracket-tree" style="--slots:${rounds[0].length}">
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

function defaultsFrom(t) {
  const d = t || {};
  return {
    eventKind: sanitizeEventKind(d.eventKind, d.name),
    hostName: d.hostName || (playerUser && (playerUser.tourneyHandle || playerUser.discordUsername)) || 'KushMetaX',
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
    feeMode: d.feeMode || (Number(d.entryFeeUsd) > 0 ? 'paid' : 'free'),
    entryFeeUsd: Number(d.entryFeeUsd) || 0,
    rewardMode: d.rewardMode === 'prize' ? 'prize' : 'pot',
    hostPotUsd: Number(d.hostPotUsd) || 0,
    payouts: Array.isArray(d.payouts) ? d.payouts : [],
    requireTeams: Boolean(d.requireTeams),
    capPlayers: d.capPlayers !== false,
    maxPlayers: d.maxPlayers || 16,
    startAt: d.startAt ? String(d.startAt).slice(0, 16) : '',
    startTentative: Boolean(d.startTentative),
    timezone: d.timezone || 'America/Halifax',
    requireCheckIn: Boolean(d.requireCheckIn),
    votingEnabled: Boolean(d.votingEnabled),
    predictionsEnabled: Boolean(d.predictionsEnabled),
    shareImages: Boolean(d.shareImages),
    requireVerifiedEmail: Boolean(d.requireVerifiedEmail),
    requireAccount: d.requireAccount !== false,
    official: d.official !== false,
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

function settingsFormHtml(t, opts) {
  const d = defaultsFrom(t);
  const creating = Boolean(opts && opts.creating);
  const payoutRows = payoutRowsFrom(d, creating);
  return `<section class="panel">
      <div class="panel-h">Basic info</div>
      <div class="panel-b">
        <div class="form-row"><span class="lbl">Host</span>
          ${playerUser ? `<div>
            <div class="organizer organizer-preview">
              ${pfpHtml(playerUser, playerUser.tourneyHandle || playerUser.discordUsername || d.hostName, 32)}
              <div><small class="muted">Organized by</small><div class="org-name named-handle">${esc(playerUser.tourneyHandle || playerUser.discordUsername || d.hostName)}${medalsInlineHtml(badgesFor(playerUser.tourneyHandle || playerUser.discordUsername || d.hostName))}</div></div>
            </div>
            <input type="hidden" id="s-host" value="${esc(playerUser.tourneyHandle || playerUser.discordUsername || d.hostName)}">
            <p class="hint">Imported from Discord. The public page links this name and PFP.</p>
          </div>` : `<div><input id="s-host" value="${esc(d.hostName)}" ${tip('Shown as the organizer on the public bracket page.')}>
          <p class="hint">Sign in with Discord so Organized by imports your name and PFP. Host as your handle to keep pack stats on this hearth.</p></div>`}
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
            <input id="s-stream" value="${esc(d.streamUrl)}" placeholder="https://kick.com/yourchannel" maxlength="200" ${tip('Paste a Kick channel or livestream link. While the arena is live, the bracket shows an embedded player with audio, plus a button to open Kick.')}>
            <p class="hint">Shown on the bracket while this arena is live. Viewers can watch here with audio, or open the Kick channel.</p>
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
              : 'Set a prize pot in dollars, or let paid entries fill it. Percents split that total by place. Leave percents blank to show only the running total.'}</p>
          </div>
        </div>
        <div class="form-row" id="hostpot-row" style="${d.rewardMode === 'prize' ? 'display:none' : ''}"><label for="s-hostpot">Prize pot (USD)</label>
          <div>
            <input id="s-hostpot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(d.hostPotUsd || 0)}" ${tip('House money for this arena. Added on top of paid entries. For a free list you add yourself, this is the whole pot — set it before you lock.')}>
            <p class="hint">Shows as Pot on the public page. Paid entries add on top. $0 means entry fees only.</p>
          </div>
        </div>
        <div class="form-row"><span class="lbl">By place</span>
          <div id="reward-fields" data-mode="${esc(d.rewardMode)}">
            <div id="payout-rows">
              ${payoutRows.map((row) => payoutRowHtml(row.place, row.percent, row.prize)).join('')}
            </div>
            <div class="row wrap" style="margin-top:10px">
              <button type="button" class="mini" id="payout-add">Add place</button>
            </div>
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
            <button type="button" data-fee="paid" class="${d.feeMode !== 'free' ? 'on' : ''}">Paid</button>
          </div>
          <input type="hidden" id="s-fee" value="${esc(d.feeMode)}">
          <div id="fee-paid" style="${d.feeMode === 'free' ? 'display:none' : ''}"><label for="s-usd">USD amount</label><input id="s-usd" type="number" min="0" step="0.01" value="${d.entryFeeUsd || 10}"></div>
          <p class="hint">Paid quotes live DOGE and you confirm each payment on the Players tab. Players who need DOGE swap on K9SWAP. Free entries confirm themselves.</p></div>
        </div>
        <div class="form-row"><span class="lbl">Participants</span>
          <div>
            <label class="check"><input type="checkbox" id="s-teams" ${d.requireTeams ? 'checked' : ''}> Require participants to register as a team</label>
            <label class="check"><input type="checkbox" id="s-cap" ${d.capPlayers ? 'checked' : ''}> Specify a maximum number of participants</label>
            <input id="s-max" type="number" min="2" max="64" value="${d.maxPlayers}" style="max-width:8rem;margin-top:8px">
          </div>
        </div>
        <div class="form-row"><label for="s-start">Start time <span class="req">*</span></label>
          <div><input id="s-start" type="datetime-local" value="${esc(d.startAt)}" ${tip('Shown on the public page. Tentative hides the countdown pressure.')}>
          <label class="check"><input type="checkbox" id="s-tentative" ${d.startTentative ? 'checked' : ''}> Mark as tentative</label>
          <label for="s-tz">Time zone</label>
          <select id="s-tz">${TIMEZONES.map((z) => `<option ${d.timezone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
        </div>
        <div class="form-row"><span class="lbl">Check-in</span>
          <label class="check"><input type="checkbox" id="s-checkin" ${d.requireCheckIn ? 'checked' : ''}> Require participants to check in before the bracket locks</label>
        </div>
        <div class="form-row"><span class="lbl">Accounts</span>
          <div>
            <label class="check"><input type="checkbox" id="s-account" ${d.requireAccount ? 'checked' : ''}> Require Discord sign-in to register (walk-ins can still be added by the host)</label>
            <label class="check"><input type="checkbox" id="s-official" ${d.official ? 'checked' : ''}> Count this arena toward records and accolades</label>
            <p class="hint">Completed tournaments (3+ players) crown a champion. Completed duels count as 1v1 wins. Uncheck this for a scrim.</p>
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
      <div class="panel-h">Experimental features</div>
      <div class="panel-b">
        <label class="check"><input type="checkbox" id="s-images" ${d.shareImages ? 'checked' : ''}> Generate shareable images for match results (SE, DE, RR, Swiss)</label>
        <label class="check"><input type="checkbox" id="s-email" ${d.requireVerifiedEmail ? 'checked' : ''}> Require an email before joining</label>
        <label class="check"><input type="checkbox" id="s-country" ${d.countryLock ? 'checked' : ''}> Allow specific countries for registration</label>
        <input id="s-countries" placeholder="US, CA, GB" value="${esc(d.allowedCountries)}" ${tip('Comma-separated country names or codes. Leave blank to use the checkbox only as a flag.')}>
        <label class="check"><input type="checkbox" id="s-predfields" ${d.predictionCustomFields ? 'checked' : ''}> Allow a custom note on predictions</label>
        <p class="hint">Experimental switches can change. They are fully stored on this arena today.</p>
      </div>
    </section>`;
}

function bindSettingsChrome(form) {
  const paid = form.querySelector('#fee-paid');
  const hidden = form.querySelector('#s-fee');
  form.querySelectorAll('[data-fee]').forEach((btn) => {
    btn.onclick = () => {
      form.querySelectorAll('[data-fee]').forEach((b) => b.classList.toggle('on', b === btn));
      hidden.value = btn.getAttribute('data-fee');
      paid.style.display = hidden.value === 'free' ? 'none' : '';
    };
  });
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
        : 'Set a prize pot in dollars, or let paid entries fill it. Percents split that total by place. Leave percents blank to show only the running total.';
    }
    const hostpotRow = form.querySelector('#hostpot-row');
    if (hostpotRow) hostpotRow.style.display = mode === 'prize' ? 'none' : '';
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
      const prize = row.querySelector('.payout-prize');
      if (pct) pct.setAttribute('aria-label', `${placeLabel(place)} percent of pot`);
      if (prize) prize.setAttribute('aria-label', `${placeLabel(place)} prize`);
    });
  };
  const updatePayoutSum = () => {
    if (!payoutSum || !rewardHidden) return;
    const mode = rewardHidden.value === 'prize' ? 'prize' : 'pot';
    const rows = [...form.querySelectorAll('.payout-row')].map((row, i) => ({
      place: i + 1,
      label: placeLabel(i + 1),
      percent: Number(row.querySelector('.payout-percent')?.value || 0),
      prize: String(row.querySelector('.payout-prize')?.value || '').trim(),
    }));
    const filled = rows.filter((r) => (mode === 'prize' ? r.prize : r.percent > 0));
    const preview = form.querySelector('#reward-preview');
    if (preview) {
      if (!filled.length) {
        preview.textContent = mode === 'prize'
          ? 'Players will still see Pot until you type prizes and save.'
          : 'Players will see the running pot total only.';
      } else if (mode === 'prize') {
        preview.textContent = `Arena cards list Prize(s): ${compactPrizeLine(filled.map((r) => r.prize))} — opening the tournament still shows 1st / 2nd / 3rd.`;
      } else {
        preview.textContent = `Players will see Pot plus payout: ${filled.map((r) => `${r.label} ${r.percent}%`).join(' · ')}`;
      }
    }
    if (mode === 'prize') {
      payoutSum.textContent = 'Save options to put this list on the public arena page.';
      return;
    }
    const total = rows.reduce((sum, row) => sum + (row.percent || 0), 0);
    if (!(total > 0)) {
      payoutSum.textContent = 'No split yet — the public page shows the pot total only.';
      return;
    }
    const rounded = Math.round(total * 100) / 100;
    payoutSum.textContent = rounded === 100
      ? 'Splits add up to 100% of the pot.'
      : `Splits add up to ${rounded}% of the pot.`;
  };
  form.querySelectorAll('[data-reward]').forEach((btn) => {
    btn.onclick = () => {
      form.querySelectorAll('[data-reward]').forEach((b) => b.classList.toggle('on', b === btn));
      if (rewardHidden) rewardHidden.value = btn.getAttribute('data-reward');
      syncRewardMode();
    };
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
          const prize = only.querySelector('.payout-prize');
          if (pct) pct.value = '';
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
      payoutRowsEl.insertAdjacentHTML('beforeend', payoutRowHtml(count + 1, '', ''));
      updatePayoutSum();
    };
  }
  syncRewardMode();
  const wlRow = form.querySelector('#wl-spots-row');
  const wlCheck = form.querySelector('#s-wl');
  const syncWl = () => {
    if (wlRow) wlRow.style.display = wlCheck && wlCheck.checked ? '' : 'none';
  };
  if (wlCheck) wlCheck.onchange = syncWl;
  syncWl();
}

function collectSettings(form) {
  const feeMode = form.querySelector('#s-fee')?.value || 'paid';
  const usd = feeMode === 'free' ? 0 : Number(form.querySelector('#s-usd')?.value || 0);
  const rewardMode = form.querySelector('#s-reward')?.value === 'prize' ? 'prize' : 'pot';
  const payouts = [...form.querySelectorAll('.payout-row')].map((row, i) => ({
    place: i + 1,
    percent: Number(row.querySelector('.payout-percent')?.value || 0),
    prize: String(row.querySelector('.payout-prize')?.value || '').trim(),
  }));
  return {
    hostPassword,
    hostName: form.querySelector('#s-host')?.value,
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
    hostPotUsd: Number(form.querySelector('#s-hostpot')?.value || 0),
    payouts,
    requireTeams: form.querySelector('#s-teams')?.checked,
    capPlayers: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' ? true : form.querySelector('#s-cap')?.checked,
    maxPlayers: form.querySelector('input[name="s-kind"]:checked')?.value === 'duel' ? 2 : Number(form.querySelector('#s-max')?.value || 16),
    startAt: form.querySelector('#s-start')?.value || null,
    startTentative: form.querySelector('#s-tentative')?.checked,
    timezone: form.querySelector('#s-tz')?.value,
    requireCheckIn: form.querySelector('#s-checkin')?.checked,
    votingEnabled: form.querySelector('#s-vote')?.checked,
    predictionsEnabled: form.querySelector('#s-pred')?.checked,
    shareImages: form.querySelector('#s-images')?.checked,
    requireVerifiedEmail: form.querySelector('#s-email')?.checked,
    requireAccount: form.querySelector('#s-account')?.checked,
    official: form.querySelector('#s-official')?.checked,
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
  if (!(parts[0] === 't' && parts[1])) hideKickStream();
  if (parts[0] === 'create') return renderCreate();
  if (parts[0] === 'records') return renderRecords();
  if (parts[0] === 'ledger') return renderLedger();
  if (parts[0] === 'player' && parts[1]) return renderPlayer(parts[1]);
  if (parts[0] === 't' && parts[1] && parts[2] === 'table' && parts[3]) return renderIrlTable(parts[1], parts[3]);
  if (parts[0] === 't' && parts[1]) return renderArena(parts[1]);
  return renderHome();
}

async function renderIrlTable(slug, matchId) {
  hideKickStream();
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
  if (typeof DdlIrlTable === 'undefined' || !DdlIrlTable.mount) {
    root.innerHTML = `<p class="err">Table scripts failed to load. Upload <code>bracket/irl-table.js</code>.</p>`;
    return;
  }
  root.innerHTML = '';
  irlUnmount = DdlIrlTable.mount(root, {
    tableId: `a${data.tournament.id}m${match.id}`,
    eventName: data.tournament.name,
    backHref: arenaHref(slug),
    player1: p1 ? { id: p1.id, handle: p1.handle, userId: p1.userId, discordUser: p1.discordUser } : null,
    player2: p2 ? { id: p2.id, handle: p2.handle, userId: p2.userId, discordUser: p2.discordUser } : null,
    viewer: playerUser,
    discordHref: discordStartHref(),
    matchOpen: match.status === 'ready',
    matchComplete: match.status === 'complete',
    bestOf: match.bestOf,
    canReport: () => Boolean(hostMode && hostPassword),
    onHostGate: () => openHostSignIn(),
    onResult: async ({ score1, score2, bestOf }) => {
      if (!hostMode || !hostPassword) {
        const ok = await openHostSignIn();
        if (!ok) throw new Error('Host sign-in is required to lock this series');
      }
      await api.post(`/arenas/${encodeURIComponent(slug)}/table-lock`, {
        hostPassword,
        matchId: match.id,
        score1,
        score2,
        bestOf,
      });
      location.hash = `#/t/${encodeURIComponent(slug)}`;
    },
  });
}

const HERO = `<section class="hero">
  <div class="hero-lockup">
    <div class="hero-crest">
      <img src="/bracket/crest.jpg" alt="">
    </div>
    <div class="hero-copy">
      <p class="hero-kicker">DDL Tourney</p>
      <h1>Legends Bracket</h1>
    </div>
  </div>
  <i class="ornament" aria-hidden="true"><span></span></i>
  <p class="hero-lead">Pick an arena, sign in with Discord, and send the entry if there is one. The host confirms payments and runs the bracket. Wins are stored as records you can carry into a grand tournament.</p>
</section>`;

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

async function arenasFromRecordsFallback() {
  const pack = await api.get('/records');
  return (pack.events || []).filter((event) => event && event.slug).map(recordEventToArena);
}

async function renderHome() {
  setTreeMode(false);
  root.innerHTML = `${HERO}<p class="muted">Loading arenas…</p>`;
  try {
    let arenas = await api.get('/arenas');
    if (!Array.isArray(arenas)) arenas = [];
    if (!arenas.length) {
      try { arenas = await arenasFromRecordsFallback(); } catch (_err) {}
    }
    root.innerHTML = `${HERO}
    <p class="muted"><a href="/tourney/#/records">Records</a> — tournament titles, duel boards, and past results.${hostMode ? ` <a href="/tourney/#/ledger">Write the ledger</a>.` : ''}</p>
    <h2 class="section-title">Arenas</h2>
    <div class="grid cards">${arenas.map((t) => `
      <a class="card plaque" data-status="${esc(t.status)}" href="${arenaHref(t.slug)}">
        <div class="card-top">
          <h3>${esc(t.name)}</h3>
          <div class="card-tags">${kindTagHtml(t)}${badge(t.status)}</div>
        </div>
        <p class="muted">${esc(formatTitle(t))} · ${feeUsd(t) > 0 ? `${formatUsd(feeUsd(t))} entry` : 'Free entry'}</p>
        <p class="muted">${t.paidCount}${t.capPlayers !== false ? ` / ${t.maxPlayers}` : ''} ${isDuelArena(t) ? 'duelists' : 'players'} in${hostMode && Math.max(0, (t.entryCount || 0) - t.paidCount) ? ` · ${Math.max(0, (t.entryCount || 0) - t.paidCount)} awaiting payment` : ''}</p>
        ${rewardCardHtml(t)}
        ${t.status === 'completed' && t.champion && t.champion.handle ? `<p class="muted">${isDuelArena(t, t.paidCount) ? 'Winner' : 'Champion'}: ${namedHandleHtml(t.champion.handle)}</p>` : ''}
      </a>`).join('') || '<p class="muted">No arenas yet.</p>'}</div>
    ${hostMode ? `<section class="host-panel" style="margin-top:36px">
      <div class="host-flag">Host only</div>
      <h2>Host</h2>
      <p class="muted">Open a new arena, or clear out leftover demo arenas. Removing arenas uses <code>DD_ADMIN_PASSWORD</code>, not the host password.</p>
      <div class="row wrap" style="margin-bottom:14px"><a class="btn" href="/tourney/#/create">New tournament</a></div>
      <div class="stack">
        <div><label for="apw">Admin password</label>${secretFieldHtml('apw', adminPassword)}</div>
        <button class="btn ghost" type="button" id="purge-btn">Purge leftover demo arenas</button>
        <p class="err" id="admin-err" hidden></p>
        <p class="ok" id="admin-ok" hidden></p>
      </div>
    </section>` : `<p class="muted" style="margin-top:28px">Running an event? Use <strong>Host sign in</strong> above to open an arena.</p>`}`;
    const purge = document.getElementById('purge-btn');
    if (purge) purge.onclick = async () => {
      const errEl = document.getElementById('admin-err');
      const okEl = document.getElementById('admin-ok');
      errEl.hidden = true;
      okEl.hidden = true;
      setAdminPassword(document.getElementById('apw').value);
      try {
        const result = await api.post('/control/purge-demos', { adminPassword });
        okEl.hidden = false;
        okEl.textContent = result.removed ? `Removed ${result.removed} demo arena(s).` : 'No demo arenas left.';
        if (result.removed) route();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message;
      }
    };
  } catch (err) {
    root.innerHTML = `${HERO}<p class="err">${esc(err.message)}</p>`;
  }
}

async function renderCreate() {
  setTreeMode(false);
  if (!hostMode) {
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">DDL Tourney</p>
      <h1>Create a tournament</h1>
      <p class="muted">Only the host can open an arena. Sign in with <code>TOURNEY_PASSWORD</code> to continue.</p>
      <button class="btn" type="button" id="gate-btn">Host sign in</button>
    </div>`;
    document.getElementById('gate-btn').onclick = async () => {
      if (await openHostSignIn()) renderCreate();
    };
    return;
  }
  root.innerHTML = `<div class="form-page">
    <p class="form-kicker">DDL Tourney</p>
    <h1>Create a tournament</h1>
    <p class="muted">Every switch is stored on this arena and used when players join and when you lock the bracket. You can change all of it later.</p>
    <form id="create-form">
      ${settingsFormHtml(null, { creating: true })}
      <p class="err" id="create-err" hidden></p>
      <div class="save-bar"><button class="btn" type="submit">Create arena</button></div>
    </form>
  </div>`;
  const form = document.getElementById('create-form');
  bindSettingsChrome(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errEl = document.getElementById('create-err');
    errEl.hidden = true;
    try {
      const t = await api.post('/arenas', collectSettings(form));
      location.hash = `#/t/${encodeURIComponent(t.slug)}`;
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------------
// Scorecard (host only)
// ---------------------------------------------------------------------------

function openScorecard(data, slug, match, onSaved) {
  const p1 = entryOf(data.entries, match.entry1Id);
  const p2 = entryOf(data.entries, match.entry2Id);
  const closed = match.status === 'complete';
  let bestOf = BEST_OF.includes(Number(match.bestOf)) ? Number(match.bestOf) : 3;
  const games = (match.games || []).map((g) => Number(g.winnerSlot));
  const overlay = document.createElement('div');
  overlay.className = 'scorecard-overlay';
  const paintCard = () => {
    const need = winsNeeded(bestOf);
    const s1 = games.filter((slot) => slot === 1).length;
    const s2 = games.filter((slot) => slot === 2).length;
    const done = s1 >= need || s2 >= need;
    overlay.innerHTML = `<div class="scorecard" role="dialog" aria-modal="true">
      <div class="row">
        <div>
          <p class="muted">${esc(bestOfLabel(bestOf))} · first to ${need}${closed ? ' · locked' : ''}</p>
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
          ? `${esc((s1 > s2 ? p1 : p2)?.handle || 'Winner')} wins the series — lock it to advance them.`
          : `Tap each game as it finishes. Locking needs a series winner: ${need - Math.max(s1, s2)} more game${need - Math.max(s1, s2) === 1 ? '' : 's'}.`}</p>
      <p class="err" id="sc-err" hidden></p>
      <div class="sc-actions">
        ${closed
          ? `<button class="btn" type="button" id="sc-unlock" ${tip('Unlock this series and later matches that used it.')}>Unlock series</button>`
          : `<button class="btn ghost" type="button" id="sc-save" ${games.length ? '' : 'disabled'} ${tip('Save game wins so far. The match stays open and the bracket keeps the running score.')}>Save progress</button>
        <button class="btn" type="button" id="sc-lock" ${done ? '' : 'disabled'} ${tip('Locks the series and advances the winner.')}>Lock series</button>`}
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
      try {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/${path}`, {
          hostPassword,
          matchId: match.id,
          bestOf,
          games: recorded,
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
  root.innerHTML = `<p class="muted">Loading ${esc(slug)}…</p>`;
  let data;
  try {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
    applyBracketLayoutFixes(data);
  } catch (err) {
    root.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }

  const openForSignup = () => data.tournament.status === 'registration' && data.tournament.registrationMode !== 'list';
  let tab = openForSignup() && !hostMode ? 'enter' : 'bracket';
  let quoteTimer = 0;
  let shuffle = false;
  let swapA = '';
  let swapB = '';
  let pairA = '';
  let pairB = '';
  let pairRound = '';
  let swapPick = false;
  let placeEntry = '';
  let hostSavedMsg = '';
  let bestOf = BEST_OF.includes(Number(data.tournament.bestOf)) ? Number(data.tournament.bestOf) : 3;
  let finalsBestOf = BEST_OF.includes(Number(data.tournament.finalsBestOf)) ? Number(data.tournament.finalsBestOf) : null;
  let breakTies = Boolean(data.tournament.breakTies) && canHaveThirdPlace(data.tournament);
  let roundBestOf = { ...(data.tournament.roundBestOf || {}) };

  const reload = async () => {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
    applyBracketLayoutFixes(data);
  };

  /** Runs a host request, signing in first if needed, then repaints with the fresh arena. */
  const hostAction = async (errEl, run) => {
    if (errEl) errEl.hidden = true;
    if (!hostMode || !hostPassword) {
      const ok = await openHostSignIn();
      if (!ok) return;
      await reload();
    }
    try {
      const next = await run();
      if (next && next.tournament) {
        applyBracketLayoutFixes(next);
        data = next;
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

  const paint = () => {
    window.clearInterval(quoteTimer);
    quoteTimer = 0;
    const t = data.tournament;
    const confirmed = data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow);
    const pending = data.entries.filter((e) => !e.paid && !e.whitelist);
    const whitelist = data.entries.filter((e) => e.whitelist);
    const live = t.status !== 'registration';
    setTreeMode(live && tab === 'bracket');
    syncKickStream(t);
    const start = t.startAt
      ? new Date(t.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + (t.startTentative ? ' (tentative)' : '')
      : 'TBD';
    const predCount = (data.predictions || []).length;
    const nav = [
      ['bracket', 'Bracket'],
      openForSignup() ? ['enter', 'Register'] : null,
      ['players', hostMode && pending.length ? `Players (${pending.length} to confirm)` : `Players (${confirmed.length})`],
      Number(t.whitelistSpots) > 0 ? ['whitelist', `Whitelist (${whitelist.length}/${t.whitelistSpots || 0})`] : null,
      live ? ['standings', 'Standings'] : null,
      t.predictionsEnabled ? ['predict', `Predictions (${predCount})`] : null,
      hostMode ? ['host', 'Host tools'] : null,
    ].filter(Boolean);
    if (!nav.some(([id]) => id === tab)) tab = 'bracket';
    const rewards = rewardsOf(data, t);
    const podium = data.podium && t.status === 'completed' && data.podium.first
      ? prestigePodiumHtml(data.podium, rewards, t, confirmed.length)
      : '';
    root.innerHTML = `<div class="arena-shell">
      <nav class="arena-nav">
        ${nav.map(([id, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''} ${id === 'host' ? 'is-host' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div>
        <header class="arena-head">
          <div class="arena-lockup">
            <div class="hero-crest arena-crest">
              <img src="/bracket/crest.jpg" alt="">
            </div>
            <div class="arena-copy">
              <p class="hero-kicker">${isGrandArena(t) ? 'Grand Tournament' : 'DDL Tourney'}</p>
              <h1>${esc(t.name)} ${kindTagHtml(t)} ${badge(t.status)}</h1>
              <i class="ornament tight" aria-hidden="true"><span></span></i>
              <p class="share-line">
                <span class="mono muted">${esc(location.origin)}${arenaShareHref(slug)}</span>
                <button type="button" class="copy" data-copy="${esc(`${location.origin}${arenaShareHref(slug)}`)}" ${tip('Share this link on X. The preview card shows this tournament name beside the crest.')}>Copy link</button>
              </p>
              <dl class="meta">
                <div><dt>Players</dt><dd>${confirmed.length}${t.capPlayers !== false ? ` / ${t.maxPlayers}` : ''}</dd></div>
                <div><dt>Format</dt><dd>${esc(formatTitle(t))}</dd></div>
                <div><dt>Entry</dt><dd>${feeUsd(t) > 0 ? `${formatUsd(feeUsd(t))} USD` : 'Free'}</dd></div>
                <div><dt>Start</dt><dd>${esc(start)}</dd></div>
                ${rewardMetaHtml(rewards)}
              </dl>
            </div>
          </div>
          ${organizerHtml(t, resolveHostUser(t, data.hostUser))}
        </header>
        ${t.description ? `<p class="muted">${esc(t.description)}</p>` : ''}
        ${rewardBreakdownHtml(rewards)}
        ${podium}
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
  };

  const goTab = (next) => { tab = next; paint(); };

  function paintEnter(panel, t) {
    const usd = feeUsd(t);
    const needsAccount = t.requireAccount !== false;
    if (needsAccount && !playerUser) {
      panel.innerHTML = `${usd > 0 ? payBoxes(data.payTo) : ''}
        <div class="notice">
          <p><strong>Sign in with Discord to register</strong></p>
          <p class="muted">Accounts are Discord only — we never store a tournament password. Your handle is saved across arenas so wins and accolades stick to you.</p>
          <a class="btn" href="${esc(discordStartHref())}">Sign in with Discord</a>
        </div>`;
      bindCopy(panel);
      return;
    }
    const lockedHandle = playerUser && playerUser.tourneyHandle;
    const needHandle = playerUser && !playerUser.tourneyHandle;
    panel.innerHTML = `${usd > 0 ? payBoxes(data.payTo) : '<p class="muted">Free entry — you are in as soon as you register.</p>'}
      ${needHandle ? `<div class="notice"><p><strong>Pick your handle</strong></p><p class="muted">This name is yours across every arena. 2–24 characters.</p></div>` : ''}
      <form class="stack" id="enter-form">
      <div><label for="handle">${t.requireTeams && !playerUser ? 'Team name' : 'Handle'}</label>
        <input id="handle" required minlength="2" maxlength="24" placeholder="PackName" value="${esc(t.requireTeams && !playerUser ? '' : (lockedHandle || ''))}" ${playerUser && lockedHandle ? 'readonly' : ''}></div>
      ${t.requireTeams ? `<div><label for="team">${playerUser ? 'Team name' : 'Captain handle'}</label><input id="team" ${playerUser ? '' : 'required'} minlength="2" maxlength="24" value="${esc(playerUser ? '' : (lockedHandle || ''))}"></div>` : ''}
      <div><span class="lbl">Class</span>${classPickerHtml('enter-class', DDL_DEFAULT_CLASS)}</div>
      ${t.requireVerifiedEmail ? `<div><label for="email">Email</label><input id="email" type="email" required></div>` : ''}
      ${t.countryLock ? `<div><label for="country">Country</label><input id="country" required placeholder="${esc(t.allowedCountries || 'Country')}"></div>` : ''}
      ${usd > 0 ? `<p class="quote" id="live-quote">Loading live ${formatUsd(usd)} DOGE quote…</p>
        <div><label for="from-wallet">DOGE wallet you sent from</label><input id="from-wallet" required minlength="8" maxlength="64"></div>` : ''}
      <p class="err" id="enter-err" hidden></p>
      <div class="ok" id="enter-ok" hidden></div>
      <button class="btn" type="submit">Register</button>
    </form>`;
    bindCopy(panel);
    bindClassPicker(panel);
    const quoteEl = document.getElementById('live-quote');
    const refreshQuote = async () => {
      if (!quoteEl) return;
      try {
        const q = await api.get(`/quote?usd=${encodeURIComponent(usd)}`);
        quoteEl.innerHTML = `Send exactly <strong>${esc(formatCrypto('DOGE', q.DOGE))}</strong> for <strong>${esc(formatUsd(q.usd))}</strong><br><span class="muted">DOGE is ${esc(formatUsdRate(q.dogeUsd))} right now. Quote refreshes live. Need DOGE? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">Swap on K9SWAP</a>.</span>`;
      } catch (err) {
        quoteEl.innerHTML = `<span class="err">${esc(err.message)}</span>`;
      }
    };
    if (quoteEl) {
      refreshQuote();
      quoteTimer = window.setInterval(refreshQuote, 20000);
    }
    const form = document.getElementById('enter-form');
    if (form) form.onsubmit = async (event) => {
      event.preventDefault();
      const errEl = document.getElementById('enter-err');
      const okEl = document.getElementById('enter-ok');
      errEl.hidden = true;
      try {
        if (playerUser && !playerUser.tourneyHandle) {
          const saved = await authApi.post('/me/handle', { handle: document.getElementById('handle').value });
          playerUser = saved.user;
          applyPlayerChrome();
        }
        const entry = await api.post(`/arenas/${encodeURIComponent(slug)}/enter`, {
          handle: document.getElementById('handle').value,
          team: document.getElementById('team')?.value,
          email: document.getElementById('email')?.value,
          country: document.getElementById('country')?.value,
          fromWallet: document.getElementById('from-wallet')?.value || 'FREE-ENTRY',
          payAsset: 'DOGE',
          ddlClass: readClassPick(form, 'enter-class'),
        });
        window.clearInterval(quoteTimer);
        form.querySelector('button[type="submit"]').disabled = true;
        okEl.hidden = false;
        okEl.innerHTML = usd > 0
          ? `<strong>${esc(entry.handle)}</strong> is registered and waiting on payment.<br>
             Send <strong>${esc(formatCrypto(entry.payAsset, entry.amountCrypto))}</strong> (${esc(formatUsd(entry.amountUsd))} at ${esc(formatUsdRate(entry.usdPerCoin))}/${esc(entry.payAsset)}).<br>
             Quote your invoice <span class="mono">${esc(entry.invoiceCode)}</span> if the host needs to find your payment.<br>
             Need DOGE first? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">Swap on K9SWAP</a> — a Doginal Dogs powered, walletless crypto swapper.`
          : `<strong>${esc(entry.handle)}</strong> is in. See you on the bracket.`;
        await reload();
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
    const canEdit = hostMode && t.status === 'registration';
    const canAddLate = hostMode && t.status === 'in_progress';
    const lateSlots = canAddLate ? lateSeatOptions(t, data.matches, data.entries) : [];
    const canAdd = canEdit || (canAddLate && lateSlots.length);

    const row = (e) => {
      const details = [];
      if (hostMode) {
        if (paidFee && !e.paid) details.push(`<span>Should have sent <strong>${esc(formatCrypto(e.payAsset || 'DOGE', e.amountCrypto))}</strong> (${esc(formatUsd(e.amountUsd))})</span>`);
        if (e.fromWallet) details.push(`<span>From <code class="mono">${esc(e.fromWallet)}</code></span>`);
        if (e.invoiceCode && !e.addedByHost) details.push(`<span>Invoice <code class="mono">${esc(e.invoiceCode)}</code></span>`);
        if (e.email) details.push(`<span>${esc(e.email)}</span>`);
        if (e.addedByHost) details.push('<span>Added by you</span>');
        if (e.lateEntry) details.push('<span>Added after lock</span>');
        if (e.userId || (e.discordUser && e.discordUser.discordId)) details.push('<span>Discord linked</span>');
        else details.push('<span>Discord not linked</span>');
      }
      return `<div class="roster-row ${e.paid ? '' : 'is-pending'}">
        <div class="who">${entryAvatarHtml(e)}${namedHandleHtml(e.handle, e.badges)}${classLabelHtml(e.ddlClass)}${badge(e.noShow ? 'no_show' : e.paid ? 'confirmed' : 'pending')}</div>
        ${canEdit ? `<div class="roster-acts">
          ${e.paid
            ? `<button type="button" class="mini" data-unconfirm="${e.id}" ${tip('Move back to unpaid and out of the bracket.')}>Undo</button>`
            : `<button type="button" class="mini go" data-confirm="${e.id}" ${tip('Marks the entry paid and puts this player in the bracket.')}>Payment received</button>`}
          <button type="button" class="mini bad" data-remove="${e.id}" ${tip('Delete this entry from the arena.')}>Remove</button>
        </div>` : ''}
        ${details.length ? `<div class="roster-pay">${details.join('')}</div>` : ''}
      </div>`;
    };

    panel.innerHTML = `
      ${hostMode && pending.length && paidFee ? `<div class="host-panel">
        <div class="host-flag">Host only</div>
        <p><strong>${pending.length} ${pending.length === 1 ? 'entry is' : 'entries are'} waiting on payment</strong></p>
        <p class="muted">Check your DOGE wallet against the amount and sending wallet below, then mark it received. Confirmed players are the ones who go into the bracket.</p>
        <div class="row wrap">
          <button class="btn" type="button" id="confirm-all">Payment received for all ${pending.length}</button>
        </div>
        <p class="err" id="players-err" hidden></p>
      </div>` : `<p class="err" id="players-err" hidden></p>`}
      <p class="muted">${confirmed.length} confirmed${paidFee && pending.length && !hostMode ? ` · ${pending.length} awaiting payment` : ''}${t.capPlayers !== false ? ` · room for ${t.maxPlayers}` : ''}</p>
      <div class="roster">${ordered.map(row).join('') || '<p class="muted">Nobody has registered yet.</p>'}</div>
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
          ${canAddLate && usesElimTree(t) ? `<div><label for="add-slot">Put them</label>
            <select id="add-slot">${lateSlots.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>
          </div>` : ''}
          <button class="btn ghost" type="submit">${canAddLate ? 'Add to bracket' : 'Add'}</button>
        </form>
        <p class="hint">Discord-connected handles appear as you type. You can still add a walk-in name that is not in the list.</p>
      </div>` : canAddLate ? `<p class="muted" style="margin-top:16px">No open first-round slots left. Use the Whitelist tab to swap a no-show if every first-round match is already locked.</p>` : ''}`;

    const errEl = panel.querySelector('#players-err');
    const confirmAll = panel.querySelector('#confirm-all');
    if (confirmAll) confirmAll.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/confirm`, {
      hostPassword,
      entryIds: pending.map((e) => e.id),
    }));
    panel.querySelectorAll('[data-confirm]').forEach((btn) => {
      btn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/confirm`, {
        hostPassword,
        entryIds: [Number(btn.getAttribute('data-confirm'))],
      }));
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
      addForm.onsubmit = (event) => {
        event.preventDefault();
        const handleInput = panel.querySelector('#add-handle');
        const handle = handleInput.value;
        const slotEl = panel.querySelector('#add-slot');
        const [matchId, slot] = String((slotEl && slotEl.value) || 'auto').split(':');
        hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/add-entry`, {
          hostPassword,
          handle,
          userId: pickedUserId(handleInput),
          ddlClass: readClassPick(addForm, 'add-class'),
          matchId: matchId && matchId !== 'auto' ? Number(matchId) : undefined,
          slot: slot ? Number(slot) : undefined,
        }));
      };
    }
  }

  function paintStandings(panel) {
    const rows = data.standings || [];
    const entryById = new Map((data.entries || []).map((e) => [e.id, e]));
    panel.innerHTML = `<h2>Standings</h2>
      <div class="table-scroll"><table class="standings-table"><thead><tr><th>#</th><th>Handle</th><th>Class</th><th>Record</th><th>Pts</th><th>+/-</th></tr></thead><tbody>
      ${rows.map((s, i) => {
        const place = i + 1;
        const entry = entryById.get(s.entryId);
        return `<tr>
          <td class="standings-place">${standingBadgeHtml(place) || place}</td>
          <td>${namedHandleHtml(s.handle)}</td>
          <td>${classLabelHtml((entry && entry.ddlClass) || s.ddlClass) || '—'}</td>
          <td class="record-cell">${esc(formatRecord(`${s.wins}-${s.losses}`))}</td>
          <td>${s.points}</td><td>${s.mapDiff}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="6">No matches yet.</td></tr>'}
      </tbody></table></div>`;
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
      ${pending.length ? `<p class="muted">${pending.length} ${pending.length === 1 ? 'entry has' : 'entries have'} not paid and will be left out — <button type="button" class="linkish" data-go="players">confirm payments</button> first if that is wrong.</p>` : ''}
      ${confirmed.length ? `<p class="chips">${confirmed.map((e) => `<span class="chip named-handle">${esc(e.handle)}${classLabelHtml(e.ddlClass)}${medalsInlineHtml(badgesFor(e.handle, e.badges))}</span>`).join('')}</p>` : ''}
      ${t.rewardMode !== 'prize' ? `<div>
        <label for="lock-pot">Prize pot (USD)</label>
        <div class="host-money">
          <input id="lock-pot" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(Number(t.hostPotUsd) || 0)}" ${tip('House money for this arena. Added on top of paid entries. For a free list, this is the whole pot.')}>
          <button type="button" class="btn ghost" id="save-pot">Save pot</button>
        </div>
        <p class="hint">Shows on the public page as Pot. Paid entries add on top. You can still change this after lock.</p>
      </div>` : ''}
      <label class="check"><input type="checkbox" id="shuffle" ${shuffle ? 'checked' : ''}> Shuffle seeds for a random draw</label>
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
    const savePot = panel.querySelector('#save-pot');
    if (savePot) {
      savePot.onclick = () => hostAction(errEl, () => api.post(`/arenas/${encodeURIComponent(slug)}/settings`, {
        hostPassword,
        hostPotUsd: Number(panel.querySelector('#lock-pot').value || 0),
      }));
    }
    panel.querySelector('#lock-btn').onclick = () => {
      readLocal();
      hostAction(errEl, async () => {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/generate`, {
          hostPassword,
          shuffle,
          confirmSelected: false,
          checkInSelected: true,
          entryIds: data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow).map((e) => e.id),
          bestOf,
          finalsBestOf,
          roundBestOf,
          ...(panel.querySelector('#lock-break') ? { breakTies } : {}),
          hostPotUsd: Number(panel.querySelector('#lock-pot')?.value ?? t.hostPotUsd ?? 0),
        });
        tab = 'bracket';
        return next;
      });
    };
  }

  function paintBracket(panel, t) {
    if (t.status === 'registration') {
      paintPreLock(panel, t);
      return;
    }
    const kickChannel = kickChannelOf(t.streamUrl);
    const canShuffle = hostMode && t.status === 'in_progress' && !bracketHasPlay(data.matches);
    const field = fieldEntries(data.entries);
    const seats = editableSeats(t, data.matches, data.entries);
    const canEdit = hostMode && t.status !== 'registration';
    const rounds = hostRoundOptions(t, data.matches);
    if (!pairRound || !rounds.some((r) => r.key === pairRound)) pairRound = defaultPairRoundKey(rounds);
    const swapOpts = canEdit ? {
      hostEdit: true,
      swapPick: Boolean(swapPick),
      swapSelected: [swapA, swapB].filter(Boolean),
      pairSelected: [pairA, pairB].filter(Boolean),
    } : null;
    panel.innerHTML = `${hostMode ? `<p class="muted host-hint">Round should say Semi Finals. Pick DickTheDev and hofer, then press They play each other.</p>
      <div class="host-panel">
        <div class="host-flag">Host only</div>
        <p><strong>Shuffle bracket</strong></p>
        <p class="muted">${t.status !== 'in_progress'
          ? 'This arena is finished.'
          : canShuffle
            ? 'Redraws every matchup from a random seed order. This is blocked once any series has been reported.'
            : 'Shuffle is locked because a series has already been reported.'}</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="reshuffle-btn" ${canShuffle ? '' : 'disabled'}>Shuffle bracket</button>
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
        <p><strong>Kick livestream</strong></p>
        <p class="muted">${kickChannel
          ? `Viewers see kick.com/${esc(kickChannel)} on this bracket. They can watch here with audio or open Kick.`
          : 'Paste a Kick channel or livestream link. While this arena is live, the bracket shows an embedded player with audio, plus a button to open Kick.'}</p>
        <form class="row wrap" id="kick-form" style="gap:8px">
          <input id="kick-url" value="${esc(t.streamUrl || '')}" placeholder="https://kick.com/yourchannel" maxlength="200" aria-label="Kick stream URL">
          <button class="btn" type="submit">${kickChannel ? 'Update stream' : 'Show stream'}</button>
          ${kickChannel ? '<button class="btn ghost" type="button" id="kick-clear">Remove</button>' : ''}
        </form>
        <p class="err" id="kick-err" hidden></p>
      </div>` : ''}
      <div class="row wrap bracket-toolbar">
        <button class="btn ghost" type="button" id="export-rounds" ${tip('Copy or download this round’s scores as text, like Shock vs Dick 1/0.')}>Export round results</button>
      </div>
      ${bracketHtml(data, swapOpts)}`;
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
    if (exportBtn) exportBtn.onclick = () => openExportSheet(roundResultsText(data), slug);
    const reshuffleBtn = panel.querySelector('#reshuffle-btn');
    if (reshuffleBtn) {
      const reshuffleErr = panel.querySelector('#reshuffle-err');
      reshuffleBtn.onclick = () => {
        if (!window.confirm('Shuffle redraws every matchup from a random seed order. You can only do this before any series is reported. Continue?')) return;
        hostAction(reshuffleErr, () => api.post(`/arenas/${encodeURIComponent(slug)}/reshuffle`, { hostPassword }));
      };
    }
    bindSwapControls(panel);
    bindBracketViewport(panel);
    panel.querySelectorAll('[data-match]').forEach((btn) => {
      btn.onclick = () => {
        const match = data.matches.find((m) => String(m.id) === btn.getAttribute('data-match'));
        if (!match || !hostMode) return;
        if (match.status !== 'ready' && match.status !== 'complete') return;
        openScorecard(data, slug, match, (next) => {
          applyBracketLayoutFixes(next);
          data = next;
          paint();
        });
      };
    });
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
          <div class="who">${entryAvatarHtml(e)}${namedHandleHtml(e.handle, e.badges)}${classLabelHtml(e.ddlClass)}${badge(e.subbedIn ? 'confirmed' : e.noShow ? 'no_show' : 'pending')}</div>
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
  }

  function paintHostTools(panel, t) {
    const live = t.status !== 'registration';
    const field = fieldEntries(data.entries);
    const seats = editableSeats(t, data.matches, data.entries);
    const canEdit = t.status !== 'registration';
    const rounds = hostRoundOptions(t, data.matches);
    if (!pairRound || !rounds.some((r) => r.key === pairRound)) pairRound = defaultPairRoundKey(rounds);
    panel.innerHTML = `<div class="host-steps">
      <article>
        <div class="host-flag">Host only</div>
        <h3>Signed in as host</h3>
        <p class="muted">Confirm payments on the Players tab, lock the bracket from the Bracket tab, and report scores by tapping a match. Sign out to see this arena exactly as a visitor does.</p>
        <div class="row wrap">
          <button class="btn ghost" type="button" id="signout-btn">Sign out of host mode</button>
        </div>
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
        <form id="settings-form">${settingsFormHtml(t, { creating: false })}
          <p class="err" id="set-err" hidden></p>
          <div class="save-bar"><button class="btn" type="submit">Save options</button></div>
        </form>
      </article>
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
    document.getElementById('signout-btn').onclick = async () => {
      clearHostSession();
      tab = 'bracket';
      await reload();
      paint();
    };
    const settingsForm = document.getElementById('settings-form');
    bindSettingsChrome(settingsForm);
    settingsForm.onsubmit = (event) => {
      event.preventDefault();
      const setErr = document.getElementById('set-err');
      const payload = collectSettings(settingsForm);
      hostAction(setErr, async () => {
        const next = await api.post(`/arenas/${encodeURIComponent(slug)}/settings`, { ...payload, hostPassword });
        assertRewardsSaved(payload, next);
        hostSavedMsg = payload.rewardMode === 'prize'
          ? 'Prizes saved. The header now says Prizes instead of Pot.'
          : Number(payload.hostPotUsd) > 0
            ? 'Prize pot saved. The header shows this amount plus any paid entries.'
            : filledPayouts(payload).length
              ? 'Pot split saved. The header still shows the running pot; Payout lists the place breakdown.'
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
    <p class="form-kicker">DDL Tourney</p>
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
      if (!hostMode) return;
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
            if (okEl) {
              okEl.hidden = false;
              okEl.textContent = added || snaps
                ? `Restored ${added} arena${added === 1 ? '' : 's'} from records${snaps ? ' and rebuilt the DDNYC bracket' : ''}. Open Arenas to view them.`
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
      ${hostMode ? '<p class="muted">Host: Remove takes that name off titles. Real arenas become scrims. <a href="/tourney/#/ledger">Write the ledger</a>.</p>' : ''}
      <ol class="rank-list title-list">${champions.map((c, i) => `
        <li>
          <span class="place">${i + 1}</span>
          <div>${hostMode
            ? `<a class="named-handle" href="/tourney/#/player/${encodeURIComponent(c.handle)}">${namedHandleHtml(c.handle, c.badges)}</a>`
            : `<a class="named-handle" href="/tourney/#/player/${encodeURIComponent(c.handle)}">${namedHandleHtml(c.handle, c.badges)}</a>`}
            ${hostMode ? `<div class="hall-acts"><button type="button" class="mini bad" data-remove-champ="${esc(c.handle)}">Remove</button></div>` : ''}</div>
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
          ${hostMode ? `<div class="hall-acts"><button type="button" class="mini bad" data-del-mention="${m.id}">Remove</button></div>` : ''}`;
        return hostMode
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
          <p class="form-kicker">DDL Tourney</p>
          <h1>Records</h1>
          <p class="muted">Tournaments crown a field of three or more. Grand Tournaments are flagship IRL events. Duels are 1v1 series. Official finishes land here; scrims stay off the boards unless you ask to see them.</p>
          ${hostMode ? `<p class="muted">Host: titles can be removed from the Titles tab. If the arena list is empty, restore it from this ledger. <a href="/tourney/#/ledger">Write the ledger</a>.</p>
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
      ${hostMode ? '<p class="muted">Host: remove a mark that was pinned by mistake.</p>' : ''}
      ${medalsRowHtml(pack.badges, hostMode)}` : ''}
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
    if (hostMode) {
      root.querySelectorAll('[data-revoke]').forEach((btn) => {
        btn.onclick = async () => {
          if (!window.confirm('Remove this badge from this handle?')) return;
          try {
            const next = await api.post('/records/host', {
              hostPassword,
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
  if (!hostMode) {
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">Host only</p>
      <h1>The ledger</h1>
      <p class="muted">Sign in as host to write champions, leaderboards, badges, and honourable mentions.</p>
      <button class="btn" type="button" id="ledger-signin">Host sign in</button>
    </div>`;
    const btn = document.getElementById('ledger-signin');
    if (btn) btn.onclick = async () => { if (await openHostSignIn()) renderLedger(); };
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
      pack = await api.post('/records/host', { hostPassword, op, ...extra });
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
      <p class="form-kicker">DDL Tourney</p>
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

async function loadAwardIndex() {
  try {
    const pack = await api.get('/records/awards');
    ingestAwards(pack.awards);
  } catch (_err) {}
}

async function boot() {
  applyHostChrome();
  applyPlayerChrome();
  const toggle = document.getElementById('host-toggle');
  if (toggle) {
    toggle.onclick = async () => {
      if (hostMode) {
        clearHostSession();
        route();
        return;
      }
      if (await openHostSignIn()) route();
    };
  }
  const signout = document.getElementById('player-signout');
  if (signout) {
    signout.onclick = async () => {
      playerUser = null;
      applyPlayerChrome();
      try { await authApi.post('/logout', {}); } catch (_err) {}
      playerUser = null;
      applyPlayerChrome();
      route();
    };
  }
  initTips();
  initNav();
  window.addEventListener('hashchange', () => {
    applyPlayerChrome();
    route();
  });
  await Promise.all([loadPlayerSession(), loadAwardIndex()]);
  applyPlayerChrome();
  route();
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
  // A stored password from a previous tab is only trusted after the server agrees.
  if (hostMode && hostPassword) {
    try {
      await api.post('/host-auth', { hostPassword });
    } catch (_err) {
      clearHostSession();
      route();
    }
  }
}

boot();
