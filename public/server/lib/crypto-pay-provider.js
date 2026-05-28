'use strict';

const crypto = require('crypto');

/** NOWPayments-class aggregator: sandbox vs production API base. */
function apiBase() {
	const sandbox = /^(1|true|yes)$/i.test(String(process.env.CRYPTO_PAY_SANDBOX || ''));
	return sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

function apiKey() {
	return String(process.env.CRYPTO_PAY_API_KEY || '').trim();
}

function ipnSecret() {
	return String(process.env.CRYPTO_PAY_IPN_SECRET || '').trim();
}

function sortObjectDeep(obj) {
	if (obj === null || typeof obj !== 'object') {
		return obj;
	}
	if (Array.isArray(obj)) {
		return obj.map(sortObjectDeep);
	}
	return Object.keys(obj)
		.sort()
		.reduce((acc, k) => {
			acc[k] = sortObjectDeep(obj[k]);
			return acc;
		}, {});
}

/**
 * IPN: HMAC-SHA512 of JSON.stringify(sortedDeepClone(body)) with IPN secret; compare to x-nowpayments-sig.
 * @param {string} rawBodyUtf8
 * @param {string|undefined} sigHeader
 * @param {string} secret
 */
function verifyIpnSignature(rawBodyUtf8, sigHeader, secret) {
	if (!secret || !sigHeader || !rawBodyUtf8) {
		return false;
	}
	let parsed;
	try {
		parsed = JSON.parse(rawBodyUtf8);
	} catch (_e) {
		return false;
	}
	const sorted = sortObjectDeep(parsed);
	const str = JSON.stringify(sorted);
	const h = crypto.createHmac('sha512', secret).update(str).digest('hex');
	const recv = String(sigHeader).toLowerCase().trim();
	try {
		const a = Buffer.from(h, 'utf8');
		const b = Buffer.from(recv, 'utf8');
		if (a.length !== b.length) {
			return false;
		}
		return crypto.timingSafeEqual(a, b);
	} catch (_e2) {
		return false;
	}
}

async function npRequest(method, pathFragment, bodyObj) {
	const key = apiKey();
	if (!key) {
		throw new Error('CRYPTO_PAY_API_KEY is not set.');
	}
	const url = `${apiBase()}${pathFragment.startsWith('/') ? pathFragment : `/${pathFragment}`}`;
	const opts = {
		method,
		headers: {
			'x-api-key': key,
			'Content-Type': 'application/json',
		},
	};
	if (bodyObj != null && method !== 'GET' && method !== 'HEAD') {
		opts.body = JSON.stringify(bodyObj);
	}
	const res = await fetch(url, opts);
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch (_p) {
		json = null;
	}
	if (!res.ok) {
		const err = new Error(`NOWPayments ${res.status}: ${text || res.statusText}`);
		/** @type {any} */
		(err).status = res.status;
		/** @type {any} */
		(err).body = json;
		throw err;
	}
	return json;
}

/**
 * @param {object} opts
 * @param {number} opts.priceUsd
 * @param {string} opts.payCurrency e.g. btc
 * @param {string} opts.orderId
 * @param {string} [opts.orderDescription]
 * @param {string} [opts.ipnCallbackUrl]
 * @param {string} [opts.successUrl]
 * @param {string} [opts.cancelUrl]
 */
async function createPayment(opts) {
	const {
		priceUsd,
		payCurrency,
		orderId,
		orderDescription,
		ipnCallbackUrl,
		successUrl,
		cancelUrl,
	} = opts;
	const body = {
		price_amount: priceUsd,
		price_currency: 'usd',
		pay_currency: String(payCurrency || 'btc').toLowerCase(),
		order_id: orderId,
		order_description: orderDescription || 'KushMetaX Doginal Dogs Plus',
	};
	if (ipnCallbackUrl) {
		body.ipn_callback_url = ipnCallbackUrl;
	}
	if (successUrl) {
		body.success_url = successUrl;
	}
	if (cancelUrl) {
		body.cancel_url = cancelUrl;
	}
	return npRequest('POST', '/payment', body);
}

async function getPaymentStatus(providerPaymentId) {
	return npRequest('GET', `/payment/${encodeURIComponent(providerPaymentId)}`, null);
}

module.exports = {
	apiBase,
	apiKey,
	ipnSecret,
	sortObjectDeep,
	verifyIpnSignature,
	createPayment,
	getPaymentStatus,
};
