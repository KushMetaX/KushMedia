import {
  fetchDesignSource,
  loadBrandPalette,
  loadDesignerState,
  saveDesignerState
} from './data-service.js';
import {
  renderCombinedCanvas,
  renderNailCanvas
} from './canvas-renderer.js';
import {
  NAIL_ORDER,
  generateNailDesign
} from './design-generator.js';
import {
  buildFileStem,
  downloadCanvas
} from './png-export.js';
import {
  NAIL_FINISHES,
  NAIL_SHAPES,
  getStyleDefinition,
  populateStyleSelector
} from './style-selector.js';
import {
  generateAiNails
} from './ai-service.js';

/* ─── Constants ──────────────────────────────────────── */

const FINGERS = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);

const BRAND_ASSETS = Object.freeze([
  { key: 'woofwoof', label: 'WoofWoof', url: '/assets/WoofWoof.png' },
  { key: 'gary', label: 'Gary', url: '/assets/Gary.png' },
  { key: 'ddLogoBlack', label: 'DD Logo Black', url: '/assets/DD LOGO Black.png' },
  { key: 'maryNoBG', label: 'MaryNoBG', url: '/assets/MaryNoBG.png' },
  { key: 'portrait', label: 'Inscription Image', url: null }
]);

const BRAND_ASSET_URLS = Object.freeze(
  Object.fromEntries(BRAND_ASSETS.filter(a => a.url).map(a => [a.key, a.url]))
);

const AUTO_RESTORE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

/* ─── State helpers ──────────────────────────────────── */

function createDefaultAssetState() {
  return { enabled: false, x: 0, y: 0, scale: 1, rotation: 0, flipV: false };
}

function createDefaultNailState() {
  const assets = {};
  for (const a of BRAND_ASSETS) {
    assets[a.key] = createDefaultAssetState();
  }
  return { baseColor: null, aiImage: null, assets };
}

function createDefaultState() {
  const nails = {};
  for (const f of FINGERS) {
    nails[f] = createDefaultNailState();
  }
  return {
    activeNail: 'thumb',
    activeSwatch: null,
    shape: 'almond',
    finish: 'glazed',
    nails
  };
}

/* ─── UI helpers ─────────────────────────────────────── */

function populateChoiceSelector(el, options) {
  if (!el) return;
  el.innerHTML = '';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    el.appendChild(o);
  }
}

function setStatus(el, text, tone) {
  el.textContent = text;
  el.dataset.tone = tone;
}

function applyBrandPalette(root, colors) {
  if (!root || !colors) return;
  root.style.setProperty('--nail-accent', colors.accent);
  root.style.setProperty('--nail-surface', colors.surface);
  root.style.setProperty('--nail-background', colors.background);
  root.style.setProperty('--nail-text', colors.text);
  root.style.setProperty('--nail-white', colors.white);
}

/* ─── Custom select controller (kept from v1) ────────── */

