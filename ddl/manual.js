/** Play manuals derived from the actual 40-card list + class tags. */

function qtyNamed(rows, name) {
  return rows.filter((r) => r.name === name).reduce((s, r) => s + r.qty, 0);
}

function present(rows, name) {
  return qtyNamed(rows, name) > 0;
}

function parseHeroDmg(text) {
  const m = String(text || "").match(/deal (\d+) damage to the enemy hero/i);
  return m ? Number(m[1]) : 0;
}

function derivePlayManual(build, rows) {
  const tags = build.tags || [];
  const heroes = build.heroes || [build.hero];
  const n = (name) => present(rows, name);
  const combos = [];
  const sequencing = [];
  const setup = [];
  const mistakes = [];
  const turns = [];

  const hauntBodies = rows.filter((r) => r.pill === "Haunt" && r.type === "Creature");
  const eotBurn = rows.filter((r) => /end of your turn/i.test(r.text) && /enemy hero/i.test(r.text));
  const sotFace = rows.filter((r) => /start of your turn/i.test(r.text) && /enemy hero/i.test(r.text));
  const traps = rows.filter((r) => r.type === "Trap");
  const avg = rows.reduce((s, r) => s + r.mana * r.qty, 0) / Math.max(1, rows.reduce((s, r) => s + r.qty, 0));

  if (heroes.length === 1) {
    setup.push(`Hero class is ${heroes[0]}. Only ${heroes[0]}, Neutral, and All-class cards are legal.`);
  } else {
    setup.push(
      `Mix: ${heroes.join(" + ")}. Official shells (Aggro Pack, Midrange Hunt) are written this way. In Play, set class to ${build.hero}. If the builder blocks off-class cards, skip lines marked Splash.`
    );
  }

  if (n("Goji") || n("Dusty") || n("Scout") || n("Surge") || n("Reaper") || n("Sunny")) {
    setup.push("Lanes are L1–L5 left to right. Adjacent = neighbor lane. Center (L3) is for auras.");
  }
  if (n("Goji")) setup.push("Park Goji in L3. Seat Helios / Prince / Pulse / Atlas in L2 and L4 so they touch Goji.");
  if (n("Surge")) setup.push("Park Surge in L3. Seat Poke / Spark / Wiggles in L2 and L4.");
  if (n("Dusty")) setup.push("Dusty in L3 spreads Taunt to L2 and L4 — that is how you force Haunt trades.");
  if (n("Scout")) setup.push("Scout in L3 gives Rush to neighbors. They still cannot hit face the turn they enter.");
  if (n("Reaper")) setup.push("Reaper in L3; Haunt bodies in L2 and L4 so end-of-turn retriggers them.");
  if (n("Sunny")) setup.push("Sunny next to the creature you expect to die — it draws on adjacent death, not on bounce.");
  if (n("Garden") || n("Scheme") || n("Meditation") || n("Haunted House") || n("Chum The Water")) {
    setup.push("Passive spells occupy a spell/trap slot for the rest of the game. Five slots total. Do not fill every slot on turn 2.");
  }
  if (traps.length) {
    setup.push("Traps set face-down. When they pop: Spring if it wins the exchange, Hold if you still need the threat.");
  }

  /* Combos */
  if (n("Boogie") && hauntBodies.length) {
    const faceBits = hauntBodies
      .filter((r) => parseHeroDmg(r.text))
      .map((r) => `${r.qty}× ${r.name} (${parseHeroDmg(r.text)} each)`);
    const faceSum = hauntBodies.reduce((s, r) => s + parseHeroDmg(r.text) * r.qty, 0);
    combos.push({
      title: "Boogie — cash Haunts without deaths",
      body: `Haunt bodies must already be in play. Boogie says: trigger the Haunt of all your other creatures. Face Haunts in this list: ${faceBits.join(", ") || "none (this list uses Haunt for cards/heal)"}. One Boogie can be ${faceSum ? "up to " + faceSum + " face if every copy is out (rare) — in practice Web/Blade/Dumpy/Toot on board is the burst." : "card draw and value instead of a burst."} Then combat can still kill them for a second Haunt wave.`,
    });
  }
  if (n("Snake Venom")) {
    combos.push({
      title: "Snake Venom — break the kill-gate",
      body: "Combat usually needs ATK ≥ defender HP (or equal-ATK kill). Venom gives a friendly Pirate Poison until end of turn — that body destroys whatever it fights. Put it on Stump (buffed) or a 2-power Pirate to punch Taunts. Poison does not hit the enemy hero.",
    });
  }
  if (n("Sacrifice") || n("Pact")) {
    combos.push({
      title: "Detonate Haunt",
      body: `${n("Sacrifice") ? "Sacrifice: kill your creature, draw 2 (3 if it was Zombie). " : ""}${n("Pact") ? "Pact: kill your Zombie and an enemy creature. " : ""}Do this to a Haunt body you are ready to cash (Toot 5 face, Dumpy/Blade 2 face, Thumpy/Web draw). Do not sac your last attacker if you needed the board.`,
    });
  }
  if (n("Garden")) {
    const bits = [];
    if (n("Mary")) bits.push("Mary Play 3 → 6");
    if (n("Aria")) bits.push("Aria Play 7 → 14");
    if (n("Sweetie") || n("Cherry")) bits.push("Sweetie/Cherry summon twice (two 2-drops)");
    if (n("Mama Light")) bits.push("Mama Light can draw twice");
    combos.push({
      title: "Garden — Bow Play fires twice",
      body: `Play Garden into a spell slot first. It only doubles Bow creature Play effects, not spells. ${bits.join(". ") || "Keep Bow Play creatures to cash it."} Mini/Midi/Mega count as Bow, so Love Shot/Bomb stay live even beside other classes.`,
    });
  }
  if (n("Scheme") || n("Surge")) {
    const parts = eotBurn.map((r) => `${r.name} ${parseHeroDmg(r.text)} → ${parseHeroDmg(r.text) * (n("Scheme") ? 2 : 1)} with Scheme`);
    combos.push({
      title: "Scheme / Surge — end-of-turn burn",
      body: `Scheme: Wizard creature EOT effects fire an extra time (Wiggles 5→10, Spark 2→4, Poke 1→2). Surge: adjacent creatures' EOT fire extra — it stacks with Scheme if Surge sits next to the burner. ${parts.join("; ") || "Keep Wizard EOT bodies."} This is residual damage; you still need traps or a board to not die first.`,
    });
  }
  if (n("Goji") || n("Meditation")) {
    const atlas = n("Atlas") ? 7 : 0;
    const helios = n("Helios") ? 3 : 0;
    const base = atlas || helios;
    combos.push({
      title: "Goji + Meditation — start-of-turn stack",
      body: `Each “additional time” adds one trigger, it does not multiply after the fact. Atlas 7: base 7. Adjacent Goji → 14. Meditation also → 14. Both → 21. Helios 3 follows the same math (3 / 6 / 9). Pulse heals 5 / 10 / 15. Prince draws 1 / 2 / 3. Seat the payload next to Goji, then drop Meditation in a slot.`,
    });
    if (base) sequencing.push("Do not play Atlas into an empty board if you die next turn — Icy/Frost Lock first.");
  }
  if (n("Mini") && (n("Love Shot") || n("Love Bomb") || n("Connection"))) {
    combos.push({
      title: "Mini — fake the class check",
      body: "Mini/Midi/Mega count as every class while in play. Turn 1 Mini turns on Love Shot (4 if a Bow is present — Mini is Bow) and Love Bomb (12 heal). In a mix, Mini also turns on Crown/Wizard/Pirate/Zombie “if you control a X” spells from the other color.",
    });
  }
  if (n("Chum The Water")) {
    combos.push({
      title: "Chum The Water",
      body: "Passive: whenever a friendly Pirate dies, draw. Play it before you trade Web/Blade/Stump. Pairs with Dusty Taunt (they must kill) and Venom (you kill their wall and still draw when they answer).",
    });
  }
  if (n("Haunted House")) {
    combos.push({
      title: "Haunted House",
      body: "EOT: trigger Haunt on your Zombies still in play — they do not have to die. Different from Boogie (once) and Reaper (adjacent only). Stack House + Reaper for double-dipping.",
    });
  }

  /* Sequencing */
  sequencing.push("Creatures cannot attack the turn they enter unless Rush, and Rush still cannot hit face that turn.");
  if (n("Garden")) sequencing.push("Garden before Mary / Cherry / Sweetie / Aria / Mama Light. A Play already resolved does not retroactively double.");
  if (n("Scheme")) sequencing.push("Scheme before you pass with Spark/Wiggles in play. Playing Wiggles the same turn still gets EOT.");
  if (n("Meditation")) sequencing.push("Meditation can wait a turn if you need the slot for Frost Lock vs aggro.");
  if (n("Boogie")) sequencing.push("Never Boogie into an empty Haunt row. Develop 2+ Haunt bodies first.");
  if (n("Snake Venom")) sequencing.push("Venom after blockers are presented, before you swing the poisoned Pirate.");
  if (traps.length) sequencing.push("Against aggro: Frost Lock and Blast go in first. Against midrange: Counterspell / Pitfall. Do not pre-commit all five slots.");
  sequencing.push("Unspent mana is lost. If you go second, the Coin lets you pay 1 extra once.");
  sequencing.push("Hand max 10 — extra draws mill to GY. That is good for Zombie, bad for Combo.");

  /* Turns */
  const ones = rows.filter((r) => r.type === "Creature" && r.mana === 1);
  const twos = rows.filter((r) => r.mana === 2 && r.type === "Creature");
  turns.push(`Turn 1: Play a 1-drop in L3 (${ones.map((r) => r.name).slice(0, 3).join(", ") || "whatever 1-cost creature you kept"}).`);
  turns.push(`Turn 2: Second body adjacent if you have an aura coming, or a 2-drop (${twos.map((r) => r.name).slice(0, 3).join(", ") || "curve"}).`);
  if (n("Garden") || n("Scheme") || n("Meditation") || n("Chum The Water") || n("Haunted House")) {
    turns.push("Turn 3: Engine spell into a slot if the board is stable. Skip it if you would die to face.");
  } else {
    turns.push("Turn 3: Keep developing. Attack into Taunts only if Haunt/draw pays you, or if you can kill-gate the body.");
  }
  turns.push("Turns 4–6: Cash the engine (Boogie, doubled Play, Atlas ticks, Scheme burn). Use removal on their Icy / Taunt / engine.");
  if (avg <= 2.4) turns.push("Close by turn 7–8. Past that, Control Frost Lock / Black Hole / Atlas will outscale you.");
  else turns.push("You win the long game. Do not race Haunt burst — armor up, wipe, then the passive clock.");

  /* Matchups */
  const matchups = (build.vsNotes || []).length
    ? build.vsNotes.map((n) => {
        const m = String(n).match(/^vs\s+([^:]+):\s*(.*)$/i);
        return m ? { vs: m[1], text: m[2] } : { vs: "Note", text: n };
      })
    : [
    {
      vs: "Haunt aggro (Pirate/Zombie)",
      text: traps.some((t) => t.name === "Frost Lock" || t.name === "Blast")
        ? "Hold Frost Lock for their Boogie/Toot turn. Blast reflects face Haunts. Icy blanks a lot of their clock."
        : "You are the beatdown or you lose. Ignore their hero until Taunts are gone unless Venom/Poison is live. Watch Frost Lock — it fakes you out of lethal.",
    },
    {
      vs: "Crown engine",
      text: n("Typhoon") || n("Hunter")
        ? "Kill Meditation/Garden/Scheme in the slot. Bounce or kill Goji. Do not let Atlas sit next to Goji."
        : "Race or lock. Black Hole / Landmine reset their engines. If you are slow, you lose to 14–21 Atlas turns.",
    },
    {
      vs: "Bow Garden",
      text: "Garden in a slot is the card. Typhoon/Hunter it. Do not let Aria resolve under Garden (14). Mini on 1 means Love Shot is 4.",
    },
    {
      vs: "Wizard traps",
      text: "Play around Ambush (do not swing the only attacker). Hold a spell vs Counterspell. Frost Lock means your burst lethal is a trap — chip or wait.",
    },
  ];

  mistakes.push("Attacking a creature you cannot kill (ATK < HP) unless Poison/Venom/stacking attackers.");
  mistakes.push("Hitting face into Taunt.");
  if (rows.some((r) => r.keyword === "Rush" || /rush/i.test(r.text))) {
    mistakes.push("Expecting Rush to hit the hero the turn it enters — it cannot.");
  }
  if (heroes.length > 1) {
    mistakes.push(`Queueing the mix without setting class to ${build.hero}, then wondering why ${build.splash?.join("/")} cards are missing.`);
  }

  return {
    thesis: build.why,
    setup,
    turns,
    combos,
    sequencing,
    matchups,
    mistakes,
  };
}

