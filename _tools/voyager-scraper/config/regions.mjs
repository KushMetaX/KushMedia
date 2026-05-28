/**
 * Region registry — every macro-region the scraper knows about.
 *
 * Adding a new region (e.g. PEI, New Brunswick, Maine) is a one-file change:
 *   1. Add an entry below with bbox + subregions
 *   2. (Optional) Add the matching subregion ids to map/data.js so the
 *      front-end can colour them on the polygon layer
 *   3. Run `npm run scrape:all` (or `node scrape.mjs --region <id>`)
 *
 * `bbox` is in [south, west, north, east] order (Overpass convention,
 * NOT GeoJSON). Use bboxfinder.com or maps.google.com to get the values.
 *
 * `subregions[].bbox` are mutually-exclusive child bounding boxes used
 * to assign a `regionId` to each scraped POI. The ids must match the
 * region ids in `map/data.js` so the front-end colour-codes them.
 */
export const REGIONS = {
  "nova-scotia": {
    id: "nova-scotia",
    name: "Nova Scotia",
    country: "Canada",
    bbox: [43.3, -66.5, 47.2, -59.5],
    subregions: [
      { id: "halifax-metro",     name: "Halifax & Central",       bbox: [44.35, -64.05, 45.05, -62.85] },
      { id: "south-shore",       name: "South Shore",             bbox: [43.85, -65.20, 44.75, -63.50] },
      { id: "annapolis-valley",  name: "Annapolis Valley",        bbox: [44.75, -65.40, 45.45, -63.90] },
      { id: "bay-of-fundy",      name: "Bay of Fundy",            bbox: [44.90, -66.00, 45.80, -64.50] },
      { id: "eastern-shore",     name: "Eastern Shore",           bbox: [44.50, -63.00, 45.40, -61.20] },
      { id: "cape-breton",       name: "Cape Breton Island",      bbox: [45.50, -61.50, 47.10, -59.70] },
      { id: "yarmouth-acadian",  name: "Yarmouth & Acadian Shore", bbox: [43.40, -66.50, 44.50, -64.90] }
    ]
  },

  // ===== Examples — uncomment / fill in to expand =====
  // "prince-edward-island": {
  //   id: "prince-edward-island",
  //   name: "Prince Edward Island",
  //   country: "Canada",
  //   bbox: [45.95, -64.45, 47.07, -61.97],
  //   subregions: [
  //     { id: "pei-charlottetown", name: "Charlottetown & Central", bbox: [46.0, -63.5, 46.4, -62.8] },
  //     { id: "pei-north-shore",   name: "North Shore",             bbox: [46.4, -63.9, 46.8, -62.3] },
  //     { id: "pei-east",          name: "Points East",             bbox: [45.95, -62.8, 46.5, -61.97] },
  //     { id: "pei-west",          name: "Red Sands & Western",     bbox: [45.95, -64.45, 46.7, -63.5] }
  //   ]
  // },

  // "new-brunswick": {
  //   id: "new-brunswick",
  //   name: "New Brunswick",
  //   country: "Canada",
  //   bbox: [44.6, -69.1, 48.1, -63.7],
  //   subregions: [
  //     { id: "nb-saint-john",  name: "Saint John & Bay of Fundy", bbox: [44.6, -67.0, 45.7, -65.0] },
  //     { id: "nb-fredericton", name: "Fredericton & River Valley",bbox: [45.5, -67.5, 47.0, -66.0] },
  //     { id: "nb-acadian",     name: "Acadian Coast",             bbox: [46.5, -66.0, 48.1, -63.7] },
  //     { id: "nb-moncton",     name: "Moncton & Coastal",         bbox: [45.8, -65.5, 46.7, -63.7] }
  //   ]
  // },
};

/**
 * Resolve a [lon, lat] coordinate to a subregion id within a known macro-region.
 * Returns the first matching subregion's id, or `null` when the point is
 * outside every defined subregion (point will be dropped from final output).
 */
export function resolveRegionId(lon, lat, macroRegionId) {
  const macro = REGIONS[macroRegionId];
  if (!macro || !Array.isArray(macro.subregions)) return null;
  for (const sub of macro.subregions) {
    const [s, w, n, e] = sub.bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) {
      return sub.id;
    }
  }
  return null;
}
