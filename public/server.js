'use strict';

/**
 * Root entrypoint — loads `server/index.js` (Express app).
 * Uses this file when `require.main` must be the repo root (e.g. `npm start`).
 */

require('dotenv').config();

const ddEvaluatorRouter = require('./server/routes/dd-evaluator');
const app = require('./server/index.js');

/**
 * Passenger (CloudLinux/Phusion) sets PORT to the value it allocated — either a numeric
 * TCP port or a Unix-domain-socket path. We MUST listen on that exact value and MUST NOT
 * force a host binding (0.0.0.0 fails on shared LVE; UDS paths aren't numeric).
 *
 * Local fallback: only when PORT is absent we bind a TCP port we control.
 */
function startServer() {
	const cb = () => {
		console.log('KushBrand server listening (passenger=' + Boolean(process.env.PASSENGER_BASE_URI || process.env.PORT) + ')');
		ddEvaluatorRouter.initEvaluator().catch(err => console.error('[dd-evaluator] Init failed:', err.message));
		const uiPw = ddEvaluatorRouter.getAdminUiPassword();
		const traitPw = ddEvaluatorRouter.getExpectedDdAdminPassword();
		if (uiPw && traitPw && uiPw !== traitPw) {
			console.log('[dd-evaluator] DD_ADMIN_UI_PASSWORD and DD_ADMIN_PASSWORD both set and differ — API saves use the trait secret (DD_ADMIN_PASSWORD), not the UI Basic gate.');
		}
		if (ddEvaluatorRouter.getCommunitySubmitPassword()) {
			console.log('[dd-evaluator] Community suggestion submissions require DD_COMMUNITY_PASSWORD.');
		}
	};

	if (process.env.PORT) {
		app.listen(process.env.PORT, cb);
		return;
	}

	const port = Number.parseInt('3000', 10);
	const host = process.env.HOST || '127.0.0.1';
	app.listen(port, host, cb);
}

startServer();
