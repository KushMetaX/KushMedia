'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { resolveSessionSecret: cookieSecret } = require('../session-secret');
const cryptoPay = require('../lib/crypto-pay-provider');
const router = express.Router();

/** Session cookie signing only — never used as a user password. */
const SESSION_COOKIE = 'km_sid';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 25 * 60 * 1000;
const PASSWORD_MIN_LEN = 8;

function getDbPath() {
	if (process.env.DEX_DB_PATH) {
		return path.resolve(process.env.DEX_DB_PATH);
	}
	return path.resolve(__dirname, '..', 'data', 'doginaldex.sqlite');
}

let dbInstance = null;
let lastDbError = null;
let openingDb = null;

function loadArgon2() {
	return require('argon2');
}

function openNativeDatabase(dbPath) {
	let Database;
	try {
		Database = require('better-sqlite3');
	} catch (err) {
		throw new Error('load better-sqlite3: ' + (err && err.message ? err.message : err));
	}
	const database = new Database(dbPath, { timeout: 8000 });
	database._engine = 'better-sqlite3';
	try {
		database.pragma('journal_mode = WAL');
	} catch (_wal) {
		database.pragma('journal_mode = DELETE');
	}
	return database;
}

function getDb() {
	if (dbInstance) return dbInstance;
	lastDbError = null;
	try {
		const dbPath = getDbPath();
		try {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		} catch (err) {
			throw new Error('data dir: ' + (err && err.message ? err.message : err));
		}
		let database;
		try {
			database = openNativeDatabase(dbPath);
		} catch (err) {
			throw new Error('open: ' + (err && err.message ? err.message : err));
		}
		try {
			initSchema(database);
		} catch (err) {
			try { database.close(); } catch (_e) {}
			throw new Error('schema: ' + (err && err.message ? err.message : err));
		}
		dbInstance = database;
		return dbInstance;
	} catch (err) {
		lastDbError = String(err && err.message ? err.message : err);
		throw err;
	}
}

/** Native addon when it works; sql.js (no compiler) on CloudLinux/shared hosts. */
function openAuthDatabase() {
	if (dbInstance) return Promise.resolve(dbInstance);
	if (openingDb) return openingDb;
	openingDb = (async () => {
		try {
			return getDb();
		} catch (nativeErr) {
			const dbPath = getDbPath();
			try {
				fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			} catch (err) {
				throw new Error('data dir: ' + (err && err.message ? err.message : err));
			}
			let database;
			try {
				const { openSqlJsDatabase } = require('../lib/sqljs-database');
				database = await openSqlJsDatabase(dbPath);
			} catch (sqlErr) {
				lastDbError = 'native: ' + (nativeErr && nativeErr.message ? nativeErr.message : nativeErr)
					+ '; sql.js: ' + (sqlErr && sqlErr.message ? sqlErr.message : sqlErr);
				throw new Error(lastDbError);
			}
			try {
				initSchema(database);
			} catch (err) {
				try { database.close(); } catch (_e) {}
				lastDbError = 'schema: ' + (err && err.message ? err.message : err);
				throw new Error(lastDbError);
			}
			console.warn('[auth-dex] better-sqlite3 unavailable; using sql.js');
			dbInstance = database;
			lastDbError = null;
			return dbInstance;
		}
	})().catch((err) => {
		openingDb = null;
		throw err;
	});
	return openingDb;
}

function initSchema(database) {
	recoverUsersV2IfNeeded(database);
	try {
		database.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			password_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
		CREATE TABLE IF NOT EXISTS password_resets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			token_hash TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_pwreset_expires ON password_resets(expires_at);
		CREATE TABLE IF NOT EXISTS dex_entries (
			user_id INTEGER NOT NULL,
			dog_number INTEGER NOT NULL,
			indexed_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, dog_number),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_dex_user_time ON dex_entries(user_id, indexed_at DESC);
	`);
	} catch (err) {
		console.error('[auth-dex] core schema:', err && err.message ? err.message : err);
		throw err;
	}
	migrateDdSubscriptionSchema(database);
	migrateOauthIdentity(database);
	try {
		require('../lib/tourney-records').ensureSchema(database);
	} catch (err) {
		console.error('[auth-dex] tourney schema:', err && err.message ? err.message : err);
	}
}

/** If a previous nullable-email rebuild left `users_v2` behind, put the data back. */
function recoverUsersV2IfNeeded(database) {
	let names = [];
	try {
		names = database.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'users_v2')`
		).all().map((row) => row.name);
	} catch (_e) {
		return;
	}
	try {
		if (names.includes('users_v2') && !names.includes('users')) {
			database.exec('ALTER TABLE users_v2 RENAME TO users');
			return;
		}
		if (names.includes('users_v2') && names.includes('users')) {
			const count = database.prepare('SELECT COUNT(*) AS n FROM users').get();
			if (Number(count && count.n) === 0) {
				database.exec('DROP TABLE users');
				database.exec('ALTER TABLE users_v2 RENAME TO users');
			}
		}
	} catch (err) {
		console.error('[auth-dex] users_v2 recover:', err && err.message ? err.message : err);
	}
}

/** Better-SQLite ALTER IF NOT EXISTS (SQLite has no ADD COLUMN IF NOT EXISTS). */
function migrateDdSubscriptionSchema(database) {
	const cols = ['stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'subscription_current_period_end'];
	const types = ['TEXT', 'TEXT', 'TEXT', 'INTEGER'];
	for (let i = 0; i < cols.length; i += 1) {
		try {
			database.exec(`ALTER TABLE users ADD COLUMN ${cols[i]} ${types[i]};`);
		} catch (_e) {}
	}
	const paddleCols = ['paddle_customer_id', 'paddle_subscription_id'];
	const paddleTypes = ['TEXT', 'TEXT'];
	for (let i = 0; i < paddleCols.length; i += 1) {
		try {
			database.exec(`ALTER TABLE users ADD COLUMN ${paddleCols[i]} ${paddleTypes[i]};`);
		} catch (_ePc) {}
	}
	try {
	database.exec(`
		CREATE TABLE IF NOT EXISTS stripe_subscriptions_by_email (
			email TEXT PRIMARY KEY COLLATE NOCASE,
			stripe_customer_id TEXT NOT NULL,
			stripe_subscription_id TEXT,
			subscription_status TEXT,
			current_period_end INTEGER,
			updated_at INTEGER NOT NULL
		);
	`);
	database.exec(`
		CREATE TABLE IF NOT EXISTS paddle_subscriptions_by_email (
			email TEXT PRIMARY KEY COLLATE NOCASE,
			paddle_customer_id TEXT NOT NULL,
			paddle_subscription_id TEXT,
			subscription_status TEXT,
			current_period_end INTEGER,
			updated_at INTEGER NOT NULL
		);
	`);
	database.exec(`
		CREATE TABLE IF NOT EXISTS dd_crypto_payments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			provider TEXT NOT NULL DEFAULT 'nowpayments',
			provider_payment_id TEXT UNIQUE,
			order_id TEXT NOT NULL UNIQUE,
			email TEXT NOT NULL COLLATE NOCASE,
			user_id INTEGER,
			plan TEXT NOT NULL,
			status TEXT NOT NULL,
			pay_currency TEXT,
			pay_amount_crypto TEXT,
			pay_address TEXT,
			fiat_usd REAL,
			raw_status TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			completed_at INTEGER,
			entitlement_applied_at INTEGER
		);
	`);
	database.exec(`CREATE INDEX IF NOT EXISTS idx_dd_crypto_email_ent ON dd_crypto_payments(email, entitlement_applied_at);`);
	} catch (err) {
		console.error('[auth-dex] billing schema:', err && err.message ? err.message : err);
	}
}

/**
 * Discord-only accounts cannot leave email/password NULL on the existing users
 * table (those columns are NOT NULL). Do not rebuild that table on a live
 * SQLite file — add columns and use placeholders instead.
 */
function migrateOauthIdentity(database) {
	const extra = [
		['discord_id', 'TEXT'],
		['discord_username', 'TEXT'],
		['avatar_url', 'TEXT'],
		['tourney_handle', 'TEXT'],
	];
	for (const [name, type] of extra) {
		try {
			database.exec(`ALTER TABLE users ADD COLUMN ${name} ${type};`);
		} catch (_e) {}
	}
	try {
		database.exec(`
			CREATE TABLE IF NOT EXISTS oauth_states (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				return_to TEXT NOT NULL
			);
		`);
	} catch (err) {
		console.error('[auth-dex] oauth_states:', err && err.message ? err.message : err);
	}
	try {
		database.exec('CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);');
	} catch (_eSt) {}
	try {
		database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id) WHERE discord_id IS NOT NULL;');
	} catch (_eIdx) {}
	try {
		database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tourney_handle ON users(tourney_handle COLLATE NOCASE) WHERE tourney_handle IS NOT NULL AND tourney_handle != \'\';');
	} catch (_eH) {}
}

