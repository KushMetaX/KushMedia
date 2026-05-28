/**
 * Convert a raw Overpass element into a Voyager-shaped POI.
 * Returns `null` when the element is not interesting (no name, unmappable
 * category, etc.). The downstream dedupe step handles deduplication.
 */
import { classifyOsm } from "../config/categories.mjs";

const HIDDEN_GEM_HINTS = /local|family[ -]run|hidden|tucked|tiny|secret|hole-in-the-wall/i;

export function osmElementToPoi(el) {
  const tags = el.tags || {};
  const name = (tags.name || tags["name:en"] || "").trim();
  if (!name) return null;

  const category = classifyOsm(tags);
  if (!category) return null;

  const coords = pickCoords(el);
  if (!coords) return null;

  const description = pickDescription(tags);
  const websiteUrl  = pickWebsite(tags);
  const instagramUrl = pickInstagram(tags);
  const facebookUrl  = pickFacebook(tags);

  const accessibility = tags.wheelchair === "yes" || tags.wheelchair === "designated";
  const tagList = derivedTags(tags);

  const qualityScore = scoreQuality({
    description, websiteUrl, instagramUrl, facebookUrl, accessibility, tagList, tags
  });

  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    description,
    regionId: null,
    category,
    coordinates: coords,
    priceRange: priceFromTags(tags),
    season: seasonFromTags(tags),
    skillLevel: skillFromTags(tags) || "beginner",
    rating: null,
    reviewCount: 0,
    accessibility,
    tags: tagList,
    isHiddenGem: detectHiddenGem(name, description, tags),
    websiteUrl,
    instagramUrl,
    facebookUrl,
    bookingUrl: null,
    qualityScore,
    source: {
      provider: "openstreetmap",
      element: el.type,
      osmId: el.id,
      osmTags: tags
    }
  };
}

/**
 * 0–6 signal-density score. Drives `npm run scrape` output ordering and
 * lets the front-end surface high-quality POIs first.
 *   +2 valid website            +1 Instagram or Facebook
 *   +1 description ≥ 20 chars   +1 accessibility info
 *   +1 opening hours            +1 phone or address tag
 */
function scoreQuality({ description, websiteUrl, instagramUrl, facebookUrl, accessibility, tagList, tags }) {
  let s = 0;
  if (websiteUrl) s += 2;
  if (instagramUrl || facebookUrl) s += 1;
  if (description && description.length >= 20) s += 1;
  if (accessibility) s += 1;
  if (tags.opening_hours) s += 1;
  if (tags.phone || tags["contact:phone"] || tags["addr:street"]) s += 1;
  return s;
}

function pickCoords(el) {
  if (typeof el.lon === "number" && typeof el.lat === "number") return [el.lon, el.lat];
  if (el.center && typeof el.center.lon === "number" && typeof el.center.lat === "number") {
    return [el.center.lon, el.center.lat];
  }
  return null;
}

function pickDescription(tags) {
  const candidates = [
    tags["description:en"],
    tags.description,
    tags["historic:description"],
    tags["heritage:description"],
    tags.note
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return generateFallbackDescription(tags);
}

function generateFallbackDescription(tags) {
  const bits = [];
  const subtype =
    tags.tourism || tags.amenity || tags.leisure || tags.historic ||
    tags.shop || tags.craft || tags.natural || tags.man_made || tags.sport;
  if (subtype) bits.push(humanise(subtype));
  if (tags.cuisine) bits.push(`(${tags.cuisine.split(";").map(humanise).slice(0, 3).join(", ")})`);
  if (tags["addr:city"]) bits.push("in " + tags["addr:city"]);
  if (tags.opening_hours && /24\/7/.test(tags.opening_hours)) bits.push("— open 24/7");
  return bits.join(" ");
}
function humanise(s) {
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickWebsite(tags) {
  return cleanUrl(tags.website || tags["contact:website"] || tags.url);
}
function pickInstagram(tags) {
  const raw = tags["contact:instagram"] || tags.instagram;
  if (!raw) return null;
  if (/^https?:/i.test(raw)) return cleanUrl(raw);
  return `https://instagram.com/${String(raw).replace(/^@/, "").trim()}`;
}
function pickFacebook(tags) {
  const raw = tags["contact:facebook"] || tags.facebook;
  if (!raw) return null;
  if (/^https?:/i.test(raw)) return cleanUrl(raw);
  return `https://facebook.com/${String(raw).replace(/^@/, "").trim()}`;
}
function cleanUrl(u) {
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(t)) return "https://" + t;
  return null;
}

function priceFromTags(tags) {
  // OSM has no consistent price tier. Heuristics:
  if (tags.fee === "yes") return "$$";
  // Public / natural / free-to-visit places never carry a price tier.
  if (
    tags.fee === "no" ||
    tags.natural === "beach" ||
    tags.natural === "waterfall" ||
    tags.leisure === "park" ||
    tags.leisure === "garden" ||
    tags.leisure === "nature_reserve" ||
    tags.tourism === "viewpoint" ||
    tags.man_made === "lighthouse" ||
    tags.highway === "trailhead"
  ) return "Free";
  if (tags["payment:cash"] === "no" || tags.luxury === "yes") return "$$$$";
  if (tags.amenity === "fast_food") return "$";
  if (tags.amenity === "restaurant") return "$$";
  if (tags.amenity === "bar" || tags.amenity === "pub") return "$$";
  if (tags.natural) return "Free";
  return "$$";
}

function seasonFromTags(tags) {
  const oh = tags.opening_hours || "";
  if (/24\/7/.test(oh)) return ["spring","summer","fall","winter"];
  if (/Jun|Jul|Aug|May|Sep/i.test(oh) && !/Dec|Jan|Feb/.test(oh)) return ["spring","summer","fall"];
  return ["spring","summer","fall","winter"];
}

function skillFromTags(tags) {
  if (tags["climbing:grade:uiaa"] || tags["sac_scale"]) {
    const s = (tags.sac_scale || "").toLowerCase();
    if (/^t[1-2]$/.test(s)) return "beginner";
    if (/^t[3-4]$/.test(s)) return "intermediate";
    if (/^t[5-6]$/.test(s)) return "advanced";
  }
  if (tags["mtb:scale"]) {
    const v = parseInt(tags["mtb:scale"], 10);
    if (v <= 1) return "beginner";
    if (v <= 3) return "intermediate";
    return "advanced";
  }
  return null;
}

function derivedTags(tags) {
  const out = new Set();
  if (tags.cuisine) tags.cuisine.split(";").forEach((c) => out.add(c.trim()));
  if (tags.tourism) out.add(tags.tourism.replace(/_/g, " "));
  if (tags.leisure) out.add(tags.leisure.replace(/_/g, " "));
  if (tags.sport)   out.add(tags.sport.replace(/_/g, " "));
  if (tags.craft)   out.add(tags.craft.replace(/_/g, " "));
  if (tags.shop && tags.shop !== "yes") out.add(tags.shop.replace(/_/g, " "));
  if (tags.historic) out.add(tags.historic.replace(/_/g, " "));
  if (tags["addr:city"]) out.add(tags["addr:city"]);
  return Array.from(out).filter(Boolean).slice(0, 6);
}

function detectHiddenGem(name, description, tags) {
  const blob = `${name || ""} ${description || ""} ${tags.note || ""}`;
  return HIDDEN_GEM_HINTS.test(blob);
}
