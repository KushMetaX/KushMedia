'use strict';

const TREASURY = 'DD4KcuppEUBR8vETG46d4w8BcgvDkzbss2';

const KNOWN_SETTINGS = {
	'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs': {
		id: 140,
		name: 'Doginal Dogs Legends TCG - DDNYC 2026 IRL Tournament',
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 0,
		entryFeeDoge: 0,
		maxPlayers: 16,
		swissRounds: 4,
		treasury: TREASURY,
		createdAt: '2026-09-03T21:20:12.918Z',
		stage: 'main',
		description: 'The first Doginal Dogs Legends TCG Tournament Live in DDNYC 2026',
		hostName: 'Doginal Dogs',
		streamUrl: 'https://kick.com/guytypeaura',
		game: 'Doginal Dogs Legends TCG',
		stageType: 'single',
		losersBracket: false,
		breakTies: true,
		registrationMode: 'list',
		whitelistSpots: 0,
		feeMode: 'free',
		requireTeams: false,
		capPlayers: true,
		startAt: '2026-09-03T19:00',
		timezone: 'America/New_York',
		requireAccount: false,
		official: true,
		bestOf: 1,
		rewardMode: 'prize',
		hostPotUsd: 0,
		payouts: [
			{ place: 1, percent: 100, prize: '3 Boxes DDL TCG + Doginal Dog Figurine + A Doginal Dog' },
			{ place: 2, percent: 0, prize: '2 Boxes DDL TCG + Doginal Dog Figurine' },
			{ place: 3, percent: 0, prize: '1 Box DDL TCG + Doginal Dog Figurine' },
		],
		eventKind: 'tournament',
		roundBestOf: { 'winners:1': 1, 'winners:2': 1, 'winners:3': 1, 'winners:4': 3, 'placement:1': 3 },
		playoffFormat: 'single_elim',
	},
	'ddl-alpha-arena-vrnr': {
		id: 39,
		name: 'DDL Alpha Arena',
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 5,
		maxPlayers: 32,
		swissRounds: 4,
		treasury: TREASURY,
		createdAt: '2026-08-25T22:39:08.783Z',
		stage: 'main',
		description: 'Players will compete for official DDL TCG packs! 🐶',
		hostName: 'Kush',
		streamUrl: 'https://kick.com/kushmetax',
		game: 'Doginal Dogs Legends TCG',
		stageType: 'single',
		losersBracket: false,
		breakTies: false,
		registrationMode: 'signup',
		whitelistSpots: 5,
		feeMode: 'paid',
		capPlayers: true,
		startAt: '2026-08-29T14:30',
		timezone: 'America/Halifax',
		votingEnabled: true,
		predictionsEnabled: true,
		requireAccount: true,
		official: true,
		bestOf: 3,
		rewardMode: 'prize',
		payouts: [
			{ place: 1, percent: 0, prize: '3 Packs of DDL TCG Cards' },
			{ place: 2, percent: 0, prize: '2 Packs of DDL TCG Cards' },
			{ place: 3, percent: 0, prize: '1 Pack of DDL TCG Cards' },
		],
		eventKind: 'tournament',
		roundBestOf: { 'winners:1': 3, 'winners:2': 3, 'winners:3': 3, 'winners:4': 5 },
		hostUserId: 2,
		playoffFormat: 'single_elim',
	},
	'shock-vs-dick-the-finals-zekg': {
		id: 57,
		name: 'Shock vs Dick - The Finals',
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 0,
		maxPlayers: 2,
		swissRounds: 3,
		treasury: TREASURY,
		createdAt: '2026-08-27T18:18:47.394Z',
		stage: 'main',
		description: 'Dick won round 1\nShock won round 2\nWe are here to see the final results 👀',
		hostName: 'Kush',
		game: 'Doginal Dogs Legends TCG',
		stageType: 'single',
		registrationMode: 'list',
		feeMode: 'free',
		capPlayers: true,
		startAt: '2026-08-27T23:00',
		timezone: 'America/Halifax',
		votingEnabled: true,
		predictionsEnabled: true,
		requireAccount: true,
		official: true,
		bestOf: 5,
		rewardMode: 'prize',
		payouts: [{ place: 1, percent: 100, prize: 'Bragging Rights' }],
		eventKind: 'duel',
		roundBestOf: { 'winners:1': 5 },
		hostUserId: 2,
	},
	'dick-vs-shock-zisv': {
		id: 53,
		name: 'Dick VS Shock',
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 0,
		maxPlayers: 2,
		createdAt: '2026-08-27T15:21:00.114Z',
		description: 'The first official callout battle between Dick and Shock.\n\nPlayed live before this platform was developed',
		hostName: 'KushMetaX',
		registrationMode: 'signup',
		feeMode: 'free',
		official: true,
		bestOf: 3,
		eventKind: 'duel',
		roundBestOf: { 'winners:1': 3 },
	},
	'5jnsxzqw': {
		id: 41,
		name: 'SHOCK-DICK-BARK?',
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 0,
		maxPlayers: 2,
		createdAt: '2026-08-26T04:00:19.970Z',
		description: 'A rematch of sorts with a possible appearance by Bark?',
		hostName: 'Kush',
		registrationMode: 'signup',
		feeMode: 'free',
		official: false,
		bestOf: 5,
		eventKind: 'duel',
		roundBestOf: { 'winners:1': 3 },
		hostUserId: 2,
		startAt: '2026-08-26T23:00',
	},
};

