'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/** Private app root (parent of this folder): /home/kushmetax/kushmedia-app */
const appRoot = path.resolve(__dirname, '..');
const envFile = path.join(appRoot, '.env');
if (fs.existsSync(envFile)) {
	dotenv.config({ path: envFile, override: false });
}

/**
 * Same rule as resolveSiteRoot() in index.js.
 * SITE_ROOT wins. Otherwise the static site on the host.
 */
function resolveSiteRoot() {
	const fromEnv = String(process.env.SITE_ROOT || '').trim();
	if (fromEnv) return path.resolve(fromEnv);
	return '/home/kushmetax/public_html';
}

module.exports = resolveSiteRoot();
