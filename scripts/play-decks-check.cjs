'use strict';

const playDecks = require('../public/server/lib/play-decks');
const playList = require('../public/server/lib/play-list');

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

check('rejects short names', playDecks.sanitizePlayName('ab') === '');
check('accepts Hero names', playDecks.sanitizePlayName('Kush') === 'Kush');
check('trims Hero names', playDecks.sanitizePlayName('  DickTheDev ') === 'DickTheDev');
check('rejects symbols', playDecks.sanitizePlayName('Kush!') === '');

const fullCounts = {
	V001: 3, V002: 3, V003: 3, V004: 3, V005: 3, V008: 3, V009: 3,
	V010: 3, V011: 3, V012: 3, V013: 2, V014: 3, V015: 3, V076: 2,
};
const exported = playList.formatListText({ name: 'GardenGrave', counts: fullCounts });

check('export opens with their header', exported.startsWith('# DDL TCG\n# name: GardenGrave\n# count: 40/40\n\n'));
check('export uses their × count lines', exported.includes('\n3× Blade\n'));
check('export ends with a serial line', /\n# serials: V001,V001,V001,/.test(exported));
check('export ends in one newline', exported.endsWith('\n') && !exported.endsWith('\n\n'));

const parsed = playList.parseListText(exported);
check('parses their export back', parsed.ok && parsed.count === 40);
check('keeps the deck name', parsed.name === 'GardenGrave');
check('round-trips byte for byte', playList.formatListText({ name: parsed.name, serials: parsed.serials }) === exported);

const nameOnly = playList.parseListText('# DDL TCG\n3× Blade\n2× Snake Venom\n');
check('reads 3× Card Name lines', nameOnly.count === 5 && nameOnly.counts.V015 === 3);

const serialLines = playList.parseListText('V001\nV001\nV001\nV002');
check('reads bare serial lines', serialLines.count === 4 && serialLines.counts.V001 === 3);

const serialHeader = playList.parseListText('# serials: V001,V001,V001,V002');
check('reads a serial header', serialHeader.count === 4 && serialHeader.counts.V001 === 3);

const serialJson = playList.parseListText('["V001","V001","V002"]');
check('reads a JSON serial array', serialJson.count === 3 && serialJson.counts.V001 === 2);

const wayneByName = playList.parseListText('3× Wayne\n3× Blade');
check('Wayne is not resolvable by name', wayneByName.unknown.includes('Wayne') && wayneByName.count === 3);

const wayneBySerial = playList.parseListText('# serials: V029,V029,V015');
check('Wayne serials are dropped, not unknown', wayneBySerial.dropped.length === 2 && !wayneBySerial.unknown.length);

const snap = playDecks.lockFromText(exported, { playName: 'Kush', name: 'GardenGrave' });
check('lock snapshots the name', snap.name === 'GardenGrave');
check('lock snapshots the Play name', snap.playName === 'Kush');
check('lock snapshots 40 cards', snap.cardCount === 40 && snap.ready === true);
check('lock marks the source as a pasted list', snap.source === 'list');
check('sanitize keeps the snapshot', playDecks.sanitizeSnapshot(snap).name === 'GardenGrave');

try {
	playDecks.lockFromText('3× Blade\n2× Snake Venom');
	check('short lists are rejected', false);
} catch (err) {
	check('short lists are rejected', /5\/40/.test(err.message), err.message);
}

try {
	playDecks.lockFromText('these are not cards');
	check('gibberish is rejected', false);
} catch (err) {
	check('gibberish is rejected', /Could not read/.test(err.message), err.message);
}

const roundTrip = playDecks.sanitizeSnapshot({
	playName: 'Kush',
	name: 'GardenGrave',
	counts: { V001: 3, V002: 2 },
	serials: ['V001', 'V001', 'V001', 'V002', 'V002'],
	lockedAt: '2026-09-08T00:00:00.000Z',
});
check('sanitize recounts', roundTrip.cardCount === 5);

check('slot lookups are gone', typeof playDecks.lookupDecks === 'undefined' && typeof playDecks.lockDeck === 'undefined');

if (failures) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All play-deck checks passed');
