'use strict';

/**
 * Standalone Doginal Dogs trait catalog index + search.
 * Kept separate from doginal-dogs.js so Passenger can pick up trait search
 * without depending on a full service redeploy/restart of unrelated exports.
 */

const fs = require('fs/promises');
const path = require('path');

const TRAIT_KEYS = Object.freeze([
  'background', 'furColor', 'furPattern', 'head',
  'clothes', 'mouth', 'eyes', 'accessory'
]);

const CATALOG_CANDIDATE_PATHS = Object.freeze([
  process.env.DD_CATALOG_PATH ? path.resolve(process.cwd(), process.env.DD_CATALOG_PATH) : null,
  path.resolve(__dirname, '..', 'data', 'DoginalDogsCatalog.json'),
  path.resolve(__dirname, '..', '..', 'assets', 'DoginalDogsCatalog.json'),
  path.resolve(__dirname, '..', '..', 'server', 'data', 'DoginalDogsCatalog.json')
].filter(Boolean));

const CATALOG_DISABLED = /^(1|true|yes)$/i.test(String(process.env.DD_DISABLE_CATALOG || ''));

function traitCategoryLabel(key) {
  if (key === 'furColor') return 'Fur Color';
  if (key === 'furPattern') return 'Fur Pattern';
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

function normalizeTraitQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function summarizeTrait(entry) {
  return {
    traitKey: entry.traitKey,
    traitLabel: entry.traitLabel,
    value: entry.value,
    count: entry.count
  };
}

let catalogPromise = null;
let traitIndexPromise = null;

async function loadDogCatalog() {
  if (CATALOG_DISABLED) return null;
  if (!catalogPromise) {
    catalogPromise = (async () => {
      for (const filePath of CATALOG_CANDIDATE_PATHS) {
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.dogs && typeof parsed.dogs === 'object') {
            return parsed;
          }
        } catch (error) {
          if (error && error.code === 'ENOENT') continue;
          console.warn('[dd-trait-catalog] Failed to load catalog:', error.message || error);
          return null;
        }
      }
      return null;
    })();
  }
  return catalogPromise;
}

async function buildCatalogTraitIndex() {
  const catalog = await loadDogCatalog();
  if (!catalog || !catalog.dogs || typeof catalog.dogs !== 'object') {
    return null;
  }

  const byKey = new Map();
  const dogsMap = catalog.dogs;

  for (let d = 1; d <= 10000; d++) {
    const entry = dogsMap[String(d)] || dogsMap[d];
    if (!entry || entry.ok === false || !entry.traits || typeof entry.traits !== 'object') {
      continue;
    }
    const traits = entry.traits;
    const rankRaw = Number(traits.rarityRank);
    const rarityRank = Number.isFinite(rankRaw) && rankRaw > 0 ? rankRaw : null;

    for (const traitKey of TRAIT_KEYS) {
      const value = traits[traitKey];
      if (value == null || value === '') continue;
      const valueStr = String(value);
      const id = traitKey + '\0' + valueStr;
      let bucket = byKey.get(id);
      if (!bucket) {
        bucket = {
          traitKey,
          traitLabel: traitCategoryLabel(traitKey),
          value: valueStr,
          count: 0,
          dogs: []
        };
        byKey.set(id, bucket);
      }
      bucket.count += 1;
      bucket.dogs.push({ dogNumber: d, rarityRank });
    }
  }

  const traits = Array.from(byKey.values()).map((bucket) => {
    bucket.dogs.sort((a, b) => {
      const ar = a.rarityRank == null ? 999999 : a.rarityRank;
      const br = b.rarityRank == null ? 999999 : b.rarityRank;
      if (ar !== br) return ar - br;
      return a.dogNumber - b.dogNumber;
    });
    return {
      traitKey: bucket.traitKey,
      traitLabel: bucket.traitLabel,
      value: bucket.value,
      count: bucket.count,
      dogs: bucket.dogs
    };
  });

  traits.sort((a, b) => {
    const labelCmp = a.traitLabel.localeCompare(b.traitLabel);
    if (labelCmp !== 0) return labelCmp;
    return a.value.localeCompare(b.value);
  });

  return traits;
}

