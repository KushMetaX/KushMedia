'use strict';

const path = require('path');
const { unlockFor } = require('./tourney-achievements');

function loadBadgeCatalog() {
	const catalogPath = path.join(__dirname, '../../../bracket/badges/catalog.js');
	try {
		return require(catalogPath);
	} catch (err) {
		console.error('[tourney] badge catalog missing — hall will boot without class/standing art', catalogPath, err && err.message);
		return {
			ART_ICONS: [],
			systemBadges: () => [],
			standingSpec: () => null,
			normalizeClass: (value) => value || 'Undeclared',
			parseClass: (value) => ({ kind: 'undeclared', ids: [], label: 'Undeclared', stored: value || 'Undeclared' }),
			classLabel: () => '',
			classSpecsFor: () => [],
			classSpec: () => null,
		};
	}
}

const ddlBadges = loadBadgeCatalog();

const MIN_FIELD = 2;
const MARK_ICONS = ['crown', 'flame', 'shield', 'star', 'laurel', 'crest'];
const BADGE_ICONS = MARK_ICONS.concat(ddlBadges.ART_ICONS || []);
const BADGE_MOTIFS = ['gold', 'ember', 'cream', 'copper', 'verdant'];
const LEDGER_KINDS = ['entry', 'honour'];
const SYSTEM_SLUGS = new Set((ddlBadges.systemBadges() || []).map((b) => b.slug));

function looksLikeFinals(name) {
	return /\bfinals?\b|\bgrand\s*finals?\b|\bchampionship\b/i.test(String(name || ''));
}

function looksLikeGrandTournament(name) {
	const n = String(name || '');
	return /\bddnyc\b/i.test(n) && /\b2026\b/.test(n) && /\birl\b/i.test(n);
}

function sanitizeEventKind(value, name) {
	if (value === 'duel') return 'duel';
	if (value === 'grand' || looksLikeGrandTournament(name)) return 'grand';
	return 'tournament';
}

function resolveEventKind(row) {
	if (!row) return 'tournament';
	const fieldSize = Number(row.field_size != null ? row.field_size : row.fieldSize);
	if (fieldSize === 2) return 'duel';
	return sanitizeEventKind(row.event_kind || row.eventKind, row.name);
}

function addColumnIfMissing(database, table, name, type) {
	try {
		database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
	} catch (_err) {}
}

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
			official_lock INTEGER NOT NULL DEFAULT 0,
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
		CREATE TABLE IF NOT EXISTS tourney_ledgers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			blurb TEXT,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS tourney_ledger_rows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ledger_id INTEGER NOT NULL,
			handle TEXT NOT NULL,
			user_id INTEGER,
			rank INTEGER,
			note TEXT,
			kind TEXT NOT NULL DEFAULT 'entry',
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_tourney_ledger_rows ON tourney_ledger_rows(ledger_id, kind, rank);
		CREATE TABLE IF NOT EXISTS tourney_badges (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			blurb TEXT,
			icon TEXT NOT NULL,
			motif TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS tourney_badge_awards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			badge_id INTEGER NOT NULL,
			handle TEXT NOT NULL,
			user_id INTEGER,
			note TEXT,
			created_at TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_tourney_badge_awards_unique
			ON tourney_badge_awards(badge_id, handle COLLATE NOCASE);
		CREATE TABLE IF NOT EXISTS tourney_mentions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			handle TEXT NOT NULL,
			user_id INTEGER,
			title TEXT NOT NULL,
			blurb TEXT,
			created_at TEXT NOT NULL
		);
	`);
	addColumnIfMissing(database, 'tourney_events', 'official_lock', 'INTEGER NOT NULL DEFAULT 0');
	addColumnIfMissing(database, 'tourney_events', 'event_kind', "TEXT NOT NULL DEFAULT 'tournament'");
	repairEventKinds(database);
	seedSystemBadges(database);
}

function seedSystemBadges(database) {
	if (!database) return;
	const now = new Date().toISOString();
	const insert = database.prepare(
		`INSERT OR IGNORE INTO tourney_badges (slug, title, blurb, icon, motif, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);
	const update = database.prepare(
		`UPDATE tourney_badges SET title = ?, blurb = ?, icon = ?, motif = ? WHERE slug = ?`
	);
	for (const badge of ddlBadges.systemBadges()) {
		insert.run(badge.slug, badge.title, badge.blurb, badge.icon, badge.motif, now);
		update.run(badge.title, badge.blurb, badge.icon, badge.motif, badge.slug);
	}
}

function getDb() {
	const authDex = require('../routes/auth-dex');
	const database = authDex.tryGetDdDatabaseForPaywall();
	if (database) {
		ensureSchema(database);
		repairFinalsOfficial(database);
		repairEventKinds(database);
	}
	return database;
}

function countsTowardRecord(tournament, fieldSize, isDemo) {
	if (isDemo || fieldSize < MIN_FIELD) return false;
	if (looksLikeFinals(tournament && tournament.name)) return true;
	return tournament.official !== false;
}

