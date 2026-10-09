'use strict';

/**
 * Reigning Champ mode plus the "bracket ended up empty and the arena never closed" cases:
 * byes that decide a round, hand-edited seats, a field that collapses to nobody, and the
 * host repair pass that settles all of it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const HOST_PW = 'test-host-pw';
const ADMIN_PW = 'test-admin-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-champ-'));
fs.writeFileSync(path.join(dataDir, '.tourney-password'), `${HOST_PW}\n`);
fs.writeFileSync(path.join(dataDir, '.dd-admin-password'), `${ADMIN_PW}\n`);
// Keep the accounts DB out of this run; nothing here needs Discord links.
process.env.DEX_DB_PATH = path.join(dataDir, 'accounts.sqlite');

const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const createRouter = require('../public/server/routes/tourney-bracket');
fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify({
	nextId: 500, tournaments: [], entries: [], matches: [], votes: [], predictions: [],
}, null, 2));

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

async function makeArena(server, name, handles, extra) {
	const created = await call(server, 'POST', '/arenas', {
		hostPassword: HOST_PW,
		name,
		format: 'single_elim',
		maxPlayers: 16,
		entryFeeUsd: 0,
		registrationMode: 'list',
		requireAccount: false,
		...(extra || {}),
	});
	if (created.status !== 200) throw new Error(`create failed: ${created.text}`);
	const slug = created.data.slug;
	let pack = null;
	for (const handle of handles) {
		const added = await call(server, 'POST', `/arenas/${slug}/add-entry`, { hostPassword: HOST_PW, handle });
		if (added.status !== 200) throw new Error(`add ${handle} failed: ${added.text}`);
		pack = added.data;
	}
	return { slug, pack };
}

const entryId = (pack, handle) => {
	const found = (pack.entries || []).find((e) => e.handle === handle);
	return found ? found.id : 0;
};
const matchesOn = (pack, side) => (pack.matches || []).filter((m) => m.side === side);
const titleMatch = (pack) => matchesOn(pack, 'title')[0] || null;
const openMatches = (pack) => (pack.matches || []).filter((m) => (
	m.status !== 'complete' && m.status !== 'bye' && m.status !== 'vacant'
));
const readyMatch = (pack) => (pack.matches || []).find((m) => m.status === 'ready') || null;

/** Pull everyone out of one match. A bye re-seats the survivor, so re-read between clears. */
async function emptyMatch(server, slug, data, matchId) {
	let pack = data;
	for (let guard = 0; guard < 6; guard += 1) {
		const match = (pack.matches || []).find((m) => m.id === matchId);
		if (!match) break;
		const slot = match.entry1Id ? 1 : match.entry2Id ? 2 : 0;
		if (!slot) break;
		const res = await call(server, 'POST', `/arenas/${slug}/place-entry`, {
			hostPassword: HOST_PW, matchId, slot, entryId: 0,
		});
		if (res.status !== 200) throw new Error(`clear slot ${slot}: ${res.text}`);
		pack = res.data;
	}
	return pack;
}

/** Report every ready match until the arena stops handing them out. */
async function playOutField(server, slug, pack, stopAtTitle) {
	let data = pack;
	for (let guard = 0; guard < 64; guard += 1) {
		const next = (data.matches || []).find((m) => (
			m.status === 'ready' && !(stopAtTitle && m.side === 'title')
		));
		if (!next) break;
		const res = await call(server, 'POST', `/arenas/${slug}/report`, {
			hostPassword: HOST_PW,
			matchId: next.id,
			score1: 1,
			score2: 0,
		});
		if (res.status !== 200) throw new Error(`report ${next.id} failed: ${res.text}`);
		data = res.data;
	}
	return data;
}

