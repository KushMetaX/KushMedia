"use strict";

/**
 * NovaScotiaVoyage — discovered-POI curation engine.
 *
 * The Overpass/OSM scrape (`pois-discovered.json`) is intentionally greedy: it
 * pulls ~7k raw records so we never miss a venue. Most of that is noise for a
 * tourism product — bare map labels (unnamed capes/bays/peaks), school
 * playgrounds, suburban street-corner parks, fairgrounds, etc.
 *
 * This module is the single choke point that turns that firehose into a tight,
 * high-standard experience set. It runs server-side so the browser only ever
 * receives the curated list with internal signals stripped — smaller payload,
 * and far less of our editorial logic / raw OSM tagging is exposed to anyone
 * inspecting network traffic.
 *
 * Public surface:
 *   curateDiscoveredPois(rawArray, { curatedNames }) -> cleaned, ranked array
 */

/** Public, free-to-experience place types -> never show a price tier. */
const FREE_PRICE = "Free";

/** Street-suffix words that betray a tiny residential pocket park. */
const RESIDENTIAL_PARK = /\b(drive|court|crescent|avenue|ave|lane|street|st|road|rd|cul-de-sac|close|terrace|place|boulevard|blvd|way|circle|circ|heights|gardens? court)\b\s*park\b/i;

/** Names that should never appear under Scenic / outdoor categories. */
const SCHOOL_OR_UTILITY = /\b(school|playground|elementary|academy|junior high|high school|tot lot|ball ?field|ballfield|soccer|baseball|softball|sports?\s?field|sportsfield|skate ?park|dog ?park|cemetery|graveyard|memorial garden|retention pond|storm ?water|water tower|substation|lagoon|wastewater|sewage|landfill|transfer station|parking)\b/i;

/** Fairgrounds / exhibition grounds — explicitly unwanted, never scenic. */
const FAIRGROUND = /\b(fair\s?grounds?|exhibition grounds?|raceway|racetrack|speedway|rodeo grounds?)\b/i;

/** Park names that clearly carry real scenic / hiking / heritage value. */
const NOTABLE_PARK = /\b(provincial park|national park|national historic|wilderness|conservation|protected|nature (park|reserve)|lookoff|look-off|look ?out|arboretum|botanical|heritage|waterfront park|seawall|trail|falls|gorge|canyon|island|point|cove|harbour|harbor|lake|river|gardens)\b/i;

/** Bare natural feature classes that are usually just a label on the map. */
const BARE_NATURAL = new Set(["cape", "bay", "cliff", "peak", "ridge", "hill", "valley", "isthmus", "strait"]);

function osmTags(poi) {
  const s = poi && poi.source;
  if (!s) return {};
  if (s.osmTags) return s.osmTags;
  // Deduped records stash their tags inside source.refs[] — merge them back.
  if (Array.isArray(s.refs)) {
    return s.refs.reduce(function (acc, r) {
      return Object.assign(acc, (r && r.osmTags) || {});
    }, {});
  }
  return {};
}

/** Beach-like place name that is NOT a paid business (campground/resort/etc.). */
const PUBLIC_BEACH = /\bbeach\b/i;
const PAID_BEACH_BIZ = /\b(campground|campsite|cottages?|resort|\brv\b|kitchen|bar|grill|restaurant|village|club|inn|motel|hotel|cafe|caf\u00e9|store|market|pub|brewery|spa)\b/i;

function hasRealLink(poi) {
  return Boolean(poi.websiteUrl || poi.bookingUrl);
}

function isNotable(poi) {
  const t = osmTags(poi);
  return Boolean(
    hasRealLink(poi) ||
    t.wikidata ||
    t.wikipedia ||
    t.heritage ||
    (poi.description && poi.description.trim().length >= 40)
  );
}

