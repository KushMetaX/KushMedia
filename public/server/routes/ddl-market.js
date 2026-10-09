'use strict';

/**
 * DDL TCG price evaluator API.
 *   GET  /cards            priced 111-card checklist (base / holo / full art + graded comps)
 *   GET  /card/:id         one card with its matched sold comps and active asks
 *   GET  /status           refresh + source health
 *   POST /admin/refresh    force an eBay pull                       (x-dd-admin-password)
 *   GET  /admin/review     titles we could not price, for tuning    (x-dd-admin-password)
 *   POST /admin/comps      add a manual sold comp (X, Discord, IRL)  (x-dd-admin-password)
 *   DELETE /admin/comps/:id
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { timingSafeEqualString } = require('../security-utils');
const ddEvaluator = require('./dd-evaluator');
const ebay = require('../services/ddl-ebay');
const shop = require('../services/ddl-shop');
const { classifyTitle } = require('../lib/ddl-market-match');
const { priceCatalog } = require('../lib/ddl-market-value');
const checklist = require('../../../dd-evaluator/ddl-checklist.js');

const router = express.Router();
const serverDataDir = path.resolve(__dirname, '..', 'data');
const LISTING_TTL_DAYS = 180;
const SALE_TTL_DAYS = 365;
const REVIEW_LIMIT = 200;
const PRINTS = new Set(['base', 'holo', 'fa']);

const byId = new Map(checklist.cards.map((c) => [c.id, c]));
const byName = new Map(checklist.cards.map((c) => [c.name.toLowerCase(), c]));

let store = null;
let comps = null;
let priced = null;
let review = [];
let refreshing = null;
let timer = null;

function refreshHours() {
	const h = Number(process.env.DDL_MARKET_REFRESH_HOURS || 6);
	return Number.isFinite(h) && h >= 0.5 ? h : 6;
}

function storePath() {
	return process.env.DDL_MARKET_PATH
		? path.resolve(process.env.DDL_MARKET_PATH)
		: path.join(serverDataDir, 'ddl-market.json');
}

function compsPath() {
	return process.env.DDL_MARKET_COMPS_PATH
		? path.resolve(process.env.DDL_MARKET_COMPS_PATH)
		: path.join(serverDataDir, 'ddl-market-comps.json');
}

function trendingConfigPath() {
	return process.env.DD_TRENDING_CONFIG_PATH
		? path.resolve(process.env.DD_TRENDING_CONFIG_PATH)
		: path.join(serverDataDir, 'dd-trending-config.json');
}

function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (_err) {
		return fallback;
	}
}

function writeJson(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n', 'utf8');
	fs.renameSync(tmp, file);
}

function loadStore() {
	if (store) return store;
	const raw = readJson(storePath(), null);
	store = raw && typeof raw === 'object' ? raw : {};
	store.version = 1;
	store.listings ||= {};
	store.sales ||= {};
	store.shop ||= { products: [] };
	store.sources ||= {};
	return store;
}

function loadComps() {
	if (comps) return comps;
	const raw = readJson(compsPath(), []);
	comps = Array.isArray(raw) ? raw : [];
	return comps;
}

function resolveCard(ref) {
	const s = String(ref || '').trim();
	if (!s) return null;
	const upper = s.toUpperCase();
	if (byId.has(upper)) return byId.get(upper);
	if (/^\d{1,3}$/.test(s)) return byId.get('V' + s.padStart(3, '0')) || null;
	return byName.get(s.toLowerCase()) || (s.toLowerCase() === 'darron' ? byName.get('barron') : null) || null;
}

/** Official art dogs from the DD admin "TCG Inspirations" table. */
function artDogsByCard() {
	const cfg = readJson(trendingConfigPath(), {});
	const rows = Array.isArray(cfg.tcgInspirations) ? cfg.tcgInspirations : [];
	const map = new Map();
	for (const row of rows) {
		const card = resolveCard(row.cardId) || resolveCard(row.cardName);
		const dogNumber = Number(row.dogNumber);
		if (!card || !Number.isInteger(dogNumber) || dogNumber < 1) continue;
		if (!map.has(card.id)) map.set(card.id, []);
		map.get(card.id).push({
			dogNumber,
			handle: row.brandedHandle || null,
			note: row.note || null,
		});
	}
	return map;
}

