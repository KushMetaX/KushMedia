"use strict";

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const express = require('express');
const cookieParser = require('cookie-parser');

const nailDesignerRouter = require('./routes/nail-designer');
const ddEvaluatorRouter = require('./routes/dd-evaluator');
const authDexRouter = require('./routes/auth-dex');
const { resolveSessionSecret } = require('./session-secret');
const { timingSafeEqualString } = require('./security-utils');

(function loadDotenvFromStandardRoots() {
	const roots = new Set([
		path.resolve(__dirname, '..'),
		path.resolve(__dirname, '..', '..'),
		process.cwd(),
		path.resolve(process.cwd(), 'public'),
	]);
	for (const root of roots) {
		const fp = path.join(root, '.env');
		if (fs.existsSync(fp)) {
			dotenv.config({ path: fp, override: false });
		}
	}
})();

const app = express();
const rootDir = path.resolve(__dirname, '..');
/** Document root (parent of `public/` when Passenger runs the app from `public/`). */
const siteRoot = fs.existsSync(path.join(rootDir, 'index.html'))
	? rootDir
	: path.resolve(rootDir, '..');
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.post(
	'/api/webhooks/crypto-payments',
	express.raw({ type: 'application/json', limit: '512kb' }),
	(req, res) => {
		Promise.resolve(authDexRouter.handleCryptoPayIpn(req, res)).catch((err) => {
			console.error('[crypto-payments webhook]', err && err.message ? err.message : err);
			if (!res.headersSent) {
				res.status(500).send('Webhook handler error');
			}
		});
	},
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser(resolveSessionSecret() || ''));

function pathLooksSensitive(rawPath) {
	if (!rawPath || typeof rawPath !== 'string') {
		return true;
	}
	let decoded;
	try {
		decoded = decodeURIComponent(rawPath.split('?')[0]);
	} catch (_err) {
		return true;
	}
	const normalized = decoded.replace(/\\/g, '/');
	if (normalized.includes('/../') || normalized.includes('\\..')) {
		return true;
	}
	const lower = normalized.toLowerCase();
	const serverBlocked = normalized === '/server' || normalized.startsWith('/server/');
	const nmBlocked = normalized === '/node_modules' || normalized.startsWith('/node_modules/');
	if (
		serverBlocked
		|| nmBlocked
		|| normalized.startsWith('/.git')
		|| lower.includes('/.git/')
		|| lower.endsWith('/.git')
	) {
		return true;
	}
	if (normalized === '/_tools' || normalized.startsWith('/_tools/')) {
		return true;
	}
	if (/DD\s*Price\s*Evaluation/i.test(normalized)) {
		return true;
	}
	return false;
}

app.use((request, response, next) => {
	response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.set('X-Content-Type-Options', 'nosniff');
	response.set('Cross-Origin-Resource-Policy', 'same-origin');
	response.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.set('X-Frame-Options', 'DENY');
	response.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);
	const xfProto = request.get('x-forwarded-proto');
	const secure = request.secure || xfProto === 'https';
	if (secure) {
		response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	next();
});

app.use((request, response, next) => {
	if (request.method === 'TRACE' || request.method === 'TRACK') {
		response.sendStatus(405);
		return;
	}
	next();
});

app.use((request, response, next) => {
	if (pathLooksSensitive(request.path)) {
		response.status(404).send('Not found');
		return;
	}

	next();
});

app.use('/api/nail-designer', nailDesignerRouter);
app.use('/api/dd-evaluator', ddEvaluatorRouter);
app.use('/api/auth', authDexRouter);
/** Same router; `/kmx-auth` avoids LiteSpeed/APACHE trapping `/api/*` for the PHP folder (503 HTML instead of Passenger). */
app.use('/kmx-auth', authDexRouter);
/** Fallback mount if the host blocks or mishandles `/kmx-auth` POST (evaluator retries bridge on HTML error bodies). */
app.use('/kk-auth', authDexRouter);
/** Third mount under the evaluator URL prefix — APISIX/LiteSpeed often proxy `/dd-evaluator/*` differently than `/kmx-auth`. */
app.use('/dd-evaluator/auth', authDexRouter);

