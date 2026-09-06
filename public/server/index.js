"use strict";

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const cookieParser = require('cookie-parser');

const { curateDiscoveredPois } = require('./voyager-curate');

const ddEvaluatorRouter = require('./routes/dd-evaluator');
const coingeckoRouter = require('./routes/coingecko');
const btcPublicRouter = require('./routes/btc-public');
const authDexRouter = require('./routes/auth-dex');
const { resolveSessionSecret } = require('./session-secret');
const { timingSafeEqualString } = require('./security-utils');
const { contentSecurityPolicy } = require('./csp-policy');
const { sendConfigJs } = require('./dogidex-public-config');
const { createAdminHtmlGate } = require('./admin-html-gate');

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

/** Bypasses middleware stack — if this is not 200 text, Passenger/Node never reached Express. */
app.get('/ping', (request, response) => {
	response.status(200).type('txt').send('kushbrand-node-live');
});

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

function permissionsPolicyFor(request) {
	const pathOnly = String((request && request.path) || '');
	const tourneyMedia = /\/(tourney|__tourney_gate|bracket)(\/|$)/i.test(pathOnly);
	const cam = tourneyMedia ? '(self)' : '()';
	return `accelerometer=(), camera=${cam}, geolocation=(), gyroscope=(), magnetometer=(), microphone=${cam}, payment=(), usb=()`;
}

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

function isDdlTcgHost(request) {
	const host = String(request.headers.host || '').split(':')[0].toLowerCase();
	return host === 'ddl.kushmedia.xyz' || host === 'www.ddl.kushmedia.xyz' ||
		host === 'ddltcg.kushmetax.com' || host === 'www.ddltcg.kushmetax.com';
}

// When a DDL host is an alias of this vhost, do not leak the rest of
// the site. Rewrite every path onto the gated companion before other routes.
app.use((request, response, next) => {
	if (!isDdlTcgHost(request)) {
		return next();
	}
	if (String(request.path || '').startsWith('/__ddl_gate')) {
		return next();
	}
	const pathOnly = String(request.path || '/');
	const rest = pathOnly === '/' ? '/' : pathOnly;
	const queryIndex = String(request.url || '').indexOf('?');
	const query = queryIndex >= 0 ? request.url.slice(queryIndex) : '';
	request.url = '/__ddl_gate' + (rest.startsWith('/') ? rest : '/' + rest) + query;
	next();
});

app.use('/api/dd-evaluator', ddEvaluatorRouter);
/** Keyless BTC spot + OHLC proxy (Coinbase + ECB FX). Mirrors match `/kk-auth`, `/kmx-*`, `/dd-evaluator/auth` routing quirks on LiteSpeed/APISIX. */
app.use('/btc-public', btcPublicRouter);
app.use('/kk-btc', btcPublicRouter);
app.use('/kmx-btc', btcPublicRouter);
app.use('/dd-evaluator/btc', btcPublicRouter);
/** Root-level proxies (preferred on LiteSpeed hosts where `/api/*` is PHP and `/dd-evaluator/*` is static). **/
app.use('/coingecko-api', coingeckoRouter);
/** Same bypass pattern as `/kk-auth`. */
app.use('/kk-coingecko', coingeckoRouter);
app.use('/api/coingecko', coingeckoRouter);
/** Same router; avoids LiteSpeed trapping `/api/*` for the PHP folder. */
app.use('/kmx-coingecko', coingeckoRouter);
app.use('/api/auth', authDexRouter);
/** Same router; `/kmx-auth` avoids LiteSpeed/APACHE trapping `/api/*` for the PHP folder (503 HTML instead of Passenger). */
app.use('/kmx-auth', authDexRouter);
/** Fallback mount if the host blocks or mishandles `/kmx-auth` POST (evaluator retries bridge on HTML error bodies). */
app.use('/kk-auth', authDexRouter);
/** Third mount under the evaluator URL prefix — APISIX/LiteSpeed often proxy `/dd-evaluator/*` differently than `/kmx-auth`. */
app.use('/dd-evaluator/auth', authDexRouter);
/** CoinGecko proxy under the same prefix pattern as auth (fallback when `/kmx-coingecko` is blocked upstream). */
app.use('/dd-evaluator/coingecko', coingeckoRouter);

