"use strict";

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const cookieParser = require('cookie-parser');

const ddEvaluatorRouter = require('./routes/dd-evaluator');
const authDexRouter = require('../public/server/routes/auth-dex');
const { resolveSessionSecret } = require('../public/server/session-secret');
const { contentSecurityPolicy } = require('../public/server/csp-policy');
const { sendConfigJs } = require('../public/server/dogidex-public-config');
const { createAdminHtmlGate } = require('../public/server/admin-html-gate');

(function loadDotenvFromStandardRoots() {
	const roots = new Set([
		path.resolve(__dirname, '..'),
		path.resolve(__dirname, '..', '..'),
		process.cwd(),
		path.resolve(process.cwd(), 'public'),
	]);
	for (const root of roots) {
		const fp = path.join(root, '.env');
		if (fs.existsSync(fp)) {
			dotenv.config({ path: fp, override: false });
		}
	}
})();

const app = express();
const rootDir = path.resolve(__dirname, '..');
/** Document root (parent of `public/` when Passenger runs the app from `public/`). */
const siteRoot = fs.existsSync(path.join(rootDir, 'index.html'))
	? rootDir
	: path.resolve(rootDir, '..');
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.post(
	'/api/webhooks/crypto-payments',
	express.raw({ type: 'application/json', limit: '512kb' }),
	(req, res) => {
		Promise.resolve(authDexRouter.handleCryptoPayIpn(req, res)).catch((err) => {
			console.error('[crypto-payments webhook]', err && err.message ? err.message : err);
			if (!res.headersSent) {
				res.status(500).send('Webhook handler error');
			}
		});
	},
);

app.use((req, res, next) => {
	const pathOnly = String(req.path || '').split('?')[0];
	if (pathOnly === '/api/dd-evaluator/admin/lore-media') {
		return express.json({ limit: '3mb' })(req, res, next);
	}
	return express.json({ limit: '100kb' })(req, res, next);
});
app.use(cookieParser(resolveSessionSecret() || ''));

function pathLooksSensitive(rawPath) {
	if (!rawPath || typeof rawPath !== 'string') {
		return true;
	}
	let decoded;
	try {
		decoded = decodeURIComponent(rawPath.split('?')[0]);
	} catch (_err) {
		return true;
	}
	const normalized = decoded.replace(/\\/g, '/');
	if (normalized.includes('/../') || normalized.includes('\\..')) {
		return true;
	}
	const lower = normalized.toLowerCase();
	const serverBlocked = normalized === '/server' || normalized.startsWith('/server/');
	const nmBlocked = normalized === '/node_modules' || normalized.startsWith('/node_modules/');
	if (
		serverBlocked
		|| nmBlocked
		|| normalized.startsWith('/.git')
		|| lower.includes('/.git/')
		|| lower.endsWith('/.git')
	) {
		return true;
	}
	if (normalized === '/_tools' || normalized.startsWith('/_tools/')) {
		return true;
	}
	if (/DD\s*Price\s*Evaluation/i.test(normalized)) {
		return true;
	}
	if (
		lower.includes('/.env')
		|| /\.(?:env|pem|key|sql)(?:\.|$)/i.test(lower)
	) {
		return true;
	}
	return false;
}

function permissionsPolicyFor(request) {
	const pathOnly = String((request && request.path) || '');
	const tourneyMedia = /\/(tourney|__tourney_gate|bracket)(\/|$)/i.test(pathOnly);
	const cam = tourneyMedia ? '(self)' : '()';
	return `accelerometer=(), camera=${cam}, geolocation=(), gyroscope=(), magnetometer=(), microphone=${cam}, payment=(), usb=()`;
}