function discordPlaceholderEmail(discordId) {
	return `discord-${String(discordId)}@oauth.invalid`;
}

function isPlaceholderEmail(email) {
	return /@oauth\.invalid$/i.test(String(email || ''));
}

function discordOAuthConfigured() {
	return Boolean(String(process.env.DISCORD_CLIENT_ID || '').trim() && String(process.env.DISCORD_CLIENT_SECRET || '').trim());
}

function requestOrigin(req) {
	const xfProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
	const proto = xfProto || (req.secure ? 'https' : 'http');
	const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
	if (!host) return publicSiteOriginForBilling();
	return `${proto}://${host}`;
}

function discordRedirectUri(req) {
	const env = String(process.env.DISCORD_REDIRECT_URI || '').trim();
	if (env) return env;
	return `${requestOrigin(req)}/kmx-auth/discord/callback`;
}

function stripAuthErrorFromReturn(raw) {
	let s = String(raw || '');
	const hashIdx = s.indexOf('#');
	if (hashIdx < 0) {
		return s.replace(/([?&])auth_error=[^&]*/g, '$1').replace(/[?&]$/, '').replace(/\?&/, '?');
	}
	const pathOnly = s.slice(0, hashIdx);
	let hash = s.slice(hashIdx);
	const qIdx = hash.indexOf('?');
	if (qIdx < 0) return s;
	const hashPath = hash.slice(0, qIdx);
	const params = new URLSearchParams(hash.slice(qIdx + 1));
	params.delete('auth_error');
	const qs = params.toString();
	return pathOnly + hashPath + (qs ? `?${qs}` : '');
}

function safeReturnTo(raw) {
	let s = stripAuthErrorFromReturn(String(raw || '/tourney/').trim());
	if (!s.startsWith('/') || s.startsWith('//') || s.includes('://')) return '/tourney/';
	if (s.length > 240) s = s.slice(0, 240);
	return s;
}

function normalizeTourneyHandle(raw) {
	const handle = String(raw || '').trim().replace(/\s+/g, ' ');
	if (handle.length < 2 || handle.length > 24) return '';
	return handle;
}

function suggestTourneyHandle(globalName, username) {
	const cleaned = String(globalName || username || 'Player')
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/[^\w\s.\-]/g, '')
		.slice(0, 24);
	return normalizeTourneyHandle(cleaned) || normalizeTourneyHandle(String(username || 'Player').slice(0, 24)) || 'Player';
}

function defaultDiscordAvatarUrl(discordId, discriminator) {
	const disc = String(discriminator == null ? '0' : discriminator);
	let idx = 0;
	if (disc && disc !== '0') {
		idx = Number(disc) % 5;
	} else {
		try {
			idx = Number((BigInt(String(discordId)) >> 22n) % 6n);
		} catch (_e) {
			idx = 0;
		}
	}
	if (!Number.isFinite(idx) || idx < 0) idx = 0;
	return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function discordAvatarUrl(discordUser) {
	if (!discordUser || !discordUser.id) return '';
	if (discordUser.avatar) {
		const hash = String(discordUser.avatar);
		const ext = hash.startsWith('a_') ? 'gif' : 'png';
		return `https://cdn.discordapp.com/avatars/${discordUser.id}/${hash}.${ext}?size=64`;
	}
	return defaultDiscordAvatarUrl(discordUser.id, discordUser.discriminator);
}

function authUserPayload(row) {
	if (!row) return null;
	const email = String(row.email || '').trim();
	let avatarUrl = String(row.avatar_url || '').trim() || null;
	if (!avatarUrl && row.discord_id) {
		avatarUrl = defaultDiscordAvatarUrl(row.discord_id, '0');
	}
	return {
		id: Number(row.user_id != null ? row.user_id : row.id),
		email: email && !isPlaceholderEmail(email) ? email : null,
		discordId: row.discord_id || null,
		discordUsername: row.discord_username || null,
		tourneyHandle: row.tourney_handle || null,
		avatarUrl,
	};
}

function issueSession(database, res, userId) {
	const sid = newSessionId();
	const exp = Date.now() + SESSION_MAX_AGE_MS;
	database.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sid, userId, exp);
	setSessionCookie(res, sid);
}

function loadUserRow(database, userId) {
	return database.prepare(
		`SELECT id AS user_id, email, discord_id, discord_username, avatar_url, tourney_handle
		 FROM users WHERE id = ?`
	).get(userId);
}

function uniqueHandleOrNull(database, candidate, exceptUserId) {
	let handle = normalizeTourneyHandle(candidate);
	if (!handle) return null;
	const taken = database.prepare(
		'SELECT id FROM users WHERE tourney_handle = ? COLLATE NOCASE AND id != ?'
	).get(handle, exceptUserId || 0);
	if (!taken) return handle;
	for (let i = 0; i < 8; i += 1) {
		const suffix = String(Math.floor(10 + Math.random() * 90));
		const next = normalizeTourneyHandle((handle.slice(0, 21) + suffix));
		if (!next) continue;
		const hit = database.prepare(
			'SELECT id FROM users WHERE tourney_handle = ? COLLATE NOCASE AND id != ?'
		).get(next, exceptUserId || 0);
		if (!hit) return next;
	}
	return null;
}

