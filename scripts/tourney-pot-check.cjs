'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');

const HOST_PW = 'test-host-pw';
const ADMIN_PW = 'test-admin-pw';
const dataDir = path.join(__dirname, '..', 'public', 'server', 'data', 'pot-check-tmp');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, '.tourney-password'), `${HOST_PW}\n`);
fs.writeFileSync(path.join(dataDir, '.dd-admin-password'), `${ADMIN_PW}\n`);
fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify({
	nextId: 1,
	tournaments: [],
	entries: [],
	matches: [],
	votes: [],
	predictions: [],
}));

const app = express();
app.use(express.json());
app.use('/tourney-api', createRouter({ dataDir }));

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

function call(server, method, urlPath, body) {
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
				'x-tourney-host': HOST_PW,
				'x-tourney-admin': ADMIN_PW,
				...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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

async function fillRoster(server, slug, handles) {
	for (const handle of handles) {
		const added = await call(server, 'POST', `/arenas/${slug}/add-entry`, { hostPassword: HOST_PW, handle });
		if (added.status !== 200) throw new Error(`add ${handle}: ${added.text}`);
	}
	return call(server, 'GET', `/arenas/${slug}`);
}

async function main() {
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const paid = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Percent Pot',
			slug: 'percent-pot',
			format: 'single_elim',
			feeMode: 'paid',
			entryFeeUsd: 10,
			registrationMode: 'list',
			requireAccount: false,
			rewardMode: 'pot',
			payouts: [{ place: 1, percent: 70 }, { place: 2, percent: 30 }],
			maxPlayers: 8,
		});
		check('paid arenas default the prize pool to 65% of entries', paid.status === 200 && paid.data.potFundMode === 'percent', paid.text.slice(0, 220));

		await fillRoster(server, 'percent-pot', ['Alpha', 'Bravo']);
		const open = await call(server, 'GET', '/arenas/percent-pot');
		check('pot is 65% of $20 raised, not the $20 total', open.status === 200 && open.data.prizePool === 13 && open.data.rewards.feesCollected === 20 && open.data.rewards.houseRetainUsd === 7, JSON.stringify(open.data && open.data.rewards));
		check('place percents split the redistributed pot', open.data.rewards.rows[0].amountUsd === 9.1 && open.data.rewards.rows[1].amountUsd === 3.9, JSON.stringify(open.data && open.data.rewards.rows));

		const cash = await call(server, 'POST', '/arenas/percent-pot/settings', {
			hostPassword: HOST_PW,
			potFundMode: 'usd',
			hostPotUsd: 50,
		});
		check('host can swap to a dollar pot that ignores entry fees', cash.status === 200 && cash.data.prizePool === 50 && cash.data.tournament.potFundMode === 'usd' && cash.data.rewards.rows[0].amountUsd === 35, JSON.stringify(cash.data && cash.data.rewards));

		const house = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'House Dollars',
			slug: 'house-dollars',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			rewardMode: 'pot',
			hostPotUsd: 100,
			payouts: [{ place: 1, percent: 100 }],
			maxPlayers: 8,
		});
		check('free house pots stay on the dollar amount', house.status === 200 && house.data.potFundMode === 'usd' && house.data.hostPotUsd === 100, house.text.slice(0, 180));
		await fillRoster(server, 'house-dollars', ['Casa', 'Casa2']);
		const houseOpen = await call(server, 'GET', '/arenas/house-dollars');
		check('free roster does not add onto a dollar pot', houseOpen.status === 200 && houseOpen.data.prizePool === 100, String(houseOpen.data && houseOpen.data.prizePool));

		const extras = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Percent Plus Extras',
			slug: 'percent-plus',
			format: 'single_elim',
			feeMode: 'paid',
			entryFeeUsd: 10,
			registrationMode: 'list',
			requireAccount: false,
			rewardMode: 'pot',
			potFundMode: 'percent',
			addedPotUsd: 20,
			payouts: [
				{ place: 1, percent: 70, addedUsd: 5, prize: 'playmat' },
				{ place: 2, percent: 30, prize: '2 packs' },
			],
			maxPlayers: 8,
		});
		check('added cash does not kick a percent pool onto a dollar pot', extras.status === 200 && extras.data.potFundMode === 'percent' && extras.data.addedPotUsd === 20, extras.text.slice(0, 220));
		await fillRoster(server, 'percent-plus', ['Echo', 'Foxtrot']);
		const extrasOpen = await call(server, 'GET', '/arenas/percent-plus');
		const extraRewards = extrasOpen.data && extrasOpen.data.rewards;
		const first = extraRewards && extraRewards.rows && extraRewards.rows[0];
		const second = extraRewards && extraRewards.rows && extraRewards.rows[1];
		check('percent pot plus added contribution is 65% of $20 plus $20', extrasOpen.status === 200 && extrasOpen.data.prizePool === 33 && extraRewards.addedPotUsd === 20 && extraRewards.feePoolUsd === 13, JSON.stringify(extraRewards));
		check('place percents split the combined pot and keep per-place extras', first && first.amountUsd === 23.1 && first.addedUsd === 5 && first.totalUsd === 28.1 && first.prize === 'playmat' && second && second.prize === '2 packs' && second.addedUsd === 0, JSON.stringify(extraRewards && extraRewards.rows));

		const onlyPrize = await call(server, 'POST', '/arenas/percent-plus/settings', {
			hostPassword: HOST_PW,
			payouts: [
				{ place: 1, percent: 100 },
				{ place: 4, prize: 'booster' },
			],
		});
		const fourth = onlyPrize.data && onlyPrize.data.rewards && onlyPrize.data.rewards.rows && onlyPrize.data.rewards.rows.find((r) => r.place === 4);
		check('a place can get an added prize with 0% of the pot', onlyPrize.status === 200 && fourth && fourth.prize === 'booster' && fourth.percent === 0 && fourth.amountUsd === 0, JSON.stringify(onlyPrize.data && onlyPrize.data.rewards && onlyPrize.data.rewards.rows));
	} finally {
		server.close();
		try {
			fs.rmSync(dataDir, { recursive: true, force: true });
		} catch (_err) {}
	}
	if (failures) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
