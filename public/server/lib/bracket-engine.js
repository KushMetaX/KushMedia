'use strict';

function nextPowerOfTwo(n) {
	if (n < 2) return 2;
	return 2 ** Math.ceil(Math.log2(n));
}

function seedOrder(size) {
	let seeds = [1, 2];
	while (seeds.length < size) {
		const next = [];
		const sum = seeds.length * 2 + 1;
		for (const s of seeds) next.push(s, sum - s);
		seeds = next;
	}
	return seeds;
}

function slotKey(side, round, position) {
	return `${side}:${round}:${position}`;
}

function ensure(map, side, round, position) {
	const k = slotKey(side, round, position);
	let m = map.get(k);
	if (!m) {
		m = { side, round, position, entry1Id: null, entry2Id: null };
		map.set(k, m);
	}
	return m;
}

function placePlayer(map, dest, entryId) {
	const m = ensure(map, dest.side, dest.round, dest.position);
	if (dest.slot === 1) m.entry1Id = entryId;
	else m.entry2Id = entryId;
}

function wire(from, dest, kind) {
	if (kind === 'winner') from.winnerGoesTo = dest;
	else from.loserGoesTo = dest;
}

function isFedBy(map, dest) {
	if (!dest) return false;
	for (const m of map.values()) {
		for (const key of ['winnerGoesTo', 'loserGoesTo']) {
			const d = m[key];
			if (
				d &&
				d.side === dest.side &&
				d.round === dest.round &&
				d.position === dest.position &&
				d.slot === dest.slot
			) {
				return true;
			}
		}
	}
	return false;
}

function resolveByes(map) {
	let changed = true;
	let guard = 0;
	while (changed && guard < 64) {
		changed = false;
		guard += 1;
		for (const m of map.values()) {
			if (m.byeAdvanced) continue;
			const a = m.entry1Id;
			const b = m.entry2Id;
			const waitingOnSlot2 = !b && isFedBy(map, { side: m.side, round: m.round, position: m.position, slot: 2 });
			const waitingOnSlot1 = !a && isFedBy(map, { side: m.side, round: m.round, position: m.position, slot: 1 });
			if (a && !b && !waitingOnSlot2) {
				if (m.winnerGoesTo) placePlayer(map, m.winnerGoesTo, a);
				m.byeAdvanced = true;
				changed = true;
			} else if (!a && b && !waitingOnSlot1) {
				if (m.winnerGoesTo) placePlayer(map, m.winnerGoesTo, b);
				m.entry1Id = b;
				m.entry2Id = null;
				m.byeAdvanced = true;
				changed = true;
			}
		}
	}
}

function generateSingleElim(seededIds) {
	const n = nextPowerOfTwo(seededIds.length);
	const wbRounds = Math.log2(n);
	const map = new Map();
	for (let r = 1; r <= wbRounds; r++) {
		const count = n / 2 ** r;
		for (let p = 1; p <= count; p++) ensure(map, 'winners', r, p);
	}
	for (let r = 1; r < wbRounds; r++) {
		const count = n / 2 ** r;
		for (let p = 1; p <= count; p++) {
			const m = ensure(map, 'winners', r, p);
			wire(m, { side: 'winners', round: r + 1, position: Math.ceil(p / 2), slot: p % 2 === 1 ? 1 : 2 }, 'winner');
		}
	}
	const order = seedOrder(n);
	const r1Count = n / 2;
	for (let p = 1; p <= r1Count; p++) {
		const m = ensure(map, 'winners', 1, p);
		m.entry1Id = seededIds[order[(p - 1) * 2] - 1] ?? null;
		m.entry2Id = seededIds[order[(p - 1) * 2 + 1] - 1] ?? null;
	}
	resolveByes(map);
	return [...map.values()];
}

