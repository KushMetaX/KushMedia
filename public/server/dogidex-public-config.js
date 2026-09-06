'use strict';

/**
 * Browser-safe DogiDex config (anon role only). Never put service_role here.
 * Values come from env at process start — do not hardcode the JWT in HTML.
 */
function getDogidexPublicConfig() {
	const url = String(
		process.env.DOGIDEX_SUPABASE_URL || process.env.SUPABASE_URL || '',
	).replace(/\/+$/, '');
	const anonKey = String(
		process.env.DOGIDEX_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
	).trim();
	const emailRedirectUrl = String(
		process.env.DOGIDEX_EMAIL_REDIRECT_URL || '',
	).trim().replace(/\/+$/, '') || 'https://kushmedia.xyz/dd-evaluator';
	return { url, anonKey, emailRedirectUrl };
}

function configJsBody() {
	const cfg = getDogidexPublicConfig();
	return (
		'window.__DOGIDEX_SUPABASE__ = Object.assign('
		+ JSON.stringify(cfg)
		+ ', window.__DOGIDEX_SUPABASE__ || {});\n'
	);
}

function sendConfigJs(_request, response) {
	response.set('Cache-Control', 'no-store, private');
	response.type('application/javascript; charset=utf-8');
	response.send(configJsBody());
}

module.exports = {
	getDogidexPublicConfig,
	configJsBody,
	sendConfigJs,
};
