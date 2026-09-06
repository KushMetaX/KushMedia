'use strict';

function num(value) {
	return Number(value) || 0;
}

function matchHasEntry(match, entryId) {
	const id = num(entryId);
	return num(match.entry1Id) === id || num(match.entry2Id) === id;
}

function replaceEntryId(match, fromId, toId) {
	const from = num(fromId);
	const to = num(toId);
	if (num(match.entry1Id) === from) match.entry1Id = to;
	else if (num(match.entry2Id) === from) match.entry2Id = to;
	if (num(match.winnerId) === from) match.winnerId = to;
}

function feedsDest(src, dest) {
	const d = src && src.winnerGoesTo;
	return Boolean(
		d && dest
		&& d.side === dest.side
		&& num(d.round) === num(dest.round)
		&& num(d.position) === num(dest.position)
	);
}

function laterRoundSeated(later) {
	const rows = later || [];
	return rows.length > 0 && rows.every((m) => m.entry1Id && m.entry2Id);
}

function layoutPrevRound(prev, later) {
	const used = new Set();
	const next = [];
	for (const dest of later || []) {
		const ids = [dest.entry1Id, dest.entry2Id].filter((id) => num(id));
		const pair = [];
		for (const id of ids) {
			const src = (prev || []).find((m) => !used.has(m.id) && (
				matchHasEntry(m, id) || num(m.winnerId) === num(id)
			));
			if (src) {
				used.add(src.id);
				pair.push(src);
			}
		}
		if (pair.length < 2) {
			for (const src of prev || []) {
				if (used.has(src.id) || !feedsDest(src, dest)) continue;
				used.add(src.id);
				pair.push(src);
				if (pair.length >= 2) break;
			}
		}
		next.push(...pair);
	}
	for (const match of prev || []) {
		if (!used.has(match.id)) next.push(match);
	}
	return next;
}

function restackSide(matches, side) {
	const ofSide = (matches || []).filter((m) => m.side === side);
	if (!ofSide.length) return false;
	const max = ofSide.reduce((n, m) => Math.max(n, num(m.round)), 0);
	const rounds = [];
	for (let r = 1; r <= max; r++) {
		rounds[r] = ofSide.filter((m) => num(m.round) === r)
			.sort((a, b) => num(a.position) - num(b.position));
	}
	let changed = false;
	for (let r = max; r >= 2; r--) {
		const later = rounds[r] || [];
		const prev = rounds[r - 1] || [];
		if (!later.length || !prev.length || !laterRoundSeated(later)) continue;
		const nextPrev = layoutPrevRound(prev, later);
		const same = nextPrev.length === prev.length && nextPrev.every((m, i) => m === prev[i]);
		if (!same) {
			rounds[r - 1] = nextPrev;
			changed = true;
		}
	}
	for (let r = 1; r <= max; r++) {
		(rounds[r] || []).forEach((m, i) => {
			const pos = i + 1;
			if (num(m.position) !== pos) {
				m.position = pos;
				changed = true;
			}
		});
	}
	for (let r = 1; r < max; r++) {
		(rounds[r] || []).forEach((m, i) => {
			const dest = {
				side,
				round: r + 1,
				position: Math.floor(i / 2) + 1,
				slot: i % 2 === 0 ? 1 : 2,
			};
			const cur = m.winnerGoesTo;
			if (
				!cur
				|| cur.side !== dest.side
				|| num(cur.round) !== dest.round
				|| num(cur.position) !== dest.position
				|| num(cur.slot) !== dest.slot
			) {
				m.winnerGoesTo = dest;
				changed = true;
			}
		});
	}
	return changed;
}