app.use((request, response, next) => {
	response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.set('X-Content-Type-Options', 'nosniff');
	const shareImage = /\/bracket\/og\.jpg$/i.test(String(request.path || ''));
	response.set('Cross-Origin-Resource-Policy', shareImage ? 'cross-origin' : 'same-origin');
	response.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.set('X-Frame-Options', 'DENY');
	response.set('Permissions-Policy', permissionsPolicyFor(request));
	const xfProto = request.get('x-forwarded-proto');
	const secure = request.secure || xfProto === 'https';
	if (secure) {
		response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	response.set('Content-Security-Policy', contentSecurityPolicy());
	next();
});

app.use((request, response, next) => {
	if (request.method === 'TRACE' || request.method === 'TRACK') {
		response.sendStatus(405);
		return;
	}
	next();
});

app.use((request, response, next) => {
	if (pathLooksSensitive(request.path)) {
		response.status(404).send('Not found');
		return;
	}

	next();
});

app.use('/api/dd-evaluator', ddEvaluatorRouter);
app.use('/api/auth', authDexRouter);
/** Same router; `/kmx-auth` avoids LiteSpeed/APACHE trapping `/api/*` for the PHP folder (503 HTML instead of Passenger). */
app.use('/kmx-auth', authDexRouter);
/** Fallback mount if the host blocks or mishandles `/kmx-auth` POST (evaluator retries bridge on HTML error bodies). */
app.use('/kk-auth', authDexRouter);
/** Third mount under the evaluator URL prefix — APISIX/LiteSpeed often proxy `/dd-evaluator/*` differently than `/kmx-auth`. */
app.use('/dd-evaluator/auth', authDexRouter);

app.get(['/dd-evaluator/config.js', '/__dd_config'], sendConfigJs);

app.get('/healthz', (request, response) => {
	response.json({
		ok: true,
		service: 'kushbrand-site',
		// Liveness only; auth is optional for /healthz. See Network tab on POST /kmx-auth/* (or legacy /api/auth/*).
		authSessionConfigured: Boolean(resolveSessionSecret()),
	});
});

const bracketDir = path.join(siteRoot, 'bracket');
const tourneyDataDir = path.join(__dirname, 'data');
const createTourneyRouter = require('../public/server/routes/tourney-bracket');
const tourneyApi = createTourneyRouter({
	dataDir: tourneyDataDir,
});
function sendBracketPage(request, response) {
	if (typeof createTourneyRouter.sendAppPage === 'function') {
		createTourneyRouter.sendAppPage({
			bracketDir,
			dataDir: tourneyDataDir,
			request,
			response,
		});
		return;
	}
	response.sendFile(path.join(bracketDir, 'index.html'), {
		headers: { 'Cache-Control': 'no-store, private' },
	});
}
const rtcRouter = require('../public/server/routes/rtc-signaling').createRouter({
	canClaimSeat: createTourneyRouter.createIrlSeatGuard(tourneyDataDir),
});
app.use('/api/rtc', rtcRouter);
app.use('/kmx-rtc', rtcRouter);
app.use('/kk-rtc', rtcRouter);
app.use('/tourney-api', tourneyApi);
app.use('/kmx-tourney', tourneyApi);
app.use('/kk-tourney', tourneyApi);
app.get('/__tourney_status', (_request, response) => {
	response.json({ ok: true, mode: 'static', proxy: false });
});
function redirectTourneyShare(request, response) {
	const slug = String((request.params && request.params.slug) || '').trim();
	response.redirect(302, `/tourney/?t=${encodeURIComponent(slug)}`);
}
app.get([
	'/tourney/t/:slug', '/tourney/t/:slug/',
	'/__tourney_gate/t/:slug', '/__tourney_gate/t/:slug/',
], redirectTourneyShare);
app.get([
	'/tourney', '/tourney/',
	'/__tourney_gate', '/__tourney_gate/',
], sendBracketPage);
app.use('/tourney', express.static(bracketDir));
app.use('/__tourney_gate', express.static(bracketDir));
app.use('/bracket', express.static(bracketDir));
app.get(['/tourney/*', '/__tourney_gate/*'], (request, response) => {
	const match = String(request.path || '').match(/\/t\/([^/]+)\/?$/);
	if (match) {
		response.redirect(302, `/tourney/?t=${encodeURIComponent(match[1])}`);
		return;
	}
	sendBracketPage(request, response);
});

app.get(['/dd-evaluator', '/dd-evaluator/'], (request, response) => {
	response.sendFile(path.join(siteRoot, 'dd-evaluator', 'index.html'), {
		headers: { 'Cache-Control': 'no-store, private' },
	});
});

app.get('/map', (request, response) => {
	response.sendFile(path.join(siteRoot, 'map', 'index.html'));
});

app.get('/api/voyager/config', (request, response) => {
	const token =
		process.env.MAPBOX_ACCESS_TOKEN ||
		process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
		process.env.VOYAGER_MAPBOX_TOKEN ||
		'';
	response.setHeader('Cache-Control', 'private, max-age=300');
	response.json({ mapboxToken: token });
});

const ddAdminHtml = createAdminHtmlGate({
	resolveLegacyPassword: () => ddEvaluatorRouter.resolveAdminHtmlGatePassword(),
	adminHtmlFile: path.resolve(__dirname, '..', 'public', 'server', 'private', 'dd-admin.html'),
});
const ddAdminMount = ddAdminHtml.mount(app);

app.get('/community-suggestions.html', (request, response) => {
	response.sendFile(path.join(siteRoot, 'community-suggestions.html'));
});

app.get('/robots.txt', (request, response) => {
	response.type('text/plain; charset=utf-8');
	response.set('Cache-Control', 'public, max-age=3600');
	response.sendFile(path.join(siteRoot, 'robots.txt'));
});
app.get('/.well-known/security.txt', (request, response) => {
	response.type('text/plain; charset=utf-8');
	response.set('Cache-Control', 'public, max-age=86400');
	response.sendFile(path.join(siteRoot, '.well-known', 'security.txt'));
});

app.use(express.static(siteRoot, {
	dotfiles: 'deny',
	index: 'index.html',
	extensions: ['html'],
	setHeaders(response, filePath) {
		if (/\.(?:png|jpg|jpeg|gif|webp|svg|mp4|css|js)$/i.test(filePath)) {
			response.setHeader('Cache-Control', 'public, max-age=86400');
			return;
		}

		if (/\.html$/i.test(filePath)) {
			response.setHeader('Cache-Control', 'no-cache');
		}
	}
}));

app.use((request, response) => {
	response.set('X-Robots-Tag', 'noindex, nofollow');
	response.set('Cache-Control', 'no-store, private');
	response.status(404);
	const notFoundPage = path.join(siteRoot, '404.html');
	if (fs.existsSync(notFoundPage)) {
		response.sendFile(notFoundPage);
		return;
	}
	response.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found.</p></body></html>');
});

if (require.main === module) {
	app.listen(port, host, async () => {
		console.log(`KushBrand server listening on http://${host}:${port}`);
		ddEvaluatorRouter.initEvaluator().catch(err => console.error('[dd-evaluator] Init failed:', err.message));
		const uiPw = ddEvaluatorRouter.getAdminUiPassword();
		const traitPw = ddEvaluatorRouter.getExpectedDdAdminPassword();
		if (uiPw && traitPw && uiPw !== traitPw) {
			console.log('[dd-evaluator] DD_ADMIN_UI_PASSWORD and DD_ADMIN_PASSWORD both set and differ — API saves use the trait secret (DD_ADMIN_PASSWORD), not the UI Basic gate.');
		}
		if (!ddAdminMount.mounted) {
			console.log('[dd-evaluator] admin HTML hidden (404) until ADMIN_PATH, ADMIN_USER, and ADMIN_PASS (or DD_ADMIN_PASSWORD) are set.');
		} else {
			console.log('[dd-evaluator] admin HTML enabled at ADMIN_PATH (Basic realm Restricted).');
		}
		if (ddEvaluatorRouter.getCommunitySubmitPassword()) {
			console.log('[dd-evaluator] Community suggestion submissions require DD_COMMUNITY_PASSWORD.');
		}
	});
}

module.exports = app;