const DDNYC_ENTRIES = [
	{ id: 141, handle: 'DickTheDev', userId: 8, seed: 7 },
	{ id: 142, handle: 'And', userId: 3, seed: 10 },
	{ id: 143, handle: 'Rus', userId: null, seed: 16 },
	{ id: 144, handle: 'Duck', userId: 15, seed: 1 },
	{ id: 145, handle: 'Boo', userId: null, seed: 12 },
	{ id: 146, handle: 'hofer', userId: 12, seed: 5 },
	{ id: 147, handle: 'Scad', userId: null, seed: 15 },
	{ id: 148, handle: 'Fifi', userId: null, seed: 2 },
	{ id: 149, handle: 'Dro', userId: null, seed: 3 },
	{ id: 150, handle: 'Paws', userId: null, seed: 14 },
	{ id: 151, handle: 'Vee', userId: 13, seed: 13 },
	{ id: 152, handle: 'Corn', userId: null, seed: 4 },
	{ id: 153, handle: 'Jag', userId: null, seed: 6 },
	{ id: 154, handle: 'Ammon', userId: null, seed: 11 },
	{ id: 155, handle: 'Shekels', userId: null, seed: 8 },
	{ id: 156, handle: 'Devin', userId: null, seed: 9 },
];

function m(id, round, position, e1, e2, w, s1, s2, extra) {
	const bestOf = extra && extra.bestOf ? extra.bestOf : (round === 4 ? 3 : 1);
	const games = extra && extra.games ? extra.games : [{ winnerSlot: s1 > s2 ? 1 : 2 }];
	return {
		id,
		tournamentId: 140,
		side: extra && extra.side ? extra.side : 'winners',
		round,
		position,
		entry1Id: e1,
		entry2Id: e2,
		group: null,
		winnerId: w,
		score1: s1,
		score2: s2,
		bestOf,
		games,
		status: 'complete',
		winnerGoesTo: extra && extra.winnerGoesTo !== undefined ? extra.winnerGoesTo : {
			side: 'winners',
			round: round + 1,
			position: Math.ceil(position / 2),
			slot: position % 2 === 1 ? 1 : 2,
		},
		loserGoesTo: extra && extra.loserGoesTo ? extra.loserGoesTo : null,
	};
}

