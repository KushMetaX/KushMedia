'use strict';

const { classifyTitle } = require('../public/server/lib/ddl-market-match');
const { priceCatalog, gradeMultiplier } = require('../public/server/lib/ddl-market-value');
const checklist = require('../dd-evaluator/ddl-checklist.js');

let failures = 0;
function check(label, condition, detail) {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${JSON.stringify(detail)}` : ''}`);
}

function is(title, expect) {
	const got = classifyTitle(title);
	const ok = Object.entries(expect).every(([k, v]) => got[k] === v);
	check(`"${title}"`, ok, got);
}

check('checklist has 111 names', checklist.cards.length === 111);
check('checklist master is 203 prints', checklist.master === 203);
check('19 chase names', checklist.cards.filter((c) => c.chase).length === 19);
check('chase order is complete', checklist.cards.filter((c) => c.chase).every((c) => c.chaseNo >= 1));
check('V070 is Barron', checklist.cards[69].id === 'V070' && checklist.cards[69].name === 'Barron');

is('Doginal Dogs Legends TCG Toot Ultra Rare Full Art 1st Edition', { kind: 'single', cardId: 'V059', print: 'fa', grade: 'raw' });
is('Doginal Dogs Legends Web Holo Rise of the Pack', { kind: 'single', cardId: 'V014', print: 'holo', grade: 'raw' });
is('Doginal Dogs Legends Web Rare Card NM', { kind: 'single', cardId: 'V014', print: 'base' });
is('PSA 10 Doginal Dogs Legends Gigatron Giga Rare', { kind: 'single', cardId: 'V071', print: 'fa', grade: 'PSA 10' });
is('AGS 10 Doginal Dogs Legends Gigatron Giga Rare', { kind: 'single', cardId: 'V071', print: 'fa', grade: 'AGS 10' });
is('Doginal Dogs Legends Mama Bark Full Art', { kind: 'single', cardId: 'V062', print: 'fa' });
is('Doginal Dogs Legends Bark GIGA Full Art BGS 9.5', { kind: 'single', cardId: 'V069', grade: 'BGS 9.5' });
is('DDL TCG Darron Chase Full Art', { kind: 'single', cardId: 'V070', print: 'fa' });
is('Doginal Dogs Legends Spring Trap holo', { kind: 'single', cardId: 'V110', print: 'holo' });
is('Doginal Dogs Legends Divine Shield', { kind: 'single', cardId: 'V105' });
is('Doginal Dogs Legends #064/111 Aria', { kind: 'single', cardId: 'V064' });
is('Doginal Dogs Legends 3x Skip playset', { kind: 'single', cardId: 'V039', qty: 3 });
is('Doginal Dogs Legends Skip bulk lot', { kind: 'lot' });
is('Doginal Dogs Legends Rise of the Pack Booster Box Sealed 1st Edition', { kind: 'box', qty: 1 });
is('Doginal Dogs Legends Rise of the Pack 5 Booster Packs', { kind: 'pack', qty: 5 });
is('Doginal Dogs Legends Toot + Aria + Helios lot', { kind: 'lot' });
is('Doginal Dogs Legends Helios signed by Bark', { kind: 'special', cardId: 'V022' });
is('Doginal Dogs Legends card sleeves 100ct', { kind: 'other' });
is('Doginal Dogs Gift Card', { kind: 'other' });
is('Doginal Dogs Legends: Rise of the Pack Booster Pack', { kind: 'pack', qty: 1 });
is('Doginal Dogs Legends: Rise of the Pack Booster Box', { kind: 'box', qty: 1 });
is('Pokemon Charizard Base Set Holo', { kind: 'off-set' });
is('Doginal Dogs Legends 2x Toot Full Art', { kind: 'single', cardId: 'V059', qty: 2 });

check('PSA 10 multiplier is 3x', gradeMultiplier('PSA 10') === 3);
check('AGS 10 multiplier is 3x', gradeMultiplier('AGS 10') === 3);
check('every card has a type', checklist.cards.every((c) => ['Creature', 'Spell', 'Trap'].includes(c.type)));
check('71 creatures', checklist.cards.filter((c) => c.type === 'Creature').length === 71);
check('CGC 10 is below PSA 10', gradeMultiplier('CGC 10') < gradeMultiplier('PSA 10'));

const now = new Date().toISOString();
const priced = priceCatalog({
	sold: [
		{ cardId: 'V059', print: 'fa', grade: 'raw', unitUsd: 80, at: now },
		{ cardId: 'V059', print: 'fa', grade: 'raw', unitUsd: 100, at: now },
		{ cardId: 'V059', print: 'fa', grade: 'raw', unitUsd: 90, at: now },
		{ cardId: 'V059', print: 'fa', grade: 'PSA 10', unitUsd: 400, at: now },
	],
	asks: [{ cardId: 'V014', print: 'holo', grade: 'raw', unitUsd: 10 }],
	sealed: { box: { sold: [{ unitUsd: 400, at: now }], asks: [] } },
	artDogs: { V014: [{ dogNumber: 1234, handle: 'web3smb' }] },
});
const toot = priced.cards.find((c) => c.id === 'V059');
const web = priced.cards.find((c) => c.id === 'V014');
const chico = priced.cards.find((c) => c.id === 'V001');
check('sold comps drive price (median 90)', toot.prints.fa.usd === 90 && toot.prints.fa.source === 'sold', toot.prints.fa);
check('graded comp is kept separately', toot.graded.fa && toot.graded.fa['PSA 10'].usd === 400, toot.graded);
check('asks are discounted to 85%', web.prints.holo.usd === 8.5 && web.prints.holo.source === 'asks', web.prints.holo);
check('no comps falls back to model', chico.prints.base.source === 'model' && chico.prints.base.usd > 0, chico.prints.base);
check('market box price feeds the model', priced.box.usd === 400 && priced.box.source === 'sold');

const shopPriced = priceCatalog({
	sold: [],
	asks: [{ cardId: 'V014', print: 'base', grade: 'raw', unitUsd: 4 }],
	shop: [{ cardId: 'V014', print: 'holo', grade: 'raw', unitUsd: 12, available: true, url: 'https://shop.doginaldogs.com/products/web' }],
	sealed: {
		box: { sold: [], asks: [{ unitUsd: 250 }], shop: [{ unitUsd: 179, available: true, url: 'https://shop.doginaldogs.com/products/box', title: 'Booster Box' }] },
		pack: { sold: [], asks: [], shop: [{ unitUsd: 9.99, available: true, url: 'https://shop.doginaldogs.com/products/pack', title: 'Booster Pack' }] },
	},
});
const shopWeb = shopPriced.cards.find((c) => c.id === 'V014');
check('shop box price is the listing price', shopPriced.box.usd === 179 && shopPriced.box.source === 'shop', shopPriced.box);
check('shop pack price is not box divided by 24', shopPriced.pack.usd === 9.99 && shopPriced.pack.source === 'shop', shopPriced.pack);
check('shop single is not discounted', shopWeb.prints.holo.usd === 12 && shopWeb.prints.holo.source === 'shop', shopWeb.prints.holo);
check('eBay ask still used when the shop has no match', shopWeb.prints.base.usd === 3.4 && shopWeb.prints.base.source === 'asks', shopWeb.prints.base);
check('art dog attaches to its card', web.artDogs.length === 1 && web.artDogs[0].dogNumber === 1234);
check('every print is priced', priced.cards.every((c) => c.prints && Object.values(c.prints).every((p) => p.usd > 0)));

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll DDL market checks passed');
