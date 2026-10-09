'use strict';

/**
 * DDL TCG Play (ddltcg.com/play) deck list text.
 * Export / import match their builder: `# DDL TCG`, `3× Card Name`, `# serials:`.
 */

const fs = require('fs');
const path = require('path');

const DECK_SIZE = 40;
const MAX_COPIES = 3;
const SERIAL_RE = /^V\d{3}$/i;
const SERIAL_FIND = /\bV\d{3}\b/gi;
/** Wayne is pulled from the ddltcg.com builder, lists, and play. Their parser drops it silently. */
const UNPLAYABLE_SERIALS = { V029: 1 };

let cardsById = null;
let serialByName = null;

function catalogPath() {
	return path.join(__dirname, '../../../bracket/ddl-cards.js');
}

function loadCards() {
	if (cardsById && serialByName) {
		return { cardsById, serialByName };
	}
	const text = fs.readFileSync(catalogPath(), 'utf8');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('DDL card catalog is missing');
	const pack = JSON.parse(text.slice(start, end + 1));
	const byId = new Map();
	const byName = new Map();
	for (const card of pack.cards || []) {
		const id = String(card && card.id || '').trim().toUpperCase();
		if (!id) continue;
		byId.set(id, card);
		if (UNPLAYABLE_SERIALS[id]) continue;
		const name = String(card && card.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
		if (name) byName.set(name, id);
	}
	if (!byId.size) throw new Error('DDL card catalog is empty');
	cardsById = byId;
	serialByName = byName;
	return { cardsById, serialByName };
}

function serialKey(value) {
	const id = String(value || '').trim().toUpperCase();
	return SERIAL_RE.test(id) ? id : '';
}

function cardNameOf(id) {
	const card = loadCards().cardsById.get(serialKey(id));
	return card && card.name ? String(card.name) : serialKey(id);
}

function countsFromSerials(serials) {
	const counts = {};
	for (const item of serials || []) {
		const id = serialKey(item);
		if (!id) continue;
		counts[id] = Math.min(MAX_COPIES, (counts[id] || 0) + 1);
	}
	return counts;
}

function serialsFromCounts(counts) {
	const out = [];
	for (const id of Object.keys(counts || {}).sort()) {
		const n = Math.max(0, Math.min(MAX_COPIES, Number(counts[id]) || 0));
		for (let i = 0; i < n; i++) out.push(id);
	}
	return out;
}

function cardCountOf(counts, serials) {
	const fromCounts = Object.values(counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
	if (fromCounts > 0) return fromCounts;
	return Array.isArray(serials) ? serials.length : 0;
}

function parseListText(raw) {
	loadCards();
	const unknown = [];
	const dropped = [];
	let deckName = '';
	let serials = [];
	const text = String(raw || '');
	const stripped = text.trim();
	if (stripped.charAt(0) === '[') {
		try {
			const arr = JSON.parse(stripped);
			if (Array.isArray(arr)) serials = arr.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
		} catch (_err) {
			serials = [];
		}
	}
	if (!serials.length) {
		const fromLine = [];
		const fromBody = [];
		text.split(/\r?\n/).forEach((line) => {
			const s = String(line || '').trim();
			if (!s) return;
			const low = s.toLowerCase();
			if (low.indexOf('# name:') === 0) {
				deckName = s.split(':').slice(1).join(':').trim();
				return;
			}
			if (low.indexOf('# serials:') === 0) {
				const found = s.match(SERIAL_FIND) || [];
				found.forEach((tok) => fromLine.push(tok.toUpperCase()));
				return;
			}
			if (s.charAt(0) === '#') return;
			const tokens = s.match(SERIAL_FIND) || [];
			const rest = s.replace(/V\d{3}/ig, '').replace(/[^A-Za-z]/g, '');
			if (tokens.length && rest.length < 3) {
				tokens.forEach((tok) => fromBody.push(tok.toUpperCase()));
				return;
			}
			let count = 1;
			let label = s;
			let m = s.match(/^\s*(\d+)\s*[x×]\s+(.+?)\s*$/i);
			if (m) {
				count = parseInt(m[1], 10) || 1;
				label = m[2];
			} else {
				m = s.match(/^\s*(.+?)\s*[x×]\s*(\d+)\s*$/i);
				if (m) {
					label = m[1];
					count = parseInt(m[2], 10) || 1;
				} else {
					m = s.match(/^\s*(\d+)\s+(.+?)\s*$/);
					if (m) {
						count = parseInt(m[1], 10) || 1;
						label = m[2];
					}
				}
			}
			label = String(label || '').replace(/\s+/g, ' ').replace(/\s*\(V\d{3}\)\s*$/i, '').trim();
			let serial = serialByName.get(label.toLowerCase()) || '';
			if (!serial && SERIAL_RE.test(label)) serial = label.toUpperCase();
			if (!serial) {
				unknown.push(label || s);
				return;
			}
			const n = Math.max(1, Math.min(MAX_COPIES, count | 0));
			for (let i = 0; i < n; i++) fromBody.push(serial);
		});
		serials = fromLine.length ? fromLine : fromBody;
		if (fromLine.length) unknown.length = 0;
	}
	const out = [];
	const seen = {};
	serials.forEach((s) => {
		const key = serialKey(s);
		if (!key) return;
		if (UNPLAYABLE_SERIALS[key]) {
			dropped.push(key);
			return;
		}
		if (!cardsById.has(key)) {
			unknown.push(key);
			return;
		}
		const n = seen[key] | 0;
		if (n >= MAX_COPIES) return;
		seen[key] = n + 1;
		out.push(key);
	});
	return {
		ok: out.length > 0,
		serials: out,
		name: deckName,
		unknown: unknown.filter(Boolean),
		dropped,
		count: out.length,
		counts: countsFromSerials(out),
	};
}

/** Byte-for-byte the same shape the ddltcg.com/play builder writes, so a list round-trips either way. */
function formatListText(pack) {
	const src = pack && typeof pack === 'object' ? pack : {};
	const raw = Array.isArray(src.serials) && src.serials.length
		? src.serials.map(serialKey).filter(Boolean)
		: serialsFromCounts(src.counts || src.cards || {});
	const serials = serialsFromCounts(countsFromSerials(raw));
	const by = {};
	serials.forEach((id) => { by[id] = (by[id] || 0) + 1; });
	const name = String(src.name || 'Custom').trim() || 'Custom';
	const lines = ['# DDL TCG', `# name: ${name}`, `# count: ${serials.length}/${DECK_SIZE}`, ''];
	Object.keys(by)
		.sort((a, b) => cardNameOf(a).localeCompare(cardNameOf(b)))
		.forEach((id) => {
			lines.push(`${by[id]}× ${cardNameOf(id)}`);
		});
	lines.push('');
	lines.push(`# serials: ${serials.join(',')}`);
	return `${lines.join('\n')}\n`;
}

function snapshotFromParsed(parsed, extra) {
	const serials = (parsed && parsed.serials) || [];
	const counts = (parsed && parsed.counts) || countsFromSerials(serials);
	const cardCount = cardCountOf(counts, serials);
	const more = extra && typeof extra === 'object' ? extra : {};
	const slot = Number(more.slot);
	return {
		playName: String(more.playName || '').trim().slice(0, 16),
		slot: Number.isInteger(slot) && slot >= 1 && slot <= 5 ? slot : 0,
		name: String(more.name || parsed.name || 'Play list').trim().slice(0, 48) || 'Play list',
		isDefault: Boolean(more.isDefault),
		cardCount,
		ready: cardCount === DECK_SIZE,
		counts,
		serials: serials.slice(0, DECK_SIZE),
		lockedAt: new Date().toISOString(),
		source: 'list',
	};
}

module.exports = {
	DECK_SIZE,
	MAX_COPIES,
	UNPLAYABLE_SERIALS,
	serialKey,
	cardNameOf,
	countsFromSerials,
	serialsFromCounts,
	cardCountOf,
	parseListText,
	formatListText,
	snapshotFromParsed,
};
