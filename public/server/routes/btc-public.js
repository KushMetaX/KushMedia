'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const COINBASE = 'https://api.exchange.coinbase.com';
const FRANKFURTER = 'https://api.frankfurter.app/latest';
/** Coinbase candles cap ~350 rows; chunk below that for safety. */
const DAY_SEC = 86400;
const CANDLE_CHUNK_DAYS = 280;
const MAX_RANGE_SEC = 10 * 366 * DAY_SEC;

const apiLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: 60,
	standardHeaders: true,
	legacyHeaders: false,
});

router.use(apiLimiter);

function fetchOpts(extra) {
	const opts = Object.assign({}, extra || {});
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		opts.signal = AbortSignal.timeout(25000);
	}
	return opts;
}

async function coinbaseStatsBtcUsd() {
	const url = `${COINBASE}/products/BTC-USD/stats`;
	const res = await fetch(url, fetchOpts());
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`Coinbase stats HTTP ${res.status}: ${t.slice(0, 200)}`);
	}
	const raw = await res.json();
	const last = Number(raw.last);
	const open = Number(raw.open);
	if (!Number.isFinite(last) || !Number.isFinite(open) || open === 0) {
		throw new Error('Coinbase stats: invalid last/open');
	}
	const usd_24h_change = ((last - open) / open) * 100;
	return { last, usd_24h_change };
}

async function frankfurterRatesUsdTo(codesUpper) {
	if (codesUpper.length === 0) {
		return {};
	}
	const url = `${FRANKFURTER}?from=USD&to=${codesUpper.join(',')}`;
	const res = await fetch(url, fetchOpts());
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`Frankfurter HTTP ${res.status}: ${t.slice(0, 200)}`);
	}
	const data = await res.json();
	const rates = data && data.rates && typeof data.rates === 'object' ? data.rates : {};
	return rates;
}

/**
 * Fetch daily candles covering [fromSec, toSec] (unix seconds inclusive-ish).
 * Returns rows [[timeUnixMs, closeUsd], ...] sorted ascending by time.
 */
async function coinbaseUsdDailyCloses(fromSec, toSec) {
	const chunks = [];
	let cursorSec = Math.floor(fromSec);
	const endSec = Math.floor(toSec);

	while (cursorSec <= endSec) {
		const chunkEndSec = Math.min(endSec, cursorSec + CANDLE_CHUNK_DAYS * DAY_SEC - 1);
		const startIso = new Date(cursorSec * 1000).toISOString();
		const endIso = new Date(chunkEndSec * 1000).toISOString();
		const qs = `granularity=${DAY_SEC}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
		const url = `${COINBASE}/products/BTC-USD/candles?${qs}`;
		const res = await fetch(url, fetchOpts());
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`Coinbase candles HTTP ${res.status}: ${text.slice(0, 200)}`);
		}
		const rows = JSON.parse(text);
		if (!Array.isArray(rows)) {
			throw new Error('Coinbase candles: unexpected shape');
		}
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (!Array.isArray(row) || row.length < 6) {
				continue;
			}
			const tSec = Number(row[0]);
			const close = Number(row[4]);
			if (!Number.isFinite(tSec) || !Number.isFinite(close)) {
				continue;
			}
			chunks.push([Math.floor(tSec * 1000), close]);
		}
		cursorSec = chunkEndSec + DAY_SEC;
	}

	chunks.sort(function (a, b) {
		return a[0] - b[0];
	});
	const dedup = [];
	let lastTs = null;
	for (let j = 0; j < chunks.length; j++) {
		const ts = chunks[j][0];
		if (lastTs === ts) {
			dedup[dedup.length - 1] = chunks[j];
			continue;
		}
		dedup.push(chunks[j]);
		lastTs = ts;
	}
	return dedup;
}

function asyncRoute(handler) {
	return function wrapped(request, response, next) {
		Promise.resolve(handler(request, response, next)).catch(next);
	};
}

router.get('/_about', (_request, response) => {
	response.json({
		provider:
			'Keyless BTC quotes: Coinbase Exchange (BTC-USD) spot + OHLC candles, Frankfurter (ECB FX) multi-currency. No CoinGecko key required.',
	});
});

router.get(
	'/simple-price',
	asyncRoute(async (request, response) => {
		const vs = String(request.query.vs || 'usd').toLowerCase();
		if (!/^[a-z]{2,10}(,[a-z]{2,10}){0,14}$/.test(vs)) {
			response.status(400).json({ error: 'Invalid vs currency list' });
			return;
		}
		const currencies = [...new Set(vs.split(',').map((x) => x.trim().toLowerCase()))];

		let lastUsd;
		let usdChange;
		try {
			const s = await coinbaseStatsBtcUsd();
			lastUsd = s.last;
			usdChange = s.usd_24h_change;
		} catch (err) {
			response.status(502).json({ error: String(err.message || err) });
			return;
		}

		const needFx = currencies.filter(function (c) {
			return c !== 'usd';
		});

		let ratesUpper = {};
		try {
			if (needFx.length) {
				ratesUpper = await frankfurterRatesUsdTo(needFx.map((c) => c.toUpperCase()));
			}
		} catch (err) {
			response.status(502).json({ error: String(err.message || err) });
			return;
		}

		const out = {};
		for (let i = 0; i < currencies.length; i++) {
			const c = currencies[i];
			if (c === 'usd') {
				out.usd = lastUsd;
				out.usd_24h_change = usdChange;
				continue;
			}
			const rate = Number(ratesUpper[String(c.toUpperCase())]);
			if (!Number.isFinite(rate)) {
				response.status(400).json({
					error: 'Unsupported FX for vs=' + String(c),
					hint:
						'Frankfurter may omit some codes; USD always works.',
				});
				return;
			}
			out[c] = lastUsd * rate;
			out[c + '_24h_change'] = usdChange;
		}

		response.json({ bitcoin: out });
	}),
);

router.get(
	'/market-chart-range',
	asyncRoute(async (request, response) => {
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
		let pairs;
		try {
			pairs = await coinbaseUsdDailyCloses(from, to);
		} catch (err) {
			response.status(502).json({ error: String(err.message || err) });
			return;
		}

		response.json({
			prices: pairs,
			source: 'coinbase-btcusd-daily-ecb-fx-multi',
		});
	}),
);

module.exports = router;
