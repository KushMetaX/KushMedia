'use strict';

/*
 * Paywall removed: the DD Evaluator is fully open to everyone.
 * These middlewares are kept as no-op pass-throughs so the route wiring in
 * dd-evaluator.js continues to work without any guest quota or Plus gating.
 */

function inboundIp(req) {
	const xf = String(req.headers['x-forwarded-for'] || '').trim();
	if (xf) {
		const first = xf.split(',')[0].trim();
		if (first) return first;
	}
	const rip = req.socket && req.socket.remoteAddress;
	return rip ? String(rip) : req.ip ? String(req.ip) : 'unknown';
}

function openAccess() {
	return function ddOpenAccess(_req, _res, next) {
		next();
	};
}

module.exports = {
	mwEvaluateDog: openAccess,
	mwWallet: openAccess,
	mwBatchEvaluate: openAccess,
	inboundIp,
};
