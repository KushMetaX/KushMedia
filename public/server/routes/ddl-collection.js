'use strict';

/**
 * DDL TCG collector accounts: each signed-in user (Discord or email, same km_sid
 * session as auth-dex) gets a saved Rise of the Pack checklist, a want list, and
 * a profile. Public profiles are listed at /collectors and can be opened at
 * /dd-evaluator/?collector=<slug>#ddl-tcg. /searching is the public want board.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const authDex = require('./auth-dex');
const checklist = require('../../../dd-evaluator/ddl-checklist.js');

const router = express.Router();

const MAX_COPIES = 999;
const MAX_GRADED = 50;
const GRADE_RE = /^(PSA|BGS|CGC|SGC) \d+(\.5)?$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const cardsById = new Map(checklist.cards.map((c) => [c.id, c]));

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

let schemaReady = false;

function ensureSchema(db) {
	if (schemaReady) return;
	db.exec(`
		CREATE TABLE IF NOT EXISTS ddl_collections (
			user_id INTEGER PRIMARY KEY,
			data TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ddl_profiles (
			user_id INTEGER PRIMARY KEY,
			slug TEXT NOT NULL,
			display_name TEXT,
			bio TEXT,
			favorite_card TEXT,
			is_public INTEGER NOT NULL DEFAULT 0,
			show_value INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_ddl_profiles_slug ON ddl_profiles(slug);
		CREATE TABLE IF NOT EXISTS ddl_wants (
			user_id INTEGER PRIMARY KEY,
			data TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);
	schemaReady = true;
}

async function openDb() {
	const db = await authDex.openAuthDatabase();
	ensureSchema(db);
	return db;
}

function sessionUser(db, req) {
	try {
		return authDex.ddSessionRow(db, req.signedCookies) || null;
	} catch (_err) {
		return null;
	}
}

/** Keep only real cards / prints, clamp counts, drop unknown grades. */
function sanitizeCollection(input) {
	const clean = {};
	if (!input || typeof input !== 'object' || Array.isArray(input)) return clean;
	for (const id of Object.keys(input)) {
		const card = cardsById.get(id);
		if (!card) continue;
		const prints = input[id];
		if (!prints || typeof prints !== 'object') continue;
		for (const print of card.prints) {
			const row = prints[print];
			if (!row || typeof row !== 'object') continue;
			const raw = Math.max(0, Math.min(MAX_COPIES, Math.floor(Number(row.raw) || 0)));
			const graded = Array.isArray(row.graded)
				? row.graded.filter((g) => typeof g === 'string' && GRADE_RE.test(g)).slice(0, MAX_GRADED)
				: [];
			if (!raw && !graded.length) continue;
			clean[id] = clean[id] || {};
			clean[id][print] = { raw, graded };
		}
	}
	return clean;
}

function collectionStats(collection) {
	let names = 0;
	let prints = 0;
	let holos = 0;
	let chase = 0;
	let copies = 0;
	let graded = 0;
	for (const card of checklist.cards) {
		const row = collection[card.id];
		if (!row) continue;
		let any = false;
		for (const print of card.prints) {
			const p = row[print];
			if (!p) continue;
			const n = p.raw + p.graded.length;
			if (!n) continue;
			any = true;
			prints += 1;
			copies += n;
			graded += p.graded.length;
			if (print === 'holo') holos += 1;
			if (print === 'fa') chase += 1;
		}
		if (any) names += 1;
	}
	return {
		names,
		namesTotal: checklist.names,
		prints,
		printsTotal: checklist.master,
		missingNames: checklist.names - names,
		missingPrints: checklist.master - prints,
		holos,
		holosTotal: checklist.cards.filter((c) => c.prints.includes('holo')).length,
		chase,
		chaseTotal: checklist.cards.filter((c) => c.chase).length,
		copies,
		graded,
	};
}

function slugify(raw) {
	return String(raw || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24);
}