async function main() {
	const app = express();
	app.use(express.json());
	app.use('/tourney-api', createRouter({ dataDir }));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});

	try {
		// ---- Reigning Champ: champ sits out the field, then defends the belt ----
		{
			const { slug, pack } = await makeArena(server, 'Champ Mode', ['Bark', 'Ada', 'Bo', 'Cy', 'Dot']);
			const champId = entryId(pack, 'Bark');
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW,
				reigningChamp: true,
				reigningChampEntryId: champId,
				bestOf: 1,
			});
			check('champ lock succeeds', locked.status === 200, locked.text.slice(0, 200));
			const seatedInField = (locked.data.matches || []).some((m) => (
				m.side !== 'title' && (Number(m.entry1Id) === champId || Number(m.entry2Id) === champId)
			));
			check('champ is kept out of the field bracket', !seatedInField);
			check('a title match exists', Boolean(titleMatch(locked.data)));
			check('title match seats the champ', Number(titleMatch(locked.data).entry1Id) === champId);
			check('field is the other four', matchesOn(locked.data, 'winners').length === 3);

			const afterField = await playOutField(server, slug, locked.data, true);
			const title = titleMatch(afterField);
			check('title match is ready once the field is done', title && title.status === 'ready', title && title.status);
			check('challenger is the field winner', title && Number(title.entry2Id) > 0);
			check('arena is still live until the belt match is played', afterField.tournament.status === 'in_progress');

			const belt = await call(server, 'POST', `/arenas/${slug}/report`, {
				hostPassword: HOST_PW,
				matchId: title.id,
				score1: 0,
				score2: 1,
			});
			check('title match reports', belt.status === 200, belt.text.slice(0, 200));
			check('arena closes after the belt match', belt.data.tournament.status === 'completed');
			check('champion is the title winner', Number(belt.data.champion.id) === Number(title.entry2Id),
				JSON.stringify(belt.data.champion));
			check('podium runner-up is the beaten champ', Number(belt.data.podium.second.id) === champId,
				JSON.stringify(belt.data.podium.second));
		}

		// ---- A field that collapses to nobody: the champ keeps the belt, arena closes ----
		{
			const { slug, pack } = await makeArena(server, 'Empty Field', ['Bark', 'Ada', 'Bo']);
			const champId = entryId(pack, 'Bark');
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW,
				reigningChamp: true,
				reigningChampEntryId: champId,
				bestOf: 1,
			});
			check('two-challenger lock succeeds', locked.status === 200, locked.text.slice(0, 200));
			const field = matchesOn(locked.data, 'winners').find((m) => m.entry1Id && m.entry2Id);
			const data = await emptyMatch(server, slug, locked.data, field.id);
			check('emptied field leaves nothing open to play',
				!openMatches(data).some((m) => m.side !== 'title'),
				JSON.stringify(openMatches(data).map((m) => [m.side, m.status])));
			check('champ keeps the belt by walkover', titleMatch(data).status === 'bye');
			check('emptied arena still closes', data.tournament.status === 'completed',
				data.tournament.status);
			check('champion is the reigning champ', Number(data.champion.id) === champId);
		}

		// ---- Turning Reigning Champ off clears the title match instead of hanging ----
		{
			const { slug, pack } = await makeArena(server, 'Champ Off', ['Bark', 'Ada', 'Bo', 'Cy']);
			const champId = entryId(pack, 'Bark');
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, reigningChamp: true, reigningChampEntryId: champId, bestOf: 1,
			});
			const played = await playOutField(server, slug, locked.data, true);
			check('title match blocks the close while champ mode is on',
				played.tournament.status === 'in_progress');
			const cleared = await call(server, 'POST', `/arenas/${slug}/reigning-champ`, {
				hostPassword: HOST_PW, clear: true,
			});
			check('clearing champ mode succeeds', cleared.status === 200, cleared.text.slice(0, 200));
			check('title match is gone', !titleMatch(cleared.data));
			check('arena closes once the belt match is removed',
				cleared.data.tournament.status === 'completed', cleared.data.tournament.status);
		}

		// ---- Byes decide the bracket: a champion is still recorded ----
		{
			const { slug } = await makeArena(server, 'Bye Bracket', ['Ada', 'Bo', 'Cy', 'Dot', 'Eve']);
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, bestOf: 1,
			});
			const r1 = matchesOn(locked.data, 'winners').filter((m) => Number(m.round) === 1);
			check('five players give three first-round byes',
				r1.filter((m) => m.status === 'bye').length === 3,
				JSON.stringify(r1.map((m) => m.status)));
			const played = await playOutField(server, slug, locked.data);
			check('bye-heavy bracket closes', played.tournament.status === 'completed',
				played.tournament.status);
			check('bye-heavy bracket names a champion', Boolean(played.champion && played.champion.id),
				JSON.stringify(played.champion));
		}

		// ---- Moving a player who is sitting on a bye ----
		{
			const { slug } = await makeArena(server, 'Bye Swap', ['Ada', 'Bo', 'Cy', 'Dot', 'Eve']);
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, bestOf: 1,
			});
			const r1 = matchesOn(locked.data, 'winners').filter((m) => Number(m.round) === 1);
			const byeMatch = r1.find((m) => m.status === 'bye');
			const playMatch = r1.find((m) => m.status === 'ready');
			const onBye = Number(byeMatch.entry1Id || byeMatch.entry2Id);
			const playing = Number(playMatch.entry1Id);
			const swapped = await call(server, 'POST', `/arenas/${slug}/swap-seeds`, {
				hostPassword: HOST_PW, entryIdA: onBye, entryIdB: playing,
			});
			check('a bye player can trade places with someone in a real match',
				swapped.status === 200, swapped.text.slice(0, 200));
			const seatsOf = (pack, id) => (pack.matches || []).filter((m) => (
				Number(m.entry1Id) === Number(id) || Number(m.entry2Id) === Number(id)
			));
			check('the swap does not leave a player in two first-round seats',
				seatsOf(swapped.data, onBye).filter((m) => Number(m.round) === 1 && m.side === 'winners').length === 1,
				JSON.stringify(seatsOf(swapped.data, onBye).map((m) => `${m.side} r${m.round} p${m.position}`)));
			const newBye = (swapped.data.matches || []).find((m) => m.id === byeMatch.id);
			check('the bye now belongs to the player who moved into it',
				Number(newBye.entry1Id || newBye.entry2Id) === playing,
				JSON.stringify({ seat: newBye.entry1Id || newBye.entry2Id, playing }));
			check('the bye pushes its new owner forward, not the old one',
				Number(newBye.winnerId) === playing, JSON.stringify(newBye.winnerId));
			const finished = await playOutField(server, slug, swapped.data);
			check('a bracket swapped at a bye still closes',
				finished.tournament.status === 'completed', finished.tournament.status);
		}

		// ---- Every result recorded but a hand-edited seat left a match unplayable ----
		{
			const { slug, pack } = await makeArena(server, 'Stuck Bracket', ['Ada', 'Bo', 'Cy', 'Dot']);
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, bestOf: 1,
			});
			const semi = matchesOn(locked.data, 'winners').filter((m) => Number(m.round) === 1);
			const first = await call(server, 'POST', `/arenas/${slug}/report`, {
				hostPassword: HOST_PW, matchId: semi[0].id, score1: 1, score2: 0,
			});
			// Host pulls both players out of the other semi and never replays it.
			const data = await emptyMatch(server, slug, first.data, semi[1].id);
			check('vacated semi does not strand the final',
				data.tournament.status === 'completed', data.tournament.status);
			check('the surviving player is champion',
				Number(data.champion.id) === Number(semi[0].entry1Id),
				JSON.stringify(data.champion));
			check('unused entry ids stay addressable', entryId(pack, 'Dot') > 0);
		}

		// ---- Host repair: force-close an arena whose rounds are all recorded ----
		{
			const { slug } = await makeArena(server, 'Repair Me', ['Ada', 'Bo', 'Cy', 'Dot', 'Eve', 'Fox']);
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, bestOf: 1,
			});
			const ready = readyMatch(locked.data);
			const one = await call(server, 'POST', `/arenas/${slug}/report`, {
				hostPassword: HOST_PW, matchId: ready.id, score1: 1, score2: 0,
			});
			check('arena is mid-flight', one.data.tournament.status === 'in_progress');
			const plain = await call(server, 'POST', `/arenas/${slug}/repair-bracket`, {
				hostPassword: HOST_PW,
			});
			check('plain repair leaves playable matches alone',
				plain.data.tournament.status === 'in_progress'
				&& openMatches(plain.data).some((m) => m.entry1Id && m.entry2Id));
			const forced = await call(server, 'POST', `/arenas/${slug}/repair-bracket`, {
				hostPassword: HOST_PW, force: true,
			});
			check('forced repair still will not auto-decide a real matchup',
				forced.data.tournament.status === 'in_progress',
				forced.data.tournament.status);
			const rest = await playOutField(server, slug, forced.data);
			check('arena closes once the real matchups are reported',
				rest.tournament.status === 'completed', rest.tournament.status);
			check('repair kept a champion', Boolean(rest.champion && rest.champion.id));
			const repaired = await call(server, 'POST', `/arenas/${slug}/repair-bracket`, {
				hostPassword: HOST_PW, force: true,
			});
			check('repair is safe to re-run on a closed arena',
				repaired.data.tournament.status === 'completed');
		}

		// ---- Naming the Reigning Champ mid-tournament reopens with a belt match ----
		{
			const { slug, pack } = await makeArena(server, 'Late Champ', ['Ada', 'Bo', 'Cy', 'Dot']);
			const locked = await call(server, 'POST', `/arenas/${slug}/generate`, {
				hostPassword: HOST_PW, bestOf: 1,
			});
			const semi = matchesOn(locked.data, 'winners').filter((m) => Number(m.round) === 1);
			const played = await call(server, 'POST', `/arenas/${slug}/report`, {
				hostPassword: HOST_PW, matchId: semi[0].id, score1: 1, score2: 0,
			});
			const champId = entryId(pack, 'Dot');
			const named = await call(server, 'POST', `/arenas/${slug}/reigning-champ`, {
				hostPassword: HOST_PW, entryId: champId,
			});
			check('naming a champ mid-run succeeds', named.status === 200, named.text.slice(0, 200));
			check('a belt match appears', Boolean(titleMatch(named.data)));
			check('champ is pulled out of unplayed field matches',
				!(named.data.matches || []).some((m) => (
					m.side !== 'title' && m.status !== 'complete'
					&& (Number(m.entry1Id) === champId || Number(m.entry2Id) === champId)
				)));
			const finished = await playOutField(server, slug, named.data, true);
			const belt = titleMatch(finished);
			check('belt match waits for the field winner',
				belt && belt.status === 'ready' && Number(belt.entry2Id) > 0,
				belt && `${belt.status}/${belt.entry2Id}`);
			const done = await call(server, 'POST', `/arenas/${slug}/report`, {
				hostPassword: HOST_PW, matchId: belt.id, score1: 1, score2: 0,
			});
			check('late champ arena closes', done.data.tournament.status === 'completed');
			check('late champ keeps the belt', Number(done.data.champion.id) === champId);
		}
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
