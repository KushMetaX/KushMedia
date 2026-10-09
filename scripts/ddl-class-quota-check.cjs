'use strict';

const quota = require('../public/server/lib/ddl-class-quota');

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

check('sanitize empty', quota.sanitizeQuota(null) === null);
check('sanitize Wizard 60', (() => {
	const rule = quota.sanitizeQuota({ class: 'wizard', percent: 60.4 });
	return rule && rule.class === 'Wizard' && rule.percent === 60;
})());
check('sanitize rejects All', quota.sanitizeQuota({ class: 'All', percent: 50 }) === null);
check('needed 60% of 40 is 24', quota.neededCount({ percent: 60 }, 40) === 24);
check('needed 51% of 40 is 21', quota.neededCount({ percent: 51 }, 40) === 21);

const poke = { V009: 3, V040: 3, V041: 3, V005: 3, V026: 3, V039: 3, V047: 3, V049: 3, V060: 3, V067: 3, V073: 3, V088: 3, V094: 3, V100: 1 };
const pokeCount = Object.values(poke).reduce((sum, n) => sum + n, 0);
check('poke package is 40', pokeCount === 40, `got ${pokeCount}`);

const fullWizard = quota.evaluateQuota(poke, { class: 'Wizard', percent: 100 });
check('pure Wizard passes 100%', fullWizard.ok && fullWizard.share.matching === 40);

const splash = { ...poke };
splash.V009 = 0;
splash.V004 = 3;
const splashEval = quota.evaluateQuota(splash, { class: 'Wizard', percent: 100 });
check('Neutral splash fails 100% Wizard', !splashEval.ok && splashEval.share.matching === 37);

const half = quota.evaluateQuota(splash, { class: 'Wizard', percent: 50 });
check('Neutral splash passes 50% Wizard', half.ok && half.share.matching === 37);

const miniSplash = { V009: 20, V008: 3, V025: 1, V004: 16 };
const miniEval = quota.evaluateQuota(miniSplash, { class: 'Wizard', percent: 60 });
check('Mini/Midi count as Wizard', miniEval.share.matching === 24 && miniEval.ok);

const miniNeutral = quota.evaluateQuota(miniSplash, { class: 'Neutral', percent: 50 });
check('Mini does not count as Neutral', miniNeutral.share.matching === 16 && !miniNeutral.ok);

const gaps = quota.fieldQuotaGaps(
	[
		{ handle: 'Ready', registeredDeck: { counts: poke, cardCount: 40 } },
		{ handle: 'Short', registeredDeck: { counts: { V004: 3 }, cardCount: 3 } },
		{ handle: 'None' },
	],
	{ class: 'Wizard', percent: 60 },
);
check('field gaps names the misses', gaps.length === 2 && /Short/.test(gaps[0]) && /None/.test(gaps[1]));

if (failures) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All class-quota checks passed');