const DDNYC_MATCHES = [
	m(189, 1, 1, 144, 143, 144, 1, 0),
	m(190, 1, 2, 155, 156, 156, 0, 1),
	m(191, 1, 3, 152, 151, 152, 1, 0),
	m(192, 1, 4, 146, 145, 146, 1, 0),
	m(193, 1, 5, 148, 147, 147, 0, 1),
	m(194, 1, 6, 141, 142, 141, 1, 0),
	m(195, 1, 7, 149, 150, 149, 1, 0),
	m(196, 1, 8, 153, 154, 154, 0, 1),
	m(197, 2, 1, 144, 141, 141, 0, 1),
	m(198, 2, 2, 149, 152, 152, 0, 1),
	m(199, 2, 3, 147, 146, 146, 0, 1),
	m(200, 2, 4, 156, 154, 154, 0, 1),
	m(201, 3, 1, 141, 152, 141, 1, 0, {
		loserGoesTo: { side: 'placement', round: 1, position: 1, slot: 1 },
	}),
	m(202, 3, 2, 146, 154, 154, 0, 1, {
		loserGoesTo: { side: 'placement', round: 1, position: 1, slot: 2 },
	}),
	m(203, 4, 1, 141, 154, 141, 2, 0, {
		bestOf: 3,
		games: [{ winnerSlot: 1 }, { winnerSlot: 1 }],
		winnerGoesTo: null,
	}),
	m(204, 1, 1, 152, 146, 152, 2, 1, {
		side: 'placement',
		bestOf: 3,
		games: [{ winnerSlot: 1 }, { winnerSlot: 2 }, { winnerSlot: 1 }],
		winnerGoesTo: null,
	}),
];

function parseRecord(text) {
	const hit = String(text || '').match(/^(\d+)\s*-\s*(\d+)/);
	if (!hit) return { wins: 0, losses: 0 };
	return { wins: Number(hit[1]) || 0, losses: Number(hit[2]) || 0 };
}

function bumpNextId(store) {
	let max = Number(store.nextId) || 1;
	for (const row of store.tournaments || []) max = Math.max(max, Number(row.id) || 0);
	for (const row of store.entries || []) max = Math.max(max, Number(row.id) || 0);
	for (const row of store.matches || []) max = Math.max(max, Number(row.id) || 0);
	store.nextId = max + 1;
}

function hasTournament(store, id, slug) {
	return (store.tournaments || []).some((t) => Number(t.id) === Number(id) || String(t.slug) === String(slug));
}

function restoredEntry(tournamentId, row, completedAt) {
	const rec = parseRecord(row.record);
	return {
		id: Number(row.entry_id),
		tournamentId,
		handle: String(row.handle || ''),
		userId: row.user_id != null && Number(row.user_id) > 0 ? Number(row.user_id) : null,
		team: '',
		seed: Number(row.placement) > 0 ? Number(row.placement) : 99,
		paid: true,
		status: 'confirmed',
		checkedIn: true,
		payAsset: 'DOGE',
		amountUsd: 0,
		amountCrypto: 0,
		createdAt: completedAt,
		paidAt: completedAt,
		whitelist: false,
		noShow: false,
		subbedIn: false,
		addedByHost: true,
		lateEntry: false,
		ddlClass: 'Undeclared',
		placement: row.placement == null ? null : Number(row.placement),
		record: row.record || `${rec.wins}-${rec.losses}`,
	};
}

