'use strict';

const fs = require('fs');
const path = require('path');

const { bumpNextId } = require('./arena-archive');

const JSON_BACKUP_MS = 15 * 60 * 1000;
const SQLITE_BACKUP_MS = 30 * 60 * 1000;
const KEEP_JSON_BACKUPS = 16;
const KEEP_SQLITE_BACKUPS = 8;

let lastPersistSig = '';

function backupDir(storeFile) {
	return path.join(path.dirname(storeFile), 'backups');
}

function sqlitePathNear(storeFile) {
	if (process.env.DEX_DB_PATH) return path.resolve(process.env.DEX_DB_PATH);
	return path.join(path.dirname(storeFile), 'doginaldex.sqlite');
}

function stampName() {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureSchema(database) {
	if (!database) return;
	database.exec(`
		CREATE TABLE IF NOT EXISTS tourney_store_blob (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			next_id INTEGER NOT NULL,
			body TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS tourney_arena_archive (
			tournament_id INTEGER PRIMARY KEY,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL,
			format TEXT,
			event_kind TEXT,
			official INTEGER NOT NULL DEFAULT 1,
			live INTEGER NOT NULL DEFAULT 1,
			field_size INTEGER,
			created_at TEXT,
			completed_at TEXT,
			updated_at TEXT NOT NULL,
			body TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_tourney_arena_archive_slug
			ON tourney_arena_archive(slug);
		CREATE INDEX IF NOT EXISTS idx_tourney_arena_archive_live
			ON tourney_arena_archive(live, status);
		CREATE TABLE IF NOT EXISTS tourney_store_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);
}

function parseJson(text, fallback) {
	try {
		const value = JSON.parse(text);
		return value == null ? fallback : value;
	} catch (_err) {
		return fallback;
	}
}

function clone(value) {
	return value == null ? value : parseJson(JSON.stringify(value), null);
}

function storeSignature(store) {
	const tournaments = store && store.tournaments ? store.tournaments : [];
	const entries = store && store.entries ? store.entries : [];
	const matches = store && store.matches ? store.matches : [];
	const votes = store && store.votes ? store.votes : [];
	const predictions = store && store.predictions ? store.predictions : [];
	return [
		store && store.nextId,
		tournaments.length,
		entries.length,
		matches.length,
		votes.length,
		predictions.length,
		tournaments.map((t) => `${t.id}:${t.status}:${t.slug}`).join(','),
		matches.map((m) => `${m.id}:${m.status}:${m.winnerId || ''}:${m.score1 || ''}:${m.score2 || ''}`).join(','),
		entries.map((e) => `${e.id}:${e.paid ? 1 : 0}:${e.placement || ''}:${e.record || ''}`).join(','),
	].join('|');
}

function packageArena(store, tournament) {
	const id = Number(tournament.id);
	return {
		tournament: clone(tournament),
		entries: (store.entries || []).filter((e) => Number(e.tournamentId) === id).map(clone),
		matches: (store.matches || []).filter((m) => Number(m.tournamentId) === id).map(clone),
		votes: (store.votes || []).filter((v) => Number(v.tournamentId) === id).map(clone),
		predictions: (store.predictions || []).filter((p) => Number(p.tournamentId) === id).map(clone),
	};
}

function paidFieldSize(pack) {
	return (pack.entries || []).filter((e) => e && e.paid && !e.noShow && (!e.whitelist || e.subbedIn)).length;
}

function liveIds(store) {
	return new Set((store.tournaments || []).map((t) => Number(t.id)).filter((id) => id > 0));
}

function persistLiveStore(database, store, options) {
	if (!database || !store) return { ok: false };
	ensureSchema(database);
	const skip = options && typeof options.skipTournament === 'function'
		? options.skipTournament
		: () => false;
	const now = new Date().toISOString();
	const sig = storeSignature(store);
	if (sig && sig === lastPersistSig) return { ok: true, skipped: true, arenas: (store.tournaments || []).length };
	const blobStore = clone(store) || { nextId: 1, tournaments: [], entries: [], matches: [], votes: [], predictions: [] };
	delete blobStore._persist;
	const blob = JSON.stringify(blobStore);
	const currentIds = liveIds(store);

	const tx = database.transaction(() => {
		database.prepare(
			`INSERT OR REPLACE INTO tourney_store_blob (id, next_id, body, updated_at)
			 VALUES (1, ?, ?, ?)`
		).run(Number(store.nextId) || 1, blob, now);
		database.prepare(
			`INSERT OR REPLACE INTO tourney_store_meta (key, value) VALUES ('nextId', ?)`
		).run(String(Number(store.nextId) || 1));
		database.prepare(
			`INSERT OR REPLACE INTO tourney_store_meta (key, value) VALUES ('lastPersistAt', ?)`
		).run(now);

		const upsert = database.prepare(
			`INSERT OR REPLACE INTO tourney_arena_archive
			 (tournament_id, slug, name, status, format, event_kind, official, live, field_size,
			  created_at, completed_at, updated_at, body)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
		);
		for (const tournament of store.tournaments || []) {
			if (!tournament || skip(tournament)) continue;
			const id = Number(tournament.id);
			if (!id) continue;
			const pack = packageArena(store, tournament);
			const completedAt = tournament.status === 'completed'
				? (tournament.completedAt || tournament.restoredAt || now)
				: null;
			upsert.run(
				id,
				String(tournament.slug || ''),
				String(tournament.name || 'arena'),
				String(tournament.status || ''),
				String(tournament.format || ''),
				String(tournament.eventKind || ''),
				tournament.official === false ? 0 : 1,
				paidFieldSize(pack),
				tournament.createdAt || now,
				completedAt,
				now,
				JSON.stringify(pack),
			);
		}

		const rows = database.prepare('SELECT tournament_id FROM tourney_arena_archive').all();
		const mark = database.prepare('UPDATE tourney_arena_archive SET live = 0, updated_at = ? WHERE tournament_id = ?');
		for (const row of rows || []) {
			const id = Number(row.tournament_id);
			if (!currentIds.has(id)) mark.run(now, id);
		}
	});
	tx();
	lastPersistSig = sig;
	return { ok: true, skipped: false, arenas: currentIds.size };
}