/**
 * Whether a leisure=park record clears the bar for inclusion.
 * Keep genuine destinations (provincial/national/wilderness/heritage, anything
 * with a real link). Drop school grounds, ball fields, and residential pocket
 * parks that add nothing for a visitor.
 */
function parkPassesBar(poi) {
  const name = poi.name || "";
  if (SCHOOL_OR_UTILITY.test(name)) return false;
  if (RESIDENTIAL_PARK.test(name) && !hasRealLink(poi)) return false;
  if (NOTABLE_PARK.test(name)) return true;
  if (isNotable(poi)) return true;
  // Generic municipal "X Park" with zero visitor signal -> not worth a pin.
  return false;
}

/**
 * Raise the scenic bar. Always keep viewpoints, lighthouses, and waterfalls —
 * they are inherently worth the trip. Keep capes/bays/peaks/cliffs ONLY when
 * they are notable (named landmark with a link, Wikipedia/Wikidata entry, or a
 * real description). Everything else is a bare map label and gets dropped.
 */
function scenicPassesBar(poi) {
  const t = osmTags(poi);
  const name = poi.name || "";
  if (FAIRGROUND.test(name)) return false;
  if (SCHOOL_OR_UTILITY.test(name)) return false;

  if (t.tourism === "viewpoint") return true;
  if (t.man_made === "lighthouse") return true;
  if (t.natural === "waterfall" || /\bfalls?\b/i.test(name)) return true;

  if (t.leisure === "park") return parkPassesBar(poi);

  if (BARE_NATURAL.has(t.natural)) return isNotable(poi);

  if (t.tourism === "attraction") {
    // Attractions are kept unless they're really a fairground/utility.
    return !FAIRGROUND.test(name);
  }
  // Anything else that reached scenic (lookoffs, capes with links) — keep if notable.
  return isNotable(poi) || Boolean(name && t.tourism);
}

/**
 * Outdoor/adventure noise filter — strip school fields/playgrounds that slipped
 * into adventure via sport tags.
 */
function adventurePassesBar(poi) {
  const name = poi.name || "";
  if (SCHOOL_OR_UTILITY.test(name)) return false;
  if (FAIRGROUND.test(name)) return false;
  return true;
}

/** Decide whether a record survives curation. */
function passesCuration(poi) {
  if (!poi || !poi.name || !Array.isArray(poi.coordinates)) return false;
  const name = poi.name;
  if (FAIRGROUND.test(name)) return false;

  // Idempotency: a record with no OSM provenance has already been vetted by a
  // previous curation pass (or is hand-curated). The tag-based scenic/park
  // pruning relies on osmTags we'd no longer have, so we only re-apply the
  // name-based hard drops and otherwise trust it. This lets curateDiscoveredPois
  // run safely over an already-cleaned file.
  if (!poi.source) {
    return !SCHOOL_OR_UTILITY.test(name);
  }

  switch (poi.category) {
    case "scenic":
      return scenicPassesBar(poi);
    case "adventure":
      return adventurePassesBar(poi);
    case "wildlife":
      return !SCHOOL_OR_UTILITY.test(name);
    default:
      // food / nightlife / culture / art / music / water-sports / creative
      // are real businesses/venues from OSM amenity tags — keep them.
      return true;
  }
}

/**
 * Normalise pricing. Public/free experiences should never wear a "$$".
 * Beaches, parks, viewpoints, lighthouses, trailheads, reserves, and anything
 * explicitly fee=no reads as "Free".
 */
