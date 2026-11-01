'use strict';

/**
 * Shared Content-Security-Policy.
 * 'unsafe-inline' stays until inline scripts are moved out of about.html,
 * services.html, orders.html, gallery.html, community-suggestions.html,
 * projects/tile-cnc.html, and the admin panel. TODO: drop it after that.
 * script.google.com stays because services.html and orders.html post orders there.
 */
const DOGIDEX_SUPABASE_HOST = 'tblktaifczarnesqucwz.supabase.co';

function contentSecurityPolicy() {
	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://api.mapbox.com https://challenges.cloudflare.com https://ddltcg.kushmetax.com",
		"script-src-elem 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://api.mapbox.com https://challenges.cloudflare.com https://ddltcg.kushmetax.com",
		"script-src-attr 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com",
		"style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com",
		"font-src 'self' https://fonts.gstatic.com data:",
		"img-src 'self' data: blob: https://kushmedia.xyz https://ddltcg.kushmetax.com https://ddltcg.com https://market.doginaldogs.com https://doginaldogs.com https://assets.coingecko.com https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://cdn.discordapp.com https://media.discordapp.net",
		`connect-src 'self' https://script.google.com https://script.googleusercontent.com https://challenges.cloudflare.com https://market.doginaldogs.com https://${DOGIDEX_SUPABASE_HOST} wss://${DOGIDEX_SUPABASE_HOST} https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com`,
		"media-src 'self' blob:",
		"worker-src 'self' blob:",
		"frame-src 'self' https://kick.com https://*.kick.com",
		"frame-ancestors 'none'",
		"form-action 'self' https://script.google.com",
		"object-src 'none'",
		"base-uri 'self'",
		'upgrade-insecure-requests',
	].join('; ');
}

module.exports = {
	DOGIDEX_SUPABASE_HOST,
	contentSecurityPolicy,
};