function hydrateStore(database) {
	if (!database) return null;
	ensureSchema(database);
	let row;
	try {
		row = database.prepare('SELECT next_id, body FROM tourney_store_blob WHERE id = 1').get();
	} catch (_err) {
		return null;
	}
	if (!row || !row.body) return null;
	const store = parseJson(row.body, null);
	if (!store || !Array.isArray(store.tournaments) || !store.tournaments.length) return null;
	store.nextId = Number(store.nextId || row.next_id) || 1;
	store.entries = Array.isArray(store.entries) ? store.entries : [];
	store.matches = Array.isArray(store.matches) ? store.matches : [];
	store.votes = Array.isArray(store.votes) ? store.votes : [];
	store.predictions = Array.isArray(store.predictions) ? store.predictions : [];
	bumpNextId(store);
	return store;
}

function hasTournament(store, id, slug) {
	return (store.tournaments || []).some((t) => (
		Number(t.id) === Number(id) || (slug && String(t.slug) === String(slug))
	));
}

function stripArena(store, id, slug) {
	const ids = new Set([Number(id)]);
	for (const t of store.tournaments || []) {
		if (Number(t.id) === Number(id) || (slug && String(t.slug) === String(slug))) ids.add(Number(t.id));
	}
	store.tournaments = (store.tournaments || []).filter((t) => !ids.has(Number(t.id)) && String(t.slug) !== String(slug));
	store.entries = (store.entries || []).filter((e) => !ids.has(Number(e.tournamentId)));
	store.matches = (store.matches || []).filter((m) => !ids.has(Number(m.tournamentId)));
	store.votes = (store.votes || []).filter((v) => !ids.has(Number(v.tournamentId)));
	store.predictions = (store.predictions || []).filter((p) => !ids.has(Number(p.tournamentId)));
}

