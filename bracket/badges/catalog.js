(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DDL_BADGES = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ART_BASE = '/bracket/badges';
  const ART_VER = 'cut2';

  const CLASSES = [
    {
      id: 'Crown',
      icon: 'class-crown',
      slug: 'class-crown',
      title: 'Crown',
      blurb: 'Podium finish with Crown in an official DDL Legends arena.',
      motif: 'gold',
      file: 'class-crown.png',
    },
    {
      id: 'Bow',
      icon: 'class-bow',
      slug: 'class-bow',
      title: 'Bow',
      blurb: 'Podium finish with Bow in an official DDL Legends arena.',
      motif: 'verdant',
      file: 'class-bow.png',
    },
    {
      id: 'Wizard',
      icon: 'class-wizard',
      slug: 'class-wizard',
      title: 'Wizard',
      blurb: 'Podium finish with Wizard in an official DDL Legends arena.',
      motif: 'ember',
      file: 'class-wizard.png',
    },
    {
      id: 'Zombie',
      icon: 'class-zombie',
      slug: 'class-zombie',
      title: 'Zombie',
      blurb: 'Podium finish with Zombie in an official DDL Legends arena.',
      motif: 'verdant',
      file: 'class-zombie.png',
    },
    {
      id: 'Pirate',
      icon: 'class-pirate',
      slug: 'class-pirate',
      title: 'Pirate',
      blurb: 'Podium finish with Pirate in an official DDL Legends arena.',
      motif: 'ember',
      file: 'class-pirate.png',
    },
    {
      id: 'Neutral',
      icon: 'class-neutral',
      slug: 'class-neutral',
      title: 'Neutral',
      blurb: 'Podium finish with Neutral in an official DDL Legends arena.',
      motif: 'cream',
      file: 'class-neutral.png',
    },
  ];

  const UNDECLARED = 'Undeclared';
  const SPLIT = 'Split';
  const DEFAULT_CLASS = UNDECLARED;
  const UNDECLARED_ALIASES = [
    '', 'undeclared', 'undisclosed', 'unlisted', 'private', 'none', 'n/a', 'na',
    'pass', 'skip', 'off the sheet', 'keep off the sheet',
  ];

  const REGISTRATION = [
    {
      id: UNDECLARED,
      title: 'Undeclared',
      blurb: 'Keep the class off the public sheet.',
      kind: 'undeclared',
    },
  ].concat(CLASSES.map((item) => Object.assign({}, item, { kind: 'hero' }))).concat([
    {
      id: SPLIT,
      title: 'Split',
      blurb: 'Two classes in one deck.',
      kind: 'split',
    },
  ]);

  const STANDINGS = [
    {
      place: 1,
      icon: 'standing-1st',
      slug: 'standing-1st',
      title: 'Champion',
      kicker: 'Champion',
      ribbon: '1ST',
      blurb: 'Won 1st place in an official DDL Legends arena.',
      motif: 'gold',
      file: 'standing-1st.png',
    },
    {
      place: 2,
      icon: 'standing-2nd',
      slug: 'standing-2nd',
      title: 'Silver',
      kicker: 'Silver',
      ribbon: '2ND',
      blurb: 'Finished 2nd in an official DDL Legends arena.',
      motif: 'cream',
      file: 'standing-2nd.png',
    },
    {
      place: 3,
      icon: 'standing-3rd',
      slug: 'standing-3rd',
      title: 'Bronze',
      kicker: 'Bronze',
      ribbon: '3RD',
      blurb: 'Finished 3rd in an official DDL Legends arena.',
      motif: 'copper',
      file: 'standing-3rd.png',
    },
    {
      place: 4,
      icon: 'standing-4th',
      slug: 'standing-4th',
      title: 'Top Four',
      kicker: 'Top Four',
      ribbon: '4TH',
      blurb: 'Finished 4th in an official DDL Legends arena.',
      motif: 'cream',
      file: 'standing-4th.png',
    },
    {
      place: 5,
      icon: 'standing-5th',
      slug: 'standing-5th',
      title: 'Top Five',
      kicker: 'Top Five',
      ribbon: '5TH',
      blurb: 'Finished 5th in an official DDL Legends arena.',
      motif: 'copper',
      file: 'standing-5th.png',
    },
  ];

  const CLASS_IDS = CLASSES.map((c) => c.id);
  const CLASS_ICONS = CLASSES.map((c) => c.icon);
  const STANDING_ICONS = STANDINGS.map((s) => s.icon);
  const ART_ICONS = CLASS_ICONS.concat(STANDING_ICONS);
  const BY_ICON = {};
  const BY_SLUG = {};
  const BY_CLASS = {};
  const BY_PLACE = {};

  function index(item) {
    BY_ICON[item.icon] = item;
    BY_SLUG[item.slug] = item;
  }
  CLASSES.forEach((item) => {
    index(item);
    BY_CLASS[item.id.toLowerCase()] = item;
  });
  STANDINGS.forEach((item) => {
    index(item);
    BY_PLACE[item.place] = item;
  });

  function canonHero(value) {
    const hit = BY_CLASS[String(value || '').trim().toLowerCase()];
    return hit ? hit.id : '';
  }

  function parseClass(value) {
    const raw = String(value == null ? '' : value).trim();
    const lower = raw.toLowerCase();
    if (UNDECLARED_ALIASES.indexOf(lower) !== -1) {
      return { kind: 'undeclared', ids: [], label: UNDECLARED, stored: UNDECLARED };
    }
    const stripped = raw.replace(/^split\s*[:\-–]\s*/i, '');
    const bits = stripped.split(/[/+,|&]+/).map((part) => part.trim()).filter(Boolean);
    const heroes = [];
    for (let i = 0; i < bits.length; i++) {
      if (/^split$/i.test(bits[i])) continue;
      const id = canonHero(bits[i]);
      if (id && heroes.indexOf(id) === -1) heroes.push(id);
    }
    if (/^split$/i.test(raw) || /^split\s*[:\-–]/i.test(raw)) {
      if (heroes.length >= 2) {
        return { kind: 'split', ids: heroes.slice(0, 2), label: heroes.slice(0, 2).join(' / '), stored: heroes.slice(0, 2).join('/') };
      }
      if (heroes.length === 1) {
        return { kind: 'hero', ids: heroes, label: heroes[0], stored: heroes[0] };
      }
      return { kind: 'split', ids: [], label: SPLIT, stored: SPLIT };
    }
    if (heroes.length >= 2) {
      return { kind: 'split', ids: heroes.slice(0, 2), label: heroes.slice(0, 2).join(' / '), stored: heroes.slice(0, 2).join('/') };
    }
    if (heroes.length === 1) {
      return { kind: 'hero', ids: heroes, label: heroes[0], stored: heroes[0] };
    }
    return { kind: 'undeclared', ids: [], label: UNDECLARED, stored: UNDECLARED };
  }

  function normalizeClass(value) {
    return parseClass(value).stored;
  }

  function classLabel(value) {
    const parsed = parseClass(value);
    return parsed.kind === 'undeclared' ? '' : parsed.label;
  }

  function classSpecsFor(value) {
    return parseClass(value).ids.map((id) => BY_CLASS[id.toLowerCase()]).filter(Boolean);
  }

  function specFor(badge) {
    if (!badge) return null;
    return BY_ICON[badge.icon] || BY_SLUG[badge.slug] || BY_CLASS[String(badge.id || badge.title || '').toLowerCase()] || null;
  }

  function artSrc(item) {
    if (!item || !item.file) return '';
    return `${ART_BASE}/${item.file}?v=${ART_VER}`;
  }

  function artFor(badge) {
    return artSrc(specFor(badge));
  }

  function classSpec(value) {
    const parsed = parseClass(value);
    if (parsed.kind !== 'hero' || parsed.ids.length !== 1) return null;
    return BY_CLASS[parsed.ids[0].toLowerCase()] || null;
  }

  function standingSpec(place) {
    return BY_PLACE[Number(place)] || null;
  }

  function systemBadges() {
    return CLASSES.concat(STANDINGS).map((item) => ({
      slug: item.slug,
      title: item.title,
      blurb: item.blurb,
      icon: item.icon,
      motif: item.motif,
      kind: item.place ? 'standing' : 'class',
    }));
  }

  return {
    ART_BASE,
    CLASSES,
    STANDINGS,
    REGISTRATION,
    CLASS_IDS,
    ART_ICONS,
    CLASS_ICONS,
    STANDING_ICONS,
    UNDECLARED,
    SPLIT,
    DEFAULT_CLASS,
    parseClass,
    normalizeClass,
    classLabel,
    classSpecsFor,
    specFor,
    artSrc,
    artFor,
    classSpec,
    standingSpec,
    systemBadges,
  };
});
