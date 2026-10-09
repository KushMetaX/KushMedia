'use strict';

/**
 * Official Doginal Dogs shop catalog (shop.doginaldogs.com).
 * Product titles are matched to TCG box, pack, and card prints elsewhere.
 */

const SHOP_ORIGIN = 'https://shop.doginaldogs.com';
const PAGE_LIMIT = 250;
const MAX_PAGES = 5;
const TIMEOUT_MS = 15000;

function productsUrl() {
	return String(process.env.DDL_SHOP_PRODUCTS_URL || `${SHOP_ORIGIN}/products.json`).trim();
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
	let lastError = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				headers: {
					accept: 'application/json',
					'user-agent': 'KushMedia-DDL-Prices/1.0',
				},
				signal: ctrl.signal,
			});
			if (res.status === 429 && attempt < 2) {
				const retryAfter = Number(res.headers.get('retry-after'));
				await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 8) : 2 * (attempt + 1)) * 1000);
				continue;
			}
			if (!res.ok) throw Object.assign(new Error(`Doginal Dogs shop HTTP ${res.status}`), { status: res.status });
			return res.json();
		} catch (err) {
			lastError = err;
			if (attempt >= 2 || err.status === 404) break;
			await sleep(1500 * (attempt + 1));
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError || new Error('Doginal Dogs shop request failed');
}

function variantOffer(product) {
	const variants = Array.isArray(product.variants) ? product.variants : [];
	const priced = variants
		.map((v) => ({ price: Number(v.price), available: v.available !== false }))
		.filter((v) => Number.isFinite(v.price) && v.price > 0);
	if (!priced.length) return null;
	const live = priced.filter((v) => v.available);
	const pool = live.length ? live : priced;
	return { price: Math.min(...pool.map((v) => v.price)), available: live.length > 0 };
}

function rowFrom(product) {
	const vendor = String(product.vendor || '').trim().toLowerCase();
	if (vendor && !vendor.includes('doginal')) return null;
	const offer = variantOffer(product);
	const title = String(product.title || '').trim();
	if (!offer || !title) return null;
	const handle = String(product.handle || '').trim();
	const image = Array.isArray(product.images) && product.images[0] && product.images[0].src
		? String(product.images[0].src)
		: null;
	return {
		itemId: `shop:${product.id}`,
		title,
		price: offer.price,
		currency: 'USD',
		shipping: 0,
		available: offer.available,
		url: handle ? `${SHOP_ORIGIN}/products/${encodeURIComponent(handle)}` : SHOP_ORIGIN,
		image,
		vendor: String(product.vendor || ''),
		updatedAt: product.updated_at || null,
	};
}

async function listProducts() {
	const rows = [];
	const seen = new Set();
	const base = productsUrl();
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = new URL(base);
		url.searchParams.set('limit', String(PAGE_LIMIT));
		url.searchParams.set('page', String(page));
		const body = await fetchJson(url.toString());
		const products = body && Array.isArray(body.products) ? body.products : [];
		for (const product of products) {
			const row = rowFrom(product);
			if (!row || seen.has(row.itemId)) continue;
			seen.add(row.itemId);
			rows.push(row);
		}
		if (products.length < PAGE_LIMIT) break;
	}
	return rows;
}

module.exports = {
	listProducts,
	productsUrl,
};
