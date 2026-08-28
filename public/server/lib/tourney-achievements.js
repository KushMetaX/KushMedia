'use strict';

const FORMAT_LABEL = {
	single_elim: 'single elimination',
	double_elim: 'double elimination',
	round_robin: 'round robin',
	swiss: 'Swiss',
};

function count(rows, pred) {
	return rows.filter(pred).length;
}

const CATALOG = [
	{
		id: 'first_place',
		title: 'Champion',
		blurb: 'Won a 1st place finish in an official arena.',
		test: (rows) => count(rows, (r) => r.placement === 1) >= 1,
	},
	{
		id: 'second_place',
		title: 'Silver',
		blurb: 'Finished 2nd in an official arena.',
		test: (rows) => count(rows, (r) => r.placement === 2) >= 1,
	},
	{
		id: 'third_place',
		title: 'Bronze',
		blurb: 'Finished 3rd in an official arena.',
		test: (rows) => count(rows, (r) => r.placement === 3) >= 1,
	},
	{
		id: 'champ_3',
		title: 'Three-time champion',
		blurb: 'Won 1st place in three official arenas.',
		test: (rows) => count(rows, (r) => r.placement === 1) >= 3,
	},
	{
		id: 'champ_5',
		title: 'Five-time champion',
		blurb: 'Won 1st place in five official arenas.',
		test: (rows) => count(rows, (r) => r.placement === 1) >= 5,
	},
	{
		id: 'se_champ',
		title: 'Single-elim champion',
		blurb: 'Won a single-elimination arena.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.format === 'single_elim') >= 1,
	},
	{
		id: 'se_champ_3',
		title: 'Single-elim champion ×3',
		blurb: 'Won three single-elimination arenas.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.format === 'single_elim') >= 3,
	},
	{
		id: 'de_champ',
		title: 'Double-elim champion',
		blurb: 'Won a double-elimination arena.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.format === 'double_elim') >= 1,
	},
	{
		id: 'rr_champ',
		title: 'Round-robin champion',
		blurb: 'Won a round-robin arena.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.format === 'round_robin') >= 1,
	},
	{
		id: 'swiss_champ',
		title: 'Swiss champion',
		blurb: 'Won a Swiss arena.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.format === 'swiss') >= 1,
	},
	{
		id: 'field_8',
		title: 'Packed house',
		blurb: 'Won an official arena with 8 or more confirmed players.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.fieldSize >= 8) >= 1,
	},
	{
		id: 'field_16',
		title: 'Full roster',
		blurb: 'Won an official arena with 16 or more confirmed players.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.fieldSize >= 16) >= 1,
	},
	{
		id: 'played_5',
		title: 'Regular',
		blurb: 'Played in five official arenas.',
		test: (rows) => rows.length >= 5,
	},
	{
		id: 'played_10',
		title: 'Mainstay',
		blurb: 'Played in ten official arenas.',
		test: (rows) => rows.length >= 10,
	},
];

function unlockFor(results) {
	const official = (results || []).filter((r) => r.official);
	return CATALOG.filter((item) => item.test(official)).map((item) => ({
		id: item.id,
		title: item.title,
		blurb: item.blurb,
	}));
}

module.exports = {
	CATALOG,
	FORMAT_LABEL,
	unlockFor,
};