function baseTournament(event) {
	const slug = String(event.slug || '');
	const known = KNOWN_SETTINGS[slug] || {};
	const completedAt = event.completed_at || new Date().toISOString();
	const field = Number(event.field_size) || known.maxPlayers || 2;
	return {
		id: Number(event.tournament_id),
		slug,
		name: String(event.name || known.name || 'Restored arena'),
		format: String(event.format || known.format || 'single_elim'),
		status: 'completed',
		entryFeeUsd: known.entryFeeUsd != null ? known.entryFeeUsd : 0,
		entryFeeDoge: 0,
		maxPlayers: known.maxPlayers || field,
		swissRounds: known.swissRounds || 4,
		treasury: known.treasury || TREASURY,
		createdAt: known.createdAt || completedAt,
		stage: 'main',
		description: known.description || 'Restored from official records after the live arena file was lost.',
		hostName: known.hostName || 'KushMetaX',
		streamUrl: known.streamUrl || '',
		game: known.game || 'Doginal Dogs Legends TCG',
		stageType: event.stage_type || known.stageType || 'single',
		losersBracket: false,
		breakTies: Boolean(known.breakTies),
		registrationMode: known.registrationMode || 'list',
		whitelistSpots: known.whitelistSpots || 0,
		feeMode: known.feeMode || 'free',
		requireTeams: false,
		capPlayers: true,
		startAt: known.startAt || null,
		startTentative: false,
		timezone: known.timezone || 'America/Halifax',
		requireCheckIn: false,
		votingEnabled: Boolean(known.votingEnabled),
		predictionsEnabled: Boolean(known.predictionsEnabled),
		shareImages: false,
		requireVerifiedEmail: false,
		countryLock: false,
		allowedCountries: '',
		predictionCustomFields: false,
		requireAccount: known.requireAccount !== false,
		official: event.official == null ? known.official !== false : Boolean(event.official),
		groupSize: 4,
		advancePerGroup: 2,
		bestOf: known.bestOf || 3,
		rewardMode: known.rewardMode || 'pot',
		hostPotUsd: known.hostPotUsd || 0,
		payouts: known.payouts || [{ place: 1, percent: 100, prize: '' }],
		eventKind: event.event_kind || known.eventKind || (field <= 2 ? 'duel' : 'tournament'),
		roundBestOf: known.roundBestOf || {},
		hostUserId: known.hostUserId || null,
		playoffFormat: 'single_elim',
		finalsBestOf: null,
		restoredFromRecords: true,
		restoredAt: new Date().toISOString(),
	};
}

function duelMatch(tournamentId, matchId, results, bestOf) {
	const rows = (results || []).filter((r) => r && r.entry_id);
	if (rows.length < 2) return null;
	const winner = rows.find((r) => Number(r.placement) === 1) || rows[0];
	const loser = rows.find((r) => Number(r.entry_id) !== Number(winner.entry_id)) || rows[1];
	const bo = bestOf === 1 || bestOf === 3 || bestOf === 5 ? bestOf : 3;
	return {
		id: matchId,
		tournamentId,
		side: 'winners',
		round: 1,
		position: 1,
		entry1Id: Number(winner.entry_id),
		entry2Id: Number(loser.entry_id),
		group: null,
		winnerId: Number(winner.entry_id),
		score1: 1,
		score2: 0,
		bestOf: bo,
		games: [{ winnerSlot: 1 }],
		status: 'complete',
		winnerGoesTo: null,
		loserGoesTo: null,
	};
}

const ALPHA_ENTRIES = [
	{ id: 45, handle: 'Vegas', userId: 6, seed: 1, placement: null, record: '0-1' },
	{ id: 63, handle: 'hofer', userId: 12, seed: 2, placement: null, record: '1-1' },
	{ id: 51, handle: 'Shock', userId: 9, seed: 3, placement: 1, record: '4-0' },
	{ id: 43, handle: 'And', userId: 3, seed: 4, placement: null, record: '1-1' },
	{ id: 40, handle: 'Kush', userId: 2, seed: 5, placement: null, record: '0-1' },
	{ id: 78, handle: 'Vee', userId: 13, seed: 6, placement: null, record: '0-1' },
	{ id: 42, handle: 'Giga', userId: 4, seed: 7, placement: 3, record: '2-1' },
	{ id: 46, handle: 'Home', userId: 7, seed: 8, placement: null, record: '0-1' },
	{ id: 80, handle: 'Rus', userId: null, seed: 9, placement: 4, record: '1-1' },
	{ id: 61, handle: 'DickTheDev', userId: 8, seed: 10, placement: null, record: '0-1' },
	{ id: 62, handle: 'Rylan', userId: 11, seed: 11, placement: 5, record: '1-1' },
	{ id: 79, handle: 'Reef', userId: 14, seed: 12, placement: 2, record: '3-1' },
	{ id: 96, handle: 'Duck', userId: 15, seed: 13, placement: 3, record: '2-1' },
];

