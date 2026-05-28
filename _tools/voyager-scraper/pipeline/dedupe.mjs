/**
 * Merge near-duplicate POIs.
 *
 * OSM frequently has both a "node" and a "way" record for the same business
 * (and/or multiple imports). Two records are considered duplicates when they
 * share a normalised name AND are within ~80m of each other. The merged
 * record prefers fields from whichever side has them populated (website,
 * social handles, accessibility, etc.).
 *
 * Pass `curatedIds` (a Set of POI ids from `map/pois.js`) to suppress
 * scraped POIs whose name + region matches an already-curated entry — your
 * hand-written records always win.
 */
const DUP_RADIUS_KM = 0.08;

export function dedupe(pois, opts = {}) {
  const buckets = new Map();
  for (const p of pois) {
    const key = bucketKey(p.name);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  const merged = [];
  for (const list of buckets.values()) {
    while (list.length) {
      const head = list.shift();
      let absorbed = false;
      for (let i = 0; i < merged.length; i++) {
        if (bucketKey(merged[i].name) !== bucketKey(head.name)) continue;
        if (haversineKm(merged[i].coordinates, head.coordinates) <= DUP_RADIUS_KM) {
          merged[i] = mergeRecords(merged[i], head);
          absorbed = true;
          break;
        }
      }
      if (!absorbed) merged.push(head);
    }
  }

  if (opts.curatedNames instanceof Set) {
    return merged.filter((p) => !opts.curatedNames.has(bucketKey(p.name)));
  }
  return merged;
}

function bucketKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}

function mergeRecords(a, b) {
  const out = { ...a };
  // Prefer the side with a richer description.
  if ((b.description || "").length > (a.description || "").length) {
    out.description = b.description;
  }
  // First non-null wins for links/booking info.
  out.websiteUrl   = a.websiteUrl   || b.websiteUrl;
  out.instagramUrl = a.instagramUrl || b.instagramUrl;
  out.facebookUrl  = a.facebookUrl  || b.facebookUrl;
  out.bookingUrl   = a.bookingUrl   || b.bookingUrl;
  out.accessibility = Boolean(a.accessibility || b.accessibility);
  out.isHiddenGem   = Boolean(a.isHiddenGem || b.isHiddenGem);
  // Union the lightweight tag list, capped.
  const tagSet = new Set([...(a.tags || []), ...(b.tags || [])]);
  out.tags = Array.from(tagSet).slice(0, 8);
  // Keep both source pointers for traceability.
  out.source = {
    provider: a.source?.provider || b.source?.provider || "merged",
    refs: [a.source, b.source].filter(Boolean)
  };
  return out;
}

function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const A = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(A));
}
