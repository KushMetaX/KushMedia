'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const dogePayWatch = require('../public/server/lib/doge-pay-watch');
const createRouter = require('../public/server/routes/tourney-bracket');

const PAY_TO = 'DD4KcuppEUBR8vETG46d4w8BcgvDkzbss2';
const FROM = 'D7G5HNDjvbSjxo5tGa9KA4GNtAXfBpipvi';
const OTHER = 'DDKushPayWatchTestAddress1111111111';
const TXID = 'f272ec3125f74888703d6bfaa45564a6db36e8a79b90dd7157db00d88719f9e3';

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

const sampleTx = {
	hash: TXID,
	confirmed: new Date().toISOString(),
	received: new Date().toISOString(),
	confirmations: 3,
	inputs: [{ addresses: [FROM], output_value: 65693807067 }],
	outputs: [
		{ value: 22000000000, addresses: [PAY_TO] },
		{ value: 43682331990, addresses: [FROM] },
	],
};

function parsedSample(overrides) {
	return Object.assign(dogePayWatch.parseBlockCypherTx(sampleTx, PAY_TO), overrides || {});
}

function runMatcherTests() {
	const parsed = dogePayWatch.parseBlockCypherTx(sampleTx, PAY_TO);
	check('parses BlockCypher incoming amount as 220 DOGE', parsed && parsed.amountDoge === 220, parsed && parsed.amountDoge);
	check('parses sender', parsed && parsed.fromAddresses[0] === FROM, parsed && parsed.fromAddresses.join(','));
	check('real treasury is a DOGE address', dogePayWatch.looksLikeDogeAddress(PAY_TO));
	check('test WALLET- strings are not treated as chain addresses', !dogePayWatch.looksLikeDogeAddress('WALLET-Kush-0000'));

	const now = Date.now();
	const entry = {
		id: 1,
		handle: 'Kush',
		fromWallet: FROM,
		amountCrypto: 220,
		paid: false,
		createdAt: new Date(now).toISOString(),
	};
	const hit = dogePayWatch.applyIncomingPayments([entry], [parsed], {
		payTo: PAY_TO,
		minConfirmations: 1,
		now,
	});
	check('matching from-wallet + amount confirms', hit.confirmed.length === 1 && hit.confirmed[0].tx.txid === TXID);

	const short = dogePayWatch.applyIncomingPayments([{ ...entry, amountCrypto: 400 }], [parsed], {
		payTo: PAY_TO,
		minConfirmations: 1,
		now,
	});
	check('underpayment is ignored', short.confirmed.length === 0 && short.seen.length === 0);

	const wrong = dogePayWatch.applyIncomingPayments([{ ...entry, fromWallet: OTHER }], [parsed], {
		payTo: PAY_TO,
		minConfirmations: 1,
		now,
	});
	check('wrong sending wallet is ignored', wrong.confirmed.length === 0);

	const unconfirmed = parsedSample({ confirmations: 0 });
	const seen = dogePayWatch.applyIncomingPayments([entry], [unconfirmed], {
		payTo: PAY_TO,
		minConfirmations: 1,
		now,
	});
	check('0-conf is seen, not paid', seen.confirmed.length === 0 && seen.seen.length === 1);

	const first = { ...entry, id: 1, createdAt: new Date(now - 1000).toISOString() };
	const second = { ...entry, id: 2, createdAt: new Date(now).toISOString() };
	const fifo = dogePayWatch.applyIncomingPayments([second, first], [parsed], {
		payTo: PAY_TO,
		minConfirmations: 1,
		now,
	});
	check('oldest unpaid entry wins a shared sending wallet', fifo.confirmed.length === 1 && fifo.confirmed[0].entry.id === 1);

	const used = dogePayWatch.applyIncomingPayments(
		[entry, { ...entry, id: 9, paid: true, payTxid: TXID }],
		[parsed],
		{ payTo: PAY_TO, minConfirmations: 1, now },
	);
	check('already-used txid is not assigned twice', used.confirmed.length === 0);

	const mismatch = dogePayWatch.matchForcedTxid({ ...entry, fromWallet: OTHER }, parsed, { usedTxids: new Set() });
	check('forced txid with a different sender is a mismatch', mismatch.ok === false && mismatch.reason === 'from-mismatch');
	const forced = dogePayWatch.matchForcedTxid(entry, parsed, { usedTxids: new Set() });
	check('forced txid with the right sender matches', forced.ok === true);
}

function call(server, method, urlPath, body, headers) {
	const payload = body ? JSON.stringify(body) : null;
	const { port } = server.address();
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: '127.0.0.1',
			port,
			method,
			path: `/tourney-api${urlPath}`,
			headers: {
				'Content-Type': 'application/json',
				...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
				...(headers || {}),
			},
		}, (res) => {
			let text = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => { text += chunk; });
			res.on('end', () => {
				let data = null;
				try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
				resolve({ status: res.statusCode, data, text });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

async function runRouteTests() {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-doge-watch-'));
	fs.writeFileSync(path.join(dataDir, '.tourney-password'), 'test-host-pw\n');
	const now = new Date().toISOString();
	fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify({
		nextId: 3,
		tournaments: [{
			id: 1,
			slug: 'watch-cup',
			name: 'Watch Cup',
			format: 'single_elim',
			status: 'registration',
			feeMode: 'paid',
			entryFeeUsd: 5,
			maxPlayers: 8,
			registrationMode: 'signup',
			requireAccount: false,
			treasury: PAY_TO,
			createdAt: now,
		}],
		entries: [{
			id: 2,
			tournamentId: 1,
			handle: 'Kush',
			fromWallet: FROM,
			wallet: FROM,
			payAsset: 'DOGE',
			payTo: PAY_TO,
			paid: false,
			status: 'pending',
			invoiceCode: 'DDL-WATCH01',
			amountUsd: 5,
			amountCrypto: 220,
			createdAt: now,
		}],
		matches: [],
		votes: [],
		predictions: [],
	}, null, 2));

	const txs = [parsedSample({ confirmations: 4, time: Date.now() })];
	const app = express();
	app.use(express.json());
	app.use('/tourney-api', createRouter({
		dataDir,
		dogeWatch: {
			enabled: false,
			fetchIncoming: async () => txs,
		},
	}));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const visitor = await call(server, 'GET', '/arenas/watch-cup');
		check('visitor still cannot see the sending wallet', visitor.status === 200 && !visitor.data.entries[0].fromWallet, JSON.stringify(visitor.data.entries[0]));

		const claimed = await call(server, 'GET', '/arenas/watch-cup', null, { 'x-tourney-invoice': 'DDL-WATCH01' });
		check('invoice header reveals the owner wallet', claimed.status === 200 && claimed.data.entries[0].fromWallet === FROM, JSON.stringify(claimed.data.entries[0]));

		const checked = await call(server, 'POST', '/arenas/watch-cup/check-payment', { invoiceCode: 'DDL-WATCH01' });
		check('check-payment auto-confirms a matching on-chain send', checked.status === 200 && checked.data.paid === true, checked.text.slice(0, 240));
		check('confirmed entry is marked paid on the roster', Boolean(checked.data.entries && checked.data.entries[0] && checked.data.entries[0].paid), checked.text.slice(0, 240));
		check('txid is stored on the entry', checked.data.payTxid === TXID, JSON.stringify(checked.data.payTxid));
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function main() {
	runMatcherTests();
	await runRouteTests();
	if (failures) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
