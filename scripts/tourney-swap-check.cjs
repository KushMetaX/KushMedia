'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');

const HOST_PW = 'test-host-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-swap-'));
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

async function main() {
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Semi Cup',
			slug: 'semi-cup',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 16,
		});
		for (let i = 1; i <= 8; i++) {
			const added = await call(server, 'POST', '/arenas/semi-cup/add-entry', {
				hostPassword: HOST_PW,
				handle: `S${String(i).padStart(2, '0')}`,
			});
			if (added.status !== 200) throw new Error(`add S${i}: ${added.text}`);
		}
		const semiLocked = await call(server, 'POST', '/arenas/semi-cup/generate', {
			hostPassword: HOST_PW,
			shuffle: false,
			confirmSelected: true,
			checkInSelected: true,
			entryIds: (await call(server, 'GET', '/arenas/semi-cup')).data.entries.map((e) => e.id),
			bestOf: 1,
		});
		check('semi cup locks', semiLocked.status === 200, semiLocked.text.slice(0, 180));
		let semiPack = semiLocked;
		const quarters = (semiPack.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 1 && m.status === 'ready');
		for (const match of quarters) {
			semiPack = await call(server, 'POST', '/arenas/semi-cup/report', {
				hostPassword: HOST_PW,
				matchId: match.id,
				bestOf: 1,
				games: [{ winnerSlot: 1 }],
			});
			if (semiPack.status !== 200) throw new Error(`quarter report: ${semiPack.text}`);
		}
		const semis = (semiPack.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 2);
		const readySemis = semis.filter((m) => m.status === 'ready' && m.entry1Id && m.entry2Id);
		check('two semi-finals are seated after quarters', readySemis.length === 2, JSON.stringify(semis.map((m) => ({ status: m.status, e1: m.entry1Id, e2: m.entry2Id }))));
		const sA = readySemis[0] && readySemis[0].entry1Id;
		const sB = readySemis[1] && readySemis[1].entry1Id;
		const pairedSemis = sA && sB ? await call(server, 'POST', '/arenas/semi-cup/they-play', {
			hostPassword: HOST_PW,
			entryIdA: sA,
			entryIdB: sB,
			side: 'winners',
			round: 2,
		}) : { status: 0, text: 'no semi players', data: null };
		const afterSemis = (pairedSemis.data && pairedSemis.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 2);
		const together = afterSemis.find((m) => (
			(Number(m.entry1Id) === Number(sA) && Number(m.entry2Id) === Number(sB))
			|| (Number(m.entry1Id) === Number(sB) && Number(m.entry2Id) === Number(sA))
		));
		check('they-play puts two semi-finalists in the same semi', pairedSemis.status === 200 && Boolean(together), pairedSemis.text.slice(0, 180));
		const finalsStill = (pairedSemis.data && pairedSemis.data.matches || []).find((m) => m.side === 'winners' && Number(m.round) === 3);
		check('they-play does not dump them into an empty final', Boolean(finalsStill && !finalsStill.entry1Id && !finalsStill.entry2Id));

		await call(server, 'POST', '/arenas', {
			hostPassword: HOST_PW,
			name: 'Swap Cup',
			slug: 'swap-cup',
			format: 'single_elim',
			feeMode: 'free',
			registrationMode: 'list',
			requireAccount: false,
			maxPlayers: 16,
		});
		for (let i = 1; i <= 8; i++) {
			const added = await call(server, 'POST', '/arenas/swap-cup/add-entry', {
				hostPassword: HOST_PW,
				handle: `P${String(i).padStart(2, '0')}`,
			});
			if (added.status !== 200) throw new Error(`add P${i}: ${added.text}`);
		}
		const locked = await call(server, 'POST', '/arenas/swap-cup/generate', {
			hostPassword: HOST_PW,
			shuffle: false,
			confirmSelected: true,
			checkInSelected: true,
			entryIds: (await call(server, 'GET', '/arenas/swap-cup')).data.entries.map((e) => e.id),
			bestOf: 1,
		});
		check('bracket locks', locked.status === 200 && locked.data.tournament.status === 'in_progress', locked.text.slice(0, 180));

		const handles = (locked.data.entries || []).filter((e) => e.paid).map((e) => e.handle);
		const beforeA = openingSeat(locked, handles[0]);
		const otherHandle = handles.find((h) => {
			const seat = openingSeat(locked, h);
			return seat && beforeA && seat.matchPos !== beforeA.matchPos;
		});
		const beforeB = openingSeat(locked, otherHandle);
		check('two players start in different first-round matches', Boolean(beforeA && beforeB && beforeA.matchPos !== beforeB.matchPos));

		const swapped = await call(server, 'POST', '/arenas/swap-cup/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: beforeA.id,
			entryIdB: beforeB.id,
		});
		const afterA = openingSeat(swapped, handles[0]);
		const afterB = openingSeat(swapped, otherHandle);
		check('swap after lock trades seats', swapped.status === 200 && afterA.matchPos === beforeB.matchPos && afterB.matchPos === beforeA.matchPos && afterA.slot === beforeB.slot && afterB.slot === beforeA.slot, swapped.text.slice(0, 180));
		check('players keep their seeds when they move', afterA.seed === beforeA.seed && afterB.seed === beforeB.seed);
		const othersStay = (swapped.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 1)
			.every((m) => {
				const orig = (locked.data.matches || []).find((row) => row.position === m.position);
				const ids = [Number(m.entry1Id), Number(m.entry2Id)].sort();
				const origIds = [Number(orig.entry1Id), Number(orig.entry2Id)].sort();
				const touched = [beforeA.id, beforeB.id];
				if (touched.includes(Number(orig.entry1Id)) || touched.includes(Number(orig.entry2Id))) return true;
				return ids[0] === origIds[0] && ids[1] === origIds[1];
			});
		check('swap leaves every other first-round matchup alone', othersStay);

		function liveMatchOf(pack, handle) {
			const entry = (pack.data.entries || []).find((e) => String(e.handle) === handle);
			if (!entry) return null;
			return (pack.data.matches || []).find((m) => (
				m.status !== 'complete'
				&& (Number(m.entry1Id) === entry.id || Number(m.entry2Id) === entry.id)
			)) || null;
		}
		const pairHandle = handles.find((h) => {
			const mine = liveMatchOf(swapped, handles[0]);
			const theirs = liveMatchOf(swapped, h);
			return h !== handles[0] && mine && theirs && mine.id !== theirs.id;
		});
		const pairEntry = (swapped.data.entries || []).find((e) => e.handle === pairHandle);
		const beforePairA = liveMatchOf(swapped, handles[0]);
		const beforePairB = liveMatchOf(swapped, pairHandle);
		const paired = await call(server, 'POST', '/arenas/swap-cup/pair-players', {
			hostPassword: HOST_PW,
			entryIdA: beforeA.id,
			entryIdB: pairEntry && pairEntry.id,
		});
		const afterPairA = liveMatchOf(paired, handles[0]);
		const afterPairB = liveMatchOf(paired, pairHandle);
		check('pair-players puts two people in the same match', paired.status === 200 && afterPairA && afterPairB && afterPairA.id === afterPairB.id, paired.text.slice(0, 180));
		check('pair-players leaves them in one of their original matches', Boolean(afterPairA && (afterPairA.id === beforePairA.id || afterPairA.id === beforePairB.id)));

		const same = await call(server, 'POST', '/arenas/swap-cup/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: beforeA.id,
			entryIdB: beforeA.id,
		});
		check('same player twice is rejected', same.status === 400);

		const ready = (paired.data.matches || []).find((m) => m.status === 'ready');
		const reported = await call(server, 'POST', '/arenas/swap-cup/report', {
			hostPassword: HOST_PW,
			matchId: ready.id,
			bestOf: 1,
			games: [{ winnerSlot: 1 }],
		});
		check('a series can be reported', reported.status === 200, reported.text.slice(0, 180));

		function slotEntry(match, slot) {
			if (!match) return null;
			return Number(slot) === 2 ? match.entry2Id : match.entry1Id;
		}
		const r2 = (reported.data.matches || []).filter((m) => m.side === 'winners' && Number(m.round) === 2);
		const occupied = r2.find((m) => m.entry1Id || m.entry2Id);
		const empty = r2.find((m) => m !== occupied && (!m.entry1Id || !m.entry2Id));
		const fromSlot = occupied && occupied.entry1Id ? 1 : 2;
		const toSlot = empty && empty.entry1Id ? 2 : 1;
		const moved = occupied && empty ? await call(server, 'POST', '/arenas/swap-cup/swap-slots', {
			hostPassword: HOST_PW,
			matchIdA: occupied.id,
			slotA: fromSlot,
			matchIdB: empty.id,
			slotB: toSlot,
		}) : { status: 0, text: 'no round-2 seats', data: null };
		const movedFrom = moved.data && (moved.data.matches || []).find((m) => m.id === occupied.id);
		const movedTo = moved.data && (moved.data.matches || []).find((m) => m.id === empty.id);
		const winnerId = occupied && (occupied.entry1Id || occupied.entry2Id);
		check('later-round seats can be swapped after another series', moved.status === 200 && Number(slotEntry(movedTo, toSlot)) === Number(winnerId) && !slotEntry(movedFrom, fromSlot), moved.text.slice(0, 180));

		const leftover = (reported.data.entries || []).filter((e) => e.paid && Number(e.id) !== Number(ready.entry1Id) && Number(e.id) !== Number(ready.entry2Id));
		const uA = leftover[0];
		const uB = leftover.find((e) => {
			const aSeat = openingSeat(reported, uA.handle);
			const bSeat = openingSeat(reported, e.handle);
			return e.id !== uA.id && aSeat && bSeat && aSeat.matchPos !== bSeat.matchPos;
		});
		const beforeUA = openingSeat(reported, uA.handle);
		const beforeUB = openingSeat(reported, uB.handle);
		const late = await call(server, 'POST', '/arenas/swap-cup/swap-seeds', {
			hostPassword: HOST_PW,
			entryIdA: uA.id,
			entryIdB: uB.id,
		});
		const lateA = openingSeat(late, uA.handle);
		const lateB = openingSeat(late, uB.handle);
		check('unplayed players can still swap after another series', late.status === 200 && lateA.matchPos === beforeUB.matchPos && lateB.matchPos === beforeUA.matchPos, late.text.slice(0, 180));
		const reportedStill = (late.data.matches || []).find((m) => m.id === ready.id);
		check('already-reported series is not wiped', reportedStill && reportedStill.status === 'complete' && Number(reportedStill.winnerId) === Number(ready.entry1Id));

		const placeSlot = toSlot === 1 ? 2 : 1;
		const placed = empty ? await call(server, 'POST', '/arenas/swap-cup/place-entry', {
			hostPassword: HOST_PW,
			entryId: uA.id,
			matchId: empty.id,
			slot: placeSlot,
		}) : { status: 0, text: 'no empty seat' };
		check('host can place a player into a later-round seat', placed.status === 200, placed.text.slice(0, 180));

		const unlocked = await call(server, 'POST', '/arenas/swap-cup/reset-match', {
			hostPassword: HOST_PW,
			matchId: ready.id,
		});
		const unlockedMatch = (unlocked.data.matches || []).find((m) => m.id === ready.id);
		check('host can unlock a locked series', unlocked.status === 200 && unlockedMatch && unlockedMatch.status === 'ready', unlocked.text.slice(0, 180));

		const pack = unlocked.data || placed.data;
		const openSemi = (pack.matches || []).find((m) => m.side === 'winners' && Number(m.round) === 2 && m.status !== 'complete');
		const filler = (pack.entries || []).find((e) => e.handle === 'P04');
		const intoSemi = openSemi && filler ? await call(server, 'POST', '/arenas/swap-cup/place-entry', {
			hostPassword: HOST_PW,
			entryId: filler.id,
			matchId: openSemi.id,
			slot: openSemi.entry1Id ? 2 : 1,
		}) : { status: 0, text: 'no open semi', data: null };
		const semiAfter = intoSemi.data && (intoSemi.data.matches || []).find((m) => m.id === openSemi.id);
		const expectedSlot = openSemi && openSemi.entry1Id ? 'entry2Id' : 'entry1Id';
		check('host can put a player into a pending semi-final seat', intoSemi.status === 200 && Number(semiAfter && semiAfter[expectedSlot]) === filler.id, intoSemi.text.slice(0, 180));
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
