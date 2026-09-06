/**
 * End-to-end check of the Legends Bracket host flow against a running server.
 * Usage: node scripts/tourney-smoke.mjs [baseUrl] [hostPassword]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const ORIGIN = process.argv[2] || 'http://127.0.0.1:3000';
const BASE = new URL(ORIGIN).pathname.replace(/\/$/, '') + '/tourney-api';
const { hostname, port } = new URL(ORIGIN);
const HOST_PW = process.argv[3] || 'test-host-pw';

let failures = 0;

function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, headers) {
	// Loopback SYNs get dropped now and then on this host; retry rather than fail the run.
	for (let attempt = 1; ; attempt++) {
		try {
			return await callOnce(method, path, body, headers);
		} catch (err) {
			if (attempt >= 4 || !/ETIMEDOUT|ECONNRESET|ECONNREFUSED/.test(err.code || '')) throw err;
			await sleep(250 * attempt);
		}
	}
}

function callOnce(method, path, body, headers) {
	const payload = body ? JSON.stringify(body) : null;
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: hostname,
			port: port || 80,
			method,
			path: BASE + path,
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
				resolve({ status: res.statusCode, data, isHtml: /^\s*</.test(text), text });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

const hostHeader = { 'x-tourney-host': HOST_PW };

function adminPassword() {
	if (process.env.DD_ADMIN_PASSWORD) return process.env.DD_ADMIN_PASSWORD;
	try {
		const file = path.join(scriptDir, '..', 'public', 'server', 'data', '.dd-admin-password');
		return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
	} catch (_err) {
		return '';
	}
}

async function main() {
	const slug = `smoke-${Date.now().toString(36)}`;

	const unknown = await call('POST', '/arenas/nope/not-a-real-route', {});
	check('unknown route answers JSON, not an HTML page', unknown.status === 404 && !unknown.isHtml && unknown.data && unknown.data.error, unknown.text.slice(0, 120));

	const created = await call('POST', '/arenas', {
		hostPassword: HOST_PW,
		name: 'Smoke Test Open',
		slug,
		format: 'single_elim',
		feeMode: 'paid',
		entryFeeUsd: 5,
		maxPlayers: 8,
		registrationMode: 'signup',
	});
	check('host can create an arena', created.status === 200 && created.data && created.data.slug, created.text.slice(0, 200));
	const arena = created.data.slug;

	const players = [];
	for (const handle of ['Kush', 'Mary', 'Gary']) {
		const entry = await call('POST', `/arenas/${arena}/enter`, {
			handle,
			fromWallet: `WALLET-${handle}-0000`,
			payAsset: 'DOGE',
		});
		check(`${handle} can register without a password`, entry.status === 200 && entry.data && entry.data.id, entry.text.slice(0, 200));
		players.push(entry.data);
	}
	check('paid entries start unpaid', players.every((p) => p.paid === false));

	const asVisitor = await call('GET', `/arenas/${arena}`);
	check('visitor read succeeds', asVisitor.status === 200);
	check('visitor is not treated as host', asVisitor.data.viewerIsHost === false);
	const leaked = asVisitor.data.entries.filter((e) => e.invoiceCode || e.fromWallet || e.wallet || e.email);
	check('visitor cannot see invoices, wallets or emails', leaked.length === 0, JSON.stringify(asVisitor.data.entries[0]));

	const asHost = await call('GET', `/arenas/${arena}`, null, hostHeader);
	check('host header unlocks the roster detail', asHost.data.viewerIsHost === true);
	check('host sees invoice codes', asHost.data.entries.every((e) => Boolean(e.invoiceCode)));
	check('host sees the sending wallet', asHost.data.entries.every((e) => Boolean(e.fromWallet)));

	const confirmOne = await call('POST', `/arenas/${arena}/confirm`, { hostPassword: HOST_PW, entryIds: [players[0].id] });
	check('confirm one payment returns JSON (no 404 HTML)', confirmOne.status === 200 && !confirmOne.isHtml, confirmOne.text.slice(0, 200));
	check('confirmed entry is marked paid', confirmOne.data.entries.find((e) => e.id === players[0].id).paid === true);

	const undo = await call('POST', `/arenas/${arena}/confirm`, { hostPassword: HOST_PW, entryIds: [players[0].id], paid: false });
	check('undo drops the entry back to unpaid', undo.data.entries.find((e) => e.id === players[0].id).paid === false);

	const confirmAll = await call('POST', `/arenas/${arena}/confirm`, {
		hostPassword: HOST_PW,
		entryIds: players.map((p) => p.id),
	});
	check('confirm all marks every entry paid', confirmAll.data.entries.every((e) => e.paid), confirmAll.text.slice(0, 200));

	const noSearch = await call('GET', '/players/search?q=k');
	check('player search without host is refused', noSearch.status === 403, noSearch.text.slice(0, 200));
	const search = await call('GET', '/players/search?q=k', null, hostHeader);
	check('host can search discord handles', search.status === 200 && Array.isArray(search.data && search.data.players), search.text.slice(0, 200));

	const added = await call('POST', `/arenas/${arena}/add-entry`, { hostPassword: HOST_PW, handle: 'WalkIn' });
	check('host can add a player directly', added.status === 200 && added.data.entries.some((e) => e.handle === 'WalkIn' && e.paid), added.text.slice(0, 200));

	const walkIn = added.data.entries.find((e) => e.handle === 'WalkIn');
	const removed = await call('POST', `/arenas/${arena}/remove-entry`, { hostPassword: HOST_PW, entryId: walkIn.id });
	check('host can remove an entry', removed.status === 200 && !removed.data.entries.some((e) => e.id === walkIn.id), removed.text.slice(0, 200));

	const noPw = await call('POST', `/arenas/${arena}/confirm`, { entryIds: [players[0].id] });
	check('confirm without the host password is refused', noPw.status === 403, noPw.text.slice(0, 200));

	const locked = await call('POST', `/arenas/${arena}/generate`, {
		hostPassword: HOST_PW,
		shuffle: true,
		confirmSelected: false,
		checkInSelected: true,
		entryIds: players.map((p) => p.id),
		bestOf: 3,
	});
	check('lock bracket succeeds', locked.status === 200 && locked.data.tournament.status === 'in_progress', locked.text.slice(0, 300));
	check('lock bracket builds matches', (locked.data.matches || []).length > 0);

	const stream = await call('POST', `/arenas/${arena}/settings`, {
		hostPassword: HOST_PW,
		streamUrl: 'https://kick.com/kushmetax',
	});
	check('host can set a Kick stream on a live arena', stream.status === 200 && stream.data.tournament.streamUrl === 'https://kick.com/kushmetax', stream.text.slice(0, 200));
	const badStream = await call('POST', `/arenas/${arena}/settings`, {
		hostPassword: HOST_PW,
		streamUrl: 'https://twitch.tv/nope',
	});
	check('non-Kick stream URLs are refused', badStream.status === 400, badStream.text.slice(0, 200));
	const visitorLive = await call('GET', `/arenas/${arena}`);
	check('visitors see the Kick stream URL', visitorLive.data && visitorLive.data.tournament.streamUrl === 'https://kick.com/kushmetax');

	const ready = (locked.data.matches || []).find((m) => m.status === 'ready');
	check('a match is ready to report', Boolean(ready));
	if (ready) {
		const reported = await call('POST', `/arenas/${arena}/report`, {
			hostPassword: HOST_PW,
			matchId: ready.id,
			bestOf: 3,
			games: [{ winnerSlot: 1 }, { winnerSlot: 1 }],
		});
		check('host can lock a series', reported.status === 200 && reported.data.matches.find((m) => m.id === ready.id).status === 'complete', reported.text.slice(0, 200));
	}

	const cleaned = await call('POST', '/control/remove-arena', { adminPassword: adminPassword(), slug: arena });
	check('test arena is removed again', cleaned.status === 200, cleaned.text.slice(0, 200));

	console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
	process.exit(failures ? 1 : 0);
}

main().catch((err) => {
	console.error('smoke run crashed:', err);
	process.exit(1);
});
