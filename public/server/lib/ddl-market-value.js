'use strict';

/**
 * Turns matched eBay rows into a price per DDL print.
 * Order of trust: sold comps → active asks (discounted) → pack-math estimate.
 */

const checklist = require('../../../dd-evaluator/ddl-checklist.js');

const SOLD_WINDOW_DAYS = 120;
const SEALED_WINDOW_DAYS = 60;
const MAX_RECENT = 10;
const ASK_DISCOUNT = 0.85;
const MIN_CARD_USD = 0.25;

/** Official pack odds are unpublished; these are the stated assumptions behind every estimate. */
const DEFAULT_MODEL = {
	msrpBoxUsd: 179,
	packsPerBox: 24,
	cardsPerPack: 10,
	perBox: { base: 204, holo: 24, UR: 0.75, GIGA: 0.25 },
	share: { base: 0.2, holo: 0.3, UR: 0.3, GIGA: 0.2 },
};

const GRADE_CURVE = [
	[10, 3.0], [9.5, 2.2], [9, 1.6], [8.5, 1.35], [8, 1.2], [7, 1.0], [0, 0.85],
];
const COMPANY_FACTOR = { AGS: 1, PSA: 1, BGS: 1, CGC: 0.8, SGC: 0.75 };

function gradeMultiplier(key) {
	const m = String(key || '').match(/^(AGS|PSA|BGS|CGC|SGC) (\d+(?:\.5)?)$/);
	if (!m) return 1;
	const grade = Number(m[2]);
	const row = GRADE_CURVE.find(([g]) => grade >= g) || GRADE_CURVE[GRADE_CURVE.length - 1];
	const blackLabel = m[1] === 'BGS' && grade === 10 ? 1.3 : 1;
	return +(row[1] * (COMPANY_FACTOR[m[1]] || 1) * blackLabel).toFixed(3);
}

