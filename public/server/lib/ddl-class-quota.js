'use strict';

/**
 * Host class-mix rule for locked tournament decks.
 * A card counts toward a hero class if it is that class or All-class
 * (Mini / Midi / Mega). Neutral only counts when Neutral is the required class.
 */

const fs = require('fs');
const path = require('path');

const HERO_CLASSES = ['Crown', 'Bow', 'Wizard', 'Zombie', 'Pirate'];
const QUOTA_CLASSES = HERO_CLASSES.concat('Neutral');
const DECK_SIZE = 40;

let cardsById = null;

function catalogPath() {
	return path.join(__dirname, '../../../bracket/ddl-cards.js');
}

function loadCards() {
	if (cardsById) return cardsById;
	const text = fs.readFileSync(catalogPath(), 'utf8');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) {
		throw new Error('DDL card catalog is missing');
	}
	const pack = JSON.parse(text.slice(start, end + 1));
	const map = new Map();
	for (const card of pack.cards || []) {
		const id = String(card && card.id || '').trim().toUpperCase();
		if (id) map.set(id, card);
	}
	if (!map.size) throw new Error('DDL card catalog is empty');
	cardsById = map;
	return cardsById;
}

function cardById(id) {
	const key = String(id || '').trim().toUpperCase();
	if (!key) return null;
	return loadCards().get(key) || null;
}

function canonClass(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	return QUOTA_CLASSES.find((id) => id.toLowerCase() === raw.toLowerCase()) || '';
}

function sanitizePercent(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(1, Math.round(n)));
}

function sanitizeQuota(src) {
	if (!src || src === false) return null;
	const raw = typeof src === 'object' ? src : {};
	const klass = canonClass(raw.class || raw.deckClass || src);
	const percent = sanitizePercent(raw.percent != null ? raw.percent : raw.deckClassPercent);
	if (!klass || !(percent > 0)) return null;
	return { class: klass, percent };
}

function cardCountsAsClass(card, klass) {
	const want = canonClass(klass);
	if (!card || !want) return false;
	const printed = String(card.class || '');
	if (card.all_class || printed === 'All') return want !== 'Neutral';
	if (printed === want) return true;
	const extra = Array.isArray(card.classes) ? card.classes : [];
	return extra.some((c) => String(c) === want);
}

function shareFromCounts(counts, klass) {
	const want = canonClass(klass);
	let total = 0;
	let matching = 0;
	for (const [id, qty] of Object.entries(counts && typeof counts === 'object' ? counts : {})) {
		const n = Math.max(0, Number(qty) || 0);
		if (!n) continue;
		total += n;
		const card = cardById(id);
		if (card && cardCountsAsClass(card, want)) matching += n;
	}
	return {
		class: want,
		matching,
		total,
		percent: total > 0 ? (matching / total) * 100 : 0,
	};
}

function neededCount(quota, total) {
	const size = Math.max(0, Number(total) || 0) || DECK_SIZE;
	const pct = Number(quota && quota.percent) || 0;
	if (!pct) return 0;
	return Math.ceil((pct / 100) * size);
}

function mixLabel(quota) {
	const rule = sanitizeQuota(quota);
	if (!rule) return '';
	return `${rule.percent}% ${rule.class}`;
}

function failMessage(result) {
	if (!result || !result.required || result.ok) return '';
	const rule = result.rule;
	const share = result.share || { matching: 0, total: 0 };
	const havePct = share.total ? Math.round((share.matching / share.total) * 100) : 0;
	return `This arena needs at least ${rule.percent}% ${rule.class} (${result.need} of ${share.total || DECK_SIZE} cards). This list has ${share.matching} ${rule.class} (${havePct}%). Mini, Midi, and Mega count as every hero class. Neutral only counts when Neutral is the required class.`;
}

function evaluateQuota(counts, quota) {
	const rule = sanitizeQuota(quota);
	if (!rule) return { required: false, ok: true, rule: null, need: 0, share: null, message: '' };
	const share = shareFromCounts(counts, rule.class);
	const need = neededCount(rule, share.total || DECK_SIZE);
	const ok = share.total > 0 && share.matching >= need;
	const result = { required: true, ok, rule, need, share, message: '' };
	if (!ok) result.message = failMessage(result);
	return result;
}

function assertDeckQuota(counts, quota) {
	const result = evaluateQuota(counts, quota);
	if (!result.required || result.ok) return result;
	const err = new Error(result.message);
	err.status = 400;
	throw err;
}

function fieldQuotaGaps(entries, quota) {
	const rule = sanitizeQuota(quota);
	if (!rule) return [];
	const gaps = [];
	for (const entry of entries || []) {
		const handle = String((entry && entry.handle) || 'Player').trim() || 'Player';
		const deck = entry && entry.registeredDeck;
		if (!deck || !deck.counts) {
			gaps.push(`${handle} has no locked Play deck`);
			continue;
		}
		const result = evaluateQuota(deck.counts, rule);
		if (!result.ok) {
			gaps.push(`${handle}: ${result.share.matching}/${result.share.total || DECK_SIZE} ${rule.class} (need ${result.need})`);
		}
	}
	return gaps;
}

function assertFieldQuota(entries, quota) {
	const rule = sanitizeQuota(quota);
	if (!rule) return;
	const gaps = fieldQuotaGaps(entries, rule);
	if (!gaps.length) return;
	const err = new Error(`Locked decks must be at least ${mixLabel(rule)}. ${gaps.join('; ')}`);
	err.status = 400;
	throw err;
}

module.exports = {
	HERO_CLASSES,
	QUOTA_CLASSES,
	DECK_SIZE,
	canonClass,
	sanitizeQuota,
	sanitizePercent,
	cardCountsAsClass,
	shareFromCounts,
	neededCount,
	mixLabel,
	evaluateQuota,
	assertDeckQuota,
	fieldQuotaGaps,
	assertFieldQuota,
};
