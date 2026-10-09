'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'public', 'node_modules', 'express'));
const chat = require('../public/server/lib/arena-chat');
const createRouter = require('../public/server/routes/tourney-bracket');

const HOST_PW = 'test-host-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-tourney-chat-'));
fs.writeFileSync(path.join(dataDir, '.tourney-password'), `${HOST_PW}\n`);

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

function libChecks() {
	check('strips control chars from body', chat.sanitizeBody('hi\u0007 there') === 'hi there');
	check('caps body length', chat.sanitizeBody('x'.repeat(400)).length === chat.MAX_BODY);
	check('rejects javascript avatars', chat.safeAvatarUrl('javascript:alert(1)') === '');
	check('allows discord avatars', chat.safeAvatarUrl('https://cdn.discordapp.com/avatars/1/a.png') !== '');

	const added = chat.addMessage(dataDir, 'vis-cup', {
		userId: 7,
		handle: 'Kush',
		avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
		role: 'host',
		body: 'Bracket is live',
	});
	check('stores a message', added.id === 1 && added.handle === 'Kush' && added.role === 'host');

	const snap = chat.readRoom(dataDir, 'vis-cup', 0);
	check('snapshot includes the message', snap.rev === 1 && snap.messages.length === 1 && snap.messages[0].body === 'Bracket is live');

	const same = chat.readRoom(dataDir, 'vis-cup', snap.rev);
	check('matching rev is unchanged', same.unchanged === true && same.messages.length === 0);

	try {
		chat.addMessage(dataDir, 'vis-cup', { userId: 7, handle: 'Kush', body: 'Bracket is live' });
		check('duplicate is rejected', false);
	} catch (err) {
		check('duplicate is rejected', err.status === 429);
	}

	try {
		chat.addMessage(dataDir, 'vis-cup', { userId: 0, handle: 'Kush', body: 'nope' });
		check('unsigned post is rejected', false);
	} catch (err) {
		check('unsigned post is rejected', err.status === 401);
	}

	try {
		chat.deleteMessage(dataDir, 'vis-cup', added.id, { userId: 99, moderate: false });
		check('other users cannot delete', false);
	} catch (err) {
		check('other users cannot delete', err.status === 403);
	}

	const dropped = chat.deleteMessage(dataDir, 'vis-cup', added.id, { userId: 7, moderate: false });
	check('author can delete', dropped.ok === true);
	check('delete bumps rev', chat.readRoom(dataDir, 'vis-cup', 0).messages.length === 0);

	chat.removeRoom(dataDir, 'vis-cup');
	check('room file can be removed', chat.readRoom(dataDir, 'vis-cup', 0).messages.length === 0);
}

async function httpChecks() {
	const now = new Date().toISOString();
	fs.writeFileSync(path.join(dataDir, 'tourney-store.json'), JSON.stringify({
		nextId: 4,
		tournaments: [{
			id: 1,
			slug: 'chat-cup',
			name: 'Chat Cup',
			format: 'single_elim',
			status: 'in_progress',
			feeMode: 'free',
			maxPlayers: 8,
			bestOf: 3,
			createdAt: now,
			streamUrl: 'https://kick.com/kushmetax',
		}],
		entries: [
			{ id: 2, tournamentId: 1, handle: 'Ash', paid: true, status: 'confirmed', createdAt: now },
			{ id: 3, tournamentId: 1, handle: 'Blaze', paid: true, status: 'confirmed', createdAt: now },
		],
		matches: [],
		votes: [],
		predictions: [],
	}, null, 2));

	chat.addMessage(dataDir, 'chat-cup', {
		userId: 11,
		handle: 'Ash',
		role: 'player',
		body: 'Good luck',
	});

	const app = express();
	app.use(express.json());
	app.use('/tourney-api', createRouter({ dataDir, dogeWatch: { enabled: false } }));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const missing = await call(server, 'GET', '/arenas/nope/chat?viewer=anonview1');
		check('unknown arena chat is 404', missing.status === 404);

		const got = await call(server, 'GET', '/arenas/chat-cup/chat?viewer=anonview1');
		check('public chat GET works', got.status === 200, got.text.slice(0, 180));
		check('seeded message is visible', got.data && Array.isArray(got.data.messages) && got.data.messages.some((m) => m.body === 'Good luck'));
		check('guests cannot post', got.data && got.data.canPost === false);
		check('watching counts the viewer', got.data && Number(got.data.watching) >= 1);

		const again = await call(server, 'GET', `/arenas/chat-cup/chat?rev=${encodeURIComponent(got.data.rev)}&viewer=anonview1`);
		check('unchanged poll is cheap', again.status === 200 && again.data && again.data.unchanged === true);

		const posted = await call(server, 'POST', '/arenas/chat-cup/chat', { body: 'hello from the crowd' });
		check('unsigned POST is 401', posted.status === 401, posted.text.slice(0, 180));

		const removed = await call(server, 'POST', '/arenas/chat-cup/chat/delete', { id: got.data.messages[0].id });
		check('unsigned delete is 401', removed.status === 401);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function main() {
	try {
		libChecks();
		await httpChecks();
	} finally {
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