function uniqueSlug(db, base, userId) {
	let root = slugify(base);
	if (root.length < 3) root = `collector-${userId}`;
	root = root.slice(0, 20);
	for (let i = 0; i < 50; i += 1) {
		const candidate = i === 0 ? root : `${root.slice(0, 20 - String(i).length)}${i}`;
		const taken = db.prepare('SELECT user_id FROM ddl_profiles WHERE slug = ? AND user_id != ?').get(candidate, userId);
		if (!taken) return candidate;
	}
	return `collector-${userId}`;
}

function displayNameFor(user) {
	return String(user.tourney_handle || user.discord_username || '').trim() || 'Collector';
}

function loadProfile(db, user) {
	let row = db.prepare('SELECT * FROM ddl_profiles WHERE user_id = ?').get(user.user_id);
	if (!row) {
		const now = Date.now();
		const slug = uniqueSlug(db, user.tourney_handle || user.discord_username, user.user_id);
		db.prepare(
			`INSERT INTO ddl_profiles (user_id, slug, display_name, bio, favorite_card, is_public, show_value, created_at, updated_at)
			 VALUES (?, ?, ?, '', NULL, 0, 0, ?, ?)`
		).run(user.user_id, slug, displayNameFor(user), now, now);
		row = db.prepare('SELECT * FROM ddl_profiles WHERE user_id = ?').get(user.user_id);
	}
	return row;
}

function profileJson(row) {
	return {
		slug: row.slug,
		displayName: row.display_name || 'Collector',
		bio: row.bio || '',
		favoriteCard: row.favorite_card || null,
		isPublic: Boolean(Number(row.is_public)),
		showValue: Boolean(Number(row.show_value)),
	};
}

function loadCollection(db, userId) {
	const row = db.prepare('SELECT data, updated_at FROM ddl_collections WHERE user_id = ?').get(userId);
	if (!row) return { collection: {}, updatedAt: null };
	let parsed = {};
	try {
		parsed = JSON.parse(row.data);
	} catch (_err) {
		parsed = {};
	}
	return { collection: sanitizeCollection(parsed), updatedAt: Number(row.updated_at) || null };
}

/** Official prints only: C/R base + holo, chase full art. Cap so a payload cannot grow without bound. */
function sanitizeWants(input) {
	const clean = [];
	const seen = new Set();
	const list = Array.isArray(input) ? input : [];
	for (const row of list) {
		if (!row || typeof row !== 'object') continue;
		const id = String(row.id || '');
		const print = String(row.print || '');
		const card = cardsById.get(id);
		if (!card || !card.prints.includes(print)) continue;
		const key = `${id}|${print}`;
		if (seen.has(key)) continue;
		seen.add(key);
		clean.push({ id, print });
		if (clean.length >= 250) break;
	}
	return clean;
}

function loadWants(db, userId) {
	const row = db.prepare('SELECT data, updated_at FROM ddl_wants WHERE user_id = ?').get(userId);
	if (!row) return { wants: [], updatedAt: null };
	let parsed = [];
	try {
		parsed = JSON.parse(row.data);
	} catch (_err) {
		parsed = [];
	}
	return { wants: sanitizeWants(parsed), updatedAt: Number(row.updated_at) || null };
}

function parseJson(raw, fallback) {
	try {
		return JSON.parse(raw);
	} catch (_err) {
		return fallback;
	}
}