function placementMap(podium, standings) {
	const map = new Map();
	if (podium) {
		if (podium.first && podium.first.id != null) map.set(Number(podium.first.id), 1);
		if (podium.second && podium.second.id != null) map.set(Number(podium.second.id), 2);
		for (const row of podium.third || []) {
			if (row && row.id != null) map.set(Number(row.id), 3);
		}
		if (podium.fourth && podium.fourth.id != null) map.set(Number(podium.fourth.id), 4);
	}
	const used = new Set(map.values());
	let next = 4;
	for (const row of standings || []) {
		const id = Number(row && row.entryId);
		if (!id || map.has(id)) continue;
		while (used.has(next)) next += 1;
		if (next > 5) break;
		map.set(id, next);
		used.add(next);
		next += 1;
	}
	return map;
}

function grantBadgeBySlug(database, slug, handle, userId, note) {
	if (!database || !slug || !handle) return;
	const badge = database.prepare('SELECT id FROM tourney_badges WHERE slug = ?').get(slug);
	if (!badge) return;
	const existing = database.prepare(
		`SELECT id FROM tourney_badge_awards WHERE badge_id = ? AND handle = ? COLLATE NOCASE`
	).get(badge.id, handle);
	if (existing) return;
	database.prepare(
		`INSERT INTO tourney_badge_awards (badge_id, handle, user_id, note, created_at)
		 VALUES (?, ?, ?, ?, ?)`
	).run(badge.id, handle, userId || null, String(note || '').slice(0, 400), new Date().toISOString());
}

function recordFor(standings, entryId) {
	const row = (standings || []).find((s) => s.entryId === entryId);
	return row ? `${row.wins}-${row.losses}` : '';
}

