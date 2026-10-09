'use strict';

/** 1 DOGE = 100_000_000 koinu (same scale as bitcoin satoshis). */
const KOINU = 100000000;
const BASE58 = /^D[1-9A-HJ-NP-Za-km-z]{25,39}$/;
const TXID_RE = /^[0-9a-fA-F]{64}$/;
const DEFAULT_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CACHE_MS = 20000;
const incomingCache = new Map();

function looksLikeDogeAddress(value) {
	return BASE58.test(String(value || '').trim());
}

function looksLikeTxid(value) {
	return TXID_RE.test(String(value || '').trim());
}

function normalizeAddr(value) {
	return String(value || '').trim();
}

function addrKey(value) {
	return normalizeAddr(value).toLowerCase();
}

function toKoinu(doge) {
	const n = Number(doge);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.round(n * KOINU);
}

function koinuToDoge(koinu) {
	return Math.round(Number(koinu) || 0) / KOINU;
}

function txTimeMs(tx) {
	const raw = tx && (tx.time || tx.confirmed || tx.received);
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	const parsed = Date.parse(raw || '');
	return Number.isFinite(parsed) ? parsed : 0;
}

function amountCovers(gotDoge, needDoge) {
	const got = toKoinu(gotDoge);
	const need = toKoinu(needDoge);
	if (got <= 0 || need <= 0) return false;
	const slack = Math.max(2_000_000, Math.round(need * 0.002));
	return got + 1 >= need - slack;
}

function uniqueAddrs(list) {
	const out = [];
	const seen = new Set();
	for (const item of list || []) {
		const addr = normalizeAddr(item);
		const key = addrKey(addr);
		if (!addr || seen.has(key)) continue;
		seen.add(key);
		out.push(addr);
	}
	return out;
}

function parseBlockCypherTx(raw, payTo) {
	if (!raw || typeof raw !== 'object') return null;
	const txid = String(raw.hash || raw.txid || '').trim();
	if (!looksLikeTxid(txid)) return null;
	const payKey = addrKey(payTo);
	let amountKoinu = 0;
	for (const output of raw.outputs || []) {
		const addresses = output.addresses || (output.addresses === undefined && output.address ? [output.address] : []);
		if ((addresses || []).some((addr) => addrKey(addr) === payKey)) {
			amountKoinu += Math.max(0, Number(output.value) || 0);
		}
	}
	const fromAddresses = uniqueAddrs(
		(raw.inputs || []).flatMap((input) => input.addresses || (input.address ? [input.address] : [])),
	);
	const confirmedAt = raw.confirmed || raw.received || null;
	const confirmations = Math.max(0, Number(raw.confirmations) || 0);
	return {
		txid: txid.toLowerCase(),
		fromAddresses,
		amountDoge: koinuToDoge(amountKoinu),
		amountKoinu,
		confirmations,
		time: txTimeMs({ time: Date.parse(confirmedAt || '') || undefined, confirmed: confirmedAt, received: raw.received }),
		confirmed: confirmations > 0,
	};
}

function parseBlockCypherAddress(payload, payTo) {
	const txs = (payload && Array.isArray(payload.txs) ? payload.txs : [])
		.map((row) => parseBlockCypherTx(row, payTo))
		.filter((row) => row && row.amountKoinu > 0);
	return txs;
}

function usedTxidSet(entries) {
	const used = new Set();
	for (const entry of entries || []) {
		const txid = String(entry && entry.payTxid || '').trim().toLowerCase();
		if (looksLikeTxid(txid)) used.add(txid);
	}
	return used;
}

function entryLookbackStart(entry, tournament, lookbackMs, now) {
	const created = Date.parse(entry && entry.createdAt) || now;
	const opened = Date.parse(tournament && tournament.createdAt) || created;
	const start = Math.min(created, opened) - lookbackMs;
	return start;
}

