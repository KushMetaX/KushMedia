/**
 * Map OpenStreetMap tags onto Voyager categories.
 *
 * Order matters — the first matching rule wins. Rules higher in the list
 * are MORE SPECIFIC (e.g. "tourism=museum" before "amenity=restaurant").
 *
 * Voyager categories (must match map/data.js CATEGORY_LABELS keys):
 *   adventure | culture | food | hidden-gems | nightlife |
 *   water-sports | music | art | creative | wildlife | scenic
 *
 * Returning `null` from `classifyOsm()` drops the POI entirely (use this for
 * stuff we don't want polluting the map: petrol stations, ATMs, etc.).
 */

const RULES = [
  // ---- Art & culture ----
  { match: { tourism: "museum" },           category: "culture" },
  { match: { tourism: "gallery" },          category: "art" },
  { match: { tourism: "artwork" },          category: "art" },
  { match: { historic: /.+/ },              category: "culture" },
  { match: { amenity: "arts_centre" },      category: "art" },
  { match: { amenity: "place_of_worship" }, category: "culture" },
  { match: { shop: "art" },                 category: "art" },
  { match: { craft: /.+/ },                 category: "creative" },

  // ---- Music / theatre ----
  { match: { amenity: "theatre" },          category: "music" },
  { match: { amenity: "music_venue" },      category: "music" },
  { match: { amenity: "concert_hall" },     category: "music" },

  // ---- Food ----
  { match: { amenity: "restaurant" },       category: "food" },
  { match: { amenity: "cafe" },             category: "food" },
  { match: { amenity: "ice_cream" },        category: "food" },
  { match: { amenity: "food_court" },       category: "food" },
  { match: { amenity: "fast_food" },        category: "food" },
  { match: { shop: "bakery" },              category: "food" },
  { match: { shop: "wine" },                category: "food" },
  { match: { craft: "winery" },             category: "food" },
  { match: { craft: "distillery" },         category: "food" },
  { match: { craft: "brewery" },            category: "food" },

  // ---- Nightlife ----
  { match: { amenity: "bar" },              category: "nightlife" },
  { match: { amenity: "pub" },              category: "nightlife" },
  { match: { amenity: "biergarten" },       category: "nightlife" },
  { match: { amenity: "nightclub" },        category: "nightlife" },

  // ---- Water sports ----
  { match: { leisure: "marina" },           category: "water-sports" },
  { match: { leisure: "swimming_area" },    category: "water-sports" },
  { match: { leisure: "beach_resort" },     category: "water-sports" },
  { match: { leisure: "slipway" },          category: "water-sports" },
  { match: { shop: "boat" },                category: "water-sports" },
  { match: { sport: /surfing|kayak|canoe|sailing|diving|fishing|swimming|yachting|rowing/ }, category: "water-sports" },
  { match: { natural: "beach" },            category: "water-sports" },

  // ---- Wildlife ----
  { match: { tourism: "zoo" },              category: "wildlife" },
  { match: { tourism: "aquarium" },         category: "wildlife" },
  { match: { boundary: "national_park" },   category: "wildlife" },
  { match: { leisure: "nature_reserve" },   category: "wildlife" },

  // ---- Adventure / outdoor ----
  { match: { route: /hiking|bicycle|mtb/ }, category: "adventure" },
  { match: { sport: /climbing|hiking|cycling|skiing|skating|equestrian/ }, category: "adventure" },
  { match: { tourism: "camp_site" },        category: "adventure" },
  { match: { tourism: "caravan_site" },     category: "adventure" },
  { match: { highway: "trailhead" },        category: "adventure" },

  // ---- Scenic ----
  { match: { tourism: "viewpoint" },        category: "scenic" },
  { match: { tourism: "attraction" },       category: "scenic" },
  { match: { man_made: "lighthouse" },      category: "scenic" },
  { match: { leisure: "park" },             category: "scenic" },
  { match: { natural: /peak|cliff|waterfall|cape|bay/ }, category: "scenic" }
];

function tagMatches(tags, rule) {
  for (const [k, v] of Object.entries(rule)) {
    const value = tags[k];
    if (value == null) return false;
    if (v instanceof RegExp) {
      if (!v.test(value)) return false;
    } else if (value !== v) {
      return false;
    }
  }
  return true;
}

export function classifyOsm(tags) {
  if (!tags) return null;
  for (const rule of RULES) {
    if (tagMatches(tags, rule.match)) return rule.category;
  }
  return null;
}

/**
 * The single Overpass query body — every key/value combo we care about.
 * If you add a new RULE above with a new key, add it here too so the
 * Overpass query actually returns those nodes.
 */
export const OVERPASS_FILTERS = [
  // tourism
  '["tourism"~"museum|gallery|artwork|attraction|viewpoint|zoo|aquarium|camp_site|caravan_site"]',
  // historic
  '["historic"]',
  // amenity (food + nightlife + culture)
  '["amenity"~"restaurant|cafe|ice_cream|food_court|fast_food|bar|pub|biergarten|nightclub|theatre|music_venue|concert_hall|arts_centre|place_of_worship"]',
  // shop / craft (food + art + craft + boat rental)
  '["shop"~"art|bakery|wine|boat"]',
  '["craft"~"winery|distillery|brewery"]',
  // leisure (sports + parks + reserves)
  '["leisure"~"marina|swimming_area|beach_resort|nature_reserve|park|slipway"]',
  // sport
  '["sport"~"surfing|kayak|canoe|sailing|diving|fishing|swimming|climbing|hiking|cycling|skiing|skating|equestrian|yachting|rowing"]',
  // natural / man_made (scenic)
  '["natural"~"beach|peak|cliff|waterfall|cape|bay"]',
  '["man_made"="lighthouse"]'
];
