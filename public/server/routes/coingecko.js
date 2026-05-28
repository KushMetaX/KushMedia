'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const CG_DEMO_BASE = 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const COIN_ID = 'bitcoin';
const MAX_RANGE_SEC = 10 * 366 * 24 * 3600;

const defaultKeyFilePath = path.join(__dirname, '..', 'data', '.coingecko-api-key');

const apiLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 90,
	standardHeaders: true,
	legacyHeaders: false,
});

router.use(apiLimiter);

let memoFileKey;
/** Parsed value from .env scans (undefined = not scanned yet). */
let dotenvKeyCache;

function readKeyFromFile(filePath) {
	try {
		if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			return '';
		}
		const line = String(fs.readFileSync(filePath, 'utf8'))
			.split(/\r?\n/)[0]
			.trim();
		return line;
	} catch (_err) {
		return '';
	}
}

/**
 * Read COINGECKO_API_KEY / CG_API_KEY from known .env paths when the host did not inject them.
 * (CloudLinux Node often runs without merging Application variables into process.env for all apps.)
 */
function readKeyFromDotenvFiles() {
	if (dotenvKeyCache !== undefined) {
		return dotenvKeyCache;
	}
	try {
		const roots = new Set([
			path.resolve(__dirname, '..'),
			path.resolve(__dirname, '..', '..'),
			process.cwd(),
			path.resolve(process.cwd(), 'public'),
		]);
		for (const root of roots) {
			try {
				const fp = path.join(root, '.env');
				if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
					continue;
				}
				const text = fs.readFileSync(fp, 'utf8');
				for (const rawLine of text.split(/\r?\n/)) {
					const line = rawLine.trim();
					if (!line || line.startsWith('#')) {
						continue;
					}
					const m = line.match(/^(?:export\s+)?(COINGECKO_API_KEY|CG_API_KEY)\s*=\s*(.*)$/);
					if (!m) {
						continue;
					}
					let v = String(m[2] || '').trim();
					if (
						(v.startsWith('"') && v.endsWith('"')) ||
						(v.startsWith("'") && v.endsWith("'"))
					) {
						v = v.slice(1, -1);
					}
					if (v) {
						dotenvKeyCache = v;
						return dotenvKeyCache;
					}
				}
			} catch (_one) {
				/* skip unreadable or broken .env roots */
				continue;
			}
		}
		dotenvKeyCache = '';
		return dotenvKeyCache;
	} catch (_outer) {
		dotenvKeyCache = '';
		return dotenvKeyCache;
	}
}

function isProPlan() {
	return /^(1|true|yes|pro)$/i.test(String(process.env.COINGECKO_PRO || process.env.CG_PRO || ''));
}

function resolveCgBase() {
	return isProPlan() ? CG_PRO_BASE : CG_DEMO_BASE;
}

function cgAuthHeaders(apiKey) {
	if (isProPlan()) {
		return { 'x-cg-pro-api-key': apiKey };
	}
	return { 'x-cg-demo-api-key': apiKey };
}

function cgUpstreamFetchOpts(headers) {
	const opts = { headers };
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		opts.signal = AbortSignal.timeout(28000);
	}
	return opts;
}

function resolveCoinGeckoKey() {
	const fromEnv = String(process.env.COINGECKO_API_KEY || process.env.CG_API_KEY || '').trim();
	if (fromEnv) {
		return { key: fromEnv, source: 'process.env' };
	}
	const fromDot = readKeyFromDotenvFiles();
	if (fromDot) {
		return { key: fromDot, source: 'dotenv-file' };
	}
	if (memoFileKey === undefined) {
		const custom = process.env.COINGECKO_API_KEY_FILE
			? path.resolve(process.env.COINGECKO_API_KEY_FILE)
			: defaultKeyFilePath;
		memoFileKey = readKeyFromFile(custom) || '';
	}
	if (memoFileKey) {
		return {
			key: memoFileKey,
			source: process.env.COINGECKO_API_KEY_FILE ? 'COINGECKO_API_KEY_FILE-path' : 'server-data-file',
		};
	}
	return { key: '', source: 'none' };
}

function getApiKey() {
	return resolveCoinGeckoKey().key;
}

