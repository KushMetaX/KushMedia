'use strict';

const { unlockFor } = require('./tourney-achievements');

const MIN_FIELD = 4;

function ensureSchema(database) {
	if (!database) return;
	database.exec(`
		CREATE TABLE IF NOT EXISTS tourney_events (
			tournament_id INTEGER PRIMARY KEY,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			format TEXT NOT NULL,
			stage_type TEXT,
			field_size INTEGER NOT NULL,
			official INTEGER NOT NULL DEFAULT 1,
			completed_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS tourney_results (
			tournament_id INTEGER NOT NULL,
			entry_id INTEGER NOT NULL,
			user_id INTEGER,
			handle TEXT NOT NULL,
			placement INTEGER,
			record TEXT,
			PRIMARY KEY (tournament_id, entry_id)
		);
		CREATE INDEX IF NOT EXISTS idx_tourney_results_user ON tourney_results(user_id);
		CREATE INDEX IF NOT EXISTS idx_tourney_results_handle ON tourney_results(handle COLLATE NOCASE);
		CREATE TABLE IF NOT EXISTS tourney_claims (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			tournament_id INTEGER NOT NULL,
			entry_id INTEGER NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_tourney_claims_status ON tourney_claims(status, tournament_id);
	`);
}

function getDb() {
	const authDex = require('../routes/auth-dex');
	const database = authDex.tryGetDdDatabaseForPaywall();
	if (database) ensureSchema(database);
	return database;
}

function countsTowardRecord(tournament, fieldSize, isDemo) {
	return !isDemo && fieldSize >= MIN_FIELD && tournament.official !== false;
}

function placementMap(podium) {
	const map = new Map();
	if (!podium) return map;
	if (podium.first && podium.first.id != null) map.set(Number(podium.first.id), 1);
	if (podium.second && podium.second.id != null) map.set(Number(podium.second.id), 2);
	for (const row of podium.third || []) {
		if (row && row.id != null) map.set(Number(row.id), 3);
	}
	return map;
}

function recordFor(standings, entryId) {
	const row = (standings || []).find((s) => s.entryId === entryId);
	return row ? `${row.wins}-${row.losses}` : '';
}

function snapshotResults(database, store, tournament, extras) {
	if (!database || !tournament || tournament.status !== 'completed') return { ok: false, skipped: true };
	ensureSchema(database);
	const existing = database.prepare('SELECT tournament_id FROM tourney_events WHERE tournament_id = ?').get(tournament.id);
	if (existing) return { ok: true, skipped: true };

	const confirmed = (store.entries || []).filter((e) => e.tournamentId === tournament.id && e.paid);
	const fieldSize = confirmed.length;
	const official = countsTowardRecord(tournament, fieldSize, Boolean(extras && extras.isDemo)) ? 1 : 0;
	const places = placementMap(extras && extras.podium);
	const standings = (extras && extras.standings) || [];
	const completedAt = new Date().toISOString();

	const tx = database.transaction(() => {
		database.prepare(
			`INSERT INTO tourney_events
			 (tournament_id, slug, name, format, stage_type, field_size, official, completed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			tournament.id,
			String(tournament.slug || ''),
			String(tournament.name || ''),
			String(
				tournament.format === 'single_elim' && tournament.losersBracket
					? 'double_elim'
					: (tournament.format || ''),
			),
			String(tournament.stageType || 'single'),
			fieldSize,
			official,
			completedAt,
		);
		const ins = database.prepare(
			`INSERT INTO tourney_results (tournament_id, entry_id, user_id, handle, placement, record)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);
		for (const entry of confirmed) {
			const userId = entry.userId != null && Number(entry.userId) > 0 ? Number(entry.userId) : null;
			ins.run(
				tournament.id,
				entry.id,
				userId,
				String(entry.handle || ''),
				places.has(entry.id) ? places.get(entry.id) : null,
				recordFor(standings, entry.id),
			);
		}
	});
	tx();
	return { ok: true, skipped: false, fieldSize, official: Boolean(official) };
}

