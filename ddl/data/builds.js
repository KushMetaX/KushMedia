window.DDL_BUILDS = [
  {
    "id": "pirate",
    "name": "Pirate Haunt",
    "hero": "Pirate",
    "heroes": [
      "Pirate"
    ],
    "splash": [],
    "kind": "mono",
    "arch": "Aggro",
    "tags": [
      "haunt",
      "poison",
      "tempo",
      "traps"
    ],
    "preset": "Pirate Haunt",
    "tagline": "Race with Haunt — but keep Ambush and Blast so you are not a glass cannon.",
    "why": "Haunt creatures turn kill-gated trades into cards and face. Snake Venom ignores ATK ≥ HP so walls do not stall you. Chum refills when they kill Pirates. Four traps (Ambush/Blast) so their crackback and their Boogie do not just win.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Pirate.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Pirate Haunt”."
    ],
    "cards": [
      [
        "V004",
        2,
        "Gary",
        "Draw a card."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V076",
        3,
        "Snake Venom",
        "Give a friendly Pirate Creature Poison until the end of the turn."
      ],
      [
        "V012",
        3,
        "Stump",
        "Has +2 ATK if you control another Creature."
      ],
      [
        "V077",
        2,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ],
      [
        "V014",
        3,
        "Web",
        "Draw a card."
      ],
      [
        "V015",
        3,
        "Blade",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V017",
        3,
        "Chart",
        "Add a Pirate Spell from your deck to your hand."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V089",
        3,
        "Chum The Water",
        "Whenever a friendly Pirate Creature is destroyed, draw a card."
      ],
      [
        "V031",
        3,
        "Dusty",
        "Adjacent Creatures have Taunt."
      ],
      [
        "V037",
        2,
        "Scout",
        "Adjacent Creatures have Rush."
      ],
      [
        "V045",
        2,
        "Buster",
        "Whenever another friendly Creature is destroyed, deal 2 damage to the enemy Hero."
      ],
      [
        "V054",
        1,
        "Shiboshi",
        "Destroy all Creatures that destroyed this Creature in combat."
      ],
      [
        "V099",
        2,
        "Booty Raid",
        "Summon up to 2 Pirate Creatures that cost 3 or less from your deck."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        2,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ]
    ],
    "logic": {
      "heroes": [
        "Pirate"
      ],
      "tags": [
        "haunt",
        "poison",
        "tempo"
      ],
      "targets": [
        22,
        14,
        4
      ],
      "cores": [
        "Pirate"
      ]
    },
    "trapPlan": "4 traps — Ambush punishes swings into Haunt bodies; Blast turns their face burst around. Still a race list, not a wall.",
    "advantage": "Venom ignores the kill-gate, Chum refills when Pirates die, and Haunt trades pay you in cards and face. You are the beatdown.",
    "disadvantage": "Fragile bodies and no late engine. Frost Lock fakes your lethal, Ambush eats the only attacker, Icy blanks Blade/Buster. Past turn 8 you lose.",
    "vsNotes": [
      "vs Haunt: Blast the Boogie/Toot turn. Do not swing the last body into unknown slots.",
      "vs Crown: Typhoon Meditation, Venom the Taunt, ignore Atlas until walls are gone.",
      "vs Bow: Faster than Garden. Kill Mini so Love Shot is 2. Ambush their Mary swing.",
      "vs Wizard: Typhoon Scheme. Chip through Frost Lock — do not dump the whole burst."
    ]
  },
  {
    "id": "zombie",
    "name": "Zombie Haunt",
    "hero": "Zombie",
    "heroes": [
      "Zombie"
    ],
    "splash": [],
    "kind": "mono",
    "arch": "Aggro",
    "tags": [
      "haunt",
      "grave",
      "tempo",
      "traps"
    ],
    "preset": "Zombie Haunt",
    "tagline": "Detonate Haunt on your clock, sit behind Frost Lock until Boogie is live.",
    "why": "You choose when Haunt fires: Sacrifice and Pact detonate bodies, Boogie retriggers the row. Reaper and Haunted House keep paying after combat stalls. Five traps because this list is slower than Pirate — Frost Lock buys the detonate turn.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Zombie.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Zombie Haunt”."
    ],
    "cards": [
      [
        "V018",
        2,
        "Digger",
        "Send a Creature from your deck to your graveyard."
      ],
      [
        "V004",
        3,
        "Gary",
        "Draw a card."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V075",
        3,
        "Sacrifice",
        "Destroy a friendly Creature and draw 2 cards. If it's a Zombie Creature, draw 3 instead."
      ],
      [
        "V013",
        3,
        "Thumpy",
        "Draw a card."
      ],
      [
        "V077",
        2,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V020",
        3,
        "Dumpy",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V085",
        2,
        "Pact",
        "Destroy a friendly Zombie Creature and an enemy Creature."
      ],
      [
        "V011",
        3,
        "Pumpy",
        "Restore 3 HP to your Hero."
      ],
      [
        "V082",
        2,
        "Haunted House",
        "At the end of your turn, trigger the Haunt effects of the Zombie Creatures you control."
      ],
      [
        "V038",
        2,
        "Shepherd",
        "Summon a Creature that costs 2 or less from your graveyard."
      ],
      [
        "V044",
        2,
        "Boogie",
        "Trigger the Haunt effects of all your other Creatures."
      ],
      [
        "V051",
        2,
        "Reaper",
        "At the end of your turn, trigger the Haunt effects of the adjacent Creatures."
      ],
      [
        "V059",
        2,
        "Toot",
        "Deal 5 damage to the enemy Hero."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ]
    ],
    "logic": {
      "heroes": [
        "Zombie"
      ],
      "tags": [
        "haunt",
        "grave",
        "tempo"
      ],
      "targets": [
        22,
        13,
        5
      ],
      "cores": [
        "Zombie"
      ]
    },
    "trapPlan": "5 traps — slower than Pirate, so Frost Lock buys the detonate turn. Ambush plus Blast cover the race you sometimes lose.",
    "advantage": "You choose when Haunt fires (Sacrifice, Pact, Boogie). Grave recursion and House/Reaper keep paying after combat stalls.",
    "disadvantage": "Needs bodies in play or GY first. Gummy shuts recursion. Divine Shield blanks Pact. Board wipes after you invest are brutal.",
    "vsNotes": [
      "vs Haunt: Frost Lock their Boogie. Pact their Dusty. You win the long Haunt, not the first swing.",
      "vs Crown: Detonate before Atlas arms. Sac Toot at their face, do not wait for turn 10.",
      "vs Bow: Ambush Mary/Aria. House + Dumpy outgrinds Garden if you live.",
      "vs Wizard: Hold Blast for Wiggles ticks. Do not Sac into Counterspell."
    ]
  },
  {
    "id": "crown",
    "name": "Crown Engine",
    "hero": "Crown",
    "heroes": [
      "Crown"
    ],
    "splash": [],
    "kind": "mono",
    "arch": "Control",
    "tags": [
      "sot",
      "taunt",
      "traps"
    ],
    "preset": "Crown Engine",
    "tagline": "Stack start-of-turn damage, answer their plan, then Atlas.",
    "why": "Start-of-turn payloads stack. Goji (adjacent) and Meditation (global) multiply Helios, Prince, Pulse, and Atlas. Icy plus Frost Lock/Blast stop the aggro clock. Counterspell blanks Garden/Sacrifice. Typhoon answers their engine slot.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Crown.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Crown Engine”."
    ],
    "cards": [
      [
        "V072",
        2,
        "Boost",
        "Restore 8 HP to your Hero."
      ],
      [
        "V001",
        2,
        "Chico",
        "Taunt"
      ],
      [
        "V006",
        2,
        "Icy",
        "Your Hero is immune."
      ],
      [
        "V010",
        3,
        "Prince",
        "At the start of your turn, draw a card."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        2,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ],
      [
        "V079",
        2,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V080",
        1,
        "Feast",
        "At the start of your turn, restore 2 HP to your Hero. If you control a Crown Creature, res"
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V022",
        3,
        "Helios",
        "At the start of your turn, deal 3 damage to the enemy Hero."
      ],
      [
        "V033",
        2,
        "Goji",
        "Adjacent Creatures start of turn effects trigger an additional time."
      ],
      [
        "V092",
        3,
        "Meditation",
        "Your Crown Creatures start of turn effects trigger an additional time."
      ],
      [
        "V096",
        2,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V050",
        2,
        "Pulse",
        "At the start of your turn, restore 5 HP to your Hero."
      ],
      [
        "V058",
        2,
        "Shield",
        "Add up to 2 Creatures from your graveyard to your hand."
      ],
      [
        "V065",
        2,
        "Atlas",
        "At the start of your turn, deal 7 damage to the enemy Hero."
      ],
      [
        "V101",
        1,
        "Black Hole",
        "Destroy all Creatures."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V077",
        2,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ]
    ],
    "logic": {
      "heroes": [
        "Crown"
      ],
      "tags": [
        "sot",
        "taunt",
        "traps"
      ],
      "targets": [
        18,
        15,
        7
      ],
      "cores": [
        "Crown"
      ]
    },
    "trapPlan": "7 traps — Ambush/Frost Lock/Blast are the aggro wall. Counterspell stops Garden and Sacrifice. Typhoon answers enemy engines.",
    "advantage": "Start-of-turn math (Goji + Meditation + Atlas/Pulse) wins any game that goes long. Icy and Taunt blank early face.",
    "disadvantage": "Slow to arm. Typhoon kills Meditation. Goji needs adjacency. Slot-hungry. Pure Haunt can kill you before Atlas ticks.",
    "vsNotes": [
      "vs Haunt: Icy + Frost Lock first, then Blast. Do not Meditation on 3 if you die on 4.",
      "vs Crown: Typhoon their Meditation. Kill Goji. First Atlas with both multipliers wins.",
      "vs Bow: Counterspell Aria under Garden. Taunt so they cannot race.",
      "vs Wizard: Typhoon Scheme. Ambush stops them attacking; you still die to EOT burn — race Atlas vs Wiggles."
    ]
  },
  {
    "id": "bow",
    "name": "Bow Garden",
    "hero": "Bow",
    "heroes": [
      "Bow"
    ],
    "splash": [],
    "kind": "mono",
    "arch": "Midrange",
    "tags": [
      "garden",
      "play",
      "poison",
      "traps"
    ],
    "preset": "Bow Garden",
    "tagline": "Garden burst with a real trap wall so you live to play Aria.",
    "why": "Garden doubles Bow Play effects. Mini counts as Bow so Love Shot is always live. Sweetie/Cherry flood 2-drops; Aria becomes 14 under Garden. Six traps cover the greedy Garden turn — this list used to skip them and die to the first Boogie.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Bow.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Bow Garden”."
    ],
    "cards": [
      [
        "V003",
        1,
        "Dash",
        ""
      ],
      [
        "V004",
        1,
        "Gary",
        "Draw a card."
      ],
      [
        "V008",
        3,
        "Mini",
        "This Creature counts as all Classes."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V024",
        2,
        "Loopy",
        "Poison"
      ],
      [
        "V084",
        3,
        "Love Shot",
        "Deal 2 damage to a target. If you control a Bow Creature, deal 4 instead."
      ],
      [
        "V028",
        2,
        "Sunny",
        "When an adjacent Creature is destroyed, draw a card."
      ],
      [
        "V090",
        3,
        "Garden",
        "Your Bow Creatures Play effects trigger an additional time."
      ],
      [
        "V034",
        3,
        "Mary",
        "Deal 3 damage to a target."
      ],
      [
        "V042",
        3,
        "Sweetie",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V046",
        3,
        "Cherry",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V048",
        3,
        "Mama Light",
        "Draw a card. If you control another Creature, draw 2 instead."
      ],
      [
        "V064",
        3,
        "Aria",
        "Deal 7 damage to a target."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ]
    ],
    "logic": {
      "heroes": [
        "Bow"
      ],
      "tags": [
        "garden",
        "play",
        "poison"
      ],
      "targets": [
        24,
        10,
        6
      ],
      "cores": [
        "Bow"
      ]
    },
    "trapPlan": "6 traps — Garden turn is greedy. Ambush/Frost Lock cover setup, Blast reflects Haunt, Counterspell stops their burst spell.",
    "advantage": "Garden doubles Play (Mary 6, Aria 14, Cherry twice). Mini keeps Love Shot/Bomb live. Best fair burst in the set.",
    "disadvantage": "Garden is a slot they Typhoon. No native Haunt or EOT clock. Ambush eats the Mary swing. Aggro kills you before Garden lands.",
    "vsNotes": [
      "vs Haunt: Frost Lock the Boogie. Ambush the first swing. Garden only when stable.",
      "vs Crown: Typhoon Meditation. Aria under Garden is the race vs Atlas.",
      "vs Bow: Counterspell their Aria. Mini on 1 means Love Shot is 4 — kill it.",
      "vs Wizard: Do not dump Aria into unknown slots. Typhoon Scheme, chip Frost Lock."
    ]
  },
  {
    "id": "wizard",
    "name": "Wizard Trap Lab",
    "hero": "Wizard",
    "heroes": [
      "Wizard"
    ],
    "splash": [],
    "kind": "mono",
    "arch": "Combo",
    "tags": [
      "scheme",
      "eot",
      "traps"
    ],
    "preset": "Wizard Trap Lab",
    "tagline": "Trap wall plus Scheme burn. Do not race — answer, then tick.",
    "why": "Scheme doubles Wizard end-of-turn burn. Surge doubles adjacent EOT on top of that. Twelve trap slots are the life total — sit behind Ambush/Frost Lock/Blast until Wiggles is 10 a turn. Typhoon so the mirror cannot sit on Scheme forever.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Wizard.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Wizard Trap Lab”."
    ],
    "cards": [
      [
        "V073",
        2,
        "Frostbolt",
        "Deal 1 damage to a target. If you control a Wizard Creature, deal 3 instead."
      ],
      [
        "V005",
        2,
        "Ginger",
        "At the end of your turn, draw a card."
      ],
      [
        "V009",
        3,
        "Poke",
        "At the end of your turn, deal 1 damage to the enemy Hero."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V102",
        3,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        3,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V104",
        3,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V081",
        2,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V026",
        1,
        "Scroll",
        "Add a Wizard Spell from your deck to your hand."
      ],
      [
        "V110",
        1,
        "Spring Trap",
        "When the enemy summons a Creature, negate the summon and return that Creature to their han"
      ],
      [
        "V087",
        2,
        "Airdrop",
        "Draw 2 cards."
      ],
      [
        "V088",
        2,
        "Cauldron",
        "Draw a card. If you control a Wizard Creature, draw 3 instead."
      ],
      [
        "V094",
        3,
        "Scheme",
        "Your Wizard Creatures end of turn effects trigger an additional time."
      ],
      [
        "V040",
        3,
        "Spark",
        "At the end of your turn, deal 2 damage to the enemy Hero."
      ],
      [
        "V041",
        2,
        "Surge",
        "Your adjacent Creatures end of turn effects trigger an additional time."
      ],
      [
        "V060",
        1,
        "Volt",
        "Add up to 2 Traps from your deck to your hand."
      ],
      [
        "V101",
        1,
        "Black Hole",
        "Destroy all Creatures."
      ],
      [
        "V067",
        1,
        "Wiggles",
        "At the end of your turn, deal 5 damage to the enemy Hero."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ]
    ],
    "logic": {
      "heroes": [
        "Wizard"
      ],
      "tags": [
        "scheme",
        "eot",
        "traps"
      ],
      "targets": [
        13,
        15,
        12
      ],
      "cores": [
        "Wizard"
      ]
    },
    "trapPlan": "Trap Lab on purpose — 12 traps plus Volt to fetch them. Sit behind the wall until Scheme makes Wiggles 10 a turn.",
    "advantage": "Does not need combat to win. Scheme/Surge multiply EOT burn. Best trap suite and Volt tutor. Counterspell blanks their engine spells.",
    "disadvantage": "Thin board. Typhoon on Scheme turns off the clock. Slow setup. Surge needs adjacency. Empty slots vs a race you misread.",
    "vsNotes": [
      "vs Haunt: Frost Lock + Blast on the Boogie turn. Ambush the first attacker. Do not greed Scheme first.",
      "vs Crown: Counterspell Meditation if you must; better to race Wiggles vs Atlas with Surge stacked.",
      "vs Bow: Counterspell Garden or Aria. Pitfall/Spring Trap their Cherry flood.",
      "vs Wizard: Typhoon their Scheme. Hold Counterspell for Cauldron/Siphon."
    ]
  },
  {
    "id": "pirate-zombie",
    "name": "Haunt Mix",
    "hero": "Pirate",
    "heroes": [
      "Pirate",
      "Zombie"
    ],
    "splash": [
      "Zombie"
    ],
    "kind": "mix",
    "arch": "Aggro",
    "tags": [
      "haunt",
      "poison",
      "grave",
      "tempo",
      "traps"
    ],
    "preset": "Haunt Mix",
    "tagline": "Two Haunt cashouts, plus Ambush/Blast so their turn does not just win.",
    "why": "Official Aggro Pack pairing. Pirate supplies Poison and death-draw. Zombie supplies detonate and reanimate. Same Haunt keyword, two ways to cash it. Four traps (Ambush/Blast) because live players hold Frost Lock and swing back — race decks that skip answers lose the crackback.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Pirate. This mix also uses Zombie cards (same as official dual-class shells). If the builder rejects off-class cards, pick Pirate and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Haunt Mix”."
    ],
    "cards": [
      [
        "V018",
        1,
        "Digger",
        "Send a Creature from your deck to your graveyard."
      ],
      [
        "V004",
        2,
        "Gary",
        "Draw a card."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V075",
        2,
        "Sacrifice",
        "Destroy a friendly Creature and draw 2 cards. If it's a Zombie Creature, draw 3 instead."
      ],
      [
        "V076",
        2,
        "Snake Venom",
        "Give a friendly Pirate Creature Poison until the end of the turn."
      ],
      [
        "V012",
        2,
        "Stump",
        "Has +2 ATK if you control another Creature."
      ],
      [
        "V013",
        2,
        "Thumpy",
        "Draw a card."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ],
      [
        "V014",
        2,
        "Web",
        "Draw a card."
      ],
      [
        "V015",
        2,
        "Blade",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V017",
        1,
        "Chart",
        "Add a Pirate Spell from your deck to your hand."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V020",
        2,
        "Dumpy",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V085",
        1,
        "Pact",
        "Destroy a friendly Zombie Creature and an enemy Creature."
      ],
      [
        "V011",
        1,
        "Pumpy",
        "Restore 3 HP to your Hero."
      ],
      [
        "V089",
        2,
        "Chum The Water",
        "Whenever a friendly Pirate Creature is destroyed, draw a card."
      ],
      [
        "V031",
        1,
        "Dusty",
        "Adjacent Creatures have Taunt."
      ],
      [
        "V082",
        1,
        "Haunted House",
        "At the end of your turn, trigger the Haunt effects of the Zombie Creatures you control."
      ],
      [
        "V037",
        1,
        "Scout",
        "Adjacent Creatures have Rush."
      ],
      [
        "V038",
        1,
        "Shepherd",
        "Summon a Creature that costs 2 or less from your graveyard."
      ],
      [
        "V044",
        1,
        "Boogie",
        "Trigger the Haunt effects of all your other Creatures."
      ],
      [
        "V045",
        1,
        "Buster",
        "Whenever another friendly Creature is destroyed, deal 2 damage to the enemy Hero."
      ],
      [
        "V051",
        1,
        "Reaper",
        "At the end of your turn, trigger the Haunt effects of the adjacent Creatures."
      ],
      [
        "V099",
        1,
        "Booty Raid",
        "Summon up to 2 Pirate Creatures that cost 3 or less from your deck."
      ],
      [
        "V059",
        1,
        "Toot",
        "Deal 5 damage to the enemy Hero."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        2,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ]
    ],
    "logic": {
      "heroes": [
        "Pirate",
        "Zombie"
      ],
      "tags": [
        "haunt",
        "poison",
        "grave",
        "tempo"
      ],
      "targets": [
        22,
        14,
        4
      ],
      "cores": [
        "Pirate",
        "Zombie"
      ]
    },
    "trapPlan": "4 traps — still the official Aggro Pack pairing. Ambush + Blast only; you are the beatdown.",
    "advantage": "Two Haunt cashouts: Pirate (Venom, Chum, combat) and Zombie (Boogie, Sac, Pact). Same keyword, two ways to fire it.",
    "disadvantage": "No late wall. Split class makes Play’s builder awkward. Frost Lock still fakes lethal. Hands can be all Pirate or all Zombie.",
    "vsNotes": [
      "vs Haunt: Blast their Boogie, Boogie yours second. Venom their Dusty.",
      "vs Crown: Race. Typhoon Meditation. Do not play fair past 7.",
      "vs Bow: Faster. Ambush Mary. Kill Mini.",
      "vs Wizard: Chip Frost Lock. Typhoon Scheme. Sac is a spell — play around Counterspell."
    ]
  },
  {
    "id": "crown-pirate",
    "name": "Wall Haunt",
    "hero": "Crown",
    "heroes": [
      "Crown",
      "Pirate"
    ],
    "splash": [
      "Pirate"
    ],
    "kind": "mix",
    "arch": "Midrange",
    "tags": [
      "sot",
      "haunt",
      "taunt",
      "poison",
      "traps"
    ],
    "preset": "Wall Haunt",
    "tagline": "Force Haunt trades behind a Crown wall, answer their burst.",
    "why": "Dusty and Crown Taunts force trades; Haunt pays you for those trades. Icy blanks their face while you set Venom or Atlas. Six traps because this is a midrange wall, not a glass race — Ambush/Divine Shield keep bodies, Blast/Frost Lock stop burst, Counterspell stops Garden.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Crown. This mix also uses Pirate cards (same as official dual-class shells). If the builder rejects off-class cards, pick Crown and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Wall Haunt”."
    ],
    "cards": [
      [
        "V001",
        2,
        "Chico",
        "Taunt"
      ],
      [
        "V004",
        1,
        "Gary",
        "Draw a card."
      ],
      [
        "V006",
        1,
        "Icy",
        "Your Hero is immune."
      ],
      [
        "V010",
        2,
        "Prince",
        "At the start of your turn, draw a card."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V076",
        2,
        "Snake Venom",
        "Give a friendly Pirate Creature Poison until the end of the turn."
      ],
      [
        "V012",
        2,
        "Stump",
        "Has +2 ATK if you control another Creature."
      ],
      [
        "V014",
        2,
        "Web",
        "Draw a card."
      ],
      [
        "V015",
        2,
        "Blade",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V022",
        2,
        "Helios",
        "At the start of your turn, deal 3 damage to the enemy Hero."
      ],
      [
        "V089",
        2,
        "Chum The Water",
        "Whenever a friendly Pirate Creature is destroyed, draw a card."
      ],
      [
        "V031",
        1,
        "Dusty",
        "Adjacent Creatures have Taunt."
      ],
      [
        "V033",
        2,
        "Goji",
        "Adjacent Creatures start of turn effects trigger an additional time."
      ],
      [
        "V092",
        2,
        "Meditation",
        "Your Crown Creatures start of turn effects trigger an additional time."
      ],
      [
        "V037",
        1,
        "Scout",
        "Adjacent Creatures have Rush."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V045",
        1,
        "Buster",
        "Whenever another friendly Creature is destroyed, deal 2 damage to the enemy Hero."
      ],
      [
        "V050",
        2,
        "Pulse",
        "At the start of your turn, restore 5 HP to your Hero."
      ],
      [
        "V099",
        1,
        "Booty Raid",
        "Summon up to 2 Pirate Creatures that cost 3 or less from your deck."
      ],
      [
        "V058",
        1,
        "Shield",
        "Add up to 2 Creatures from your graveyard to your hand."
      ],
      [
        "V065",
        1,
        "Atlas",
        "At the start of your turn, deal 7 damage to the enemy Hero."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V105",
        1,
        "Divine Shield",
        "When the enemy would destroy a friendly Creature, negate it."
      ]
    ],
    "logic": {
      "heroes": [
        "Crown",
        "Pirate"
      ],
      "tags": [
        "sot",
        "haunt",
        "taunt",
        "poison"
      ],
      "targets": [
        23,
        11,
        6
      ],
      "cores": [
        "Crown",
        "Pirate"
      ]
    },
    "trapPlan": "6 traps — hybrid wall. Ambush/Divine Shield keep Haunt bodies alive; Blast/Frost Lock stop their burst; Counterspell stops Garden/Sac.",
    "advantage": "Dusty + Crown Taunts force the trades Haunt wants. Icy blanks face while Venom or Atlas comes online.",
    "disadvantage": "Two plans that fight for slots (Meditation vs Chum). Can be too slow for pure Haunt and too fair for Trap Lab.",
    "vsNotes": [
      "vs Haunt: Icy + Frost Lock, then Venom their wall. You want the midgame.",
      "vs Crown: Meditation + Atlas is your clock. Typhoon theirs.",
      "vs Bow: Ambush + Counterspell the Garden turn.",
      "vs Wizard: Blast Wiggles ticks. Do not race EOT without Frost Lock set."
    ]
  },
  {
    "id": "bow-pirate",
    "name": "Rush Garden",
    "hero": "Bow",
    "heroes": [
      "Bow",
      "Pirate"
    ],
    "splash": [
      "Pirate"
    ],
    "kind": "mix",
    "arch": "Aggro",
    "tags": [
      "garden",
      "play",
      "haunt",
      "poison",
      "tempo",
      "traps"
    ],
    "preset": "Rush Garden",
    "tagline": "Rush Garden that still packs Ambush and a Frost Lock.",
    "why": "Dash/Scout Rush plus Garden Play is the fastest fair clock that is not pure Haunt. Loopy and Venom both ignore the kill-gate. Mini keeps Love Shot live. Four traps so the crackback (Ambush on their side used to just win) does not end you.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Bow. This mix also uses Pirate cards (same as official dual-class shells). If the builder rejects off-class cards, pick Bow and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Rush Garden”."
    ],
    "cards": [
      [
        "V003",
        1,
        "Dash",
        "Rush"
      ],
      [
        "V004",
        1,
        "Gary",
        "Draw a card."
      ],
      [
        "V008",
        2,
        "Mini",
        "This Creature counts as all Classes."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V076",
        2,
        "Snake Venom",
        "Give a friendly Pirate Creature Poison until the end of the turn."
      ],
      [
        "V012",
        2,
        "Stump",
        "Has +2 ATK if you control another Creature."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ],
      [
        "V014",
        2,
        "Web",
        "Draw a card."
      ],
      [
        "V015",
        2,
        "Blade",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V017",
        1,
        "Chart",
        "Add a Pirate Spell from your deck to your hand."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V024",
        1,
        "Loopy",
        "Poison"
      ],
      [
        "V084",
        2,
        "Love Shot",
        "Deal 2 damage to a target. If you control a Bow Creature, deal 4 instead."
      ],
      [
        "V028",
        1,
        "Sunny",
        "When an adjacent Creature is destroyed, draw a card."
      ],
      [
        "V089",
        2,
        "Chum The Water",
        "Whenever a friendly Pirate Creature is destroyed, draw a card."
      ],
      [
        "V031",
        1,
        "Dusty",
        "Adjacent Creatures have Taunt."
      ],
      [
        "V090",
        2,
        "Garden",
        "Your Bow Creatures Play effects trigger an additional time."
      ],
      [
        "V034",
        2,
        "Mary",
        "Deal 3 damage to a target."
      ],
      [
        "V037",
        1,
        "Scout",
        "Adjacent Creatures have Rush."
      ],
      [
        "V042",
        2,
        "Sweetie",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V045",
        1,
        "Buster",
        "Whenever another friendly Creature is destroyed, deal 2 damage to the enemy Hero."
      ],
      [
        "V046",
        1,
        "Cherry",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V048",
        1,
        "Mama Light",
        "Draw a card. If you control another Creature, draw 2 instead."
      ],
      [
        "V099",
        1,
        "Booty Raid",
        "Summon up to 2 Pirate Creatures that cost 3 or less from your deck."
      ],
      [
        "V064",
        1,
        "Aria",
        "Deal 7 damage to a target."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ]
    ],
    "logic": {
      "heroes": [
        "Bow",
        "Pirate"
      ],
      "tags": [
        "garden",
        "play",
        "haunt",
        "poison",
        "tempo"
      ],
      "targets": [
        23,
        13,
        4
      ],
      "cores": [
        "Bow",
        "Pirate"
      ]
    },
    "trapPlan": "4 traps — Rush Garden is still a race. Ambush plus one Blast and one Frost Lock so you do not die on the crackback.",
    "advantage": "Dash/Scout Rush plus Garden Play plus Venom/Loopy through walls. Fastest fair mix that is not pure Haunt.",
    "disadvantage": "Glass. No recursion. Garden and Chum fight for slots. Ambush still eats the only Rush body.",
    "vsNotes": [
      "vs Haunt: Frost Lock their turn, then Venom + Rush through. You must be faster.",
      "vs Crown: Typhoon Meditation. Garden Aria before Atlas 14.",
      "vs Bow: Your Rush is the edge. Ambush their Mary.",
      "vs Wizard: Do not swing into Ambush. Chip, then Garden burst around Frost Lock."
    ]
  },
  {
    "id": "wizard-pirate",
    "name": "Burn Haunt",
    "hero": "Wizard",
    "heroes": [
      "Wizard",
      "Pirate"
    ],
    "splash": [
      "Pirate"
    ],
    "kind": "mix",
    "arch": "Aggro",
    "tags": [
      "scheme",
      "eot",
      "haunt",
      "poison",
      "traps"
    ],
    "preset": "Burn Haunt",
    "tagline": "Haunt plus Scheme, with enough traps to keep both clocks on.",
    "why": "Two face clocks: Haunt combat (Blade/Buster/Venom) and Scheme EOT (Poke/Spark/Wiggles). Blast turns their Haunt burst around. Chart still finds Venom. Five traps so you can play both clocks without dying to the first Ambush.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Wizard. This mix also uses Pirate cards (same as official dual-class shells). If the builder rejects off-class cards, pick Wizard and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Burn Haunt”."
    ],
    "cards": [
      [
        "V073",
        1,
        "Frostbolt",
        "Deal 1 damage to a target. If you control a Wizard Creature, deal 3 instead."
      ],
      [
        "V004",
        2,
        "Gary",
        "Draw a card."
      ],
      [
        "V005",
        1,
        "Ginger",
        "At the end of your turn, draw a card."
      ],
      [
        "V009",
        2,
        "Poke",
        "At the end of your turn, deal 1 damage to the enemy Hero."
      ],
      [
        "V074",
        2,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V076",
        2,
        "Snake Venom",
        "Give a friendly Pirate Creature Poison until the end of the turn."
      ],
      [
        "V012",
        2,
        "Stump",
        "Has +2 ATK if you control another Creature."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ],
      [
        "V014",
        2,
        "Web",
        "Draw a card."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V015",
        2,
        "Blade",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V017",
        1,
        "Chart",
        "Add a Pirate Spell from your deck to your hand."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V026",
        1,
        "Scroll",
        "Add a Wizard Spell from your deck to your hand."
      ],
      [
        "V088",
        1,
        "Cauldron",
        "Draw a card. If you control a Wizard Creature, draw 3 instead."
      ],
      [
        "V089",
        2,
        "Chum The Water",
        "Whenever a friendly Pirate Creature is destroyed, draw a card."
      ],
      [
        "V031",
        1,
        "Dusty",
        "Adjacent Creatures have Taunt."
      ],
      [
        "V094",
        2,
        "Scheme",
        "Your Wizard Creatures end of turn effects trigger an additional time."
      ],
      [
        "V037",
        1,
        "Scout",
        "Adjacent Creatures have Rush."
      ],
      [
        "V040",
        2,
        "Spark",
        "At the end of your turn, deal 2 damage to the enemy Hero."
      ],
      [
        "V041",
        1,
        "Surge",
        "Your adjacent Creatures end of turn effects trigger an additional time."
      ],
      [
        "V045",
        1,
        "Buster",
        "Whenever another friendly Creature is destroyed, deal 2 damage to the enemy Hero."
      ],
      [
        "V099",
        1,
        "Booty Raid",
        "Summon up to 2 Pirate Creatures that cost 3 or less from your deck."
      ],
      [
        "V060",
        1,
        "Volt",
        "Add up to 2 Traps from your deck to your hand."
      ],
      [
        "V067",
        1,
        "Wiggles",
        "At the end of your turn, deal 5 damage to the enemy Hero."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ]
    ],
    "logic": {
      "heroes": [
        "Wizard",
        "Pirate"
      ],
      "tags": [
        "scheme",
        "eot",
        "haunt",
        "poison",
        "traps"
      ],
      "targets": [
        21,
        14,
        5
      ],
      "cores": [
        "Wizard",
        "Pirate"
      ]
    },
    "trapPlan": "5 traps — two clocks (Haunt + Scheme) so you can afford Ambush/Blast/Frost Lock/Counterspell without going full Lab.",
    "advantage": "Haunt combat and Scheme EOT at once. Blast turns their Boogie around. Chart still finds Venom.",
    "disadvantage": "Scheme only doubles Wizard EOT, not Blade. Split focus can stall both clocks. Slot-hungry (Scheme + Chum + traps).",
    "vsNotes": [
      "vs Haunt: Blast + Frost Lock. Venom their Taunt. You win if the first burst lives.",
      "vs Crown: Two clocks beat one Atlas if traps hold. Typhoon Meditation.",
      "vs Bow: Counterspell Garden. Ambush Mary.",
      "vs Wizard: Typhoon Scheme. Your Haunt is the extra plan they may not have."
    ]
  },
  {
    "id": "crown-zombie",
    "name": "Grave Crown",
    "hero": "Crown",
    "heroes": [
      "Crown",
      "Zombie"
    ],
    "splash": [
      "Zombie"
    ],
    "kind": "mix",
    "arch": "Control",
    "tags": [
      "sot",
      "grave",
      "haunt",
      "traps"
    ],
    "preset": "Grave Crown",
    "tagline": "Grave recursion and Atlas, behind a real trap wall.",
    "why": "Both classes love the graveyard. Shield/Avenge recur Crown; Shepherd/Reborn recur Zombie. Haunt detonates while Atlas ticks. Six traps — slowest fair deck has to survive the race. Extra Frost Lock instead of Divine Shield because lethal is the card that ends you.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Crown. This mix also uses Zombie cards (same as official dual-class shells). If the builder rejects off-class cards, pick Crown and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Grave Crown”."
    ],
    "cards": [
      [
        "V072",
        1,
        "Boost",
        "Restore 8 HP to your Hero."
      ],
      [
        "V001",
        1,
        "Chico",
        "Taunt"
      ],
      [
        "V018",
        1,
        "Digger",
        "Send a Creature from your deck to your graveyard."
      ],
      [
        "V006",
        1,
        "Icy",
        "Your Hero is immune."
      ],
      [
        "V010",
        2,
        "Prince",
        "At the start of your turn, draw a card."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V075",
        2,
        "Sacrifice",
        "Destroy a friendly Creature and draw 2 cards. If it's a Zombie Creature, draw 3 instead."
      ],
      [
        "V013",
        2,
        "Thumpy",
        "Draw a card."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V020",
        2,
        "Dumpy",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V022",
        2,
        "Helios",
        "At the start of your turn, deal 3 damage to the enemy Hero."
      ],
      [
        "V085",
        1,
        "Pact",
        "Destroy a friendly Zombie Creature and an enemy Creature."
      ],
      [
        "V011",
        2,
        "Pumpy",
        "Restore 3 HP to your Hero."
      ],
      [
        "V033",
        1,
        "Goji",
        "Adjacent Creatures start of turn effects trigger an additional time."
      ],
      [
        "V082",
        1,
        "Haunted House",
        "At the end of your turn, trigger the Haunt effects of the Zombie Creatures you control."
      ],
      [
        "V092",
        2,
        "Meditation",
        "Your Crown Creatures start of turn effects trigger an additional time."
      ],
      [
        "V038",
        1,
        "Shepherd",
        "Summon a Creature that costs 2 or less from your graveyard."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V044",
        1,
        "Boogie",
        "Trigger the Haunt effects of all your other Creatures."
      ],
      [
        "V050",
        1,
        "Pulse",
        "At the start of your turn, restore 5 HP to your Hero."
      ],
      [
        "V051",
        2,
        "Reaper",
        "At the end of your turn, trigger the Haunt effects of the adjacent Creatures."
      ],
      [
        "V058",
        1,
        "Shield",
        "Add up to 2 Creatures from your graveyard to your hand."
      ],
      [
        "V059",
        2,
        "Toot",
        "Deal 5 damage to the enemy Hero."
      ],
      [
        "V065",
        1,
        "Atlas",
        "At the start of your turn, deal 7 damage to the enemy Hero."
      ],
      [
        "V101",
        1,
        "Black Hole",
        "Destroy all Creatures."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ]
    ],
    "logic": {
      "heroes": [
        "Crown",
        "Zombie"
      ],
      "tags": [
        "sot",
        "grave",
        "haunt",
        "traps"
      ],
      "targets": [
        23,
        11,
        6
      ],
      "cores": [
        "Crown",
        "Zombie"
      ]
    },
    "trapPlan": "6 traps — slowest fair deck, so the wall has to be real. Ambush/Frost Lock/Blast/Counterspell, drop Divine Shield for the extra Frost Lock.",
    "advantage": "Two graveyards. Shield/Avenge plus Shepherd/Reborn. Haunt detonates while Atlas ticks. Wins any game that goes long.",
    "disadvantage": "Slowest list. Gummy is a lock. Aggro with Venom punches Taunts. You lose if you Meditation instead of Frost Lock.",
    "vsNotes": [
      "vs Haunt: Frost Lock + Icy, then Pact their engine. Do not race.",
      "vs Crown: Recursion plus Atlas. You outlast the mirror.",
      "vs Bow: Counterspell Aria. Recur Helios.",
      "vs Wizard: Frost Lock lethal, then Atlas vs Wiggles. Typhoon Scheme if you drew it — you did not, so race the SOT clock."
    ]
  },
  {
    "id": "bow-zombie",
    "name": "Garden Grave",
    "hero": "Bow",
    "heroes": [
      "Bow",
      "Zombie"
    ],
    "splash": [
      "Zombie"
    ],
    "kind": "mix",
    "arch": "Midrange",
    "tags": [
      "garden",
      "play",
      "grave",
      "haunt",
      "traps"
    ],
    "preset": "Garden Grave",
    "tagline": "Play-summons plus grave-summons, with traps so Garden is not suicide.",
    "why": "Sweetie/Cherry put bodies in play; Shepherd puts them back from GY. Garden doubles the Play summons. Five traps plus Typhoon — this mix used to skip answers and lose to Boogie and Scheme on the same turn they tried to Garden.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Bow. This mix also uses Zombie cards (same as official dual-class shells). If the builder rejects off-class cards, pick Bow and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Garden Grave”."
    ],
    "cards": [
      [
        "V003",
        1,
        "Dash",
        "Rush"
      ],
      [
        "V018",
        2,
        "Digger",
        "Send a Creature from your deck to your graveyard."
      ],
      [
        "V008",
        2,
        "Mini",
        "This Creature counts as all Classes."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V075",
        2,
        "Sacrifice",
        "Destroy a friendly Creature and draw 2 cards. If it's a Zombie Creature, draw 3 instead."
      ],
      [
        "V013",
        2,
        "Thumpy",
        "Draw a card."
      ],
      [
        "V020",
        2,
        "Dumpy",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V024",
        1,
        "Loopy",
        "Poison"
      ],
      [
        "V084",
        2,
        "Love Shot",
        "Deal 2 damage to a target. If you control a Bow Creature, deal 4 instead."
      ],
      [
        "V085",
        1,
        "Pact",
        "Destroy a friendly Zombie Creature and an enemy Creature."
      ],
      [
        "V011",
        1,
        "Pumpy",
        "Restore 3 HP to your Hero."
      ],
      [
        "V028",
        1,
        "Sunny",
        "When an adjacent Creature is destroyed, draw a card."
      ],
      [
        "V090",
        2,
        "Garden",
        "Your Bow Creatures Play effects trigger an additional time."
      ],
      [
        "V082",
        1,
        "Haunted House",
        "At the end of your turn, trigger the Haunt effects of the Zombie Creatures you control."
      ],
      [
        "V034",
        2,
        "Mary",
        "Deal 3 damage to a target."
      ],
      [
        "V038",
        1,
        "Shepherd",
        "Summon a Creature that costs 2 or less from your graveyard."
      ],
      [
        "V042",
        1,
        "Sweetie",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V044",
        2,
        "Boogie",
        "Trigger the Haunt effects of all your other Creatures."
      ],
      [
        "V046",
        1,
        "Cherry",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V048",
        2,
        "Mama Light",
        "Draw a card. If you control another Creature, draw 2 instead."
      ],
      [
        "V051",
        1,
        "Reaper",
        "At the end of your turn, trigger the Haunt effects of the adjacent Creatures."
      ],
      [
        "V059",
        1,
        "Toot",
        "Deal 5 damage to the enemy Hero."
      ],
      [
        "V064",
        1,
        "Aria",
        "Deal 7 damage to a target."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ]
    ],
    "logic": {
      "heroes": [
        "Bow",
        "Zombie"
      ],
      "tags": [
        "garden",
        "play",
        "grave",
        "haunt"
      ],
      "targets": [
        24,
        11,
        5
      ],
      "cores": [
        "Bow",
        "Zombie"
      ]
    },
    "trapPlan": "5 traps — Garden Grave used to skip traps and die to the first Boogie. Ambush/Frost Lock/Blast plus Typhoon for their engine slot.",
    "advantage": "Sweetie/Cherry put bodies in; Shepherd/Bender put them back. Garden doubles the Play half. Mama Light draws on a dense board.",
    "disadvantage": "Two summon plans, neither is a wall. Garden is Typhoon bait. Loses the pure race and the pure trap wall.",
    "vsNotes": [
      "vs Haunt: Frost Lock first. Then Garden, not the other way around.",
      "vs Crown: Typhoon Meditation. Recur Mary. You need the midgame.",
      "vs Bow: Counterspell is gone — Ambush their swing, Garden yours second.",
      "vs Wizard: Typhoon Scheme. Do not dump Aria into Frost Lock."
    ]
  },
  {
    "id": "wizard-zombie",
    "name": "Lab Haunt",
    "hero": "Wizard",
    "heroes": [
      "Wizard",
      "Zombie"
    ],
    "splash": [
      "Zombie"
    ],
    "kind": "mix",
    "arch": "Combo",
    "tags": [
      "scheme",
      "eot",
      "haunt",
      "grave",
      "traps"
    ],
    "preset": "Lab Haunt",
    "tagline": "Lab Haunt with an extra Ambush so Boogie does not bounce off their wall.",
    "why": "Boogie/Sac cash Haunt while Scheme burns. Scheme only doubles Wizard EOT, not Reaper — keep Surge next to Spark/Wiggles, Reaper next to Haunt bodies. Six traps buy the setup turn live players will Ambush or Frost Lock.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Wizard. This mix also uses Zombie cards (same as official dual-class shells). If the builder rejects off-class cards, pick Wizard and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Lab Haunt”."
    ],
    "cards": [
      [
        "V018",
        1,
        "Digger",
        "Send a Creature from your deck to your graveyard."
      ],
      [
        "V073",
        1,
        "Frostbolt",
        "Deal 1 damage to a target. If you control a Wizard Creature, deal 3 instead."
      ],
      [
        "V005",
        1,
        "Ginger",
        "At the end of your turn, draw a card."
      ],
      [
        "V009",
        2,
        "Poke",
        "At the end of your turn, deal 1 damage to the enemy Hero."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V075",
        2,
        "Sacrifice",
        "Destroy a friendly Creature and draw 2 cards. If it's a Zombie Creature, draw 3 instead."
      ],
      [
        "V013",
        2,
        "Thumpy",
        "Draw a card."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V020",
        3,
        "Dumpy",
        "Deal 2 damage to the enemy Hero."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V085",
        1,
        "Pact",
        "Destroy a friendly Zombie Creature and an enemy Creature."
      ],
      [
        "V011",
        1,
        "Pumpy",
        "Restore 3 HP to your Hero."
      ],
      [
        "V026",
        1,
        "Scroll",
        "Add a Wizard Spell from your deck to your hand."
      ],
      [
        "V110",
        1,
        "Spring Trap",
        "When the enemy summons a Creature, negate the summon and return that Creature to their han"
      ],
      [
        "V087",
        1,
        "Airdrop",
        "Draw 2 cards."
      ],
      [
        "V088",
        1,
        "Cauldron",
        "Draw a card. If you control a Wizard Creature, draw 3 instead."
      ],
      [
        "V082",
        2,
        "Haunted House",
        "At the end of your turn, trigger the Haunt effects of the Zombie Creatures you control."
      ],
      [
        "V094",
        2,
        "Scheme",
        "Your Wizard Creatures end of turn effects trigger an additional time."
      ],
      [
        "V038",
        1,
        "Shepherd",
        "Summon a Creature that costs 2 or less from your graveyard."
      ],
      [
        "V040",
        1,
        "Spark",
        "At the end of your turn, deal 2 damage to the enemy Hero."
      ],
      [
        "V041",
        1,
        "Surge",
        "Your adjacent Creatures end of turn effects trigger an additional time."
      ],
      [
        "V044",
        1,
        "Boogie",
        "Trigger the Haunt effects of all your other Creatures."
      ],
      [
        "V051",
        2,
        "Reaper",
        "At the end of your turn, trigger the Haunt effects of the adjacent Creatures."
      ],
      [
        "V059",
        2,
        "Toot",
        "Deal 5 damage to the enemy Hero."
      ],
      [
        "V060",
        1,
        "Volt",
        "Add up to 2 Traps from your deck to your hand."
      ],
      [
        "V101",
        1,
        "Black Hole",
        "Destroy all Creatures."
      ],
      [
        "V067",
        1,
        "Wiggles",
        "At the end of your turn, deal 5 damage to the enemy Hero."
      ]
    ],
    "logic": {
      "heroes": [
        "Wizard",
        "Zombie"
      ],
      "tags": [
        "scheme",
        "eot",
        "haunt",
        "grave",
        "traps"
      ],
      "targets": [
        21,
        13,
        6
      ],
      "cores": [
        "Wizard",
        "Zombie"
      ]
    },
    "trapPlan": "6 traps — Lab Haunt needs one extra Ambush. Traps buy the turn you Boogie and Scheme in the same window.",
    "advantage": "Boogie/Sac cash Haunt while Scheme burns. Two win cons. House + Reaper keep Haunt firing without deaths.",
    "disadvantage": "Scheme does not double Reaper. Hands can be all setup. Counterspell blanks Sac. Slow vs Rush Garden.",
    "vsNotes": [
      "vs Haunt: Frost Lock + Blast. You want the second Haunt wave, not the first.",
      "vs Crown: Two clocks. Keep Surge next to Spark, Reaper next to Haunt bodies.",
      "vs Bow: Ambush Mary. Spring Trap Cherry.",
      "vs Wizard: Typhoon Scheme. Your Haunt is the tie-break."
    ]
  },
  {
    "id": "crown-bow",
    "name": "Garden Crown",
    "hero": "Crown",
    "heroes": [
      "Crown",
      "Bow"
    ],
    "splash": [
      "Bow"
    ],
    "kind": "mix",
    "arch": "Midrange",
    "tags": [
      "sot",
      "garden",
      "play",
      "taunt",
      "traps"
    ],
    "preset": "Garden Crown",
    "tagline": "Crown wall into Garden Aria, with traps for the greedy turn.",
    "why": "Survive with Icy/Taunt, then Garden turns Mary/Aria into the finisher. Pulse keeps you alive through the midgame Bow usually loses. Six traps cover the Garden turn — Ambush their swing, Counterspell their Aria, Divine Shield your body.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Crown. This mix also uses Bow cards (same as official dual-class shells). If the builder rejects off-class cards, pick Crown and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Garden Crown”."
    ],
    "cards": [
      [
        "V001",
        1,
        "Chico",
        "Taunt"
      ],
      [
        "V003",
        1,
        "Dash",
        "Rush"
      ],
      [
        "V006",
        1,
        "Icy",
        "Your Hero is immune."
      ],
      [
        "V008",
        3,
        "Mini",
        "This Creature counts as all Classes."
      ],
      [
        "V010",
        2,
        "Prince",
        "At the start of your turn, draw a card."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V022",
        2,
        "Helios",
        "At the start of your turn, deal 3 damage to the enemy Hero."
      ],
      [
        "V024",
        1,
        "Loopy",
        "Poison"
      ],
      [
        "V084",
        2,
        "Love Shot",
        "Deal 2 damage to a target. If you control a Bow Creature, deal 4 instead."
      ],
      [
        "V028",
        1,
        "Sunny",
        "When an adjacent Creature is destroyed, draw a card."
      ],
      [
        "V090",
        3,
        "Garden",
        "Your Bow Creatures Play effects trigger an additional time."
      ],
      [
        "V033",
        1,
        "Goji",
        "Adjacent Creatures start of turn effects trigger an additional time."
      ],
      [
        "V034",
        2,
        "Mary",
        "Deal 3 damage to a target."
      ],
      [
        "V092",
        2,
        "Meditation",
        "Your Crown Creatures start of turn effects trigger an additional time."
      ],
      [
        "V042",
        2,
        "Sweetie",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V046",
        2,
        "Cherry",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V048",
        2,
        "Mama Light",
        "Draw a card. If you control another Creature, draw 2 instead."
      ],
      [
        "V050",
        1,
        "Pulse",
        "At the start of your turn, restore 5 HP to your Hero."
      ],
      [
        "V058",
        1,
        "Shield",
        "Add up to 2 Creatures from your graveyard to your hand."
      ],
      [
        "V064",
        2,
        "Aria",
        "Deal 7 damage to a target."
      ],
      [
        "V065",
        1,
        "Atlas",
        "At the start of your turn, deal 7 damage to the enemy Hero."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V105",
        1,
        "Divine Shield",
        "When the enemy would destroy a friendly Creature, negate it."
      ]
    ],
    "logic": {
      "heroes": [
        "Crown",
        "Bow"
      ],
      "tags": [
        "sot",
        "garden",
        "play",
        "taunt"
      ],
      "targets": [
        26,
        8,
        6
      ],
      "cores": [
        "Crown",
        "Bow"
      ]
    },
    "trapPlan": "6 traps — Pulse keeps you alive; Ambush/Counterspell/Divine Shield cover the Garden turn Crown usually dies on.",
    "advantage": "Icy/Taunt buy time, Garden turns Mary/Aria into the finisher, Pulse heals the midgame Bow usually loses to aggro.",
    "disadvantage": "Meditation and Garden both want a slot. No Haunt cash. Can be too slow vs Trap Lab burn and too fair vs Haunt.",
    "vsNotes": [
      "vs Haunt: Icy + Frost Lock, then Garden. Do not Aria until the wall is set.",
      "vs Crown: Garden Aria vs their Atlas. Typhoon their Meditation.",
      "vs Bow: Counterspell their Aria. Yours under Garden should be bigger.",
      "vs Wizard: Hold Frost Lock. Do not dump Aria into unknown slots. Typhoon Scheme if you can; otherwise race Garden vs Wiggles."
    ]
  },
  {
    "id": "crown-wizard",
    "name": "Double Clock",
    "hero": "Crown",
    "heroes": [
      "Crown",
      "Wizard"
    ],
    "splash": [
      "Wizard"
    ],
    "kind": "mix",
    "arch": "Control",
    "tags": [
      "sot",
      "scheme",
      "eot",
      "traps"
    ],
    "preset": "Double Clock",
    "tagline": "Both clocks plus a trap wall. Racing you should be a mistake.",
    "why": "Damage on both phases. Meditation/Goji multiply start-of-turn Atlas/Helios; Scheme/Surge multiply end-of-turn Spark/Wiggles. Trap wall makes racing you a bad plan. Typhoon so the Wizard mirror cannot sit on Scheme forever.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Crown. This mix also uses Wizard cards (same as official dual-class shells). If the builder rejects off-class cards, pick Crown and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Double Clock”."
    ],
    "cards": [
      [
        "V001",
        1,
        "Chico",
        "Taunt"
      ],
      [
        "V073",
        1,
        "Frostbolt",
        "Deal 1 damage to a target. If you control a Wizard Creature, deal 3 instead."
      ],
      [
        "V005",
        1,
        "Ginger",
        "At the end of your turn, draw a card."
      ],
      [
        "V006",
        1,
        "Icy",
        "Your Hero is immune."
      ],
      [
        "V009",
        2,
        "Poke",
        "At the end of your turn, deal 1 damage to the enemy Hero."
      ],
      [
        "V010",
        2,
        "Prince",
        "At the start of your turn, draw a card."
      ],
      [
        "V074",
        1,
        "Quickdraw",
        "Draw a card."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the enemy"
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V079",
        1,
        "Cull",
        "Destroy a Creature with 3 or less ATK."
      ],
      [
        "V105",
        1,
        "Divine Shield",
        "When the enemy would destroy a friendly Creature, negate it."
      ],
      [
        "V106",
        2,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V022",
        1,
        "Helios",
        "At the start of your turn, deal 3 damage to the enemy Hero."
      ],
      [
        "V026",
        1,
        "Scroll",
        "Add a Wizard Spell from your deck to your hand."
      ],
      [
        "V088",
        1,
        "Cauldron",
        "Draw a card. If you control a Wizard Creature, draw 3 instead."
      ],
      [
        "V033",
        2,
        "Goji",
        "Adjacent Creatures start of turn effects trigger an additional time."
      ],
      [
        "V092",
        3,
        "Meditation",
        "Your Crown Creatures start of turn effects trigger an additional time."
      ],
      [
        "V094",
        3,
        "Scheme",
        "Your Wizard Creatures end of turn effects trigger an additional time."
      ],
      [
        "V040",
        2,
        "Spark",
        "At the end of your turn, deal 2 damage to the enemy Hero."
      ],
      [
        "V041",
        2,
        "Surge",
        "Your adjacent Creatures end of turn effects trigger an additional time."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V050",
        1,
        "Pulse",
        "At the start of your turn, restore 5 HP to your Hero."
      ],
      [
        "V058",
        1,
        "Shield",
        "Add up to 2 Creatures from your graveyard to your hand."
      ],
      [
        "V060",
        1,
        "Volt",
        "Add up to 2 Traps from your deck to your hand."
      ],
      [
        "V065",
        1,
        "Atlas",
        "At the start of your turn, deal 7 damage to the enemy Hero."
      ],
      [
        "V101",
        1,
        "Black Hole",
        "Destroy all Creatures."
      ],
      [
        "V067",
        1,
        "Wiggles",
        "At the end of your turn, deal 5 damage to the enemy Hero."
      ],
      [
        "V077",
        1,
        "Typhoon",
        "Destroy an enemy Trap or Spell in play."
      ]
    ],
    "logic": {
      "heroes": [
        "Crown",
        "Wizard"
      ],
      "tags": [
        "sot",
        "scheme",
        "eot",
        "traps"
      ],
      "targets": [
        20,
        13,
        7
      ],
      "cores": [
        "Crown",
        "Wizard"
      ]
    },
    "trapPlan": "7 traps — Double Clock already had the wall. Keep it. Typhoon added so the mirror and Trap Lab cannot sit on Scheme forever.",
    "advantage": "Damage on both phases. Meditation/Goji multiply Atlas; Scheme/Surge multiply Wiggles. Trap wall makes racing you a bad plan.",
    "disadvantage": "Greed list. Both engines and traps fight for five slots. Slowest to assemble. Typhoon on either engine halves you.",
    "vsNotes": [
      "vs Haunt: Full wall first. Then either clock. Do not double-engine on 4.",
      "vs Crown: You have EOT they may not. Scheme is the extra.",
      "vs Bow: Counterspell Garden. Ambush Mary.",
      "vs Wizard: Typhoon their Scheme. Your Atlas is the extra clock."
    ]
  },
  {
    "id": "bow-wizard",
    "name": "Garden Lab",
    "hero": "Bow",
    "heroes": [
      "Bow",
      "Wizard"
    ],
    "splash": [
      "Wizard"
    ],
    "kind": "mix",
    "arch": "Midrange",
    "tags": [
      "garden",
      "play",
      "scheme",
      "eot",
      "traps"
    ],
    "preset": "Garden Lab",
    "tagline": "Garden plus Scheme, with a trap package Hunt lists used to skip.",
    "why": "Official Midrange Hunt pairing. Garden doubles Play; Scheme doubles EOT. Mini keeps Bow conditionals on. Six traps cover the Garden turn and Cherry floods (Pitfall). Two clocks: burst Play and residual burn.",
    "how": [
      "Open ddltcg.com/play and sign in so the preset saves.",
      "Custom Deck → class Bow. This mix also uses Wizard cards (same as official dual-class shells). If the builder rejects off-class cards, pick Bow and skip lines tagged splash.",
      "Add every line (max 3). Tick them off. Read the play manual before queueing.",
      "Save preset as “Garden Lab”."
    ],
    "cards": [
      [
        "V003",
        1,
        "Dash",
        "Rush"
      ],
      [
        "V073",
        1,
        "Frostbolt",
        "Deal 1 damage to a target. If you control a Wizard Creature, deal 3 instead."
      ],
      [
        "V005",
        1,
        "Ginger",
        "At the end of your turn, draw a card."
      ],
      [
        "V008",
        2,
        "Mini",
        "This Creature counts as all Classes."
      ],
      [
        "V009",
        2,
        "Poke",
        "At the end of your turn, deal 1 damage to the enemy Hero."
      ],
      [
        "V102",
        2,
        "Ambush",
        "When an enemy Creature attacks, negate the attack and destroy that Creature."
      ],
      [
        "V104",
        1,
        "Counterspell",
        "When the enemy plays a Spell, negate that Spell."
      ],
      [
        "V081",
        1,
        "Fireball",
        "Deal 3 damage to a target."
      ],
      [
        "V106",
        1,
        "Frost Lock",
        "When your Hero takes fatal damage, negate it and become immune for the rest of the turn."
      ],
      [
        "V024",
        1,
        "Loopy",
        "Poison"
      ],
      [
        "V084",
        2,
        "Love Shot",
        "Deal 2 damage to a target. If you control a Bow Creature, deal 4 instead."
      ],
      [
        "V026",
        1,
        "Scroll",
        "Add a Wizard Spell from your deck to your hand."
      ],
      [
        "V028",
        1,
        "Sunny",
        "When an adjacent Creature is destroyed, draw a card."
      ],
      [
        "V088",
        1,
        "Cauldron",
        "Draw a card. If you control a Wizard Creature, draw 3 instead."
      ],
      [
        "V090",
        3,
        "Garden",
        "Your Bow Creatures Play effects trigger an additional time."
      ],
      [
        "V034",
        2,
        "Mary",
        "Deal 3 damage to a target."
      ],
      [
        "V094",
        2,
        "Scheme",
        "Your Wizard Creatures end of turn effects trigger an additional time."
      ],
      [
        "V040",
        2,
        "Spark",
        "At the end of your turn, deal 2 damage to the enemy Hero."
      ],
      [
        "V041",
        1,
        "Surge",
        "Your adjacent Creatures end of turn effects trigger an additional time."
      ],
      [
        "V042",
        1,
        "Sweetie",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V096",
        1,
        "Takedown",
        "Destroy a Creature with 4 or more ATK."
      ],
      [
        "V046",
        2,
        "Cherry",
        "Summon a Creature that costs 2 or less from your deck."
      ],
      [
        "V048",
        2,
        "Mama Light",
        "Draw a card. If you control another Creature, draw 2 instead."
      ],
      [
        "V060",
        1,
        "Volt",
        "Add up to 2 Traps from your deck to your hand."
      ],
      [
        "V064",
        2,
        "Aria",
        "Deal 7 damage to a target."
      ],
      [
        "V067",
        1,
        "Wiggles",
        "At the end of your turn, deal 5 damage to the enemy Hero."
      ],
      [
        "V103",
        1,
        "Blast",
        "When the enemy would deal damage to your Hero, negate it and deal that damage to the ene"
      ],
      [
        "V108",
        1,
        "Pitfall",
        "When the enemy summons a Creature with 4 or more ATK, destroy that Creature."
      ]
    ],
    "logic": {
      "heroes": [
        "Bow",
        "Wizard"
      ],
      "tags": [
        "garden",
        "play",
        "scheme",
        "eot"
      ],
      "targets": [
        23,
        11,
        6
      ],
      "cores": [
        "Bow",
        "Wizard"
      ]
    },
    "trapPlan": "6 traps — official Midrange Hunt pairing was trap-light. Ambush/Blast/Counterspell/Frost Lock/Pitfall cover Garden setup and Cherry floods.",
    "advantage": "Garden doubles Play; Scheme doubles EOT. Mini keeps Bow spells live. Two different clocks: burst Play and residual burn.",
    "disadvantage": "Needs both engines to feel complete. Slot-hungry. Aggro can kill the Garden turn. Ambush still eats Aria.",
    "vsNotes": [
      "vs Haunt: Frost Lock + Blast, then Garden. Do not race their Boogie.",
      "vs Crown: Two clocks vs Atlas. Pitfall their Atlas summon. Typhoon Meditation if you can — you cannot, so race.",
      "vs Bow: Counterspell Aria. Yours plus Scheme chip wins long.",
      "vs Wizard: Pitfall Wiggles. Counterspell Scheme. Garden is your extra."
    ]
  }
];
