/**
 * Renders the Legends Bracket UI in jsdom against a running server and walks the
 * visitor and host paths, failing on any console error or missing control.
 *
 * jsdom stays out of the site's package.json. Install it somewhere scratch first:
 *
 *   mkdir %TEMP%\ddl-jsdom && cd %TEMP%\ddl-jsdom && npm init -y && npm i jsdom
 *   node scripts/tourney-ui-smoke.mjs http://127.0.0.1:3000 test-host-pw
 *
 * Point DDL_JSDOM at jsdom's lib/api.js if it lives anywhere else.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const jsdomEntry = process.env.DDL_JSDOM
	|| path.join(os.tmpdir(), 'ddl-jsdom', 'node_modules', 'jsdom', 'lib', 'api.js');
if (!fs.existsSync(jsdomEntry)) {
	console.error(`jsdom not found at ${jsdomEntry}. See the install line at the top of this file.`);
	process.exit(1);
}
const { JSDOM, VirtualConsole } = await import(pathToFileURL(jsdomEntry).href);

const ORIGIN = process.argv[2] || 'http://127.0.0.1:3000';
const HOST_PW = process.argv[3] || 'test-host-pw';
const { hostname, port } = new URL(ORIGIN);
const repoRoot = path.resolve(scriptDir, '..');

let failures = 0;
const consoleErrors = [];

function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

async function request(method, urlPath, body, headers) {
	// Loopback SYNs get dropped now and then on this host; retry rather than fail the run.
	for (let attempt = 1; ; attempt++) {
		try {
			return await requestOnce(method, urlPath, body, headers);
		} catch (err) {
			if (attempt >= 4 || !/ETIMEDOUT|ECONNRESET|ECONNREFUSED/.test(err.code || '')) throw err;
			await sleep(250 * attempt);
		}
	}
}

function requestOnce(method, urlPath, body, headers) {
	const payload = body ? JSON.stringify(body) : null;
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: hostname,
			port: port || 80,
			method,
			path: urlPath,
			headers: {
				...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
				...(headers || {}),
			},
		}, (res) => {
			let text = '';
			res.setEncoding('utf8');
			res.on('data', (c) => { text += c; });
			res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for the app shell to paint something matching `probe`. */
async function waitFor(win, probe, label) {
	for (let i = 0; i < 80; i++) {
		try {
			if (probe(win.document)) return true;
		} catch (_err) { /* keep polling */ }
		await sleep(50);
	}
	check(`waited for ${label}`, false, 'timed out');
	return false;
}

function textOf(doc) {
	return doc.getElementById('app').textContent.replace(/\s+/g, ' ');
}

function buttonByText(doc, needle) {
	return [...doc.querySelectorAll('button, a')].find((b) => b.textContent.trim().toLowerCase().includes(needle.toLowerCase())) || null;
}

async function openApp() {
	const virtualConsole = new VirtualConsole();
	virtualConsole.on('jsdomError', (err) => consoleErrors.push(`jsdomError: ${err.message}`));
	virtualConsole.on('error', (...args) => consoleErrors.push(`console.error: ${args.join(' ')}`));

	const html = fs.readFileSync(path.join(repoRoot, 'bracket', 'index.html'), 'utf8');
	const dom = new JSDOM(html, {
		url: `${ORIGIN}/tourney/#/`,
		runScripts: 'outside-only',
		pretendToBeVisual: true,
		virtualConsole,
	});
	const win = dom.window;

	// jsdom has no fetch; route the app's calls at the live server over http.
	win.fetch = async (url, options = {}) => {
		const target = new URL(url, `${ORIGIN}/`);
		const res = await request(options.method || 'GET', target.pathname + target.search, options.body ? JSON.parse(options.body) : null, options.headers);
		return {
			ok: res.status >= 200 && res.status < 300,
			status: res.status,
			text: async () => res.text,
		};
	};
	win.requestAnimationFrame = (cb) => win.setTimeout(() => cb(Date.now()), 0);
	win.navigator.clipboard = { writeText: async () => {} };
	win.alert = (msg) => consoleErrors.push(`unexpected alert: ${msg}`);
	win.confirm = () => true;

	const appJs = fs.readFileSync(path.join(repoRoot, 'bracket', 'app.js'), 'utf8');
	win.eval(appJs);
	return win;
}

