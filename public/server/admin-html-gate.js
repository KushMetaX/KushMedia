'use strict';

const path = require('path');
const rateLimit = require('express-rate-limit');
const { timingSafeEqualString } = require('./security-utils');

const RESERVED_ADMIN_PATHS = new Set([
	'/admin',
	'/admin.html',
	'/__admin_gate',
	'/login',
	'/map',
	'/ddl',
	'/tourney',
	'/dd-evaluator',
	'/api',
	'/server',
	'/healthz',
	'/ping',
	'/internal',
	'/gotchi',
	'/nail-designer',
]);

function resolveAdminPath() {
	const raw = String(process.env.ADMIN_PATH || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const normalized = withSlash.replace(/\/+$/, '');
	if (!/^\/[A-Za-z0-9][A-Za-z0-9._~-]{7,63}$/.test(normalized)) return '';
	if (RESERVED_ADMIN_PATHS.has(normalized.toLowerCase())) return '';
	return normalized;
}

function resolveAdminUser() {
	return String(process.env.ADMIN_USER || '').trim();
}

function resolveAdminPass(resolveLegacyPassword) {
	const direct = String(process.env.ADMIN_PASS || '').trim();
	if (direct) return direct;
	if (typeof resolveLegacyPassword === 'function') {
		return String(resolveLegacyPassword() || '').trim();
	}
	return '';
}

function adminHtmlConfigured(resolveLegacyPassword) {
	return Boolean(resolveAdminPath() && resolveAdminUser() && resolveAdminPass(resolveLegacyPassword));
}

function decodeBasicCredentials(authHeader) {
	if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) {
		return null;
	}
	try {
		const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
		const colon = decoded.indexOf(':');
		if (colon < 0) return { user: decoded, password: '' };
		return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
	} catch (_err) {
		return null;
	}
}

function sendHidden(response) {
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.set('Cache-Control', 'no-store, private');
	response.status(404).send('Not found');
}

function sendChallenge(response) {
	response.set('WWW-Authenticate', 'Basic realm="Restricted", charset="UTF-8"');
	response.set('Cache-Control', 'no-store, private');
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.status(401).send('Unauthorized');
}

function createAdminHtmlLimiter() {
	return rateLimit({
		windowMs: 15 * 60 * 1000,
		max: 20,
		standardHeaders: true,
		legacyHeaders: false,
		skipSuccessfulRequests: true,
		handler(_request, response) {
			sendHidden(response);
		},
	});
}

function createAdminHtmlGate({ resolveLegacyPassword, adminHtmlFile }) {
	const limiter = createAdminHtmlLimiter();

	function gate(request, response, next) {
		if (!adminHtmlConfigured(resolveLegacyPassword)) {
			return sendHidden(response);
		}
		const expectedUser = resolveAdminUser();
		const expectedPass = resolveAdminPass(resolveLegacyPassword);
		const creds = decodeBasicCredentials(request.headers.authorization);
		const userOk = timingSafeEqualString(expectedUser, (creds && creds.user) || '');
		const passOk = timingSafeEqualString(expectedPass, (creds && creds.password) || '');
		if (!userOk || !passOk) {
			return sendChallenge(response);
		}
		response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
		response.set('Cache-Control', 'no-store, private');
		return next();
	}

	function sendPage(response) {
		response.sendFile(adminHtmlFile, {
			headers: {
				'Cache-Control': 'no-store, private',
				'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive',
			},
		});
	}

	function mount(app) {
		app.get(['/admin', '/admin.html', '/__admin_gate', '/__admin_gate/'], (_request, response) => {
			sendHidden(response);
		});

		const adminPath = resolveAdminPath();
		if (!adminHtmlConfigured(resolveLegacyPassword) || !adminPath) {
			return { mounted: false, adminPath: '' };
		}

		const routes = [adminPath, `${adminPath}/`];
		app.get(routes, limiter, gate, (_request, response) => {
			sendPage(response);
		});
		return { mounted: true, adminPath };
	}

	return {
		mount,
		sendHidden,
		adminHtmlConfigured,
		resolveAdminPath,
		adminHtmlFile: path.resolve(adminHtmlFile),
	};
}

module.exports = {
	createAdminHtmlGate,
	resolveAdminPath,
	adminHtmlConfigured,
	sendHidden,
};
