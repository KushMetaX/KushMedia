'use strict';

/**
 * Rebuild tourney-store.json from the pre-overwrite production copy
 * saved at _tools/_kmx-recover/tourney-store.json, then add the two
 * OG-cache slugs that copy did not contain.
 */

const fs = require('fs');
const path = require('path');

const RECOVER = path.join(__dirname, '..', '_tools', '_kmx-recover', 'tourney-store.json');
const DEST = path.join(__dirname, '..', 'public', 'server', 'data', 'tourney-store.json');
const COPY = path.join(__dirname, '..', '_extract', 'tourney-restore', 'tourney-store.json');

const OG_HEX = {
	'5jnsxzqw': '53484f434b2d4449',
	'can-t-make-this-shit-up-monday-tournament-2sq6': '43616ee280997420',
	'ddl-alpha-arena-vrnr': '44444c20416c7068',
	'doginal-dogs-legends-tcg-ddnyc-2026-irl-to-xdvs': '446f67696e616c20',
	'friday-fight-night-yda4': '4672696461792046',
	'pop-up-tourney-uc9i': '506f702075702054',
	'saturday-belt-check-cfp5': '5361747572646179',
	'shock-vs-dick-the-finals-zekg': '53686f636b207673',
	'taco-tuesday-tournament-oxhm': '5461636f20547565',
	'the-belt-defending-circuit-uoxf': '5468652042656c74',
	'the-run-it-back-tournament-q27n': '5468652052756e20',
	'tw-tourney-1': '546865207761796e',
	'wizard-wednesday-war-kwmm': '57697a7a79205765',
	'wyd-showdown-1': '5761726d20796f75',
};

const LOST_ROSTER = 'Restored from the share-image cache after the live arena file was overwritten. Original signups and match scores were not in the recovered snapshot.';

function cacheHex(title) {
	return Buffer.from(String(title || ''), 'utf8').toString('hex').slice(0, 16);
}

function weeklyShell(spec) {
	return {
		id: spec.id,
		slug: spec.slug,
		name: spec.name,
		format: 'single_elim',
		status: 'completed',
		entryFeeUsd: 10,
		entryFeeDoge: 0,
		maxPlayers: 32,
		swissRounds: 5,
		treasury: 'D92759tetUUkf6Hn6Gk9mVKZqST32fN9iT',
		createdAt: spec.createdAt,
		stage: 'main',
		description: LOST_ROSTER,
		hostName: 'Kush',
		streamUrl: '',
		game: 'Doginal Dogs Legends TCG',
		stageType: 'single',
		losersBracket: false,
		breakTies: false,
		registrationMode: 'signup',
		whitelistSpots: 0,
		feeMode: 'paid',
		requireTeams: false,
		capPlayers: true,
		startAt: spec.startAt,
		startTentative: false,
		timezone: 'America/New_York',
		requireCheckIn: false,
		votingEnabled: false,
		predictionsEnabled: false,
		shareImages: true,
		requireVerifiedEmail: false,
		countryLock: false,
		allowedCountries: '',
		predictionCustomFields: false,
		requireAccount: true,
		official: true,
		semiIrl: false,
		requireRegisteredDeck: false,
		deckClassQuota: null,
		groupSize: 4,
		advancePerGroup: 2,
		bestOf: 3,
		finalsBestOf: null,
		rewardMode: 'prize',
		hostPotUsd: 0,
		addedPotUsd: 0,
		potFundMode: 'usd',
		payouts: [{ place: 1, percent: 100, prize: '', addedUsd: 0 }],
		eventKind: 'tournament',
		roundBestOf: { 'winners:1': 3, 'winners:2': 3, 'winners:3': 3 },
		hostUserId: 2,
		playoffFormat: 'single_elim',
		reigningChamp: false,
		reigningChampEntryId: null,
		restoredFromOgCache: true,
		restoredAt: new Date().toISOString(),
	};
}

function main() {
	const store = JSON.parse(fs.readFileSync(RECOVER, 'utf8'));
	if (!Array.isArray(store.tournaments) || store.tournaments.length < 10) {
		throw new Error('recover store looks empty or truncated');
	}

	for (const t of store.tournaments) {
		if (OG_HEX[t.slug]) t.shareImages = true;
	}

	let nextId = Number(store.nextId) || 57242;
	const have = new Set(store.tournaments.map((t) => t.slug));

	const missing = [
		{
			id: nextId,
			slug: 'wizard-wednesday-war-kwmm',
			name: 'Wizzy Wednesday War',
			createdAt: '2026-09-16T14:02:00.000Z',
			startAt: '2026-09-16T19:30',
		},
		{
			id: nextId + 1,
			slug: 'tw-tourney-1',
			name: 'The wayne tourney',
			createdAt: '2026-09-17T22:30:00.000Z',
			startAt: '2026-09-17T19:30',
		},
	];
	for (const spec of missing) {
		if (have.has(spec.slug)) continue;
		store.tournaments.push(weeklyShell(spec));
		have.add(spec.slug);
		nextId = Math.max(nextId, spec.id + 1);
	}
	store.nextId = nextId;

	const mismatches = [];
	for (const [slug, hex] of Object.entries(OG_HEX)) {
		const t = store.tournaments.find((row) => row.slug === slug);
		if (!t) {
			mismatches.push(`${slug} missing`);
			continue;
		}
		const got = cacheHex(t.name);
		if (got !== hex) mismatches.push(`${slug} name ${JSON.stringify(t.name)} hex ${got} != ${hex}`);
	}
	if (mismatches.length) {
		throw new Error(`OG cache key mismatch:\n${mismatches.join('\n')}`);
	}

	store.tournaments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
	const payload = `${JSON.stringify(store, null, 2)}\n`;
	fs.mkdirSync(path.dirname(DEST), { recursive: true });
	fs.mkdirSync(path.dirname(COPY), { recursive: true });
	fs.writeFileSync(DEST, payload);
	fs.writeFileSync(COPY, payload);

	console.log('wrote', DEST);
	console.log('copy', COPY);
	console.log('bytes', Buffer.byteLength(payload));
	console.log('arenas', store.tournaments.length, 'entries', store.entries.length, 'matches', store.matches.length);
	for (const t of store.tournaments) {
		const e = store.entries.filter((row) => row.tournamentId === t.id).length;
		const m = store.matches.filter((row) => row.tournamentId === t.id).length;
		console.log(`${t.status.padEnd(12)} e=${String(e).padStart(2)} m=${String(m).padStart(2)}  ${t.slug}  |  ${t.name}`);
	}
}

main();
