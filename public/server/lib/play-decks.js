'use strict';

/**
 * Registered decks for a tournament.
 *
 * ddltcg.com/play keeps Hero Card lists private now — the public profile returns
 * an empty `decks` array — so a list only reaches us as pasted export text.
 * We snapshot that text at registration so the live Play list cannot change mid-event.
 */

const playList = require('./play-list');

const PLAY_ORIGIN = 'https://ddltcg.com';
const PLAY_NAME_RE = /^[A-Za-z0-9 ._-]{3,16}$/;
const SERIAL_RE = /^V\d{3}$/i;
const DECK_SIZE = playList.DECK_SIZE;
const MAX_COPIES = playList.MAX_COPIES;
const FETCH_MS = 12000;
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 24;

const rateHits = new Map();

function fail(status, message, extra) {
	const err = new Error(message);
	err.status = status;
	if (extra && typeof extra === 'object') Object.assign(err, extra);
	return err;
}

function sanitizePlayName(raw) {
	const name = String(raw || '').trim().replace(/\s+/g, ' ');
	if (name.length < 3 || name.length > 16) return '';
	if (!PLAY_NAME_RE.test(name)) return '';
	return name;
}

function requestIp(request) {
	const forwarded = String((request && request.headers && request.headers['x-forwarded-for']) || '');
	const first = forwarded.split(',')[0].trim();
	return first || String((request && request.ip) || '') || 'unknown';
}

function assertRateLimit(request) {
	const ip = requestIp(request);
	const now = Date.now();
	const kept = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
	if (kept.length >= RATE_MAX) {
		throw fail(429, 'Too many Play lookups. Wait a moment and try again.');
	}
	kept.push(now);
	rateHits.set(ip, kept);
}

function serialKey(value) {
	const id = String(value || '').trim().toUpperCase();
	return SERIAL_RE.test(id) ? id : '';
}

function countsFrom(rawCounts, serials) {
	const counts = {};
	if (rawCounts && typeof rawCounts === 'object' && !Array.isArray(rawCounts)) {
		for (const [key, qty] of Object.entries(rawCounts)) {
			const id = serialKey(key);
			const n = Math.max(0, Math.min(MAX_COPIES, Number(qty) || 0));
			if (!id || n <= 0) continue;
			counts[id] = Math.min(MAX_COPIES, (counts[id] || 0) + n);
		}
	}
	if (!Object.keys(counts).length && Array.isArray(serials)) {
		for (const item of serials) {
			const id = serialKey(item);
			if (!id) continue;
			counts[id] = Math.min(MAX_COPIES, (counts[id] || 0) + 1);
		}
	}
	return counts;
}

function serialsFrom(counts, serials) {
	if (Array.isArray(serials) && serials.length) {
		const out = [];
		for (const item of serials) {
			const id = serialKey(item);
			if (id) out.push(id);
		}
		if (out.length) return out.slice(0, DECK_SIZE);
	}
	const out = [];
	for (const id of Object.keys(counts).sort()) {
		const n = counts[id] || 0;
		for (let i = 0; i < n; i++) out.push(id);
	}
	return out.slice(0, DECK_SIZE);
}

function cardCountOf(counts, serials) {
	const fromCounts = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
	if (fromCounts > 0) return fromCounts;
	return Array.isArray(serials) ? serials.length : 0;
}

function sanitizeSnapshot(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const counts = countsFrom(raw.counts, raw.serials);
	const serials = serialsFrom(counts, raw.serials);
	const cardCount = cardCountOf(counts, serials);
	if (cardCount <= 0) return null;
	const playName = sanitizePlayName(raw.playName) || String(raw.playName || '').trim().slice(0, 16);
	return {
		playName,
		name: String(raw.name || 'Play list').trim().slice(0, 48) || 'Play list',
		cardCount,
		ready: cardCount === DECK_SIZE,
		counts,
		serials,
		lockedAt: String(raw.lockedAt || '').trim() || new Date().toISOString(),
		source: 'list',
	};
}

function lockFromText(raw, extra) {
	const parsed = playList.parseListText(raw);
	if (!parsed.ok) {
		const hint = parsed.unknown.length
			? `Could not read: ${parsed.unknown.slice(0, 4).join(', ')}`
			: 'Paste a list exported from ddltcg.com/play (3× Card Name lines, or V001 serials).';
		throw fail(400, hint);
	}
	if (parsed.count !== DECK_SIZE) {
		const short = parsed.dropped.length
			? ` ${parsed.dropped.length} card${parsed.dropped.length === 1 ? '' : 's'} in that list are out of play and were dropped.`
			: '';
		throw fail(400, `That list has ${parsed.count}/40 cards.${short} Export a full 40 from ddltcg.com/play, then paste it here.`);
	}
	const snap = playList.snapshotFromParsed(parsed, extra);
	snap.ready = true;
	return snap;
}

async function playFetch(url, fetchImpl) {
	const fetchFn = fetchImpl || fetch;
	const opts = {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'KushMedia-DDL-Tourney/1.0',
		},
	};
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		opts.signal = AbortSignal.timeout(FETCH_MS);
	}
	const res = await fetchFn(url, opts);
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data };
}

async function searchPlayers(query, fetchImpl) {
	const q = String(query || '').trim();
	if (q.length < 2) return [];
	const url = `${PLAY_ORIGIN}/api/players/search?q=${encodeURIComponent(q)}&limit=8`;
	let pack;
	try {
		pack = await playFetch(url, fetchImpl);
	} catch (_err) {
		return [];
	}
	if (!pack.ok || !pack.data || pack.data.ok === false) return [];
	return Array.isArray(pack.data.items) ? pack.data.items : [];
}

async function searchHeroes(query, fetchImpl) {
	const q = String(query || '').trim();
	if (q.length < 2) return { ok: true, q, items: [] };
	const items = await searchPlayers(q, fetchImpl);
	return {
		ok: true,
		q,
		items: items.map((row) => ({
			username: String(row.username || row.callsign || '').trim(),
			callsign: String(row.callsign || row.username || '').trim(),
			pfp: String(row.pfp || '').trim(),
		})).filter((row) => row.username),
	};
}

module.exports = {
	PLAY_ORIGIN,
	DECK_SIZE,
	sanitizePlayName,
	assertRateLimit,
	sanitizeSnapshot,
	lockFromText,
	searchHeroes,
	countsFrom,
	parseListText: playList.parseListText,
	formatListText: playList.formatListText,
};
