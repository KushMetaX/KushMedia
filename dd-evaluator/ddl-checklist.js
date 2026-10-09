/**
 * DDL TCG · Rise of the Pack 1st Edition checklist (111 names, 203 master prints).
 * C/R names print as base + holo. UR / GIGA chase names print as full art only.
 * Shared by the browser (window.DDL_CHECKLIST) and the Node market route (require).
 */
(function (root) {
	const ROWS = [
		[1, 'Chico', 'CR', 'Crown'], [2, 'Daisy', 'CR', 'Bow'], [3, 'Dash', 'CR', 'Bow'],
		[4, 'Gary', 'CR', 'Neutral'], [5, 'Ginger', 'CR', 'Wizard'], [6, 'Icy', 'CR', 'Neutral'],
		[7, 'Jones', 'CR', 'Neutral'], [8, 'Mini', 'CR', 'All'], [9, 'Poke', 'CR', 'Wizard'],
		[10, 'Prince', 'CR', 'Crown'], [11, 'Pumpy', 'CR', 'Zombie'], [12, 'Stump', 'CR', 'Pirate'],
		[13, 'Thumpy', 'CR', 'Zombie'], [14, 'Web', 'CR', 'Pirate'], [15, 'Blade', 'CR', 'Pirate'],
		[16, 'Bone', 'CR', 'Neutral'], [17, 'Chart', 'CR', 'Pirate'], [18, 'Digger', 'CR', 'Zombie'],
		[19, 'Doom', 'CR', 'Neutral'], [20, 'Dumpy', 'CR', 'Zombie'], [21, 'Flame', 'CR', 'Neutral'],
		[22, 'Helios', 'UR', 'Crown'], [23, 'Hunter', 'GIGA', 'Neutral'], [24, 'Loopy', 'CR', 'Bow'],
		[25, 'Midi', 'CR', 'All'], [26, 'Scroll', 'CR', 'Wizard'], [27, 'Stone', 'CR', 'Crown'],
		[28, 'Sunny', 'CR', 'Bow'], [29, 'Wayne', 'CR', 'Neutral'], [30, 'Champ', 'CR', 'Crown'],
		[31, 'Dusty', 'CR', 'Pirate'], [32, 'Fitch', 'CR', 'Zombie'], [33, 'Goji', 'CR', 'Crown'],
		[34, 'Mary', 'CR', 'Bow'], [35, 'Mega', 'CR', 'All'], [36, 'Plague', 'CR', 'Neutral'],
		[37, 'Scout', 'CR', 'Pirate'], [38, 'Shepherd', 'CR', 'Zombie'], [39, 'Skip', 'CR', 'Wizard'],
		[40, 'Spark', 'CR', 'Wizard'], [41, 'Surge', 'CR', 'Wizard'], [42, 'Sweetie', 'CR', 'Bow'],
		[43, 'Yang', 'CR', 'Neutral'], [44, 'Boogie', 'UR', 'Zombie'], [45, 'Buster', 'CR', 'Pirate'],
		[46, 'Cherry', 'CR', 'Bow'], [47, 'Houdini', 'CR', 'Wizard'], [48, 'Mama Light', 'CR', 'Bow'],
		[49, 'Mento', 'UR', 'Wizard'], [50, 'Pulse', 'CR', 'Crown'], [51, 'Reaper', 'CR', 'Zombie'],
		[52, 'Renza', 'GIGA', 'Neutral'], [53, 'Seeker', 'CR', 'Crown'], [54, 'Shiboshi', 'UR', 'Pirate'],
		[55, 'Turbo', 'GIGA', 'Neutral'], [56, 'Bender', 'UR', 'Zombie'], [57, 'Gummy', 'CR', 'Neutral'],
		[58, 'Shield', 'UR', 'Crown'], [59, 'Toot', 'UR', 'Zombie'], [60, 'Volt', 'UR', 'Wizard'],
		[61, 'Cookie', 'CR', 'Neutral'], [62, 'Mama Bark', 'UR', 'Bow'], [63, 'Penny', 'UR', 'Pirate'],
		[64, 'Aria', 'UR', 'Bow'], [65, 'Atlas', 'UR', 'Crown'], [66, 'Manic', 'CR', 'Neutral'],
		[67, 'Wiggles', 'UR', 'Wizard'], [68, 'Bamba', 'CR', 'Neutral'], [69, 'Bark', 'GIGA', 'Neutral'],
		[70, 'Barron', 'UR', 'Pirate', 'Darron on the official chase sheet'],
		[71, 'Gigatron', 'GIGA', 'Neutral'], [72, 'Boost', 'CR', 'Neutral'], [73, 'Frostbolt', 'CR', 'Wizard'],
		[74, 'Quickdraw', 'CR', 'Neutral'], [75, 'Sacrifice', 'CR', 'Zombie'], [76, 'Snake Venom', 'CR', 'Pirate'],
		[77, 'Typhoon', 'CR', 'Neutral'], [78, 'Connection', 'CR', 'Bow'], [79, 'Cull', 'CR', 'Neutral'],
		[80, 'Feast', 'CR', 'Crown'], [81, 'Fireball', 'CR', 'Neutral'], [82, 'Haunted House', 'CR', 'Zombie'],
		[83, 'Love Bomb', 'CR', 'Bow'], [84, 'Love Shot', 'CR', 'Bow'], [85, 'Pact', 'CR', 'Zombie'],
		[86, 'Vanish', 'CR', 'Neutral'], [87, 'Airdrop', 'CR', 'Neutral'], [88, 'Cauldron', 'CR', 'Wizard'],
		[89, 'Chum The Water', 'CR', 'Pirate'], [90, 'Garden', 'CR', 'Bow'], [91, 'Judgement', 'CR', 'Crown'],
		[92, 'Meditation', 'CR', 'Crown'], [93, 'Reborn', 'CR', 'Zombie'], [94, 'Scheme', 'CR', 'Wizard'],
		[95, 'Spearfish', 'CR', 'Pirate'], [96, 'Takedown', 'CR', 'Neutral'], [97, 'Swipe', 'CR', 'Neutral'],
		[98, 'Avenge', 'CR', 'Crown'], [99, 'Booty Raid', 'CR', 'Pirate'], [100, 'Siphon', 'CR', 'Wizard'],
		[101, 'Black Hole', 'CR', 'Neutral'], [102, 'Ambush', 'CR', 'Neutral'], [103, 'Blast', 'CR', 'Neutral'],
		[104, 'Counterspell', 'CR', 'Neutral'], [105, 'Divine Shield', 'CR', 'Neutral'], [106, 'Frost Lock', 'CR', 'Neutral'],
		[107, 'Landmine', 'CR', 'Neutral'], [108, 'Pitfall', 'CR', 'Neutral'], [109, 'Intel', 'CR', 'Neutral'],
		[110, 'Spring Trap', 'CR', 'Neutral'], [111, 'Tidal Wave', 'CR', 'Neutral'],
	];

	/** Order on the official Aug 31 2026 chase sheet. */
	const CHASE_ORDER = [
		'Helios', 'Hunter', 'Boogie', 'Mento', 'Renza', 'Shiboshi', 'Turbo', 'Bender', 'Shield', 'Toot',
		'Volt', 'Mama Bark', 'Penny', 'Aria', 'Atlas', 'Wiggles', 'Bark', 'Barron', 'Gigatron',
	];

	const TIER_LABEL = { CR: 'Common/Rare', UR: 'Ultra Rare', GIGA: 'Giga Rare' };
	/** Card type by set number: C creature, S spell, T trap. */
	const TYPE_CODE = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSTTTTTTTSTT';
	const TYPE_NAME = { C: 'Creature', S: 'Spell', T: 'Trap' };

	const cards = ROWS.map(([no, name, tier, cls, note]) => {
		const id = 'V' + String(no).padStart(3, '0');
		const chase = tier !== 'CR';
		return {
			id,
			no,
			name,
			tier,
			tierLabel: TIER_LABEL[tier],
			type: TYPE_NAME[TYPE_CODE[no - 1]] || 'Creature',
			class: cls,
			chase,
			chaseNo: chase ? CHASE_ORDER.indexOf(name) + 1 : null,
			prints: chase ? ['fa'] : ['base', 'holo'],
			aliases: name === 'Barron' ? ['Darron'] : [],
			note: note || '',
			render: 'https://ddltcg.com/card_renders/' + id + '.png',
		};
	});

	const pack = {
		set: 'Rise of the Pack',
		edition: '1st Edition',
		names: cards.length,
		master: cards.reduce((n, c) => n + c.prints.length, 0),
		printLabels: { base: 'Base', holo: 'Holo', fa: 'Full Art' },
		cards,
	};

	if (typeof module === 'object' && module.exports) module.exports = pack;
	else root.DDL_CHECKLIST = pack;
})(typeof window !== 'undefined' ? window : globalThis);