function txPaysEntry(tx, entry, payTo, used, lookbackStart, now) {
	if (!tx || !entry) return false;
	const txid = String(tx.txid || '').toLowerCase();
	if (!looksLikeTxid(txid) || used.has(txid)) return false;
	if (Number(tx.amountKoinu) <= 0) return false;
	if (!amountCovers(tx.amountDoge, entry.amountCrypto)) return false;
	const when = txTimeMs(tx);
	if (when && (when < lookbackStart || when > now + 120000)) return false;
	const from = addrKey(entry.fromWallet);
	if (!from) return false;
	if (!(tx.fromAddresses || []).some((addr) => addrKey(addr) === from)) return false;
	if (payTo && addrKey(payTo) === from) return false;
	return true;
}

/**
 * Oldest unpaid entry that this incoming tx can settle wins the txid.
 * Unconfirmed hits are returned as `seen` and do not consume the txid until they confirm.
 */
function applyIncomingPayments(entries, txs, options) {
	const opts = options || {};
	const payTo = normalizeAddr(opts.payTo);
	const minConfirmations = Math.max(0, Number(opts.minConfirmations) || 1);
	const now = Number(opts.now) || Date.now();
	const lookbackMs = Number(opts.lookbackMs) > 0 ? Number(opts.lookbackMs) : DEFAULT_LOOKBACK_MS;
	const tournament = opts.tournament || null;
	const used = opts.usedTxids || usedTxidSet(entries);
	const confirmed = [];
	const seen = [];
	const pending = (entries || [])
		.filter((entry) => entry && !entry.paid && !entry.noShow && Number(entry.amountCrypto) > 0 && normalizeAddr(entry.fromWallet))
		.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (Number(a.id) - Number(b.id)));

	for (const entry of pending) {
		const start = entryLookbackStart(entry, tournament, lookbackMs, now);
		let best = null;
		for (const tx of txs || []) {
			if (!txPaysEntry(tx, entry, payTo, used, start, now)) continue;
			if (!best || Number(tx.confirmations) > Number(best.confirmations)) best = tx;
		}
		if (!best) continue;
		if (Number(best.confirmations) >= minConfirmations) {
			used.add(best.txid);
			confirmed.push({ entry, tx: best });
		} else {
			seen.push({ entry, tx: best });
		}
	}
	return { confirmed, seen };
}

function findTxById(txs, txid) {
	const wanted = String(txid || '').trim().toLowerCase();
	if (!looksLikeTxid(wanted)) return null;
	return (txs || []).find((tx) => String(tx.txid || '').toLowerCase() === wanted) || null;
}

function matchForcedTxid(entry, tx, options) {
	const opts = options || {};
	if (!entry || !tx) return { ok: false, reason: 'missing' };
	if (opts.usedTxids && opts.usedTxids.has(String(tx.txid).toLowerCase()) && String(entry.payTxid || '').toLowerCase() !== String(tx.txid).toLowerCase()) {
		return { ok: false, reason: 'txid-used' };
	}
	if (!amountCovers(tx.amountDoge, entry.amountCrypto)) {
		return { ok: false, reason: 'amount' };
	}
	const from = addrKey(entry.fromWallet);
	const senders = (tx.fromAddresses || []).map(addrKey);
	if (from && senders.length && !senders.includes(from)) {
		return { ok: false, reason: 'from-mismatch', actualFrom: tx.fromAddresses[0] || '' };
	}
	return { ok: true, tx };
}

function stampSeen(entry, tx) {
	entry.payTxid = tx.txid;
	entry.payConfirmations = Number(tx.confirmations) || 0;
	entry.payWatchStatus = 'seen';
	return entry;
}

function stampConfirmed(entry, tx, at) {
	const when = at || new Date().toISOString();
	entry.paid = true;
	entry.status = 'confirmed';
	entry.paidAt = when;
	entry.payTxid = tx.txid;
	entry.payConfirmations = Number(tx.confirmations) || 0;
	entry.payWatchStatus = 'confirmed';
	entry.payVerifiedAt = when;
	return entry;
}

