'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');
const { restoreMissingArenasFromRecords } = require('../public/server/lib/arena-archive');

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

function mockDb(events, results) {
	return {
		prepare(sql) {
			return {
				all() {
					if (/FROM tourney_events/i.test(sql)) return events;
					if (/FROM tourney_results/i.test(sql)) return results;
					return [];
				},
			};
		},
	};
}

function emptyStore() {
	return { nextId: 1, tournaments: [], entries: [], matches: [], votes: [], predictions: [] };
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
				'x-tourney-host': 'test-host-pw',
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

async function main() {
	const events = [
		{ tournament_id: 39, slug: 'ddl-alpha-arena-vrnr', name: 'DDL Alpha Arena', format: 'single_elim', stage_type: 'single', field_size: 13, official: 1, completed_at: '2026-08-29T20:54:20.926Z', event_kind: 'tournament' },
		{ tournament_id: 57, slug: 'shock-vs-dick-the-finals-zekg', name: 'Shock vs Dick - The Finals', format: 'single_elim', stage_type: 'single', field_size: 2, official: 1, completed_at: '2026-08-28T02:39:05.390Z', event_kind: 'duel' },
		{ tournament_id: 140, slug: 'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs', name: 'Doginal Dogs Legends TCG - DDNYC 2026 IRL Tournament', format: 'single_elim', stage_type: 'single', field_size: 16, official: 1, completed_at: '2026-09-04T02:14:15.104Z', event_kind: 'tournament' },
	];
	const results = [
		{ tournament_id: 39, entry_id: 51, user_id: 9, handle: 'Shock', placement: 1, record: '4-0' },
		{ tournament_id: 39, entry_id: 62, user_id: 14, handle: 'Reef', placement: 2, record: '3-1' },
		{ tournament_id: 39, entry_id: 63, user_id: 4, handle: 'Giga', placement: 3, record: '2-1' },
		{ tournament_id: 57, entry_id: 58, user_id: 9, handle: 'Shock', placement: 1, record: '1-0' },
		{ tournament_id: 57, entry_id: 59, user_id: 8, handle: 'DickTheDev', placement: 2, record: '0-1' },
	];
	const store = emptyStore();
	const noDb = restoreMissingArenasFromRecords(emptyStore(), null);
	check('snapshots restore without a records database', noDb.snapshots === 2 && noDb.restored === 0, JSON.stringify(noDb));
	const first = restoreMissingArenasFromRecords(store, mockDb(events, results));
	check('restores recorded duels plus DDNYC and Alpha snapshots', first.restored === 1 && first.snapshots === 2, JSON.stringify(first));
	check('Alpha Arena is back', store.tournaments.some((t) => t.slug === 'ddl-alpha-arena-vrnr'));
	check('Shock vs Dick duel is back', store.tournaments.some((t) => t.slug === 'shock-vs-dick-the-finals-zekg'));
	const ddnyc = store.tournaments.find((t) => t.id === 140);
	check('DDNYC arena is back', Boolean(ddnyc));
	check('DDNYC has the 16-player roster', store.entries.filter((e) => e.tournamentId === 140).length === 16);
	check('DDNYC has the match tree', store.matches.filter((m) => m.tournamentId === 140).length >= 15);
	const alpha = store.tournaments.find((t) => t.id === 39 || t.slug === 'ddl-alpha-arena-vrnr');
	const alphaEntries = store.entries.filter((e) => e.tournamentId === 39);
	const alphaMatches = store.matches.filter((m) => m.tournamentId === 39).sort((a, b) => a.round - b.round || a.position - b.position);
	const alphaR1 = alphaMatches.filter((m) => m.side === 'winners' && Number(m.round) === 1);
	const alphaQf = alphaMatches.filter((m) => m.side === 'winners' && Number(m.round) === 2);
	const alphaFinal = alphaMatches.find((m) => m.side === 'winners' && Number(m.round) === 4);
	check('Alpha has the 13-player roster', alphaEntries.length === 13);
	check('Alpha has the 15-match tree', alphaMatches.length === 15);
	check('Alpha R1 Duck beat Vegas 2-0', alphaR1.some((m) => m.entry1Id === 45 && m.entry2Id === 96 && m.winnerId === 96 && m.score1 === 0 && m.score2 === 2));
	check('Alpha R1 has three byes', alphaR1.filter((m) => m.byeAdvanced).length === 3);
	check('Alpha QF is Duck-Rus, And-Reef, hofer-Giga, Shock-Rylan', (
		alphaQf[0] && alphaQf[0].entry1Id === 96 && alphaQf[0].entry2Id === 80
		&& alphaQf[1] && alphaQf[1].entry1Id === 43 && alphaQf[1].entry2Id === 79
		&& alphaQf[2] && alphaQf[2].entry1Id === 63 && alphaQf[2].entry2Id === 42
		&& alphaQf[3] && alphaQf[3].entry1Id === 51 && alphaQf[3].entry2Id === 62
	));
	check('Alpha finals are Shock vs Reef, Shock won', Boolean(alphaFinal && alphaFinal.entry1Id === 51 && alphaFinal.entry2Id === 79 && alphaFinal.winnerId === 51));
	check('Alpha champion seed is Shock', alphaEntries.find((e) => e.handle === 'Shock' && e.placement === 1));
	const duelMatch = store.matches.find((m) => m.tournamentId === 57);
	check('duel is rebuilt as one completed match', Boolean(duelMatch && duelMatch.winnerId === 58));
	const again = restoreMissingArenasFromRecords(store, mockDb(events, results));
	check('second restore is a no-op', again.restored === 0 && again.snapshots === 0, JSON.stringify(again));

	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-restore-'));
	fs.writeFileSync(path.join(dataDir, '.tourney-password'), 'test-host-pw\n');
	fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify(emptyStore(), null, 2));
	const app = express();
	app.use(express.json());
	app.use('/tourney-api', createRouter({ dataDir }));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const listed = await call(server, 'GET', '/arenas');
		const slugs = (listed.data || []).map((t) => t.slug);
		check('empty store GET restores DDNYC onto the arena list', listed.status === 200 && slugs.includes('doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs'), listed.text.slice(0, 180));
		check('empty store GET restores Alpha Arena onto the arena list', listed.status === 200 && slugs.includes('ddl-alpha-arena-vrnr'), listed.text.slice(0, 180));
		const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'tourney-store.json'), 'utf8'));
		check('restored store is persisted', (saved.tournaments || []).some((t) => t.id === 140) && (saved.tournaments || []).some((t) => t.id === 39));
		const detail = await call(server, 'GET', '/arenas/doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs');
		check('DDNYC bracket is on the restored arena', detail.status === 200 && (detail.data.matches || []).length >= 15, detail.text.slice(0, 180));
		check('DickTheDev is still champion', detail.data && detail.data.champion && detail.data.champion.handle === 'DickTheDev');
		const alphaDetail = await call(server, 'GET', '/arenas/ddl-alpha-arena-vrnr');
		check('Alpha bracket is on the restored arena', alphaDetail.status === 200 && (alphaDetail.data.matches || []).length === 15, (alphaDetail.text || '').slice(0, 180));
		check('Shock is still Alpha champion', alphaDetail.data && alphaDetail.data.champion && alphaDetail.data.champion.handle === 'Shock');
	} finally {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
	console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
	process.exit(failures ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
