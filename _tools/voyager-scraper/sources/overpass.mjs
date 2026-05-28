/**
 * OpenStreetMap Overpass API client.
 *
 * Endpoint: https://overpass-api.de/api/interpreter (community-funded)
 * License: ODbL — output must credit "© OpenStreetMap contributors".
 * Rate limits: ~10,000 query elements/min/IP. Cache responses on disk so
 * re-runs don't hammer the public servers.
 *
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OVERPASS_FILTERS } from "../config/categories.mjs";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const USER_AGENT = "voyager-scraper/0.1 (+https://kushmedia.xyz; contact via /contact)";

function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  const filters = OVERPASS_FILTERS
    .map((f) => `  node${f}["name"](${s},${w},${n},${e});\n  way${f}["name"](${s},${w},${n},${e});`)
    .join("\n");
  return `[out:json][timeout:90];\n(\n${filters}\n);\nout center tags;`;
}

function cacheKey(bbox) {
  const h = crypto.createHash("sha1").update(JSON.stringify(bbox)).digest("hex").slice(0, 12);
  return `overpass-${h}.json`;
}

/**
 * Fetch raw OSM elements within `bbox`. Caches the response on disk under
 * `data/raw/`; pass `{ noCache: true }` to bypass the cache.
 */
export async function fetchOverpass(bbox, opts = {}) {
  const cacheDir = path.resolve("data", "raw");
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, cacheKey(bbox));

  if (!opts.noCache) {
    try {
      const raw = await fs.readFile(cacheFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.elements)) {
        if (opts.verbose) console.log(`[overpass] cache hit ${path.basename(cacheFile)} (${parsed.elements.length} elements)`);
        return parsed.elements;
      }
    } catch (_e) { /* miss → fetch */ }
  }

  const query = buildQuery(bbox);
  let lastErr = null;
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const url = ENDPOINTS[i];
    try {
      if (opts.verbose) console.log(`[overpass] POST ${url} (bbox=${bbox.join(",")})`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000)
      });
      if (!res.ok) {
        // 429 = rate limit, 504 = gateway timeout. Try next endpoint.
        if (res.status === 429 || res.status === 504 || res.status === 502) {
          lastErr = new Error(`overpass ${url} -> HTTP ${res.status}`);
          if (opts.verbose) console.warn(`[overpass] ${res.status} from ${url}, trying next mirror…`);
          await sleep(1500);
          continue;
        }
        throw new Error(`overpass ${url} -> HTTP ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const elements = Array.isArray(json.elements) ? json.elements : [];
      // Overpass surfaces runtime errors via a `remark` field with HTTP 200
      // — the elements array will be empty or partial. Treat as a failure
      // so the caller can retry against a smaller bbox.
      if (json.remark && /runtime|timeout|out of memory|unknown/i.test(json.remark)) {
        lastErr = new Error(`overpass remark: ${json.remark}`);
        if (opts.verbose) console.warn(`[overpass] runtime remark from ${url}: ${json.remark} — trying next mirror…`);
        await sleep(2000);
        continue;
      }
      await fs.writeFile(cacheFile, JSON.stringify({ fetchedAt: new Date().toISOString(), bbox, elements }, null, 2));
      if (opts.verbose) console.log(`[overpass] fetched ${elements.length} elements (cached → ${path.basename(cacheFile)})`);
      return elements;
    } catch (err) {
      lastErr = err;
      if (opts.verbose) console.warn(`[overpass] error from ${url}: ${err.message} — trying next mirror…`);
      await sleep(1500);
    }
  }
  throw new Error(`Overpass: all ${ENDPOINTS.length} endpoints failed. Last error: ${lastErr ? lastErr.message : "unknown"}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