function snapshotResults(database, store, tournament, extras) {
	if (!database || !tournament || tournament.status !== 'completed') return { ok: false, skipped: true };
	ensureSchema(database);
	const existing = database.prepare('SELECT tournament_id FROM tourney_events WHERE tournament_id = ?').get(tournament.id);
	const confirmed = (store.entries || []).filter((e) => e.tournamentId === tournament.id && e.paid);
	const fieldSize = confirmed.length;
	const arenaName = String(tournament.name || 'arena');
	const eventKind = resolveEventKind({
		event_kind: tournament.eventKind,
		name: arenaName,
		field_size: fieldSize,
	});
	if (existing) {
		database.prepare(
			`UPDATE tourney_events SET name = ?, event_kind = ? WHERE tournament_id = ?`
		).run(arenaName, eventKind, tournament.id);
		return { ok: true, skipped: true };
	}

	const official = countsTowardRecord(tournament, fieldSize, Boolean(extras && extras.isDemo)) ? 1 : 0;
	const standings = (extras && extras.standings) || [];
	const places = placementMap(extras && extras.podium, standings);
	const completedAt = new Date().toISOString();

	const tx = database.transaction(() => {
		database.prepare(
			`INSERT INTO tourney_events
			 (tournament_id, slug, name, format, stage_type, field_size, official, completed_at, event_kind)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			tournament.id,
			String(tournament.slug || ''),
			arenaName,
			String(
				tournament.format === 'single_elim' && tournament.losersBracket
					? 'double_elim'
					: (tournament.format || ''),
			),
			String(tournament.stageType || 'single'),
			fieldSize,
			official,
			completedAt,
			eventKind,
		);
		const ins = database.prepare(
			`INSERT INTO tourney_results (tournament_id, entry_id, user_id, handle, placement, record)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);
		for (const entry of confirmed) {
			const userId = entry.userId != null && Number(entry.userId) > 0 ? Number(entry.userId) : null;
			const handle = String(entry.handle || '');
			const place = places.has(entry.id) ? places.get(entry.id) : null;
			ins.run(
				tournament.id,
				entry.id,
				userId,
				handle,
				place,
				recordFor(standings, entry.id),
			);
			if (!official || fieldSize < 3) continue;
			const standing = ddlBadges.standingSpec(place);
			if (standing) {
				grantBadgeBySlug(database, standing.slug, handle, userId, `${standing.ribbon} · ${arenaName}`);
			}
			if (place && place <= 3) {
				const classSpecs = typeof ddlBadges.classSpecsFor === 'function'
					? ddlBadges.classSpecsFor(entry.ddlClass)
					: [];
				for (const classSpec of classSpecs) {
					grantBadgeBySlug(database, classSpec.slug, handle, userId, `Podium with ${classSpec.title} · ${arenaName}`);
				}
			}
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

function personFromResult(row) {
	if (!row || !row.handle) return null;
	return {
		handle: row.handle,
		userId: row.user_id || null,
		record: row.record || '',
	};
}

function mapResultRow(row) {
	const fieldSize = Number(row.field_size) || 0;
	const kind = resolveEventKind(row);
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
		fieldSize,
		kind,
		eventKind: kind,
		official: Boolean(row.official),
		completedAt: row.completed_at,
	};
}

function resultsForUser(database, userId) {
	if (!database || !userId) return [];
	ensureSchema(database);
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at, e.event_kind
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.user_id = ?
		 ORDER BY e.completed_at DESC`
	).all(Number(userId)).map(mapResultRow);
}

function resultsForHandle(database, handle) {
	if (!database) return [];
	ensureSchema(database);
	const h = String(handle || '').trim();
	if (h.length < 2) return [];
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at, e.event_kind
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.handle = ? COLLATE NOCASE
		 ORDER BY e.completed_at DESC`
	).all(h).map(mapResultRow);
}

function mapEventRow(database, row) {
	const tid = Number(row.tournament_id);
	const fieldSize = Number(row.field_size) || 0;
	const podium = database.prepare(
		`SELECT handle, user_id, placement, record FROM tourney_results
		 WHERE tournament_id = ? AND placement IS NOT NULL AND placement <= 3
		 ORDER BY placement ASC, handle COLLATE NOCASE`
	).all(tid);
	const first = podium.find((r) => Number(r.placement) === 1) || null;
	const second = podium.find((r) => Number(r.placement) === 2) || null;
	const third = podium.filter((r) => Number(r.placement) === 3).map(personFromResult).filter(Boolean);
	const kind = resolveEventKind(row);
	return {
		tournamentId: tid,
		slug: row.slug,
		name: row.name,
		format: row.format,
		stageType: row.stage_type,
		fieldSize,
		kind,
		eventKind: kind,
		official: Boolean(row.official),
		officialLock: Boolean(row.official_lock),
		completedAt: row.completed_at,
		manual: tid < 0 || String(row.slug || '').startsWith('manual-'),
		champion: personFromResult(first),
		runnerUp: personFromResult(second),
		third,
	};
}

function repairEventKinds(database) {
	if (!database) return 0;
	addColumnIfMissing(database, 'tourney_events', 'event_kind', "TEXT NOT NULL DEFAULT 'tournament'");
	let rows;
	try {
		rows = database.prepare(
			`SELECT tournament_id, name, field_size, event_kind FROM tourney_events`
		).all();
	} catch (_err) {
		return 0;
	}
	let changed = 0;
	const upd = database.prepare(
		`UPDATE tourney_events SET event_kind = ? WHERE tournament_id = ?`
	);
	for (const row of rows) {
		const kind = resolveEventKind(row);
		if (kind === row.event_kind) continue;
		upd.run(kind, row.tournament_id);
		changed += 1;
	}
	return changed;
}

function repairFinalsOfficial(database) {
	if (!database) return 0;
	ensureSchema(database);
	const rows = database.prepare(
		`SELECT tournament_id, name, official, official_lock FROM tourney_events`
	).all();
	let changed = 0;
	const upd = database.prepare(
		`UPDATE tourney_events SET official = 1 WHERE tournament_id = ? AND IFNULL(official_lock, 0) = 0`
	);
	for (const row of rows) {
		if (row.official || row.official_lock) continue;
		if (!looksLikeFinals(row.name)) continue;
		upd.run(row.tournament_id);
		changed += 1;
	}
	return changed;
}

function awardsForHandle(database, handle) {
	if (!database) return [];
	const h = String(handle || '').trim();
	if (h.length < 2) return [];
	return database.prepare(
		`SELECT a.id, a.badge_id, a.handle, a.user_id, a.note, a.created_at,
		        b.title, b.blurb, b.icon, b.motif, b.slug
		 FROM tourney_badge_awards a
		 JOIN tourney_badges b ON b.id = a.badge_id
		 WHERE a.handle = ? COLLATE NOCASE
		 ORDER BY a.created_at DESC`
	).all(h).map(mapAward);
}

function mapAward(row) {
	return {
		id: row.id,
		badgeId: row.badge_id,
		handle: row.handle,
		userId: row.user_id || null,
		note: row.note || '',
		createdAt: row.created_at,
		title: row.title,
		blurb: row.blurb || '',
		icon: row.icon,
		motif: row.motif,
		slug: row.slug,
	};
}

function mapBadge(row) {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		blurb: row.blurb || '',
		icon: row.icon,
		motif: row.motif,
		createdAt: row.created_at,
		system: SYSTEM_SLUGS.has(String(row.slug || '')),
	};
}

function listBadges(database) {
	if (!database) return [];
	const rank = (row) => {
		if (String(row.slug || '').startsWith('standing-')) return 0;
		if (String(row.slug || '').startsWith('class-')) return 1;
		return 2;
	};
	return database.prepare(
		`SELECT id, slug, title, blurb, icon, motif, created_at FROM tourney_badges ORDER BY created_at DESC`
	).all().map(mapBadge).sort((a, b) => {
		const diff = rank(a) - rank(b);
		if (diff) return diff;
		return String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });
	});
}