function generateDoubleElim(seededIds) {
	const n = nextPowerOfTwo(seededIds.length);
	const wbRounds = Math.log2(n);
	const lbRounds = Math.max(1, 2 * (wbRounds - 1));
	const map = new Map();
	for (let r = 1; r <= wbRounds; r++) {
		const count = n / 2 ** r;
		for (let p = 1; p <= count; p++) ensure(map, 'winners', r, p);
	}
	for (let r = 1; r <= lbRounds; r++) {
		const pairIndex = Math.ceil(r / 2);
		const count = Math.max(1, n / 2 ** (pairIndex + 1));
		for (let p = 1; p <= count; p++) ensure(map, 'losers', r, p);
	}
	ensure(map, 'grand', 1, 1);
	for (let r = 1; r < wbRounds; r++) {
		const count = n / 2 ** r;
		for (let p = 1; p <= count; p++) {
			const m = ensure(map, 'winners', r, p);
			wire(m, { side: 'winners', round: r + 1, position: Math.ceil(p / 2), slot: p % 2 === 1 ? 1 : 2 }, 'winner');
		}
	}
	wire(ensure(map, 'winners', wbRounds, 1), { side: 'grand', round: 1, position: 1, slot: 1 }, 'winner');
	if (lbRounds >= 1) {
		wire(ensure(map, 'losers', lbRounds, 1), { side: 'grand', round: 1, position: 1, slot: 2 }, 'winner');
	}
	for (let r = 1; r < lbRounds; r++) {
		const pairIndex = Math.ceil(r / 2);
		const count = Math.max(1, n / 2 ** (pairIndex + 1));
		for (let p = 1; p <= count; p++) {
			const m = ensure(map, 'losers', r, p);
			if (r % 2 === 1) wire(m, { side: 'losers', round: r + 1, position: p, slot: 1 }, 'winner');
			else wire(m, { side: 'losers', round: r + 1, position: Math.ceil(p / 2), slot: p % 2 === 1 ? 1 : 2 }, 'winner');
		}
	}
	const r1Count = n / 2;
	for (let p = 1; p <= r1Count; p++) {
		ensure(map, 'winners', 1, p).loserGoesTo = {
			side: 'losers', round: 1, position: Math.ceil(p / 2), slot: p % 2 === 1 ? 1 : 2,
		};
	}
	for (let r = 2; r <= wbRounds; r++) {
		const lbRound = 2 * (r - 1);
		const count = n / 2 ** r;
		for (let p = 1; p <= count; p++) {
			ensure(map, 'winners', r, p).loserGoesTo = {
				side: 'losers', round: lbRound, position: count - p + 1, slot: 2,
			};
		}
	}
	const order = seedOrder(n);
	for (let p = 1; p <= r1Count; p++) {
		const m = ensure(map, 'winners', 1, p);
		m.entry1Id = seededIds[order[(p - 1) * 2] - 1] ?? null;
		m.entry2Id = seededIds[order[(p - 1) * 2 + 1] - 1] ?? null;
	}
	resolveByes(map);
	return [...map.values()];
}

function generateRoundRobin(seededIds) {
	const players = [...seededIds];
	const bye = -1;
	if (players.length % 2 === 1) players.push(bye);
	const n = players.length;
	const rounds = n - 1;
	const half = n / 2;
	const arr = [...players];
	const drafts = [];
	for (let r = 0; r < rounds; r++) {
		let pos = 1;
		for (let i = 0; i < half; i++) {
			const a = arr[i];
			const b = arr[n - 1 - i];
			if (a === bye || b === bye) continue;
			drafts.push({ side: 'group', round: r + 1, position: pos, entry1Id: a, entry2Id: b });
			pos += 1;
		}
		const last = arr.pop();
		if (last !== undefined) arr.splice(1, 0, last);
	}
	return drafts;
}

function pairSwissRound(players, round) {
	const sorted = [...players].sort((a, b) => {
		if (b.wins !== a.wins) return b.wins - a.wins;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		return a.seed - b.seed;
	});
	const drafts = [];
	const used = new Set();
	let pos = 1;
	if (sorted.length % 2 === 1) {
		for (let i = sorted.length - 1; i >= 0; i--) {
			if (!used.has(sorted[i].id)) {
				used.add(sorted[i].id);
				drafts.push({ side: 'group', round, position: pos, entry1Id: sorted[i].id, entry2Id: null });
				pos += 1;
				break;
			}
		}
	}
	for (let i = 0; i < sorted.length; i++) {
		if (used.has(sorted[i].id)) continue;
		let partner = -1;
		for (let j = i + 1; j < sorted.length; j++) {
			if (used.has(sorted[j].id)) continue;
			if (sorted[i].played.includes(sorted[j].id)) continue;
			partner = j;
			break;
		}
		if (partner === -1) {
			for (let j = i + 1; j < sorted.length; j++) {
				if (!used.has(sorted[j].id)) { partner = j; break; }
			}
		}
		if (partner === -1) {
			drafts.push({ side: 'group', round, position: pos, entry1Id: sorted[i].id, entry2Id: null });
			used.add(sorted[i].id);
			pos += 1;
			continue;
		}
		drafts.push({
			side: 'group', round, position: pos,
			entry1Id: sorted[i].id, entry2Id: sorted[partner].id,
		});
		used.add(sorted[i].id);
		used.add(sorted[partner].id);
		pos += 1;
	}
	return drafts;
}

function defaultSwissRounds(playerCount) {
	return Math.max(3, Math.ceil(Math.log2(Math.max(2, playerCount))));
}

module.exports = {
	generateSingleElim,
	generateDoubleElim,
	generateRoundRobin,
	pairSwissRound,
	defaultSwissRounds,
};
