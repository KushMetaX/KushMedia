'use strict';

/**
 * Root entrypoint — loads `server/index.js` (Express app).
 * Uses this file when `require.main` must be the repo root (e.g. `npm start`).
 */

require('dotenv').config();

const ddEvaluatorRouter = require('./server/routes/dd-evaluator');
const app = require('./server/index.js');

const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

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