app.get('/healthz', (request, response) => {
	response.json({
		ok: true,
		service: 'kushbrand-site',
		// Liveness only; auth is optional for /healthz. See Network tab on POST /kmx-auth/* (or legacy /api/auth/*).
		authSessionConfigured: Boolean(resolveSessionSecret()),
	});
});

app.get('/nail-designer', (request, response) => {
	response.sendFile(path.join(siteRoot, 'nail-designer', 'index.html'));
});

app.get('/dd-evaluator', (request, response) => {
	response.sendFile(path.join(siteRoot, 'dd-evaluator', 'index.html'));
});

app.get('/map', (request, response) => {
	response.sendFile(path.join(siteRoot, 'map', 'index.html'));
});

app.get('/api/voyager/config', (request, response) => {
	const token =
		process.env.MAPBOX_ACCESS_TOKEN ||
		process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
		process.env.VOYAGER_MAPBOX_TOKEN ||
		'';
	response.setHeader('Cache-Control', 'private, max-age=300');
	response.json({ mapboxToken: token });
});

function sendDdAdminHtml(response) {
	response.sendFile(path.join(siteRoot, 'admin.html'), {
		headers: { 'Cache-Control': 'no-store' },
	});
}

app.get('/admin.html', (request, response) => {
	if (/^(1|true|yes)$/i.test(String(process.env.DD_ADMIN_UI_PUBLIC || ''))) {
		sendDdAdminHtml(response);
		return;
	}
	const gate = ddEvaluatorRouter.resolveAdminHtmlGatePassword();
	if (!gate) {
		sendDdAdminHtml(response);
		return;
	}
	const auth = request.headers.authorization;
	if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	let password = '';
	try {
		const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
		const colon = decoded.indexOf(':');
		password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
	} catch (_err) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	if (!timingSafeEqualString(gate, password)) {
		response.set('WWW-Authenticate', 'Basic realm="DD Evaluator Admin"');
		response.set('Cache-Control', 'no-store');
		response.status(401).send('Unauthorized');
		return;
	}
	sendDdAdminHtml(response);
});

app.get('/community-suggestions.html', (request, response) => {
	response.sendFile(path.join(siteRoot, 'community-suggestions.html'));
});

app.use(express.static(siteRoot, {
	dotfiles: 'deny',
	extensions: ['html'],
	setHeaders(response, filePath) {
		if (/\.(?:png|jpg|jpeg|gif|webp|svg|mp4|css|js)$/i.test(filePath)) {
			response.setHeader('Cache-Control', 'public, max-age=86400');
			return;
		}

		if (/\.html$/i.test(filePath)) {
			response.setHeader('Cache-Control', 'no-cache');
		}
	}
}));

if (require.main === module) {
	app.listen(port, host, async () => {
		console.log(`KushBrand server listening on http://${host}:${port}`);
		ddEvaluatorRouter.initEvaluator().catch(err => console.error('[dd-evaluator] Init failed:', err.message));
		const uiPw = ddEvaluatorRouter.getAdminUiPassword();
		const traitPw = ddEvaluatorRouter.getExpectedDdAdminPassword();
		if (uiPw && traitPw && uiPw !== traitPw) {
			console.log('[dd-evaluator] DD_ADMIN_UI_PASSWORD and DD_ADMIN_PASSWORD both set and differ — API saves use the trait secret (DD_ADMIN_PASSWORD), not the UI Basic gate.');
		}
		if (ddEvaluatorRouter.getCommunitySubmitPassword()) {
			console.log('[dd-evaluator] Community suggestion submissions require DD_COMMUNITY_PASSWORD.');
		}
	});
}

module.exports = app;