function fiatMonthlyUsd() {
	const n = Number(process.env.DD_PRICE_MONTH_DISPLAY || 9.99);
	return Number.isFinite(n) ? n : 9.99;
}
function fiatYearlyUsd() {
	const n = Number(process.env.DD_PRICE_YEAR_DISPLAY || 100);
	return Number.isFinite(n) ? n : 100;
}
function plusMonthDays() {
	const n = Number.parseInt(process.env.DD_PLUS_MONTH_DAYS || '30', 10);
	return Number.isFinite(n) && n > 0 ? Math.min(n, 400) : 30;
}
function plusYearDays() {
	const n = Number.parseInt(process.env.DD_PLUS_YEAR_DAYS || '365', 10);
	return Number.isFinite(n) && n > 0 ? Math.min(n, 4000) : 365;
}
function payCurrenciesAllowed() {
	const raw = String(process.env.CRYPTO_PAY_ALLOWED_CURRENCIES || 'btc,eth,sol,doge').trim();
	const list = raw.split(/[\s,;|]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
	return list.length ? list : ['btc', 'eth', 'sol', 'doge'];
}
function cryptoBillingReady() {
	return Boolean(cryptoPay.apiKey() && cryptoPay.ipnSecret());
}

/** Public HTTPS origin for success/cancel URLs (no trailing slash). */
function publicSiteOriginForBilling() {
	const raw = String(process.env.PUBLIC_SITE_URL || process.env.SITE_ORIGIN || process.env.BASE_URL || '').trim();
	if (raw) {
		try {
			const u = new URL(raw.endsWith('/') ? raw.slice(0, -1) : raw);
			return u.origin;
		} catch (_err) {}
	}
	if (process.env.NODE_ENV !== 'production') {
		const port = Number.parseInt(process.env.PORT || '3000', 10);
		return `http://127.0.0.1:${port}`;
	}
	return 'https://kushmedia.xyz';
}

function normalizeSubscriptionStatus(st) {
	return String(st || '').trim().toLowerCase();
}

function normalizeEmail(raw) {
	return String(raw || '').trim().toLowerCase();
}

let complimentaryPlusSetMemo = null;
/** KushMetaX-signed-in emails that receive Plus without crypto payment. Restart server after changing env. */
function complimentaryPlusEmailSet() {
	if (complimentaryPlusSetMemo) {
		return complimentaryPlusSetMemo;
	}
	const raw = String(
		process.env.DD_PLUS_COMPLIMENTARY_EMAILS ||
			process.env.DD_COMPLIMENTARY_PLUS_EMAILS ||
			process.env.DOGIDEX_COMPLIMENTARY_PLUS_EMAILS ||
			process.env.COMPLIMENTARY_DD_PLUS_EMAILS ||
			'',
	).trim();
	const set = new Set();
	raw.split(/[\s,;|]+/).forEach((fragment) => {
		const em = normalizeEmail(fragment);
		if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
			set.add(em);
		}
	});
	complimentaryPlusSetMemo = set;
	return set;
}

function emailHasComplimentaryPlus(emailRaw) {
	const em = normalizeEmail(emailRaw);
	if (!em) {
		return false;
	}
	return complimentaryPlusEmailSet().has(em);
}

/** Active prepaid Plus: period end in the future (crypto or legacy rows). */
function subscriptionRowActive(row) {
	if (!row) {
		return false;
	}
	const end = row.subscription_current_period_end != null ? Number(row.subscription_current_period_end) : null;
	if (end == null || !Number.isFinite(end)) {
		return false;
	}
	return end > Date.now();
}

function userHasActiveDdSubscription(database, userId) {
	const row = database
		.prepare('SELECT email, subscription_status, subscription_current_period_end FROM users WHERE id = ?')
		.get(userId);
	if (!row) {
		return false;
	}
	if (emailHasComplimentaryPlus(row.email)) {
		return true;
	}
	return subscriptionRowActive(row);
}

function subscriptionJsonForUser(database, userId) {
	const row = database
		.prepare(
			`SELECT email, subscription_status, subscription_current_period_end
			 FROM users WHERE id = ?`,
		)
		.get(userId);
	const complimentary = Boolean(row && emailHasComplimentaryPlus(row.email));
	const paidActive = subscriptionRowActive(row);
	const active = complimentary || paidActive;
	let statusDisp = null;
	if (complimentary && !paidActive) {
		statusDisp = 'complimentary';
	} else if (active) {
		statusDisp = 'active';
	} else if (row && row.subscription_current_period_end != null) {
		statusDisp = 'expired';
	} else {
		statusDisp = 'none';
	}
	return {
		active,
		status: statusDisp,
		complimentary,
		currentPeriodEnd:
			row && row.subscription_current_period_end != null ? Number(row.subscription_current_period_end) : null,
		billingConfigured: cryptoBillingReady(),
		paymentProvider: 'nowpayments',
		canRenew: cryptoBillingReady(),
		pricingCopy: {
			monthlyUsd: fiatMonthlyUsd(),
			yearlyUsd: fiatYearlyUsd(),
		},
	};
}

function extendUserPlusFromPlan(database, userId, plan) {
	const isYear = String(plan || '').toLowerCase() === 'year';
	const days = isYear ? plusYearDays() : plusMonthDays();
	const addMs = days * 24 * 60 * 60 * 1000;
	const u = database.prepare('SELECT subscription_current_period_end FROM users WHERE id = ?').get(userId);
	const prev = u && u.subscription_current_period_end != null ? Number(u.subscription_current_period_end) : 0;
	const base = Math.max(Date.now(), Number.isFinite(prev) ? prev : 0);
	const newEnd = base + addMs;
	database
		.prepare(`UPDATE users SET subscription_current_period_end = ?, subscription_status = 'active' WHERE id = ?`)
		.run(newEnd, userId);
}

function applyCryptoLedgerEntitlement(database, ledgerRowId, userId) {
	const row = database.prepare('SELECT * FROM dd_crypto_payments WHERE id = ?').get(ledgerRowId);
	if (!row || row.entitlement_applied_at) {
		return false;
	}
	if (normalizeSubscriptionStatus(row.status) !== 'finished') {
		return false;
	}
	extendUserPlusFromPlan(database, userId, row.plan);
	const now = Date.now();
	database
		.prepare(
			`UPDATE dd_crypto_payments SET entitlement_applied_at = ?, user_id = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?`,
		)
		.run(now, userId, now, now, ledgerRowId);
	return true;
}

function tryApplyFinishedPayment(database, row) {
	if (!row || normalizeSubscriptionStatus(row.status) !== 'finished') {
		return;
	}
	if (row.entitlement_applied_at) {
		return;
	}
	const user = database.prepare('SELECT id FROM users WHERE email = ?').get(row.email);
	if (!user) {
		return;
	}
	applyCryptoLedgerEntitlement(database, row.id, user.id);
}

/**
 * Apply provider GET payment / IPN payload to ledger and extend Plus when finished.
 */