function listPublicCollectors(db) {
	const rows = db.prepare(`
		SELECT p.slug, p.display_name, p.bio, p.favorite_card, p.updated_at AS profile_updated,
		       c.data AS collection_data, c.updated_at AS collection_updated,
		       w.data AS wants_data,
		       u.discord_username, u.avatar_url
		FROM ddl_profiles p
		LEFT JOIN ddl_collections c ON c.user_id = p.user_id
		LEFT JOIN ddl_wants w ON w.user_id = p.user_id
		LEFT JOIN users u ON u.id = p.user_id
		WHERE p.is_public = 1
		ORDER BY COALESCE(c.updated_at, p.updated_at) DESC
		LIMIT 80
	`).all();
	return rows.map((row) => {
		const wants = sanitizeWants(parseJson(row.wants_data || '[]', []));
		const updatedAt = Math.max(Number(row.collection_updated) || 0, Number(row.profile_updated) || 0) || null;
		return {
			slug: row.slug,
			displayName: row.display_name || 'Collector',
			bio: row.bio || '',
			favoriteCard: row.favorite_card || null,
			avatarUrl: String(row.avatar_url || '').trim() || null,
			discordUsername: row.discord_username || null,
			stats: collectionStats(sanitizeCollection(parseJson(row.collection_data || '{}', {}))),
			wantCount: wants.length,
			updatedAt,
		};
	});
}

function listPublicSearching(db) {
	const rows = db.prepare(`
		SELECT p.slug, p.display_name, w.data
		FROM ddl_wants w
		JOIN ddl_profiles p ON p.user_id = w.user_id
		WHERE p.is_public = 1
	`).all();
	const groups = new Map();
	for (const row of rows) {
		for (const want of sanitizeWants(parseJson(row.data || '[]', []))) {
			const key = `${want.id}|${want.print}`;
			let group = groups.get(key);
			if (!group) {
				group = { id: want.id, print: want.print, count: 0, collectors: [] };
				groups.set(key, group);
			}
			group.count += 1;
			if (group.collectors.length < 8) {
				group.collectors.push({ slug: row.slug, displayName: row.display_name || 'Collector' });
			}
		}
	}
	return [...groups.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id) || a.print.localeCompare(b.print));
}

function userJson(user) {
	const payload = authDex.authUserPayload(user) || {};
	return {
		id: payload.id,
		discordUsername: payload.discordUsername,
		avatarUrl: payload.avatarUrl,
		hasDiscord: Boolean(payload.discordId),
	};
}

function fail(res, status, error) {
	res.status(status).json({ ok: false, error });
}

router.use((req, res, next) => {
	res.set('Cache-Control', 'no-store, private');
	next();
});

router.get('/me', readLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	const user = sessionUser(db, req);
	if (!user) {
		return res.json({ ok: true, signedIn: false, discordOAuth: authDex.discordOAuthConfigured() });
	}
	const profile = loadProfile(db, user);
	const { collection, updatedAt } = loadCollection(db, user.user_id);
	const wantsRow = loadWants(db, user.user_id);
	res.json({
		ok: true,
		signedIn: true,
		user: userJson(user),
		profile: profileJson(profile),
		collection,
		updatedAt,
		wants: wantsRow.wants,
		wantsUpdatedAt: wantsRow.updatedAt,
		stats: collectionStats(collection),
	});
});

router.post('/collection', writeLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	const user = sessionUser(db, req);
	if (!user) return fail(res, 401, 'Sign in to save your collection.');
	const collection = sanitizeCollection(req.body && req.body.collection);
	const now = Date.now();
	db.prepare(
		`INSERT INTO ddl_collections (user_id, data, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
	).run(user.user_id, JSON.stringify(collection), now);
	loadProfile(db, user);
	res.json({ ok: true, updatedAt: now, collection, stats: collectionStats(collection) });
});

router.post('/wants', writeLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	const user = sessionUser(db, req);
	if (!user) return fail(res, 401, 'Sign in to publish what you are looking for.');
	const wants = sanitizeWants(req.body && req.body.wants);
	const now = Date.now();
	db.prepare(
		`INSERT INTO ddl_wants (user_id, data, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
	).run(user.user_id, JSON.stringify(wants), now);
	res.json({ ok: true, updatedAt: now, wants });
});

router.get('/collectors', readLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	try {
		res.json({ ok: true, collectors: listPublicCollectors(db) });
	} catch (_err) {
		fail(res, 503, 'Collector lists are unavailable right now.');
	}
});

