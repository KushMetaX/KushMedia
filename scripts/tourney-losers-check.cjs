'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');

const HOST_PW = 'test-host-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-losers-'));
fs.writeFileSync(path.join(dataDir, '.tourney-password'), `${HOST_PW}\n`);

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

async function lock(server, slug) {
	const detail = await call(server, 'GET', `/arenas/${slug}`);
	const ids = (detail.data.entries || []).filter((e) => !e.whitelist).map((e) => e.id);
	return call(server, 'POST', `/arenas/${slug}/generate`, {
		hostPassword: HOST_PW,
		shuffle: false,
		confirmSelected: true,
		checkInSelected: true,
		entryIds: ids,
		bestOf: 1,
	});
}

async function playReady(server, slug, side) {
	for (let i = 0; i < 40; i++) {
		const detail = await call(server, 'GET', `/arenas/${slug}`);
		const ready = (detail.data.matches || []).find((m) => (
			m.status === 'ready' && (!side || m.side === side)
		));
		if (!ready) return detail;
		const reported = await call(server, 'POST', `/arenas/${slug}/report`, {
			hostPassword: HOST_PW,
			matchId: ready.id,
			bestOf: 1,
			games: [{ winnerSlot: 1 }],
		});
		if (reported.status !== 200) throw new Error(`report: ${reported.text}`);
	}
	return call(server, 'GET', `/arenas/${slug}`);
}