function applyRemotePaymentPayload(database, payload) {
	const pid = payload && payload.payment_id != null ? String(payload.payment_id) : '';
	const orderId = payload && payload.order_id != null ? String(payload.order_id) : '';
	const payStatusRaw = payload && payload.payment_status != null ? String(payload.payment_status) : '';
	const payStatus = normalizeSubscriptionStatus(payStatusRaw);
	if (!pid && !orderId) {
		return null;
	}
	let row = null;
	if (pid) {
		row = database.prepare('SELECT * FROM dd_crypto_payments WHERE provider_payment_id = ?').get(pid);
	}
	if (!row && orderId) {
		row = database.prepare('SELECT * FROM dd_crypto_payments WHERE order_id = ?').get(orderId);
	}
	if (!row) {
		console.warn('[auth-dex] crypto payment: no local row for', pid || orderId);
		return null;
	}
	const now = Date.now();
	let completedAt = row.completed_at;
	if (payStatus === 'finished' && !completedAt) {
		completedAt = now;
	}
	database
		.prepare(
			`UPDATE dd_crypto_payments SET
			 provider_payment_id = COALESCE(?, provider_payment_id),
			 status = ?,
			 raw_status = ?,
			 pay_currency = COALESCE(?, pay_currency),
			 pay_amount_crypto = COALESCE(?, pay_amount_crypto),
			 pay_address = COALESCE(?, pay_address),
			 updated_at = ?,
			 completed_at = COALESCE(?, completed_at)
			 WHERE id = ?`,
		)
		.run(
			pid || null,
			payStatusRaw || row.status,
			payStatusRaw || row.raw_status || '',
			payload.pay_currency != null ? String(payload.pay_currency) : null,
			payload.pay_amount != null ? String(payload.pay_amount) : null,
			payload.pay_address != null ? String(payload.pay_address) : null,
			now,
			completedAt,
			row.id,
		);
	const fresh = database.prepare('SELECT * FROM dd_crypto_payments WHERE id = ?').get(row.id);
	if (payStatus === 'finished') {
		tryApplyFinishedPayment(database, fresh);
	}
	return fresh;
}

function syncPendingCryptoEntitlementsForUser(database, normalizedEmail, userId) {
	const rows = database
		.prepare(
			`SELECT id FROM dd_crypto_payments
			 WHERE email = ? AND LOWER(status) = 'finished' AND entitlement_applied_at IS NULL
			 ORDER BY COALESCE(completed_at, updated_at, created_at) ASC, id ASC`,
		)
		.all(normalizedEmail);
	for (const r of rows) {
		applyCryptoLedgerEntitlement(database, r.id, userId);
	}
}

async function handleCryptoPayIpn(req, res) {
	const secret = cryptoPay.ipnSecret();
	if (!cryptoPay.apiKey() || !secret) {
		console.error('[auth-dex] crypto IPN skipped: CRYPTO_PAY_API_KEY or CRYPTO_PAY_IPN_SECRET unset.');
		return res.status(503).send('Billing not configured');
	}
	const raw = Buffer.isBuffer(req.body)
		? req.body
		: Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');
	const rawUtf8 = raw.toString('utf8');
	const sig = req.headers['x-nowpayments-sig'] || req.headers['X-Nowpayments-Sig'];
	if (!cryptoPay.verifyIpnSignature(rawUtf8, sig, secret)) {
		console.error('[auth-dex] crypto IPN: invalid signature');
		return res.status(400).send('Invalid signature');
	}
	let payload;
	try {
		payload = JSON.parse(rawUtf8);
	} catch (errParse) {
		console.error('[auth-dex] crypto IPN: bad JSON', errParse && errParse.message ? errParse.message : errParse);
		return res.status(400).send('Invalid JSON');
	}
	let db;
	try {
		db = getDb();
	} catch (_e2) {
		return res.status(503).json({ ok: false, error: 'Database unavailable.' });
	}
	try {
		applyRemotePaymentPayload(db, payload);
		return res.json({ ok: true });
	} catch (err2) {
		console.error('[auth-dex] crypto IPN handling:', err2 && err2.message ? err2.message : err2);
		return res.status(500).json({ ok: false, error: 'Webhook handler failed.' });
	}
}

function tierFromUniqueCount(count) {
	const c = Math.max(0, Math.floor(Number(count) || 0));
	if (c >= 10000) return { tier: 6, title: 'Living Dex Legend' };
	if (c >= 5000) return { tier: 5, title: 'Floor Whale' };
	if (c >= 2000) return { tier: 4, title: 'Diamond Kennel' };
	if (c >= 500) return { tier: 3, title: 'Grail Scout' };
	if (c >= 100) return { tier: 2, title: 'Bag Builder' };
	if (c >= 1) return { tier: 1, title: 'Street Mint' };
	return { tier: 0, title: 'Unminted Curator' };
}

function hashResetToken(code, secret) {
	return crypto.createHmac('sha256', secret).update(String(code).trim(), 'utf8').digest('hex');
}

function newSessionId() {
	return crypto.randomBytes(32).toString('hex');
}

function cleanupExpiredSessions(database) {
	const now = Date.now();
	database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
	database.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
}

function getUserForSession(database, signedCookies) {
	const sid = signedCookies && signedCookies[SESSION_COOKIE];
	if (!sid || typeof sid !== 'string') return null;
	cleanupExpiredSessions(database);
	const row = database.prepare(
		`SELECT u.id AS user_id, u.email AS email,
		        u.discord_id AS discord_id, u.discord_username AS discord_username,
		        u.avatar_url AS avatar_url, u.tourney_handle AS tourney_handle
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.id = ? AND s.expires_at > ?`
	).get(sid, Date.now());
	return row || null;
}

function setSessionCookie(res, sessionId) {
	const secure =
		process.env.AUTH_COOKIE_SECURE === '1' ||
		process.env.NODE_ENV === 'production' ||
		process.env.FORCE_SECURE_COOKIES === '1';
	res.cookie(SESSION_COOKIE, sessionId, {
		httpOnly: true,
		signed: true,
		sameSite: 'lax',
		secure,
		maxAge: SESSION_MAX_AGE_MS,
		path: '/',
	});
}

function clearSessionCookie(res) {
	const secure =
		process.env.AUTH_COOKIE_SECURE === '1' ||
		process.env.NODE_ENV === 'production' ||
		process.env.FORCE_SECURE_COOKIES === '1';
	res.clearCookie(SESSION_COOKIE, {
		httpOnly: true,
		signed: true,
		sameSite: 'lax',
		secure,
		path: '/',
	});
}

function dexStatsForUser(database, userId) {
	const row = database.prepare('SELECT COUNT(*) AS n FROM dex_entries WHERE user_id = ?').get(userId);
	const uniqueCount = row && row.n != null ? Number(row.n) : 0;
	const tierInfo = tierFromUniqueCount(uniqueCount);
	return { uniqueCount, tier: tierInfo.tier, rankTitle: tierInfo.title };
}

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 120,
	standardHeaders: true,
	legacyHeaders: false,
});

const strictLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 25,
	standardHeaders: true,
	legacyHeaders: false,
});

function authReady(req, res, next) {
	if (!cookieSecret()) {
		res.status(503).json({ error: 'Authentication is not configured. Set SESSION_SECRET (16+ chars).' });
		return;
	}
	Promise.resolve(openAuthDatabase()).then((db) => {
		req._authDb = db;
		next();
	}).catch((err) => {
		console.error('[auth-dex] SQLite:', err && err.message ? err.message : err);
		if (String(req.path || '').includes('discord')) {
			discordAuthErrorRedirect(req, res, 'Could not open the login database. Restart Node after uploading the latest server files.');
			return;
		}
		res.status(503).json({ error: 'Authentication database unavailable.' });
	});
}

