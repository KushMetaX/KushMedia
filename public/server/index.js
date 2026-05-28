"use strict";

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const cookieParser = require('cookie-parser');

const { curateDiscoveredPois } = require('./voyager-curate');

const nailDesignerRouter = require('./routes/nail-designer');
const ddEvaluatorRouter = require('./routes/dd-evaluator');
const coingeckoRouter = require('./routes/coingecko');
const btcPublicRouter = require('./routes/btc-public');
const authDexRouter = require('./routes/auth-dex');
const { resolveSessionSecret } = require('./session-secret');
const { timingSafeEqualString } = require('./security-utils');

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

app.use(express.json({ limit: '100kb' }));
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
	return false;
}

app.use((request, response, next) => {
	response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.set('X-Content-Type-Options', 'nosniff');
	response.set('Cross-Origin-Resource-Policy', 'same-origin');
	response.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.set('X-Frame-Options', 'DENY');
	response.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);
	const xfProto = request.get('x-forwarded-proto');
	const secure = request.secure || xfProto === 'https';
	if (secure) {
		response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
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

app.use('/api/nail-designer', nailDesignerRouter);
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


app.get('/nail-designer', (request, response) => {
	response.sendFile(path.join(siteRoot, 'nail-designer', 'index.html'));
});

app.get('/dd-evaluator', (request, response) => {
	response.sendFile(path.join(siteRoot, 'dd-evaluator', 'index.html'));
});

// =============================================================================
// NovaScotiaVoyage password gate.
// Mirrors the /admin.html pattern: HTTP Basic Auth, timing-safe comparison,
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

function sendDdAdminHtml(response) {
	response.sendFile(path.join(siteRoot, 'admin.html'), {
		headers: { 'Cache-Control': 'no-store' },
	});
}

app.get('/admin.html', (request, response) => {
	if (/^(1|true|yes)$/i.test(String(process.env.DD_ADMIN_UI_PUBLIC || ''))) {
		sendDdAdminHtml(response);
		return;
	}
	const gate = ddEvaluatorRouter.resolveAdminHtmlGatePassword();
	if (!gate) {
		sendDdAdminHtml(response);
		return;
	}
	const auth = request.headers.authorization;
	if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	let password = '';
	try {
		const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
		const colon = decoded.indexOf(':');
		password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
	} catch (_err) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	if (!timingSafeEqualString(gate, password)) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	sendDdAdminHtml(response);
});

app.get('/community-suggestions.html', (request, response) => {
	response.sendFile(path.join(siteRoot, 'community-suggestions.html'));
});

app.use(express.static(siteRoot, {
	dotfiles: 'deny',
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

if (require.main === module) {
	const cb = () => {
		console.log('KushBrand server listening (passenger=' + Boolean(process.env.PASSENGER_BASE_URI || process.env.PORT) + ')');
		ddEvaluatorRouter.initEvaluator().catch(err => console.error('[dd-evaluator] Init failed:', err.message));
		const uiPw = ddEvaluatorRouter.getAdminUiPassword();
		const traitPw = ddEvaluatorRouter.getExpectedDdAdminPassword();
		if (uiPw && traitPw && uiPw !== traitPw) {
			console.log('[dd-evaluator] DD_ADMIN_UI_PASSWORD and DD_ADMIN_PASSWORD both set and differ — API saves use the trait secret (DD_ADMIN_PASSWORD), not the UI Basic gate.');
		}
		if (ddEvaluatorRouter.getCommunitySubmitPassword()) {
			console.log('[dd-evaluator] Community suggestion submissions require DD_COMMUNITY_PASSWORD.');
		}
	};
	if (process.env.PORT) {
		app.listen(process.env.PORT, cb);
	} else {
		app.listen(port, host, cb);
	}
}

module.exports = app;