function usd(row) {
	if (!row || String(row.currency || 'USD').toUpperCase() !== 'USD') return null;
	const price = Number(row.price);
	if (!Number.isFinite(price) || price <= 0) return null;
	const ship = Number(row.shipping);
	return price + (Number.isFinite(ship) && ship > 0 ? ship : 0);
}

function pushReview(row, match, source) {
	if (review.length >= REVIEW_LIMIT) return;
	review.push({ source, kind: match.kind, reason: match.reason || null, title: row.title, url: row.url, price: row.price });
}

function recompute() {
	const s = loadStore();
	const sold = [];
	const asks = [];
	const shopSingles = [];
	const sealed = {
		box: { sold: [], asks: [], shop: [] },
		pack: { sold: [], asks: [], shop: [] },
	};
	review = [];

	function take(row, source, at) {
		const landed = usd(row);
		if (landed == null) return;
		const match = classifyTitle(row.title);
		const unitUsd = landed / Math.max(1, match.qty || 1);
		const base = {
			unitUsd,
			at,
			title: row.title,
			url: row.url,
			image: row.image || null,
			source,
			itemId: row.itemId,
			available: row.available !== false,
		};
		if (match.kind === 'single' && match.grade !== 'graded') {
			const hit = { ...base, cardId: match.cardId, print: match.print, grade: match.grade };
			if (source === 'shop') shopSingles.push(hit);
			else (source === 'ask' ? asks : sold).push(hit);
		} else if (match.kind === 'box' || match.kind === 'pack') {
			const bucket = source === 'shop' ? 'shop' : (source === 'ask' ? 'asks' : 'sold');
			sealed[match.kind][bucket].push(base);
		} else if (match.kind !== 'off-set') {
			const shopNoise = source === 'shop' && (match.kind === 'other' || !/\blegends\b|\btcg\b|rise of the pack|\bbooster\b|\bcard\b/i.test(row.title || ''));
			if (!shopNoise) pushReview(row, match, source);
		}
	}

	for (const row of Object.values(s.sales)) take(row, 'ebay', row.soldAt || row.lastSeen);
	for (const row of s.shop?.products || []) take(row, 'shop', row.updatedAt || s.shop.at);
	for (const row of Object.values(s.listings)) {
		if (!row.active) continue;
		if (Array.isArray(row.buying) && row.buying.length && !row.buying.includes('FIXED_PRICE')) continue;
		take(row, 'ask', row.lastSeen);
	}
	for (const c of loadComps()) {
		const entry = { unitUsd: Number(c.usd), at: c.at, title: c.note || 'Manual comp', url: c.url || null, source: 'manual', itemId: c.id };
		if (c.kind === 'box' || c.kind === 'pack') sealed[c.kind].sold.push(entry);
		else sold.push({ ...entry, cardId: c.cardId, print: c.print, grade: c.grade || 'raw' });
	}

	priced = {
		...priceCatalog({ sold, asks, shop: shopSingles, sealed, artDogs: artDogsByCard() }),
		comps: { sold, asks: asks.concat(shopSingles), sealed },
	};
	return priced;
}