/**
 * Public probe: avoids clients hitting /me (503) on every page load when auth is misconfigured.
 */
async function authBackendProbe() {
	const sessionConfigured = Boolean(cookieSecret());
	const dbPath = getDbPath();
	const extra = {
		discordOAuth: discordOAuthConfigured(),
		dbFile: path.basename(dbPath),
		dbFileExists: false,
		engine: null,
	};
	try {
		extra.dbFileExists = fs.existsSync(dbPath);
	} catch (_e) {}
	try {
		const db = await openAuthDatabase();
		extra.engine = db && db._engine ? db._engine : 'better-sqlite3';
		return { sessionConfigured, dbOk: true, dbError: null, ...extra };
	} catch (err) {
		return {
			sessionConfigured,
			dbOk: false,
			dbError: String(err && err.message ? err.message : err).slice(0, 400),
			...extra,
		};
	}
}

router.use(apiLimiter);

router.get('/status', async (req, res) => {
	const p = await authBackendProbe();
	res.json({ ok: true, discordOAuth: discordOAuthConfigured(), ...p });
});

router.post('/logout', (req, res) => {
	try {
		const db = getDb();
		const sid = req.signedCookies && req.signedCookies[SESSION_COOKIE];
		if (sid) {
			db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
		}
	} catch (_e) {}
	clearSessionCookie(res);
	res.json({ ok: true });
});

router.use(authReady);

function discordAuthErrorRedirect(req, res, message) {
	const dest = safeReturnTo(req.query && req.query.return);
	const hashIdx = dest.indexOf('#');
	const pathOnly = hashIdx >= 0 ? dest.slice(0, hashIdx) : dest;
	const hash = hashIdx >= 0 ? dest.slice(hashIdx) : '#/';
	const joiner = hash.includes('?') ? '&' : '?';
	res.redirect(`${pathOnly || '/tourney/'}${hash}${joiner}auth_error=${encodeURIComponent(message)}`);
}

function upsertDiscordUser(database, discordUser) {
	const discordId = String(discordUser.id);
	const username = String(discordUser.global_name || discordUser.username || '').slice(0, 80);
	const avatarUrl = discordAvatarUrl(discordUser).slice(0, 240);
	const verifiedEmail = discordUser.verified && discordUser.email
		? normalizeEmail(discordUser.email)
		: '';

	const byDiscord = database.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordId);
	if (byDiscord) {
		database.prepare(
			`UPDATE users SET discord_username = ?, avatar_url = ?
			 WHERE id = ?`
		).run(username, avatarUrl, byDiscord.id);
		if (verifiedEmail) {
			const taken = database.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(verifiedEmail, byDiscord.id);
			if (!taken) {
				database.prepare('UPDATE users SET email = COALESCE(email, ?) WHERE id = ?').run(verifiedEmail, byDiscord.id);
			}
		}
		return Number(byDiscord.id);
	}

	if (verifiedEmail) {
		const byEmail = database.prepare('SELECT id, discord_id FROM users WHERE email = ?').get(verifiedEmail);
		if (byEmail && !byEmail.discord_id) {
			database.prepare(
				`UPDATE users SET discord_id = ?, discord_username = ?, avatar_url = ?
				 WHERE id = ?`
			).run(discordId, username, avatarUrl, byEmail.id);
			return Number(byEmail.id);
		}
	}

	const suggested = uniqueHandleOrNull(database, suggestTourneyHandle(discordUser.global_name, discordUser.username), 0);
	const emailTaken = verifiedEmail
		? database.prepare('SELECT id FROM users WHERE email = ?').get(verifiedEmail)
		: null;
	const email = (!emailTaken && verifiedEmail) ? verifiedEmail : discordPlaceholderEmail(discordId);
	const info = database.prepare(
		`INSERT INTO users (email, password_hash, created_at, discord_id, discord_username, avatar_url, tourney_handle)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(email, 'oauth:discord', Date.now(), discordId, username, avatarUrl, suggested);
	return Number(info.lastInsertRowid);
}

router.get('/discord/start', strictLimiter, (req, res) => {
	if (!discordOAuthConfigured()) {
		discordAuthErrorRedirect(req, res, 'Discord login is not configured on this server.');
		return;
	}
	const db = req._authDb;
	db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 10 * 60 * 1000);
	const state = crypto.randomBytes(24).toString('hex');
	const returnTo = safeReturnTo(req.query && req.query.return);
	db.prepare('INSERT INTO oauth_states (id, created_at, return_to) VALUES (?, ?, ?)').run(state, Date.now(), returnTo);
	const params = new URLSearchParams({
		client_id: String(process.env.DISCORD_CLIENT_ID).trim(),
		redirect_uri: discordRedirectUri(req),
		response_type: 'code',
		scope: 'identify email',
		state,
	});
	res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/discord/callback', strictLimiter, async (req, res) => {
	const db = req._authDb;
	const errCode = String(req.query.error || '').trim();
	const state = String(req.query.state || '').trim();
	const code = String(req.query.code || '').trim();
	const row = state ? db.prepare('SELECT id, return_to, created_at FROM oauth_states WHERE id = ?').get(state) : null;
	if (row) db.prepare('DELETE FROM oauth_states WHERE id = ?').run(state);
	const returnTo = row ? row.return_to : '/tourney/';
	req.query.return = returnTo;
	if (errCode) {
		discordAuthErrorRedirect(req, res, 'Discord sign-in was cancelled.');
		return;
	}
	if (!row || row.created_at < Date.now() - 10 * 60 * 1000 || !code) {
		discordAuthErrorRedirect(req, res, 'Discord sign-in expired. Try again.');
		return;
	}
	if (!discordOAuthConfigured()) {
		discordAuthErrorRedirect(req, res, 'Discord login is not configured on this server.');
		return;
	}
	let discordUser;
	try {
		const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: String(process.env.DISCORD_CLIENT_ID).trim(),
				client_secret: String(process.env.DISCORD_CLIENT_SECRET).trim(),
				grant_type: 'authorization_code',
				code,
				redirect_uri: discordRedirectUri(req),
			}),
		});
		const tokenJson = await tokenRes.json().catch(() => ({}));
		if (!tokenRes.ok || !tokenJson.access_token) {
			throw new Error((tokenJson && tokenJson.error_description) || 'token exchange failed');
		}
		const userRes = await fetch('https://discord.com/api/users/@me', {
			headers: { Authorization: `Bearer ${tokenJson.access_token}` },
		});
		discordUser = await userRes.json().catch(() => ({}));
		if (!userRes.ok || !discordUser.id) {
			throw new Error('could not read Discord profile');
		}
	} catch (err) {
		console.error('[auth-dex] discord oauth:', err && err.message ? err.message : err);
		discordAuthErrorRedirect(req, res, 'Discord sign-in failed. Try again.');
		return;
	}
	let userId;
	try {
		userId = upsertDiscordUser(db, discordUser);
	} catch (err) {
		console.error('[auth-dex] discord upsert:', err && err.message ? err.message : err);
		discordAuthErrorRedirect(req, res, 'Could not create your account.');
		return;
	}
	issueSession(db, res, userId);
	const dest = safeReturnTo(returnTo);
	res.redirect(dest);
});

router.post('/me/handle', strictLimiter, (req, res) => {
	const db = req._authDb;
	const sess = getUserForSession(db, req.signedCookies);
	if (!sess) {
		res.status(401).json({ error: 'Not authenticated.' });
		return;
	}
	const handle = normalizeTourneyHandle(req.body && req.body.handle);
	if (!handle) {
		res.status(400).json({ error: 'Handle must be 2–24 characters.' });
		return;
	}
	const taken = db.prepare(
		'SELECT id FROM users WHERE tourney_handle = ? COLLATE NOCASE AND id != ?'
	).get(handle, sess.user_id);
	if (taken) {
		res.status(409).json({ error: 'That handle is already taken.' });
		return;
	}
	try {
		db.prepare('UPDATE users SET tourney_handle = ? WHERE id = ?').run(handle, sess.user_id);
	} catch (_err) {
		res.status(409).json({ error: 'That handle is already taken.' });
		return;
	}
	const user = loadUserRow(db, sess.user_id);
	res.json({ ok: true, user: authUserPayload(user) });
});

/** Passwords stored as Argon2id hashes only (no plaintext). Dex entries remain per user_id for subscription / paywall hooks later. */

/**
 * Open registration by default. Set AUTH_ALLOW_REGISTRATION=0 (or false/off/no) to disable signups.
 */
function registrationAllowed() {
	const v = String(process.env.AUTH_ALLOW_REGISTRATION ?? '').trim().toLowerCase();
	if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
		return false;
	}
	return true;
}

router.post('/register', strictLimiter, async (req, res) => {
	if (!registrationAllowed()) {
		res.status(403).json({ error: 'Registration is disabled.' });
		return;
	}
	const db = req._authDb;
	const email = normalizeEmail(req.body && req.body.email);
	const password = String((req.body && req.body.password) || '');
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		res.status(400).json({ error: 'Valid email is required.' });
		return;
	}
	if (password.length < PASSWORD_MIN_LEN) {
		res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LEN} characters.` });
		return;
	}
	const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
	if (existing) {
		res.status(409).json({ error: 'An account with this email already exists.' });
		return;
	}
	let argon2;
	try {
		argon2 = loadArgon2();
	} catch (_err) {
		res.status(500).json({ error: 'Password accounts are unavailable on this server. Use Discord sign-in.' });
		return;
	}
	let hash;
	try {
		hash = await argon2.hash(password, { type: argon2.argon2id });
	} catch (_err) {
		res.status(500).json({ error: 'Registration failed.' });
		return;
	}
	const createdAt = Date.now();
	let userId;
	try {
		const info = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)').run(
			email,
			`argon2id:${hash}`,
			createdAt
		);
		userId = info.lastInsertRowid;
	} catch (_err) {
		res.status(500).json({ error: 'Registration failed.' });
		return;
	}
	issueSession(db, res, userId);
	syncPendingCryptoEntitlementsForUser(db, email, Number(userId));
	const dex = dexStatsForUser(db, userId);
	const subscription = subscriptionJsonForUser(db, userId);
	res.status(201).json({
		ok: true,
		user: authUserPayload(loadUserRow(db, userId)),
		dex,
		subscription,
	});
});