async function getCatalogTraitIndex() {
  if (!traitIndexPromise) {
    traitIndexPromise = buildCatalogTraitIndex().catch((err) => {
      traitIndexPromise = null;
      throw err;
    });
  }
  return traitIndexPromise;
}

async function getCatalogTraitValues() {
  const index = await getCatalogTraitIndex();
  if (!index) return null;
  return index.map((entry) => summarizeTrait(entry));
}

function parseTraitsParam(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (item && typeof item === 'object') {
        return {
          traitKey: String(item.traitKey || item.trait || '').trim(),
          value: String(item.value || '').trim()
        };
      }
      const text = String(item || '').trim();
      const colon = text.indexOf(':');
      if (colon > 0) {
        return {
          traitKey: text.slice(0, colon).trim(),
          value: text.slice(colon + 1).trim()
        };
      }
      return { q: text };
    }).filter((part) => (part.traitKey && part.value) || part.q);
  }

  const text = String(raw || '').trim();
  if (!text) return [];
  return text.split(',').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const colon = chunk.indexOf(':');
    if (colon > 0) {
      const key = chunk.slice(0, colon).trim();
      const value = chunk.slice(colon + 1).trim();
      if (TRAIT_KEYS.includes(key) && value) {
        return { traitKey: key, value };
      }
    }
    return { q: chunk };
  });
}

function parseQueryParts(qRaw) {
  return String(qRaw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ q: part }));
}

