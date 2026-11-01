'use strict';

/*
 * Plus paywall removed. Valuations and wallet estimates are free.
 * These middlewares are sliding-window rate limits (per IP and, when a
 * km_sid session exists, per account). A 429 includes Retry-After.
 *
 * Window: 10 minutes.
 *   evaluate / rank lookup: 30 / IP, 60 / account
 *   wallet / owner search:  10 / IP, 20 / account
 *   batch evaluate:          6 / IP, 12 / account
 *   trait search:           20 / IP, 40 / account
 */

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = {
	evaluate: { ip: 30, account: 60 },
	wallet: { ip: 10, account: 20 },
	batch: { ip: 6, account: 12 },
	trait: { ip: 20, account: 40 },
};

const buckets = new Map();

function inboundIp(req) {
	const xf = String(req.headers['x-forwarded-for'] || '').trim();
	if (xf) {
		const first = xf.split(',')[0].trim();
		if (first) return first;
	}
	const rip = req.socket && req.socket.remoteAddress;
	return rip ? String(rip) : req.ip ? String(req.ip) : 'unknown';
}

function accountKey(req) {
	const sid = req.signedCookies && req.signedCookies.km_sid;
	if (sid && typeof sid === 'string') return sid;
	return null;
}

function slidingHit(key, max) {
	const now = Date.now();
	let arr = buckets.get(key);
	if (!arr) arr = [];
	const fresh = [];
	for (let i = 0; i < arr.length; i += 1) {
		if (now - arr[i] < WINDOW_MS) fresh.push(arr[i]);
	}
	if (fresh.length >= max) {
		buckets.set(key, fresh);
		const retryMs = WINDOW_MS - (now - fresh[0]);
		return { limited: true, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
	}
	fresh.push(now);
	buckets.set(key, fresh);
	return { limited: false };
}

function guard(kind) {
	const lim = LIMITS[kind];
	return function ddRateLimit(req, res, next) {
		const ip = inboundIp(req);
		const ipHit = slidingHit(`${kind}:ip:${ip}`, lim.ip);
		if (ipHit.limited) {
			res.set('Retry-After', String(ipHit.retryAfterSec));
			return res.status(429).json({
				error: 'Too many requests from this network. Please wait a few minutes and try again.',
				retryAfterSec: ipHit.retryAfterSec,
			});
		}
		const acct = accountKey(req);
		if (acct) {
			const acctHit = slidingHit(`${kind}:acct:${acct}`, lim.account);
			if (acctHit.limited) {
				res.set('Retry-After', String(acctHit.retryAfterSec));
				return res.status(429).json({
					error: 'Too many requests for this account. Please wait a few minutes and try again.',
					retryAfterSec: acctHit.retryAfterSec,
				});
			}
		}
		return next();
	};
}

module.exports = {
	mwEvaluateDog: () => guard('evaluate'),
	mwWallet: () => guard('wallet'),
	mwBatchEvaluate: () => guard('batch'),
	mwTraitSearch: () => guard('trait'),
	inboundIp,
};
