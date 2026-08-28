'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const serverDataDir = path.resolve(__dirname, 'data');
let cachedSecret = undefined;

function readTrimmedSecretFromFile(filePath) {
	try {
		if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return null;
		}
		const raw = fs.readFileSync(filePath, 'utf8');
		return raw ? String(raw).trim() : null;
	} catch (_err) {
		return null;
	}
}

function persistSecret(filePath) {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const existing = readTrimmedSecretFromFile(filePath);
		if (existing && existing.length >= 16) {
			return existing;
		}
		const generated = crypto.randomBytes(32).toString('hex');
		fs.writeFileSync(filePath, generated + '\n', { encoding: 'utf8', mode: 0o600 });
		console.log('[session-secret] wrote ' + filePath);
		return generated;
	} catch (err) {
		console.error('[session-secret] could not persist file:', err && err.message ? err.message : err);
		return null;
	}
}

/**
 * Secret for cookie-parser signed cookies + auth routes (must match everywhere).
 * Resolution order:
 * 1. SESSION_SECRET env (16+ chars after trim)
 * 2. SESSION_SECRET_FILE path if set, else server/data/.session-secret (single line)
 * 3. Create that file with a random value so production cookies still work
 * 4. Non-production fallback string if the file cannot be written
 */
function resolveSessionSecret() {
	if (cachedSecret !== undefined) {
		return cachedSecret;
	}

	const direct = String(process.env.SESSION_SECRET || '').trim();
	if (direct.length >= 16) {
		cachedSecret = direct;
		return cachedSecret;
	}

	const filePath = process.env.SESSION_SECRET_FILE
		? path.resolve(process.env.SESSION_SECRET_FILE)
		: path.join(serverDataDir, '.session-secret');
	const fromFile = readTrimmedSecretFromFile(filePath);
	if (fromFile && fromFile.length >= 16) {
		cachedSecret = fromFile;
		return cachedSecret;
	}

	const persisted = persistSecret(filePath);
	if (persisted && persisted.length >= 16) {
		cachedSecret = persisted;
		return cachedSecret;
	}

	if (process.env.NODE_ENV === 'production') {
		cachedSecret = null;
		return cachedSecret;
	}
	cachedSecret = 'local-dev-session-secret-min-16chars';
	return cachedSecret;
}

module.exports = {
	resolveSessionSecret,
};