function backfillWithFns(database, store, isDemoFn, podiumFor, standingsFor) {
	if (!database || !store) return { ok: false, inserted: 0 };
	ensureSchema(database);
	let inserted = 0;
	for (const tournament of store.tournaments || []) {
		if (!tournament || tournament.status !== 'completed') continue;
		const extras = {
			isDemo: typeof isDemoFn === 'function' ? isDemoFn(store, tournament) : false,
			podium: podiumFor(store, tournament),
			standings: standingsFor(store, tournament),
		};
		const result = snapshotResults(database, store, tournament, extras);
		if (result && result.ok && !result.skipped) inserted += 1;
	}
	return { ok: true, inserted };
}

function findUserByHandle(database, handle) {
	if (!database) return null;
	const h = String(handle || '').trim();
	if (h.length < 2) return null;
	return database.prepare(
		`SELECT id AS user_id, email, discord_id, discord_username, avatar_url, tourney_handle
		 FROM users WHERE tourney_handle = ? COLLATE NOCASE`
	).get(h) || null;
}

function findUserByDiscordUsername(database, name) {
	if (!database) return null;
	const h = String(name || '').trim();
	if (h.length < 2) return null;
	return database.prepare(
		`SELECT id AS user_id, email, discord_id, discord_username, avatar_url, tourney_handle
		 FROM users WHERE discord_username = ? COLLATE NOCASE`
	).get(h) || null;
}

function escapeLike(value) {
	return String(value || '').replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

/**
 * Prefix/contains match of Discord-connected accounts by tournament handle or Discord name.
 * Host-only typeahead uses this — never return emails.
 */
function searchDiscordPlayers(database, query, limit) {
	if (!database) return [];
	const q = String(query || '').trim();
	if (!q) return [];
	const cap = Math.min(12, Math.max(1, Number(limit) || 8));
	const pattern = `%${escapeLike(q.toLowerCase())}%`;
	const rows = database.prepare(
		`SELECT id AS user_id, discord_id, discord_username, avatar_url, tourney_handle
		 FROM users
		 WHERE discord_id IS NOT NULL AND discord_id != ''
		   AND (
		     LOWER(IFNULL(tourney_handle, '')) LIKE ? ESCAPE '!'
		     OR LOWER(IFNULL(discord_username, '')) LIKE ? ESCAPE '!'
		   )
		 LIMIT 40`
	).all(pattern, pattern);
	const needle = q.toLowerCase();
	const rank = (row) => {
		const handle = String(row.tourney_handle || '').toLowerCase();
		const discord = String(row.discord_username || '').toLowerCase();
		if (handle === needle || discord === needle) return 0;
		if (handle.startsWith(needle)) return 1;
		if (discord.startsWith(needle)) return 2;
		if (handle.includes(needle)) return 3;
		return 4;
	};
	return rows
		.filter((row) => row.tourney_handle || row.discord_username)
		.sort((a, b) => {
			const diff = rank(a) - rank(b);
			if (diff) return diff;
			const left = String(a.tourney_handle || a.discord_username || '');
			const right = String(b.tourney_handle || b.discord_username || '');
			return left.localeCompare(right, undefined, { sensitivity: 'base' });
		})
		.slice(0, cap)
		.map(publicDiscordUser)
		.filter(Boolean);
}

function publicDiscordUser(user) {
	if (!user) return null;
	let avatarUrl = user.avatar_url ? String(user.avatar_url).trim() : '';
	if (!avatarUrl && user.discord_id) {
		try {
			const idx = Number((BigInt(String(user.discord_id)) >> 22n) % 6n);
			avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
		} catch (_e) {
			avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
		}
	}
	return {
		id: user.user_id,
		tourneyHandle: user.tourney_handle || '',
		avatarUrl,
		discordUsername: user.discord_username || '',
		discordId: user.discord_id || null,
	};
}

function findOrganizerUser(database, tournament) {
	if (!database || !tournament) return null;
	const hostUserId = tournament.hostUserId != null ? Number(tournament.hostUserId) : 0;
	if (hostUserId > 0) {
		const byId = findUserById(database, hostUserId);
		if (byId) return byId;
	}
	const name = String(tournament.hostName || '').trim();
	if (name.length < 2) return null;
	return findUserByHandle(database, name) || findUserByDiscordUsername(database, name);
}

function findUserById(database, userId) {
	if (!database || !userId) return null;
	return database.prepare(
		`SELECT id AS user_id, email, discord_id, discord_username, avatar_url, tourney_handle
		 FROM users WHERE id = ?`
	).get(Number(userId)) || null;
}

function mapResultRow(row) {
	return {
		tournamentId: row.tournament_id,
		entryId: row.entry_id,
		userId: row.user_id || null,
		handle: row.handle,
		placement: row.placement == null ? null : Number(row.placement),
		record: row.record || '',
		slug: row.slug,
		name: row.name,
		format: row.format,
		stageType: row.stage_type,
		fieldSize: Number(row.field_size) || 0,
		official: Boolean(row.official),
		completedAt: row.completed_at,
	};
}

function resultsForUser(database, userId) {
	if (!database || !userId) return [];
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.user_id = ?
		 ORDER BY e.completed_at DESC`
	).all(Number(userId)).map(mapResultRow);
}

function resultsForHandle(database, handle) {
	if (!database) return [];
	const h = String(handle || '').trim();
	if (h.length < 2) return [];
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.handle = ? COLLATE NOCASE
		 ORDER BY e.completed_at DESC`
	).all(h).map(mapResultRow);
}