function listAwards(database) {
	if (!database) return [];
	return database.prepare(
		`SELECT a.id, a.badge_id, a.handle, a.user_id, a.note, a.created_at,
		        b.title, b.blurb, b.icon, b.motif, b.slug
		 FROM tourney_badge_awards a
		 JOIN tourney_badges b ON b.id = a.badge_id
		 ORDER BY a.created_at DESC`
	).all().map(mapAward);
}

function listMentions(database) {
	if (!database) return [];
	return database.prepare(
		`SELECT id, handle, user_id, title, blurb, created_at FROM tourney_mentions ORDER BY created_at DESC`
	).all().map((row) => ({
		id: row.id,
		handle: row.handle,
		userId: row.user_id || null,
		title: row.title,
		blurb: row.blurb || '',
		createdAt: row.created_at,
	}));
}

function listLedgers(database) {
	if (!database) return [];
	const boards = database.prepare(
		`SELECT id, slug, name, blurb, created_at FROM tourney_ledgers ORDER BY created_at DESC`
	).all();
	const rows = database.prepare(
		`SELECT id, ledger_id, handle, user_id, rank, note, kind, created_at
		 FROM tourney_ledger_rows
		 ORDER BY CASE WHEN kind = 'honour' THEN 1 ELSE 0 END, IFNULL(rank, 999), id`
	).all();
	return boards.map((board) => {
		const mine = rows.filter((row) => row.ledger_id === board.id);
		return {
			id: board.id,
			slug: board.slug,
			name: board.name,
			blurb: board.blurb || '',
			createdAt: board.created_at,
			entries: mine.filter((row) => row.kind !== 'honour').map(mapLedgerRow),
			mentions: mine.filter((row) => row.kind === 'honour').map(mapLedgerRow),
		};
	});
}

function mapLedgerRow(row) {
	return {
		id: row.id,
		ledgerId: row.ledger_id,
		handle: row.handle,
		userId: row.user_id || null,
		rank: row.rank == null ? null : Number(row.rank),
		note: row.note || '',
		kind: row.kind === 'honour' ? 'honour' : 'entry',
		createdAt: row.created_at,
	};
}

function attachBadges(champions, awards) {
	const byHandle = new Map();
	for (const award of awards || []) {
		const key = String(award.handle || '').toLowerCase();
		if (!byHandle.has(key)) byHandle.set(key, []);
		byHandle.get(key).push(award);
	}
	return (champions || []).map((row) => ({
		...row,
		badges: byHandle.get(String(row.handle || '').toLowerCase()) || [],
	}));
}

function hallStats(database) {
	const row = database.prepare(
		`SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN field_size = 2 THEN 1 ELSE 0 END) AS duels,
			SUM(CASE WHEN field_size > 2 THEN 1 ELSE 0 END) AS tournaments,
			SUM(CASE WHEN official = 1 THEN 1 ELSE 0 END) AS official
		 FROM tourney_events`
	).get() || {};
	return {
		total: Number(row.total) || 0,
		duels: Number(row.duels) || 0,
		tournaments: Number(row.tournaments) || 0,
		official: Number(row.official) || 0,
	};
}

function listDuelists(database, limit) {
	const cap = Math.min(80, Math.max(5, Number(limit) || 20));
	return database.prepare(
		`SELECT MAX(r.handle) AS handle, MAX(r.user_id) AS user_id,
		        SUM(CASE WHEN r.placement = 1 THEN 1 ELSE 0 END) AS wins,
		        SUM(CASE WHEN r.placement = 2 THEN 1 ELSE 0 END) AS losses
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE e.field_size = 2 AND e.official = 1
		 GROUP BY CASE WHEN r.user_id IS NOT NULL THEN 'u:' || r.user_id ELSE 'h:' || lower(r.handle) END
		 ORDER BY wins DESC, losses ASC, handle COLLATE NOCASE ASC
		 LIMIT ?`
	).all(cap).map((row) => {
		const wins = Number(row.wins) || 0;
		const losses = Number(row.losses) || 0;
		return {
			handle: row.handle,
			userId: row.user_id || null,
			wins,
			losses,
			played: wins + losses,
			record: `${wins}-${losses}`,
		};
	});
}

