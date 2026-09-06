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

		const house = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'House Pot',
			slug: 'house-pot',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			rewardMode: 'pot',
			hostPotUsd: 100,
			payouts: [
				{ place: 1, percent: 70 },
				{ place: 2, percent: 20 },
				{ place: 3, percent: 10 },
			],
			maxPlayers: 16,
		});
		check('host can set a prize pot on a free arena', house.status === 200 && Number(house.data.hostPotUsd) === 100, house.text.slice(0, 180));

		const twelve = Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
		await fillRoster(server, 'house-pot', twelve);
		const houseOpen = await call(server, 'GET', '/arenas/house-pot');
		check('free arena pot uses the host amount before lock', houseOpen.status === 200 && houseOpen.data.prizePool === 100 && houseOpen.data.rewards.rows[0].amountUsd === 70, JSON.stringify(houseOpen.data && houseOpen.data.rewards));

		const lockedHouse = await lock(server, 'house-pot');
		const r1 = (lockedHouse.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 1);
		const byes = r1.filter((m) => m.status === 'bye');
		check('12 players seed a 16-slot first round (8 matches)', lockedHouse.status === 200 && r1.length === 8, String(r1.length));
		check('12-player tree gives 4 first-round byes', byes.length === 4, String(byes.length));

		const shuffled = await call(server, 'POST', '/arenas/house-pot/reshuffle', { hostPassword: HOST_PW });
		const shuffledR1 = (shuffled.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 1);
		check('host can shuffle a locked bracket before any series', shuffled.status === 200 && shuffledR1.length === 8 && shuffledR1.filter((m) => m.status === 'bye').length === 4, shuffled.text.slice(0, 180));

		function openingSeat(pack, handle) {
			const entry = (pack.data.entries || []).find((e) => String(e.handle) === handle);
			if (!entry) return null;
			const match = (pack.data.matches || []).find((m) => (
				m.side === 'winners' && Number(m.round) === 1
				&& (Number(m.entry1Id) === entry.id || Number(m.entry2Id) === entry.id)
			));
			if (!match) return { id: entry.id, seed: entry.seed };
			return {
				id: entry.id,
				seed: entry.seed,
				matchPos: match.position,
				slot: Number(match.entry1Id) === entry.id ? 1 : 2,
				status: match.status,
			};
		}
		const swapHandles = (shuffled.data.entries || []).filter((e) => e.paid && !e.whitelist).map((e) => e.handle);
		const seatA = openingSeat(shuffled, swapHandles[0]);
		const otherHandle = swapHandles.find((h) => {
			const seat = openingSeat(shuffled, h);
			return seat && seatA && seat.matchPos !== seatA.matchPos;
		});
		const seatB = openingSeat(shuffled, otherHandle);
		const swapped = seatA && seatB ? await call(server, 'POST', '/arenas/house-pot/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: seatA.id,
			entryIdB: seatB.id,
		}) : { status: 0, text: 'missing seats', data: null };
		const afterA = swapped.data ? openingSeat(swapped, swapHandles[0]) : null;
		const afterB = swapped.data ? openingSeat(swapped, otherHandle) : null;
		check('host can swap two players before any series', swapped.status === 200 && afterA && afterB && afterA.matchPos === seatB.matchPos && afterB.matchPos === seatA.matchPos && afterA.slot === seatB.slot && afterB.slot === seatA.slot, swapped.text.slice(0, 180));
		check('players keep their seeds when they move', Boolean(afterA && afterB && afterA.seed === seatA.seed && afterB.seed === seatB.seed));
		const sameSwap = await call(server, 'POST', '/arenas/house-pot/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: seatA && seatA.id,
			entryIdB: seatA && seatA.id,
		});
		check('swap rejects the same player twice', sameSwap.status === 400, sameSwap.text.slice(0, 180));
		const missingSwap = await call(server, 'POST', '/arenas/house-pot/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: seatA && seatA.id,
			entryIdB: 999999,
		});
		check('swap rejects a player who is not in the field', missingSwap.status === 400, missingSwap.text.slice(0, 180));

		const liveR1 = ((swapped.data && swapped.data.matches) || shuffled.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 1);
		const readyMatch = liveR1.find((m) => m.status === 'ready');
		const reported = readyMatch ? await call(server, 'POST', '/arenas/house-pot/report', {
			hostPassword: HOST_PW,
			matchId: readyMatch.id,
			bestOf: 1,
			games: [{ winnerSlot: 1 }],
		}) : { status: 0, text: 'no ready match' };
		check('first-round series can be reported after shuffle', reported.status === 200, reported.text.slice(0, 180));
		const blockedShuffle = await call(server, 'POST', '/arenas/house-pot/reshuffle', { hostPassword: HOST_PW });
		check('shuffle is blocked after a series is reported', blockedShuffle.status === 400, blockedShuffle.text.slice(0, 180));
		const r2 = ((reported.data && reported.data.matches) || []).filter((m) => m.side === 'winners' && Number(m.round) === 2);
		const occupied = r2.find((m) => m.entry1Id || m.entry2Id);
		const vacant = r2.find((m) => m !== occupied && (!m.entry1Id || !m.entry2Id || Number(m.entry1Id) !== Number(occupied && (occupied.entry1Id || occupied.entry2Id))));
		const fromSlot = occupied && occupied.entry1Id ? 1 : 2;
		const toSlot = vacant && !vacant.entry1Id ? 1 : 2;
		const movedR2 = occupied && vacant ? await call(server, 'POST', '/arenas/house-pot/swap-slots', {
			hostPassword: HOST_PW,
			matchIdA: occupied.id,
			slotA: fromSlot,
			matchIdB: vacant.id,
			slotB: toSlot,
		}) : { status: 0, text: 'no round-2 seats' };
		check('later-round seats can still be edited after a series', movedR2.status === 200, movedR2.text.slice(0, 180));
		const playedIds = readyMatch ? [Number(readyMatch.entry1Id), Number(readyMatch.entry2Id)].filter(Boolean) : [];
		const afterReport = reported.data || swapped.data || shuffled.data;
		const unplayed = (afterReport.entries || []).filter((e) => {
			if (!e.paid || e.whitelist) return false;
			if (playedIds.includes(Number(e.id))) return false;
			const theirs = (afterReport.matches || []).filter((m) => Number(m.entry1Id) === e.id || Number(m.entry2Id) === e.id);
			return !theirs.some((m) => m.status === 'complete' || (Array.isArray(m.games) && m.games.length) || Number(m.score1) > 0 || Number(m.score2) > 0);
		});
		const stillA = unplayed[0];
		const stillB = stillA && (unplayed.find((e) => {
			if (e.id === stillA.id) return false;
			const aSeat = openingSeat({ data: afterReport }, stillA.handle);
			const bSeat = openingSeat({ data: afterReport }, e.handle);
			return aSeat && bSeat && aSeat.matchPos !== bSeat.matchPos;
		}) || unplayed[1]);
		const lateSwap = stillA && stillB ? await call(server, 'POST', '/arenas/house-pot/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: stillA.id,
			entryIdB: stillB.id,
		}) : { status: 0, text: 'not enough unplayed players', data: null };
		const lateAfterA = lateSwap.data ? openingSeat(lateSwap, stillA.handle) : null;
		const lateAfterB = lateSwap.data ? openingSeat(lateSwap, stillB.handle) : null;
		const beforeA = openingSeat({ data: afterReport }, stillA && stillA.handle);
		const beforeB = openingSeat({ data: afterReport }, stillB && stillB.handle);
		check('host can still swap two unplayed players after another series', lateSwap.status === 200 && lateAfterA && lateAfterB && lateAfterA.matchPos === beforeB.matchPos && lateAfterB.matchPos === beforeA.matchPos, lateSwap.text.slice(0, 180));

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
		check('a full locked bracket refuses an auto walk-in with no open slot', lockedWalkin.status === 400, lockedWalkin.text.slice(0, 180));

		const late = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Late Entry Cup',
			slug: 'late-cup',
			format: 'single_elim',
			feeMode: 'free',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('late-entry arena created', late.status === 200, late.text.slice(0, 180));
		await fillRoster(server, 'late-cup', ['Nova', 'Rex', 'Quin']);
		const lockedLate = await lock(server, 'late-cup');
		const byeBefore = (lockedLate.data.matches || []).find((m) => m.status === 'bye');
		const walked = await call(server, 'POST', '/arenas/late-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'Vega',
		});
		const vega = (walked.data.entries || []).find((e) => e.handle === 'Vega');
		const filled = byeBefore && (walked.data.matches || []).find((m) => m.id === byeBefore.id);
		check('host can add a walk-in into a locked bye', walked.status === 200 && vega && vega.lateEntry && filled && filled.status === 'ready' && (filled.entry1Id === vega.id || filled.entry2Id === vega.id), walked.text.slice(0, 220));
		const destBefore = byeBefore && byeBefore.winnerGoesTo
			? (lockedLate.data.matches || []).find((m) => (
				m.side === byeBefore.winnerGoesTo.side
				&& m.round === byeBefore.winnerGoesTo.round
				&& m.position === byeBefore.winnerGoesTo.position
			))
			: null;
		const destAfter = destBefore && (walked.data.matches || []).find((m) => m.id === destBefore.id);
		const byePlayerId = byeBefore && (byeBefore.entry1Id || byeBefore.entry2Id);
		check('filling a bye pulls that player back from the next round', Boolean(destAfter && byePlayerId && destAfter.entry1Id !== byePlayerId && destAfter.entry2Id !== byePlayerId), JSON.stringify(destAfter && { status: destAfter.status, e1: destAfter.entry1Id, e2: destAfter.entry2Id, bye: byePlayerId }));

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

		const wlEmpty = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Whitelist Empty Cup',
			slug: 'wl-empty-cup',
			format: 'single_elim',
			feeMode: 'free',
			requireAccount: false,
			maxPlayers: 8,
			whitelistSpots: 2,
		});
		check('whitelist empty-slot arena created', wlEmpty.status === 200, wlEmpty.text.slice(0, 180));
		await fillRoster(server, 'wl-empty-cup', ['Oak', 'Pine', 'Elm']);
		const wlEmptyAdd = await call(server, 'POST', '/arenas/wl-empty-cup/add-entry', {
			hostPassword: HOST_PW,
			handle: 'SubBye',
			whitelist: true,
		});
		check('whitelist player waits off the field', wlEmptyAdd.status === 200 && (wlEmptyAdd.data.entries || []).some((e) => e.handle === 'SubBye' && e.whitelist), wlEmptyAdd.text.slice(0, 180));
		const lockedEmpty = await lock(server, 'wl-empty-cup');
		const emptyBye = (lockedEmpty.data.matches || []).find((m) => m.status === 'bye');
		const emptySlot = emptyBye && (emptyBye.entry1Id ? 2 : 1);
		const filledBye = await call(server, 'POST', '/arenas/wl-empty-cup/sub-round1', {
			hostPassword: HOST_PW,
			matchId: emptyBye && emptyBye.id,
			slot: emptySlot,
			handle: 'SubBye',
		});
		const subBye = (filledBye.data.entries || []).find((e) => e.handle === 'SubBye');
		const byeMatch = emptyBye && (filledBye.data.matches || []).find((m) => m.id === emptyBye.id);
		check('whitelist substitute fills an empty bye slot', filledBye.status === 200 && subBye && subBye.subbedIn && byeMatch && byeMatch.status === 'ready' && (byeMatch.entry1Id === subBye.id || byeMatch.entry2Id === subBye.id), filledBye.text.slice(0, 220));

		const bronze = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Bronze Cup',
			slug: 'bronze-cup',
			format: 'single_elim',
			losersBracket: false,
			breakTies: true,
			bestOf: 1,
			finalsBestOf: 3,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		check('3rd place + BO3 finals arena creates', bronze.status === 200 && bronze.data.breakTies === true && bronze.data.bestOf === 1 && bronze.data.finalsBestOf === 3, bronze.text.slice(0, 180));
		await fillRoster(server, 'bronze-cup', ['Pebble', 'River', 'Stone', 'Vale']);
		const lockedBronze = await call(server, 'POST', '/arenas/bronze-cup/generate', {
			hostPassword: HOST_PW,
			shuffle: false,
			confirmSelected: true,
			checkInSelected: true,
			entryIds: (await call(server, 'GET', '/arenas/bronze-cup')).data.entries.map((e) => e.id),
			bestOf: 1,
			finalsBestOf: 3,
			breakTies: true,
		});
		const bronzeMatches = lockedBronze.data.matches || [];
		const placement = bronzeMatches.find((m) => m.side === 'placement');
		const semis = bronzeMatches.filter((m) => m.side === 'winners' && Number(m.round) === 1);
		const finals = bronzeMatches.find((m) => m.side === 'winners' && !m.winnerGoesTo);
		check('4-player single elim with 3rd place builds a bronze match', Boolean(placement), bronzeMatches.map((m) => m.side).join(','));
		check('semi-finals stay best of 1', semis.length === 2 && semis.every((m) => Number(m.bestOf) === 1), JSON.stringify(semis.map((m) => m.bestOf)));
		check('finals use best of 3', Boolean(finals) && Number(finals.bestOf) === 3, JSON.stringify(finals && { bestOf: finals.bestOf, round: finals.round }));
		check('3rd place match uses the default series', Boolean(placement) && Number(placement.bestOf) === 1, String(placement && placement.bestOf));

		for (const semi of semis.filter((m) => m.status === 'ready')) {
			const reported = await call(server, 'POST', '/arenas/bronze-cup/report', {
				hostPassword: HOST_PW,
				matchId: semi.id,
				bestOf: 1,
				games: [{ winnerSlot: 1 }],
			});
			if (reported.status !== 200) throw new Error(`semi report: ${reported.text}`);
		}
		const afterSemis = await call(server, 'GET', '/arenas/bronze-cup');
		const bronzeReady = (afterSemis.data.matches || []).find((m) => m.side === 'placement');
		check('semi-final losers are seated in the 3rd place match', Boolean(bronzeReady && bronzeReady.entry1Id && bronzeReady.entry2Id && bronzeReady.status === 'ready'), JSON.stringify(bronzeReady && { status: bronzeReady.status, e1: bronzeReady.entry1Id, e2: bronzeReady.entry2Id }));

		if (bronzeReady && bronzeReady.status === 'ready') {
			const bronzeReport = await call(server, 'POST', '/arenas/bronze-cup/report', {
				hostPassword: HOST_PW,
				matchId: bronzeReady.id,
				bestOf: 1,
				games: [{ winnerSlot: 1 }],
			});
			check('3rd place match can be reported', bronzeReport.status === 200, bronzeReport.text.slice(0, 180));
			const podium = bronzeReport.data && bronzeReport.data.podium;
			const bronzeWinnerId = bronzeReady.entry1Id;
			check('podium third is the 3rd place winner', Boolean(podium && podium.third && podium.third[0] && podium.third[0].id === bronzeWinnerId), JSON.stringify(podium && podium.third));
		}

		const tiny = await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Tiny Cup',
			slug: 'tiny-cup',
			format: 'single_elim',
			breakTies: true,
			bestOf: 1,
			finalsBestOf: 3,
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 8,
		});
		await fillRoster(server, 'tiny-cup', ['Uno', 'Dos', 'Tres']);
		const lockedTiny = await lock(server, 'tiny-cup');
		check('3rd place is skipped below 4 players', lockedTiny.status === 200 && !(lockedTiny.data.matches || []).some((m) => m.side === 'placement'), (lockedTiny.data.matches || []).map((m) => m.side).join(','));
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