function hallOfFame(database, limit) {
	if (!database) return { events: [], champions: [] };
	ensureSchema(database);
	const cap = Math.min(40, Math.max(5, Number(limit) || 20));
	const events = database.prepare(
		`SELECT tournament_id, slug, name, format, stage_type, field_size, official, completed_at
		 FROM tourney_events
		 ORDER BY completed_at DESC
		 LIMIT ?`
	).all(cap).map((row) => ({
		tournamentId: row.tournament_id,
		slug: row.slug,
		name: row.name,
		format: row.format,
		stageType: row.stage_type,
		fieldSize: row.field_size,
		official: Boolean(row.official),
		completedAt: row.completed_at,
		champion: database.prepare(
			`SELECT handle, user_id, record FROM tourney_results
			 WHERE tournament_id = ? AND placement = 1 LIMIT 1`
		).get(row.tournament_id) || null,
	}));
	const champions = database.prepare(
		`SELECT MAX(r.handle) AS handle, MAX(r.user_id) AS user_id, COUNT(*) AS titles
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.placement = 1 AND e.official = 1
		 GROUP BY CASE WHEN r.user_id IS NOT NULL THEN 'u:' || r.user_id ELSE 'h:' || lower(r.handle) END
		 ORDER BY titles DESC, handle COLLATE NOCASE ASC
		 LIMIT ?`
	).all(cap).map((row) => ({
		handle: row.handle,
		userId: row.user_id || null,
		titles: Number(row.titles) || 0,
	}));
	return { events, champions };
}

function listChampions(database, query) {
	if (!database) return [];
	ensureSchema(database);
	const format = String((query && query.format) || '').trim();
	const since = String((query && query.since) || '').trim();
	let sql = `
		SELECT r.handle, r.user_id, e.format, e.slug, e.name, e.completed_at, e.field_size
		FROM tourney_results r
		JOIN tourney_events e ON e.tournament_id = r.tournament_id
		WHERE r.placement = 1 AND e.official = 1
	`;
	const params = [];
	if (format) {
		sql += ' AND e.format = ?';
		params.push(format);
	}
	if (since) {
		sql += ' AND e.completed_at >= ?';
		params.push(since);
	}
	sql += ' ORDER BY e.completed_at DESC';
	const rows = database.prepare(sql).all(...params);
	const seen = new Set();
	const out = [];
	for (const row of rows) {
		const key = row.user_id ? `u:${row.user_id}` : `h:${String(row.handle).toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			handle: row.handle,
			userId: row.user_id || null,
			format: row.format,
			slug: row.slug,
			name: row.name,
			completedAt: row.completed_at,
			fieldSize: row.field_size,
		});
	}
	return out;
}

function playerProfile(database, handle) {
	const user = findUserByHandle(database, handle);
	const results = user ? resultsForUser(database, user.user_id) : resultsForHandle(database, handle);
	const official = results.filter((r) => r.official);
	const displayHandle = (user && user.tourney_handle) || handle;
	return {
		handle: displayHandle,
		user: publicDiscordUser(user),
		results,
		accolades: unlockFor(official),
		titles: official.filter((r) => r.placement === 1).length,
		appearances: official.length,
	};
}

function unclaimedForHandle(database, handle) {
	if (!database) return [];
	const h = String(handle || '').trim();
	if (h.length < 2) return [];
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.user_id IS NULL AND r.handle = ? COLLATE NOCASE
		 ORDER BY e.completed_at DESC`
	).all(h).map(mapResultRow);
}

