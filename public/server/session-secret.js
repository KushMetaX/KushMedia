'use strict';

const fs = require('fs');
const path = require('path');

const serverDataDir = path.resolve(__dirname, 'data');

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

/**
 * Secret for cookie-parser signed cookies + auth routes (must match everywhere).
 * Resolution order:
 * 1. SESSION_SECRET env (16+ chars after trim)
 * 2. SESSION_SECRET_FILE path if set, else server/data/.session-secret (single line)
 * 3. Production: null (caller returns 503). Non-production: fixed dev string.
 */
function resolveSessionSecret() {
	const direct = String(process.env.SESSION_SECRET || '').trim();
	if (direct.length >= 16) {
		return direct;
	}

	const filePath = process.env.SESSION_SECRET_FILE
		? path.resolve(process.env.SESSION_SECRET_FILE)
		: path.join(serverDataDir, '.session-secret');
	const fromFile = readTrimmedSecretFromFile(filePath);
	if (fromFile && fromFile.length >= 16) {
		return fromFile;
	}

	if (process.env.NODE_ENV === 'production') {
		return null;
	}
	return 'local-dev-session-secret-min-16chars';
}

module.exports = {
	resolveSessionSecret,
};
