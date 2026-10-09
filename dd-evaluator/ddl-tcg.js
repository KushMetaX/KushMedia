/**
 * DDL TCG price evaluator: mode switch, eBay-backed card prices, checklist,
 * collection value, and a camera scanner that reuses the IRL table art fingerprints.
 */
(function () {
  'use strict';

  const CHECK = window.DDL_CHECKLIST;
  if (!CHECK || !document.getElementById('ddlEval')) return;

  const MODE_KEY = 'eval-mode-v1';
  const COLLECTION_KEY = 'ddl-collection-v1';
  const WANTS_KEY = 'ddl-wants-v1';
  const SYNC_KEY = 'ddl-collection-sync-v1';
  const AUTO_KEY = 'ddl-scan-auto';
  const CAMERA_KEY = 'ddl-scan-camera';
  const API_BASES = ['/api/ddl-market', '/dd-evaluator/ddl-market'];
  const ACCOUNT_BASES = ['/dd-evaluator/ddl-collection', '/api/ddl-collection'];
  const AUTH_BASES = ['/dd-evaluator/auth', '/kmx-auth', '/kk-auth'];
  const EVAL_RETURN = '/dd-evaluator/#ddl-tcg';
  const SCAN_SCRIPTS = [
    '/bracket/ddl-prints.js?v=ddl-eval-2',
    '/bracket/ddl-name-prints.js?v=ddl-eval-5',
    '/bracket/irl-watch.js?v=ddl-eval-8',
  ];
  const PRINT_LABEL = CHECK.printLabels;
  const GRADES = ['AGS 10', 'AGS 9.5', 'AGS 9', 'AGS 8.5', 'AGS 8', 'AGS 7', 'AGS 6', 'AGS 5'];
  const GRADE_CURVE = [[10, 3.0], [9.5, 2.2], [9, 1.6], [8.5, 1.35], [8, 1.2], [7, 1.0], [0, 0.85]];
  const COMPANY_FACTOR = { AGS: 1, PSA: 1, BGS: 1, CGC: 0.8, SGC: 0.75 };
  const GROUP_KEY = 'ddl-group-v1';

  const $ = (id) => document.getElementById(id);
  const byId = new Map(CHECK.cards.map((c) => [c.id, c]));

  let market = null;
  let apiBase = API_BASES[0];
  let collection = loadCollection();
  let wants = loadWants();
  /** state: loading | guest | signed-in | offline */
  const account = {
    state: 'loading', me: null, base: ACCOUNT_BASES[0], discord: true,
    timer: 0, wantTimer: 0, saving: false, savingWants: false, savedAt: null, error: '',
  };
  let collectorData = null;
  let collectorMode = 'have';
  const community = { tab: 'collections', collectors: null, searching: null, error: '', loading: false };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function money(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const digits = n < 10 ? 2 : 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function ago(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins === 0) return 'just now';
    if (Math.abs(mins) < 60) return mins >= 0 ? `${mins}m ago` : `in ${-mins}m`;
    const hrs = Math.round(mins / 60);
    if (Math.abs(hrs) < 48) return hrs >= 0 ? `${hrs}h ago` : `in ${-hrs}h`;
    const days = Math.round(hrs / 24);
    return days >= 0 ? `${days}d ago` : `in ${-days}d`;
  }

  function gradeMultiplier(key) {
    if (market && market.gradeMultipliers && market.gradeMultipliers[key] != null) return market.gradeMultipliers[key];
    const m = String(key || '').match(/^(AGS|PSA|BGS|CGC|SGC) (\d+(?:\.5)?)$/);
    if (!m) return 1;
    const g = Number(m[2]);
    const row = GRADE_CURVE.find(([min]) => g >= min) || GRADE_CURVE[GRADE_CURVE.length - 1];
    return row[1] * (COMPANY_FACTOR[m[1]] || 1) * (m[1] === 'BGS' && g === 10 ? 1.3 : 1);
  }

  async function api(path) {
    const order = [apiBase, ...API_BASES.filter((b) => b !== apiBase)];
    let lastErr = null;
    for (const base of order) {
      try {
        const res = await fetch(base + path, { headers: { Accept: 'application/json' } });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.includes('json')) throw new Error(`HTTP ${res.status}`);
        apiBase = base;
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Market API unavailable');
  }

  /* ---------- collection ---------- */

  function loadCollection() {
    try {
      const raw = JSON.parse(localStorage.getItem(COLLECTION_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_err) {
      return {};
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
    } catch (_err) { /* private mode */ }
  }

  function saveCollection() {
    writeLocal();
    if (account.state === 'signed-in') {
      setSyncMeta({ owner: account.me.user.id, pending: true });
      schedulePush();
      renderProfile();
    } else if (account.state === 'guest' || account.state === 'offline') {
      renderProfile();
    }
  }

  function loadWants() {
    try {
      const raw = JSON.parse(localStorage.getItem(WANTS_KEY) || '{}');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (_err) {
      return {};
    }
  }

  function writeWants() {
    try { localStorage.setItem(WANTS_KEY, JSON.stringify(wants)); } catch (_err) { /* private mode */ }
  }

  function wanted(id, print) {
    return !!(wants[id] && wants[id][print]);
  }

  function wantsList() {
    const out = [];
    CHECK.cards.forEach((card) => {
      card.prints.forEach((print) => {
        if (wanted(card.id, print)) out.push({ id: card.id, print });
      });
    });
    return out;
  }

  function wantsFromList(list) {
    const out = {};
    (list || []).forEach((row) => {
      const card = byId.get(row && row.id);
      if (!card || !card.prints.includes(row.print)) return;
      out[row.id] = out[row.id] || {};
      out[row.id][row.print] = 1;
    });
    return out;
  }

  function sameWants(map, list) {
    const a = wantsListFrom(map).map((w) => `${w.id}|${w.print}`).sort().join(',');
    const b = wantsFromList(list);
    const bKey = wantsListFrom(b).map((w) => `${w.id}|${w.print}`).sort().join(',');
    return a === bKey;
  }

  function wantsListFrom(map) {
    const out = [];
    CHECK.cards.forEach((card) => {
      card.prints.forEach((print) => {
        if (map[card.id] && map[card.id][print]) out.push({ id: card.id, print });
      });
    });
    return out;
  }

  function saveWants() {
    writeWants();
    renderRows();
    renderProfile();
    if (collectorData && collectorData.isOwner) {
      const body = $('ddlCollectorBody');
      const dlg = $('ddlCollectorDialog');
      if (body && dlg && dlg.open) body.innerHTML = collectorHtml(collectorData);
    }
    if (account.state === 'signed-in') {
      setSyncMeta({ owner: account.me.user.id, wantsPending: true });
      scheduleWantPush();
    }
  }

  function setWanted(id, print, on) {
    const card = byId.get(id);
    if (!card || !card.prints.includes(print)) return;
    wants[id] = wants[id] || {};
    if (on) wants[id][print] = 1;
    else delete wants[id][print];
    if (!Object.keys(wants[id]).length) delete wants[id];
    saveWants();
  }

  function wantNote() {
    if (account.state === 'signed-in' && account.me && account.me.profile && account.me.profile.isPublic) {
      return 'Looking for shows on your public collection and on the collector board.';
    }
    if (account.state === 'signed-in') {
      return 'Looking for is saved to your account. Turn on a public profile to show other collectors.';
    }
    return 'Looking for stays on this device until you sign in and turn on a public profile.';
  }

  function owned(id, print) {
    const row = collection[id] && collection[id][print];
    if (!row) return { raw: 0, graded: [] };
    return { raw: Math.max(0, Number(row.raw) || 0), graded: Array.isArray(row.graded) ? row.graded : [] };
  }

  function ownedCount(id, print) {
    const o = owned(id, print);
    return o.raw + o.graded.length;
  }

  function setOwned(id, print, next) {
    collection[id] = collection[id] || {};
    if (!next.raw && !next.graded.length) delete collection[id][print];
    else collection[id][print] = { raw: next.raw, graded: next.graded };
    if (!Object.keys(collection[id]).length) delete collection[id];
    saveCollection();
    renderCollection();
    renderRows();
  }

  function marketCard(id) {
    return market && market.cards ? market.cards.find((c) => c.id === id) : null;
  }

  function printPrice(id, print) {
    const mc = marketCard(id);
    const row = mc && mc.prints && mc.prints[print];
    return row && Number.isFinite(row.usd) ? row.usd : null;
  }

  function gradedPrice(id, print, grade) {
    const mc = marketCard(id);
    const row = mc && mc.graded && mc.graded[print] && mc.graded[print][grade];
    if (row && Number.isFinite(row.usd)) return row.usd;
    const raw = printPrice(id, print);
    return raw == null ? null : raw * gradeMultiplier(grade);
  }

  function holdingValue(id, print) {
    const o = owned(id, print);
    const raw = printPrice(id, print) || 0;
    let total = o.raw * raw;
    o.graded.forEach((g) => { total += gradedPrice(id, print, g) || 0; });
    return total;
  }

  function renderCollection() {
    let value = 0;
    let base = 0;
    let holo = 0;
    let fa = 0;
    let complete = 0;
    let copies = 0;
    CHECK.cards.forEach((card) => {
      let all = true;
      card.prints.forEach((p) => {
        const n = ownedCount(card.id, p);
        copies += n;
        if (n) {
          if (p === 'base') base += 1;
          if (p === 'holo') holo += 1;
          if (p === 'fa') fa += 1;
        } else {
          all = false;
        }
        value += holdingValue(card.id, p);
      });
      if (all) complete += 1;
    });
    const crNames = CHECK.cards.filter((c) => !c.chase).length;
    const chaseNames = CHECK.cards.length - crNames;
    $('ddlCollectionValue').textContent = money(value);
    $('ddlCollectionSub').textContent = copies
      ? `${copies} card${copies === 1 ? '' : 's'} in total, including extras, at today's prices.`
      : 'Set how many copies you own with − and +. Extras count in the card total.';
    const tile = (label, n, of) => `<div class="ddl-total"><span class="ddl-total-n">${n}<small>/${of}</small></span><span class="ddl-total-l">${label}</span><span class="ddl-bar"><i style="width:${of ? Math.round((n / of) * 100) : 0}%"></i></span></div>`;
    $('ddlTotals').innerHTML = [
      `<div class="ddl-total ddl-total-copies"><span class="ddl-total-n">${copies}</span><span class="ddl-total-l">Cards owned</span><span class="ddl-total-s">including extras</span></div>`,
      tile('Base C/R', base, crNames),
      tile('Holo C/R', holo, crNames),
      tile('Full art', fa, chaseNames),
      tile('Master set', base + holo + fa, CHECK.master),
      tile('Names complete', complete, CHECK.names),
    ].join('');
    renderGroupList();
  }

  function groupDefs(mode) {
    if (mode === 'finish') return [['fa', 'Full art'], ['holo', 'Holo'], ['base', 'Base']];
    if (mode === 'rarity') return [['CR', 'Common/Rare'], ['UR', 'Ultra Rare'], ['GIGA', 'Giga Rare']];
    if (mode === 'type') return [['Creature', 'Creatures'], ['Spell', 'Spells'], ['Trap', 'Traps']];
    return ['Zombie', 'Wizard', 'Bow', 'Crown', 'Pirate', 'Neutral', 'All'].map((name) => [name, name]);
  }

  function printsInGroup(card, mode, key) {
    if (mode === 'class' && card.class !== key) return [];
    if (mode === 'rarity' && card.tier !== key) return [];
    if (mode === 'type' && card.type !== key) return [];
    if (mode === 'finish') return card.prints.includes(key) ? [key] : [];
    return card.prints.slice();
  }

  function renderGroupList() {
    const list = $('ddlGroupList');
    if (!list) return;
    const mode = ($('ddlGroup') && $('ddlGroup').value) || 'class';
    list.innerHTML = groupDefs(mode).map(([key, label]) => {
      let slots = 0;
      let unique = 0;
      let copies = 0;
      CHECK.cards.forEach((card) => {
        printsInGroup(card, mode, key).forEach((print) => {
          slots += 1;
          const n = ownedCount(card.id, print);
          copies += n;
          if (n) unique += 1;
        });
      });
      const need = Math.max(0, slots - unique);
      return `<li class="ddl-group-row">
        <span class="ddl-group-name">${esc(label)}</span>
        <span class="ddl-group-own"><b>${copies}</b> owned</span>
        <span class="ddl-group-have">${unique}/${slots}</span>
        <span class="ddl-group-need${need ? '' : ' is-done'}">${need ? `need ${need}` : 'complete'}</span>
      </li>`;
    }).join('');
  }

  /* ---------- market summary ---------- */

  function sourceBadge(row) {
    if (!row) return '';
    if (row.source === 'sold') return `<span class="ddl-src ddl-src-sold" title="Median of ${row.sold} sold comp${row.sold === 1 ? '' : 's'}">Sold · ${row.sold}</span>`;
    if (row.source === 'shop') return '<span class="ddl-src ddl-src-shop" title="Matched to a Doginal Dogs shop listing by title">Shop</span>';
    if (row.source === 'asks') return `<span class="ddl-src ddl-src-asks" title="${row.asks} active listing${row.asks === 1 ? '' : 's'}, discounted">Asks · ${row.asks}</span>`;
    if (row.source === 'derived') return '<span class="ddl-src ddl-src-model" title="Raw price × grade multiplier">Grade est.</span>';
    return '<span class="ddl-src ddl-src-model" title="No comps yet — pack math from the booster box price">Estimate</span>';
  }

  function renderMarket() {
    if (!market) return;
    const box = market.box || {};
    const pack = market.pack || {};
    const sealedNote = (row, idle) => {
      if (row.source === 'sold') return `eBay sold · ${row.n}`;
      if (row.source === 'shop') return 'Doginal Dogs shop';
      if (row.source === 'asks') return `eBay asks · ${row.n}`;
      return idle;
    };
    const priceLink = (usd, url) => {
      const label = money(usd);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${label}</a>` : label;
    };
    const boxSrc = sealedNote(box, `MSRP $${box.msrpUsd}`);
    const packSrc = sealedNote(pack, 'box ÷ 24');
    const top = [];
    (market.cards || []).forEach((c) => {
      Object.keys(c.prints || {}).forEach((p) => top.push({ c, p, row: c.prints[p] }));
    });
    top.sort((a, b) => (b.row.usd || 0) - (a.row.usd || 0));
    $('ddlMarketGrid').innerHTML = `
      <div class="ddl-stat"><span class="ddl-stat-l">Booster box</span><span class="ddl-stat-v">${priceLink(box.usd, box.url)}</span><span class="ddl-stat-s">${esc(boxSrc)}</span></div>
      <div class="ddl-stat"><span class="ddl-stat-l">Booster pack</span><span class="ddl-stat-v">${priceLink(pack.usd, pack.url)}</span><span class="ddl-stat-s">${esc(packSrc)}</span></div>
      <div class="ddl-stat"><span class="ddl-stat-l">eBay feed</span><span class="ddl-stat-v">${market.counts ? market.counts.activeListings : 0}</span><span class="ddl-stat-s">active · ${market.counts ? market.counts.matchedSold : 0} sold comps</span></div>
      <div class="ddl-top">
        <span class="ddl-stat-l">Top prints</span>
        <ol>${top.slice(0, 6).map((t) => `<li><button type="button" class="ddl-link" data-card="${t.c.id}">${esc(t.c.name)} <em>${PRINT_LABEL[t.p]}</em></button><b>${money(t.row.usd)}</b></li>`).join('')}</ol>
      </div>`;
    const bits = [];
    const shopLive = market.sources && market.sources.shop && market.sources.shop.ok;
    const ebayLive = market.configured && market.sources && market.sources.browse && market.sources.browse.ok;
    if (shopLive && !ebayLive) {
      bits.push('Box and pack follow the Doginal Dogs shop listing whose title matches. Singles stay estimates until a listing title matches that card.');
    } else if (!ebayLive) {
      bits.push('Live eBay feed is warming up, so card prices are pack-math estimates until comps land.');
    }
    if (market.refreshedAt) bits.push(`Refreshed ${ago(market.refreshedAt)}`);
    if (market.nextRefreshAt) bits.push(`next pull ${ago(market.nextRefreshAt)}`);
    bits.push(`every ${market.refreshHours || 6}h`);
    $('ddlMarketMeta').textContent = bits.join(' · ');
    if (market.askDiscount) $('ddlAskPct').textContent = Math.round(market.askDiscount * 100) + '%';
  }

  /* ---------- table ---------- */

  function cardValue(card) {
    return card.prints.reduce((max, p) => Math.max(max, printPrice(card.id, p) || 0), 0);
  }

  function countSlots(card) {
    return card.chase ? ['base', 'fa'] : card.prints.slice();
  }

  function editablePrint(card, print) {
    if (print === 'fa') return !!card.chase;
    if (print === 'holo') return !card.chase;
    return print === 'base';
  }

  function qtyEditor(card, print) {
    const o = owned(card.id, print);
    const label = print === 'base' && card.chase ? 'non-full-art base' : (PRINT_LABEL[print] || print);
    return `<span class="ddl-qty-edit" data-hold="${card.id}|${print}">
      <button type="button" data-step="-1" aria-label="One less ${esc(card.name)} ${esc(label)}">−</button>
      <b>${o.raw}</b>
      <button type="button" data-step="1" aria-label="One more ${esc(card.name)} ${esc(label)}">+</button>
      ${o.graded.length ? `<small title="${o.graded.length} graded">+${o.graded.length}</small>` : ''}
    </span>`;
  }

  function cellFor(card, print) {
    if (!editablePrint(card, print)) return '<td class="ddl-na">—</td>';
    const n = ownedCount(card.id, print);
    const mc = marketCard(card.id);
    const row = mc && mc.prints ? mc.prints[print] : null;
    const label = print === 'base' && card.chase ? 'Non-FA base' : PRINT_LABEL[print];
    const need = wanted(card.id, print);
    return `<td class="ddl-print${n ? ' is-owned' : ''}${need ? ' is-wanted' : ''}" data-label="${esc(label)}">
      ${qtyEditor(card, print)}
      <span class="ddl-price">${money(row ? row.usd : null)}</span>${sourceBadge(row)}
    </td>`;
  }

  function renderRows() {
    const q = $('ddlSearch').value.trim().toLowerCase();
    const tier = $('ddlTier').value;
    const cls = $('ddlClass').value;
    const own = $('ddlOwned').value;
    const sort = $('ddlSort').value;
    let rows = CHECK.cards.filter((c) => {
      if (tier && c.tier !== tier) return false;
      if (cls && c.class !== cls) return false;
      if (q && !(c.name.toLowerCase().includes(q) || String(c.no).padStart(3, '0').includes(q.replace('#', '')) || c.id.toLowerCase() === q)) return false;
      const has = c.prints.some((p) => ownedCount(c.id, p));
      if (own === 'owned' && !has) return false;
      if (own === 'missing' && c.prints.every((p) => ownedCount(c.id, p))) return false;
      if (own === 'want' && !c.prints.some((p) => wanted(c.id, p))) return false;
      return true;
    });
    if (sort === 'value') rows = rows.slice().sort((a, b) => cardValue(b) - cardValue(a));
    if (sort === 'name') rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name));
    $('ddlRows').innerHTML = rows.map((c) => {
      const mc = marketCard(c.id);
      const dogs = mc && Array.isArray(mc.artDogs) ? mc.artDogs : [];
      return `<tr>
        <td class="ddl-no">${String(c.no).padStart(3, '0')}</td>
        <td class="ddl-card">
          <button type="button" class="ddl-card-btn" data-card="${c.id}">
            <img src="${esc(c.render)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
            <span><b>${esc(c.name)}</b><small class="ddl-tier ddl-tier-${c.tier}">${esc(c.tierLabel)}</small> <small>${esc(c.class)}</small></span>
          </button>
        </td>
        ${cellFor(c, 'base')}${cellFor(c, 'holo')}${cellFor(c, 'fa')}
        <td class="ddl-dogs${dogs.length ? '' : ' is-empty'}" data-label="Art dog">${dogs.length ? dogs.map((d) => `<button type="button" class="ddl-dog-chip" data-dog="${d.dogNumber}" title="Evaluate Doginal Dog #${d.dogNumber}">#${d.dogNumber}</button>`).join('') : '<span class="ddl-muted">—</span>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="ddl-muted">No cards match.</td></tr>';
  }

  /* ---------- card dialog ---------- */

  function compList(rows, empty) {
    if (!rows || !rows.length) return `<p class="ddl-muted">${empty}</p>`;
    return `<ul class="ddl-comps">${rows.slice(0, 12).map((r) => `<li>
      <b>${money(r.usd)}</b>
      <span>${esc(PRINT_LABEL[r.print] || '')}${r.grade && r.grade !== 'raw' ? ' · ' + esc(r.grade) : ''}${r.at ? ' · ' + esc(ago(r.at)) : ''}${r.source === 'manual' ? ' · manual' : ''}</span>
      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">${esc(r.title).slice(0, 80)}</a>` : `<em>${esc(r.title).slice(0, 80)}</em>`}
    </li>`).join('')}</ul>`;
  }

  function holdingEditor(card, print) {
    const o = owned(card.id, print);
    return `<div class="ddl-hold" data-hold="${card.id}|${print}">
      <span class="ddl-hold-l">${PRINT_LABEL[print]}</span>
      <div class="ddl-stepper">
        <button type="button" data-step="-1" aria-label="Remove one raw copy">−</button>
        <span>${o.raw} raw</span>
        <button type="button" data-step="1" aria-label="Add one raw copy">+</button>
      </div>
      <div class="ddl-graded">
        ${o.graded.map((g, i) => `<span class="ddl-grade-chip">${esc(g)} <b>${money(gradedPrice(card.id, print, g))}</b><button type="button" data-ungrade="${i}" aria-label="Remove ${esc(g)} copy">×</button></span>`).join('')}
        <select data-grade aria-label="Add graded copy"><option value="">+ graded copy</option>${GRADES.map((g) => `<option>${g}</option>`).join('')}</select>
      </div>
      <span class="ddl-hold-v">${money(holdingValue(card.id, print))}</span>
      <button type="button" class="ddl-want-btn${wanted(card.id, print) ? ' is-on' : ''}" data-want="${card.id}|${print}" aria-pressed="${wanted(card.id, print) ? 'true' : 'false'}">${wanted(card.id, print) ? 'Looking for this' : 'Looking for'}</button>
    </div>`;
  }

  function renderCardDialog(card, detail) {
    const mc = marketCard(card.id);
    const dogs = mc && Array.isArray(mc.artDogs) ? mc.artDogs : [];
    const priceRows = card.prints.map((p) => {
      const row = mc && mc.prints ? mc.prints[p] : null;
      const graded = mc && mc.graded && mc.graded[p] ? Object.entries(mc.graded[p]) : [];
      return `<div class="ddl-price-row">
        <span class="ddl-hold-l">${PRINT_LABEL[p]}</span>
        <b class="ddl-price-big">${money(row ? row.usd : null)}</b>${sourceBadge(row)}
        <span class="ddl-muted">${row && row.low != null ? `range ${money(row.low)}–${money(row.high)}` : ''}${row && row.lowestAskUsd != null ? ` · lowest ask ${money(row.lowestAskUsd)}` : ''}${row && row.estimateUsd != null ? ` · model ${money(row.estimateUsd)}` : ''}</span>
        ${graded.length ? `<div class="ddl-graded-market">${graded.map(([g, r]) => `<span>${esc(g)} <b>${money(r.usd)}</b> ${sourceBadge(r)}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    const dogHtml = dogs.length
      ? dogs.map((d) => `<div class="ddl-art-dog">
          <img src="/api/doginal-proxy.php?action=image&amp;dogNumber=${d.dogNumber}" alt="" onerror="this.onerror=null;this.src='/assets/collection-logo.png'">
          <div><b>Doginal Dog #${d.dogNumber}</b>${d.handle ? ` · @${esc(d.handle)}` : ''}<br><span class="ddl-muted">${esc(d.note || 'Official art inspiration for this card.')} Owning this dog and the card stacks in the Doginal Dogs wallet estimate.</span></div>
          <button type="button" class="eval-mp-btn" data-dog="${d.dogNumber}">Evaluate dog</button>
        </div>`).join('')
      : '<p class="ddl-muted">No official art dog is linked to this card yet.</p>';
    $('ddlCardBody').innerHTML = `
      <div class="ddl-dialog-head">
        <h3 id="ddlCardTitle">${String(card.no).padStart(3, '0')} · ${esc(card.name)}</h3>
        <button type="button" class="ddl-close" data-close aria-label="Close">×</button>
      </div>
      <div class="ddl-card-detail">
        <img class="ddl-card-render" src="${esc(card.render)}" alt="${esc(card.name)} card" onerror="this.style.visibility='hidden'">
        <div>
          <p><span class="ddl-tier ddl-tier-${card.tier}">${esc(card.tierLabel)}</span> · ${esc(card.class)}${card.chase ? ` · Chase #${card.chaseNo} of 19` : ''}${card.note ? ` · ${esc(card.note)}` : ''}</p>
          <h4>Market</h4>${priceRows}
          <h4>You own</h4>${card.prints.map((p) => holdingEditor(card, p)).join('')}
          <p class="ddl-muted ddl-want-note">${wantNote()}</p>
          <h4>Art dog</h4>${dogHtml}
        </div>
      </div>
      <div class="ddl-comp-cols">
        <div><h4>Recent sold</h4>${detail ? compList(detail.sold, 'No sold comps yet.') : '<p class="ddl-muted">Loading…</p>'}</div>
        <div><h4>Active asks</h4>${detail ? compList(detail.asks, 'No active listings matched.') : '<p class="ddl-muted">Loading…</p>'}</div>
      </div>
      <p class="ddl-muted"><a href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent('doginal dogs legends ' + card.name)}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener nofollow">Search eBay sold listings for ${esc(card.name)} ↗</a></p>`;
  }

  let openCardId = null;
  let openDetail = null;

  function openCard(id) {
    const card = byId.get(id);
    if (!card) return;
    openCardId = id;
    openDetail = null;
    renderCardDialog(card, null);
    const dlg = $('ddlCardDialog');
    if (!dlg.open) dlg.showModal();
    api('/card/' + encodeURIComponent(id))
      .then((detail) => {
        if (openCardId !== id) return;
        openDetail = detail;
        renderCardDialog(card, detail);
      })
      .catch(() => {
        if (openCardId !== id) return;
        openDetail = { sold: [], asks: [] };
        renderCardDialog(card, openDetail);
      });
  }

  function rerenderOpenCard() {
    const dlg = $('ddlCardDialog');
    if (dlg.open && openCardId) renderCardDialog(byId.get(openCardId), openDetail);
  }

  /* ---------- art dog → Doginal Dogs evaluator ---------- */

  function evaluateDog(dogNumber) {
    ['ddlCardDialog', 'ddlScanDialog'].forEach((id) => { const d = $(id); if (d.open) d.close(); });
    setMode('dd');
    const insBtn = document.querySelector('.eval-mode-btn[data-mode="inscription"]');
    if (insBtn && !insBtn.classList.contains('active')) insBtn.click();
    const input = $('dogInput');
    const form = $('searchForm');
    if (!input || !form) return;
    input.value = String(dogNumber);
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- scanner ---------- */

  // A close call must repeat. A clear winner among the set is shown on the frame it is read.
  const SCAN_STREAK = 2;
  // Best-guess score above which the frame probably holds a card that is not yet readable.
  const SCAN_NEAR = 0.42;
  const scan = {
    stream: null, timer: 0, lastId: '', streak: 0, cooldownUntil: 0,
    justAdded: '', shownId: '', misses: 0, gone: 0, photo: false,
  };
  let scannerReady = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-ddl-src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.ddlSrc = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the card scanner. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }

  function loadScanner() {
    if (!scannerReady) {
      scannerReady = SCAN_SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .then(() => {
          const W = window.DdlIrlWatch;
          if (!W || typeof W.scanStill !== 'function' || !W.printCount()) throw new Error('The card scanner did not load. Refresh the page and try again.');
          return W;
        })
        .catch((err) => {
          scannerReady = null;
          throw err;
        });
    }
    return scannerReady;
  }

  function scanStatus(text) {
    $('ddlScanStatus').textContent = text;
  }

  function guideRectInVideo(video, guide) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    return {
      x: (gr.left - vr.left - offX) / scale,
      y: (gr.top - vr.top - offY) / scale,
      w: gr.width / scale,
      h: gr.height / scale,
    };
  }

  function readName(hit) {
    return hit && hit.nameText ? String(hit.nameText).toUpperCase() : '';
  }

  function scanResultHtml(card, ranked, note, hit) {
    const read = readName(hit);
    const artOk = !!(hit && hit.artOk);
    const addBtns = card.prints.map((p) => {
      const n = ownedCount(card.id, p);
      return `<button type="button" class="eval-mp-btn eval-mp-btn-primary" data-scan-add="${card.id}|${p}">+ ${PRINT_LABEL[p]} <small>${money(printPrice(card.id, p))}${n ? ` · have ${n}` : ''}</small></button>`;
    }).join('');
    const alts = (ranked || []).filter((r) => r.id !== card.id).slice(0, 3)
      .map((r) => byId.get(r.id)).filter(Boolean)
      .map((c) => `<button type="button" class="ddl-alt" data-scan-pick="${c.id}">${esc(c.name)}</button>`).join('');
    return `<div class="ddl-scan-hit">
      <img src="${esc(card.render)}" alt="">
      <div>
        <b>${esc(card.name)}</b> <span class="ddl-tier ddl-tier-${card.tier}">${esc(card.tierLabel)}</span>
        ${read ? `<p class="ddl-scan-name">Name read: <b>${esc(read)}</b>${artOk ? ' <span>matches the art</span>' : ''}</p>` : ''}
        <p class="ddl-muted">${esc(note || (card.chase ? 'Full Art chase card.' : "The camera can't tell Base from Holo, so pick the print."))}</p>
        <div class="ddl-scan-add">${addBtns}</div>
        ${alts ? `<p class="ddl-muted">Not it? ${alts}</p>` : ''}
      </div>
    </div>`;
  }

  function clearScanResult() {
    scan.shownId = '';
    const box = $('ddlScanResult');
    if (box) box.innerHTML = '';
    const dlg = $('ddlScanDialog');
    if (dlg) dlg.classList.remove('has-result');
  }

  function showScanCard(card, ranked, note, hit) {
    const box = $('ddlScanResult');
    box.innerHTML = scanResultHtml(card, ranked, note, hit);
    scan.shownId = card.id;
    $('ddlScanDialog').classList.add('has-result');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function handleScanHit(card, ranked, hit, note) {
    const mode = $('ddlScanAuto').value;
    const print = card.chase ? 'fa' : mode;
    if (hit && hit.artOk && mode !== 'ask' && card.prints.includes(print)) {
      scanAdd(card.id, print, 'scanned', readName(hit));
      return;
    }
    const read = readName(hit);
    scanStatus(read ? `Read "${read}". Pick the print to add it.` : `Found ${card.name}. Pick the print to add it.`);
    showScanCard(card, ranked, note || '', hit);
  }

  /** Name text for the status line. A card is only opened once this name and the art are the same card. */
  function confidentName(out) {
    const name = out && out.name;
    if (!name || !name.id || !(name.score >= 0.55) || !(name.gap >= 0.03)) return null;
    return name;
  }

  function scanTick() {
    const video = $('ddlScanVideo');
    const W = window.DdlIrlWatch;
    if (!W || !video.videoWidth || Date.now() < scan.cooldownUntil) return;
    const out = W.scanFrame(video, guideRectInVideo(video, $('ddlScanGuide')));
    const name = confidentName(out);
    if (out.hit) {
      scan.gone = 0;
      scan.misses = 0;
      scan.streak = out.hit.id === scan.lastId ? scan.streak + 1 : 1;
      scan.lastId = out.hit.id;
      const read = (name && name.id === out.hit.id ? String(name.text || '') : (out.hit.nameText || '')).toUpperCase();
      const need = out.hit.decisive ? 1 : SCAN_STREAK;
      if (scan.streak < need) {
        if (read && out.hit.id !== scan.shownId) scanStatus(`Reading "${read}"... hold it steady.`);
        return;
      }
      if (out.hit.id === scan.justAdded || out.hit.id === scan.shownId) return;
      const card = byId.get(out.hit.id);
      if (!card) return;
      handleScanHit(card, out.ranked, Object.assign({}, out.hit, { artOk: true }));
      return;
    }
    scan.streak = 0;
    scan.lastId = '';
    if (!(out.top && out.top.score >= SCAN_NEAR)) {
      scan.gone += 1;
      scan.misses = 0;
      if (scan.gone >= 2) scan.justAdded = '';
      if (!scan.shownId) scanStatus('Hold one card flat inside the frame.');
      return;
    }
    scan.gone = 0;
    scan.misses += 1;
    if (scan.shownId) return;
    const read = name ? String(name.text || '').toUpperCase() : '';
    if (name && out.top && name.id !== out.top.id) scanStatus(`The name reads "${read}" but the art doesn't match that card. Hold it steady, or add it by name below.`);
    else if (scan.misses >= 8) scanStatus('Still reading. Fill the frame with the card, keep the name in view and tilt it away from glare.');
    else scanStatus(read ? `Reading "${read}"... hold it steady.` : 'Card seen. Hold it steady so the name can be read.');
  }

  function scanLoop() {
    if (!scan.stream) return;
    const started = performance.now();
    try { scanTick(); } catch (_err) { /* one bad frame should not stop the loop */ }
    scan.timer = window.setTimeout(scanLoop, Math.max(40, 120 - (performance.now() - started)));
  }

  function torchTrack() {
    const track = scan.stream && scan.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    return caps && caps.torch ? track : null;
  }

  async function listCameras() {
    const select = $('ddlScanCamera');
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    const track = scan.stream && scan.stream.getVideoTracks()[0];
    const currentId = track && track.getSettings ? track.getSettings().deviceId : '';
    select.innerHTML = devices.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Camera ${i + 1}`)}</option>`).join('');
    if (currentId) select.value = currentId;
    select.hidden = devices.length < 2;
  }

  function stopCamera() {
    window.clearTimeout(scan.timer);
    scan.timer = 0;
    if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
    scan.stream = null;
    const video = $('ddlScanVideo');
    if (video) video.srcObject = null;
    scan.lastId = '';
    scan.streak = 0;
    scan.justAdded = '';
    scan.misses = 0;
  }

  /** getUserMedia must be reached before the first await so the tap still counts as the gesture. */
  async function startCamera(deviceId, strict) {
    stopCamera();
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (deviceId) video.deviceId = strict ? { exact: deviceId } : { ideal: deviceId };
    else video.facingMode = { ideal: 'environment' };
    scan.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const el = $('ddlScanVideo');
    el.srcObject = scan.stream;
    await el.play().catch(() => {});
    scan.photo = false;
    $('ddlScanStage').classList.remove('is-photo');
    $('ddlScanTorch').hidden = !torchTrack();
    $('ddlScanTorch').setAttribute('aria-pressed', 'false');
    listCameras().catch(() => {});
    scanStatus('Hold one card flat inside the frame.');
    scanLoop();
  }

  function cameraBlockedHelp(err) {
    const ua = navigator.userAgent;
    const brave = !!navigator.brave;
    const app = brave ? 'Brave' : 'your browser';
    const android = /Android/i.test(ua);
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const msg = String((err && err.message) || '');
    if (/dismiss/i.test(msg)) return 'The camera prompt was closed. Tap Live camera to ask again.';
    if (/system/i.test(msg)) {
      return android
        ? `Your phone is blocking the camera for ${app}. Open Android Settings › Apps › ${brave ? 'Brave' : 'your browser'} › Permissions › Camera › Allow, then tap Live camera.`
        : `Your computer is blocking the camera for ${app}. On Windows: Settings › Privacy & security › Camera, turn on camera access for desktop apps. On Mac: System Settings › Privacy & Security › Camera, tick ${app}. Then press Live camera.`;
    }
    if (ios) return `Camera is blocked. Open iOS Settings › ${brave ? 'Brave' : 'Safari'} › Camera › Ask or Allow, reload this page, then tap Live camera. Or use a photo.`;
    if (android) return `Camera is blocked for this site. Tap the icon left of the address bar › Permissions › Camera › Allow, then tap Live camera. If no prompt appears, allow Camera for ${app} in Android Settings › Apps.`;
    return `Camera is blocked for this site. Click the icon at the left of the address bar, set Camera to Allow, then press Live camera.${brave ? ' In Brave you can also check brave://settings/content/camera.' : ''} Or use a photo.`;
  }

  function cameraError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return cameraBlockedHelp(err);
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found. Use a photo or add cards by name below.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is busy or blocked by another app. Close other apps using it, or use a photo instead.';
    return (err && err.message) || 'Could not start the camera.';
  }

  async function openScanner() {
    const dlg = $('ddlScanDialog');
    clearScanResult();
    if (!dlg.open) dlg.showModal();
    if (!window.isSecureContext) {
      scanStatus('The camera only works on the https:// version of this page. Use a photo or add cards by name below.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scanStatus("This browser can't open the camera. Use a photo or add cards by name below.");
      return;
    }
    scanStatus('Allow camera access to start scanning.');
    const scripts = loadScanner();
    scripts.catch(() => {});
    let saved = '';
    try { saved = localStorage.getItem(CAMERA_KEY) || ''; } catch (_err) { /* ignore */ }
    try {
      await startCamera(saved, false);
    } catch (err) {
      scanStatus(cameraError(err));
      return;
    }
    try {
      await scripts;
    } catch (err) {
      stopCamera();
      scanStatus(err.message);
      return;
    }
    if (!dlg.open) stopCamera();
  }

  function stopScanner() {
    stopCamera();
    clearScanResult();
    scan.photo = false;
    $('ddlScanStage').classList.remove('is-photo');
  }

  async function scanPhoto(file) {
    const dlg = $('ddlScanDialog');
    if (!dlg.open) dlg.showModal();
    stopCamera();
    scan.photo = true;
    clearScanResult();
    $('ddlScanTorch').hidden = true;
    scanStatus('Reading your photo…');
    let W;
    try {
      W = await loadScanner();
    } catch (err) {
      scanStatus(err.message);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("That file isn't an image the browser can open."));
        el.src = url;
      });
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      $('ddlScanPhoto').src = canvas.toDataURL('image/jpeg', 0.85);
      $('ddlScanStage').classList.add('is-photo');
      const best = W.scanStill(canvas);
      const card = best && byId.get(best.hit.id);
      if (!card) {
        scanStatus('No card matched in that photo. Crop close to one card with the full face showing, or add it by name below.');
        return;
      }
      const read = readName(best.hit);
      best.hit.artOk = true;
      scanStatus(read ? `Read "${read}" in your photo.` : `Found ${card.name} in your photo.`);
      showScanCard(card, best.ranked, '', best.hit);
    } catch (err) {
      scanStatus(err.message || 'Could not read that photo.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function matchesQuery(card, q) {
    const num = q.replace(/^#|^v0*/i, '');
    if (/^\d+$/.test(num)) return card.no === Number(num);
    const hay = [card.name, card.id].concat(card.aliases || []).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderManualHits() {
    const q = $('ddlScanManual').value.trim();
    const box = $('ddlScanManualHits');
    if (!q) {
      box.innerHTML = '';
      return;
    }
    const hits = CHECK.cards.filter((c) => matchesQuery(c, q)).slice(0, 6);
    box.innerHTML = hits.length
      ? hits.map((c) => `<div class="ddl-manual-row">
          <span><b>${esc(c.name)}</b> <small>${c.id}</small></span>
          <span class="ddl-scan-add">${c.prints.map((p) => `<button type="button" class="eval-mp-btn" data-manual-add="${c.id}|${p}">+ ${PRINT_LABEL[p]}</button>`).join('')}</span>
        </div>`).join('')
      : '<p class="ddl-muted">No card by that name or number.</p>';
  }

  function scanAdd(id, print, via, read) {
    const card = byId.get(id);
    if (!card || !card.prints.includes(print)) return;
    const o = owned(id, print);
    setOwned(id, print, { raw: o.raw + 1, graded: o.graded });
    scan.justAdded = id;
    scan.cooldownUntil = Date.now() + 1200;
    scan.misses = 0;
    clearScanResult();
    if (navigator.vibrate) navigator.vibrate(35);
    const lead = read ? `Read "${read}". ` : '';
    scanStatus(scan.photo || via === 'by name'
      ? `${lead}Added ${card.name} ${PRINT_LABEL[print]}.`
      : `${lead}Added ${card.name} ${PRINT_LABEL[print]}. Show the next card. To add another copy, move it out of the frame and back.`);
    const li = document.createElement('li');
    li.innerHTML = `<b>${esc(card.name)}</b> ${PRINT_LABEL[print]} <small>${esc(via || '')}</small>
      <span>${money(printPrice(id, print))}</span>
      <button type="button" class="ddl-undo" data-undo="${id}|${print}">Undo</button>`;
    $('ddlScanLog').prepend(li);
  }

  function undoAdd(btn) {
    const [id, print] = btn.dataset.undo.split('|');
    const o = owned(id, print);
    setOwned(id, print, { raw: Math.max(0, o.raw - 1), graded: o.graded });
    btn.closest('li').classList.add('undone');
    btn.remove();
    if (scan.justAdded === id) scan.justAdded = '';
  }

  /* ---------- account sync + collector profile ---------- */

  function syncMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_err) {
      return {};
    }
  }

  function setSyncMeta(meta) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(Object.assign(syncMeta(), meta))); } catch (_err) { /* ignore */ }
  }

  async function accountRequest(path, body) {
    const order = [account.base, ...ACCOUNT_BASES.filter((b) => b !== account.base)];
    let lastErr = null;
    for (const base of order) {
      try {
        const res = await fetch(base + path, {
          method: body ? 'POST' : 'GET',
          credentials: 'include',
          headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const type = res.headers.get('content-type') || '';
        if (!type.includes('json')) throw new Error(`HTTP ${res.status}`);
        account.base = base;
        const data = await res.json();
        if (!res.ok) {
          const err = new Error((data && data.error) || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return data;
      } catch (err) {
        if (err.status) throw err;
        lastErr = err;
      }
    }
    throw lastErr || new Error('Accounts are unavailable right now.');
  }

  /** Union of two checklists: highest raw count per print, and each grade kept as many times as either side has it. */
  function mergeCollections(a, b) {
    const out = {};
    CHECK.cards.forEach((card) => {
      card.prints.forEach((p) => {
        const x = (a[card.id] && a[card.id][p]) || { raw: 0, graded: [] };
        const y = (b[card.id] && b[card.id][p]) || { raw: 0, graded: [] };
        const raw = Math.max(Number(x.raw) || 0, Number(y.raw) || 0);
        const counts = {};
        [x.graded || [], y.graded || []].forEach((list) => {
          const local = {};
          list.forEach((g) => { local[g] = (local[g] || 0) + 1; });
          Object.keys(local).forEach((g) => { counts[g] = Math.max(counts[g] || 0, local[g]); });
        });
        const graded = [];
        Object.keys(counts).forEach((g) => { for (let i = 0; i < counts[g]; i += 1) graded.push(g); });
        if (raw || graded.length) {
          out[card.id] = out[card.id] || {};
          out[card.id][p] = { raw, graded };
        }
      });
    });
    return out;
  }

  function sameCollection(a, b) {
    return JSON.stringify(mergeCollections(a, {})) === JSON.stringify(mergeCollections(b, {}));
  }

  function schedulePush() {
    window.clearTimeout(account.timer);
    account.timer = window.setTimeout(pushCollection, 1200);
  }

  function scheduleWantPush() {
    window.clearTimeout(account.wantTimer);
    account.wantTimer = window.setTimeout(pushWants, 1200);
  }

  async function pushCollection() {
    if (account.state !== 'signed-in') return;
    if (account.saving) {
      schedulePush();
      return;
    }
    account.saving = true;
    renderProfile();
    try {
      const out = await accountRequest('/collection', { collection });
      account.savedAt = out.updatedAt || Date.now();
      account.error = '';
      setSyncMeta({ owner: account.me.user.id, pending: false });
    } catch (err) {
      if (err.status === 401) {
        account.state = 'guest';
        account.me = null;
        account.error = 'Your sign-in expired. Sign in again to keep saving to your account.';
      } else {
        account.error = 'Could not save to your account. Changes are kept here and will retry.';
        window.clearTimeout(account.timer);
        account.timer = window.setTimeout(pushCollection, 15000);
      }
    } finally {
      account.saving = false;
      renderProfile();
    }
  }

  async function pushWants() {
    if (account.state !== 'signed-in') return;
    if (account.savingWants) {
      scheduleWantPush();
      return;
    }
    account.savingWants = true;
    renderProfile();
    try {
      const out = await accountRequest('/wants', { wants: wantsList() });
      account.error = '';
      setSyncMeta({ owner: account.me.user.id, wantsPending: false });
      if (account.me && account.me.profile && account.me.profile.isPublic) loadCommunity();
      if (out && Array.isArray(out.wants)) {
        /* server is the sanitized copy; keep local if it still matches */
      }
    } catch (err) {
      if (err.status === 401) {
        account.state = 'guest';
        account.me = null;
        account.error = 'Your sign-in expired. Sign in again to keep saving to your account.';
      } else {
        account.error = 'Could not save what you are looking for. It stays on this device and will retry.';
        window.clearTimeout(account.wantTimer);
        account.wantTimer = window.setTimeout(pushWants, 15000);
      }
    } finally {
      account.savingWants = false;
      renderProfile();
    }
  }

  async function loadAccount() {
    account.state = 'loading';
    renderProfile();
    let me;
    try {
      me = await accountRequest('/me');
    } catch (_err) {
      account.state = 'offline';
      renderProfile();
      return;
    }
    account.discord = me.discordOAuth !== false;
    if (!me.signedIn) {
      account.state = 'guest';
      renderProfile();
      return;
    }
    account.me = me;
    account.state = 'signed-in';
    account.savedAt = me.updatedAt || null;
    const meta = syncMeta();
    const server = me.collection || {};
    const userId = me.user.id;
    let push = false;
    if (meta.owner === userId) {
      if (meta.pending) push = !sameCollection(collection, server);
      else collection = server;
    } else if (meta.owner) {
      collection = server;
    } else {
      const merged = mergeCollections(server, collection);
      push = !sameCollection(merged, server);
      collection = merged;
    }
    let wantPush = false;
    if (Array.isArray(me.wants)) {
      const serverWants = me.wants;
      if (meta.owner === userId) {
        if (meta.wantsPending) wantPush = !sameWants(wants, serverWants);
        else wants = wantsFromList(serverWants);
      } else if (meta.owner) {
        wants = wantsFromList(serverWants);
      } else {
        wants = wantsFromList(serverWants.concat(wantsList()));
        wantPush = !sameWants(wants, serverWants);
      }
    }
    writeLocal();
    writeWants();
    setSyncMeta({ owner: userId, pending: push, wantsPending: wantPush });
    renderCollection();
    renderRows();
    renderProfile();
    if (push) pushCollection();
    if (wantPush) pushWants();
  }

  async function signOut() {
    window.clearTimeout(account.timer);
    window.clearTimeout(account.wantTimer);
    if (account.state === 'signed-in' && syncMeta().pending) await pushCollection();
    if (account.state === 'signed-in' && syncMeta().wantsPending) await pushWants();
    for (const base of AUTH_BASES) {
      try {
        const res = await fetch(base + '/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
        if ((res.headers.get('content-type') || '').includes('json')) break;
      } catch (_err) { /* try next */ }
    }
    account.state = 'guest';
    account.me = null;
    account.error = '';
    renderProfile();
  }

  function discordStartUrl() {
    return '/kmx-auth/discord/start?return=' + encodeURIComponent(EVAL_RETURN);
  }

  function profileUrl(slug) {
    return `${location.origin}/dd-evaluator/?collector=${encodeURIComponent(slug)}#ddl-tcg`;
  }

  function localStats(coll) {
    let names = 0, prints = 0, chase = 0;
    CHECK.cards.forEach((c) => {
      let any = false;
      c.prints.forEach((p) => {
        const row = coll[c.id] && coll[c.id][p];
        const n = row ? (Number(row.raw) || 0) + (row.graded || []).length : 0;
        if (!n) return;
        any = true;
        prints += 1;
        if (p === 'fa') chase += 1;
      });
      if (any) names += 1;
    });
    return { names, prints, chase, chaseTotal: CHECK.cards.filter((c) => c.chase).length };
  }

  function collectionValue(coll) {
    let total = 0;
    CHECK.cards.forEach((c) => {
      c.prints.forEach((p) => {
        const row = coll[c.id] && coll[c.id][p];
        if (!row) return;
        total += (Number(row.raw) || 0) * (printPrice(c.id, p) || 0);
        (row.graded || []).forEach((g) => { total += gradedPrice(c.id, p, g) || 0; });
      });
    });
    return total;
  }

  const DISCORD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.5c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.5-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.5 2.2-2.5 2.2 1.1 2.2 2.5-1 2.4-2.2 2.4Z"/></svg>';

  function renderProfile() {
    const box = $('ddlProfile');
    if (!box) return;
    const err = account.error ? `<p class="ddl-profile-err">${esc(account.error)}</p>` : '';
    if (account.state === 'loading') {
      box.innerHTML = '<p class="ddl-muted">Checking your collector account…</p>';
      return;
    }
    if (account.state !== 'signed-in') {
      const offline = account.state === 'offline';
      box.innerHTML = `<div class="ddl-profile-guest">
        <div>
          <p class="eval-mp-kicker">Collector profile</p>
          <p class="ddl-profile-pitch">${offline
            ? 'Collector accounts are offline right now.'
            : 'Sign in with Discord to save your checklist, list it with other collectors, and show the cards you are looking for.'}</p>
          <p class="ddl-muted">Until then your checklist stays in this browser. You can still browse public collections.</p>
          ${err}
        </div>
        <div class="ddl-profile-actions">
          <button type="button" class="eval-mp-btn" data-profile="board">Public collections</button>
          ${offline ? '' : account.discord
            ? `<a class="ddl-discord-btn" href="${discordStartUrl()}">${DISCORD_ICON}<span>Sign in with Discord</span></a>`
            : '<p class="ddl-muted">Discord sign-in is not set up on this server yet.</p>'}
        </div>
      </div>`;
      return;
    }
    const me = account.me;
    const prof = me.profile;
    const stats = localStats(collection);
    const fav = prof.favoriteCard && byId.get(prof.favoriteCard);
    const meta = syncMeta();
    const pending = meta.pending || meta.wantsPending;
    const sync = (account.saving || account.savingWants) ? 'Saving…' : pending ? 'Unsaved changes' : account.savedAt ? `Saved to your account ${ago(new Date(account.savedAt).toISOString())}` : 'Saved to your account';
    const wantN = wantsList().length;
    box.innerHTML = `<div class="ddl-profile-card">
      <img class="ddl-avatar" src="${esc(me.user.avatarUrl || '/assets/Kush.png')}" alt="" onerror="this.src='/assets/Kush.png'">
      <div class="ddl-profile-main">
        <p class="eval-mp-kicker">Collector profile <span class="ddl-vis ${prof.isPublic ? 'is-public' : ''}">${prof.isPublic ? 'Public' : 'Private'}</span></p>
        <p class="ddl-profile-name">${esc(prof.displayName)}${me.user.discordUsername ? ` <small>@${esc(me.user.discordUsername)}</small>` : ''}</p>
        ${prof.bio ? `<p class="ddl-profile-bio">${esc(prof.bio)}</p>` : ''}
        <p class="ddl-profile-stats"><b>${stats.names}</b>/111 names · <b>${stats.prints}</b>/${CHECK.master} prints · <b>${stats.chase}</b>/${stats.chaseTotal} chase · <b>${wantN}</b> looking for${fav ? ` · Fav: <button type="button" class="ddl-link" data-card="${fav.id}">${esc(fav.name)}</button>` : ''}</p>
        <p class="ddl-muted">${esc(sync)}</p>
        ${err}
      </div>
      <div class="ddl-profile-actions">
        <button type="button" class="eval-mp-btn" data-profile="edit">Edit profile</button>
        <button type="button" class="eval-mp-btn" data-profile="view">View profile</button>
        <button type="button" class="eval-mp-btn" data-profile="board">Public collections</button>
        ${prof.isPublic ? '<button type="button" class="eval-mp-btn" data-profile="copy">Copy link</button>' : ''}
        <button type="button" class="eval-mp-btn" data-profile="signout">Sign out</button>
      </div>
    </div>`;
  }

  function openProfileEditor() {
    if (account.state !== 'signed-in') return;
    const prof = account.me.profile;
    const form = $('ddlProfileForm');
    form.displayName.value = prof.displayName;
    form.slug.value = prof.slug;
    form.bio.value = prof.bio || '';
    $('ddlFavSelect').innerHTML = '<option value="">None</option>' + CHECK.cards.map((c) => `<option value="${c.id}">${String(c.no).padStart(3, '0')} ${esc(c.name)}${c.chase ? ' (Full Art)' : ''}</option>`).join('');
    form.favoriteCard.value = prof.favoriteCard || '';
    form.isPublic.checked = prof.isPublic;
    form.showValue.checked = prof.showValue;
    $('ddlSlugPrefix').textContent = `${location.host}/dd-evaluator/?collector=`;
    $('ddlProfileMsg').textContent = '';
    $('ddlProfileDialog').showModal();
  }

  async function saveProfile(form) {
    const msg = $('ddlProfileMsg');
    msg.textContent = 'Saving…';
    try {
      const out = await accountRequest('/profile', {
        displayName: form.displayName.value,
        slug: form.slug.value.trim().toLowerCase(),
        bio: form.bio.value,
        favoriteCard: form.favoriteCard.value || null,
        isPublic: form.isPublic.checked,
        showValue: form.showValue.checked,
      });
      account.me.profile = out.profile;
      $('ddlProfileDialog').close();
      renderProfile();
    } catch (err) {
      msg.textContent = err.message || 'Could not save your profile.';
    }
  }

  function printHeld(coll, id, print) {
    const row = coll[id] && coll[id][print];
    return !!(row && ((Number(row.raw) || 0) + (row.graded || []).length) > 0);
  }

  function profileWantList(data) {
    if (data.isOwner) return wantsList();
    return Array.isArray(data.wants) ? data.wants.filter((w) => byId.get(w.id) && byId.get(w.id).prints.includes(w.print)) : [];
  }

  function collectorHtml(data) {
    const prof = data.profile;
    const coll = data.collection || {};
    const s = data.stats;
    const fav = prof.favoriteCard && byId.get(prof.favoriteCard);
    const wantRows = profileWantList(data);
    const wantSet = new Set(wantRows.map((w) => `${w.id}|${w.print}`));
    let haveN = 0;
    let missN = 0;
    CHECK.cards.forEach((c) => {
      c.prints.forEach((p) => {
        if (printHeld(coll, c.id, p)) haveN += 1;
        else missN += 1;
      });
    });
    const mode = collectorMode === 'missing' || collectorMode === 'want' ? collectorMode : 'have';
    const tile = (label, n, of) => `<div class="ddl-total"><span class="ddl-total-n">${n}<small>/${of}</small></span><span class="ddl-total-l">${label}</span><span class="ddl-bar"><i style="width:${of ? Math.round((n / of) * 100) : 0}%"></i></span></div>`;
    const grid = CHECK.cards.map((c) => {
      const have = c.prints.filter((p) => printHeld(coll, c.id, p));
      const miss = c.prints.filter((p) => !printHeld(coll, c.id, p));
      const wantedPrints = c.prints.filter((p) => wantSet.has(`${c.id}|${p}`));
      if (mode === 'have' && !have.length) return '';
      if (mode === 'missing' && !miss.length) return '';
      if (mode === 'want' && !wantedPrints.length) return '';
      const labels = mode === 'have' ? have : mode === 'missing' ? miss : wantedPrints;
      const cls = mode === 'missing' ? ' is-miss' : mode === 'want' ? ' is-want' : ' has';
      const needs = mode === 'missing' && data.isOwner
        ? `<div class="ddl-needs">${miss.map((p) => {
          const on = wantSet.has(`${c.id}|${p}`);
          return `<button type="button" class="ddl-need${on ? ' is-on' : ''}" data-want="${c.id}|${p}">${on ? 'Looking' : 'Need'} ${esc(PRINT_LABEL[p])}</button>`;
        }).join('')}</div>`
        : '';
      return `<div class="ddl-collector-card${cls}">
        <button type="button" class="ddl-collector-open" data-card="${c.id}" title="${esc(c.name)}">
          <img src="${esc(c.render)}" alt="" loading="lazy">
          <span>${String(c.no).padStart(3, '0')} ${esc(c.name)}</span>
        </button>
        <em>${labels.map((p) => esc(PRINT_LABEL[p])).join(' + ')}</em>
        ${needs}
      </div>`;
    }).join('');
    const empty = mode === 'have'
      ? 'No cards logged on this checklist yet.'
      : mode === 'missing'
        ? 'Nothing missing. This master set is complete.'
        : data.isOwner
          ? 'You have not marked any cards. Open a card and tap Looking for, or tap Need on a missing print.'
          : 'This collector has not marked any cards they are looking for.';
    const viewBtn = (id, label, n) => `<button type="button" role="tab" data-coll-view="${id}" aria-selected="${mode === id ? 'true' : 'false'}">${label} <small>${n}</small></button>`;
    return `
      <div class="ddl-dialog-head">
        <h3 id="ddlCollectorTitle">Collector profile</h3>
        <button type="button" class="ddl-close" data-close aria-label="Close">×</button>
      </div>
      <div class="ddl-profile-card">
        <img class="ddl-avatar" src="${esc(data.avatarUrl || '/assets/Kush.png')}" alt="" onerror="this.src='/assets/Kush.png'">
        <div class="ddl-profile-main">
          <p class="ddl-profile-name">${esc(prof.displayName)}${data.discordUsername ? ` <small>@${esc(data.discordUsername)}</small>` : ''}</p>
          ${prof.bio ? `<p class="ddl-profile-bio">${esc(prof.bio)}</p>` : ''}
          ${fav ? `<p class="ddl-muted">Favorite card: <b>${esc(fav.name)}</b></p>` : ''}
          ${prof.showValue && market ? `<p class="ddl-profile-value">${money(collectionValue(coll))} <small>at today's prices</small></p>` : ''}
          ${data.isOwner && !prof.isPublic ? '<p class="ddl-profile-err">Only you can see this. Turn on Public profile to list it and publish what you are looking for.</p>' : ''}
        </div>
      </div>
      <div class="ddl-totals">
        ${tile('Names', s.names, s.namesTotal)}
        ${tile('Master set', s.prints, s.printsTotal)}
        ${tile('Holos', s.holos, s.holosTotal)}
        ${tile('Full Art chase', s.chase, s.chaseTotal)}
      </div>
      <div class="ddl-view-toggle" role="tablist" aria-label="Collection view">
        ${viewBtn('have', 'Have', haveN)}
        ${viewBtn('missing', 'Missing', missN)}
        ${viewBtn('want', 'Looking for', wantRows.length)}
      </div>
      <p class="ddl-muted">${mode === 'have' ? 'Prints logged on this checklist.' : mode === 'missing' ? 'Prints that are not on this checklist.' : 'Cards this collector says they need or want.'}</p>
      <div class="ddl-collector-grid">${grid || `<p class="ddl-muted">${empty}</p>`}</div>`;
  }

  function scrollToBoard() {
    const box = $('ddlCommunity');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderBoard() {
    const box = $('ddlBoard');
    if (!box) return;
    document.querySelectorAll('[data-board]').forEach((btn) => {
      btn.setAttribute('aria-selected', btn.dataset.board === community.tab ? 'true' : 'false');
    });
    if (community.loading && community.collectors == null) {
      box.innerHTML = '<p class="ddl-muted">Loading collector lists…</p>';
      return;
    }
    const q = ($('ddlBoardSearch') && $('ddlBoardSearch').value || '').trim().toLowerCase();
    if (community.tab === 'searching') {
      const rows = (community.searching || []).filter((row) => {
        const card = byId.get(row.id);
        if (!card) return false;
        if (!q) return true;
        const who = (row.collectors || []).map((c) => `${c.displayName} ${c.slug}`).join(' ').toLowerCase();
        return card.name.toLowerCase().includes(q) || String(card.no).padStart(3, '0').includes(q.replace('#', '')) || who.includes(q);
      });
      box.innerHTML = rows.map((row) => {
        const card = byId.get(row.id);
        const extra = Math.max(0, Number(row.count) - (row.collectors || []).length);
        const people = (row.collectors || []).map((c) => `<button type="button" data-collector="${esc(c.slug)}">${esc(c.displayName)}</button>`).join('');
        return `<div class="ddl-hunt">
          <button type="button" class="ddl-hunt-card" data-card="${card.id}">
            <img src="${esc(card.render)}" alt="" loading="lazy">
            <span><b>${esc(card.name)}</b><small>${esc(PRINT_LABEL[row.print] || row.print)} · ${row.count} looking</small></span>
          </button>
          <span class="ddl-hunt-people">${people}${extra ? `<em>+${extra}</em>` : ''}</span>
        </div>`;
      }).join('') || `<p class="ddl-muted">${community.error && !(community.searching || []).length ? esc(community.error) : q ? 'No wanted cards match that search.' : 'No public want lists yet. Mark Looking for on a public profile and the card shows up here.'}</p>`;
      return;
    }
    const people = (community.collectors || []).filter((person) => {
      if (!q) return true;
      return `${person.displayName} ${person.discordUsername || ''} ${person.slug} ${person.bio || ''}`.toLowerCase().includes(q);
    });
    box.innerHTML = people.map((person) => {
      const s = person.stats || {};
      const missing = s.missingPrints != null ? s.missingPrints : Math.max(0, (s.printsTotal || 0) - (s.prints || 0));
      const when = person.updatedAt ? ago(new Date(person.updatedAt).toISOString()) : '';
      return `<button type="button" class="ddl-person" data-collector="${esc(person.slug)}">
        <img class="ddl-avatar" src="${esc(person.avatarUrl || '/assets/Kush.png')}" alt="" onerror="this.src='/assets/Kush.png'">
        <span class="ddl-person-main">
          <b>${esc(person.displayName)}${person.discordUsername ? ` <small>@${esc(person.discordUsername)}</small>` : ''}</b>
          <small>${s.names || 0}/${s.namesTotal || CHECK.names} names · ${s.prints || 0}/${s.printsTotal || CHECK.master} prints · ${missing} missing${person.wantCount ? ` · looking for ${person.wantCount}` : ''}</small>
          ${person.bio ? `<small>${esc(person.bio)}</small>` : ''}
          ${when ? `<small>Updated ${esc(when)}</small>` : ''}
        </span>
      </button>`;
    }).join('') || `<p class="ddl-muted">${community.error && !(community.collectors || []).length ? esc(community.error) : q ? 'No collectors match that search.' : 'No public collections yet. Turn on Public profile to list yours.'}</p>`;
  }

  async function loadCommunity() {
    community.loading = true;
    community.error = '';
    renderBoard();
    try {
      const [people, hunt] = await Promise.all([
        accountRequest('/collectors'),
        accountRequest('/searching'),
      ]);
      community.collectors = people.collectors || [];
      community.searching = hunt.cards || [];
    } catch (err) {
      community.error = err.message || 'Collector lists are offline right now.';
      if (!community.collectors) community.collectors = [];
      if (!community.searching) community.searching = [];
    } finally {
      community.loading = false;
      renderBoard();
    }
  }

  async function openCollector(slug) {
    const dlg = $('ddlCollectorDialog');
    collectorData = null;
    collectorMode = 'have';
    $('ddlCollectorBody').innerHTML = `<div class="ddl-dialog-head"><h3 id="ddlCollectorTitle">Collector profile</h3><button type="button" class="ddl-close" data-close aria-label="Close">×</button></div><p class="ddl-muted">Loading…</p>`;
    if (!dlg.open) dlg.showModal();
    try {
      const data = await accountRequest('/u/' + encodeURIComponent(slug));
      if (data.profile.showValue) await marketReady;
      collectorData = data;
      $('ddlCollectorBody').innerHTML = collectorHtml(data);
    } catch (err) {
      collectorData = null;
      $('ddlCollectorBody').innerHTML = `<div class="ddl-dialog-head"><h3 id="ddlCollectorTitle">Collector profile</h3><button type="button" class="ddl-close" data-close aria-label="Close">×</button></div><p class="ddl-muted">${esc(err.message || 'This profile could not be loaded.')}</p>`;
    }
  }

  async function copyProfileLink(btn) {
    const url = profileUrl(account.me.profile.slug);
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 1400);
    } catch (_err) {
      window.prompt('Copy your profile link', url);
    }
  }

  /* ---------- mode switch ---------- */

  const hero = {
    brand: $('evalHeroBrand'),
    title: $('evalMainTitle'),
    sub: $('evalHeroSubtitle'),
  };
  const heroDd = {
    brand: hero.brand ? hero.brand.textContent : '',
    title: hero.title ? hero.title.textContent : '',
    sub: hero.sub ? hero.sub.textContent : '',
  };
  const heroDdl = {
    brand: 'DOGINAL DOGS LEGENDS',
    title: 'TCG Price Evaluator',
    sub: 'Rise of the Pack card values from eBay comps, with your checklist and card scanner',
  };
  let loaded = false;
  let marketReady = Promise.resolve();

  function setMode(mode, opts) {
    const ddl = mode === 'ddl';
    document.body.dataset.evalMode = ddl ? 'ddl' : 'dd';
    $('ddlEval').hidden = !ddl;
    document.querySelectorAll('.ddl-mode-btn').forEach((b) => {
      const on = b.dataset.evalMode === (ddl ? 'ddl' : 'dd');
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const copy = ddl ? heroDdl : heroDd;
    if (hero.brand) hero.brand.textContent = copy.brand;
    if (hero.title) hero.title.textContent = copy.title;
    if (hero.sub) hero.sub.textContent = copy.sub;
    try { localStorage.setItem(MODE_KEY, ddl ? 'ddl' : 'dd'); } catch (_err) { /* ignore */ }
    if (!(opts && opts.keepHash)) {
      const url = location.pathname + location.search + (ddl ? '#ddl-tcg' : '');
      history.replaceState(null, '', url);
    }
    if (ddl && !loaded) {
      loaded = true;
      marketReady = loadMarket();
      loadAccount();
      loadCommunity();
    }
  }

  async function loadMarket() {
    renderCollection();
    renderRows();
    try {
      market = await api('/cards');
    } catch (_err) {
      $('ddlMarketGrid').innerHTML = '<p class="ddl-muted">Market data is offline right now. Your checklist still works.</p>';
      return;
    }
    renderMarket();
    renderCollection();
    renderRows();
  }

  /* ---------- events ---------- */

  document.querySelectorAll('.ddl-mode-btn').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.evalMode));
  });

  ['ddlSearch', 'ddlTier', 'ddlClass', 'ddlOwned', 'ddlSort'].forEach((id) => {
    $(id).addEventListener(id === 'ddlSearch' ? 'input' : 'change', renderRows);
  });

  $('ddlEval').addEventListener('change', (e) => {
    const box = e.target.closest('input[data-own]');
    if (box) {
      const [id, print] = box.dataset.own.split('|');
      const o = owned(id, print);
      if (box.checked) setOwned(id, print, { raw: Math.max(1, o.raw), graded: o.graded });
      else setOwned(id, print, { raw: 0, graded: [] });
      return;
    }
    const sel = e.target.closest('select[data-grade]');
    if (sel && sel.value) {
      const [id, print] = sel.closest('[data-hold]').dataset.hold.split('|');
      const o = owned(id, print);
      setOwned(id, print, { raw: o.raw, graded: o.graded.concat(sel.value) });
      rerenderOpenCard();
    }
  });

  $('ddlEval').addEventListener('click', (e) => {
    const t = e.target;
    const close = t.closest('[data-close]');
    if (close) {
      const dlg = close.closest('dialog');
      if (dlg) dlg.close();
      return;
    }
    const board = t.closest('[data-board]');
    if (board) {
      community.tab = board.dataset.board === 'searching' ? 'searching' : 'collections';
      renderBoard();
      return;
    }
    const viewBtn = t.closest('[data-coll-view]');
    if (viewBtn && collectorData) {
      collectorMode = viewBtn.dataset.collView;
      $('ddlCollectorBody').innerHTML = collectorHtml(collectorData);
      return;
    }
    const want = t.closest('[data-want]');
    if (want) {
      const [id, print] = want.dataset.want.split('|');
      setWanted(id, print, !wanted(id, print));
      rerenderOpenCard();
      return;
    }
    const person = t.closest('[data-collector]');
    if (person) return openCollector(person.dataset.collector);
    const dog = t.closest('[data-dog]');
    if (dog) return evaluateDog(Number(dog.dataset.dog));
    const cardBtn = t.closest('[data-card]');
    if (cardBtn) return openCard(cardBtn.dataset.card);
    const step = t.closest('[data-step]');
    if (step) {
      const [id, print] = step.closest('[data-hold]').dataset.hold.split('|');
      const o = owned(id, print);
      setOwned(id, print, { raw: Math.max(0, o.raw + Number(step.dataset.step)), graded: o.graded });
      return rerenderOpenCard();
    }
    const ungrade = t.closest('[data-ungrade]');
    if (ungrade) {
      const [id, print] = ungrade.closest('[data-hold]').dataset.hold.split('|');
      const o = owned(id, print);
      const graded = o.graded.slice();
      graded.splice(Number(ungrade.dataset.ungrade), 1);
      setOwned(id, print, { raw: o.raw, graded });
      return rerenderOpenCard();
    }
    const add = t.closest('[data-scan-add]');
    if (add) {
      const [id, print] = add.dataset.scanAdd.split('|');
      return scanAdd(id, print, scan.photo ? 'from photo' : 'scanned');
    }
    const manual = t.closest('[data-manual-add]');
    if (manual) {
      const [id, print] = manual.dataset.manualAdd.split('|');
      scanAdd(id, print, 'by name');
      $('ddlScanManual').value = '';
      renderManualHits();
      return;
    }
    const undo = t.closest('[data-undo]');
    if (undo) return undoAdd(undo);
    const pick = t.closest('[data-scan-pick]');
    if (pick) {
      const card = byId.get(pick.dataset.scanPick);
      if (card) showScanCard(card, []);
      return;
    }
    const prof = t.closest('[data-profile]');
    if (prof) {
      const action = prof.dataset.profile;
      if (action === 'edit') openProfileEditor();
      else if (action === 'view') openCollector(account.me.profile.slug);
      else if (action === 'copy') copyProfileLink(prof);
      else if (action === 'board') scrollToBoard();
      else if (action === 'signout') signOut();
    }
  });

  ['ddlCardDialog', 'ddlScanDialog', 'ddlProfileDialog', 'ddlCollectorDialog'].forEach((id) => {
    const dlg = $(id);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  });
  $('ddlScanDialog').addEventListener('close', stopScanner);
  $('ddlCardDialog').addEventListener('close', () => { openCardId = null; });
  $('ddlCollectorDialog').addEventListener('close', () => {
    collectorData = null;
    const params = new URLSearchParams(location.search);
    if (!params.has('collector')) return;
    params.delete('collector');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  });

  $('ddlScanBtn').addEventListener('click', openScanner);
  $('ddlScanLive').addEventListener('click', openScanner);
  $('ddlScanFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) scanPhoto(file);
  });
  $('ddlScanTorch').addEventListener('click', async () => {
    const track = torchTrack();
    if (!track) return;
    const btn = $('ddlScanTorch');
    const on = btn.getAttribute('aria-pressed') !== 'true';
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } catch (_err) {
      btn.hidden = true;
    }
  });
  $('ddlScanCamera').addEventListener('change', (e) => {
    const id = e.target.value;
    try { localStorage.setItem(CAMERA_KEY, id); } catch (_err) { /* ignore */ }
    startCamera(id, true).catch((err) => scanStatus(cameraError(err)));
  });
  try {
    const savedAuto = localStorage.getItem(AUTO_KEY);
    if (savedAuto && [...$('ddlScanAuto').options].some((o) => o.value === savedAuto)) $('ddlScanAuto').value = savedAuto;
  } catch (_err) { /* ignore */ }
  $('ddlScanAuto').addEventListener('change', (e) => {
    try { localStorage.setItem(AUTO_KEY, e.target.value); } catch (_err) { /* ignore */ }
    scan.lastId = '';
    scan.streak = 0;
    clearScanResult();
  });
  $('ddlScanManual').addEventListener('input', renderManualHits);

  $('ddlProfileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveProfile(e.target);
  });
  $('ddlProfileForm').slug.addEventListener('input', (e) => {
    const v = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (v !== e.target.value) e.target.value = v;
  });

  if ($('ddlBoardSearch')) $('ddlBoardSearch').addEventListener('input', renderBoard);
  if ($('ddlBoardRefresh')) $('ddlBoardRefresh').addEventListener('click', loadCommunity);

  function keepGrades(prev) {
    return prev && Array.isArray(prev.graded) ? prev.graded.filter((g) => GRADES.includes(g)).slice(0, 50) : [];
  }

  function applyPdfCounts(counts) {
    const clean = {};
    CHECK.cards.forEach((card) => {
      countSlots(card).forEach((p) => {
        const raw = Math.max(0, Math.min(999, Number(counts[card.id] && counts[card.id][p]) || 0));
        const graded = keepGrades(collection[card.id] && collection[card.id][p]);
        if (raw || graded.length) {
          clean[card.id] = clean[card.id] || {};
          clean[card.id][p] = { raw, graded };
        }
      });
    });
    collection = clean;
    saveCollection();
    renderCollection();
    renderRows();
  }

  $('ddlExportBtn').addEventListener('click', () => {
    const btn = $('ddlExportBtn');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Making PDF…';
    const done = () => {
      btn.disabled = false;
      btn.textContent = prev;
    };
    if (!window.DDLChecklistPdf) {
      window.alert('The checklist PDF tools did not load. Refresh and try again.');
      done();
      return;
    }
    window.DDLChecklistPdf.download(CHECK, collection).catch((err) => {
      window.alert(err && err.message ? err.message : 'Could not make the checklist PDF.');
    }).finally(done);
  });

  $('ddlImportInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!window.DDLChecklistPdf) {
      window.alert('The checklist PDF tools did not load. Refresh and try again.');
      return;
    }
    window.DDLChecklistPdf.readFile(file, CHECK).then((counts) => {
      applyPdfCounts(counts);
    }).catch((err) => {
      window.alert(err && err.message ? err.message : 'That PDF is not a Rise of the Pack checklist.');
    });
  });

  if ($('ddlGroup')) {
    try {
      const saved = localStorage.getItem(GROUP_KEY);
      if (saved && [...$('ddlGroup').options].some((o) => o.value === saved)) $('ddlGroup').value = saved;
    } catch (_err) { /* ignore */ }
    $('ddlGroup').addEventListener('change', () => {
      try { localStorage.setItem(GROUP_KEY, $('ddlGroup').value); } catch (_err) { /* ignore */ }
      renderGroupList();
    });
  }

  $('ddlClearBtn').addEventListener('click', () => {
    if (!Object.keys(collection).length) return;
    const where = account.state === 'signed-in' ? 'your account and this device' : 'this device';
    if (!window.confirm(`Clear every card from your checklist on ${where}?`)) return;
    collection = {};
    saveCollection();
    renderCollection();
    renderRows();
  });

  function readAuthError() {
    const q = location.hash.indexOf('?');
    if (q < 0) return;
    const message = new URLSearchParams(location.hash.slice(q + 1)).get('auth_error');
    if (message) account.error = `Discord sign-in did not finish: ${message.slice(0, 160)}`;
    history.replaceState(null, '', location.pathname + location.search + location.hash.slice(0, q));
  }

  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#ddl-tcg')) {
      readAuthError();
      setMode('ddl', { keepHash: true });
    }
  });

  const params = new URLSearchParams(location.search);
  const collectorSlug = params.get('collector');
  readAuthError();
  let start = 'dd';
  try { start = localStorage.getItem(MODE_KEY) === 'ddl' ? 'ddl' : 'dd'; } catch (_err) { /* ignore */ }
  if (location.hash.startsWith('#ddl-tcg') || params.get('mode') === 'ddl' || collectorSlug) start = 'ddl';
  setMode(start, { keepHash: start !== 'ddl' });
  if (collectorSlug) openCollector(collectorSlug);
})();