/** Plain path for hosts that mishandle `/dd-evaluator/coingecko/*`; same payload as CoinGecko /_status. */
app.get('/coingecko-status', (request, response) => {
	try {
		response.json(coingeckoRouter.coinGeckoStatusPayload());
	} catch (_err) {
		response.status(503).json({ ok: false, error: 'coingecko-status-unavailable' });
	}
});

app.get('/healthz', (request, response) => {
	let coingecko = null;
	try {
		const cgSnap =
			typeof coingeckoRouter.coinGeckoStatusPayload === 'function'
				? coingeckoRouter.coinGeckoStatusPayload()
				: null;
		if (cgSnap && typeof cgSnap === 'object') {
			coingecko = {
				keyConfigured: Boolean(cgSnap.keyConfigured),
				keySource: cgSnap.keySource,
				apiPlan: cgSnap.apiPlan,
			};
		}
	} catch (_err) {
		coingecko = { error: 'coingecko-status-unavailable' };
	}
	response.json({
		ok: true,
		service: 'kushbrand-site',
		authSessionConfigured: Boolean(resolveSessionSecret()),
		coingecko,
	});
});


// DDL Tourney — static files in /bracket, JSON API on this same Node process.
// No Vite and no extra port. Apache may rewrite /tourney → /__tourney_gate.
const bracketDir = path.join(siteRoot, 'bracket');
const tourneyDataDir = path.join(__dirname, 'data');
const createTourneyRouter = require('./routes/tourney-bracket');
const tourneyApi = createTourneyRouter({
	dataDir: tourneyDataDir,
	bracketDir,
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
const rtcRouter = require('./routes/rtc-signaling').createRouter({
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
function bracketStaticHeaders(res, filePath) {
	const file = String(filePath || '');
	if (/\.(js|css|html)$/i.test(file) || /playmat-lanes\.png$/i.test(file)) {
		res.setHeader('Cache-Control', 'no-store, private');
	}
}
app.use('/tourney', express.static(bracketDir, { setHeaders: bracketStaticHeaders }));
app.use('/__tourney_gate', express.static(bracketDir, { setHeaders: bracketStaticHeaders }));
app.use('/bracket', express.static(bracketDir, { setHeaders: bracketStaticHeaders }));
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

// =============================================================================
// NovaScotiaVoyage password gate.
// HTTP Basic Auth, timing-safe comparison,
// password supplied via VOYAGER_PASSWORD env var (or VOYAGER_PASSWORD_FILE).
// Default-locked: if no password is configured the tool returns 404 so it
// stays hidden — only setting the env var unlocks the public surface.
// =============================================================================
function resolveVoyagerPassword() {
	const direct = String(process.env.VOYAGER_PASSWORD || '').trim();
	if (direct) return direct;
	const filePath = String(process.env.VOYAGER_PASSWORD_FILE || '').trim();
	if (filePath) {
		try {
			const raw = fs.readFileSync(filePath, 'utf8');
			const first = String(raw || '').split(/\r?\n/)[0].trim();
			if (first) return first;
		} catch (_err) { /* missing file => not configured */ }
	}
	return '';
}

function voyagerHidden(response) {
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.set('Cache-Control', 'no-store, private');
	response.status(404).send('Not found');
}

function voyagerChallenge(response) {
	response.set('WWW-Authenticate', 'Basic realm="NovaScotiaVoyage", charset="UTF-8"');
	response.set('Cache-Control', 'no-store, private');
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.status(401).send('Unauthorized');
}

function voyagerGate(request, response, next) {
	if (/^(1|true|yes|on)$/i.test(String(process.env.VOYAGER_PUBLIC || ''))) {
		response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
		return next();
	}
	const expected = resolveVoyagerPassword();
	if (!expected) {
		// No password configured — tool is hidden entirely (404).
		return voyagerHidden(response);
	}
	const auth = request.headers.authorization;
	if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
		return voyagerChallenge(response);
	}
	let password = '';
	try {
		const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
		const colon = decoded.indexOf(':');
		password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
	} catch (_err) {
		return voyagerChallenge(response);
	}
	if (!timingSafeEqualString(expected, password)) {
		return voyagerChallenge(response);
	}
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.set('Cache-Control', 'no-store, private');
	return next();
}

// Apache rewrites every request under /map/* to /__nsv_gate/* (see map/.htaccess)
// so Passenger always reaches us. Express then applies the gate before serving
// the static files from the on-disk `map/` directory.
app.use('/__nsv_gate', voyagerGate, express.static(path.join(siteRoot, 'map'), {
	dotfiles: 'deny',
	index: 'index.html',
	extensions: ['html'],
	setHeaders(response) {
		response.setHeader('Cache-Control', 'no-store, private');
		response.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	}
}));

// Direct hits to /map (no rewrite, e.g. when Passenger gets the request first)
// are gated identically. Keeps the password lock effective whether the request
// arrives via Apache rewrite or directly through Express.
app.get(['/map', '/map/'], voyagerGate, (request, response) => {
	response.sendFile(path.join(siteRoot, 'map', 'index.html'), {
		headers: {
			'Cache-Control': 'no-store, private',
			'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive'
		}
	});
});
app.get(/^\/map\/.+$/, voyagerGate, (request, response, next) => {
	const sub = request.path.replace(/^\/map\//, '');
	if (!sub || /(^|\/)\.\.(\/|$)/.test(sub) || sub.startsWith('.')) {
		return voyagerHidden(response);
	}
	const filePath = path.join(siteRoot, 'map', sub);
	const safeRoot = path.join(siteRoot, 'map') + path.sep;
	if (!filePath.startsWith(safeRoot)) {
		return voyagerHidden(response);
	}
	response.sendFile(filePath, {
		headers: {
			'Cache-Control': 'no-store, private',
			'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive'
		}
	}, (err) => {
		if (err) next();
	});
});

// =============================================================================
// DDL TCG companion password gate (/ddl, ddl.kushmedia.xyz, ddltcg.kushmetax.com fallback).
// Same contract as Voyager: Basic Auth, timing-safe, 404 if no password.
// Apache rewrites /ddl/* → /__ddl_gate/* (see ddl/.htaccess).
// =============================================================================
function resolveDdlPassword() {
	const direct = String(process.env.DDL_PASSWORD || '').trim();
	if (direct) return direct;
	const filePath = String(process.env.DDL_PASSWORD_FILE || '').trim();
	const candidates = [];
	if (filePath) candidates.push(filePath);
	candidates.push(path.join(__dirname, 'data', '.ddl-password'));
	candidates.push(path.join(siteRoot, '.ddl-password'));
	for (const candidate of candidates) {
		try {
			const first = String(fs.readFileSync(candidate, 'utf8') || '').split(/\r?\n/)[0].trim();
			if (first) return first;
		} catch (_err) { /* missing file => try next */ }
	}
	return '';
}

function ddlHidden(response) {
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.set('Cache-Control', 'no-store, private');
	response.status(404).send('Not found');
}

function ddlChallenge(response) {
	response.set('WWW-Authenticate', 'Basic realm="DDL TCG Companion", charset="UTF-8"');
	response.set('Cache-Control', 'no-store, private');
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.status(401).send('Unauthorized');
}

function ddlIsPublic() {
	return /^(1|true|yes|on)$/i.test(String(process.env.DDL_PUBLIC || ''));
}

const DDL_HIDE_PRICES_SNIPPET =
	'<style id="ddl-hide-prices">[data-tab="prices"],#view-prices{display:none!important}</style>' +
	'<script>if((location.hash||"").replace(/^#/,"")==="prices")history.replaceState(null,"","#cards");</script>';

function htmlWithHiddenPrices(html) {
	if (!ddlIsPublic() || typeof html !== 'string' || html.includes('id="ddl-hide-prices"')) return html;
	if (/<\/head>/i.test(html)) {
		return html.replace(/<\/head>/i, DDL_HIDE_PRICES_SNIPPET + '</head>');
	}
	return DDL_HIDE_PRICES_SNIPPET + html;
}

function sendDdlIndex(response) {
	const indexPath = path.join(siteRoot, 'ddl', 'index.html');
	if (!ddlIsPublic()) {
		response.sendFile(indexPath, {
			headers: {
				'Cache-Control': 'no-store, private',
				'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive'
			}
		});
		return;
	}
	fs.readFile(indexPath, 'utf8', (err, html) => {
		if (err) {
			ddlHidden(response);
			return;
		}
		response.set('Content-Type', 'text/html; charset=utf-8');
		response.set('Cache-Control', 'no-store, private');
		response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
		response.send(htmlWithHiddenPrices(html));
	});
}

function ddlGate(request, response, next) {
	if (ddlIsPublic()) {
		response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
		return next();
	}
	const expected = resolveDdlPassword();
	if (!expected) {
		return ddlHidden(response);
	}
	const auth = request.headers.authorization;
	if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
		return ddlChallenge(response);
	}
	let password = '';
	try {
		const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
		const colon = decoded.indexOf(':');
		password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
	} catch (_err) {
		return ddlChallenge(response);
	}
	if (!timingSafeEqualString(expected, password)) {
		return ddlChallenge(response);
	}
	response.set('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	response.set('Cache-Control', 'no-store, private');
	return next();
}

app.use('/__ddl_gate', ddlGate, (request, response, next) => {
	const p = String(request.path || '/');
	if (p === '/' || p === '/index.html') {
		return sendDdlIndex(response);
	}
	next();
}, express.static(path.join(siteRoot, 'ddl'), {
	dotfiles: 'deny',
	index: 'index.html',
	extensions: ['html'],
	setHeaders(response) {
		response.setHeader('Cache-Control', 'no-store, private');
		response.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
	}
}));

app.get(['/ddl', '/ddl/'], ddlGate, (request, response) => {
	sendDdlIndex(response);
});
app.get(/^\/ddl\/.+$/, ddlGate, (request, response, next) => {
	const sub = request.path.replace(/^\/ddl\//, '');
	if (!sub || /(^|\/)\.\.(\/|$)/.test(sub) || sub.startsWith('.')) {
		return ddlHidden(response);
	}
	const filePath = path.join(siteRoot, 'ddl', sub);
	const safeRoot = path.join(siteRoot, 'ddl') + path.sep;
	if (!filePath.startsWith(safeRoot)) {
		return ddlHidden(response);
	}
	if (sub === 'index.html' || sub === 'index.htm') {
		return sendDdlIndex(response);
	}
	response.sendFile(filePath, {
		headers: {
			'Cache-Control': 'no-store, private',
			'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive'
		}
	}, (err) => {
		if (err) next();
	});
});

app.get('/api/voyager/config', voyagerGate, (request, response) => {
	const token =
		process.env.MAPBOX_ACCESS_TOKEN ||
		process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
		process.env.VOYAGER_MAPBOX_TOKEN ||
		'';
	response.setHeader('Cache-Control', 'no-store, private');
	response.json({ mapboxToken: token });
});

// Scraped POIs (Overpass / OSM contributions). Output of `npm --prefix
// _tools/voyager-scraper run scrape`. Returns an empty list if the file
// hasn't been generated yet so the front-end keeps working with just the
// curated set.
const VOYAGER_DISCOVERED_PATHS = [
	path.join(siteRoot, '_tools', 'voyager-scraper', 'data', 'out', 'pois-discovered.json'),
	path.resolve(rootDir, '..', '_tools', 'voyager-scraper', 'data', 'out', 'pois-discovered.json'),
];
const VOYAGER_CURATED_PATHS = [
	path.join(siteRoot, 'map', 'pois.js'),
	path.resolve(rootDir, '..', 'map', 'pois.js'),
];

/**
 * Names of the hand-curated POIs (from map/pois.js) so the curator can suppress
 * any scraped record that duplicates an editorial entry. Cached in-process and
 * refreshed only when the file's mtime changes.
 */
let _curatedNamesCache = { mtimeMs: 0, set: new Set() };
function loadCuratedNames() {
	for (const fp of VOYAGER_CURATED_PATHS) {
		try {
			if (!fs.existsSync(fp)) continue;
			const stat = fs.statSync(fp);
			if (stat.mtimeMs === _curatedNamesCache.mtimeMs && _curatedNamesCache.set.size) {
				return _curatedNamesCache.set;
			}
			const raw = fs.readFileSync(fp, 'utf8');
			const set = new Set();
			const re = /name\s*:\s*"((?:[^"\\]|\\.)*)"/g;
			let m;
			while ((m = re.exec(raw))) {
				const key = m[1]
					.replace(/\\"/g, '"')
					.toLowerCase()
					.replace(/[^\p{L}\p{N} ]+/gu, '')
					.replace(/\s+/g, ' ')
					.replace(/^the /, '')
					.trim();
				if (key) set.add(key);
			}
			_curatedNamesCache = { mtimeMs: stat.mtimeMs, set };
			return set;
		} catch (_err) { /* try next */ }
	}
	return _curatedNamesCache.set;
}

/**
 * In-process cache of the curated discovered set keyed on source-file mtime, so
 * we don't re-parse + re-curate ~7k records on every request.
 */
let _curatedPoisCache = { mtimeMs: 0, sourceMtimeMs: 0, payload: null };
app.get('/api/voyager/pois', voyagerGate, (request, response) => {
	for (const fp of VOYAGER_DISCOVERED_PATHS) {
		try {
			if (!fs.existsSync(fp)) continue;
			const stat = fs.statSync(fp);
			const curatedNames = loadCuratedNames();
			const cacheValid =
				_curatedPoisCache.payload &&
				_curatedPoisCache.sourceMtimeMs === stat.mtimeMs &&
				_curatedPoisCache.curatedSize === curatedNames.size;
			if (!cacheValid) {
				const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
				if (!Array.isArray(json)) continue;
				const pois = curateDiscoveredPois(json, { curatedNames });
				_curatedPoisCache = {
					sourceMtimeMs: stat.mtimeMs,
					curatedSize: curatedNames.size,
					payload: {
						attribution: 'POI data © OpenStreetMap contributors (ODbL)',
						generatedAt: (() => {
							try { return stat.mtime.toISOString(); } catch (_e) { return null; }
						})(),
						count: pois.length,
						pois,
					},
				};
			}
			response.setHeader('Cache-Control', 'no-store, private');
			response.json(_curatedPoisCache.payload);
			return;
		} catch (_err) { /* try next */ }
	}
	response.setHeader('Cache-Control', 'no-store, private');
	response.json({ attribution: 'OpenStreetMap', generatedAt: null, count: 0, pois: [] });
});

app.get(['/dd-evaluator/config.js', '/__dd_config'], sendConfigJs);

const ddAdminHtml = createAdminHtmlGate({
	resolveLegacyPassword: () => ddEvaluatorRouter.resolveAdminHtmlGatePassword(),
	adminHtmlFile: path.join(__dirname, 'private', 'dd-admin.html'),
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
	const cb = () => {
		console.log('KushBrand server listening (passenger=' + Boolean(process.env.PASSENGER_BASE_URI || process.env.PORT) + ')');
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
		if (ddlIsPublic()) {
			console.log('[ddl-tcg] public mode (no password, Prices tab hidden)');
		} else if (String(process.env.DDL_PASSWORD || '').trim() || String(process.env.DDL_PASSWORD_FILE || '').trim()) {
			console.log('[ddl-tcg] password gate on /ddl, ddl.kushmedia.xyz, ddltcg.kushmetax.com');
		} else {
			console.log('[ddl-tcg] hidden (404) until DDL_PASSWORD is set');
		}
	};
	if (process.env.PORT) {
		app.listen(process.env.PORT, cb);
	} else {
		app.listen(port, host, cb);
	}
}

module.exports = app;
