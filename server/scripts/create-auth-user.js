#!/usr/bin/env node
'use strict';

/**
 * CLI bootstrap (optional): create a user with an Argon2 password hash directly.
 * Public signup via POST /kmx-auth/register (or legacy /api/auth/register) by default; use this for scripting or when registration is disabled.
 *
 *   node server/scripts/create-auth-user.js your@email.com "your-long-password"
 *
 * Uses DEX_DB_PATH if set; else server/data/doginaldex.sqlite next to this repo layout.
 */

const path = require('path');
const argon2 = require('argon2');
const Database = require('better-sqlite3');

const INIT_SQL = `
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
`;

function getDbPath() {
	if (process.env.DEX_DB_PATH) {
		return path.resolve(process.env.DEX_DB_PATH);
	}
	return path.resolve(__dirname, '..', 'data', 'doginaldex.sqlite');
}

const PASSWORD_MIN = 8;

async function main() {
	const emailRaw = process.argv[2];
	const password = process.argv[3];
	const email = String(emailRaw || '').trim().toLowerCase();

	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		console.error('Usage: node server/scripts/create-auth-user.js <email> <password>');
		process.exit(1);
	}
	if (!password || String(password).length < PASSWORD_MIN) {
		console.error(`Password must be at least ${PASSWORD_MIN} characters.`);
		process.exit(1);
	}

	const dbPath = getDbPath();
	const hash = await argon2.hash(String(password), { type: argon2.argon2id });

	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.exec(INIT_SQL);

	const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
	if (existing) {
		console.error('User already exists:', email);
		process.exit(1);
	}

	db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)').run(
		email,
		`argon2id:${hash}`,
		Date.now()
	);
	console.log('Created user:', email);
	console.log('Database:', dbPath);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
