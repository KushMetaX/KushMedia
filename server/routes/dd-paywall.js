'use strict';

const authDexRouter = require('./auth-dex');

const ddQuotaBuckets = new Map();

function utcDateKey() {
	return new Date().toISOString().slice(0, 10);
}

function inboundIp(req) {
	const xf = String(req.headers['x-forwarded-for'] || '').trim();
	if (xf) {
		const first = xf.split(',')[0].trim();
		if (first) return first;
	}
	const rip = req.socket && req.socket.remoteAddress;
	return rip ? String(rip) : req.ip ? String(req.ip) : 'unknown';
}

function freeDailyInscriptions() {
	const n = Number.parseInt(process.env.DD_FREE_INSCRIPTION_PER_DAY || '2', 10);
	return Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 2;
}

function freeDailyRarity() {
	const n = Number.parseInt(process.env.DD_FREE_RARITY_LOOKUPS_PER_DAY || '1', 10);
	return Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 1;
}

function quotaStoreKey(day, ipAddr) {
	return `${day}|${ipAddr}`;
}

function getOrResetBucket(day, ipAddr) {
	const k = quotaStoreKey(day, ipAddr);
	let b = ddQuotaBuckets.get(k);
	if (!b || b.day !== day) {
		b = { day, inscribe: 0, rarity: 0 };
		ddQuotaBuckets.set(k, b);
	}
	return b;
}

function freeAccessEnabled() {
	return /^(1|true|yes)$/i.test(
		String(process.env.DD_FREE_USE || process.env.DD_FREE_ALL || process.env.DD_FREE_EVERYONE || '').trim(),
	);
}

function ddPlusFromRequest(req) {
	if (freeAccessEnabled()) {
		return true;
	}

	const db = authDexRouter.tryGetDdDatabaseForPaywall();
	if (!db) {
		return false;
	}
	try {
		const row = authDexRouter.ddSessionRow(db, req.signedCookies);
		if (!row) {
			return false;
		}
		return authDexRouter.userHasDdPlus(db, row.user_id);
	} catch (_e) {
		return false;
	}
}

/**
 * Applies to GET /evaluate/:dogNumber — pass ?quotaMode=inscription|rarity.
 * Rare flow should call evaluate once with quotaMode=rarity after rank lookup resolved the dog number server-side earlier.
 */
function mwEvaluateDog() {
	return function ddEvalQuota(req, res, next) {
		if (ddPlusFromRequest(req)) {
			return next();
		}
		const raw = req.query.quotaMode != null ? String(req.query.quotaMode) : 'inscription';
		const rarityMode = raw.toLowerCase() === 'rarity';
		const bucketKey = rarityMode ? 'rarity' : 'inscribe';
		const cap = rarityMode ? freeDailyRarity() : freeDailyInscriptions();

		const ip = inboundIp(req);
		const bucket = getOrResetBucket(utcDateKey(), ip);

		res.setHeader('DD-Quota-Free-Limit-Inscribe', String(freeDailyInscriptions()));
		res.setHeader('DD-Quota-Free-Limit-Rarity', String(freeDailyRarity()));
		res.setHeader('DD-Quota-Free-Ip', ip);

		if (cap === 0) {
			res.status(429).json({
				code: 'dd_guest_quota_exceeded',
				error:
					bucketKey === 'rarity'
						? 'Rarity valuations are gated for guests. KushMetaX Doginal Dogs Plus unlocks unlimited access.'
						: 'Inscription valuations are gated for guests. KushMetaX Doginal Dogs Plus unlocks unlimited access.',
			});
			return;
		}

		const used = bucketKey === 'rarity' ? bucket.rarity : bucket.inscribe;
		if (used >= cap) {
			res.status(429).json({
				code: 'dd_guest_quota_exceeded',
				error:
					bucketKey === 'rarity'
						? `Free tier allows ${cap} rarity-rank valuations per UTC day at this IP (${ip}). Subscribe for unlimited valuations and wallet estimates.`
						: `Free tier allows ${cap} inscription valuations per UTC day at this IP (${ip}). Subscribe for unlimited valuations and wallet estimates.`,
			});
			return;
		}

		if (bucketKey === 'rarity') {
			bucket.rarity += 1;
		} else {
			bucket.inscribe += 1;
		}

		next();
	};
}

function mwWallet() {
	return function ddWalletMw(req, res, next) {
		if (ddPlusFromRequest(req)) {
			return next();
		}
		res.status(403).json({
			code: 'dd_wallet_plus_only',
			error:
				'Wallet portfolio valuations are exclusive to KushMetaX Doginal Dogs Plus subscribers.',
		});
	};
}

function mwBatchEvaluate() {
	return function ddBatchMw(req, res, next) {
		if (ddPlusFromRequest(req)) {
			return next();
		}
		res.status(403).json({
			code: 'dd_batch_plus_only',
			error:
				'Batch evaluation unlocks automatically after KushMetaX Doginal Dogs Plus is active.',
		});
	};
}

module.exports = {
	mwEvaluateDog,
	mwWallet,
	mwBatchEvaluate,
	inboundIp,
};
