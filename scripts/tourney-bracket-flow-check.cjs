'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');
const {
	restackElimTree,
	reseatCompletePair,
	repairKnownBracketHistory,
} = require('../public/server/lib/bracket-layout');

const HOST_PW = 'test-host-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-flow-'));
fs.writeFileSync(path.join(dataDir, '.tourney-password'), `${HOST_PW}\n`);

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

function namesIn(match, byId) {
	return [byId.get(Number(match.entry1Id)), byId.get(Number(match.entry2Id))].filter(Boolean);
}

function roundOf(matches, round, tournamentId) {
	return matches.filter((m) => (
		m.side === 'winners'
		&& Number(m.round) === round
		&& (tournamentId == null || Number(m.tournamentId) === Number(tournamentId))
	)).sort((a, b) => a.position - b.position);
}

function ddnycLike() {
	const handles = [
		[141, 'DickTheDev', 7],
		[142, 'And', 10],
		[143, 'Rus', 16],
		[144, 'Duck', 1],
		[145, 'Boo', 12],
		[146, 'hofer', 5],
		[147, 'Scad', 15],
		[148, 'Fifi', 2],
		[149, 'Dro', 3],
		[150, 'Paws', 14],
		[151, 'Vee', 13],
		[152, 'Corn', 4],
		[153, 'Jag', 6],
		[154, 'Ammon', 11],
		[155, 'Shekels', 8],
		[156, 'Devin', 9],
	];
	const entries = handles.map(([id, handle, seed]) => ({
		id, tournamentId: 140, handle, seed, paid: true, status: 'confirmed',
		checkedIn: true, whitelist: false, noShow: false, subbedIn: false, addedByHost: true,
	}));
	const matches = [
		{ id: 189, round: 1, position: 1, entry1Id: 144, entry2Id: 143, winnerId: 144, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 2, position: 1, slot: 1 } },
		{ id: 190, round: 1, position: 2, entry1Id: 155, entry2Id: 156, winnerId: 156, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 2, position: 1, slot: 2 } },
		{ id: 191, round: 1, position: 3, entry1Id: 152, entry2Id: 151, winnerId: 152, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 2, position: 2, slot: 1 } },
		{ id: 192, round: 1, position: 4, entry1Id: 146, entry2Id: 145, winnerId: 146, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 2, position: 2, slot: 2 } },
		{ id: 193, round: 1, position: 5, entry1Id: 148, entry2Id: 147, winnerId: 147, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 2, position: 3, slot: 1 } },
		{ id: 194, round: 1, position: 6, entry1Id: 141, entry2Id: 142, winnerId: 141, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 2, position: 3, slot: 2 } },
		{ id: 195, round: 1, position: 7, entry1Id: 149, entry2Id: 150, winnerId: 149, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 2, position: 4, slot: 1 } },
		{ id: 196, round: 1, position: 8, entry1Id: 153, entry2Id: 154, winnerId: 154, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 2, position: 4, slot: 2 } },
		{ id: 197, round: 2, position: 1, entry1Id: 144, entry2Id: 141, winnerId: 141, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 3, position: 1, slot: 1 } },
		{ id: 198, round: 2, position: 2, entry1Id: 149, entry2Id: 152, winnerId: 152, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 3, position: 1, slot: 2 } },
		{ id: 199, round: 2, position: 3, entry1Id: 147, entry2Id: 146, winnerId: 146, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 3, position: 2, slot: 1 } },
		{ id: 200, round: 2, position: 4, entry1Id: 156, entry2Id: 154, winnerId: 154, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 3, position: 2, slot: 2 } },
		{ id: 201, round: 3, position: 1, entry1Id: 141, entry2Id: 152, winnerId: 141, score1: 1, score2: 0, winnerGoesTo: { side: 'winners', round: 4, position: 1, slot: 1 }, loserGoesTo: { side: 'placement', round: 1, position: 1, slot: 1 } },
		{ id: 202, round: 3, position: 2, entry1Id: 146, entry2Id: 154, winnerId: 154, score1: 0, score2: 1, winnerGoesTo: { side: 'winners', round: 4, position: 1, slot: 2 }, loserGoesTo: { side: 'placement', round: 1, position: 1, slot: 2 } },
		{ id: 203, round: 4, position: 1, entry1Id: 141, entry2Id: 154, winnerId: 141, score1: 2, score2: 0, winnerGoesTo: null },
	].map((m) => ({
		tournamentId: 140,
		side: 'winners',
		group: null,
		bestOf: m.round === 4 ? 3 : 1,
		games: m.round === 4 ? [{ winnerSlot: 1 }, { winnerSlot: 1 }] : [{ winnerSlot: m.score1 > m.score2 ? 1 : 2 }],
		status: 'complete',
		loserGoesTo: m.loserGoesTo || null,
		...m,
	}));
	matches.push({
		id: 204, tournamentId: 140, side: 'placement', round: 1, position: 1,
		entry1Id: 152, entry2Id: 146, winnerId: 152, score1: 2, score2: 1, bestOf: 3,
		games: [{ winnerSlot: 1 }, { winnerSlot: 2 }, { winnerSlot: 1 }],
		status: 'complete', winnerGoesTo: null, loserGoesTo: null, group: null,
	});
	return { entries, matches };
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