function applyArchivePackage(store, pack, replace) {
	if (!pack || !pack.tournament || pack.tournament.id == null) return false;
	const tournament = pack.tournament;
	const id = Number(tournament.id);
	const slug = String(tournament.slug || '');
	if (replace) stripArena(store, id, slug);
	else if (hasTournament(store, id, slug)) return false;
	store.tournaments.push(clone(tournament));
	for (const row of pack.entries || []) store.entries.push(clone(row));
	for (const row of pack.matches || []) store.matches.push(clone(row));
	for (const row of pack.votes || []) store.votes.push(clone(row));
	for (const row of pack.predictions || []) store.predictions.push(clone(row));
	return true;
}

function arenaIsThin(store, tournament) {
	if (!tournament) return true;
	const id = Number(tournament.id);
	const matches = (store.matches || []).filter((m) => Number(m.tournamentId) === id);
	const entries = (store.entries || []).filter((e) => Number(e.tournamentId) === id);
	if (tournament.restoredFromRecords && !matches.length) return true;
	if (entries.length && tournament.status === 'completed' && !matches.length) return true;
	return false;
}

function restoreMissingFromArchive(store, database, options) {
	if (!store || !database) return { restored: 0, upgraded: 0 };
	ensureSchema(database);
	const emptyLive = !(store.tournaments && store.tournaments.length);
	const includeIdle = Boolean(options && options.includeIdle) || emptyLive;
	let rows = [];
	try {
		rows = database.prepare(
			`SELECT tournament_id, slug, status, live, body FROM tourney_arena_archive`
		).all();
	} catch (_err) {
		return { restored: 0, upgraded: 0 };
	}
	let restored = 0;
	let upgraded = 0;
	for (const row of rows || []) {
		const pack = parseJson(row.body, null);
		if (!pack || !pack.tournament) continue;
		const id = Number(row.tournament_id || pack.tournament.id);
		const slug = String(row.slug || pack.tournament.slug || '');
		const status = String(row.status || pack.tournament.status || '');
		const live = Number(row.live) === 1;
		const existing = (store.tournaments || []).find((t) => Number(t.id) === id || String(t.slug) === slug);
		if (existing) {
			const haveMatches = (store.matches || []).filter((m) => Number(m.tournamentId) === Number(existing.id)).length;
			const archMatches = (pack.matches || []).length;
			const haveEntries = (store.entries || []).filter((e) => Number(e.tournamentId) === Number(existing.id)).length;
			const archEntries = (pack.entries || []).length;
			if (arenaIsThin(store, existing) && (archMatches > haveMatches || archEntries > haveEntries)) {
				if (applyArchivePackage(store, pack, true)) upgraded += 1;
			}
			continue;
		}
		const completed = status === 'completed';
		if (!completed && !live && !includeIdle) continue;
		if (applyArchivePackage(store, pack, false)) restored += 1;
	}
	if (restored || upgraded) bumpNextId(store);
	return { restored, upgraded };
}

function stats(database) {
	if (!database) {
		return {
			arenas: 0, live: 0, completed: 0, blob: false, lastPersistAt: null,
			events: 0, results: 0,
		};
	}
	ensureSchema(database);
	const row = database.prepare(
		`SELECT
			COUNT(*) AS arenas,
			SUM(CASE WHEN live = 1 THEN 1 ELSE 0 END) AS live,
			SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
		 FROM tourney_arena_archive`
	).get() || {};
	const blob = database.prepare('SELECT updated_at FROM tourney_store_blob WHERE id = 1').get();
	const meta = database.prepare(`SELECT value FROM tourney_store_meta WHERE key = 'lastPersistAt'`).get();
	let events = 0;
	let results = 0;
	try {
		events = Number((database.prepare('SELECT COUNT(*) AS n FROM tourney_events').get() || {}).n) || 0;
		results = Number((database.prepare('SELECT COUNT(*) AS n FROM tourney_results').get() || {}).n) || 0;
	} catch (_err) {}
	return {
		arenas: Number(row.arenas) || 0,
		live: Number(row.live) || 0,
		completed: Number(row.completed) || 0,
		blob: Boolean(blob),
		lastPersistAt: (meta && meta.value) || (blob && blob.updated_at) || null,
		events,
		results,
	};
}