function hallOfFame(database, limit) {
	if (!database) {
		return {
			events: [],
			champions: [],
			duelists: [],
			mentions: [],
			ledgers: [],
			badges: [],
			awards: [],
			stats: { total: 0, duels: 0, tournaments: 0, official: 0 },
		};
	}
	ensureSchema(database);
	repairFinalsOfficial(database);
	repairEventKinds(database);
	const cap = Math.min(80, Math.max(5, Number(limit) || 20));
	const events = database.prepare(
		`SELECT tournament_id, slug, name, format, stage_type, field_size, official, official_lock, completed_at, event_kind
		 FROM tourney_events
		 ORDER BY completed_at DESC
		 LIMIT ?`
	).all(cap).map((row) => mapEventRow(database, row));
	const champions = database.prepare(
		`SELECT MAX(r.handle) AS handle, MAX(r.user_id) AS user_id, COUNT(*) AS titles
		 FROM tourney_results r
		 JOIN tourney_events e ON e.tournament_id = r.tournament_id
		 WHERE r.placement = 1 AND e.official = 1 AND e.field_size > 2
		 GROUP BY CASE WHEN r.user_id IS NOT NULL THEN 'u:' || r.user_id ELSE 'h:' || lower(r.handle) END
		 ORDER BY titles DESC, handle COLLATE NOCASE ASC
		 LIMIT ?`
	).all(cap).map((row) => ({
		handle: row.handle,
		userId: row.user_id || null,
		titles: Number(row.titles) || 0,
	}));
	const awards = listAwards(database);
	return {
		events,
		champions: attachBadges(champions, awards),
		duelists: attachBadges(listDuelists(database, cap), awards),
		mentions: attachBadges(listMentions(database), awards),
		ledgers: listLedgers(database),
		badges: listBadges(database),
		awards,
		stats: hallStats(database),
	};
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
		WHERE r.placement = 1 AND e.official = 1 AND e.field_size > 2
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
	const tourWins = official.filter((r) => r.placement === 1 && Number(r.fieldSize) > 2);
	const duelWins = official.filter((r) => r.placement === 1 && Number(r.fieldSize) === 2);
	const duelLosses = official.filter((r) => r.placement === 2 && Number(r.fieldSize) === 2);
	const displayHandle = (user && user.tourney_handle) || handle;
	return {
		handle: displayHandle,
		user: publicDiscordUser(user),
		results,
		accolades: unlockFor(official),
		badges: awardsForHandle(database, displayHandle),
		titles: tourWins.length,
		duelWins: duelWins.length,
		duelRecord: `${duelWins.length}-${duelLosses.length}`,
		appearances: official.length,
		mention: listMentions(database).find(
			(row) => String(row.handle).toLowerCase() === String(displayHandle).toLowerCase(),
		) || null,
	};
}

