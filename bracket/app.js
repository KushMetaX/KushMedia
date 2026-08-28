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
  if (parts[0] === 't' && parts[1]) return arenaShareHref(parts[1]);
  if (parts[0] === 'player' && parts[1]) return `/tourney/#/player/${encodeURIComponent(parts[1])}`;
  if (parts[0] === 'records') return '/tourney/#/records';
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
      nameEl.textContent = playerUser.tourneyHandle || playerUser.discordUsername || 'Player';
      nameEl.href = playerUser.tourneyHandle ? `/tourney/#/player/${encodeURIComponent(playerUser.tourneyHandle)}` : '/tourney/#/records';
    } else {
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

function playerLink(handle) {
  const h = String(handle || '').trim();
  if (!h) return '—';
  return `<a href="/tourney/#/player/${encodeURIComponent(h)}">${esc(h)}</a>`;
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
  document.body.classList.toggle('has-tree', Boolean(on));
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

function formatTitle(t) {
  const key = t && t.format === 'double_elim' ? 'single_elim' : (t && t.format);
  const base = FORMAT_LABEL[key] || key || 'Tournament';
  const bits = [];
  if (t && t.stageType === 'two') bits.push('two stage');
  if (wantsLosers(t)) bits.push('losers bracket');
  return bits.length ? `${base} · ${bits.join(' · ')}` : base;
}

function formatBlurb(t) {
  const key = t && t.format === 'double_elim' ? 'single_elim' : (t && t.format);
  const base = FORMAT_LABEL[key] || key || 'bracket';
  if (!wantsLosers(t)) return `${base} bracket`;
  if (key === 'swiss' || key === 'round_robin') return `${base} with a losers-bracket playoff after standings`;
  return `${base} with a losers bracket`;
}

function nextPowerOfTwo(n) {
  if (n < 2) return 2;
  return 2 ** Math.ceil(Math.log2(n));
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

function expectedRounds(format, playerCount, swissRounds, losersBracket) {
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
  return rows;
}

function entryOf(entries, id) {
  return entries.find((e) => e.id === id) || null;
}

function bestOfSelect(id, value) {
  return `<select id="${esc(id)}" data-bestof>
    ${BEST_OF.map((n) => `<option value="${n}" ${Number(value) === n ? 'selected' : ''}>${esc(bestOfLabel(n))}</option>`).join('')}
  </select>`;
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

function groupRounds(matches, side) {
  const ofSide = matches.filter((m) => m.side === side);
  const max = ofSide.reduce((n, m) => Math.max(n, m.round), 0);
  const rounds = [];
  for (let r = 1; r <= max; r++) {
    const list = ofSide.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
    if (list.length) rounds.push(list);
  }
  return rounds;
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
      return `<li id="add-handle-opt-${i}" role="option" aria-selected="${i === active ? 'true' : 'false'}">
        ${pfpHtml(player, handle, 28)}
        <span class="handle-suggest-text"><strong>${esc(handle)}</strong>${sub}</span>
      </li>`;
    }).join('');
    listEl.querySelectorAll('li').forEach((li, i) => {
      li.onmousedown = (event) => {
        event.preventDefault();
        input.value = playerSuggestHandle(items[i]);
        hide();
        input.focus();
      };
    });
    const current = listEl.querySelector(`#add-handle-opt-${active}`);
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
      active = items.length ? 0 : -1;
      paintList();
    } catch (_err) {
      if (id !== seq) return;
      hide();
    }
  };

  input.addEventListener('input', () => {
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
      const handle = playerSuggestHandle(items[active]);
      if (handle) input.value = handle;
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
            <div><small class="muted">Organized by</small><div class="org-name">${esc(name)}</div></div>`;
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

function matchTip(match) {
  if (match.status === 'ready' && (match.games || []).length) {
    const running = `In progress ${match.score1 ?? 0}–${match.score2 ?? 0}.`;
    return hostMode ? `${running} Open the scorecard to finish and lock the series.` : running;
  }
  if (match.status === 'ready') {
    return hostMode ? 'Ready match. Open the scorecard and report each game.' : 'Ready to play — the host reports the result here.';
  }
  if (match.status === 'bye') return 'Bye — this player advances because the other slot is empty.';
  if (match.status === 'complete') return 'Series locked. Gold check marks the winner.';
  return 'Waiting for a player from the previous round.';
}

function matchCardHtml(match, entries, votes) {
  const p1 = entryOf(entries, match.entry1Id);
  const p2 = entryOf(entries, match.entry2Id);
  const clickable = match.status === 'ready' && hostMode;
  const empty = match.status === 'bye' ? 'BYE' : 'TBD';
  const v1 = (votes || []).filter((v) => v.matchId === match.id && v.winnerId === match.entry1Id).length;
  const v2 = (votes || []).filter((v) => v.matchId === match.id && v.winnerId === match.entry2Id).length;
  const slot = (entry, score, won, fallback) => `<div class="slot ${won ? 'winner' : ''}">
      ${entry ? `<em>${entry.seed || ''}</em>${avatarHtml(entry.handle)}<span class="who">${esc(entry.handle)}</span>` : `<span class="who tbd">${fallback}</span>`}
      <span class="pts">${score ?? ''}</span>
      <span class="mark">✓</span>
    </div>`;
  const live = match.status === 'ready' && (match.games || []).length > 0;
  return `<button type="button" class="match-card ${clickable ? 'ready' : ''} ${live ? 'live' : ''} ${match.status}" data-match="${match.id}" ${tip(matchTip(match))} ${clickable ? '' : 'disabled'}>
    ${slot(p1, match.score1, match.winnerId === match.entry1Id && match.status === 'complete', empty)}
    ${slot(p2, match.score2, match.winnerId === match.entry2Id && match.status === 'complete', empty)}
    ${v1 + v2 ? `<div class="votes">Votes ${v1}–${v2}</div>` : ''}
  </button>`;
}

function bracketColumnsHtml(matches, entries, side, format, votes) {
  const rounds = groupRounds(matches, side);
  if (!rounds.length) return '';
  const maxRound = rounds.length;
  return `<div class="bracket-board"><div class="bracket-tree" style="--slots:${rounds[0].length}">
    ${rounds.map((roundMatches, i) => {
      const next = rounds[i + 1];
      const feed = !next ? 'end' : (next.length === roundMatches.length ? 'line' : 'pair');
      const label = roundLabel(format, side, roundMatches[0].round, maxRound);
      const bo = bestOfLabel(roundMatches[0].bestOf);
      return `<div class="bracket-round feed-${feed}">
        <header ${tip(`${label} is ${bo}.`)}>
          <span>${esc(label)}</span>
          <span class="round-tag">${esc(bo)}</span>
        </header>
        <div class="bracket-slots">
          ${roundMatches.map((m) => `<div class="bracket-slot">
            <i class="in-line" aria-hidden="true"></i>
            ${matchCardHtml(m, entries, votes)}
            <i class="out-h" aria-hidden="true"></i>
            <i class="out-v" aria-hidden="true"></i>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

function bracketHtml(data) {
  const { tournament: t, entries, matches, votes } = data;
  if (!matches.length) return '';
  const treeMatches = matches.filter((m) => m.side === 'winners' || m.side === 'losers' || m.side === 'grand' || m.side === 'placement');
  const tree = treeMatches.length > 0 || t.format === 'single_elim' || t.format === 'double_elim' || t.stage === 'playoff';
  const playoffFormat = wantsLosers(t) ? 'double_elim' : 'single_elim';
  let body = '';
  const groups = [...new Set(matches.map((m) => m.group).filter(Boolean))];
  if (groups.length) {
    body += groups.map((g) => `
      <section class="bracket-section">
        <h2>Group ${g}</h2>
        <div class="grid cards">${matches.filter((m) => m.group === g).map((m) => matchCardHtml(m, entries, votes)).join('')}</div>
      </section>`).join('');
  }
  const groupSide = matches.filter((m) => m.side === 'group' && !m.group);
  if (groupSide.length) {
    body += groupRounds(groupSide, 'group').map((roundMatches) => `
      <section class="bracket-section">
        <h2>${esc(roundLabel(t.format, 'group', roundMatches[0].round, t.swissRounds))}
          <small>${esc(bestOfLabel(roundMatches[0].bestOf))}</small>
        </h2>
        <div class="grid cards">${roundMatches.map((m) => matchCardHtml(m, entries, votes)).join('')}</div>
      </section>`).join('');
  }
  if (tree && playoffFormat === 'double_elim' && matches.some((m) => m.side === 'losers' || m.side === 'grand')) {
    body += `<section class="bracket-section"><h2>Winners</h2>${bracketColumnsHtml(matches, entries, 'winners', playoffFormat, votes)}</section>
      <section class="bracket-section"><h2>Losers</h2>${bracketColumnsHtml(matches, entries, 'losers', playoffFormat, votes)}</section>
      <section class="bracket-section"><h2>Grand Final</h2>${bracketColumnsHtml(matches, entries, 'grand', playoffFormat, votes)}</section>`;
  } else if (tree && treeMatches.length) {
    body += bracketColumnsHtml(matches.filter((m) => !m.group && m.side !== 'group'), entries, 'winners', playoffFormat, votes);
    if (matches.some((m) => m.side === 'placement')) {
      body += `<section class="bracket-section"><h2>3rd place</h2>${bracketColumnsHtml(matches, entries, 'placement', playoffFormat, votes)}</section>`;
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

function roundRulesHtml(format, count, swissRounds, bestOf, roundBestOf, losersBracket) {
  const rows = expectedRounds(format, count, swissRounds, losersBracket);
  if (!rows.length) return '';
  return `<div class="round-rules">
    ${rows.map((row) => {
      const key = roundKey(row.side, row.round);
      const value = (roundBestOf && roundBestOf[key]) || bestOf || 3;
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
    hostName: d.hostName || (playerUser && (playerUser.tourneyHandle || playerUser.discordUsername)) || 'KushMetaX',
    name: d.name || '',
    slug: d.slug || '',
    description: d.description || '',
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
              <div><small class="muted">Organized by</small><div class="org-name">${esc(playerUser.tourneyHandle || playerUser.discordUsername || d.hostName)}</div></div>
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
          <textarea id="s-desc" maxlength="2000" ${tip('Rules, prize split, stream link. Players see this under the title.')}>${esc(d.description)}</textarea></div>
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
              : 'Paid entries fill the pot. Set a percent per place to show how it splits. Leave percents blank to show only the running total, like today.'}</p>
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
          <div class="choice" ${tip('Single stage is one bracket. Two stage runs groups first, then a playoff.')}>
            ${radio('s-stage', 'single', d.stageType !== 'two', 'Single stage tournament')}
            ${radio('s-stage', 'two', d.stageType === 'two', 'Two stage tournament — groups compete separately, winners proceed to a final stage.')}
          </div>
        </div>
        <div class="form-row two-only"><label for="s-group">Group size</label>
          <input id="s-group" type="number" min="2" max="16" value="${d.groupSize}"></div>
        <div class="form-row two-only"><label for="s-advance">Advance per group</label>
          <input id="s-advance" type="number" min="1" max="8" value="${d.advancePerGroup}"></div>
        <div class="form-row"><label for="s-format">Format <span class="req">*</span></label>
          <div><select id="s-format" ${tip('Single elim is a knockout tree. Swiss and round robin use standings. Losers bracket is a separate switch.')}>
            <option value="single_elim" ${d.format === 'single_elim' || d.format === 'double_elim' ? 'selected' : ''}>Single Elimination</option>
            <option value="round_robin" ${d.format === 'round_robin' ? 'selected' : ''}>Round Robin</option>
            <option value="swiss" ${d.format === 'swiss' ? 'selected' : ''}>Swiss</option>
          </select>
          <label class="check"><input type="checkbox" id="s-losers" ${d.losersBracket ? 'checked' : ''}> Losers bracket</label>
          <p class="hint" id="s-losers-hint">One loss drops a player into a losers bracket instead of eliminating them. On Swiss and round robin this seeds a double-elim playoff after standings.</p>
          <label class="check" id="s-break-row"><input type="checkbox" id="s-break" ${d.breakTies && !d.losersBracket ? 'checked' : ''}> Break ties with a 3rd place match</label></div>
        </div>
        <div class="form-row"><label for="s-bestof">Default series</label>${bestOfSelect('s-bestof', d.bestOf)}</div>
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
        <div class="form-row"><span class="lbl">Whitelist</span>
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
  const losers = form.querySelector('#s-losers');
  const breakRow = form.querySelector('#s-break-row');
  const losersHint = form.querySelector('#s-losers-hint');
  const formatSel = form.querySelector('#s-format');
  const losersSync = () => {
    const on = Boolean(losers && losers.checked);
    if (breakRow) breakRow.style.display = on ? 'none' : '';
    if (losersHint && formatSel) {
      const fmt = formatSel.value;
      losersHint.textContent = fmt === 'swiss' || fmt === 'round_robin'
        ? 'After standings, the field is seeded into a winners / losers / grand-final playoff.'
        : 'One loss drops a player into a losers bracket. Two losses and they are out. Grand final crowns the pack.';
    }
  };
  if (losers) losers.onchange = losersSync;
  if (formatSel) formatSel.onchange = losersSync;
  losersSync();
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
        : 'Paid entries fill the pot. Set a percent per place to show how it splits. Leave percents blank to show only the running total, like today.';
    }
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
    game: form.querySelector('#s-game')?.value,
    stageType: form.querySelector('input[name="s-stage"]:checked')?.value,
    format: form.querySelector('#s-format')?.value,
    losersBracket: form.querySelector('#s-losers')?.checked,
    playoffFormat: form.querySelector('#s-losers')?.checked ? 'double_elim' : 'single_elim',
    breakTies: form.querySelector('#s-losers')?.checked ? false : form.querySelector('#s-break')?.checked,
    registrationMode: form.querySelector('input[name="s-reg"]:checked')?.value === 'list' ? 'list' : 'signup',
    whitelistSpots: form.querySelector('#s-wl')?.checked ? Number(form.querySelector('#s-wl-spots')?.value || 2) : 0,
    feeMode,
    entryFeeUsd: usd,
    rewardMode,
    payouts,
    requireTeams: form.querySelector('#s-teams')?.checked,
    capPlayers: form.querySelector('#s-cap')?.checked,
    maxPlayers: Number(form.querySelector('#s-max')?.value || 16),
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
  const parts = routeParts();
  if (parts[0] === 'create') return renderCreate();
  if (parts[0] === 'records') return renderRecords();
  if (parts[0] === 'player' && parts[1]) return renderPlayer(parts[1]);
  if (parts[0] === 't' && parts[1]) return renderArena(parts[1]);
  return renderHome();
}

const HERO = `<section class="hero">
  <img src="/bracket/crest.jpg" alt="">
  <p class="muted" style="letter-spacing:.4em;text-transform:uppercase;font-family:Cinzel,serif;font-size:11px;color:var(--primary)">Doginal Dogs Legends</p>
  <h1>Legends Bracket</h1>
  <p>Pick an arena, sign in with Discord, and send the entry if there is one. The host confirms payments and runs the bracket. Wins are stored as records you can carry into a grand tournament.</p>
</section>`;

async function renderHome() {
  setTreeMode(false);
  root.innerHTML = `${HERO}<p class="muted">Loading arenas…</p>`;
  try {
    const arenas = await api.get('/arenas');
    root.innerHTML = `${HERO}
    <p class="muted"><a href="/tourney/#/records">Hall of records</a> — champions, accolades, and past results.</p>
    <h2>Tournaments</h2>
    <div class="grid cards">${arenas.map((t) => `
      <a class="card" href="${arenaHref(t.slug)}">
        <div class="row"><h3>${esc(t.name)}</h3>${badge(t.status)}</div>
        <p class="muted">${esc(formatTitle(t))} · ${feeUsd(t) > 0 ? `${formatUsd(feeUsd(t))} entry` : 'Free entry'}</p>
        <p class="muted">${t.paidCount}${t.capPlayers !== false ? ` / ${t.maxPlayers}` : ''} players in${hostMode && Math.max(0, (t.entryCount || 0) - t.paidCount) ? ` · ${Math.max(0, (t.entryCount || 0) - t.paidCount)} awaiting payment` : ''}</p>
        ${rewardCardHtml(t)}
        ${t.status === 'completed' && t.champion && t.champion.handle ? `<p class="muted">Champion: ${esc(t.champion.handle)}</p>` : ''}
      </a>`).join('') || '<p class="muted">No tournaments yet.</p>'}</div>
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
      location.hash = `#/t/${t.slug}`;
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
          <p class="muted">${esc(bestOfLabel(bestOf))} · first to ${need}</p>
          <h2>${esc(p1?.handle || 'TBD')} vs ${esc(p2?.handle || 'TBD')}</h2>
        </div>
        <button type="button" class="copy" id="sc-close">Close</button>
      </div>
      <label>This round
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
      </div>
      <p class="series">${s1} — ${s2}</p>
      <p class="muted">${done
        ? `${esc((s1 > s2 ? p1 : p2)?.handle || 'Winner')} wins the series — lock it to advance them.`
        : `Tap each game as it finishes. Locking needs a series winner: ${need - Math.max(s1, s2)} more game${need - Math.max(s1, s2) === 1 ? '' : 's'}.`}</p>
      <p class="err" id="sc-err" hidden></p>
      <div class="sc-actions">
        <button class="btn ghost" type="button" id="sc-save" ${games.length ? '' : 'disabled'} ${tip('Save game wins so far. The match stays open and the bracket keeps the running score.')}>Save progress</button>
        <button class="btn" type="button" id="sc-lock" ${done ? '' : 'disabled'} ${tip('Locks the series and advances the winner.')}>Lock series</button>
      </div>
    </div>`;
    overlay.querySelector('#sc-close').onclick = () => overlay.remove();
    overlay.querySelector('#sc-bestof').onchange = (event) => {
      bestOf = Number(event.target.value);
      games.length = 0;
      paintCard();
    };
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
        const next = await api.post(`/arenas/${slug}/${path}`, {
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
    overlay.querySelector('#sc-save').onclick = () => send('games');
    overlay.querySelector('#sc-lock').onclick = () => send('report');
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
  root.innerHTML = `<p class="muted">Loading ${esc(slug)}…</p>`;
  let data;
  try {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
  } catch (err) {
    root.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }

  const openForSignup = () => data.tournament.status === 'registration' && data.tournament.registrationMode !== 'list';
  let tab = openForSignup() && !hostMode ? 'enter' : 'bracket';
  let quoteTimer = 0;
  let shuffle = false;
  let hostSavedMsg = '';
  let bestOf = BEST_OF.includes(Number(data.tournament.bestOf)) ? Number(data.tournament.bestOf) : 3;
  let roundBestOf = { ...(data.tournament.roundBestOf || {}) };

  const reload = async () => {
    data = await api.get(`/arenas/${encodeURIComponent(slug)}`);
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
      if (next && next.tournament) data = next;
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
    const podium = data.podium && t.status === 'completed' && data.podium.first ? `
      <section class="podium" ${tip('Final results. 3rd place uses the placement match when that option is on.')}>
        <article class="place gold"><div class="rank">1st</div><strong>${playerLink(data.podium.first.handle)}</strong><p class="muted">${esc(data.podium.first.record || '')}</p>${prizeForPlace(rewards, 1) ? `<p class="prize-won">${esc(prizeForPlace(rewards, 1))}</p>` : ''}</article>
        <article class="place"><div class="rank">2nd</div><strong>${data.podium.second?.handle ? playerLink(data.podium.second.handle) : '—'}</strong><p class="muted">${esc(data.podium.second?.record || '')}</p>${prizeForPlace(rewards, 2) ? `<p class="prize-won">${esc(prizeForPlace(rewards, 2))}</p>` : ''}</article>
        <article class="place"><div class="rank">3rd</div>${(data.podium.third || []).map((p) => `<strong>${playerLink(p.handle)}</strong>`).join('<br>') || '—'}${prizeForPlace(rewards, 3) ? `<p class="prize-won">${esc(prizeForPlace(rewards, 3))}</p>` : ''}</article>
      </section>` : '';
    root.innerHTML = `<div class="arena-shell">
      <nav class="arena-nav">
        ${nav.map(([id, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''} ${id === 'host' ? 'is-host' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div>
        <header class="arena-head">
          <div>
            <p class="form-kicker">${esc(t.game || 'Doginal Dogs Legends TCG')}</p>
            <h1>${esc(t.name)} ${badge(t.status)}</h1>
            <p class="share-line">
              <span class="mono muted">${esc(location.origin)}${arenaShareHref(slug)}</span>
              <button type="button" class="copy" data-copy="${esc(`${location.origin}${arenaShareHref(slug)}`)}" ${tip('Share this link on X. The preview title is this tournament name.')}>Copy link</button>
            </p>
            <dl class="meta">
              <div><dt>Players</dt><dd>${confirmed.length}${t.capPlayers !== false ? ` / ${t.maxPlayers}` : ''}</dd></div>
              <div><dt>Format</dt><dd>${esc(formatTitle(t))}</dd></div>
              <div><dt>Entry</dt><dd>${feeUsd(t) > 0 ? `${formatUsd(feeUsd(t))} USD` : 'Free'}</dd></div>
              <div><dt>Start</dt><dd>${esc(start)}</dd></div>
              ${rewardMetaHtml(rewards)}
            </dl>
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
      ${t.requireVerifiedEmail ? `<div><label for="email">Email</label><input id="email" type="email" required></div>` : ''}
      ${t.countryLock ? `<div><label for="country">Country</label><input id="country" required placeholder="${esc(t.allowedCountries || 'Country')}"></div>` : ''}
      ${usd > 0 ? `<p class="quote" id="live-quote">Loading live ${formatUsd(usd)} DOGE quote…</p>
        <div><label for="from-wallet">DOGE wallet you sent from</label><input id="from-wallet" required minlength="8" maxlength="64"></div>` : ''}
      <p class="err" id="enter-err" hidden></p>
      <div class="ok" id="enter-ok" hidden></div>
      <button class="btn" type="submit">Register</button>
    </form>`;
    bindCopy(panel);
    const quoteEl = document.getElementById('live-quote');
    const refreshQuote = async () => {
      if (!quoteEl) return;
      try {
        const q = await api.get(`/quote?usd=${encodeURIComponent(usd)}`);
        quoteEl.innerHTML = `Send exactly <strong>${esc(formatCrypto('DOGE', q.DOGE))}</strong> for <strong>${esc(formatUsd(q.usd))}</strong><br><span class="muted">DOGE is ${esc(formatUsd(q.dogeUsd))} right now. Quote refreshes live. Need DOGE? <a href="${esc(K9SWAP_URL)}" target="_blank" rel="noopener noreferrer">Swap on K9SWAP</a>.</span>`;
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
        const entry = await api.post(`/arenas/${slug}/enter`, {
          handle: document.getElementById('handle').value,
          team: document.getElementById('team')?.value,
          email: document.getElementById('email')?.value,
          country: document.getElementById('country')?.value,
          fromWallet: document.getElementById('from-wallet')?.value || 'FREE-ENTRY',
          payAsset: 'DOGE',
        });
        window.clearInterval(quoteTimer);
        form.querySelector('button[type="submit"]').disabled = true;
        okEl.hidden = false;
        okEl.innerHTML = usd > 0
          ? `<strong>${esc(entry.handle)}</strong> is registered and waiting on payment.<br>
             Send <strong>${esc(formatCrypto(entry.payAsset, entry.amountCrypto))}</strong> (${esc(formatUsd(entry.amountUsd))} at ${esc(formatUsd(entry.usdPerCoin))}/${esc(entry.payAsset)}).<br>
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

    const row = (e) => {
      const details = [];
      if (hostMode) {
        if (paidFee && !e.paid) details.push(`<span>Should have sent <strong>${esc(formatCrypto(e.payAsset || 'DOGE', e.amountCrypto))}</strong> (${esc(formatUsd(e.amountUsd))})</span>`);
        if (e.fromWallet) details.push(`<span>From <code class="mono">${esc(e.fromWallet)}</code></span>`);
        if (e.invoiceCode && !e.addedByHost) details.push(`<span>Invoice <code class="mono">${esc(e.invoiceCode)}</code></span>`);
        if (e.email) details.push(`<span>${esc(e.email)}</span>`);
        if (e.addedByHost) details.push('<span>Added by you</span>');
      }
      return `<div class="roster-row ${e.paid ? '' : 'is-pending'}">
        <div class="who">${avatarHtml(e.handle)}<strong>${esc(e.handle)}</strong>${badge(e.noShow ? 'no_show' : e.paid ? 'confirmed' : 'pending')}</div>
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
      ${canEdit ? `<div class="host-panel" style="margin-top:16px">
        <div class="host-flag">Host only</div>
        <p><strong>Add a player yourself</strong></p>
        <p class="muted">${t.registrationMode === 'list' ? 'This arena has no public sign-up, so add every participant here.' : 'For walk-ins or anyone who paid you another way. Added players count as confirmed.'}</p>
        <form class="row wrap" id="add-form" style="gap:8px">
          <div class="handle-typeahead">
            <input id="add-handle" placeholder="${t.requireTeams ? 'Team name' : 'Start typing a handle'}" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="add-handle-list" aria-expanded="false">
            <ul id="add-handle-list" class="handle-suggest" hidden role="listbox"></ul>
          </div>
          <button class="btn ghost" type="submit">Add</button>
        </form>
        <p class="hint">Discord-connected handles appear as you type. You can still add a walk-in name that is not in the list.</p>
      </div>` : ''}`;

    const errEl = panel.querySelector('#players-err');
    const confirmAll = panel.querySelector('#confirm-all');
    if (confirmAll) confirmAll.onclick = () => hostAction(errEl, () => api.post(`/arenas/${slug}/confirm`, {
      hostPassword,
      entryIds: pending.map((e) => e.id),
    }));
    panel.querySelectorAll('[data-confirm]').forEach((btn) => {
      btn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${slug}/confirm`, {
        hostPassword,
        entryIds: [Number(btn.getAttribute('data-confirm'))],
      }));
    });
    panel.querySelectorAll('[data-unconfirm]').forEach((btn) => {
      btn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${slug}/confirm`, {
        hostPassword,
        entryIds: [Number(btn.getAttribute('data-unconfirm'))],
        paid: false,
      }));
    });
    panel.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this entry from the arena?')) return;
        hostAction(errEl, () => api.post(`/arenas/${slug}/remove-entry`, {
          hostPassword,
          entryId: Number(btn.getAttribute('data-remove')),
        }));
      };
    });
    const addForm = panel.querySelector('#add-form');
    if (addForm) {
      bindHandleTypeahead(
        panel.querySelector('#add-handle'),
        panel.querySelector('#add-handle-list'),
        data.entries.map((e) => e.handle),
      );
      addForm.onsubmit = (event) => {
        event.preventDefault();
        const handle = panel.querySelector('#add-handle').value;
        hostAction(errEl, () => api.post(`/arenas/${slug}/add-entry`, { hostPassword, handle }));
      };
    }
  }

  function paintStandings(panel) {
    const rows = data.standings || [];
    panel.innerHTML = `<h2>Standings</h2>
      <table><thead><tr><th>#</th><th>Handle</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th></tr></thead><tbody>
      ${rows.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.handle)}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.points}</td><td>${s.mapDiff}</td></tr>`).join('') || '<tr><td colspan="6">No matches yet.</td></tr>'}
      </tbody></table>`;
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
        return `<li>${esc(e?.handle || id)} — ${n}</li>`;
      }).join('') || '<li class="muted">No picks yet.</li>'}</ul>`;
    document.getElementById('pred-form').onsubmit = async (event) => {
      event.preventDefault();
      try {
        data = await api.post(`/arenas/${slug}/predict`, {
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
    panel.innerHTML = `<div class="host-panel">
      <div class="host-flag">Host only</div>
      <p><strong>Lock the bracket</strong></p>
      <p class="muted">${ready
        ? `${confirmed.length} confirmed ${confirmed.length === 1 ? 'player' : 'players'} will be seeded into a ${esc(formatBlurb(t))}. Locking closes registration.`
        : `You need at least 2 confirmed players. ${confirmed.length} so far.`}</p>
      ${pending.length ? `<p class="muted">${pending.length} ${pending.length === 1 ? 'entry has' : 'entries have'} not paid and will be left out — <button type="button" class="linkish" data-go="players">confirm payments</button> first if that is wrong.</p>` : ''}
      ${confirmed.length ? `<p class="chips">${confirmed.map((e) => `<span class="chip">${esc(e.handle)}</span>`).join('')}</p>` : ''}
      <label class="check"><input type="checkbox" id="shuffle" ${shuffle ? 'checked' : ''}> Shuffle seeds for a random draw</label>
      <div style="max-width:16rem"><label for="lock-bestof">Series length</label>${bestOfSelect('lock-bestof', bestOf)}</div>
      <details class="advanced">
        <summary>Different series length per round</summary>
        ${roundRulesHtml(t.format, Math.max(2, confirmed.length), t.swissRounds, bestOf, roundBestOf, wantsLosers(t))}
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
      roundBestOf = readRoundBestOf(panel);
    };
    panel.querySelector('#lock-bestof').onchange = () => {
      readLocal();
      paint();
    };
    panel.querySelector('#shuffle').onchange = readLocal;
    panel.querySelectorAll('[data-round-bestof]').forEach((el) => { el.onchange = readLocal; });
    panel.querySelector('#lock-btn').onclick = () => {
      readLocal();
      hostAction(errEl, async () => {
        const next = await api.post(`/arenas/${slug}/generate`, {
          hostPassword,
          shuffle,
          confirmSelected: false,
          checkInSelected: true,
          entryIds: data.entries.filter((e) => e.paid && !e.whitelist && !e.noShow).map((e) => e.id),
          bestOf,
          roundBestOf,
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
    panel.innerHTML = `${hostMode ? `<p class="muted host-hint">Host mode: tap any glowing match to report games and lock the series.${Number(t.whitelistSpots) > 0 ? ' First-round no-shows go on the Whitelist tab.' : ''}</p>` : ''}
      <div class="row wrap bracket-toolbar">
        <button class="btn ghost" type="button" id="export-rounds" ${tip('Copy or download this round’s scores as text, like Shock vs Dick 1/0.')}>Export round results</button>
      </div>
      ${bracketHtml(data)}`;
    const exportBtn = panel.querySelector('#export-rounds');
    if (exportBtn) exportBtn.onclick = () => openExportSheet(roundResultsText(data), slug);
    panel.querySelectorAll('[data-match]').forEach((btn) => {
      btn.onclick = () => {
        const match = data.matches.find((m) => String(m.id) === btn.getAttribute('data-match'));
        if (!match || match.status !== 'ready' || !hostMode) return;
        openScorecard(data, slug, match, (next) => {
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
    const opening = (data.matches || []).filter((m) => isOpeningMatch(t, m) && m.status === 'ready');
    const slotOptions = opening.flatMap((m) => {
      const p1 = entryOf(data.entries, m.entry1Id);
      const p2 = entryOf(data.entries, m.entry2Id);
      const rows = [];
      if (p1) rows.push({ value: `${m.id}:1`, label: `${p1.handle} vs ${p2?.handle || 'TBD'} — replace ${p1.handle}` });
      if (p2) rows.push({ value: `${m.id}:2`, label: `${p1?.handle || 'TBD'} vs ${p2.handle} — replace ${p2.handle}` });
      return rows;
    });
    panel.innerHTML = `
      <h2>Whitelist</h2>
      <p class="muted">${spots
        ? `${list.length} of ${spots} substitute spot${spots === 1 ? '' : 's'} filled. These names stay off the bracket until you drop one into a first-round match for a no-show.`
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
          <div class="who">${avatarHtml(e.handle)}<strong>${esc(e.handle)}</strong>${badge(e.subbedIn ? 'confirmed' : e.noShow ? 'no_show' : 'pending')}</div>
          <span class="muted">${esc(state)}</span>
          ${hostMode && !e.subbedIn && !e.noShow ? `<div class="roster-acts">
            <button type="button" class="mini bad" data-wl-remove="${e.id}">Remove</button>
          </div>` : ''}
        </div>`;
      }).join('') || '<p class="muted">No whitelist players yet.</p>'}</div>
      ${hostMode && list.length < spots ? `<div class="host-panel" style="margin-top:16px">
        <div class="host-flag">Host only</div>
        <p><strong>Add a substitute</strong></p>
        <p class="muted">${live ? 'They sit on deck until you put them in a first-round match.' : 'They will not be seeded when you lock the bracket.'}</p>
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
        <p><strong>Replace a first-round no-show</strong></p>
        <p class="muted">Pick the missing player and the substitute. The series resets if any games were already entered.</p>
        ${slotOptions.length && (unused.length || list.length < spots) ? `<form class="stack" id="wl-sub-form">
          <div><label for="wl-slot">Replace</label>
            <select id="wl-slot">${slotOptions.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>
          </div>
          ${unused.length ? `<div><label for="wl-entry">With whitelist player</label>
            <select id="wl-entry">${unused.map((e) => `<option value="${e.id}">${esc(e.handle)}</option>`).join('')}</select>
          </div>` : `<div><label for="wl-new">With handle</label>
            <input id="wl-new" required minlength="2" maxlength="24" placeholder="Substitute handle">
          </div>`}
          <p class="err" id="wl-sub-err" hidden></p>
          <button class="btn" type="submit">Put them in round 1</button>
        </form>` : `<p class="muted">${!opening.length ? 'No open first-round matches left to fill.' : list.length >= spots && !unused.length ? 'Every whitelist spot is already used.' : 'Add a whitelist player first.'}</p>`}
      </div>` : ''}
      <p class="err" id="wl-err" hidden></p>`;

    const errEl = panel.querySelector('#wl-err');
    const spotsForm = panel.querySelector('#wl-spots-form');
    if (spotsForm) spotsForm.onsubmit = (event) => {
      event.preventDefault();
      const spotsErr = panel.querySelector('#wl-spots-err');
      hostAction(spotsErr, () => api.post(`/arenas/${slug}/settings`, {
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
        const handle = panel.querySelector('#wl-handle').value;
        hostAction(addErr, () => api.post(`/arenas/${slug}/add-entry`, { hostPassword, handle, whitelist: true }));
      };
    }
    panel.querySelectorAll('[data-wl-remove]').forEach((btn) => {
      btn.onclick = () => {
        if (!window.confirm('Remove this whitelist player?')) return;
        hostAction(errEl, () => api.post(`/arenas/${slug}/remove-entry`, {
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
      hostAction(subErr, () => api.post(`/arenas/${slug}/sub-round1`, {
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
        <h3>Series length per round</h3>
        <p class="muted">Applies to matches that have not been locked yet.</p>
        ${roundRulesHtml(t.format, Math.max(2, data.entries.filter((e) => e.paid).length), t.swissRounds, t.bestOf, t.roundBestOf, wantsLosers(t))}
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
        const next = await api.post(`/arenas/${slug}/settings`, { ...payload, hostPassword });
        assertRewardsSaved(payload, next);
        hostSavedMsg = payload.rewardMode === 'prize'
          ? 'Prizes saved. The header now says Prizes instead of Pot.'
          : filledPayouts(payload).length
            ? 'Pot split saved. The header still shows the running pot; Payout lists the place breakdown.'
            : 'Options saved.';
        return next;
      });
    };
    const rulesBtn = document.getElementById('rules-btn');
    if (rulesBtn) rulesBtn.onclick = () => hostAction(errEl, () => api.post(`/arenas/${slug}/round-rules`, {
      hostPassword,
      bestOf: t.bestOf,
      roundBestOf: readRoundBestOf(panel),
    }));
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
            const next = await api.post(`/arenas/${slug}/add-entry`, { hostPassword, handle });
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
        `/arenas/${slug}/claims/${btn.getAttribute('data-claim')}/resolve`,
        { hostPassword, approve: btn.getAttribute('data-approve') === '1' },
      ));
    });
  }

  paint();
}

async function renderRecords() {
  setTreeMode(false);
  root.innerHTML = `<div class="form-page">
    <p class="form-kicker">DDL Tourney</p>
    <h1>Hall of records</h1>
    <p class="muted">Official arenas with at least four confirmed players count toward accolades. Sign in with Discord so your finishes stick to one handle.</p>
    <p class="muted">Loading…</p>
  </div>`;
  try {
    const pack = await api.get('/records');
    const events = pack.events || [];
    const champions = pack.champions || [];
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">DDL Tourney</p>
      <h1>Hall of records</h1>
      <p class="muted">Official results across every completed arena. Use these names when you seed a grand tournament.</p>
      ${pack.warning ? `<p class="err">${esc(pack.warning)}</p>` : ''}
      <h2>Champions</h2>
      <div class="grid cards">${champions.map((c) => `
        <a class="card" href="/tourney/#/player/${encodeURIComponent(c.handle)}">
          <div class="row"><h3>${esc(c.handle)}</h3><span class="badge ok">${c.titles} title${c.titles === 1 ? '' : 's'}</span></div>
        </a>`).join('') || '<p class="muted">No official champions yet.</p>'}</div>
      <h2>Recent arenas</h2>
      <div class="grid cards">${events.map((e) => `
        <a class="card" href="${arenaHref(e.slug)}">
          <div class="row"><h3>${esc(e.name)}</h3>${e.official ? '<span class="badge ok">Official</span>' : '<span class="badge">Scrim</span>'}</div>
          <p class="muted">${esc(FORMAT_LABEL[e.format] || e.format)} · ${e.fieldSize} players</p>
          <p class="muted">${e.champion && e.champion.handle ? `Champion: ${esc(e.champion.handle)}` : 'No champion recorded'}</p>
        </a>`).join('') || '<p class="muted">No completed arenas on the ledger yet.</p>'}</div>
    </div>`;
  } catch (err) {
    root.innerHTML = `<div class="form-page"><h1>Hall of records</h1><p class="err">${esc(err.message)}</p></div>`;
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
    const place = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : 'Played');
    root.innerHTML = `<div class="form-page">
      <p class="form-kicker">Player</p>
      <div class="organizer" style="margin-bottom:16px">
        ${pfpHtml(pack.user, pack.handle, 48)}
        <div>
          <h1 style="margin:0">${esc(pack.handle)}</h1>
          <p class="muted">${pack.titles} title${pack.titles === 1 ? '' : 's'} · ${pack.appearances} official appearance${pack.appearances === 1 ? '' : 's'}</p>
        </div>
      </div>
      <h2>Accolades</h2>
      <div class="chips">${(pack.accolades || []).map((a) => `<span class="chip" title="${esc(a.blurb)}">${esc(a.title)}</span>`).join('') || '<p class="muted">No official accolades yet.</p>'}</div>
      <h2>Results</h2>
      <table><thead><tr><th>Arena</th><th>Format</th><th>Place</th><th>Record</th></tr></thead>
      <tbody>${(pack.results || []).map((r) => `
        <tr>
          <td><a href="${arenaHref(r.slug)}">${esc(r.name)}</a>${r.official ? '' : ' <span class="muted">scrim</span>'}</td>
          <td>${esc(FORMAT_LABEL[r.format] || r.format)}</td>
          <td>${place(r.placement)}</td>
          <td>${esc(r.record || '')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No results on the ledger.</td></tr>'}</tbody></table>
      ${unclaimed.length ? `<h2>Claim a walk-in result</h2>
        <p class="muted">These finishes used your handle but were not linked to Discord. Ask the host to approve.</p>
        ${unclaimed.map((r) => `<div class="roster-row">
          <div class="who"><strong>${esc(r.name)}</strong><span class="muted">${place(r.placement)}</span></div>
          <button type="button" class="mini go" data-claim-entry="${r.entryId}" data-claim-t="${r.tournamentId}">Claim</button>
        </div>`).join('')}
        <p class="err" id="claim-self-err" hidden></p>
        <p class="ok" id="claim-self-ok" hidden></p>` : ''}
    </div>`;
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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

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
  await loadPlayerSession();
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