/** JSON for /_status and for app-level /coingecko-status (no CoinGecko outbound call). */
function coinGeckoStatusPayload() {
	try {
		const { key: apiKey, source } = resolveCoinGeckoKey();
		const apiPlan = isProPlan() ? 'pro' : 'demo';
		if (!apiKey) {
			return {
				ok: true,
				keyConfigured: false,
				keySource: source,
				apiPlan,
				hint:
					'No key found: set COINGECKO_API_KEY in cPanel Node env, or server/data/.coingecko-api-key (Passenger app root = public/), or public/.env on the server.',
			};
		}
		return {
			ok: true,
			keyConfigured: true,
			keySource: source,
			apiPlan,
		};
	} catch (err) {
		return {
			ok: false,
			keyConfigured: false,
			error: err && err.message ? String(err.message) : 'CoinGecko status failed',
			keySource: 'error',
		};
	}
}

function asyncRoute(handler) {
	return function wrapped(request, response, next) {
		Promise.resolve(handler(request, response, next)).catch(next);
	};
}

/** GET /_status — no CoinGecko call; shows whether a key is loaded and from where. */
router.get(
	'/_status',
	asyncRoute(async (request, response) => {
		response.json(coinGeckoStatusPayload());
	}),
);

/** GET /api/coingecko/simple-price?vs=usd */
router.get(
	'/simple-price',
	asyncRoute(async (request, response) => {
		const apiKey = getApiKey();
		if (!apiKey) {
			response.status(503).json({
				error:
					'CoinGecko API key not configured. Set COINGECKO_API_KEY in the host environment (cPanel → Node / Application variables), ' +
					'or upload a single-line file at server/data/.coingecko-api-key next to the Node app (Passenger root = public/). See .env.example.',
			});
			return;
		}
		const vs = String(request.query.vs || 'usd').toLowerCase();
		if (!/^[a-z]{2,10}(,[a-z]{2,10}){0,14}$/.test(vs)) {
			response.status(400).json({ error: 'Invalid vs currency list' });
			return;
		}
		const url = new URL(`${resolveCgBase()}/simple/price`);
		url.searchParams.set('ids', COIN_ID);
		url.searchParams.set('vs_currencies', vs);
		url.searchParams.set('include_24hr_change', 'true');

		let cgRes;
		try {
			cgRes = await fetch(url, cgUpstreamFetchOpts({ ...cgAuthHeaders(apiKey) }));
		} catch (err) {
			const n = err && err.name;
			const timed =
				n === 'AbortError' ||
				n === 'TimeoutError' ||
				String((err && err.message) || '').toLowerCase().includes('timeout');
			response.status(timed ? 504 : 502).json({
				error: timed ? 'CoinGecko request timed out — try again' : 'Upstream fetch failed',
				detail: err && err.message ? err.message : String(err),
			});
			return;
		}
		const body = await cgRes.text();
		const ct = cgRes.headers.get('content-type') || 'application/json';
		response.status(cgRes.status).type(ct).send(body);
	}),
);

/** GET /api/coingecko/market-chart-range?from=unix&to=unix (USD) */
router.get(
	'/market-chart-range',
	asyncRoute(async (request, response) => {
		const apiKey = getApiKey();
		if (!apiKey) {
			response.status(503).json({
				error:
					'CoinGecko API key not configured. Set COINGECKO_API_KEY in the host environment (cPanel → Node / Application variables), ' +
					'or upload a single-line file at server/data/.coingecko-api-key next to the Node app (Passenger root = public/). See .env.example.',
			});
			return;
		}
		const from = Number(request.query.from);
		const to = Number(request.query.to);
		if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || from < 0) {
			response.status(400).json({ error: 'Invalid from/to Unix timestamps' });
			return;
		}
		if (to - from > MAX_RANGE_SEC) {
			response.status(400).json({ error: 'Date range too large' });
			return;
		}
		const url = new URL(`${resolveCgBase()}/coins/${COIN_ID}/market_chart/range`);
		url.searchParams.set('vs_currency', 'usd');
		url.searchParams.set('from', String(Math.floor(from)));
		url.searchParams.set('to', String(Math.floor(to)));

		let cgRes;
		try {
			cgRes = await fetch(url, cgUpstreamFetchOpts({ ...cgAuthHeaders(apiKey) }));
		} catch (err) {
			const n = err && err.name;
			const timed =
				n === 'AbortError' ||
				n === 'TimeoutError' ||
				String((err && err.message) || '').toLowerCase().includes('timeout');
			response.status(timed ? 504 : 502).json({
				error: timed ? 'CoinGecko request timed out — try again' : 'Upstream fetch failed',
				detail: err && err.message ? err.message : String(err),
			});
			return;
		}
		const body = await cgRes.text();
		const ct = cgRes.headers.get('content-type') || 'application/json';
		response.status(cgRes.status).type(ct).send(body);
	}),
);

router.coinGeckoStatusPayload = coinGeckoStatusPayload;
module.exports = router;
