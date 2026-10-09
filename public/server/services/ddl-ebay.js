'use strict';

/**
 * eBay Buy APIs for DDL TCG market data.
 *   Browse API               → active listings (asks). Needs EBAY_CLIENT_ID + EBAY_CLIENT_SECRET.
 *   Marketplace Insights API → sold listings (last 90 days). Needs eBay to approve the app for
 *                              the buy.marketplace.insights scope; 403 until then.
 * eBay's search pages block server fetches (403), so the APIs are the only supported path.
 */

const API_ROOT = 'https://api.ebay.com';
const SCOPE_BASE = 'https://api.ebay.com/oauth/api_scope';
const SCOPE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';
const PAGE_LIMIT = 200;
const MAX_PAGES = 3;
const TIMEOUT_MS = 20000;

const DEFAULT_QUERIES = [
	'doginal dogs legends',
	'doginal dogs tcg',
	'doginal dogs card',
	'ddl tcg',
	'rise of the pack doginal',
];

const tokens = new Map();

function credentials() {
	const id = String(process.env.EBAY_CLIENT_ID || '').trim();
	const secret = String(process.env.EBAY_CLIENT_SECRET || '').trim();
	return id && secret ? { id, secret } : null;
}

function marketplace() {
	return String(process.env.EBAY_MARKETPLACE_ID || 'EBAY_US').trim() || 'EBAY_US';
}

function queries() {
	const raw = String(process.env.DDL_EBAY_QUERIES || '').trim();
	if (!raw) return DEFAULT_QUERIES;
	return raw.split('|').map((q) => q.trim()).filter(Boolean);
}

function isConfigured() {
	return Boolean(credentials());
}

async function fetchJson(url, init) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { ...init, signal: ctrl.signal });
		const text = await res.text();
		let body = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch (_err) {
			body = null;
		}
		if (!res.ok) {
			const msg = body && Array.isArray(body.errors) && body.errors[0]
				? body.errors[0].longMessage || body.errors[0].message
				: (body && (body.error_description || body.error)) || `HTTP ${res.status}`;
			throw Object.assign(new Error(msg), { status: res.status });
		}
		return body;
	} finally {
		clearTimeout(timer);
	}
}

async function accessToken(scope) {
	const creds = credentials();
	if (!creds) throw Object.assign(new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set'), { status: 0 });
	const cached = tokens.get(scope);
	if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
	const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');
	const body = await fetchJson(`${API_ROOT}/identity/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
	});
	const token = body && body.access_token;
	if (!token) throw new Error('eBay OAuth returned no access token');
	tokens.set(scope, { token, expiresAt: Date.now() + (Number(body.expires_in) || 7200) * 1000 });
	return token;
}

function money(obj) {
	if (!obj || obj.value == null) return null;
	const value = Number(obj.value);
	return Number.isFinite(value) ? { value, currency: String(obj.currency || 'USD') } : null;
}

function shippingOf(item) {
	const opts = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
	const costs = opts.map((o) => money(o.shippingCost)).filter(Boolean).map((m) => m.value);
	return costs.length ? Math.min(...costs) : null;
}

function activeRow(item) {
	const price = money(item.price) || money(item.currentBidPrice);
	if (!price) return null;
	return {
		itemId: String(item.itemId || item.legacyItemId || ''),
		title: String(item.title || ''),
		price: price.value,
		currency: price.currency,
		shipping: shippingOf(item),
		url: item.itemWebUrl || item.itemAffiliateWebUrl || null,
		image: item.image && item.image.imageUrl ? item.image.imageUrl : null,
		condition: item.condition || null,
		buying: Array.isArray(item.buyingOptions) ? item.buyingOptions : [],
		bids: item.bidCount != null ? Number(item.bidCount) : null,
		endsAt: item.itemEndDate || null,
		seller: item.seller && item.seller.username ? item.seller.username : null,
	};
}

function soldRow(item) {
	const price = money(item.lastSoldPrice) || money(item.price);
	if (!price) return null;
	return {
		itemId: String(item.itemId || item.legacyItemId || ''),
		title: String(item.title || ''),
		price: price.value,
		currency: price.currency,
		shipping: shippingOf(item),
		url: item.itemWebUrl || item.itemHref || null,
		image: item.image && item.image.imageUrl ? item.image.imageUrl : null,
		condition: item.condition || null,
		soldAt: item.lastSoldDate || null,
		soldQty: item.totalSoldQuantity != null ? Number(item.totalSoldQuantity) : 1,
		buying: Array.isArray(item.buyingOptions) ? item.buyingOptions : [],
	};
}

async function pagedSearch(path, scope, listKey, mapRow) {
	const token = await accessToken(scope);
	const seen = new Map();
	for (const q of queries()) {
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const url = new URL(API_ROOT + path);
			url.searchParams.set('q', q);
			url.searchParams.set('limit', String(PAGE_LIMIT));
			url.searchParams.set('offset', String(page * PAGE_LIMIT));
			const body = await fetchJson(url.toString(), {
				headers: {
					Authorization: `Bearer ${token}`,
					'X-EBAY-C-MARKETPLACE-ID': marketplace(),
					Accept: 'application/json',
				},
			});
			const items = body && Array.isArray(body[listKey]) ? body[listKey] : [];
			for (const item of items) {
				const row = mapRow(item);
				if (row && row.itemId && !seen.has(row.itemId)) seen.set(row.itemId, row);
			}
			const total = Number(body && body.total) || 0;
			if (items.length < PAGE_LIMIT || (page + 1) * PAGE_LIMIT >= total) break;
		}
	}
	return [...seen.values()];
}

function searchActive() {
	return pagedSearch('/buy/browse/v1/item_summary/search', SCOPE_BASE, 'itemSummaries', activeRow);
}

function searchSold() {
	return pagedSearch('/buy/marketplace_insights/v1_beta/item_sales/search', SCOPE_INSIGHTS, 'itemSales', soldRow);
}

module.exports = {
	isConfigured,
	searchActive,
	searchSold,
	queries,
	marketplace,
};