function createCustomSelectController(selectElement, closeOtherMenus) {
  if (!selectElement) return { sync() {}, close() {}, rebuild() {} };
  const field = selectElement.closest('.nail-field');
  if (!field) return { sync() {}, close() {}, rebuild() {} };

  field.classList.add('nail-field--select');
  selectElement.classList.add('nail-native-select');

  const shell = document.createElement('div');
  shell.className = 'nail-select-shell';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'nail-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'nail-select-label';
  const triggerIcon = document.createElement('span');
  triggerIcon.className = 'nail-select-icon';
  triggerIcon.setAttribute('aria-hidden', 'true');
  triggerIcon.innerHTML = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M1.41 3.84 6 8.41l4.59-4.57L12 5.25 6 11.25 0 5.25z"></path></svg>';
  const menu = document.createElement('div');
  menu.className = 'nail-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.id = `${selectElement.id || 'sel'}-menu`;
  trigger.setAttribute('aria-controls', menu.id);
  trigger.append(triggerLabel, triggerIcon);
  shell.append(trigger, menu);
  selectElement.insertAdjacentElement('afterend', shell);

  const labelEl = field.querySelector(`label[for="${selectElement.id}"]`);
  let optBtns = [];
  let docBound = false;

  function getLabel(opt) {
    return opt ? String(opt.label || opt.textContent || opt.value || '').trim() || 'Select' : 'Select';
  }

  function bind() { if (!docBound) { document.addEventListener('pointerdown', onDocDown, true); document.addEventListener('keydown', onDocKey, true); docBound = true; } }
  function unbind() { if (docBound) { document.removeEventListener('pointerdown', onDocDown, true); document.removeEventListener('keydown', onDocKey, true); docBound = false; } }

  function focusByOff(off) {
    const en = optBtns.filter(b => !b.disabled);
    if (!en.length) return;
    const ci = en.indexOf(document.activeElement);
    en[(ci === -1 ? (off > 0 ? 0 : en.length - 1) : (ci + off + en.length) % en.length)].focus();
  }

  function openMenu() {
    if (trigger.disabled || !optBtns.length) return;
    closeOtherMenus(api);
    shell.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    bind();
    const sel = optBtns.find(b => b.dataset.value === selectElement.value && !b.disabled) || optBtns.find(b => !b.disabled);
    if (sel) sel.focus();
  }

  function closeMenu(opts) {
    if (!shell.classList.contains('is-open')) return;
    shell.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    unbind();
    if (opts && opts.focusTrigger) trigger.focus();
  }

  function sync() {
    if (selectElement.options.length && selectElement.selectedIndex < 0) selectElement.selectedIndex = 0;
    const cur = selectElement.selectedOptions[0] || selectElement.options[0] || null;
    triggerLabel.textContent = getLabel(cur);
    trigger.disabled = selectElement.disabled || !selectElement.options.length;
    optBtns.forEach(b => {
      const sel = b.dataset.value === selectElement.value;
      b.classList.toggle('is-selected', sel);
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
    });
  }

  function apply(v) {
    selectElement.value = v;
    sync();
    closeMenu();
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function rebuild() {
    menu.innerHTML = '';
    optBtns = [];
    [...selectElement.options].forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nail-select-option';
      btn.textContent = getLabel(opt);
      btn.dataset.value = opt.value;
      btn.setAttribute('role', 'option');
      btn.disabled = opt.disabled;
      if (opt.disabled) btn.classList.add('is-disabled');
      btn.addEventListener('click', () => { if (!opt.disabled) apply(opt.value); });
      btn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); focusByOff(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusByOff(-1); }
        else if (e.key === 'Escape') { e.preventDefault(); closeMenu({ focusTrigger: true }); }
        else if (e.key === 'Tab') closeMenu();
      });
      optBtns.push(btn);
      menu.appendChild(btn);
    });
    sync();
  }

  function onDocDown(e) { if (!shell.contains(e.target)) closeMenu(); }
  function onDocKey(e) { if (e.key === 'Escape') closeMenu({ focusTrigger: true }); }

  trigger.addEventListener('click', () => shell.classList.contains('is-open') ? closeMenu() : openMenu());
  trigger.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
  });
  if (labelEl) labelEl.addEventListener('click', e => { e.preventDefault(); openMenu(); });
  selectElement.addEventListener('change', sync);

  const api = { close() { closeMenu(); }, rebuild, sync };
  rebuild();
  return api;
}

/* ─── Main initializer ───────────────────────────────── */