async function main() {
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});

	try {
		const se = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Losers SE',
			slug: 'losers-se',
			format: 'single_elim',
			losersBracket: true,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('single-elim + losers creates', se.status === 200 && se.data.losersBracket === true, se.text.slice(0, 180));
		check('playoff format follows the toggle', se.data.playoffFormat === 'double_elim');
		await fillRoster(server, 'losers-se', ['Alpha', 'Bravo', 'Charlie', 'Delta']);
		const lockedSe = await lock(server, 'losers-se');
		const seSides = [...new Set((lockedSe.data.matches || []).map((m) => m.side))];
		check('single-elim + losers builds a losers bracket', seSides.includes('losers') && seSides.includes('grand') && seSides.includes('winners'), seSides.join(','));

		const seOff = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'No Losers SE',
			slug: 'no-losers-se',
			format: 'single_elim',
			losersBracket: false,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		await fillRoster(server, 'no-losers-se', ['Echo', 'Foxtrot', 'Golf', 'Hotel']);
		const lockedOff = await lock(server, 'no-losers-se');
		const offSides = [...new Set((lockedOff.data.matches || []).map((m) => m.side))];
		check('single-elim without losers stays one-and-done', !offSides.includes('losers') && !offSides.includes('grand') && offSides.includes('winners'), offSides.join(','));

		const swiss = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Losers Swiss',
			slug: 'losers-swiss',
			format: 'swiss',
			losersBracket: true,
			swissRounds: 3,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('swiss + losers creates', swiss.status === 200 && swiss.data.losersBracket === true, swiss.text.slice(0, 180));
		await fillRoster(server, 'losers-swiss', ['India', 'Juliet', 'Kilo', 'Lima']);
		const lockedSwiss = await lock(server, 'losers-swiss');
		check('swiss starts with group rounds, not the playoff', (lockedSwiss.data.matches || []).every((m) => m.side === 'group'), (lockedSwiss.data.matches || []).map((m) => m.side).join(','));
		const afterSwiss = await playReady(server, 'losers-swiss', 'group');
		const swissSides = [...new Set((afterSwiss.data.matches || []).map((m) => m.side))];
		check('swiss + losers opens a playoff losers bracket after standings', afterSwiss.data.tournament.stage === 'playoff' && swissSides.includes('losers') && swissSides.includes('grand'), `${afterSwiss.data.tournament.stage}:${swissSides.join(',')}`);

		const rr = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Losers RR',
			slug: 'losers-rr',
			format: 'round_robin',
			losersBracket: true,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		await fillRoster(server, 'losers-rr', ['Mike', 'November', 'Oscar', 'Papa']);
		await lock(server, 'losers-rr');
		const afterRr = await playReady(server, 'losers-rr', 'group');
		const rrSides = [...new Set((afterRr.data.matches || []).map((m) => m.side))];
		check('round robin + losers opens a playoff losers bracket after standings', afterRr.data.tournament.stage === 'playoff' && rrSides.includes('losers'), `${afterRr.data.tournament.stage}:${rrSides.join(',')}`);

		const two = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Losers Two Stage',
			slug: 'losers-two',
			format: 'round_robin',
			stageType: 'two',
			losersBracket: true,
			groupSize: 2,
			advancePerGroup: 1,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('two-stage playoff format is double-elim when losers is on', two.data.playoffFormat === 'double_elim');
		await fillRoster(server, 'losers-two', ['Quebec', 'Romeo', 'Sierra', 'Tango']);
		await lock(server, 'losers-two');
		const afterGroups = await playReady(server, 'losers-two', 'group');
		const twoSides = [...new Set((afterGroups.data.matches || []).map((m) => m.side))];
		check('two-stage + losers uses a losers-bracket playoff', afterGroups.data.tournament.stage === 'playoff' && twoSides.includes('losers'), `${afterGroups.data.tournament.stage}:${twoSides.join(',')}`);

		const legacy = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Legacy Pot',
			slug: 'legacy-pot',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('arenas without reward fields default to pot', legacy.status === 200 && legacy.data.rewardMode === 'pot' && Array.isArray(legacy.data.payouts) && legacy.data.payouts.length === 0, JSON.stringify({ mode: legacy.data.rewardMode, payouts: legacy.data.payouts }));

		const prizes = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Prize Cup',
			slug: 'prize-cup',
			format: 'single_elim',
			feeMode: 'paid',
			entryFeeUsd: 10,
			rewardMode: 'prize',
			payouts: [
				{ place: 1, prize: 'Rare Dog #1' },
				{ place: 2, prize: '50 DOGE' },
				{ place: 3, prize: 'Sticker pack' },
			],
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('host can create a prize arena', prizes.status === 200 && prizes.data.rewardMode === 'prize', prizes.text.slice(0, 180));
		check('prize payouts store placement text', (prizes.data.payouts || []).map((p) => p.prize).join('|') === 'Rare Dog #1|50 DOGE|Sticker pack');

		await fillRoster(server, 'prize-cup', ['PrizeA', 'PrizeB']);
		const prizeDetail = await call(server, 'GET', '/arenas/prize-cup');
		check('prize arenas still report a numeric pot from entries', prizeDetail.status === 200 && prizeDetail.data.prizePool === 20, String(prizeDetail.data && prizeDetail.data.prizePool));
		check('prize breakdown is by place, not pot percents', prizeDetail.data.rewards && prizeDetail.data.rewards.mode === 'prize' && prizeDetail.data.rewards.rows[0].text === 'Rare Dog #1' && prizeDetail.data.rewards.rows[1].text === '50 DOGE', JSON.stringify(prizeDetail.data && prizeDetail.data.rewards));

		const split = await call(server, 'POST', '/arenas/legacy-pot/settings', {
			hostPassword: HOST_PW,
			rewardMode: 'pot',
			payouts: [
				{ place: 1, percent: 70 },
				{ place: 2, percent: 20 },
				{ place: 3, percent: 10 },
			],
		});
		check('host can add a pot split later without dropping the arena', split.status === 200 && split.data.tournament.rewardMode === 'pot' && split.data.rewards.rows.length === 3, JSON.stringify(split.data && split.data.rewards));
		check('empty prize labels are ignored in pot mode', split.data.rewards.rows.every((r) => r.percent > 0) && split.data.rewards.rows[0].amountUsd === 0);

		const wl = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Whitelist Cup',
			slug: 'whitelist-cup',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'whitelist',
			whitelistSpots: 2,
			requireAccount: false,
			maxPlayers: 8,
		});
		check('whitelist arenas keep public sign-up and store substitute spots', wl.status === 200 && wl.data.registrationMode === 'signup' && wl.data.whitelistSpots === 2, wl.text.slice(0, 180));
		check('whitelist does not force free entry', Number(wl.data.entryFeeUsd) === 0);

		const paidWl = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Paid Whitelist Cup',
			slug: 'paid-whitelist-cup',
			format: 'single_elim',
			feeMode: 'paid',
			entryFeeUsd: 5,
			registrationMode: 'signup',
			whitelistSpots: 3,
			requireAccount: false,
			maxPlayers: 8,
		});
		check('paid sign-up and whitelist spots can be on together', paidWl.status === 200 && paidWl.data.registrationMode === 'signup' && Number(paidWl.data.entryFeeUsd) === 5 && paidWl.data.whitelistSpots === 3, paidWl.text.slice(0, 180));
		await fillRoster(server, 'whitelist-cup', ['Shock', 'Dick', 'Mary', 'Gary']);
		const wlAdd = await call(server, 'POST', '/arenas/whitelist-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'SubOne',
			whitelist: true,
		});
		check('host can add a whitelist player before lock', wlAdd.status === 200 && (wlAdd.data.entries || []).some((e) => e.handle === 'SubOne' && e.whitelist), wlAdd.text.slice(0, 180));
		const lockedWl = await lock(server, 'whitelist-cup');
		const fieldIds = new Set((lockedWl.data.entries || []).filter((e) => !e.whitelist).map((e) => e.id));
		const inBracket = (lockedWl.data.matches || []).some((m) => m.entry1Id && !fieldIds.has(m.entry1Id) || m.entry2Id && !fieldIds.has(m.entry2Id));
		check('locking seeds the field and leaves whitelist off the bracket', lockedWl.status === 200 && lockedWl.data.tournament.status === 'in_progress' && !inBracket, JSON.stringify({
			status: lockedWl.status,
			matches: (lockedWl.data.matches || []).slice(0, 2),
		}));

		const lockedWalkin = await call(server, 'POST', '/arenas/whitelist-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'TooLate',
		});
		check('locked arenas still refuse a normal walk-in', lockedWalkin.status === 400, lockedWalkin.text.slice(0, 180));

		const wlAddLive = await call(server, 'POST', '/arenas/whitelist-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'SubTwo',
			whitelist: true,
		});
		check('host can add a whitelist player after lock', wlAddLive.status === 200 && (wlAddLive.data.entries || []).some((e) => e.handle === 'SubTwo' && e.whitelist), wlAddLive.text.slice(0, 180));

		const wlFull = await call(server, 'POST', '/arenas/whitelist-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'SubThree',
			whitelist: true,
		});
		check('whitelist spots cap extra substitutes', wlFull.status === 400, wlFull.text.slice(0, 180));

		const opening = (lockedWl.data.matches || []).find((m) => m.side === 'winners' && m.round === 1 && m.status === 'ready');
		const subbed = await call(server, 'POST', '/arenas/whitelist-cup/sub-round1', {
			hostPassword: HOST_PW,
			matchId: opening && opening.id,
			slot: 2,
			handle: 'SubTwo',
		});
		const afterSub = (subbed.data.entries || []).find((e) => e.handle === 'SubTwo');
		const outgoing = opening && (subbed.data.entries || []).find((e) => e.id === opening.entry2Id);
		const newMatch = (subbed.data.matches || []).find((m) => m.id === (opening && opening.id));
		check('whitelist substitute takes a first-round no-show slot', subbed.status === 200 && afterSub && afterSub.subbedIn && outgoing && outgoing.noShow && newMatch && newMatch.entry2Id === afterSub.id, subbed.text.slice(0, 220));
	} finally {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dataDir, { recursive: true, force: true });
	}

	console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
	process.exit(failures ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_err) {}
	process.exit(1);
});
