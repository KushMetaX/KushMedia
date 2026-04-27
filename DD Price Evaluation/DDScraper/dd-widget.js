/**
 * Doginal Dogs Price Evaluator — Embeddable Widget
 *
 * Usage:
 *   <div id="dd-evaluator"></div>
 *   <script src="dd-widget.js" data-api="http://localhost:2999" data-target="dd-evaluator"></script>
 *
 * Options (via data- attributes on the <script> tag or DDWidget.init()):
 *   data-api      — Base URL of your DDScraper API (default: same origin)
 *   data-target   — ID of the container element (default: "dd-evaluator")
 *   data-theme    — "dark" (default) or "light"
 */
(function () {
  'use strict';

  /* ---- Config ---- */
  const scriptTag = document.currentScript;
  const cfg = {
    api:    scriptTag?.getAttribute('data-api')    || window.location.origin,
    target: scriptTag?.getAttribute('data-target') || 'dd-evaluator',
    theme:  scriptTag?.getAttribute('data-theme')  || 'dark',
  };

  /* ---- Styles (scoped via .ddw prefix) ---- */
  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

    .ddw { --gold: #d4af37; --bg: #0d0d0d; --card: #161616; --border: #2a2a2a; --muted: #888; --text: #e5e5e5; --white: #fff;
      font-family: 'Inter', system-ui, sans-serif; color: var(--text); box-sizing: border-box; max-width: 640px; margin: 0 auto; }
    .ddw.light { --bg: #f8f8f8; --card: #fff; --border: #ddd; --muted: #666; --text: #222; --white: #111; }

    .ddw *, .ddw *::before, .ddw *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .ddw-header { text-align: center; padding: 20px 0 8px; user-select: none; }
    .ddw-header h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .ddw-header h2 span { color: var(--gold); }
    .ddw-header p { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }

    .ddw-form { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .ddw-input-wrap { position: relative; flex: 1 1 200px; }
    .ddw-hash { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 1.1rem; font-weight: 600; pointer-events: none; }
    .ddw-input { width: 100%; padding: 12px 14px 12px 30px; border-radius: 8px; background: var(--card); border: 1px solid var(--border);
      color: var(--white); font-size: 0.95rem; outline: none; transition: box-shadow .15s; }
    .ddw-input::placeholder { color: var(--muted); opacity: .7; }
    .ddw-input:focus { box-shadow: 0 0 0 2px rgba(212,175,55,.5); }

    .ddw-btn { padding: 12px 24px; border-radius: 8px; background: var(--gold); color: #0d0d0d; font-weight: 600; font-size: 0.95rem;
      border: none; cursor: pointer; white-space: nowrap; transition: filter .15s, transform .1s; }
    .ddw-btn:hover { filter: brightness(1.1); }
    .ddw-btn:active { transform: scale(.97); }
    .ddw-btn:disabled { opacity: .4; pointer-events: none; }

    .ddw-status { text-align: center; margin-top: 20px; font-size: .9rem; }
    .ddw-spinner { display: inline-block; width: 18px; height: 18px; border: 2.5px solid var(--border); border-top-color: var(--gold);
      border-radius: 50%; animation: ddw-spin .8s linear infinite; vertical-align: middle; margin-right: 8px; }
    @keyframes ddw-spin { to { transform: rotate(360deg); } }

    .ddw-error { display: inline-flex; align-items: center; gap: 8px; background: rgba(220,38,38,.12); border: 1px solid rgba(220,38,38,.35);
      color: #fca5a5; padding: 8px 16px; border-radius: 8px; font-size: .85rem; animation: ddw-fadeUp .3s ease-out; }

    @keyframes ddw-fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    .ddw-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; margin-top: 20px;
      animation: ddw-fadeUp .35s ease-out; }

    .ddw-banner { display: flex; align-items: center; gap: 20px; padding: 20px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .ddw-img { width: 100px; height: 100px; border-radius: 12px; border: 2px solid rgba(212,175,55,.35); object-fit: cover; background: var(--bg);
      animation: ddw-glow 2s ease-in-out infinite; }
    @keyframes ddw-glow { 0%,100% { box-shadow: 0 0 8px rgba(212,175,55,.25); } 50% { box-shadow: 0 0 20px rgba(212,175,55,.45); } }
    .ddw-info { flex: 1; min-width: 180px; }
    .ddw-info h3 { font-size: 1.15rem; font-weight: 700; color: var(--white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ddw-info .ddw-insc { font-family: 'JetBrains Mono', monospace; font-size: .75rem; color: var(--muted); margin-top: 3px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ddw-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .ddw-badge { padding: 2px 8px; border-radius: 4px; font-size: .7rem; font-weight: 600; border: 1px solid; }
    .ddw-badge-listed { background: rgba(34,197,94,.1); color: #4ade80; border-color: rgba(34,197,94,.3); }
    .ddw-badge-unlisted { background: rgba(156,163,175,.1); color: #9ca3af; border-color: rgba(156,163,175,.25); }
    .ddw-badge-rarity { background: rgba(168,85,247,.1); color: #c084fc; border-color: rgba(168,85,247,.3); }

    .ddw-prices { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 20px; border-bottom: 1px solid var(--border); }
    @media (max-width: 480px) { .ddw-prices { grid-template-columns: 1fr; } }
    .ddw-price-box { text-align: center; padding: 14px; background: var(--bg); border-radius: 12px; border: 1px solid var(--border); }
    .ddw-price-label { font-size: .65rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 4px; }
    .ddw-price-val { font-size: 1.35rem; font-weight: 700; }
    .ddw-price-val.gold { color: var(--gold); }
    .ddw-price-sub { font-size: .8rem; color: var(--muted); margin-top: 2px; }

    .ddw-analysis { padding: 20px; border-bottom: 1px solid var(--border); }
    .ddw-section-title { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 10px; }
    .ddw-analysis-row { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; font-size: .85rem; }
    .ddw-analysis-row .label { color: var(--muted); }
    .ddw-analysis-row .val { font-weight: 600; color: var(--white); }
    .ddw-green { color: #4ade80; } .ddw-red { color: #f87171; } .ddw-yellow { color: #facc15; }

    .ddw-traits { padding: 20px; }
    .ddw-trait { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px;
      border-radius: 6px; background: var(--bg); border: 1px solid var(--border); font-size: .85rem; margin-bottom: 6px; transition: background .15s; }
    .ddw-trait:hover { background: var(--border); }
    .ddw-trait-key { color: var(--muted); text-transform: capitalize; flex-shrink: 0; }
    .ddw-trait-val { color: var(--white); font-weight: 500; }
    .ddw-trait-floor { color: var(--muted); font-size: .75rem; margin-left: auto; flex-shrink: 0; }
    .ddw-trait-floor.unlisted { color: #c084fc; }
    .ddw-trait-sale { color: #4ade80; font-size: .7rem; font-weight: 400; }
    .ddw-trait-count { color: #666; font-size: .65rem; }
    .ddw-trait.top-sale-row { border-color: rgba(212,175,55,.4); background: rgba(212,175,55,.06); }
    .ddw-top-sale-badge { display: inline-flex; align-items: center; gap: 3px; background: rgba(212,175,55,.15); color: #d4af37; border: 1px solid rgba(212,175,55,.4); border-radius: 4px; padding: 1px 6px; font-size: .65rem; font-weight: 700; white-space: nowrap; }
    .ddw-top-sale-badge svg { width: 12px; height: 12px; fill: #d4af37; }
    .ddw-trending-badge { display: inline-flex; align-items: center; gap: 3px; background: rgba(255,100,50,.15); color: #ff6432; border: 1px solid rgba(255,100,50,.4); border-radius: 4px; padding: 1px 6px; font-size: .65rem; font-weight: 700; white-space: nowrap; }
    .ddw-trait.trending-row { border-color: rgba(255,100,50,.3); background: rgba(255,100,50,.04); }
    .ddw-own-sale { padding: 14px 20px; border-bottom: 1px solid var(--border); background: rgba(212,175,55,.04); }
    .ddw-own-sale-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--gold); font-weight: 600; display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
    .ddw-own-sale-label svg { width: 14px; height: 14px; fill: var(--gold); }
    .ddw-own-sale-value { font-size: 1.1rem; font-weight: 700; color: var(--gold); }

    .ddw-meta { display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 20px 4px; font-size: .7rem; color: var(--muted); }
    .ddw-ts { padding: 4px 20px 14px; text-align: right; font-size: .65rem; color: var(--muted); opacity: .7; }

    .ddw-footer { text-align: center; font-size: .7rem; color: var(--muted); padding: 12px 0 4px; border-top: 1px solid var(--border); margin-top: 8px; }
    .ddw-footer a { color: var(--gold); text-decoration: none; }
    .ddw-footer a:hover { text-decoration: underline; }
  `;

  /* ---- Helpers ---- */
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmt(n, dec = 0) { return n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'; }
  function fmtD(n) { return n != null ? fmt(n) + ' DOGE' : '—'; }
  function fmtU(n) { return n != null ? '$' + fmt(n, 2) : ''; }
  function vClass(v) { return v === 'undervalued' ? 'ddw-green' : v === 'overpriced' ? 'ddw-red' : 'ddw-yellow'; }
  function vIcon(v)  { return v === 'undervalued' ? '&#9650;' : v === 'overpriced' ? '&#9660;' : '&#9644;'; }

  /* ---- Build DOM ---- */
  function mount() {
    const root = document.getElementById(cfg.target);
    if (!root) { console.error(`[DD Widget] Container #${cfg.target} not found.`); return; }

    root.classList.add('ddw');
    if (cfg.theme === 'light') root.classList.add('light');

    // Inject scoped styles
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    root.appendChild(styleEl);

    root.insertAdjacentHTML('beforeend', `
      <div class="ddw-header">
        <h2><span>Doginal Dogs</span> Price Evaluator</h2>
        <p>Trait-weighted valuation powered by live market data</p>
      </div>
      <form class="ddw-form" id="ddw-form">
        <div class="ddw-input-wrap">
          <span class="ddw-hash">#</span>
          <input class="ddw-input" id="ddw-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Enter dog number (1–10000)" />
        </div>
        <button class="ddw-btn" type="submit" id="ddw-btn">Evaluate Price</button>
      </form>
      <div id="ddw-status" class="ddw-status"></div>
      <div id="ddw-result"></div>
      <div class="ddw-footer">
        Data from <a href="https://market.doginaldogs.com" target="_blank" rel="noopener">market.doginaldogs.com</a> &middot; DDScraper evaluation engine
      </div>
    `);

    const form     = root.querySelector('#ddw-form');
    const input    = root.querySelector('#ddw-input');
    const btn      = root.querySelector('#ddw-btn');
    const statusEl = root.querySelector('#ddw-status');
    const resultEl = root.querySelector('#ddw-result');

    function showLoading() {
      btn.disabled = true;
      statusEl.innerHTML = '<span class="ddw-spinner"></span> Evaluating…';
      resultEl.innerHTML = '';
    }

    function showError(msg) {
      btn.disabled = false;
      statusEl.innerHTML = `<span class="ddw-error">${esc(msg)}</span>`;
      resultEl.innerHTML = '';
    }

    function clearStatus() { btn.disabled = false; statusEl.innerHTML = ''; }

    function renderResult(d) {
      clearStatus();
      const est = d.estimation || {};
      const la = d.listingAnalysis;
      const pawSvg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21c-1.5 0-3.5-2-4.5-3.5S5 14 5 12.5 6.5 10 8 10s2.5.5 3 1.5c.3.6.7 1 1 1s.7-.4 1-1C13.5 10.5 14.5 10 16 10s3 1 3 2.5S18 16 17 17.5 13.5 21 12 21zM6.5 9C5.1 9 4 7.9 4 6.5S5.1 4 6.5 4 9 5.1 9 6.5 7.9 9 6.5 9zm4-2C9.7 7 9 6.3 9 5.5S9.7 4 10.5 4s1.5.7 1.5 1.5S11.3 7 10.5 7zm3 0c-.8 0-1.5-.7-1.5-1.5S12.7 4 13.5 4s1.5.7 1.5 1.5S14.3 7 13.5 7zm4 2C16.1 9 15 7.9 15 6.5S16.1 4 17.5 4 20 5.1 20 6.5 18.9 9 17.5 9z"/></svg>';

      const traits = (d.traitBreakdown || []).map(t => {
        const priceLabel = t.topSale != null
          ? fmtD(t.topSale)
          : (t.floor != null ? fmtD(t.floor) : 'unlisted');
        const saleInfo = t.saleCount > 0
          ? ` <span class="ddw-trait-sale">(${t.saleCount} sale${t.saleCount > 1 ? 's' : ''})</span>`
          : '';
        const countInfo = t.traitCount != null
          ? ` <span class="ddw-trait-count">(${t.traitCount}/10k)</span>`
          : '';
        const isUnlisted = t.topSale == null && t.floor == null;
        const topBadge = t.isTopSale
          ? ` <span class="ddw-top-sale-badge">${pawSvg}TOP SALE</span>`
          : '';
        const trendBadge = t.trending
          ? ` <span class="ddw-trending-badge">🔥 TRENDING ${t.trending}x</span>`
          : '';
        const rowClass = (t.isTopSale ? ' top-sale-row' : '') + (t.trending ? ' trending-row' : '');
        return `
        <div class="ddw-trait${rowClass}">
          <span class="ddw-trait-key">${esc(t.trait)}${countInfo}</span>
          <span class="ddw-trait-val">${esc(t.value)}</span>
          <span class="ddw-trait-floor${isUnlisted ? ' unlisted' : ''}">${priceLabel}${saleInfo}${topBadge}${trendBadge}</span>
        </div>`;
      }).join('');

      resultEl.innerHTML = `
      <div class="ddw-card">
        <div class="ddw-banner">
          <img class="ddw-img" src="${esc(d.imageUrl)}" alt="${esc(d.name)}" onerror="this.style.display='none'" />
          <div class="ddw-info">
            <h3>${esc(d.name)}</h3>
            ${d.inscriptionId ? `<div class="ddw-insc">${esc(d.inscriptionId)}</div>` : ''}
            <div class="ddw-badges">
              <span class="ddw-badge ${d.isListed ? 'ddw-badge-listed' : 'ddw-badge-unlisted'}">${d.isListed ? 'Listed' : 'Not Listed'}</span>
              <span class="ddw-badge ddw-badge-rarity">Rarity #${fmt(d.rarityRank)} &middot; ${esc(d.rarityLabel || '')}</span>
            </div>
          </div>
        </div>

        <div class="ddw-prices">
          <div class="ddw-price-box">
            <div class="ddw-price-label">Estimated Value</div>
            <div class="ddw-price-val gold">${fmtD(est.estimatedDoge)}</div>
            ${est.estimatedUsd ? `<div class="ddw-price-sub">${fmtU(est.estimatedUsd)}</div>` : ''}
          </div>
          <div class="ddw-price-box">
            <div class="ddw-price-label">Collection Floor</div>
            <div class="ddw-price-val">${fmtD(est.collectionFloor)}</div>
            ${est.dogeUsd && est.collectionFloor ? `<div class="ddw-price-sub">${fmtU(est.collectionFloor * est.dogeUsd)}</div>` : ''}
          </div>
        </div>

        ${la ? `
        <div class="ddw-analysis">
          <div class="ddw-section-title">Listing Analysis</div>
          <div class="ddw-analysis-row">
            <div><span class="label">Asking:</span> <span class="val">${fmtD(la.askingPriceDoge)}</span></div>
            <div><span class="label">vs Estimate:</span> <span class="${vClass(la.verdict)}">${la.diffPercent > 0 ? '+' : ''}${la.diffPercent}%</span></div>
            <div class="${vClass(la.verdict)}" style="font-weight:700">${vIcon(la.verdict)} ${esc(la.verdict)}</div>
          </div>
        </div>` : ''}

        ${est.ownTopSale ? `
        <div class="ddw-own-sale">
          <div class="ddw-own-sale-label">${pawSvg} This Dog Sold Recently</div>
          <div class="ddw-own-sale-value">${fmtD(est.ownTopSale)}</div>
        </div>` : ''}

        <div class="ddw-traits">
          <div class="ddw-section-title">Trait Breakdown</div>
          ${traits}
          <div class="ddw-meta">
            ${est.rarestTrait ? `<span>Rarest: ${esc(est.rarestTrait.value)} ${esc(est.rarestTrait.trait)} (${est.rarestTrait.count}/10k)</span>` : ''}
            ${est.basePriceDoge ? `<span>Base price: ${fmtD(est.basePriceDoge)}</span>` : ''}
            ${est.traitBonus > 0 ? `<span>Trait bonus: +${fmtD(est.traitBonus)}</span>` : ''}
            ${est.trendingMultiplier ? `<span>🔥 Trending: ${est.trendingMultiplier}x</span>` : ''}
            <span>Rarity multiplier: ${d.rarityMultiplier ? d.rarityMultiplier + 'x' : '—'}</span>
          </div>
        </div>

        <div class="ddw-ts">Evaluated ${new Date(d.evaluatedAt).toLocaleString()}</div>
      </div>`;
    }

    async function evaluate() {
      const num = parseInt(String(input.value).replace(/[^0-9]/g, ''), 10);
      if (!num || num < 1 || num > 10000) {
        showError('Enter a valid dog number between 1 and 10,000.');
        return;
      }
      showLoading();
      try {
        const apiUrl = cfg.api.replace(/\/+$/, '');
        const res = await fetch(`${apiUrl}/api/evaluate/${encodeURIComponent(num)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Server returned ${res.status}`);
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderResult(data);
      } catch (err) {
        showError(err.message || 'Something went wrong. Please try again.');
      }
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); evaluate(); });
  }

  /* ---- Public API (optional programmatic init) ---- */
  window.DDWidget = {
    init: function (opts) {
      if (opts?.api)    cfg.api    = opts.api;
      if (opts?.target) cfg.target = opts.target;
      if (opts?.theme)  cfg.theme  = opts.theme;
      mount();
    },
  };

  // Auto-mount if container exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