router.get('/searching', readLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	try {
		res.json({ ok: true, cards: listPublicSearching(db) });
	} catch (_err) {
		fail(res, 503, 'Collector lists are unavailable right now.');
	}
});

router.post('/profile', writeLimiter, async (req, res) => {
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	const user = sessionUser(db, req);
	if (!user) return fail(res, 401, 'Sign in to edit your profile.');
	const current = loadProfile(db, user);
	const body = req.body || {};

	let slug = current.slug;
	if (body.slug != null && String(body.slug).trim().toLowerCase() !== current.slug) {
		const wanted = String(body.slug).trim().toLowerCase();
		if (!SLUG_RE.test(wanted)) {
			return fail(res, 400, 'Profile link must be 3–24 letters, numbers, dashes or underscores.');
		}
		const taken = db.prepare('SELECT user_id FROM ddl_profiles WHERE slug = ? AND user_id != ?').get(wanted, user.user_id);
		if (taken) return fail(res, 409, 'That profile link is taken.');
		slug = wanted;
	}

	const displayName = body.displayName != null
		? String(body.displayName).replace(/\s+/g, ' ').trim().slice(0, 32)
		: current.display_name;
	if (!displayName) return fail(res, 400, 'Display name cannot be empty.');
	const bio = body.bio != null ? String(body.bio).replace(/\s+/g, ' ').trim().slice(0, 200) : current.bio;
	let favorite = current.favorite_card;
	if (body.favoriteCard !== undefined) {
		favorite = body.favoriteCard && cardsById.has(String(body.favoriteCard)) ? String(body.favoriteCard) : null;
	}
	const isPublic = body.isPublic != null ? (body.isPublic ? 1 : 0) : Number(current.is_public) || 0;
	const showValue = body.showValue != null ? (body.showValue ? 1 : 0) : Number(current.show_value) || 0;

	db.prepare(
		`UPDATE ddl_profiles SET slug = ?, display_name = ?, bio = ?, favorite_card = ?, is_public = ?, show_value = ?, updated_at = ?
		 WHERE user_id = ?`
	).run(slug, displayName, bio, favorite, isPublic, showValue, Date.now(), user.user_id);
	const row = db.prepare('SELECT * FROM ddl_profiles WHERE user_id = ?').get(user.user_id);
	res.json({ ok: true, profile: profileJson(row) });
});

router.get('/u/:slug', readLimiter, async (req, res) => {
	const slug = String(req.params.slug || '').trim().toLowerCase();
	if (!SLUG_RE.test(slug)) return fail(res, 404, 'No collector by that name.');
	let db;
	try {
		db = await openDb();
	} catch (_err) {
		return fail(res, 503, 'Accounts are unavailable right now.');
	}
	const row = db.prepare('SELECT * FROM ddl_profiles WHERE slug = ?').get(slug);
	const viewer = sessionUser(db, req);
	const isOwner = Boolean(row && viewer && Number(viewer.user_id) === Number(row.user_id));
	if (!row || (!Number(row.is_public) && !isOwner)) return fail(res, 404, 'This collector profile is private or does not exist.');
	const owner = authDex.loadUserRow(db, row.user_id);
	const { collection, updatedAt } = loadCollection(db, row.user_id);
	const wantsRow = loadWants(db, row.user_id);
	const user = owner ? userJson(owner) : {};
	res.json({
		ok: true,
		isOwner,
		profile: profileJson(row),
		avatarUrl: user.avatarUrl || null,
		discordUsername: user.discordUsername || null,
		collection,
		updatedAt,
		wants: wantsRow.wants,
		stats: collectionStats(collection),
	});
});

module.exports = router;
module.exports.sanitizeCollection = sanitizeCollection;
module.exports.sanitizeWants = sanitizeWants;
module.exports.collectionStats = collectionStats;