async function main() {
	// Seed an arena with one paid and one unpaid entry.
	const slug = `uismoke-${Date.now().toString(36)}`;
	const api = (method, p, body, headers) => request(method, `/tourney-api${p}`, body, headers);
	await api('POST', '/arenas', {
		hostPassword: HOST_PW,
		name: 'UI Smoke Cup',
		slug,
		format: 'single_elim',
		feeMode: 'paid',
		entryFeeUsd: 5,
		maxPlayers: 8,
		registrationMode: 'signup',
	});
	for (const handle of ['Alpha', 'Bravo']) {
		await api('POST', `/arenas/${slug}/enter`, { handle, fromWallet: `WALLET-${handle}-123456`, payAsset: 'DOGE' });
	}

	const win = await openApp();
	const doc = win.document;

	// ---- visitor ----------------------------------------------------------
	await waitFor(win, (d) => d.getElementById('app').textContent.includes('UI Smoke Cup'), 'home list');
	check('visitor home does not show an admin password box', !doc.getElementById('apw'));
	check('visitor home hides the New tournament link', doc.getElementById('nav-create').hidden);
	check('host toggle offers sign in', doc.getElementById('host-toggle').textContent === 'Host sign in');

	win.location.hash = `#/t/${slug}`;
	await waitFor(win, (d) => d.querySelector('.arena-nav'), 'arena tabs');
	await sleep(200);
	const visitorTabs = [...doc.querySelectorAll('.arena-nav button')].map((b) => b.textContent.trim());
	check('visitor sees no Host tools tab', !visitorTabs.some((t) => /host/i.test(t)), visitorTabs.join(', '));
	check('visitor lands on Register for an open arena', textOf(doc).includes('Register'), visitorTabs.join(', '));

	doc.querySelector('[data-tab="players"]').click();
	await sleep(150);
	const rosterText = textOf(doc);
	check('visitor roster lists handles', rosterText.includes('Alpha') && rosterText.includes('Bravo'));
	check('visitor roster hides sending wallets', !rosterText.includes('WALLET-'), rosterText.slice(0, 200));
	check('visitor roster hides invoice codes', !/DDL-[A-Z0-9]{8}/.test(rosterText));
	check('visitor roster has no confirm buttons', !doc.querySelector('[data-confirm]'));

	doc.querySelector('[data-tab="bracket"]').click();
	await sleep(150);
	check('visitor bracket explains the wait instead of showing host controls', textOf(doc).includes('Registration is open'), textOf(doc).slice(0, 200));
	check('visitor bracket has no lock button', !doc.getElementById('lock-btn'));

	// ---- host sign in -----------------------------------------------------
	doc.getElementById('host-toggle').click();
	await waitFor(win, (d) => d.getElementById('hs-pw'), 'host sign-in dialog');
	doc.getElementById('hs-pw').value = HOST_PW;
	doc.getElementById('hs-go').click();
	await waitFor(win, (d) => d.getElementById('host-toggle').textContent === 'Host mode on', 'host mode');
	check('host toggle reports host mode', doc.getElementById('host-toggle').textContent === 'Host mode on');
	check('New tournament link appears for the host', !doc.getElementById('nav-create').hidden);

	win.location.hash = `#/t/${slug}`;
	await waitFor(win, (d) => d.querySelector('.arena-nav'), 'arena tabs as host');
	await sleep(250);
	const hostTabs = [...doc.querySelectorAll('.arena-nav button')].map((b) => b.textContent.trim());
	check('host sees a Host tools tab', hostTabs.some((t) => /host tools/i.test(t)), hostTabs.join(', '));
	check('Players tab flags entries awaiting confirmation', hostTabs.some((t) => /to confirm/i.test(t)), hostTabs.join(', '));

	check('host bracket tab offers the lock card', Boolean(doc.getElementById('lock-btn')), textOf(doc).slice(0, 300));
	check('lock is disabled while nobody has paid', doc.getElementById('lock-btn').disabled);

	// ---- confirm payments -------------------------------------------------
	doc.querySelector('[data-tab="players"]').click();
	await sleep(200);
	const hostRoster = textOf(doc);
	check('host roster shows the sending wallet', hostRoster.includes('WALLET-ALPHA-123456') || hostRoster.includes('WALLET-Alpha-123456'), hostRoster.slice(0, 300));
	check('host roster shows invoice codes', /DDL-[A-Z0-9]{8}/.test(hostRoster));
	check('host roster has per-player confirm buttons', doc.querySelectorAll('[data-confirm]').length === 2);
	check('host roster offers a confirm-all button', Boolean(doc.getElementById('confirm-all')));
	check('host roster can add a player', Boolean(doc.getElementById('add-handle')));

	doc.querySelector('[data-confirm]').click();
	await waitFor(win, (d) => d.querySelectorAll('[data-confirm]').length === 1, 'one payment confirmed');
	check('confirming one payment leaves one pending', doc.querySelectorAll('[data-confirm]').length === 1);
	check('confirmed row offers an undo', doc.querySelectorAll('[data-unconfirm]').length === 1);
	check('confirming did not error', !textOf(doc).includes('Restart Node'), textOf(doc).slice(0, 300));

	doc.getElementById('confirm-all').click();
	await waitFor(win, (d) => d.querySelectorAll('[data-confirm]').length === 0, 'all payments confirmed');
	check('confirm all clears the pending list', doc.querySelectorAll('[data-confirm]').length === 0);

	// ---- lock -------------------------------------------------------------
  doc.querySelector('[data-tab="bracket"]').click();
	await sleep(200);
	check('lock button is enabled once two players are confirmed', doc.getElementById('lock-btn') && !doc.getElementById('lock-btn').disabled, textOf(doc).slice(0, 300));
	check('lock card names the confirmed players', textOf(doc).includes('Alpha') && textOf(doc).includes('Bravo'));

	doc.getElementById('lock-btn').click();
	await waitFor(win, (d) => d.querySelector('.match-card'), 'bracket matches');
	check('locking builds a visible bracket', Boolean(doc.querySelector('.match-card')));
	const lockErr = doc.getElementById('lock-err');
	check('locking reported no error', !lockErr || lockErr.hidden);
	check('host can open a ready match', Boolean(doc.querySelector('.match-card.ready:not([disabled])')));

	// ---- report a series --------------------------------------------------
	doc.querySelector('.match-card.ready:not([disabled])').click();
	await waitFor(win, (d) => d.querySelector('.scorecard'), 'scorecard');
	check('scorecard no longer asks for the password again', !doc.getElementById('sc-pw'));
	const gameButtons = [...doc.querySelectorAll('[data-game][data-slot="1"]')];
	gameButtons[0].click();
	await sleep(60);
	[...doc.querySelectorAll('[data-game][data-slot="1"]')][1].click();
	await sleep(60);
	check('lock series enables after a winner', !doc.getElementById('sc-lock').disabled);
	doc.getElementById('sc-lock').click();
	await waitFor(win, (d) => !d.querySelector('.scorecard'), 'scorecard close');
	await sleep(200);
	check('series result lands on the bracket', Boolean(doc.querySelector('.match-card.complete')), textOf(doc).slice(0, 200));

	// ---- sign out ---------------------------------------------------------
	doc.querySelector('[data-tab="host"]').click();
	await sleep(200);
	check('host tools expose a sign out', Boolean(doc.getElementById('signout-btn')));
	doc.getElementById('signout-btn').click();
	await waitFor(win, (d) => d.getElementById('host-toggle').textContent === 'Host sign in', 'signed out');
	await sleep(250);
	check('signing out drops the Host tools tab', ![...doc.querySelectorAll('.arena-nav button')].some((b) => /host tools/i.test(b.textContent)));
	check('signing out hides the New tournament link', doc.getElementById('nav-create').hidden);

	check('no console errors during the whole run', consoleErrors.length === 0, consoleErrors.join(' | '));

	const pw = fs.readFileSync(path.join(repoRoot, 'public', 'server', 'data', '.dd-admin-password'), 'utf8').split(/\r?\n/)[0].trim();
	await api('POST', '/control/remove-arena', { adminPassword: pw, slug });

	console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
	process.exit(failures ? 1 : 0);
}

main().catch((err) => {
	console.error('ui smoke crashed:', err);
	process.exit(1);
});