function normalizePrice(poi) {
  const t = osmTags(poi);
  const blob = (poi.name || "") + " " + (poi.description || "");
  if (t.fee === "yes") return poi.priceRange || "$$"; // explicit paid entry — respect it
  // A public beach is free; a "Beach Resort/Campground/Bar" is not.
  if (PUBLIC_BEACH.test(poi.name || "") && !PAID_BEACH_BIZ.test(poi.name || "")) {
    return FREE_PRICE;
  }
  const free =
    // Scenic places — viewpoints, lighthouses, capes, parks, gardens — are
    // free to visit by definition; only paid attractions (fee=yes) keep a tier.
    poi.category === "scenic" ||
    t.fee === "no" ||
    Boolean(t.natural) ||
    t.leisure === "park" ||
    t.leisure === "garden" ||
    t.leisure === "nature_reserve" ||
    t.leisure === "swimming_area" ||
    t.tourism === "viewpoint" ||
    t.man_made === "lighthouse" ||
    t.highway === "trailhead" ||
    /\b(lighthouse|public beach|public gardens?|free admission|free entry|lookoff|look-?off|conservation area)\b/i.test(blob);
  if (free) return FREE_PRICE;
  return poi.priceRange || "$$";
}

/**
 * Internal ranking signal (NOT shipped to the client). Higher = surface first.
 * Rewards real links, social proof, descriptions, accessibility, and
 * inherently scenic types.
 */
function rankScore(poi) {
  const t = osmTags(poi);
  let s = 0;
  if (poi.websiteUrl) s += 4;
  if (poi.bookingUrl) s += 3;
  if (poi.instagramUrl || poi.facebookUrl) s += 1;
  if (poi.description && poi.description.length >= 40) s += 2;
  else if (poi.description && poi.description.length >= 20) s += 1;
  if (poi.accessibility) s += 1;
  if (t.wikidata || t.wikipedia) s += 2;
  if (t.tourism === "viewpoint" || t.man_made === "lighthouse" || t.natural === "waterfall") s += 2;
  if (poi.isHiddenGem) s += 1;
  return s;
}

/** Public-facing shape — internal scoring + raw OSM tags are dropped here. */
function toPublicShape(poi) {
  return {
    id: poi.id,
    name: poi.name,
    description: poi.description || "",
    regionId: poi.regionId || null,
    category: poi.category,
    coordinates: poi.coordinates,
    priceRange: normalizePrice(poi),
    season: Array.isArray(poi.season) ? poi.season : ["spring", "summer", "fall", "winter"],
    skillLevel: poi.skillLevel || "beginner",
    rating: poi.rating == null ? null : poi.rating,
    reviewCount: poi.reviewCount || 0,
    accessibility: Boolean(poi.accessibility),
    tags: Array.isArray(poi.tags) ? poi.tags.slice(0, 6) : [],
    isHiddenGem: Boolean(poi.isHiddenGem),
    websiteUrl: poi.websiteUrl || null,
    instagramUrl: poi.instagramUrl || null,
    facebookUrl: poi.facebookUrl || null,
    bookingUrl: poi.bookingUrl || null,
  };
}

function bucketKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^the /, "") // "The Bicycle Thief" === "Bicycle Thief"
    .trim();
}

/**
 * Curate a raw discovered-POI array.
 * @param {Array} raw
 * @param {{ curatedNames?: Set<string> }} [opts]
 * @returns {Array} cleaned, ranked, client-safe POIs
 */
function curateDiscoveredPois(raw, opts) {
  if (!Array.isArray(raw)) return [];
  const curatedNames = (opts && opts.curatedNames instanceof Set) ? opts.curatedNames : null;

  const kept = [];
  const seen = new Set();
  for (const poi of raw) {
    if (!passesCuration(poi)) continue;
    const key = bucketKey(poi.name);
    if (curatedNames && curatedNames.has(key)) continue; // hand-curated entry wins
    if (seen.has(poi.id)) continue;
    seen.add(poi.id);
    kept.push({ poi: toPublicShape(poi), rank: rankScore(poi) });
  }

  kept.sort((a, b) => b.rank - a.rank);
  return kept.map((x) => x.poi);
}

module.exports = {
  curateDiscoveredPois,
  // exported for unit testing / reuse only
  _internal: { passesCuration, normalizePrice, scenicPassesBar, parkPassesBar, rankScore, bucketKey },
};