function tokenizeTraitQuery(value) {
  return normalizeTraitQuery(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function entryHaystack(entry) {
  return normalizeTraitQuery(`${entry.traitLabel} ${entry.value} ${entry.traitKey}`);
}

function tokensMatchHaystack(tokens, haystack) {
  if (!tokens.length) return false;
  return tokens.every((token) => haystack.includes(token));
}

function inferTraitKeyFromQuery(q, index) {
  const nq = normalizeTraitQuery(q);
  if (!nq) return '';

  // Longest label / key wins ("fur color" before "fur", "fur pattern", etc.).
  let bestKey = '';
  let bestLen = 0;
  const seen = new Map();
  for (const entry of index) {
    if (seen.has(entry.traitKey)) continue;
    seen.set(entry.traitKey, entry.traitLabel);
    const label = normalizeTraitQuery(entry.traitLabel);
    const key = normalizeTraitQuery(entry.traitKey);
    if (label && nq.includes(label) && label.length > bestLen) {
      bestKey = entry.traitKey;
      bestLen = label.length;
    } else if (key && nq.includes(key) && key.length > bestLen) {
      bestKey = entry.traitKey;
      bestLen = key.length;
    }
  }
  return bestKey;
}

function stripCategoryFromQuery(q, traitKey, traitLabel) {
  let next = normalizeTraitQuery(q);
  const label = normalizeTraitQuery(traitLabel || '');
  const key = normalizeTraitQuery(traitKey || '');
  if (label) next = next.replace(label, ' ');
  if (key) next = next.replace(key, ' ');
  return normalizeTraitQuery(next);
}

function scoreTraitCandidate(entry, q) {
  const nv = normalizeTraitQuery(entry.value);
  const nl = normalizeTraitQuery(entry.traitLabel);
  const hay = entryHaystack(entry);
  const tokens = tokenizeTraitQuery(q);
  let score = 0;

  if (nv === q) score += 300;
  if (normalizeTraitQuery(`${nv} ${nl}`) === q || normalizeTraitQuery(`${nl} ${nv}`) === q) score += 280;
  if (nv.startsWith(q)) score += 200;
  if (q.startsWith(nv) && nv.length >= 3) score += 160;
  if (tokensMatchHaystack(tokens, hay)) score += 140;
  if (hay.includes(q)) score += 80;
  if (nv.includes(q)) score += 60;

  const inferred = inferTraitKeyFromQuery(q, [entry]);
  if (inferred && inferred === entry.traitKey) score += 120;

  // Prefer more specific / rarer values slightly when scores tie later.
  score += Math.max(0, 40 - Math.min(40, Math.log10((entry.count || 1) + 1) * 12));
  return score;
}

function resolveTraitPart(index, part, options = {}) {
  const excludedKeys = options.excludedKeys instanceof Set ? options.excludedKeys : new Set();
  const traitKey = String(part.traitKey || part.trait || '').trim();
  const valueRaw = String(part.value || '').trim();
  const q = normalizeTraitQuery(part.q || part.query || (!traitKey ? valueRaw : ''));
  const pool = index.filter((entry) => !excludedKeys.has(entry.traitKey));

  if (traitKey && valueRaw) {
    const selected = index.find(
      (entry) => entry.traitKey === traitKey && entry.value.toLowerCase() === valueRaw.toLowerCase()
    ) || null;
    if (!selected) {
      return {
        ok: false,
        error: `No dogs found for ${traitKey}:${valueRaw}.`,
        matches: []
      };
    }
    return { ok: true, selected };
  }

  if (!q) {
    return { ok: false, error: 'Empty trait in query.', matches: [] };
  }

  // Category-aware phrase: "Black fur color", "Visor eyes", "Solid fur pattern".
  const hintedKey = inferTraitKeyFromQuery(q, index);
  if (hintedKey) {
    const valueGuess = stripCategoryFromQuery(
      q,
      hintedKey,
      traitCategoryLabel(hintedKey)
    );
    if (valueGuess) {
      const hintedPool = pool.filter((entry) => entry.traitKey === hintedKey);
      const exactHint = hintedPool.filter((entry) => normalizeTraitQuery(entry.value) === valueGuess);
      if (exactHint.length === 1) {
        return { ok: true, selected: exactHint[0] };
      }
      const startHint = hintedPool.filter((entry) => normalizeTraitQuery(entry.value).startsWith(valueGuess));
      if (startHint.length === 1) {
        return { ok: true, selected: startHint[0] };
      }
      const fuzzyHint = hintedPool
        .map((entry) => ({ entry, score: scoreTraitCandidate(entry, q) }))
        .filter((row) => row.score >= 140)
        .sort((a, b) => b.score - a.score || a.entry.count - b.entry.count);
      if (fuzzyHint.length === 1 || (fuzzyHint.length > 1 && fuzzyHint[0].score >= fuzzyHint[1].score + 40)) {
        return { ok: true, selected: fuzzyHint[0].entry };
      }
    }
  }

  const exact = pool.filter((entry) => normalizeTraitQuery(entry.value) === q);
  if (exact.length === 1) {
    return { ok: true, selected: exact[0] };
  }
  if (exact.length > 1) {
    // If one candidate remains after excluding used categories, auto-pick it.
    return {
      ok: true,
      needsDisambiguation: true,
      query: q,
      matches: exact.map(summarizeTrait)
    };
  }

  const scored = pool
    .map((entry) => ({ entry, score: scoreTraitCandidate(entry, q) }))
    .filter((row) => row.score >= 60)
    .sort((a, b) => b.score - a.score || a.entry.count - b.entry.count);

  if (scored.length === 1) {
    return { ok: true, selected: scored[0].entry };
  }
  if (scored.length > 1 && scored[0].score >= scored[1].score + 40) {
    return { ok: true, selected: scored[0].entry };
  }

  const starts = pool.filter((entry) => normalizeTraitQuery(entry.value).startsWith(q));
  if (starts.length === 1) {
    return { ok: true, selected: starts[0] };
  }

  return {
    ok: true,
    needsDisambiguation: true,
    query: q,
    matches: (scored.length ? scored.map((row) => summarizeTrait(row.entry)) : starts.map(summarizeTrait)).slice(0, 40)
  };
}

function intersectDogs(traitEntries) {
  if (!traitEntries.length) return [];
  let dogs = traitEntries[0].dogs.slice();
  for (let i = 1; i < traitEntries.length; i++) {
    const set = new Set(traitEntries[i].dogs.map((dog) => dog.dogNumber));
    dogs = dogs.filter((dog) => set.has(dog.dogNumber));
  }
  dogs.sort((a, b) => {
    const ar = a.rarityRank == null ? 999999 : a.rarityRank;
    const br = b.rarityRank == null ? 999999 : b.rarityRank;
    if (ar !== br) return ar - br;
    return a.dogNumber - b.dogNumber;
  });
  return dogs;
}

/**
 * Search dogs by one or more traits (AND). Prefer explicit traitKey+value parts;
 * free-text `q` may be comma-separated ("Cowboy, Diamond").
 */
async function searchCatalogByTrait(options = {}) {
  const index = await getCatalogTraitIndex();
  if (!index) {
    return { ok: false, error: 'catalog_unavailable' };
  }

  const limit = Math.max(1, Math.min(500, Number(options.limit) || 120));
  const offset = Math.max(0, Number(options.offset) || 0);

  let parts = [];
  if (options.traits != null && String(options.traits).trim() !== '') {
    parts = parseTraitsParam(options.traits);
  } else if (
    (options.traitKey || options.trait) &&
    options.value
  ) {
    parts = [{
      traitKey: options.traitKey || options.trait,
      value: options.value
    }];
  } else if (options.q || options.query) {
    parts = parseQueryParts(options.q || options.query);
  }

  if (!parts.length) {
    return { ok: false, error: 'Provide a trait query (q), traits, or trait+value.', matches: [] };
  }

  // Two-pass resolve: lock unique parts first, then finish ambiguous ones
  // with used categories excluded (e.g. Visor=eyes => Black => furColor).
  const resolvedSlots = new Array(parts.length).fill(null);
  const pending = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.traitKey && part.value) {
      const result = resolveTraitPart(index, part);
      if (!result.ok) return result;
      resolvedSlots[i] = result.selected;
      continue;
    }
    const firstPass = resolveTraitPart(index, part);
    if (!firstPass.ok) return firstPass;
    if (!firstPass.needsDisambiguation && firstPass.selected) {
      resolvedSlots[i] = firstPass.selected;
    } else {
      pending.push({ index: i, part, firstPass });
    }
  }

  for (const item of pending) {
    const excludedKeys = new Set(
      resolvedSlots.filter(Boolean).map((entry) => entry.traitKey)
    );
    const result = resolveTraitPart(index, item.part, { excludedKeys });
    if (!result.ok) return result;
    if (result.needsDisambiguation) {
      // Last chance: if first-pass matches collapse to one unused category, take it.
      const openMatches = (item.firstPass.matches || []).filter((m) => !excludedKeys.has(m.traitKey));
      if (openMatches.length === 1) {
        const selected = index.find(
          (entry) => entry.traitKey === openMatches[0].traitKey
            && entry.value === openMatches[0].value
        );
        if (selected) {
          resolvedSlots[item.index] = selected;
          continue;
        }
      }
      const resolved = resolvedSlots.filter(Boolean);
      return {
        ok: true,
        needsDisambiguation: true,
        query: result.query || item.firstPass.query,
        matches: (result.matches && result.matches.length ? result.matches : openMatches).slice(0, 40),
        resolvedTraits: resolved.map(summarizeTrait),
        dogs: [],
        total: 0
      };
    }
    resolvedSlots[item.index] = result.selected;
  }

  const resolved = resolvedSlots.filter(Boolean);
  if (resolved.length !== parts.length) {
    return {
      ok: false,
      error: 'Could not resolve all traits in the query.',
      matches: []
    };
  }

  const dogsAll = intersectDogs(resolved);
  const total = dogsAll.length;
  const dogs = dogsAll.slice(offset, offset + limit);
  const traits = resolved.map(summarizeTrait);
  const primary = traits[0];

  return {
    ok: true,
    needsDisambiguation: false,
    traits,
    traitKey: primary.traitKey,
    traitLabel: traits.map((t) => t.traitLabel).join(' + '),
    value: traits.map((t) => t.value).join(', '),
    count: total,
    supplyCounts: traits.map((t) => t.count),
    total,
    offset,
    limit,
    dogs,
    matches: []
  };
}

module.exports = {
  TRAIT_KEYS,
  traitCategoryLabel,
  getCatalogTraitValues,
  searchCatalogByTrait
};