function round2(n) {
	return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

function median(values) {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(sorted, q) {
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function trimOutliers(values) {
	if (values.length < 4) return values;
	const s = [...values].sort((a, b) => a - b);
	const q1 = quantile(s, 0.25);
	const q3 = quantile(s, 0.75);
	const iqr = q3 - q1;
	return s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

function withinDays(iso, days, now) {
	const t = Date.parse(iso || '');
	return Number.isFinite(t) && now - t <= days * 86400000;
}

function summarizeSold(rows, now) {
	const recent = rows
		.filter((r) => withinDays(r.at, SOLD_WINDOW_DAYS, now))
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
		.slice(0, MAX_RECENT);
	if (!recent.length) return null;
	const kept = trimOutliers(recent.map((r) => r.unitUsd));
	return {
		usd: median(kept),
		n: recent.length,
		low: Math.min(...kept),
		high: Math.max(...kept),
		lastUsd: recent[0].unitUsd,
		lastAt: recent[0].at,
	};
}

function summarizeAsks(rows) {
	if (!rows.length) return null;
	const values = rows.map((r) => r.unitUsd);
	return { median: median(values), lowest: Math.min(...values), n: values.length };
}

function confidenceFor(n) {
	if (n >= 5) return 'high';
	if (n >= 2) return 'medium';
	return 'low';
}

/** Lowest in-stock Doginal Dogs shop listing. Sold-out listings still count when nothing is in stock. */
function shopOffer(rows) {
	if (!rows || !rows.length) return null;
	const live = rows.filter((r) => r.available !== false);
	const pool = live.length ? live : rows;
	const best = pool.reduce((a, b) => (a.unitUsd <= b.unitUsd ? a : b));
	return { usd: best.unitUsd, n: pool.length, url: best.url || null, title: best.title || null };
}

function sealedPrice(sold, asks, shopRows, now, fallback) {
	const recent = sold.filter((r) => withinDays(r.at, SEALED_WINDOW_DAYS, now)).map((r) => r.unitUsd);
	if (recent.length) return { usd: median(trimOutliers(recent)), source: 'sold', n: recent.length, url: null };
	const shop = shopOffer(shopRows);
	if (shop) return { usd: shop.usd, source: 'shop', n: shop.n, url: shop.url };
	if (asks.length) return { usd: median(asks.map((r) => r.unitUsd)) * 0.9, source: 'asks', n: asks.length, url: null };
	return { usd: fallback, source: 'msrp', n: 0, url: null };
}

function modelEstimate(model, boxUsd, tier, print) {
	const slot = print === 'fa' ? tier : print;
	const share = model.share[slot];
	const perBox = model.perBox[slot];
	if (!share || !perBox) return null;
	return Math.max(MIN_CARD_USD, (share * boxUsd) / perBox);
}

function key(cardId, print, grade) {
	return `${cardId}|${print}|${grade}`;
}

function groupBy(rows) {
	const map = new Map();
	for (const row of rows) {
		const k = key(row.cardId, row.print, row.grade);
		if (!map.has(k)) map.set(k, []);
		map.get(k).push(row);
	}
	return map;
}

/**
 * @param {object} input
 * @param {Array} input.sold   matched sold singles {cardId, print, grade, unitUsd, at}
 * @param {Array} input.asks   matched active singles {cardId, print, grade, unitUsd}
 * @param {object} input.sealed {box: {sold, asks, shop}, pack: {sold, asks, shop}}
 * @param {Array} [input.shop] matched Doginal Dogs shop singles {cardId, print, grade, unitUsd, available}
 * @param {object} [input.model]
 * @param {Map|object} [input.artDogs] cardId → [{dogNumber, handle, note}]
 */
function priceCatalog(input) {
	const now = Date.now();
	const model = { ...DEFAULT_MODEL, ...(input.model || {}) };
	const sealed = input.sealed || {};
	const box = sealedPrice(sealed.box?.sold || [], sealed.box?.asks || [], sealed.box?.shop || [], now, model.msrpBoxUsd);
	const pack = sealedPrice(
		sealed.pack?.sold || [],
		sealed.pack?.asks || [],
		sealed.pack?.shop || [],
		now,
		box.usd / model.packsPerBox,
	);
	const soldBy = groupBy(input.sold || []);
	const asksBy = groupBy(input.asks || []);
	const shopBy = groupBy(input.shop || []);
	const artDogs = input.artDogs instanceof Map ? input.artDogs : new Map(Object.entries(input.artDogs || {}));

	const gradedKeys = new Map();
	for (const k of new Set([...soldBy.keys(), ...asksBy.keys()])) {
		const [cardId, print, grade] = k.split('|');
		if (grade === 'raw' || grade === 'graded') continue;
		const pk = `${cardId}|${print}`;
		if (!gradedKeys.has(pk)) gradedKeys.set(pk, new Set());
		gradedKeys.get(pk).add(grade);
	}

	function priceOne(card, print, grade) {
		const sold = summarizeSold(soldBy.get(key(card.id, print, grade)) || [], now);
		const shop = shopOffer(shopBy.get(key(card.id, print, grade)) || []);
		const asks = summarizeAsks(asksBy.get(key(card.id, print, grade)) || []);
		const estimate = modelEstimate(model, box.usd, card.tier, print);
		let usd = null;
		let source = 'model';
		let confidence = 'model';
		if (sold) {
			usd = sold.usd;
			source = 'sold';
			confidence = confidenceFor(sold.n);
		} else if (shop) {
			usd = shop.usd;
			source = 'shop';
			confidence = 'shop';
		} else if (asks) {
			usd = asks.median * ASK_DISCOUNT;
			source = 'asks';
			confidence = 'asks';
		}
		return {
			usd: round2(usd),
			source,
			confidence,
			sold: sold ? sold.n : 0,
			low: sold ? round2(sold.low) : null,
			high: sold ? round2(sold.high) : null,
			lastSoldUsd: sold ? round2(sold.lastUsd) : null,
			lastSoldAt: sold ? sold.lastAt : null,
			asks: asks ? asks.n : 0,
			lowestAskUsd: asks ? round2(asks.lowest) : null,
			estimateUsd: round2(estimate),
		};
	}

	const cards = checklist.cards.map((card) => {
		const prints = {};
		const graded = {};
		for (const print of card.prints) {
			const raw = priceOne(card, print, 'raw');
			if (raw.usd == null) raw.usd = raw.estimateUsd;
			prints[print] = raw;
			const grades = gradedKeys.get(`${card.id}|${print}`);
			if (grades) {
				graded[print] = {};
				for (const g of grades) {
					const row = priceOne(card, print, g);
					if (row.usd == null) {
						row.usd = round2(raw.usd * gradeMultiplier(g));
						row.source = 'derived';
					}
					graded[print][g] = row;
				}
			}
		}
		return {
			id: card.id,
			no: card.no,
			name: card.name,
			tier: card.tier,
			tierLabel: card.tierLabel,
			class: card.class,
			chase: card.chase,
			chaseNo: card.chaseNo,
			note: card.note,
			render: card.render,
			prints,
			graded,
			artDogs: artDogs.get(card.id) || [],
		};
	});

	return {
		box: { ...box, usd: round2(box.usd), msrpUsd: model.msrpBoxUsd },
		pack: { ...pack, usd: round2(pack.usd) },
		model,
		askDiscount: ASK_DISCOUNT,
		soldWindowDays: SOLD_WINDOW_DAYS,
		gradeMultipliers: Object.fromEntries(
			['AGS 10', 'AGS 9.5', 'AGS 9', 'AGS 8.5', 'AGS 8', 'AGS 7', 'AGS 6', 'AGS 5']
				.map((g) => [g, gradeMultiplier(g)]),
		),
		cards,
	};
}

module.exports = {
	priceCatalog,
	gradeMultiplier,
	DEFAULT_MODEL,
};
