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

function isTournamentRow(row) {
	return Number(row && row.fieldSize) > 2;
}

function isDuelRow(row) {
	return Number(row && row.fieldSize) === 2;
}

const CATALOG = [
	{
		id: 'first_place',
		title: 'Champion',
		blurb: 'Won an official tournament (3 or more players).',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r)) >= 1,
	},
	{
		id: 'second_place',
		title: 'Silver',
		blurb: 'Finished 2nd in an official tournament.',
		test: (rows) => count(rows, (r) => r.placement === 2 && isTournamentRow(r)) >= 1,
	},
	{
		id: 'third_place',
		title: 'Bronze',
		blurb: 'Finished 3rd in an official tournament.',
		test: (rows) => count(rows, (r) => r.placement === 3 && isTournamentRow(r)) >= 1,
	},
	{
		id: 'fourth_place',
		title: 'Top Four',
		blurb: 'Finished 4th in an official tournament.',
		test: (rows) => count(rows, (r) => r.placement === 4 && isTournamentRow(r)) >= 1,
	},
	{
		id: 'fifth_place',
		title: 'Top Five',
		blurb: 'Finished 5th in an official tournament.',
		test: (rows) => count(rows, (r) => r.placement === 5 && isTournamentRow(r)) >= 1,
	},
	{
		id: 'champ_3',
		title: 'Three-time champion',
		blurb: 'Won three official tournaments.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r)) >= 3,
	},
	{
		id: 'champ_5',
		title: 'Five-time champion',
		blurb: 'Won five official tournaments.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r)) >= 5,
	},
	{
		id: 'se_champ',
		title: 'Single-elim champion',
		blurb: 'Won a single-elimination tournament.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r) && r.format === 'single_elim') >= 1,
	},
	{
		id: 'se_champ_3',
		title: 'Single-elim champion ×3',
		blurb: 'Won three single-elimination tournaments.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r) && r.format === 'single_elim') >= 3,
	},
	{
		id: 'de_champ',
		title: 'Double-elim champion',
		blurb: 'Won a double-elimination tournament.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r) && r.format === 'double_elim') >= 1,
	},
	{
		id: 'rr_champ',
		title: 'Round-robin champion',
		blurb: 'Won a round-robin tournament.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r) && r.format === 'round_robin') >= 1,
	},
	{
		id: 'swiss_champ',
		title: 'Swiss champion',
		blurb: 'Won a Swiss tournament.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isTournamentRow(r) && r.format === 'swiss') >= 1,
	},
	{
		id: 'duel_win',
		title: 'Duelist',
		blurb: 'Won an official 1v1 duel.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isDuelRow(r)) >= 1,
	},
	{
		id: 'duel_win_3',
		title: 'Duel streak',
		blurb: 'Won three official 1v1 duels.',
		test: (rows) => count(rows, (r) => r.placement === 1 && isDuelRow(r)) >= 3,
	},
	{
		id: 'field_8',
		title: 'Packed house',
		blurb: 'Won an official tournament with 8 or more confirmed players.',
		test: (rows) => count(rows, (r) => r.placement === 1 && r.fieldSize >= 8) >= 1,
	},
	{
		id: 'field_16',
		title: 'Full roster',
		blurb: 'Won an official tournament with 16 or more confirmed players.',
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