async function initializeNailDesigner() {
  const root = document.getElementById('nailDesignerApp');
  if (!root) return;

  /* ── DOM refs ────────────────────────────────────── */
  const form = root.querySelector('#nailDesignerForm');
  const numberInput = root.querySelector('#inscriptionNumber');
  const styleSelect = root.querySelector('#designStyle');
  const shapeSelect = root.querySelector('#nailShape');
  const finishSelect = root.querySelector('#nailFinish');
  const statusEl = root.querySelector('#designerStatus');
  const descEl = root.querySelector('#designerStyleDescription');
  const combinedCanvas = root.querySelector('#combinedDesignCanvas');
  const downloadCombinedBtn = root.querySelector('#downloadCombinedBtn');
  const generateAiBtn = root.querySelector('#generateAiBtn');
  const autoAssignBtn = root.querySelector('#autoAssignColorsBtn');
  const paletteSection = root.querySelector('#paletteSection');
  const swatchBg = root.querySelector('#swatchBg');
  const swatchPrimary = root.querySelector('#swatchPrimary');
  const swatchAccent = root.querySelector('#swatchAccent');
  const assetGrid = root.querySelector('#assetGrid');
  const activeNailPanel = root.querySelector('#activeNailPanel');
  const activeNailLabel = root.querySelector('#activeNailLabel');
  const activeNailHint = root.querySelector('#activeNailHint');
  const activeNailAssets = root.querySelector('#activeNailAssets');
  const resetActiveNailBtn = root.querySelector('#resetActiveNailBtn');
  const individualBtns = [...root.querySelectorAll('[data-download-nail]')];
  const nailCards = [...root.querySelectorAll('[data-nail-card]')];

  const canvasMap = {};
  const loaderMap = {};
  const colorInputMap = {};
  const colorLabelMap = {};
  const badgeMap = {};
  for (const f of FINGERS) {
    canvasMap[f] = root.querySelector(`[data-nail-canvas="${f}"]`);
    loaderMap[f] = root.querySelector(`[data-nail-loader="${f}"]`);
    colorInputMap[f] = root.querySelector(`[data-nail-color="${f}"]`);
    colorLabelMap[f] = root.querySelector(`[data-nail-color-label="${f}"]`);
    badgeMap[f] = root.querySelector(`[data-nail-badges="${f}"]`);
  }

  const metaEls = {
    source: root.querySelector('#designerSource'),
    rarity: root.querySelector('#designerRarity'),
    accessory: root.querySelector('#designerAccessory'),
    colors: root.querySelector('#designerPalette'),
    market: root.querySelector('#designerMarket'),
    traits: root.querySelector('#designerTraits')
  };

  /* ── State ───────────────────────────────────────── */
  let state = createDefaultState();
  let currentDesign = null;
  let currentRecord = null;
  let rerenderTimer = 0;
  let renderSeq = 0;

  /* ── Custom selects ──────────────────────────────── */
  const csControllers = [];
  function closeOtherMenus(except) { csControllers.forEach(c => { if (c !== except) c.close(); }); }

  populateStyleSelector(styleSelect);
  populateChoiceSelector(shapeSelect, NAIL_SHAPES);
  populateChoiceSelector(finishSelect, NAIL_FINISHES);
  csControllers.push(
    createCustomSelectController(styleSelect, closeOtherMenus),
    createCustomSelectController(shapeSelect, closeOtherMenus),
    createCustomSelectController(finishSelect, closeOtherMenus)
  );

  const palette = await loadBrandPalette();
  applyBrandPalette(root, palette);
  setStatus(statusEl, 'Ready to generate.', 'neutral');

  /* ── Asset grid generation ───────────────────────── */
  const checkboxMap = {}; // checkboxMap[assetKey][finger] = checkbox
  function buildAssetGrid() {
    // Keep the header row, clear everything after it
    const header = assetGrid.querySelector('.nd-asset-grid-header');
    while (header.nextSibling) header.nextSibling.remove();

    for (const asset of BRAND_ASSETS) {
      checkboxMap[asset.key] = {};
      const row = document.createElement('div');
      row.className = 'nd-asset-row';

      const label = document.createElement('div');
      label.className = 'nd-asset-row-label';
      if (asset.url) {
        const thumb = document.createElement('img');
        thumb.className = 'nd-asset-thumb';
        thumb.src = asset.url;
        thumb.alt = asset.label;
        thumb.loading = 'lazy';
        label.appendChild(thumb);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'nd-asset-thumb';
        placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);font-size:16px;';
        placeholder.textContent = '🐕';
        label.appendChild(placeholder);
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'nd-asset-name';
      nameSpan.textContent = asset.label;
      label.appendChild(nameSpan);
      row.appendChild(label);

      for (const f of FINGERS) {
        const cell = document.createElement('div');
        cell.className = 'nd-asset-cell';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'nd-asset-check';
        cb.dataset.asset = asset.key;
        cb.dataset.nail = f;
        cb.checked = state.nails[f].assets[asset.key].enabled;
        cb.addEventListener('change', () => {
          state.nails[f].assets[asset.key].enabled = cb.checked;
          updateNailBadges(f);
          if (f === state.activeNail) renderActiveNailControls();
          queueRender('Asset toggled.');
        });
        checkboxMap[asset.key][f] = cb;
        cell.appendChild(cb);
        row.appendChild(cell);
      }

      assetGrid.appendChild(row);
    }
  }
  buildAssetGrid();

  /* ── Nail card click → select active ─────────────── */
  function setActiveNail(finger) {
    state.activeNail = finger;
    nailCards.forEach(c => c.classList.toggle('is-active', c.dataset.nailCard === finger));
    activeNailLabel.textContent = finger.charAt(0).toUpperCase() + finger.slice(1);
    renderActiveNailControls();
  }

  nailCards.forEach(card => {
    card.addEventListener('click', () => setActiveNail(card.dataset.nailCard));
  });

  /* ── Nail color pickers ──────────────────────────── */
  for (const f of FINGERS) {
    colorInputMap[f].addEventListener('input', () => {
      state.nails[f].baseColor = colorInputMap[f].value;
      colorLabelMap[f].textContent = colorInputMap[f].value;
      queueRender('Color updated.');
    });
  }

  /* ── Palette swatches ────────────────────────────── */
  const swatchEls = [swatchBg, swatchPrimary, swatchAccent];
  function updateSwatchUI() {
    swatchEls.forEach(el => el.classList.remove('is-active'));
    if (state.activeSwatch != null) {
      swatchEls[state.activeSwatch].classList.add('is-active');
    }
  }

  swatchEls.forEach((sw, i) => {
    sw.addEventListener('click', () => {
      if (state.activeSwatch === i) {
        state.activeSwatch = null;
      } else {
        state.activeSwatch = i;
      }
      updateSwatchUI();
    });
  });

  // Clicking a nail card with active swatch assigns color
  nailCards.forEach(card => {
    card.addEventListener('click', () => {
      if (state.activeSwatch != null && currentRecord) {
        const colors = [
          currentRecord.background?.color,
          currentRecord.primary?.color,
          currentRecord.accent?.color
        ];
        const color = colors[state.activeSwatch];
        if (color) {
          const f = card.dataset.nailCard;
          state.nails[f].baseColor = color;
          colorInputMap[f].value = color;
          colorLabelMap[f].textContent = color;
          queueRender('Color assigned from palette.');
        }
      }
    });
  });

  function showPalette(record) {
    if (!record) return;
    const colors = [
      { el: swatchBg, name: record.background?.name || 'Bg', color: record.background?.color || '#888' },
      { el: swatchPrimary, name: record.primary?.name || 'Primary', color: record.primary?.color || '#888' },
      { el: swatchAccent, name: record.accent?.name || 'Accent', color: record.accent?.color || '#888' }
    ];
    colors.forEach(c => {
      c.el.querySelector('.nd-swatch-dot').style.background = c.color;
      c.el.querySelector('.nd-swatch-name').textContent = c.name;
    });
  }

  /* ── Auto-assign colors ──────────────────────────── */
  autoAssignBtn.addEventListener('click', () => {
    if (!currentRecord) return;
    const colors = [
      currentRecord.background?.color,
      currentRecord.primary?.color,
      currentRecord.accent?.color
    ].filter(Boolean);
    if (!colors.length) return;

    FINGERS.forEach((f, i) => {
      const c = colors[i % colors.length];
      state.nails[f].baseColor = c;
      colorInputMap[f].value = c;
      colorLabelMap[f].textContent = c;
    });
    queueRender('Colors auto-assigned.');
  });

  /* ── Active nail control panel ───────────────────── */
  function renderActiveNailControls() {
    const f = state.activeNail;
    const ns = state.nails[f];
    const enabledAssets = BRAND_ASSETS.filter(a => ns.assets[a.key].enabled);

    const hasOverride = enabledAssets.length > 0 || ns.baseColor || ns.aiImage;
    activeNailHint.textContent = enabledAssets.length
      ? `${enabledAssets.length} asset(s) enabled on this nail.`
      : 'No assets enabled. Use the grid above to toggle.';
    resetActiveNailBtn.disabled = !hasOverride;

    activeNailAssets.innerHTML = '';

    if (!enabledAssets.length) {
      const empty = document.createElement('div');
      empty.className = 'nd-active-empty';
      empty.textContent = 'Enable assets in the grid above, then adjust them here.';
      activeNailAssets.appendChild(empty);
      return;
    }

    for (const asset of enabledAssets) {
      const as = ns.assets[asset.key];
      const row = document.createElement('div');
      row.className = 'nd-active-asset-row';

      // thumb
      if (asset.url) {
        const img = document.createElement('img');
        img.className = 'nd-active-asset-thumb';
        img.src = asset.url;
        img.alt = asset.label;
        row.appendChild(img);
      } else {
        const ph = document.createElement('span');
        ph.className = 'nd-active-asset-thumb';
        ph.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);border-radius:10px;font-size:20px;';
        ph.textContent = '🐕';
        row.appendChild(ph);
      }

      // name
      const name = document.createElement('span');
      name.className = 'nd-active-asset-name';
      name.textContent = asset.label;
      row.appendChild(name);

      // Scale control
      const scaleCtrl = document.createElement('div');
      scaleCtrl.className = 'nd-active-asset-control';
      const scaleLabel = document.createElement('label');
      scaleLabel.textContent = 'Size';
      const scaleInput = document.createElement('input');
      scaleInput.type = 'range';
      scaleInput.min = '0.1';
      scaleInput.max = '3';
      scaleInput.step = '0.05';
      scaleInput.value = String(as.scale);
      scaleInput.addEventListener('input', () => {
        as.scale = parseFloat(scaleInput.value);
        queueRender('Scale updated.');
      });
      scaleCtrl.append(scaleLabel, scaleInput);
      row.appendChild(scaleCtrl);

      // Rotation control
      const rotCtrl = document.createElement('div');
      rotCtrl.className = 'nd-active-asset-control';
      const rotLabel = document.createElement('label');
      rotLabel.textContent = 'Rotate';
      const rotInput = document.createElement('input');
      rotInput.type = 'range';
      rotInput.min = '-180';
      rotInput.max = '180';
      rotInput.step = '1';
      rotInput.value = String(as.rotation);
      rotInput.addEventListener('input', () => {
        as.rotation = parseInt(rotInput.value, 10);
        queueRender('Rotation updated.');
      });
      rotCtrl.append(rotLabel, rotInput);
      row.appendChild(rotCtrl);

      // Flip button
      const flipCtrl = document.createElement('div');
      flipCtrl.className = 'nd-active-asset-control';
      const flipBtn = document.createElement('button');
      flipBtn.type = 'button';
      flipBtn.textContent = 'Flip V';
      flipBtn.classList.toggle('is-on', as.flipV);
      flipBtn.addEventListener('click', () => {
        as.flipV = !as.flipV;
        flipBtn.classList.toggle('is-on', as.flipV);
        queueRender('Flip updated.');
      });
      flipCtrl.appendChild(flipBtn);
      row.appendChild(flipCtrl);

      // Move X
      const xCtrl = document.createElement('div');
      xCtrl.className = 'nd-active-asset-control';
      const xLabel = document.createElement('label');
      xLabel.textContent = 'X';
      const xInput = document.createElement('input');
      xInput.type = 'range';
      xInput.min = '-50';
      xInput.max = '50';
      xInput.step = '1';
      xInput.value = String(as.x);
      xInput.addEventListener('input', () => {
        as.x = parseInt(xInput.value, 10);
        queueRender('Position updated.');
      });
      xCtrl.append(xLabel, xInput);
      row.appendChild(xCtrl);

      // Move Y
      const yCtrl = document.createElement('div');
      yCtrl.className = 'nd-active-asset-control';
      const yLabel = document.createElement('label');
      yLabel.textContent = 'Y';
      const yInput = document.createElement('input');
      yInput.type = 'range';
      yInput.min = '-50';
      yInput.max = '50';
      yInput.step = '1';
      yInput.value = String(as.y);
      yInput.addEventListener('input', () => {
        as.y = parseInt(yInput.value, 10);
        queueRender('Position updated.');
      });
      yCtrl.append(yLabel, yInput);
      row.appendChild(yCtrl);

      activeNailAssets.appendChild(row);
    }
  }

  /* ── Reset active nail ───────────────────────────── */
  resetActiveNailBtn.addEventListener('click', () => {
    const f = state.activeNail;
    state.nails[f] = createDefaultNailState();
    // Uncheck all checkboxes for this nail
    for (const a of BRAND_ASSETS) {
      if (checkboxMap[a.key] && checkboxMap[a.key][f]) {
        checkboxMap[a.key][f].checked = false;
      }
    }
    colorInputMap[f].value = '#000000';
    colorLabelMap[f].textContent = 'auto';
    updateNailBadges(f);
    renderActiveNailControls();
    queueRender('Nail reset.');
  });

  /* ── Nail badges ─────────────────────────────────── */
  function updateNailBadges(finger) {
    const container = badgeMap[finger];
    if (!container) return;
    container.innerHTML = '';
    const ns = state.nails[finger];
    for (const a of BRAND_ASSETS) {
      if (ns.assets[a.key].enabled) {
        const badge = document.createElement('span');
        badge.className = 'nd-nail-badge';
        badge.innerHTML = '<span class="nd-nail-badge-dot"></span>';
        badge.appendChild(document.createTextNode(a.label.length > 8 ? a.label.slice(0, 7) + '…' : a.label));
        container.appendChild(badge);
      }
    }
  }

  /* ── Update meta ─────────────────────────────────── */
  function updateMeta(record, design) {
    metaEls.source.textContent = `${design.summary.sourceLabel} • ${design.summary.shapeLabel} / ${design.summary.finishLabel}`;
    metaEls.rarity.textContent = record.rarityRank ? `${record.rarityLabel} • Rank ${record.rarityRank}` : record.rarityLabel;
    metaEls.accessory.textContent = record.accessory?.name || 'None';
    metaEls.colors.textContent = `${record.background?.name || '?'} / ${record.primary?.name || '?'} / ${record.accent?.name || '?'}`;
    metaEls.market.textContent = record.market?.isListed && record.market.priceDoge
      ? `${record.market.priceDoge.toLocaleString()} DOGE listed`
      : 'Not currently listed';
    metaEls.traits.innerHTML = '';
    const traitSummary = design.summary.traitSummary || [];
    for (const t of traitSummary) {
      const pill = document.createElement('span');
      pill.className = 'nail-trait-pill';
      pill.textContent = t;
      metaEls.traits.appendChild(pill);
    }
  }

  /* ── Downloads ───────────────────────────────────── */
  function setDownloadsEnabled(enabled) {
    downloadCombinedBtn.disabled = !enabled;
    individualBtns.forEach(b => { b.disabled = !enabled; });
  }
  setDownloadsEnabled(false);

  downloadCombinedBtn.addEventListener('click', async () => {
    if (!currentDesign) return;
    await downloadCanvas(combinedCanvas, `${buildFileStem(currentDesign)}.png`);
  });

  individualBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentDesign) return;
      const nailId = btn.dataset.downloadNail;
      const canvas = canvasMap[nailId];
      if (!canvas) return;
      await downloadCanvas(canvas, `${buildFileStem(currentDesign)}-${nailId}.png`);
    });
  });

  /* ── Build editor state for design-generator ─────── */
  function getEditorState() {
    // Build legacy-compatible editor state from new state model
    const assetToggles = {};
    const assetScales = {};
    for (const a of BRAND_ASSETS) {
      // Asset is "globally on" if it's enabled on any nail
      assetToggles[a.key] = FINGERS.some(f => state.nails[f].assets[a.key].enabled);
      assetScales[a.key] = 100;
    }

    const perNail = {};
    for (const f of FINGERS) {
      const ns = state.nails[f];
      const overrides = {};
      // Check which assets are on this nail
      const enabledAssets = BRAND_ASSETS.filter(a => ns.assets[a.key].enabled);

      // Map to legacy logoAssetChoice / sloganAssetChoice
      const logoAsset = enabledAssets.find(a => a.key === 'gary' || a.key === 'ddLogoBlack' || a.key === 'maryNoBG');
      const sloganAsset = enabledAssets.find(a => a.key === 'woofwoof');

      if (logoAsset) {
        overrides.logoAssetChoice = logoAsset.key;
        overrides.logoMode = 'on';
        overrides.logoOffsetX = Math.round(ns.assets[logoAsset.key].x);
        overrides.logoOffsetY = Math.round(ns.assets[logoAsset.key].y);
        overrides.logoFlipVertical = ns.assets[logoAsset.key].flipV;
      } else {
        overrides.logoMode = 'off';
      }

      if (sloganAsset) {
        overrides.sloganAssetChoice = 'woofwoof';
        overrides.sloganMode = 'on';
        overrides.sloganOffsetX = Math.round(ns.assets.woofwoof.x);
        overrides.sloganOffsetY = Math.round(ns.assets.woofwoof.y);
        overrides.sloganFlipVertical = ns.assets.woofwoof.flipV;
      } else {
        overrides.sloganMode = 'off';
      }

      if (Object.keys(overrides).length) {
        perNail[f] = overrides;
      }
    }

    return {
      shape: state.shape,
      finish: state.finish,
      assetToggles,
      assetScales,
      detailIntensity: 72,
      portraitZoom: 92,
      previewZoom: 100,
      activeNail: state.activeNail,
      perNail
    };
  }

  /* ── Render pipeline ─────────────────────────────── */
  function showLoader(finger, show) {
    if (loaderMap[finger]) loaderMap[finger].hidden = !show;
  }

  async function renderFromCurrentRecord(successMessage) {
    if (!currentRecord) return;
    const id = ++renderSeq;
    const design = generateNailDesign(currentRecord, styleSelect.value, getEditorState());

    await Promise.all(design.nails.map(d => {
      const ns = state.nails[d.id];
      const extras = {};

      // AI base image
      if (ns && ns.aiImage) extras.aiImage = ns.aiImage;

      // Asset overlays with transforms
      const overlays = [];
      for (const a of BRAND_ASSETS) {
        const as = ns ? ns.assets[a.key] : null;
        if (as && as.enabled) {
          const src = a.key === 'portrait'
            ? (currentRecord.imageUrl || null)
            : (a.url || null);
          if (src) overlays.push({ src, transforms: as });
        }
      }
      if (overlays.length) extras.assetOverlays = overlays;

      return renderNailCanvas(canvasMap[d.id], d, design, BRAND_ASSET_URLS, extras);
    }));
    await renderCombinedCanvas(combinedCanvas, design, canvasMap, BRAND_ASSET_URLS);

    if (id !== renderSeq) return;
    currentDesign = design;
    updateMeta(currentRecord, design);
    setStatus(statusEl,
      currentRecord.usedFallback ? 'Design updated using fallback data.' : successMessage,
      currentRecord.usedFallback ? 'warning' : 'success'
    );
    setDownloadsEnabled(true);
    persistState();
  }

  function queueRender(msg) {
    if (!currentRecord) return;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(async () => {
      setStatus(statusEl, 'Updating design…', 'loading');
      try { await renderFromCurrentRecord(msg); }
      catch { setStatus(statusEl, 'Unable to update design.', 'error'); }
    }, 90);
  }

  /* ── Generate from form ──────────────────────────── */
  async function generateFromForm() {
    const num = parseInt(numberInput.value, 10);
    if (!Number.isInteger(num) || num < 1 || num > 10000) {
      setStatus(statusEl, 'Enter a whole number between 1 and 10000.', 'error');
      setDownloadsEnabled(false);
      return;
    }
    setStatus(statusEl, 'Loading Doginal Dogs data…', 'loading');
    setDownloadsEnabled(false);
    currentRecord = await fetchDesignSource(num);
    applyBrandPalette(root, currentRecord.brandColors);
    showPalette(currentRecord);

    // Set portrait URL from record
    if (currentRecord.imageUrl) {
      BRAND_ASSETS.find(a => a.key === 'portrait').url = currentRecord.imageUrl;
    }

    // Default inscription image on middle nail
    state.nails.middle.assets.portrait.enabled = true;
    if (checkboxMap.portrait && checkboxMap.portrait.middle) {
      checkboxMap.portrait.middle.checked = true;
    }
    updateNailBadges('middle');
    if (state.activeNail === 'middle') renderActiveNailControls();

    await renderFromCurrentRecord('Design ready for download.');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await generateFromForm();
  });

  /* ── AI generation ───────────────────────────────── */
  generateAiBtn.addEventListener('click', async () => {
    if (!currentRecord) {
      setStatus(statusEl, 'Generate a standard design first.', 'warning');
      return;
    }
    setStatus(statusEl, 'Generating AI nail art…', 'loading');
    FINGERS.forEach(f => showLoader(f, true));

    try {
      const aiImages = await generateAiNails(currentRecord, state.shape, state.finish);
      for (const f of FINGERS) {
        state.nails[f].aiImage = aiImages[f] || null;
        showLoader(f, false);
      }
      setStatus(statusEl, 'AI generation complete. Standard overlays still applied.', 'success');
      queueRender('AI base applied.');
    } catch {
      FINGERS.forEach(f => showLoader(f, false));
      setStatus(statusEl, 'AI generation failed. Try again.', 'error');
    }
  });

  /* ── Style/shape/finish changes ──────────────────── */
  function syncStyleDesc() {
    descEl.textContent = getStyleDefinition(styleSelect.value).description;
  }

  styleSelect.addEventListener('change', () => {
    syncStyleDesc();
    queueRender('Style updated.');
  });

  shapeSelect.addEventListener('change', () => {
    state.shape = shapeSelect.value;
    queueRender('Shape updated.');
  });

  finishSelect.addEventListener('change', () => {
    state.finish = finishSelect.value;
    queueRender('Finish updated.');
  });

  /* ── Persist / restore ───────────────────────────── */
  function persistState() {
    const serializable = {
      inscriptionNumber: currentRecord?.inscriptionNumber || parseInt(numberInput.value, 10) || null,
      style: styleSelect.value,
      state: {
        ...state,
        nails: Object.fromEntries(FINGERS.map(f => {
          const ns = state.nails[f];
          return [f, {
            baseColor: ns.baseColor,
            aiImage: null, // can't serialize Image
            assets: Object.fromEntries(BRAND_ASSETS.map(a => [a.key, { ...ns.assets[a.key] }]))
          }];
        }))
      },
      timestamp: Date.now()
    };
    saveDesignerState(serializable);
  }

  function restoreState(saved) {
    if (!saved?.state) return;
    const s = saved.state;
    state.activeNail = s.activeNail || 'thumb';
    state.shape = s.shape || 'almond';
    state.finish = s.finish || 'glazed';

    if (s.nails && typeof s.nails === 'object') {
      for (const f of FINGERS) {
        if (!s.nails[f]) continue;
        const ns = s.nails[f];
        state.nails[f].baseColor = ns.baseColor || null;
        if (ns.assets && typeof ns.assets === 'object') {
          for (const a of BRAND_ASSETS) {
            if (ns.assets[a.key]) {
              Object.assign(state.nails[f].assets[a.key], ns.assets[a.key]);
            }
          }
        }
      }
    }

    // Sync UI
    shapeSelect.value = state.shape;
    finishSelect.value = state.finish;
    csControllers.forEach(c => c.sync());

    for (const f of FINGERS) {
      for (const a of BRAND_ASSETS) {
        if (checkboxMap[a.key]?.[f]) {
          checkboxMap[a.key][f].checked = state.nails[f].assets[a.key].enabled;
        }
      }
      if (state.nails[f].baseColor) {
        colorInputMap[f].value = state.nails[f].baseColor;
        colorLabelMap[f].textContent = state.nails[f].baseColor;
      }
      updateNailBadges(f);
    }
    setActiveNail(state.activeNail);
  }

  /* ── Init ────────────────────────────────────────── */
  syncStyleDesc();
  setActiveNail('thumb');
  FINGERS.forEach(f => updateNailBadges(f));

  const saved = loadDesignerState();
  if (saved) {
    if (saved.inscriptionNumber) numberInput.value = saved.inscriptionNumber;
    if (saved.style) {
      styleSelect.value = saved.style;
      syncStyleDesc();
      csControllers.forEach(c => c.sync());
    }
    restoreState(saved);

    if (saved.inscriptionNumber && Date.now() - (saved.timestamp || 0) <= AUTO_RESTORE_MAX_AGE) {
      await generateFromForm();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNailDesigner);
} else {
  initializeNailDesigner();
}