function createClaim(database, userId, tournamentId, entryId) {
	ensureSchema(database);
	const row = database.prepare(
		`SELECT user_id, handle FROM tourney_results WHERE tournament_id = ? AND entry_id = ?`
	).get(Number(tournamentId), Number(entryId));
	if (!row) {
		const err = new Error('That result was not found');
		err.status = 404;
		throw err;
	}
	if (row.user_id) {
		const err = new Error('That result is already linked to an account');
		err.status = 400;
		throw err;
	}
	const user = findUserById(database, userId);
	const handle = user && user.tourney_handle ? String(user.tourney_handle) : '';
	if (!handle || handle.toLowerCase() !== String(row.handle || '').toLowerCase()) {
		const err = new Error('You can only claim a result that uses your handle');
		err.status = 403;
		throw err;
	}
	const pending = database.prepare(
		`SELECT id FROM tourney_claims
		 WHERE user_id = ? AND tournament_id = ? AND entry_id = ? AND status = 'pending'`
	).get(Number(userId), Number(tournamentId), Number(entryId));
	if (pending) return { ok: true, id: pending.id, status: 'pending' };
	const info = database.prepare(
		`INSERT INTO tourney_claims (user_id, tournament_id, entry_id, status, created_at)
		 VALUES (?, ?, ?, 'pending', ?)`
	).run(Number(userId), Number(tournamentId), Number(entryId), new Date().toISOString());
	return { ok: true, id: Number(info.lastInsertRowid), status: 'pending' };
}

function listClaimsForTournament(database, tournamentId) {
	if (!database) return [];
	ensureSchema(database);
	return database.prepare(
		`SELECT c.id, c.user_id, c.tournament_id, c.entry_id, c.status, c.created_at,
		        u.tourney_handle, r.handle AS result_handle
		 FROM tourney_claims c
		 JOIN tourney_results r ON r.tournament_id = c.tournament_id AND r.entry_id = c.entry_id
		 LEFT JOIN users u ON u.id = c.user_id
		 WHERE c.tournament_id = ?
		 ORDER BY c.created_at DESC`
	).all(Number(tournamentId)).map((row) => ({
		id: row.id,
		userId: row.user_id,
		tournamentId: row.tournament_id,
		entryId: row.entry_id,
		status: row.status,
		createdAt: row.created_at,
		tourneyHandle: row.tourney_handle || '',
		resultHandle: row.result_handle || '',
	}));
}

function resolveClaim(database, claimId, approve) {
	ensureSchema(database);
	const claim = database.prepare(
		`SELECT id, user_id, tournament_id, entry_id, status FROM tourney_claims WHERE id = ?`
	).get(Number(claimId));
	if (!claim) {
		const err = new Error('Claim not found');
		err.status = 404;
		throw err;
	}
	if (claim.status !== 'pending') {
		const err = new Error('That claim is already resolved');
		err.status = 400;
		throw err;
	}
	const status = approve ? 'approved' : 'rejected';
	const tx = database.transaction(() => {
		database.prepare('UPDATE tourney_claims SET status = ? WHERE id = ?').run(status, claim.id);
		if (approve) {
			database.prepare(
				`UPDATE tourney_results SET user_id = ? WHERE tournament_id = ? AND entry_id = ? AND user_id IS NULL`
			).run(claim.user_id, claim.tournament_id, claim.entry_id);
		}
	});
	tx();
	return {
		ok: true,
		status,
		userId: claim.user_id,
		tournamentId: claim.tournament_id,
		entryId: claim.entry_id,
	};
}

module.exports = {
	MIN_FIELD,
	ensureSchema,
	getDb,
	countsTowardRecord,
	snapshotResults,
	backfillWithFns,
	findUserByHandle,
	findUserById,
	findUserByDiscordUsername,
	searchDiscordPlayers,
	findOrganizerUser,
	publicDiscordUser,
	resultsForUser,
	hallOfFame,
	listChampions,
	playerProfile,
	unclaimedForHandle,
	createClaim,
	listClaimsForTournament,
	resolveClaim,
};