router.post('/login', strictLimiter, async (req, res) => {
	const db = req._authDb;
	const email = normalizeEmail(req.body && req.body.email);
	const password = String((req.body && req.body.password) || '');
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		res.status(400).json({ error: 'Valid email is required.' });
		return;
	}
	if (password.length === 0) {
		res.status(400).json({ error: 'Password is required.' });
		return;
	}
	const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
	if (!row) {
		res.status(401).json({ error: 'Invalid email or password.' });
		return;
	}
	const stored = String(row.password_hash || '');
	let valid = false;
	if (stored.startsWith('argon2id:')) {
		try {
			const argon2 = loadArgon2();
			valid = await argon2.verify(stored.slice('argon2id:'.length), password);
		} catch (_err) {
			valid = false;
		}
	} else if (!stored || stored.startsWith('oauth:')) {
		res.status(401).json({ error: 'This account uses Discord sign-in.' });
		return;
	}
	if (!valid) {
		res.status(401).json({ error: 'Invalid email or password.' });
		return;
	}
	issueSession(db, res, row.id);
	syncPendingCryptoEntitlementsForUser(db, email, Number(row.id));
	const dex = dexStatsForUser(db, row.id);
	const subscription = subscriptionJsonForUser(db, row.id);
	res.json({
		ok: true,
		user: authUserPayload(loadUserRow(db, row.id)),
		dex,
		subscription,
	});
});

/**
 * Establish KushMetaX session cookie from a live Supabase access token (email must match SQLite users.email).
 * Used when DogiDex auth is Supabase-only in the UI but evaluator paywall + complimentary Plus read SQLite cookies.
 */
router.post('/bridge-supabase-token', strictLimiter, async (req, res) => {
	const accessToken = String((req.body && req.body.accessToken) || '').trim();
	const supaUrl = String(process.env.DOGIDEX_SUPABASE_URL || process.env.SUPABASE_URL || '')
		.trim()
		.replace(/\/+$/, '');
	const supaAnon = String(process.env.DOGIDEX_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
	if (!accessToken) {
		res.status(400).json({ error: 'Missing accessToken.' });
		return;
	}
	if (!supaUrl || !supaAnon) {
		res.status(503).json({
			error: 'Server is missing DOGIDEX_SUPABASE_URL and DOGIDEX_SUPABASE_ANON_KEY (mirror your evaluator Supabase settings).',
		});
		return;
	}
	let ures;
	try {
		ures = await fetch(`${supaUrl}/auth/v1/user`, {
			headers: {
				apikey: supaAnon,
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json',
			},
		});
	} catch (errNet) {
		console.error('[auth-dex] bridge-supabase fetch:', errNet && errNet.message ? errNet.message : errNet);
		res.status(502).json({ error: 'Could not reach Supabase.' });
		return;
	}
	if (!ures.ok) {
		res.status(401).json({ error: 'Invalid or expired Supabase session.' });
		return;
	}
	let uj;
	try {
		uj = await ures.json();
	} catch (_eJ) {
		res.status(401).json({ error: 'Invalid Supabase response.' });
		return;
	}
	const email = normalizeEmail(uj && uj.email);
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		res.status(400).json({ error: 'Supabase user has no email.' });
		return;
	}
	const db = req._authDb;
	const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
	if (!row) {
		res.status(404).json({
			error: 'no_kush_account',
			message:
				'No KushMetaX site account (SQLite) exists for this email. Register once with the same email on the host that runs /kmx-auth (or legacy /api/auth), or deploy without Supabase-only auth.',
		});
		return;
	}
	const sid = newSessionId();
	const exp = Date.now() + SESSION_MAX_AGE_MS;
	db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sid, row.id, exp);
	setSessionCookie(res, sid);
	syncPendingCryptoEntitlementsForUser(db, email, Number(row.id));
	const dex = dexStatsForUser(db, row.id);
	const subscription = subscriptionJsonForUser(db, row.id);
	res.json({
		ok: true,
		user: { id: row.id, email },
		dex,
		subscription,
	});
});