async function refresh(log = console.log) {
	if (refreshing) return refreshing;
	refreshing = (async () => {
		const s = loadStore();
		const now = new Date().toISOString();
		if (!ebay.isConfigured()) {
			s.sources.browse = { ok: false, at: now, error: 'Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env' };
			s.sources.insights = { ok: false, at: now, error: 'Needs eBay API keys first' };
		} else {
			try {
				const rows = await ebay.searchActive();
				for (const row of Object.values(s.listings)) row.active = false;
				for (const row of rows) {
					const prev = s.listings[row.itemId];
					s.listings[row.itemId] = { ...row, firstSeen: prev?.firstSeen || now, lastSeen: now, active: true };
				}
				s.sources.browse = { ok: true, at: now, count: rows.length };
			} catch (err) {
				s.sources.browse = { ok: false, at: now, error: err.message };
				log('[ddl-market] Browse API failed:', err.message);
			}
			try {
				const rows = await ebay.searchSold();
				for (const row of rows) s.sales[row.itemId] = { ...s.sales[row.itemId], ...row, lastSeen: now };
				s.sources.insights = { ok: true, at: now, count: rows.length };
			} catch (err) {
				const denied = err.status === 403 || err.status === 401 || /scope|access|grant/i.test(err.message);
				s.sources.insights = {
					ok: false,
					at: now,
					error: denied ? 'eBay has not approved Marketplace Insights (sold data) for this app yet' : err.message,
				};
			}
		}
		try {
			const products = await shop.listProducts();
			s.shop = { at: now, products };
			s.sources.shop = { ok: true, at: now, count: products.length };
		} catch (err) {
			s.sources.shop = { ok: false, at: now, error: err.message, count: (s.shop?.products || []).length };
			log('[ddl-market] Doginal Dogs shop failed:', err.message);
		}
		const cutoffListing = Date.now() - LISTING_TTL_DAYS * 86400000;
		for (const [id, row] of Object.entries(s.listings)) {
			if (!row.active && Date.parse(row.lastSeen) < cutoffListing) delete s.listings[id];
		}
		const cutoffSale = Date.now() - SALE_TTL_DAYS * 86400000;
		for (const [id, row] of Object.entries(s.sales)) {
			if (Date.parse(row.soldAt || row.lastSeen) < cutoffSale) delete s.sales[id];
		}
		s.refreshedAt = now;
		s.nextRefreshAt = new Date(Date.now() + refreshHours() * 3600000).toISOString();
		try {
			writeJson(storePath(), s);
		} catch (err) {
			log('[ddl-market] Could not save market store:', err.message);
		}
		recompute();
		const data = priced;
		log(`[ddl-market] refreshed: ${Object.values(s.listings).filter((r) => r.active).length} eBay active, ${(s.shop?.products || []).length} shop, box $${data?.box?.usd} (${data?.box?.source}), pack $${data?.pack?.usd} (${data?.pack?.source})`);
		return s;
	})().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

function schedule(log) {
	if (timer) clearTimeout(timer);
	const s = loadStore();
	const due = Date.parse(s.nextRefreshAt || '') || 0;
	const wait = Math.max(15000, due - Date.now());
	timer = setTimeout(() => {
		refresh(log).catch((err) => log('[ddl-market] refresh failed:', err.message)).finally(() => schedule(log));
	}, wait);
	if (timer.unref) timer.unref();
}

function pullShop(log = console.log) {
	const s = loadStore();
	const now = new Date().toISOString();
	return shop.listProducts().then((products) => {
		s.shop = { at: now, products };
		s.sources.shop = { ok: true, at: now, count: products.length };
		s.refreshedAt = now;
		try {
			writeJson(storePath(), s);
		} catch (err) {
			log('[ddl-market] Could not save shop listings:', err.message);
		}
		recompute();
		log(`[ddl-market] shop listings: ${products.length}, box $${priced?.box?.usd} (${priced?.box?.source}), pack $${priced?.pack?.usd} (${priced?.pack?.source})`);
	}).catch((err) => {
		s.sources.shop = { ok: false, at: now, error: err.message, count: (s.shop?.products || []).length };
		log('[ddl-market] Doginal Dogs shop failed:', err.message);
	});
}

function initDdlMarket(log = console.log) {
	loadStore();
	recompute();
	pullShop(log);
	if (/^(1|true|yes|on)$/i.test(String(process.env.DDL_MARKET_SKIP_REFRESH || ''))) {
		log('[ddl-market] eBay refresh disabled (DDL_MARKET_SKIP_REFRESH).');
		return;
	}
	if (!ebay.isConfigured()) log('[ddl-market] eBay keys missing; serving pack-math estimates and manual comps only.');
	schedule(log);
}

function requireAdmin(req, res, next) {
	const expected = ddEvaluator.getExpectedDdAdminPassword();
	const given = String(req.headers['x-dd-admin-password'] || '').trim();
	if (!expected || !given || !timingSafeEqualString(expected, given)) {
		return res.status(401).json({ error: 'Invalid DD admin password.' });
	}
	next();
}

function publicSources(sources) {
	const out = {};
	for (const [name, row] of Object.entries(sources || {})) {
		out[name] = { ok: Boolean(row && row.ok), at: row?.at || null, count: row?.count ?? null };
	}
	return out;
}

function statusPayload(admin) {
	const s = loadStore();
	const data = priced || recompute();
	return {
		configured: ebay.isConfigured(),
		marketplace: ebay.marketplace(),
		refreshHours: refreshHours(),
		refreshedAt: s.refreshedAt || null,
		nextRefreshAt: s.nextRefreshAt || null,
		sources: admin ? s.sources : publicSources(s.sources),
		counts: {
			activeListings: Object.values(s.listings).filter((r) => r.active).length,
			shopListings: (s.shop?.products || []).length,
			soldListings: Object.keys(s.sales).length,
			matchedSold: data.comps.sold.filter((r) => r.source === 'ebay').length,
			matchedAsks: data.comps.asks.length,
			manualComps: loadComps().length,
			needsReview: review.length,
		},
	};
}

function publicComp(row) {
	return {
		usd: Math.round(row.unitUsd * 100) / 100,
		at: row.at || null,
		title: row.title,
		url: row.url,
		image: row.image || null,
		source: row.source,
		print: row.print,
		grade: row.grade,
	};
}

router.get('/status', (_req, res) => {
	res.set('Cache-Control', 'no-store');
	res.json(statusPayload());
});

router.get('/cards', (_req, res) => {
	const data = priced || recompute();
	const { comps: _omit, ...rest } = data;
	res.set('Cache-Control', 'public, max-age=300');
	res.json({ ...statusPayload(), ...rest });
});

router.get('/card/:id', (req, res) => {
	const card = resolveCard(req.params.id);
	if (!card) return res.status(404).json({ error: 'Unknown card.' });
	const data = priced || recompute();
	const entry = data.cards.find((c) => c.id === card.id);
	const byRecent = (a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0);
	res.set('Cache-Control', 'public, max-age=300');
	res.json({
		card: entry,
		sold: data.comps.sold.filter((r) => r.cardId === card.id).sort(byRecent).slice(0, 50).map(publicComp),
		asks: data.comps.asks.filter((r) => r.cardId === card.id).sort((a, b) => a.unitUsd - b.unitUsd).slice(0, 50).map(publicComp),
	});
});

router.post('/admin/refresh', requireAdmin, async (_req, res) => {
	try {
		await refresh();
		schedule(console.log);
		res.json(statusPayload(true));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

router.get('/admin/review', requireAdmin, (_req, res) => {
	res.set('Cache-Control', 'no-store');
	res.json({ status: statusPayload(true), rows: review, comps: loadComps() });
});

router.post('/admin/comps', requireAdmin, (req, res) => {
	const body = req.body || {};
	const kind = ['box', 'pack'].includes(body.kind) ? body.kind : 'single';
	const price = Number(body.usd);
	if (!Number.isFinite(price) || price <= 0 || price > 1e6) return res.status(400).json({ error: 'usd must be a positive number.' });
	const at = body.at && Number.isFinite(Date.parse(body.at)) ? new Date(body.at).toISOString() : new Date().toISOString();
	const entry = {
		id: crypto.randomUUID(),
		kind,
		usd: Math.round(price * 100) / 100,
		at,
		url: typeof body.url === 'string' && /^https?:\/\//i.test(body.url) ? body.url.slice(0, 500) : null,
		note: typeof body.note === 'string' ? body.note.slice(0, 200) : null,
		addedAt: new Date().toISOString(),
	};
	if (kind === 'single') {
		const card = resolveCard(body.cardId || body.name);
		if (!card) return res.status(400).json({ error: 'Unknown card. Use V### or the card name.' });
		const print = card.chase ? 'fa' : String(body.print || 'base');
		if (!PRINTS.has(print) || !card.prints.includes(print)) {
			return res.status(400).json({ error: `${card.name} prints as ${card.prints.join(' / ')}.` });
		}
		const grade = String(body.grade || 'raw').trim();
		if (grade !== 'raw' && !/^(AGS|PSA|BGS|CGC|SGC) (10|[1-9](\.5)?)$/.test(grade)) {
			return res.status(400).json({ error: 'grade must be raw or like "AGS 10".' });
		}
		Object.assign(entry, { cardId: card.id, print, grade });
	}
	const list = loadComps();
	list.push(entry);
	try {
		writeJson(compsPath(), list);
	} catch (err) {
		list.pop();
		return res.status(500).json({ error: 'Could not save comp: ' + err.message });
	}
	recompute();
	res.json({ ok: true, comp: entry });
});

router.delete('/admin/comps/:id', requireAdmin, (req, res) => {
	const list = loadComps();
	const idx = list.findIndex((c) => c.id === req.params.id);
	if (idx < 0) return res.status(404).json({ error: 'Comp not found.' });
	const [removed] = list.splice(idx, 1);
	try {
		writeJson(compsPath(), list);
	} catch (err) {
		list.splice(idx, 0, removed);
		return res.status(500).json({ error: 'Could not save: ' + err.message });
	}
	recompute();
	res.json({ ok: true });
});

module.exports = router;
module.exports.initDdlMarket = initDdlMarket;
module.exports.refresh = refresh;