function sealGaps(database, store) {
	const gaps = [];
	if (!database || !store) return gaps;
	ensureSchema(database);
	for (const tournament of store.tournaments || []) {
		if (!tournament || tournament.status !== 'completed') continue;
		const paid = (store.entries || []).filter((e) => e.tournamentId === tournament.id && e.paid).length;
		const event = database.prepare(
			'SELECT tournament_id, official FROM tourney_events WHERE tournament_id = ?'
		).get(tournament.id);
		const row = database.prepare(
			'SELECT COUNT(*) AS n FROM tourney_results WHERE tournament_id = ?'
		).get(tournament.id);
		const sealed = Number(row && row.n) || 0;
		if (!event || sealed < paid) {
			gaps.push({
				id: tournament.id,
				slug: tournament.slug,
				name: tournament.name,
				paid,
				sealed,
				hasEvent: Boolean(event),
			});
		}
	}
	return gaps;
}

function latestMtime(dir, prefix) {
	if (!fs.existsSync(dir)) return 0;
	let latest = 0;
	for (const name of fs.readdirSync(dir)) {
		if (!String(name).startsWith(prefix)) continue;
		try {
			const stamp = fs.statSync(path.join(dir, name)).mtimeMs;
			if (stamp > latest) latest = stamp;
		} catch (_err) {}
	}
	return latest;
}

function pruneBackups(dir, prefix, keep) {
	if (!fs.existsSync(dir)) return;
	const names = fs.readdirSync(dir)
		.filter((name) => String(name).startsWith(prefix))
		.sort()
		.reverse();
	for (const name of names.slice(Math.max(1, keep))) {
		try { fs.unlinkSync(path.join(dir, name)); } catch (_err) {}
	}
}

function copyFileSafe(src, dest) {
	if (!src || !fs.existsSync(src)) return false;
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
	return true;
}

/**
 * Consistent SQLite snapshot (sync). Checkpoint WAL into the main file, then copy.
 * Avoids better-sqlite3's async .backup() so saveStore stays synchronous.
 */
function backupSqliteConsistent(database, dbFile, dest) {
	if (!dbFile && !(database && database.filePath)) return false;
	const src = dbFile || (database && database.filePath);
	if (!src) return false;
	fs.mkdirSync(path.dirname(dest), { recursive: true });

	if (database && database._engine === 'sql.js' && typeof database.persist === 'function') {
		try { database.persist(); } catch (_err) {}
	}

	if (database && typeof database.pragma === 'function') {
		try { database.pragma('wal_checkpoint(TRUNCATE)'); } catch (_err) {}
	} else if (database && typeof database.exec === 'function') {
		try { database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_err) {}
	}

	if (!fs.existsSync(src)) return false;
	try {
		fs.copyFileSync(src, dest);
		return true;
	} catch (err) {
		console.error('[tourney] sqlite copy backup:', err && err.message ? err.message : err);
		return false;
	}
}