router.get('/me', (req, res) => {
	const db = req._authDb;
	const user = getUserForSession(db, req.signedCookies);
	if (!user) {
		res.status(401).json({ error: 'Not authenticated.' });
		return;
	}
	if (user.email) syncPendingCryptoEntitlementsForUser(db, normalizeEmail(user.email), user.user_id);
	const dex = dexStatsForUser(db, user.user_id);
	const subscription = subscriptionJsonForUser(db, user.user_id);
	res.json({
		ok: true,
		user: authUserPayload(user),
		dex,
		subscription,
	});
});

/**
 * Crypto prepay (NOWPayments-style) for Doginal Dogs Plus.
 */
router.get('/billing/pricing', (req, res) => {
	res.json({
		ok: true,
		currency: 'usd',
		monthlyUsd: fiatMonthlyUsd(),
		yearlyUsd: fiatYearlyUsd(),
		billingConfigured: cryptoBillingReady(),
		payCurrencies: payCurrenciesAllowed(),
		paymentProvider: 'nowpayments',
	});
});

router.post('/billing/create-checkout-session', strictLimiter, async (req, res) => {
	if (!cryptoBillingReady()) {
		res.status(503).json({
			error: 'Crypto billing is not configured (set CRYPTO_PAY_API_KEY and CRYPTO_PAY_IPN_SECRET).',
		});
		return;
	}
	const plan = String((req.body && req.body.plan) || 'month').toLowerCase() === 'year' ? 'year' : 'month';
	let payCurrency = String((req.body && req.body.payCurrency) || 'btc').trim().toLowerCase();
	const allowed = payCurrenciesAllowed();
	if (!allowed.includes(payCurrency)) {
		res.status(400).json({ error: 'Unsupported cryptocurrency. Choose one of: ' + allowed.join(', ') });
		return;
	}
	const priceUsd = plan === 'year' ? fiatYearlyUsd() : fiatMonthlyUsd();
	const origin = publicSiteOriginForBilling();
	const db = req._authDb;
	const sessUser = getUserForSession(db, req.signedCookies);
	let email = '';
	let userId = null;
	if (sessUser) {
		const row = db.prepare('SELECT email FROM users WHERE id = ?').get(sessUser.user_id);
		email = row && row.email ? normalizeEmail(row.email) : '';
		userId = sessUser.user_id;
	} else {
		email = normalizeEmail(req.body && req.body.email);
	}
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		res.status(400).json({ error: 'Enter a valid email, or sign in first.' });
		return;
	}
	const orderId = `ddp_${crypto.randomBytes(16).toString('hex')}`;
	const successUrl = `${origin}/dd-evaluator?orderId=${encodeURIComponent(orderId)}`;
	const cancelUrl = `${origin}/dd-evaluator`;
	const ipnUrl = `${origin}/api/webhooks/crypto-payments`;
	const now = Date.now();
	try {
		db.prepare(
			`INSERT INTO dd_crypto_payments (
				provider, order_id, email, user_id, plan, status, fiat_usd, created_at, updated_at
			) VALUES ('nowpayments', ?, ?, ?, ?, 'new', ?, ?, ?)`,
		).run(orderId, email, userId, plan, priceUsd, now, now);
	} catch (insErr) {
		console.error('[auth-dex] crypto insert order:', insErr && insErr.message ? insErr.message : insErr);
		res.status(500).json({ error: 'Could not start payment.' });
		return;
	}
	let npRes;
	try {
		npRes = await cryptoPay.createPayment({
			priceUsd,
			payCurrency,
			orderId,
			orderDescription: `KushMetaX Plus ${plan} (${email})`,
			ipnCallbackUrl: ipnUrl,
			successUrl,
			cancelUrl,
		});
	} catch (err) {
		db.prepare('DELETE FROM dd_crypto_payments WHERE order_id = ?').run(orderId);
		console.error('[auth-dex] crypto create payment:', err && err.message ? err.message : err);
		res.status(502).json({ error: 'Payment provider unavailable. Try again shortly.' });
		return;
	}
	const pid = npRes && npRes.payment_id != null ? String(npRes.payment_id) : null;
	const pstat = npRes && npRes.payment_status != null ? String(npRes.payment_status) : 'waiting';
	try {
		db.prepare(
			`UPDATE dd_crypto_payments SET
				provider_payment_id = ?,
				pay_address = ?,
				pay_amount_crypto = ?,
				pay_currency = ?,
				status = ?,
				raw_status = ?,
				updated_at = ?
			WHERE order_id = ?`,
		).run(
			pid,
			npRes.pay_address != null ? String(npRes.pay_address) : null,
			npRes.pay_amount != null ? String(npRes.pay_amount) : null,
			npRes.pay_currency != null ? String(npRes.pay_currency) : payCurrency,
			pstat,
			pstat,
			Date.now(),
			orderId,
		);
	} catch (upErr) {
		console.error('[auth-dex] crypto update order:', upErr && upErr.message ? upErr.message : upErr);
	}
	if (!pid || !npRes.pay_address) {
		res.status(500).json({ error: 'Could not create payment (missing address).' });
		return;
	}
	res.json({
		ok: true,
		orderId,
		paymentId: pid,
		payAddress: String(npRes.pay_address),
		payAmount: npRes.pay_amount != null ? String(npRes.pay_amount) : '',
		payCurrency: npRes.pay_currency != null ? String(npRes.pay_currency) : payCurrency,
		paymentStatus: pstat,
	});
});

router.post('/billing/refresh-crypto-payment', strictLimiter, async (req, res) => {
	if (!cryptoPay.apiKey()) {
		res.status(503).json({ error: 'Billing is not configured.' });
		return;
	}
	const paymentId = String((req.body && req.body.paymentId) || '').trim();
	const orderId = String((req.body && req.body.orderId) || '').trim();
	let db;
	try {
		db = getDb();
	} catch (_e3) {
		res.status(503).json({ error: 'Database unavailable.' });
		return;
	}
	let remote;
	try {
		if (paymentId) {
			remote = await cryptoPay.getPaymentStatus(paymentId);
		} else if (orderId) {
			const local = db.prepare('SELECT provider_payment_id FROM dd_crypto_payments WHERE order_id = ?').get(orderId);
			if (!local || !local.provider_payment_id) {
				res.json({ ok: true, pending: true, message: 'Payment not registered with provider yet.' });
				return;
			}
			remote = await cryptoPay.getPaymentStatus(String(local.provider_payment_id));
		} else {
			res.status(400).json({ error: 'Provide paymentId or orderId.' });
			return;
		}
	} catch (err3) {
		console.error('[auth-dex] refresh crypto:', err3 && err3.message ? err3.message : err3);
		res.status(502).json({ error: 'Could not reach payment provider.' });
		return;
	}
	applyRemotePaymentPayload(db, remote);
	const sessUser = getUserForSession(db, req.signedCookies);
	if (sessUser) {
		syncPendingCryptoEntitlementsForUser(db, normalizeEmail(sessUser.email), sessUser.user_id);
	}
	const st = remote && remote.payment_status != null ? String(remote.payment_status) : '';
	res.json({
		ok: true,
		paymentStatus: st,
		finished: normalizeSubscriptionStatus(st) === 'finished',
	});
});