function unclaimedForHandle(database, handle) {
	if (!database) return [];
	ensureSchema(database);
	const h = String(handle || '').trim();
	if (h.length < 2) return [];
	return database.prepare(
		`SELECT r.tournament_id, r.entry_id, r.user_id, r.handle, r.placement, r.record,
		        e.slug, e.name, e.format, e.stage_type, e.field_size, e.official, e.completed_at, e.event_kind
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

function fail(status, message) {
	const err = new Error(message);
	err.status = status;
	throw err;
}

function requireHandle(value) {
	const handle = String(value || '').trim();
	if (handle.length < 2 || handle.length > 40) fail(400, 'Handle must be 2–40 characters');
	return handle;
}

function requireLabel(value, label, max) {
	const text = String(value || '').trim();
	if (text.length < 2 || text.length > (max || 80)) fail(400, `${label} must be 2–${max || 80} characters`);
	return text;
}

function clipBlurb(value) {
	return String(value || '').trim().slice(0, 400);
}

function slugify(value, fallback) {
	const s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
	return s || fallback || 'entry';
}

function uniqueSlug(database, table, base) {
	let slug = base || 'entry';
	let n = 2;
	const sql = table === 'tourney_events'
		? 'SELECT slug FROM tourney_events WHERE slug = ?'
		: `SELECT id FROM ${table} WHERE slug = ?`;
	while (database.prepare(sql).get(slug)) {
		slug = `${base}-${n}`;
		n += 1;
		if (n > 80) fail(400, 'Could not make a unique slug');
	}
	return slug;
}

function linkedUser(database, handle) {
	return findUserByHandle(database, handle) || findUserByDiscordUsername(database, handle);
}

function setEventOfficial(database, tournamentId, official) {
	ensureSchema(database);
	const id = Number(tournamentId);
	const row = database.prepare('SELECT tournament_id FROM tourney_events WHERE tournament_id = ?').get(id);
	if (!row) fail(404, 'That arena is not on the ledger');
	database.prepare(
		`UPDATE tourney_events SET official = ?, official_lock = 1 WHERE tournament_id = ?`
	).run(official ? 1 : 0, id);
	return { ok: true, tournamentId: id, official: Boolean(official) };
}

function nextManualTournamentId(database) {
	const row = database.prepare('SELECT MIN(tournament_id) AS m FROM tourney_events').get();
	const min = row && row.m != null ? Number(row.m) : 0;
	return min < 0 ? min - 1 : -1;
}

function addManualTitle(database, body) {
	ensureSchema(database);
	const handle = requireHandle(body && body.handle);
	const name = requireLabel((body && body.arenaName) || 'Recorded title', 'Arena name', 80);
	const record = String((body && body.record) || '').trim().slice(0, 16);
	const user = linkedUser(database, handle);
	const tournamentId = nextManualTournamentId(database);
	const slug = uniqueSlug(database, 'tourney_events', `manual-${slugify(handle, 'player')}`);
	const now = new Date().toISOString();
	const tx = database.transaction(() => {
		database.prepare(
			`INSERT INTO tourney_events
			 (tournament_id, slug, name, format, stage_type, field_size, official, official_lock, completed_at)
			 VALUES (?, ?, ?, 'single_elim', 'single', 2, 1, 1, ?)`
		).run(tournamentId, slug, name, now);
		database.prepare(
			`INSERT INTO tourney_results (tournament_id, entry_id, user_id, handle, placement, record)
			 VALUES (?, 1, ?, ?, 1, ?)`
		).run(tournamentId, user ? user.user_id : null, handle, record);
	});
	tx();
	return { ok: true, tournamentId, slug, handle, name };
}

function removeManualTitle(database, tournamentId) {
	ensureSchema(database);
	const id = Number(tournamentId);
	const row = database.prepare('SELECT tournament_id, slug FROM tourney_events WHERE tournament_id = ?').get(id);
	if (!row) fail(404, 'That record was not found');
	if (!(id < 0 || String(row.slug || '').startsWith('manual-'))) {
		fail(400, 'Only handwritten titles can be deleted. Demote an arena instead.');
	}
	const tx = database.transaction(() => {
		database.prepare('DELETE FROM tourney_results WHERE tournament_id = ?').run(id);
		database.prepare('DELETE FROM tourney_events WHERE tournament_id = ?').run(id);
	});
	tx();
	return { ok: true, tournamentId: id };
}

function isManualEvent(row) {
	return Number(row.tournament_id) < 0 || String(row.slug || '').startsWith('manual-');
}

function removeChampion(database, body) {
	ensureSchema(database);
	const handle = requireHandle(body && body.handle);
	const user = linkedUser(database, handle);
	const rows = user
		? database.prepare(
			`SELECT DISTINCT e.tournament_id, e.slug
			 FROM tourney_results r
			 JOIN tourney_events e ON e.tournament_id = r.tournament_id
			 WHERE r.placement = 1 AND e.official = 1
			   AND (r.handle = ? COLLATE NOCASE OR r.user_id = ?)`
		).all(handle, user.user_id)
		: database.prepare(
			`SELECT DISTINCT e.tournament_id, e.slug
			 FROM tourney_results r
			 JOIN tourney_events e ON e.tournament_id = r.tournament_id
			 WHERE r.placement = 1 AND e.official = 1
			   AND r.handle = ? COLLATE NOCASE`
		).all(handle);
	if (!rows.length) fail(404, 'No official titles for that handle');
	const tx = database.transaction(() => {
		let demoted = 0;
		let deleted = 0;
		for (const row of rows) {
			if (isManualEvent(row)) {
				database.prepare('DELETE FROM tourney_results WHERE tournament_id = ?').run(row.tournament_id);
				database.prepare('DELETE FROM tourney_events WHERE tournament_id = ?').run(row.tournament_id);
				deleted += 1;
			} else {
				database.prepare(
					`UPDATE tourney_events SET official = 0, official_lock = 1 WHERE tournament_id = ?`
				).run(row.tournament_id);
				demoted += 1;
			}
		}
		return { demoted, deleted };
	});
	return { ok: true, handle, ...tx() };
}

function saveLedger(database, body) {
	ensureSchema(database);
	const name = requireLabel(body && body.name, 'Leaderboard name', 80);
	const blurb = clipBlurb(body && body.blurb);
	const now = new Date().toISOString();
	const id = body && body.id != null ? Number(body.id) : 0;
	if (id > 0) {
		const existing = database.prepare('SELECT id FROM tourney_ledgers WHERE id = ?').get(id);
		if (!existing) fail(404, 'Leaderboard not found');
		database.prepare('UPDATE tourney_ledgers SET name = ?, blurb = ? WHERE id = ?').run(name, blurb, id);
		return { ok: true, id };
	}
	const slug = uniqueSlug(database, 'tourney_ledgers', slugify(name, 'board'));
	const info = database.prepare(
		`INSERT INTO tourney_ledgers (slug, name, blurb, created_at) VALUES (?, ?, ?, ?)`
	).run(slug, name, blurb, now);
	return { ok: true, id: Number(info.lastInsertRowid), slug };
}

function deleteLedger(database, ledgerId) {
	ensureSchema(database);
	const id = Number(ledgerId);
	const row = database.prepare('SELECT id FROM tourney_ledgers WHERE id = ?').get(id);
	if (!row) fail(404, 'Leaderboard not found');
	const tx = database.transaction(() => {
		database.prepare('DELETE FROM tourney_ledger_rows WHERE ledger_id = ?').run(id);
		database.prepare('DELETE FROM tourney_ledgers WHERE id = ?').run(id);
	});
	tx();
	return { ok: true, id };
}

function addLedgerRow(database, body) {
	ensureSchema(database);
	const ledgerId = Number(body && (body.ledgerId || body.boardId));
	const board = database.prepare('SELECT id FROM tourney_ledgers WHERE id = ?').get(ledgerId);
	if (!board) fail(404, 'Leaderboard not found');
	const handle = requireHandle(body && body.handle);
	const kind = LEDGER_KINDS.includes(body && body.kind) ? body.kind : 'entry';
	const rank = kind === 'honour' ? null : Math.min(99, Math.max(1, Number(body && body.rank) || 1));
	const note = clipBlurb(body && body.note);
	const user = linkedUser(database, handle);
	const info = database.prepare(
		`INSERT INTO tourney_ledger_rows (ledger_id, handle, user_id, rank, note, kind, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(ledgerId, handle, user ? user.user_id : null, rank, note, kind, new Date().toISOString());
	return { ok: true, id: Number(info.lastInsertRowid), ledgerId };
}

function removeLedgerRow(database, rowId) {
	ensureSchema(database);
	const id = Number(rowId);
	const row = database.prepare('SELECT id FROM tourney_ledger_rows WHERE id = ?').get(id);
	if (!row) fail(404, 'Entry not found');
	database.prepare('DELETE FROM tourney_ledger_rows WHERE id = ?').run(id);
	return { ok: true, id };
}

function saveMention(database, body) {
	ensureSchema(database);
	const handle = requireHandle(body && body.handle);
	const title = requireLabel((body && body.title) || 'Honourable mention', 'Title', 80);
	const blurb = clipBlurb(body && body.blurb);
	const user = linkedUser(database, handle);
	const id = body && body.id != null ? Number(body.id) : 0;
	if (id > 0) {
		const existing = database.prepare('SELECT id FROM tourney_mentions WHERE id = ?').get(id);
		if (!existing) fail(404, 'Mention not found');
		database.prepare(
			`UPDATE tourney_mentions SET handle = ?, user_id = ?, title = ?, blurb = ? WHERE id = ?`
		).run(handle, user ? user.user_id : null, title, blurb, id);
		return { ok: true, id };
	}
	const info = database.prepare(
		`INSERT INTO tourney_mentions (handle, user_id, title, blurb, created_at) VALUES (?, ?, ?, ?, ?)`
	).run(handle, user ? user.user_id : null, title, blurb, new Date().toISOString());
	return { ok: true, id: Number(info.lastInsertRowid) };
}

function deleteMention(database, mentionId) {
	ensureSchema(database);
	const id = Number(mentionId);
	const row = database.prepare('SELECT id FROM tourney_mentions WHERE id = ?').get(id);
	if (!row) fail(404, 'Mention not found');
	database.prepare('DELETE FROM tourney_mentions WHERE id = ?').run(id);
	return { ok: true, id };
}

function saveBadge(database, body) {
	ensureSchema(database);
	const title = requireLabel(body && body.title, 'Badge title', 40);
	const blurb = clipBlurb(body && body.blurb);
	const icon = BADGE_ICONS.includes(body && body.icon) ? body.icon : 'crest';
	const motif = BADGE_MOTIFS.includes(body && body.motif) ? body.motif : 'gold';
	const id = body && body.id != null ? Number(body.id) : 0;
	if ((ddlBadges.ART_ICONS || []).includes(icon) && !(id > 0)) {
		fail(400, 'That class or standings badge is already in the hall. Award it below.');
	}
	if (id > 0) {
		const existing = database.prepare('SELECT id, slug FROM tourney_badges WHERE id = ?').get(id);
		if (!existing) fail(404, 'Badge not found');
		if (SYSTEM_SLUGS.has(String(existing.slug || ''))) {
			fail(400, 'Class and standings badges cannot be edited. Award them below.');
		}
		database.prepare(
			`UPDATE tourney_badges SET title = ?, blurb = ?, icon = ?, motif = ? WHERE id = ?`
		).run(title, blurb, icon, motif, id);
		return { ok: true, id };
	}
	const slug = uniqueSlug(database, 'tourney_badges', slugify(title, 'badge'));
	const info = database.prepare(
		`INSERT INTO tourney_badges (slug, title, blurb, icon, motif, created_at) VALUES (?, ?, ?, ?, ?, ?)`
	).run(slug, title, blurb, icon, motif, new Date().toISOString());
	return { ok: true, id: Number(info.lastInsertRowid), slug };
}

function deleteBadge(database, badgeId) {
	ensureSchema(database);
	const id = Number(badgeId);
	const row = database.prepare('SELECT id, slug FROM tourney_badges WHERE id = ?').get(id);
	if (!row) fail(404, 'Badge not found');
	if (SYSTEM_SLUGS.has(String(row.slug || ''))) {
		fail(400, 'Class and standings badges cannot be deleted');
	}
	const tx = database.transaction(() => {
		database.prepare('DELETE FROM tourney_badge_awards WHERE badge_id = ?').run(id);
		database.prepare('DELETE FROM tourney_badges WHERE id = ?').run(id);
	});
	tx();
	return { ok: true, id };
}

function awardBadge(database, body) {
	ensureSchema(database);
	const badgeId = Number(body && body.badgeId);
	const badge = database.prepare('SELECT id FROM tourney_badges WHERE id = ?').get(badgeId);
	if (!badge) fail(404, 'Badge not found');
	const handle = requireHandle(body && body.handle);
	const note = clipBlurb(body && body.note);
	const user = linkedUser(database, handle);
	const existing = database.prepare(
		`SELECT id FROM tourney_badge_awards WHERE badge_id = ? AND handle = ? COLLATE NOCASE`
	).get(badgeId, handle);
	if (existing) return { ok: true, id: existing.id, already: true };
	const info = database.prepare(
		`INSERT INTO tourney_badge_awards (badge_id, handle, user_id, note, created_at)
		 VALUES (?, ?, ?, ?, ?)`
	).run(badgeId, handle, user ? user.user_id : null, note, new Date().toISOString());
	return { ok: true, id: Number(info.lastInsertRowid) };
}

function revokeAward(database, awardId) {
	ensureSchema(database);
	const id = Number(awardId);
	const row = database.prepare('SELECT id FROM tourney_badge_awards WHERE id = ?').get(id);
	if (!row) fail(404, 'Award not found');
	database.prepare('DELETE FROM tourney_badge_awards WHERE id = ?').run(id);
	return { ok: true, id };
}

function clearBadgeAwards(database, badgeId) {
	ensureSchema(database);
	const id = Number(badgeId);
	const badge = database.prepare('SELECT id, title FROM tourney_badges WHERE id = ?').get(id);
	if (!badge) fail(404, 'Badge not found');
	const info = database.prepare('DELETE FROM tourney_badge_awards WHERE badge_id = ?').run(id);
	return { ok: true, id, removed: info.changes, title: badge.title };
}

function stripPlayedClassAwards(database) {
	ensureSchema(database);
	const info = database.prepare(
		`DELETE FROM tourney_badge_awards
		 WHERE id IN (
			SELECT a.id
			FROM tourney_badge_awards a
			JOIN tourney_badges b ON b.id = a.badge_id
			WHERE b.slug LIKE 'class-%'
			  AND a.note LIKE 'Played %'
		 )`
	).run();
	return { ok: true, removed: info.changes };
}

function hostOp(database, op, body) {
	if (!database) fail(503, 'Records database unavailable');
	ensureSchema(database);
	const action = String(op || '').trim();
	switch (action) {
		case 'setOfficial':
			return setEventOfficial(database, body && body.tournamentId, body && body.official !== false);
		case 'addTitle':
			return addManualTitle(database, body);
		case 'removeTitle':
			return removeManualTitle(database, body && body.tournamentId);
		case 'removeChampion':
			return removeChampion(database, body);
		case 'saveBoard':
			return saveLedger(database, body);
		case 'deleteBoard':
			return deleteLedger(database, body && (body.id || body.ledgerId));
		case 'addBoardRow':
			return addLedgerRow(database, body);
		case 'removeBoardRow':
			return removeLedgerRow(database, body && body.id);
		case 'saveMention':
			return saveMention(database, body);
		case 'deleteMention':
			return deleteMention(database, body && body.id);
		case 'saveBadge':
			return saveBadge(database, body);
		case 'deleteBadge':
			return deleteBadge(database, body && body.id);
		case 'awardBadge':
			return awardBadge(database, body);
		case 'revokeAward':
			return revokeAward(database, body && body.id);
		case 'clearBadgeAwards':
			return clearBadgeAwards(database, body && (body.badgeId || body.id));
		case 'stripPlayedClassAwards':
			return stripPlayedClassAwards(database);
		default:
			fail(400, 'Unknown ledger operation');
	}
}

Object.assign(module.exports, {
	MIN_FIELD,
	BADGE_ICONS,
	BADGE_MOTIFS,
	MARK_ICONS,
	SYSTEM_SLUGS,
	normalizeDdlClass: ddlBadges.normalizeClass,
	parseDdlClass: ddlBadges.parseClass,
	classLabel: ddlBadges.classLabel,
	classSpecsFor: ddlBadges.classSpecsFor,
	classSpec: ddlBadges.classSpec,
	standingSpec: ddlBadges.standingSpec,
	ensureSchema,
	getDb,
	looksLikeFinals,
	looksLikeGrandTournament,
	sanitizeEventKind,
	resolveEventKind,
	countsTowardRecord,
	snapshotResults,
	backfillWithFns,
	repairFinalsOfficial,
	repairEventKinds,
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
	hostOp,
	listAwards,
	attachBadges,
});