const CARD_NAME_SOFT = new Set([
  "skip", "boost", "bark", "stone", "bone", "chart", "doom", "flame", "intel", "cull", "feast", "swipe",
]);

let cardNameList = null;

function cardNameIndex() {
  if (cardNameList) return cardNameList;
  const seen = new Map();
  for (const c of (window.DDL && window.DDL.cards) || []) {
    if (c && c.name && c.id) seen.set(c.name.toLowerCase(), c);
  }
  const aliases = { venom: "Snake Venom", chum: "Chum The Water", house: "Haunted House" };
  for (const [alias, name] of Object.entries(aliases)) {
    const card = seen.get(name.toLowerCase());
    if (card) seen.set(alias, card);
  }
  cardNameList = [...seen.entries()]
    .map(([key, card]) => ({ key, card }))
    .sort((a, b) => b.key.length - a.key.length);
  return cardNameList;
}

function isWordChar(ch) {
  return ch != null && /[A-Za-z0-9]/.test(ch);
}

function linkCardNames(text) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const escaped = raw.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const names = cardNameIndex();
  if (!names.length) return escaped;
  const lower = escaped.toLowerCase();
  const taken = new Uint8Array(escaped.length);
  const hits = [];
  for (const { key, card } of names) {
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(key, from);
      if (i < 0) break;
      const end = i + key.length;
      from = i + 1;
      if (i > 0 && isWordChar(escaped[i - 1])) continue;
      if (end < escaped.length && isWordChar(escaped[end])) continue;
      let overlap = false;
      for (let k = i; k < end; k++) if (taken[k]) { overlap = true; break; }
      if (overlap) continue;
      if (CARD_NAME_SOFT.has(key)) {
        const after = escaped.slice(end, end + 8).toLowerCase();
        if (/^(ed\b|ing\b|s\b| it\b| the\b| a\b| to\b| this\b| that\b| mode\b)/.test(after)) continue;
      }
      for (let k = i; k < end; k++) taken[k] = 1;
      hits.push({ i, end, card, label: escaped.slice(i, end) });
    }
  }
  hits.sort((a, b) => a.i - b.i);
  let out = "";
  let cursor = 0;
  for (const h of hits) {
    out += escaped.slice(cursor, h.i);
    out += `<span class="card-ref" role="button" tabindex="0" data-peek="${h.card.id}" style="color:#e8b84a;-webkit-text-fill-color:#e8b84a;font-weight:800;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:0.15em;cursor:help">${h.label}</span>`;
    cursor = h.end;
  }
  return out + escaped.slice(cursor);
}