function rewirePlacement(matches) {
	const winners = (matches || []).filter((m) => m.side === 'winners');
	const placement = (matches || []).find((m) => m.side === 'placement');
	if (!winners.length || !placement) return false;
	const max = winners.reduce((n, m) => Math.max(n, num(m.round)), 0);
	const semis = winners.filter((m) => num(m.round) === max - 1)
		.sort((a, b) => num(a.position) - num(b.position));
	if (semis.length < 2) return false;
	let changed = false;
	semis.forEach((m) => {
		const loserId = num(m.winnerId) === num(m.entry1Id) ? m.entry2Id : m.entry1Id;
		let slot = num(m.position) % 2 === 1 ? 1 : 2;
		if (num(placement.entry1Id) === num(loserId)) slot = 1;
		else if (num(placement.entry2Id) === num(loserId)) slot = 2;
		const dest = {
			side: 'placement',
			round: 1,
			position: num(placement.position) || 1,
			slot,
		};
		const cur = m.loserGoesTo;
		if (!cur || cur.side !== dest.side || num(cur.slot) !== dest.slot || num(cur.position) !== dest.position) {
			m.loserGoesTo = dest;
			changed = true;
		}
	});
	return changed;
}

function restackElimTree(matches) {
	if ((matches || []).some((m) => m.side === 'losers')) return false;
	const stacked = restackSide(matches, 'winners');
	const placed = rewirePlacement(matches);
	return stacked || placed;
}

function reseatCompletePair(roundRows, wantedA, wantedB) {
	const idA = num(wantedA);
	const idB = num(wantedB);
	if (!idA || !idB || idA === idB || !roundRows || roundRows.length !== 2) return false;
	if (roundRows.some((m) => matchHasEntry(m, idA) && matchHasEntry(m, idB))) return false;
	if (!roundRows.every((m) => m.status === 'complete' && m.entry1Id && m.entry2Id)) return false;
	const home = roundRows.find((m) => matchHasEntry(m, idA)) || roundRows.find((m) => matchHasEntry(m, idB));
	const other = roundRows.find((m) => m !== home);
	if (!home || !other) return false;
	const homeKeep = matchHasEntry(home, idA) ? idA : idB;
	const wantIn = homeKeep === idA ? idB : idA;
	if (!matchHasEntry(other, wantIn)) return false;
	const homeLeave = num(home.entry1Id) === num(homeKeep) ? home.entry2Id : home.entry1Id;
	replaceEntryId(home, homeLeave, wantIn);
	replaceEntryId(other, wantIn, homeLeave);
	return true;
}

function handleId(entries, handle) {
	const want = String(handle || '').toLowerCase();
	const row = (entries || []).find((e) => String(e.handle || '').toLowerCase() === want);
	return row ? row.id : 0;
}

function isDdnycArena(tournament) {
	const slug = String(tournament && tournament.slug || '');
	if (slug === 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs') return true;
	return /ddnyc 2026/i.test(String(tournament && tournament.name || ''));
}

function repairKnownBracketHistory(store) {
	let changed = false;
	for (const tournament of store.tournaments || []) {
		const matches = (store.matches || []).filter((m) => m.tournamentId === tournament.id);
		if (!matches.length) continue;
		if (isDdnycArena(tournament)) {
			const entries = (store.entries || []).filter((e) => e.tournamentId === tournament.id);
			const winners = matches.filter((m) => m.side === 'winners');
			const max = winners.reduce((n, m) => Math.max(n, num(m.round)), 0);
			const semis = winners.filter((m) => num(m.round) === max - 1)
				.sort((a, b) => num(a.position) - num(b.position));
			if (reseatCompletePair(semis, handleId(entries, 'DickTheDev'), handleId(entries, 'hofer'))) {
				changed = true;
			}
			if (restackElimTree(matches)) changed = true;
			continue;
		}
		if (tournament.status !== 'completed') continue;
		if (tournament.format === 'double_elim' || tournament.losersBracket) continue;
		if (restackElimTree(matches)) changed = true;
	}
	return changed;
}

module.exports = {
	layoutPrevRound,
	restackElimTree,
	reseatCompletePair,
	repairKnownBracketHistory,
	isDdnycArena,
};