function alphaM(id, round, position, e1, e2, w, s1, s2, extra) {
	const bye = Boolean(extra && extra.bye);
	const games = extra && extra.games
		? extra.games
		: (bye ? [] : [
			...Array(Number(s1) || 0).fill({ winnerSlot: 1 }),
			...Array(Number(s2) || 0).fill({ winnerSlot: 2 }),
		]);
	return {
		id,
		tournamentId: 39,
		side: 'winners',
		round,
		position,
		entry1Id: e1,
		entry2Id: e2,
		group: null,
		winnerId: w,
		score1: s1,
		score2: s2,
		bestOf: 3,
		games,
		status: 'complete',
		winnerGoesTo: extra && extra.winnerGoesTo !== undefined ? extra.winnerGoesTo : {
			side: 'winners',
			round: round + 1,
			position: Math.ceil(position / 2),
			slot: position % 2 === 1 ? 1 : 2,
		},
		loserGoesTo: null,
		byeAdvanced: bye,
	};
}

const ALPHA_MATCHES = [
	alphaM(3901, 1, 1, 45, 96, 96, 0, 2),
	alphaM(3902, 1, 2, 46, 80, 80, 1, 2),
	alphaM(3903, 1, 3, 43, null, 43, 1, 0, { bye: true }),
	alphaM(3904, 1, 4, 40, 79, 79, 0, 2),
	alphaM(3905, 1, 5, 63, null, 63, 1, 0, { bye: true }),
	alphaM(3906, 1, 6, 42, 61, 42, 2, 0),
	alphaM(3907, 1, 7, 51, null, 51, 1, 0, { bye: true }),
	alphaM(3908, 1, 8, 78, 62, 62, 0, 2),
	alphaM(3909, 2, 1, 96, 80, 96, 2, 0),
	alphaM(3910, 2, 2, 43, 79, 79, 2, 0),
	alphaM(3911, 2, 3, 63, 42, 42, 2, 0),
	alphaM(3912, 2, 4, 51, 62, 51, 2, 0),
	alphaM(3913, 3, 1, 96, 79, 79, 2, 0),
	alphaM(3914, 3, 2, 42, 51, 51, 2, 0),
	alphaM(3915, 4, 1, 51, 79, 51, 2, 0, { winnerGoesTo: null }),
];

const SNAPSHOT_SLUGS = new Set([
	'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs',
	'ddl-alpha-arena-vrnr',
]);

function snapshotEntry(tournamentId, row, stamp) {
	return {
		id: row.id,
		tournamentId,
		handle: row.handle,
		userId: row.userId,
		team: '',
		seed: row.seed,
		paid: true,
		status: 'confirmed',
		checkedIn: true,
		payAsset: 'DOGE',
		amountUsd: 0,
		amountCrypto: 0,
		createdAt: stamp,
		paidAt: stamp,
		whitelist: false,
		noShow: false,
		subbedIn: false,
		addedByHost: true,
		lateEntry: false,
		ddlClass: 'Undeclared',
		placement: row.placement == null ? null : Number(row.placement),
		record: row.record || null,
	};
}

function applyNamedSnapshot(store, spec) {
	const { id, slug, entries, matches } = spec;
	if (!store.tournaments) store.tournaments = [];
	if (!store.entries) store.entries = [];
	if (!store.matches) store.matches = [];
	let tournament = store.tournaments.find((t) => t.slug === slug || Number(t.id) === Number(id));
	let changed = false;
	if (!tournament) {
		tournament = { ...KNOWN_SETTINGS[slug], slug, restoredFromRecords: true, restoredAt: new Date().toISOString() };
		store.tournaments.push(tournament);
		changed = true;
	}
	const existingEntries = store.entries.filter((e) => Number(e.tournamentId) === Number(id));
	if (existingEntries.length < entries.length) {
		store.entries = store.entries.filter((e) => Number(e.tournamentId) !== Number(id));
		const stamp = tournament.createdAt || new Date().toISOString();
		for (const row of entries) store.entries.push(snapshotEntry(id, row, stamp));
		changed = true;
	}
	const existingMatches = store.matches.filter((m) => Number(m.tournamentId) === Number(id));
	if (!existingMatches.length) {
		store.matches = store.matches.concat(matches.map((row) => ({ ...row })));
		tournament.restoredFromRecords = true;
		changed = true;
	}
	return changed;
}