function stampFromBackupName(name, prefix) {
	const raw = String(name || '').slice(String(prefix).length).replace(/\.json$/i, '').replace(/\.sqlite$/i, '');
	// Filenames use ISO with : and . replaced by -
	const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d+)Z$/);
	if (!match) return null;
	const iso = `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

function listBackupNames(dir, prefix) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter((name) => String(name).startsWith(prefix))
		.sort()
		.reverse();
}

function backupInventory(storeFile) {
	const dir = backupDir(storeFile);
	const json = listBackupNames(dir, 'tourney-store-');
	const sqlite = listBackupNames(dir, 'doginaldex-');
	const now = Date.now();
	const jsonStamp = json[0] ? stampFromBackupName(json[0], 'tourney-store-') : null;
	const sqliteStamp = sqlite[0] ? stampFromBackupName(sqlite[0], 'doginaldex-') : null;
	return {
		dir,
		jsonCount: json.length,
		sqliteCount: sqlite.length,
		latestJson: json[0] || null,
		latestSqlite: sqlite[0] || null,
		jsonAgeMs: jsonStamp != null ? Math.max(0, now - jsonStamp) : null,
		sqliteAgeMs: sqliteStamp != null ? Math.max(0, now - sqliteStamp) : null,
	};
}

function storeRichness(store) {
	const tournaments = (store && store.tournaments) || [];
	return {
		arenas: tournaments.length,
		completed: tournaments.filter((t) => t && t.status === 'completed').length,
		entries: ((store && store.entries) || []).length,
		matches: ((store && store.matches) || []).length,
	};
}

function isRicherStore(candidate, baseline) {
	const a = storeRichness(candidate);
	const b = storeRichness(baseline);
	if (a.arenas !== b.arenas) return a.arenas > b.arenas;
	if (a.matches !== b.matches) return a.matches > b.matches;
	if (a.entries !== b.entries) return a.entries > b.entries;
	if (a.completed !== b.completed) return a.completed > b.completed;
	return false;
}

function rotateLiveBak(storeFile) {
	if (!storeFile || !fs.existsSync(storeFile)) return false;
	try {
		const bak = `${storeFile}.bak`;
		const bak1 = `${storeFile}.bak.1`;
		const bak2 = `${storeFile}.bak.2`;
		if (fs.existsSync(bak1)) fs.copyFileSync(bak1, bak2);
		if (fs.existsSync(bak)) fs.copyFileSync(bak, bak1);
		fs.copyFileSync(storeFile, bak);
		return true;
	} catch (err) {
		console.error('[tourney] bak rotate:', err && err.message ? err.message : err);
		return false;
	}
}

function rotateTimestampedBackups(storeFile, options) {
	if (!storeFile) return { json: false, sqlite: false };
	const dir = backupDir(storeFile);
	fs.mkdirSync(dir, { recursive: true });
	const now = Date.now();
	const force = Boolean(options && options.force);
	const wrote = { json: false, sqlite: false, error: null };
	try {
		if (fs.existsSync(storeFile) && (force || now - latestMtime(dir, 'tourney-store-') >= JSON_BACKUP_MS)) {
			const dest = path.join(dir, `tourney-store-${stampName()}.json`);
			wrote.json = copyFileSafe(storeFile, dest);
			pruneBackups(dir, 'tourney-store-', KEEP_JSON_BACKUPS);
		}
		const dbFile = (options && options.sqlitePath) || sqlitePathNear(storeFile);
		const database = options && options.database;
		const shouldSqlite = force || now - latestMtime(dir, 'doginaldex-') >= SQLITE_BACKUP_MS;
		if (shouldSqlite && (database || fs.existsSync(dbFile))) {
			const dest = path.join(dir, `doginaldex-${stampName()}.sqlite`);
			wrote.sqlite = backupSqliteConsistent(database, dbFile, dest);
			if (wrote.sqlite) pruneBackups(dir, 'doginaldex-', KEEP_SQLITE_BACKUPS);
		}
	} catch (err) {
		wrote.error = err && err.message ? err.message : String(err);
		console.error('[tourney] timestamped backup:', wrote.error);
	}
	return wrote;
}

function afterJsonSave(storeFile, store, options) {
	const skipTournament = options && options.skipTournament;
	const database = options && options.database;
	let backups = { json: false, sqlite: false };
	try {
		backups = rotateTimestampedBackups(storeFile, {
			sqlitePath: sqlitePathNear(storeFile),
			database,
		});
	} catch (err) {
		console.error('[tourney] backup rotate:', err && err.message ? err.message : err);
	}
	if (!database) return { ...backups, ok: false, sqliteArchive: false };
	try {
		const archived = persistLiveStore(database, store, { skipTournament });
		return { ...backups, ...archived, sqliteArchive: true };
	} catch (err) {
		console.error('[tourney] sqlite archive:', err && err.message ? err.message : err);
		return {
			...backups,
			ok: false,
			sqliteArchive: false,
			error: err && err.message ? err.message : String(err),
		};
	}
}

function resetPersistCache() {
	lastPersistSig = '';
}

module.exports = {
	ensureSchema,
	persistLiveStore,
	hydrateStore,
	restoreMissingFromArchive,
	stats,
	sealGaps,
	storeRichness,
	isRicherStore,
	backupInventory,
	backupSqliteConsistent,
	rotateLiveBak,
	rotateTimestampedBackups,
	afterJsonSave,
	sqlitePathNear,
	resetPersistCache,
	storeSignature,
};