function applyMatchResult(entries, result, at) {
	let changed = 0;
	for (const row of result.seen || []) {
		const live = (entries || []).find((entry) => entry && entry.id === row.entry.id) || row.entry;
		if (live.paid) continue;
		stampSeen(live, row.tx);
		changed += 1;
	}
	for (const row of result.confirmed || []) {
		const live = (entries || []).find((entry) => entry && entry.id === row.entry.id) || row.entry;
		if (live.paid) continue;
		stampConfirmed(live, row.tx, at);
		changed += 1;
	}
	return changed;
}

function blockcypherToken() {
	return String(process.env.BLOCKCYPHER_TOKEN || process.env.DOGE_WATCH_BLOCKCYPHER_TOKEN || '').trim();
}

function explorerUrl(base, extraQuery) {
	const token = blockcypherToken();
	const url = new URL(base);
	if (token) url.searchParams.set('token', token);
	for (const [key, value] of Object.entries(extraQuery || {})) {
		if (value != null && value !== '') url.searchParams.set(key, String(value));
	}
	return url.toString();
}

async function fetchJson(url, fetchFn) {
	const opts = {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'KushMedia-DDLTourney/1.0 (+https://kushmedia.xyz/tourney)',
		},
	};
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		opts.signal = AbortSignal.timeout(12000);
	}
	const res = await fetchFn(url, opts);
	const text = await res.text();
	let data = null;
	try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
	if (!res.ok) {
		const err = new Error(`Explorer HTTP ${res.status}`);
		err.status = res.status;
		err.body = data;
		throw err;
	}
	return data;
}

async function fetchIncoming(address, options) {
	const opts = options || {};
	const payTo = normalizeAddr(address);
	if (!looksLikeDogeAddress(payTo)) {
		throw Object.assign(new Error('Tournament DOGE address is invalid'), { status: 500 });
	}
	const fetchFn = opts.fetch || globalThis.fetch;
	if (typeof fetchFn !== 'function') {
		throw new Error('fetch is not available');
	}
	const txid = String(opts.txid || '').trim();
	const now = Date.now();
	const cacheMs = Number(opts.cacheMs) >= 0 ? Number(opts.cacheMs) : DEFAULT_CACHE_MS;
	const cacheKey = addrKey(payTo);
	if (!txid && cacheMs > 0) {
		const hit = incomingCache.get(cacheKey);
		if (hit && now - hit.at < cacheMs) return hit.txs;
	}

	let txs = [];
	try {
		const payload = await fetchJson(
			explorerUrl(`https://api.blockcypher.com/v1/doge/main/addrs/${encodeURIComponent(payTo)}/full`, { limit: 50 }),
			fetchFn,
		);
		txs = parseBlockCypherAddress(payload, payTo);
	} catch (err) {
		if (!txid) throw err;
	}

	if (looksLikeTxid(txid) && !findTxById(txs, txid)) {
		const payload = await fetchJson(
			explorerUrl(`https://api.blockcypher.com/v1/doge/main/txs/${encodeURIComponent(txid)}`),
			fetchFn,
		);
		const parsed = parseBlockCypherTx(payload, payTo);
		if (parsed) txs = [parsed, ...txs.filter((row) => row.txid !== parsed.txid)];
	}

	if (!txid && cacheMs > 0) incomingCache.set(cacheKey, { at: now, txs });
	return txs;
}

function clearIncomingCache() {
	incomingCache.clear();
}

function minConfirmationsFromEnv() {
	const n = Number(process.env.DOGE_WATCH_MIN_CONF);
	return Number.isFinite(n) && n >= 0 ? n : 1;
}

function watchEnabledFromEnv() {
	return !/^(0|false|off|no)$/i.test(String(process.env.DOGE_WATCH || '1'));
}

module.exports = {
	KOINU,
	looksLikeDogeAddress,
	looksLikeTxid,
	normalizeAddr,
	addrKey,
	toKoinu,
	koinuToDoge,
	amountCovers,
	parseBlockCypherTx,
	parseBlockCypherAddress,
	usedTxidSet,
	applyIncomingPayments,
	findTxById,
	matchForcedTxid,
	stampSeen,
	stampConfirmed,
	applyMatchResult,
	fetchIncoming,
	clearIncomingCache,
	minConfirmationsFromEnv,
	watchEnabledFromEnv,
};