function applyDdnycSnapshot(store) {
	return applyNamedSnapshot(store, {
		id: 140,
		slug: 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs',
		entries: DDNYC_ENTRIES,
		matches: DDNYC_MATCHES,
	});
}

function applyAlphaSnapshot(store) {
	return applyNamedSnapshot(store, {
		id: 39,
		slug: 'ddl-alpha-arena-vrnr',
		entries: ALPHA_ENTRIES,
		matches: ALPHA_MATCHES,
	});
}

function applyKnownSnapshots(store) {
	let snapshots = 0;
	if (applyDdnycSnapshot(store)) snapshots += 1;
	if (applyAlphaSnapshot(store)) snapshots += 1;
	return snapshots;
}

function insertArchivedArena(store, event, results) {
	const tournament = baseTournament(event);
	const stamp = event.completed_at || tournament.createdAt;
	store.tournaments.push(tournament);
	for (const row of results || []) {
		if (!row || !row.entry_id) continue;
		store.entries.push(restoredEntry(tournament.id, row, stamp));
	}
	if ((results || []).length === 2) {
		const match = duelMatch(tournament.id, tournament.id * 1000 + 1, results, tournament.bestOf);
		if (match) {
			store.matches.push(match);
			tournament.restoredFromRecords = true;
		}
	}
}

function restoreMissingArenasFromRecords(store, database) {
	if (!store) return { restored: 0, snapshots: 0 };
	if (!store.tournaments) store.tournaments = [];
	if (!store.entries) store.entries = [];
	if (!store.matches) store.matches = [];
	const snapshots = applyKnownSnapshots(store);
	let restored = 0;
	if (!database) {
		if (snapshots) bumpNextId(store);
		return { restored, snapshots };
	}
	let events = [];
	let rows = [];
	try {
		events = database.prepare(
			`SELECT tournament_id, slug, name, format, stage_type, field_size, official, official_lock, completed_at, event_kind
			 FROM tourney_events
			 ORDER BY completed_at ASC`
		).all();
	} catch (err) {
		try {
			events = database.prepare(
				`SELECT tournament_id, slug, name, format, stage_type, field_size, official, completed_at
				 FROM tourney_events`
			).all();
		} catch (err2) {
			console.error('[tourney] archive events:', err2 && err2.message ? err2.message : err2);
		}
	}
	try {
		rows = database.prepare(
			`SELECT tournament_id, entry_id, user_id, handle, placement, record
			 FROM tourney_results`
		).all();
	} catch (err) {
		console.error('[tourney] archive results:', err && err.message ? err.message : err);
	}
	const byTid = new Map();
	for (const row of rows || []) {
		const tid = Number(row.tournament_id);
		if (!tid) continue;
		if (!byTid.has(tid)) byTid.set(tid, []);
		byTid.get(tid).push(row);
	}
	for (const event of events || []) {
		const id = Number(event.tournament_id);
		const slug = String(event.slug || '');
		if (!id || !slug) continue;
		if (SNAPSHOT_SLUGS.has(slug)) continue;
		if (hasTournament(store, id, slug)) continue;
		try {
			insertArchivedArena(store, event, byTid.get(id) || []);
			restored += 1;
		} catch (err) {
			console.error('[tourney] archive insert', slug, err && err.message ? err.message : err);
		}
	}
	if (restored || snapshots) bumpNextId(store);
	return { restored, snapshots };
}

module.exports = {
	KNOWN_SETTINGS,
	parseRecord,
	bumpNextId,
	restoreMissingArenasFromRecords,
	applyDdnycSnapshot,
	applyAlphaSnapshot,
	applyKnownSnapshots,
};