function renderPlayManual(man) {
  return `<section class="manual">
    <h3>How this list wins</h3>
    <p class="lede peek-hint">Gold names are cards — hover or tap one to see the picture and text.</p>
    <p>${linkCardNames(man.thesis)}</p>
    <h4>Where to put things</h4>
    <ul>${man.setup.map((s) => `<li>${linkCardNames(s)}</li>`).join("")}</ul>
    <h4>What to do each turn</h4>
    <ol>${man.turns.map((s) => `<li>${linkCardNames(s)}</li>`).join("")}</ol>
    <h4>Combos in this list</h4>
    ${man.combos.length ? man.combos.map((c) => `<article class="combo"><h5>${linkCardNames(c.title)}</h5><p>${linkCardNames(c.body)}</p></article>`).join("") : "<p class='lede'>This one is about curve and trades. Play to the class pairing you picked.</p>"}
    <h4>Play these in this order</h4>
    <ul>${man.sequencing.map((s) => `<li>${linkCardNames(s)}</li>`).join("")}</ul>
    <h4>If they are playing…</h4>
    ${man.matchups.map((m) => `<div class="matchup"><b>vs ${linkCardNames(m.vs)}</b><p>${linkCardNames(m.text)}</p></div>`).join("")}
    <h4>Easy mistakes</h4>
    <ul>${man.mistakes.map((s) => `<li>${linkCardNames(s)}</li>`).join("")}</ul>
  </section>`;
}