function assertFlow(matches, entries, label) {
	const byId = new Map(entries.map((e) => [Number(e.id), e.handle]));
	const r1 = roundOf(matches, 1, 140);
	const qf = roundOf(matches, 2, 140);
	const sf = roundOf(matches, 3, 140);
	check(`${label}: DickTheDev vs hofer in one semi`, sf.some((m) => {
		const names = namesIn(m, byId);
		return names.includes('DickTheDev') && names.includes('hofer');
	}));
	check(`${label}: Corn vs Ammon in the other semi`, sf.some((m) => {
		const names = namesIn(m, byId);
		return names.includes('Corn') && names.includes('Ammon');
	}));
	check(`${label}: DickTheDev still beat his semi opponent`, sf.some((m) => {
		const names = namesIn(m, byId);
		return names.includes('DickTheDev') && names.includes('hofer') && Number(m.winnerId) === 141 && Number(m.score1) === 1;
	}));
	check(`${label}: Ammon still won his semi`, sf.some((m) => {
		const names = namesIn(m, byId);
		return names.includes('Corn') && names.includes('Ammon') && Number(m.winnerId) === 154;
	}));

	for (const dest of qf) {
		const destNames = namesIn(dest, byId);
		const feeders = r1.filter((m) => (
			m.winnerGoesTo
			&& m.winnerGoesTo.round === dest.round
			&& Number(m.winnerGoesTo.position) === Number(dest.position)
		));
		const feederWinners = feeders.map((m) => byId.get(Number(m.winnerId)));
		check(
			`${label}: ${destNames.join(' vs ')} is fed by those two first-round winners`,
			feederWinners.length === 2
			&& destNames.every((name) => feederWinners.includes(name)),
			`feeders=${feederWinners.join(',')} dest=${destNames.join(',')}`
		);
	}
	const adjacent = [];
	for (let i = 0; i < r1.length; i += 2) {
		adjacent.push([byId.get(Number(r1[i].winnerId)), byId.get(Number(r1[i + 1].winnerId))].sort().join(' vs '));
	}
	const qfPairs = qf.map((m) => namesIn(m, byId).slice().sort().join(' vs '));
	check(
		`${label}: adjacent first-round winners are the quarter-final matchups`,
		adjacent.every((pair, i) => pair === qfPairs[i]),
		`r1=${adjacent.join(' | ')} qf=${qfPairs.join(' | ')}`
	);
}

async function main() {
	const sample = ddnycLike();
	const byId = new Map(sample.entries.map((e) => [Number(e.id), e.handle]));
	const beforeSf = roundOf(sample.matches, 3).map((m) => namesIn(m, byId).join(' vs '));
	check('fixture starts as DickTheDev vs Corn', beforeSf[0] === 'DickTheDev vs Corn', beforeSf.join(' | '));

	reseatCompletePair(roundOf(sample.matches, 3), 141, 146);
	restackElimTree(sample.matches);
	assertFlow(sample.matches, sample.entries, 'direct repair');
	check('direct repair is idempotent', repairKnownBracketHistory({
		tournaments: [{ id: 140, slug: 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs', format: 'single_elim', losersBracket: false }],
		entries: sample.entries,
		matches: sample.matches,
	}) === false);

	const store = {
		nextId: 300,
		tournaments: [{
			id: 140,
			slug: 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs',
			name: 'Doginal Dogs Legends TCG - DDNYC 2026 IRL Tournament',
			format: 'single_elim',
			status: 'completed',
			entryFeeUsd: 0,
			maxPlayers: 16,
			swissRounds: 4,
			createdAt: '2026-09-03T21:20:12.918Z',
			stage: 'main',
			stageType: 'single',
			losersBracket: false,
			breakTies: true,
			registrationMode: 'list',
			feeMode: 'free',
			official: true,
			bestOf: 1,
			rewardMode: 'prize',
			eventKind: 'tournament',
		}],
		entries: ddnycLike().entries,
		matches: ddnycLike().matches,
		votes: [],
		predictions: [],
	};
	fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify(store, null, 2));

	const app = express();
	app.use(express.json());
	app.use('/tourney-api', createRouter({ dataDir }));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const got = await call(server, 'GET', '/arenas/doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs');
		check('arena GET succeeds', got.status === 200, got.text.slice(0, 180));
		assertFlow(got.data.matches, got.data.entries, 'GET repair');
		const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'tourney-store.json'), 'utf8'));
		assertFlow(saved.matches, saved.entries, 'persisted store');

		const again = await call(server, 'GET', '/arenas/doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs');
		const sf = roundOf(again.data.matches, 3);
		check('second GET keeps DickTheDev vs hofer', sf.some((m) => {
			const names = namesIn(m, new Map(again.data.entries.map((e) => [Number(e.id), e.handle])));
			return names.includes('DickTheDev') && names.includes('hofer');
		}));
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