/** DogiDex sync: any authenticated KushMetaX account (Plus not required). */
function requireDdDexSession(req, res, next) {
	const db = req._authDb;
	const user = getUserForSession(db, req.signedCookies);
	if (!user) {
		res.status(401).json({ error: 'Not authenticated.', code: 'auth_required' });
		return;
	}
	next();
}

async function sendResetEmail(toAddress, code) {
	const host = process.env.SMTP_HOST;
	const port = process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 587;
	const user = process.env.SMTP_USER || '';
	const pass = process.env.SMTP_PASS || '';
	const from = process.env.SMTP_FROM || process.env.AUTH_MAIL_FROM || user;
	if (!host || !from) {
		return false;
	}
	const secure =
		String(process.env.SMTP_SECURE || '').trim() === '1' ||
		String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
	const transporter = nodemailer.createTransport({
		host,
		port,
		secure,
		auth: user ? { user, pass } : undefined,
	});
	const subject = 'Your KushMetaX reset code';
	const text =
		`Your KushMetaX password reset code is: ${code}\n\n` +
		`This code expires in about ${Math.round(RESET_TTL_MS / 60000)} minutes.\n` +
		`If you did not request this, you can ignore this email.\n`;
	await transporter.sendMail({ from, to: toAddress, subject, text });
	return true;
}

router.post('/forgot-password', strictLimiter, async (req, res) => {
	const db = req._authDb;
	const secret = cookieSecret();
	const email = normalizeEmail(req.body && req.body.email);
	try {
		if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
			if (row) {
				const code = crypto.randomBytes(5).toString('hex').slice(0, 10);
				const tokenHash = hashResetToken(code, secret);
				const exp = Date.now() + RESET_TTL_MS;
				db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.id);
				db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
					row.id,
					tokenHash,
					exp
				);
				await sendResetEmail(email, code);
			}
		}
	} catch (err) {
		console.error('[auth-dex] forgot-password mail:', err && err.message ? err.message : err);
	}
	res.json({ ok: true });
});

router.post('/reset-password', strictLimiter, async (req, res) => {
	const db = req._authDb;
	const secret = cookieSecret();
	const email = normalizeEmail(req.body && req.body.email);
	const code = String((req.body && req.body.code) || '').trim();
	const newPassword = String((req.body && req.body.password) || '');
	if (!email || !code || newPassword.length < PASSWORD_MIN_LEN) {
		res.status(400).json({
			error: `Valid email, reset code, and new password (${PASSWORD_MIN_LEN}+ chars) are required.`,
		});
		return;
	}
	const tokenHash = hashResetToken(code, secret);
	const row = db
		.prepare(
			`SELECT pr.id AS reset_id, pr.user_id AS user_id
			 FROM password_resets pr
			 JOIN users u ON u.id = pr.user_id
			 WHERE u.email = ? AND pr.token_hash = ? AND pr.expires_at > ?`
		)
		.get(email, tokenHash, Date.now());
	if (!row) {
		res.status(400).json({ error: 'Invalid or expired reset code.' });
		return;
	}
	let argon2;
	try {
		argon2 = loadArgon2();
	} catch (_err) {
		res.status(500).json({ error: 'Password reset is unavailable on this server. Use Discord sign-in.' });
		return;
	}
	let hash;
	try {
		hash = await argon2.hash(newPassword, { type: argon2.argon2id });
	} catch (_err) {
		res.status(500).json({ error: 'Could not reset password.' });
		return;
	}
	const update = db.transaction(() => {
		db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`argon2id:${hash}`, row.user_id);
		db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
		db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
	});
	update();
	clearSessionCookie(res);
	res.json({ ok: true });
});

router.post('/dex/index', strictLimiter, requireDdDexSession, (req, res) => {
	const db = req._authDb;
	const user = getUserForSession(db, req.signedCookies);
	if (!user) {
		res.status(401).json({ error: 'Not authenticated.' });
		return;
	}
	const raw = req.body && req.body.dogNumber;
	const n = Math.floor(Number(raw));
	if (!Number.isFinite(n) || n < 1 || n > 10000) {
		res.status(400).json({ error: 'dogNumber must be between 1 and 10000.' });
		return;
	}
	const now = Date.now();
	db.prepare(
		`INSERT INTO dex_entries (user_id, dog_number, indexed_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, dog_number) DO NOTHING`
	).run(user.user_id, n, now);
	const dex = dexStatsForUser(db, user.user_id);
	res.json({
		ok: true,
		dogNumber: n,
		uniqueCount: dex.uniqueCount,
		tier: dex.tier,
		rankTitle: dex.rankTitle,
	});
});

router.get('/dex', requireDdDexSession, (req, res) => {
	const db = req._authDb;
	const user = getUserForSession(db, req.signedCookies);
	if (!user) {
		res.status(401).json({ error: 'Not authenticated.' });
		return;
	}
	const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 48)));
	const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
	const offset = (page - 1) * limit;

	const totalRow = db.prepare('SELECT COUNT(*) AS n FROM dex_entries WHERE user_id = ?').get(user.user_id);
	const total = totalRow && totalRow.n != null ? Number(totalRow.n) : 0;

	const rows = db
		.prepare(
			`SELECT dog_number, indexed_at FROM dex_entries
			 WHERE user_id = ?
			 ORDER BY indexed_at DESC
			 LIMIT ? OFFSET ?`
		)
		.all(user.user_id, limit, offset);

	const dex = dexStatsForUser(db, user.user_id);
	res.json({
		ok: true,
		page,
		limit,
		total,
		totalPages: total === 0 ? 0 : Math.ceil(total / limit),
		dex,
		entries: rows.map((r) => ({
			dogNumber: r.dog_number,
			indexedAt: r.indexed_at,
		})),
	});
});

openAuthDatabase().catch((err) => {
	console.error('[auth-dex] database:', err && err.message ? err.message : err);
});

module.exports = router;
module.exports.openAuthDatabase = openAuthDatabase;
module.exports.tierFromUniqueCount = tierFromUniqueCount;
module.exports.handleCryptoPayIpn = handleCryptoPayIpn;
module.exports.tryGetDdDatabaseForPaywall = function tryGetDdDatabaseForPaywall() {
	if (dbInstance) return dbInstance;
	try {
		return getDb();
	} catch (err) {
		lastDbError = String(err && err.message ? err.message : err);
		if (!openingDb) {
			console.error('[auth-dex] SQLite:', lastDbError);
		}
		return null;
	}
};
module.exports.lastDdDatabaseError = function lastDdDatabaseError() {
	return lastDbError;
};
module.exports.ddSessionRow = getUserForSession;
module.exports.userHasDdPlus = userHasActiveDdSubscription;
module.exports.discordOAuthConfigured = discordOAuthConfigured;
module.exports.getTourneySession = function getTourneySession(signedCookies) {
	try {
		return getUserForSession(getDb(), signedCookies);
	} catch (_e) {
		return null;
	}
};
module.exports.normalizeTourneyHandle = normalizeTourneyHandle;
