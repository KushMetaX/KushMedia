'use strict';

/**
 * Reads an eBay listing title and decides what DDL TCG product it is:
 * one card print (base / holo / full art, raw or graded), a sealed box or pack,
 * a multi-card lot, or something we should not price (accessories, customs, other sets).
 */

const checklist = require('../../../dd-evaluator/ddl-checklist.js');

const SET_HINT = /\bdoginal\b|\bddl\b|rise of the pack|legends tcg/;

const NOT_A_CARD = /\b(proxy|proxies|custom|fan ?made|replica|orica|reprint|sticker|stickers|playmat|play mat|sleeves?|binder|deck ?box|toploaders?|nft|inscription|digital|code card|poster|pin|plush|shirt|hoodie|hat|gift cards?)\b/;
const SPECIAL = /\b(signed|autograph(ed)?|auto|misprint|error|miscut|test print|sample|prototype|artist proof|1 of 1|1\/1|serial(ized)?|stamped|promo)\b/;
const LOT = /\b(lot|lots|bundle|bulk|collection|playset|set of|complete set|master set|full set|mixed|random|mystery|repack)\b/;
const BOX = /\b(booster box|display box|sealed box|hobby box|box|display|case)\b/;
const PACK = /\b(booster packs?|packs?)\b/;

/** "Signed by Bark" names the founder, not the Bark card. */
const SIGNER = /\bsigned( by)? [a-z]+\b/g;

function normalize(text) {
	return String(text || '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’`]/g, '')
		.replace(/[^a-z0-9/.#]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NAME_PATTERNS = (() => {
	const rows = [];
	for (const card of checklist.cards) {
		for (const name of [card.name, ...(card.aliases || [])]) {
			const key = normalize(name);
			rows.push({ card, key, re: new RegExp('\\b' + escapeRegex(key).replace(/ /g, '\\s+') + '\\b', 'g') });
		}
	}
	return rows.sort((a, b) => b.key.length - a.key.length);
})();

const BY_NO = new Map(checklist.cards.map((c) => [c.no, c]));

function findSerial(text) {
	const patterns = [
		/\bv\s?(\d{3})\b/,
		/\b(\d{1,3})\s*\/\s*111\b/,
		/#\s*(\d{1,3})\b/,
		/\bno\.?\s*(\d{1,3})\b/,
	];
	for (const re of patterns) {
		const m = text.match(re);
		if (!m) continue;
		const card = BY_NO.get(Number(m[1]));
		if (card) return card;
	}
	return null;
}

function findGrade(text) {
	let m = text.match(/\bags\s*(10|[1-9](?:\.5)?)\b/);
	if (m) return { company: 'AGS', grade: Number(m[1]) };
	m = text.match(/\bpsa\s*(10|[1-9])\b/);
	if (m) return { company: 'PSA', grade: Number(m[1]) };
	m = text.match(/\b(bgs|beckett)\s*(10|[1-9](?:\.5)?)\b/);
	if (m) return { company: 'BGS', grade: Number(m[2]) };
	m = text.match(/\bcgc\s*(10|[1-9](?:\.5)?)\b/);
	if (m) return { company: 'CGC', grade: Number(m[1]) };
	m = text.match(/\bsgc\s*(10|[1-9](?:\.5)?)\b/);
	if (m) return { company: 'SGC', grade: Number(m[1]) };
	if (/\b(graded|slab|slabbed)\b/.test(text)) return { company: null, grade: null };
	return null;
}

function gradeKey(grade) {
	if (!grade) return 'raw';
	if (!grade.company || grade.grade == null) return 'graded';
	return `${grade.company} ${grade.grade}`;
}

function findQuantity(text) {
	const patterns = [
		/\b(\d{1,3})\s*x\b/,
		/\bx\s*(\d{1,3})\b/,
		/\b(\d{1,3})\s*(?:booster )?packs\b/,
		/\b(\d{1,3})\s*(?:booster )?boxes\b/,
		/\bqty\s*(\d{1,3})\b/,
	];
	for (const re of patterns) {
		const m = text.match(re);
		if (m) {
			const n = Number(m[1]);
			if (n >= 1 && n <= 500) return n;
		}
	}
	return 1;
}

function findNames(text) {
	let rest = ` ${text} `;
	const hits = new Map();
	for (const row of NAME_PATTERNS) {
		row.re.lastIndex = 0;
		if (!row.re.test(rest)) continue;
		row.re.lastIndex = 0;
		rest = rest.replace(row.re, ' ');
		hits.set(row.card.id, row.card);
	}
	return [...hits.values()];
}

/**
 * @param {string} title
 * @returns {{
 *   kind: 'single'|'box'|'pack'|'lot'|'special'|'other'|'unmatched'|'off-set',
 *   cardId?: string, print?: 'base'|'holo'|'fa', grade?: string, qty: number, reason?: string
 * }}
 */
function classifyTitle(title) {
	const text = normalize(title);
	const qty = findQuantity(text);
	if (!SET_HINT.test(text)) return { kind: 'off-set', qty, reason: 'No Doginal Dogs / DDL in title' };
	if (NOT_A_CARD.test(text)) return { kind: 'other', qty, reason: 'Accessory or non-card item' };

	const special = SPECIAL.test(text);
	const grade = findGrade(text);
	const holo = /\b(holo|holographic|foil|reverse)\b/.test(text) && !/\bnon holo\b/.test(text);
	const withoutSet = text.replace(/\brise of the pack\b/g, ' ');
	const boxWords = BOX.test(withoutSet);
	const packWords = PACK.test(withoutSet);

	const serialCard = findSerial(text);
	const names = findNames(text.replace(SIGNER, ' '));

	let card = null;
	if (serialCard && (names.length <= 1 || names.some((c) => c.id === serialCard.id))) card = serialCard;
	else if (!serialCard && names.length === 1) card = names[0];

	if (!card) {
		if (names.length > 1 || LOT.test(text)) return { kind: 'lot', qty, reason: `${names.length} card names` };
		if (boxWords) return { kind: 'box', qty };
		if (packWords) return { kind: 'pack', qty };
		return { kind: 'unmatched', qty, reason: 'No card name found' };
	}
	if (LOT.test(text) && qty === 1) return { kind: 'lot', qty, cardId: card.id, reason: 'Lot wording' };

	const print = card.chase ? 'fa' : (holo ? 'holo' : 'base');
	const out = { kind: special ? 'special' : 'single', cardId: card.id, print, grade: gradeKey(grade), qty };
	if (special) out.reason = 'Signed, error, promo, or 1/1';
	return out;
}

module.exports = {
	classifyTitle,
	normalize,
	gradeKey,
};
