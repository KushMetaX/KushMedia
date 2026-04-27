"use strict";

const path = require('path');

const dotenv = require('dotenv');
const express = require('express');

const nailDesignerRouter = require('./routes/nail-designer');
const ddEvaluatorRouter = require('./routes/dd-evaluator');

dotenv.config();

const app = express();
const rootDir = path.resolve(__dirname, '..');
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '100kb' }));

app.use((request, response, next) => {
	response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.set('X-Content-Type-Options', 'nosniff');
	response.set('Cross-Origin-Resource-Policy', 'same-origin');
	next();
});

app.use((request, response, next) => {
	if (request.path.startsWith('/server') || request.path.startsWith('/node_modules') || request.path.startsWith('/DD%20Price')) {
		response.status(404).send('Not found');
		return;
	}

	next();
});

app.use('/api/nail-designer', nailDesignerRouter);
app.use('/api/dd-evaluator', ddEvaluatorRouter);

app.get('/healthz', (request, response) => {
  response.json({ ok: true, service: 'kushbrand-site' });
});

app.get('/nail-designer', (request, response) => {
	response.sendFile(path.join(rootDir, 'nail-designer', 'index.html'));
});

app.get('/dd-evaluator', (request, response) => {
	response.sendFile(path.join(rootDir, 'dd-evaluator', 'index.html'));
});

app.use(express.static(rootDir, {
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
		// Start DD evaluator snapshot refresh loop in background
		const { initEvaluator } = require('./routes/dd-evaluator');
		initEvaluator().catch(err => console.error('[dd-evaluator] Init failed:', err.message));
	});
}

module.exports = app;
