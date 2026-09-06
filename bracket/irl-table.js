/**
 * Doginal Dogs Legends IRL table: two hand cams, synced 40 HP,
 * turn-counted crystals (T1 = 1, cap 10, leftover lost), used-mana pips,
 * second-player Coin (+1 once), gold Legends playmat overlay.
 */
(function (global) {
  const START_LIFE = 40;
  const LIFE_MAX = 40;
  const MANA_MAX = 10;

  function emptyClock() {
    return {
      seq: 0,
      first: 0,
      active: 0,
      started: false,
      flipping: false,
      turns: { 1: 0, 2: 0 },
      used: { 1: 0, 2: 0 },
      coinArmed: false,
      coinSpent: false,
    };
  }

  function crystalsOf(clock, n) {
    return Math.min(MANA_MAX, Math.max(0, Number(clock.turns[n]) || 0));
  }

  function secondOf(clock) {
    if (clock.first !== 1 && clock.first !== 2) return 0;
    return clock.first === 1 ? 2 : 1;
  }

  function availableOf(clock, n) {
    if (!clock.started || clock.active !== n) return 0;
    let value = crystalsOf(clock, n);
    if (n === secondOf(clock) && clock.coinArmed) value += 1;
    return value;
  }

  function clockWire(clock) {
    return {
      seq: clock.seq,
      first: clock.first,
      active: clock.active,
      started: clock.started,
      flipping: Boolean(clock.flipping) && !clock.started,
      turns: { 1: clock.turns[1] || 0, 2: clock.turns[2] || 0 },
      used: { 1: clock.used[1] || 0, 2: clock.used[2] || 0 },
      coinArmed: Boolean(clock.coinArmed),
      coinSpent: Boolean(clock.coinSpent),
    };
  }

  function hudMeta(clock, n, mine) {
    const crystals = crystalsOf(clock, n);
    const available = availableOf(clock, n);
    const used = available ? clamp(clock.used[n] || 0, 0, available) : 0;
    const wentSecond = Boolean(clock.started && n === secondOf(clock));
    const coinArmed = Boolean(clock.coinArmed && clock.active === n);
    const hasCoin = wentSecond && !clock.coinSpent;
    const active = Boolean(clock.started && clock.active === n);
    return {
      crystals,
      available,
      used,
      started: Boolean(clock.started),
      turnN: clock.turns[n] || 0,
      active,
      canPass: Boolean(mine && active),
      canSpend: Boolean(mine && active),
      canCoin: Boolean(mine && active && hasCoin),
      hasCoin: Boolean(hasCoin && !coinArmed),
      coinArmed,
      coinSpent: Boolean(clock.coinSpent),
      wentSecond,
    };
  }

  function clockBarHtml(clock, names, mine) {
    const seated = mine === 1 || mine === 2;
    if (!clock.started) {
      const flipping = Boolean(clock.flipping);
      return `<div class="irl-clock">
        <p class="irl-clock-title">Coin flip for first</p>
        <p class="muted">A fair flip chooses who starts. Turn 1 is 1 crystal, then +1 each of your turns, cap 10. Passing dumps leftover mana. Second player may spend the Coin once (+1).</p>
        <div class="irl-coin-flip">
          <span class="irl-coin-disc${flipping ? ' is-spin' : ''}" aria-hidden="true">DDL</span>
          <button type="button" class="btn" data-coin-flip ${seated && !flipping ? '' : 'disabled'}>${flipping ? 'Flipping…' : 'Flip the coin'}</button>
        </div>
      </div>`;
    }
    const activeName = names[clock.active] || 'Seat';
    const turnN = clock.turns[clock.active] || 0;
    const secondName = names[secondOf(clock)] || 'Second';
    const coinNote = clock.coinArmed
      ? 'Coin live this turn · +1'
      : clock.coinSpent
        ? 'Coin already spent'
        : `${secondName} holds the Coin`;
    return `<div class="irl-clock is-live">
      <div class="irl-clock-row">
        <p class="irl-clock-title">Turn ${turnN} · ${esc(activeName)}</p>
        ${seated ? '<button type="button" class="btn ghost irl-clock-reset" data-clock-reset>Reset turns</button>' : ''}
      </div>
      <p class="muted">${esc(names[1])} T${clock.turns[1] || 0} · ${crystalsOf(clock, 1)} cr · ${esc(names[2])} T${clock.turns[2] || 0} · ${crystalsOf(clock, 2)} cr</p>
      <p class="muted">${esc(coinNote)}</p>
    </div>`;
  }

  function parseClock(raw) {
    const next = emptyClock();
    if (!raw || typeof raw !== 'object') return next;
    next.seq = Math.max(0, Number(raw.seq) || 0);
    next.first = raw.first === 2 ? 2 : raw.first === 1 ? 1 : 0;
    next.active = raw.active === 2 ? 2 : raw.active === 1 ? 1 : 0;
    next.started = Boolean(raw.started) && Boolean(next.first);
    next.flipping = Boolean(raw.flipping) && !next.started;
    const t1 = Math.max(0, Number(raw.turns && raw.turns[1]) || 0);
    const t2 = Math.max(0, Number(raw.turns && raw.turns[2]) || 0);
    next.turns = { 1: t1, 2: t2 };
    next.coinArmed = Boolean(raw.coinArmed);
    next.coinSpent = Boolean(raw.coinSpent);
    next.used = {
      1: clamp(Number(raw.used && raw.used[1]) || 0, 0, availableOf(next, 1)),
      2: clamp(Number(raw.used && raw.used[2]) || 0, 0, availableOf(next, 2)),
    };
    return next;
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 1.8;
  const ZOOM_STORE = 'ddl-irl-cam-zoom';

  function readStoredZoom() {
    try {
      const n = Number(localStorage.getItem(ZOOM_STORE));
      if (Number.isFinite(n)) return clamp(Math.max(1, n), ZOOM_MIN, ZOOM_MAX);
    } catch (_err) {}
    return 1;
  }

  function writeStoredZoom(value) {
    try { localStorage.setItem(ZOOM_STORE, String(value)); } catch (_err) {}
  }

  function cameraPolicyBlocked() {
    try {
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (policy && typeof policy.allowsFeature === 'function') {
        return policy.allowsFeature('camera') === false;
      }
    } catch (_err) {}
    return false;
  }

  function camErrorText(err) {
    const name = err && err.name ? String(err.name) : '';
    const msg = err && err.message ? String(err.message) : '';
    const blob = `${name} ${msg}`.toLowerCase();
    if (!window.isSecureContext) {
      return 'Camera needs HTTPS. Open this table from the live tourney link, not a download or file.';
    }
    if (cameraPolicyBlocked() || name === 'SecurityError' || blob.includes('permissions policy') || blob.includes('permission policy')) {
      return 'This page is still blocking the camera in site policy, so Chrome will not pop up Allow. The padlock setting cannot override that. Refresh this table after the tourney camera policy is updated, then tap Allow camera.';
    }
    if (!getUserMediaFn()) {
      return 'This browser cannot open the camera. On iPhone use Safari (not Discord/Instagram). On Android use Chrome.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera found. Plug one in or let this page see devices, then try again.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Camera is already in use by another app. Close that, then try again.';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return 'This camera refused the rear-cam request. Try again, or use another camera.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera is blocked for this site. Tap Allow on the browser popup. If you already hit Block, tap the lock or camera icon in the address bar, set Camera to Allow, then try again.';
    }
    return 'Camera did not start. When the browser pops up, tap Allow, then try again.';
  }

  function getUserMediaFn() {
    const devices = navigator.mediaDevices;
    if (devices && typeof devices.getUserMedia === 'function') {
      return (constraints) => devices.getUserMedia(constraints);
    }
    const legacy = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;
    if (!legacy) return null;
    return (constraints) => new Promise((resolve, reject) => {
      legacy.call(navigator, constraints, resolve, reject);
    });
  }

  function isPhoneCam() {
    const ua = String(navigator.userAgent || '');
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
  }

  function prepareVideoEl(video) {
    if (!video) return;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch (_err) {}
    });
  }

  function camTrack(stream) {
    return stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] : null;
  }

  function scoreCamLabel(label) {
    const s = String(label || '').toLowerCase();
    let n = 0;
    if (/front|user|face|selfie|true[- ]?depth/.test(s)) n -= 10;
    if (/back|rear|environment|facing back/.test(s)) n += 2;
    if (/tele|telephoto/.test(s)) n -= 6;
    if (/ultra[\s-]?wide|ultrawide|\buw\b|0[\.,]5\s*x|\.5x/.test(s)) n += 8;
    else if (/\bwide\b/.test(s)) n += 4;
    return n;
  }

  function trackFacing(track) {
    try {
      const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
      return String(settings.facingMode || '');
    } catch (_err) {
      return '';
    }
  }

  function trackDeviceId(track) {
    try {
      const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
      return String(settings.deviceId || '');
    } catch (_err) {
      return '';
    }
  }

  function hardwareZoomMin(track) {
    try {
      if (!track || typeof track.getCapabilities !== 'function') return null;
      const caps = track.getCapabilities() || {};
      const zoom = caps.zoom;
      if (!zoom || !Number.isFinite(Number(zoom.min))) return null;
      return Number(zoom.min);
    } catch (_err) {
      return null;
    }
  }

  async function applyWidestHardwareZoom(stream) {
    const track = camTrack(stream);
    if (!track || typeof track.applyConstraints !== 'function') return;
    const minZ = hardwareZoomMin(track);
    if (minZ == null) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: minZ }] });
    } catch (_err) {
      try {
        await track.applyConstraints({ zoom: minZ });
      } catch (_e) {}
    }
  }

  function isFrontCam(track) {
    const facing = trackFacing(track);
    if (facing === 'user') return true;
    if (facing === 'environment') return false;
    return scoreCamLabel(track && track.label) <= -8;
  }

  async function switchToWidestLens(gum, stream) {
    const cur = camTrack(stream);
    if (isFrontCam(cur)) {
      try {
        const rear = await gum({ audio: false, video: { facingMode: { exact: 'environment' } } });
        stopStream(stream);
        stream = rear;
      } catch (_err) {
        try {
          const rear = await gum({ audio: false, video: { facingMode: { ideal: 'environment' } } });
          stopStream(stream);
          stream = rear;
        } catch (_e) {}
      }
    }

    await applyWidestHardwareZoom(stream);

    let list = [];
    try {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
        list = await navigator.mediaDevices.enumerateDevices();
      }
    } catch (_err) {
      return stream;
    }
    const cams = list.filter((device) => device.kind === 'videoinput' && device.deviceId);
    if (!cams.length) return stream;

    const curTrack = camTrack(stream);
    const curId = trackDeviceId(curTrack);
    const ranked = cams
      .map((cam) => ({ cam, score: scoreCamLabel(cam.label) }))
      .sort((a, b) => b.score - a.score);
    const bestLabeled = ranked[0];

    async function openById(deviceId) {
      return gum({
        audio: false,
        video: { deviceId: { exact: deviceId } },
      });
    }

    if (bestLabeled && bestLabeled.score >= 8 && bestLabeled.cam.deviceId !== curId) {
      try {
        const next = await openById(bestLabeled.cam.deviceId);
        stopStream(stream);
        await applyWidestHardwareZoom(next);
        return next;
      } catch (_err) {}
    }

    if (cams.length < 2) return stream;

    let best = { stream, zoomMin: hardwareZoomMin(curTrack) };
    if (best.zoomMin == null) best.zoomMin = 1;
    for (let i = 0; i < Math.min(cams.length, 5); i += 1) {
      const cam = cams[i];
      if (cam.deviceId === curId) continue;
      if (scoreCamLabel(cam.label) <= -8) continue;
      let probe;
      try {
        probe = await gum({ audio: false, video: { deviceId: { exact: cam.deviceId } } });
      } catch (_err) {
        continue;
      }
      const probeTrack = camTrack(probe);
      if (isFrontCam(probeTrack)) {
        stopStream(probe);
        continue;
      }
      const z = hardwareZoomMin(probeTrack);
      const zoomMin = z == null ? 1 : z;
      if (zoomMin < best.zoomMin - 0.04) {
        if (best.stream !== stream) stopStream(best.stream);
        best = { stream: probe, zoomMin };
      } else {
        stopStream(probe);
      }
    }
    if (best.stream !== stream) {
      stopStream(stream);
      stream = best.stream;
    }
    await applyWidestHardwareZoom(stream);
    return stream;
  }

  async function captureHandCam() {
    if (!window.isSecureContext) {
      const err = new Error('Camera needs a secure page.');
      err.name = 'SecurityError';
      throw err;
    }
    const gum = getUserMediaFn();
    if (!gum) {
      const err = new Error('Camera API missing.');
      err.name = 'NotFoundError';
      throw err;
    }
    const phone = isPhoneCam();
    const attempts = phone
      ? [
        { audio: false, video: true },
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
      ]
      : [
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        { audio: false, video: true },
      ];
    let lastErr;
    let stream = null;
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        stream = await gum(attempts[i]);
        break;
      } catch (err) {
        lastErr = err;
        const name = err && err.name;
        if (name === 'SecurityError') throw err;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw err;
      }
    }
    if (!stream) throw lastErr || new Error('Camera did not start.');
    try {
      return await switchToWidestLens(gum, stream);
    } catch (_err) {
      await applyWidestHardwareZoom(stream);
      return stream;
    }
  }

  function emptySeat(handle) {
    return { handle: handle || 'Seat', life: START_LIFE, mana: 0, turn: false, camLive: false, zoom: 1 };
  }

  function viewerAliases(user) {
    if (!user) return [];
    return [user.tourneyHandle, user.discordUsername, user.handle]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
  }

  function entryMatchesUser(entry, user) {
    if (!entry || !user || !user.discordId) return false;
    const uid = Number(user.id || user.userId);
    if (uid && Number(entry.userId) === uid) return true;
    if (entry.discordUser && entry.discordUser.discordId
      && String(user.discordId) === String(entry.discordUser.discordId)) return true;
    const aliases = viewerAliases(user);
    if (aliases.includes(String(entry.handle || '').trim().toLowerCase())) return true;
    const linked = entry.discordUser;
    if (linked) {
      const names = [linked.tourneyHandle, linked.discordUsername]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      if (names.some((name) => aliases.includes(name))) return true;
    }
    return false;
  }

  const LANE_TOP = [
    ['Extra', 'is-side'],
    ['Creature', ''],
    ['Creature', ''],
    ['Creature', ''],
    ['Creature', ''],
    ['Creature', ''],
    ['Banish', 'is-side'],
  ];
  const LANE_BOT = [
    ['Deck', 'is-side'],
    ['Spell / Trap', ''],
    ['Spell / Trap', ''],
    ['Spell / Trap', ''],
    ['Spell / Trap', ''],
    ['Spell / Trap', ''],
    ['GY', 'is-side'],
  ];

  function laneRowHtml(row) {
    return `<div class="lane-row">${row.map(([name, klass]) =>
      `<span class="lane-slot${klass ? ` ${klass}` : ''}"><b>${esc(name)}</b></span>`
    ).join('')}</div>`;
  }

  function laneOverlayHtml() {
    return `<div class="lane-overlay" aria-hidden="true">
      <div class="lane-board">${laneRowHtml(LANE_TOP)}${laneRowHtml(LANE_BOT)}</div>
    </div>`;
  }

  function toast(root, message, ok) {
    let el = root.querySelector('.irl-toast');
    if (!el) {
      el = document.createElement('p');
      el.className = 'irl-toast';
      root.appendChild(el);
    }
    el.hidden = false;
    el.classList.toggle('bad', !ok);
    el.textContent = message;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function camShell(kind, label, waiting) {
    return `<div class="cam-stack" data-cam="${esc(kind)}">
      <div class="hand-cam">
        <video playsinline webkit-playsinline autoplay muted></video>
        ${laneOverlayHtml()}
        <div class="cam-waiting"><span>${esc(waiting)}</span></div>
        <p class="cam-chip cam-label"></p>
        <p class="cam-chip cam-state"></p>
      </div>
      <div class="cam-zoom" data-cam-zoom hidden>
        <label class="cam-zoom-lbl">Fit <span data-zoom-val>1.00×</span></label>
        <input type="range" data-zoom min="100" max="180" step="1" value="100" aria-label="Camera zoom">
        <button type="button" class="mini" data-overlay-toggle>Hide mat</button>
        <button type="button" class="mini" data-zoom-reset>Reset</button>
      </div>
    </div>`;
  }

  function hudHtml(seatHud, mine, handsHint, meta) {
    const low = seatHud.life <= 5;
    const dead = seatHud.life <= 0;
    const crystals = meta.crystals;
    const avail = meta.available;
    const used = meta.used;
    const left = Math.max(0, avail - used);
    const pipCount = Math.max(avail, crystals);
    const pips = Array.from({ length: pipCount }, (_, i) => {
      const n = i + 1;
      const on = n <= used;
      const coin = meta.coinArmed && n === avail && avail === crystals + 1;
      if (mine && meta.canSpend) {
        return `<button type="button" class="mana-pip${on ? ' on' : ''}${coin ? ' coin' : ''}" data-mana="${n}" aria-label="Used mana ${n}"></button>`;
      }
      return `<i class="mana-dot${on ? ' on' : ''}${coin ? ' coin' : ''}"></i>`;
    }).join('');
    const lifeBtns = mine
      ? `<div class="life-btns">${[-5, -1, 1, 5].map((d) => `<button type="button" class="mini" data-life="${d}">${d > 0 ? `+${d}` : d}</button>`).join('')}</div>`
      : '';
    let turnBtn = '';
    if (meta.started) {
      if (mine && meta.canPass) {
        turnBtn = `<button type="button" class="btn irl-turn" data-turn="1">Pass turn</button>`;
      } else if (meta.active) {
        turnBtn = `<p class="irl-active">Active</p>`;
      } else if (mine) {
        turnBtn = `<p class="irl-active is-wait">Waiting</p>`;
      }
    }
    let coinBtn = '';
    if (mine && meta.canCoin) {
      coinBtn = `<button type="button" class="btn ghost irl-coin" data-coin="1">Spend Coin (+1)</button>`;
    } else if (meta.coinArmed) {
      coinBtn = `<p class="irl-coin-live">Coin live · +1 this turn</p>`;
    } else if (meta.hasCoin) {
      coinBtn = `<p class="muted irl-coin-live">Coin ready · +1 once</p>`;
    } else if (meta.wentSecond && meta.coinSpent) {
      coinBtn = `<p class="muted irl-coin-live">Coin spent</p>`;
    }
    const camTag = seatHud.camLive ? 'Cam live' : 'No cam';
    const turnLabel = meta.started ? `T${meta.turnN}` : 'T—';
    return `<div class="hearth-hud${meta.active ? ' is-turn' : ''}${dead ? ' is-dead' : ''}">
      <div class="hud-top">
        <p class="hud-name">${esc(seatHud.handle)} <span class="hud-turn">${esc(turnLabel)}</span></p>
        <span class="hud-tag">${esc(handsHint || camTag)}</span>
      </div>
      <div class="hud-meters">
        <div>
          <p class="hud-kicker">Health</p>
          <p class="hud-life${dead ? ' dead' : low ? ' low' : ''}">${seatHud.life}</p>
          ${lifeBtns}
        </div>
        <div>
          <p class="hud-kicker">${meta.started
            ? (meta.active
              ? `Mana this turn · ${avail}${meta.coinArmed ? ' + Coin' : ''}`
              : `Mana empty · next ${Math.min(MANA_MAX, Math.max(1, (meta.turnN || 0) + 1))}`)
            : 'Mana · starts on your turn'}</p>
          <p class="hud-mana">${left}<small>${meta.active ? `left of ${avail}` : 'until your turn'}</small></p>
          <div class="mana-row">${mine && meta.canSpend ? `<button type="button" class="mana-zero${used === 0 ? ' on' : ''}" data-mana="0" aria-label="Used mana 0">0</button>` : ''}${pips}</div>
        </div>
      </div>
      ${coinBtn}
      ${turnBtn}
    </div>`;
  }

  function bindCam(el, stream, muted, zoom) {
    const video = el.querySelector('video');
    const waiting = el.querySelector('.cam-waiting');
    el.classList.toggle('is-live', Boolean(stream));
    el.style.setProperty('--cam-zoom', String(Number.isFinite(zoom) ? Math.max(1, zoom) : 1));
    if (waiting) waiting.hidden = Boolean(stream);
    if (!video) return;
    prepareVideoEl(video);
    if (video.srcObject !== stream) video.srcObject = stream || null;
    if (stream) void video.play().catch(() => {});
  }

  function mount(root, opts) {
    const player1 = opts.player1 || null;
    const player2 = opts.player2 || null;
    const tableId = String(opts.tableId || 'table');
    const discordHref = opts.discordHref || '/kmx-auth/discord/start?return=/tourney/';
    const storageKey = `ddl-irl-${tableId}`;
    const room = `irl${String(tableId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`;

    function canSit(n) {
      if (n !== 1 && n !== 2) return false;
      return entryMatchesUser(n === 1 ? player1 : player2, opts.viewer);
    }

    function resolveSeat() {
      const saved = sessionStorage.getItem(storageKey);
      if (saved === '0') return 0;
      if (saved === '1' || saved === '2') {
        const n = Number(saved);
        if (canSit(n)) return n;
      }
      if (canSit(1) && !canSit(2)) return 1;
      if (canSit(2) && !canSit(1)) return 2;
      return null;
    }

    let seat = resolveSeat();
    let live = null;

    function pick(next) {
      if (next === 1 || next === 2) {
        if (!canSit(next)) return;
      }
      sessionStorage.setItem(storageKey, String(next));
      seat = next;
      if (live) {
        live.close();
        live = null;
      }
      paint();
    }

    function paintPicker() {
      const signedIn = Boolean(opts.viewer && opts.viewer.discordId);
      const viewerName = signedIn
        ? (opts.viewer.tourneyHandle || opts.viewer.discordUsername || 'Discord')
        : '';
      const sit1 = canSit(1);
      const sit2 = canSit(2);
      let gate = 'Sign in with Discord as a listed player to sit. Anyone can watch.';
      if (signedIn && !sit1 && !sit2) {
        gate = `You're signed in as ${viewerName}. This table is for the listed players — watch as spectator.`;
      } else if (signedIn) {
        gate = `Signed in as ${viewerName}. Sit only in your listed seat. Anyone else can watch.`;
      }
      root.innerHTML = `<div class="irl-page">
        <p class="irl-crumb">${opts.backHref ? `<a href="${esc(opts.backHref)}">${esc(opts.eventName || 'Bracket')}</a>` : `<span>${esc(opts.eventName || 'Doginal Dogs Legends')}</span>`}<span> / </span><span>Verified table</span></p>
        <h1>${esc(player1 && player1.handle ? player1.handle : 'TBD')} <span class="muted">vs</span> ${esc(player2 && player2.handle ? player2.handle : 'TBD')}</h1>
        <p class="muted">Point the rear camera at your physical hand. Health starts at 40. Mana follows the rules: turn 1 is 1 crystal, cap 10, leftover is lost at pass. Going second gets the Coin once (+1). Both live cameras on a direct link mark the table verified.</p>
        <div class="irl-card">
          <p class="muted">${esc(gate)}</p>
          ${signedIn ? '' : `<p class="irl-seat-grid"><a class="btn" href="${esc(discordHref)}">Sign in with Discord to sit</a></p>`}
          <div class="irl-seat-grid">
            <button type="button" class="btn" data-seat="1" ${sit1 ? '' : 'disabled'}>Sit as ${esc(player1 && player1.handle ? player1.handle : 'Seat 1')}</button>
            <button type="button" class="btn ghost" data-seat="2" ${sit2 ? '' : 'disabled'}>Sit as ${esc(player2 && player2.handle ? player2.handle : 'Seat 2')}</button>
          </div>
          <button type="button" class="btn ghost irl-watch" data-seat="0">Watch as spectator</button>
        </div>
        <p class="irl-toast" hidden></p>
      </div>`;
      root.querySelectorAll('[data-seat]').forEach((btn) => {
        btn.onclick = () => pick(Number(btn.getAttribute('data-seat')));
      });
    }

    function startLive(options) {
      if ((seat === 1 || seat === 2) && !canSit(seat)) {
        seat = null;
        sessionStorage.removeItem(storageKey);
        paintPicker();
        return { close() {} };
      }
      const myHandle = seat === 1
        ? (player1 && player1.handle) || 'Seat 1'
        : seat === 2
          ? (player2 && player2.handle) || 'Seat 2'
          : 'Spectator';

      const selfId = `p-${Math.random().toString(36).slice(2, 10)}`;
      let localHud = emptySeat(myHandle);
      let clock = emptyClock();
      const remoteHud = { 1: null, 2: null };
      const peerSeat = new Map();
      const streamsByPeer = new Map();
      let localStream = null;
      let camZoom = readStoredZoom();
      let camError = '';
      let camModalOpen = seat === 1 || seat === 2;
      let camBusy = false;
      let busy = false;
      let scoreDraft = { 1: '', 2: '' };
      let flipTimer = 0;
      let joined = false;
      let peers = [];
      const P2PRoom = global.DdlP2PRoom;
      if (!P2PRoom) {
        root.innerHTML = `<p class="err">Table scripts failed to load. Upload bracket/irl-p2p.js.</p>`;
        return { close() {} };
      }

      function handleName(n) {
        if (n === 1) return (player1 && player1.handle) || 'Seat 1';
        if (n === 2) return (player2 && player2.handle) || 'Seat 2';
        return 'Seat';
      }

      function syncLocalFromClock() {
        if (seat !== 1 && seat !== 2) return;
        localHud = {
          ...localHud,
          mana: clock.used[seat] || 0,
          turn: Boolean(clock.started && clock.active === seat),
        };
      }

      function adoptClock(raw) {
        const next = parseClock(raw);
        if (next.seq < clock.seq) return false;
        clock = next;
        syncLocalFromClock();
        return true;
      }

      let paintTimer = 0;
      function schedulePaint() {
        if (paintTimer) return;
        paintTimer = requestAnimationFrame(() => {
          paintTimer = 0;
          renderChrome();
        });
      }

      const p2p = new P2PRoom({
        room,
        selfId,
        name: myHandle,
        seat: seat === 1 || seat === 2 ? seat : 0,
        onJoinError: (err) => {
          const message = err && err.message ? err.message : 'Could not join the table.';
          toast(root, message, false);
          if (seat !== 1 && seat !== 2) return;
          sessionStorage.removeItem(storageKey);
          setTimeout(() => {
            seat = null;
            if (live) {
              try { live.close(); } catch (_err) {}
              live = null;
            }
            paint();
          }, 0);
        },
        onPeersChanged: (list) => {
          peers = list;
          if (joined) emitHello();
          schedulePaint();
        },
        onTrack: (from, stream) => {
          streamsByPeer.set(from, stream);
          schedulePaint();
        },
        onMessage: (_from, data) => {
          const msg = data;
          if (!msg || typeof msg !== 'object') return;
          const claimed = p2p.seatOf(_from);
          if (msg.k === 'clock') {
            if (claimed !== 1 && claimed !== 2) return;
            if (adoptClock(msg.clock || msg)) renderChrome();
            return;
          }
          if (msg.k !== 'hello' && msg.k !== 'hud') return;
          if (msg.seat !== 1 && msg.seat !== 2) return;
          if (claimed !== msg.seat) return;
          peerSeat.set(_from, msg.seat);
          if (msg.clock) adoptClock(msg.clock);
          const prev = remoteHud[msg.seat] || emptySeat(msg.handle || handleName(msg.seat));
          remoteHud[msg.seat] = {
            handle: msg.k === 'hello' ? (msg.handle || prev.handle) : prev.handle,
            life: Number.isFinite(msg.life) ? msg.life : prev.life,
            mana: clock.used[msg.seat] || 0,
            turn: clock.started && clock.active === msg.seat,
            camLive: Boolean(msg.cam),
            zoom: Number.isFinite(msg.zoom) ? clamp(msg.zoom, ZOOM_MIN, ZOOM_MAX) : (prev.zoom || 1),
          };
          renderChrome();
        },
        onConnected: () => {
          joined = true;
          emitHello();
          renderChrome();
        },
      });

      function emitHello(to) {
        p2p.send({
          k: 'hello',
          seat,
          handle: myHandle,
          life: localHud.life,
          mana: clock.used[seat] || 0,
          turn: Boolean(clock.started && clock.active === seat),
          cam: Boolean(localStream),
          zoom: camZoom,
          clock: clockWire(clock),
        }, to);
      }

      function emitHud(next) {
        if (seat !== 1 && seat !== 2) return;
        p2p.send({
          k: 'hud',
          seat,
          life: next.life,
          mana: clock.used[seat] || 0,
          turn: Boolean(clock.started && clock.active === seat),
          cam: next.camLive,
          zoom: camZoom,
          clock: clockWire(clock),
        });
      }

      function emitClock() {
        if (seat !== 1 && seat !== 2) return;
        p2p.send({ k: 'clock', clock: clockWire(clock) });
        emitHud(localHud);
      }

      function pushClock() {
        if (seat !== 1 && seat !== 2) return;
        clock.seq += 1;
        syncLocalFromClock();
        emitClock();
        renderChrome();
      }

      function setFirst(n) {
        if (seat !== 1 && seat !== 2) return;
        if (clock.started || (n !== 1 && n !== 2)) return;
        clock.flipping = false;
        clock.first = n;
        clock.active = n;
        clock.started = true;
        clock.turns = { 1: n === 1 ? 1 : 0, 2: n === 2 ? 1 : 0 };
        clock.used = { 1: 0, 2: 0 };
        clock.coinArmed = false;
        clock.coinSpent = false;
        pushClock();
      }

      function flipFirst() {
        if (seat !== 1 && seat !== 2) return;
        if (clock.started || clock.flipping) return;
        clock.flipping = true;
        pushClock();
        clearTimeout(flipTimer);
        flipTimer = setTimeout(() => {
          flipTimer = 0;
          if (clock.started) return;
          const buf = new Uint32Array(1);
          if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
          else buf[0] = Math.floor(Math.random() * 2);
          setFirst((buf[0] % 2) + 1);
        }, 900);
      }

      function passTurn() {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started || clock.active !== seat) return;
        const next = seat === 1 ? 2 : 1;
        clock.active = next;
        clock.turns[next] = (clock.turns[next] || 0) + 1;
        clock.used = { 1: 0, 2: 0 };
        clock.coinArmed = false;
        pushClock();
      }

      function spendCoin() {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started || clock.active !== seat) return;
        if (seat !== secondOf(clock) || clock.coinSpent) return;
        clock.coinArmed = true;
        clock.coinSpent = true;
        clock.used[seat] = clamp(clock.used[seat] || 0, 0, availableOf(clock, seat));
        pushClock();
      }

      function setUsed(n) {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started || clock.active !== seat) return;
        const avail = availableOf(clock, seat);
        let next = clamp(Number(n) || 0, 0, avail);
        if ((clock.used[seat] || 0) === next && next !== 0) next -= 1;
        clock.used[seat] = clamp(next, 0, avail);
        pushClock();
      }

      function resetClock() {
        if (seat !== 1 && seat !== 2) return;
        const seq = clock.seq;
        clock = emptyClock();
        clock.seq = seq;
        pushClock();
      }

      function patchMine(partial) {
        if (seat !== 1 && seat !== 2) return;
        localHud = { ...localHud, ...partial };
        emitHud(localHud);
        renderChrome();
      }

      function renderCamModal() {
        const mountEl = root.querySelector('[data-cam-modal]');
        if (!mountEl) return;
        const show = camModalOpen && (seat === 1 || seat === 2) && !localStream;
        mountEl.hidden = !show;
        if (!show) {
          mountEl.innerHTML = '';
          return;
        }
        const blocked = Boolean(camError);
        const body = camError
          ? esc(camError)
          : 'Tap <b>Allow camera</b>. iPhone and Android will show a system Allow/Block prompt — look at the top of the screen. Then point the rear camera at your cards.';
        mountEl.innerHTML = `<div class="irl-cam-dialog" role="dialog" aria-modal="true" aria-labelledby="irl-cam-title">
          <p class="hud-kicker">Hand cam</p>
          <h2 id="irl-cam-title">${blocked ? 'Allow camera to continue' : 'Allow camera'}</h2>
          <p>${body}</p>
          <p class="muted">Open this table in Safari (iPhone) or Chrome (Android). Discord, Instagram, and in-app browsers usually cannot start the camera.</p>
          <div class="irl-seat-grid">
            <button type="button" class="btn" data-cam-allow>${camBusy ? 'Waiting for Allow…' : blocked ? 'Try again' : 'Allow camera'}</button>
            <button type="button" class="btn ghost" data-cam-skip>Not now</button>
          </div>
        </div>`;
        const allow = mountEl.querySelector('[data-cam-allow]');
        const skip = mountEl.querySelector('[data-cam-skip]');
        if (allow) allow.onclick = () => { void enableCam(); };
        if (skip) {
          skip.onclick = () => {
            camModalOpen = false;
            renderCamModal();
          };
        }
      }

      async function enableCam() {
        if (camBusy || (seat !== 1 && seat !== 2)) return;
        camError = '';
        camBusy = true;
        const allowBtn = root.querySelector('[data-cam-allow]');
        if (allowBtn) {
          allowBtn.textContent = 'Waiting for Allow…';
          allowBtn.disabled = true;
        }
        const watchdog = setTimeout(() => {
          if (localStream || !camBusy) return;
          camBusy = false;
          camError = 'No Allow popup showed. On iPhone use Safari, on Android use Chrome — not Discord. Check the address bar, then tap Try again.';
          renderCamModal();
        }, 12000);
        try {
          const stream = await captureHandCam();
          clearTimeout(watchdog);
          localStream = stream;
          const preview = root.querySelector('.hand-cam.is-mine video')
            || root.querySelector('[data-side="bottom"] video');
          if (preview) {
            prepareVideoEl(preview);
            preview.srcObject = stream;
            void preview.play().catch(() => {});
          }
          p2p.setLocalStream(stream);
          localHud = { ...localHud, camLive: true };
          camModalOpen = false;
          camBusy = false;
          emitHud(localHud);
          renderChrome();
        } catch (err) {
          clearTimeout(watchdog);
          camBusy = false;
          camError = camErrorText(err);
          camModalOpen = true;
          renderChrome();
        }
      }

      function stopCam() {
        if (localStream) localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
        p2p.setLocalStream(null);
        localHud = { ...localHud, camLive: false };
        emitHud(localHud);
        renderChrome();
      }

      function streamForSeat(n) {
        if (n === seat) return localStream;
        for (const [peerId, s] of peerSeat) {
          if (s === n) return streamsByPeer.get(peerId) || null;
        }
        if (streamsByPeer.size === 1 && (seat === 1 || seat === 2)) {
          return [...streamsByPeer.values()][0];
        }
        return null;
      }

      function panelFor(n, mineLabel, wait) {
        const mine = n === seat;
        const hud = mine
          ? localHud
          : (remoteHud[n] || emptySeat(n === 1
            ? (player1 && player1.handle) || 'Seat 1'
            : (player2 && player2.handle) || 'Seat 2'));
        const stream = streamForSeat(n);
        return {
          n,
          mine,
          hud,
          stream,
          label: mine ? mineLabel : hud.handle,
          waiting: mine ? 'Link your hand cam' : wait,
          zoom: mine ? camZoom : clamp(Number(hud.zoom) || 1, ZOOM_MIN, ZOOM_MAX),
        };
      }

      root.innerHTML = `<div class="irl-page irl-live">
        <p class="irl-crumb">${opts.backHref ? `<a href="${esc(opts.backHref)}">${esc(opts.eventName || 'Bracket')}</a>` : `<span>${esc(opts.eventName || 'Doginal Dogs Legends')}</span>`}<span> / </span><span>Verified table</span></p>
        <div class="irl-head">
          <h1>${esc(player1 && player1.handle ? player1.handle : 'TBD')} <span class="muted">vs</span> ${esc(player2 && player2.handle ? player2.handle : 'TBD')}</h1>
          <button type="button" class="copy" data-reseat="1">Change seat</button>
        </div>
        <div class="irl-status-row">
          <span class="irl-badge" data-badge></span>
          <span class="muted mono" data-rtt hidden></span>
        </div>
        <div class="irl-clock-mount" data-clock></div>
        <p class="irl-stall" data-stall hidden>Direct link failed on this network. Stay on the page and retry the camera.</p>
        <div class="irl-actions" data-actions></div>
        <p class="err" data-cam-err hidden></p>
        <div class="irl-grid">
          <section data-side="top">
            ${camShell('top', '', '')}
            <div data-hud="top"></div>
          </section>
          <section data-side="bottom">
            ${camShell('bottom', '', '')}
            <div data-hud="bottom"></div>
          </section>
        </div>
        <div class="irl-card" data-lock></div>
        <p class="irl-toast" hidden></p>
        <div class="irl-cam-overlay" data-cam-modal hidden></div>
      </div>`;

      root.querySelector('[data-reseat]').onclick = () => {
        sessionStorage.removeItem(storageKey);
        seat = null;
        close();
        paint();
      };

      function paintLocalZoom() {
        const mineCam = root.querySelector('.hand-cam.is-mine');
        if (!mineCam) return;
        mineCam.style.setProperty('--cam-zoom', String(camZoom));
        const wrap = mineCam.closest('[data-side]') || mineCam.parentElement;
        const label = wrap.querySelector('[data-zoom-val]');
        if (label) label.textContent = `${camZoom.toFixed(2)}×`;
        const input = wrap.querySelector('[data-zoom]');
        if (input && Number(input.value) !== Math.round(camZoom * 100)) {
          input.value = String(Math.round(camZoom * 100));
        }
      }

      function setCamZoom(factor) {
        camZoom = clamp(Number(factor) || 1, ZOOM_MIN, ZOOM_MAX);
        writeStoredZoom(camZoom);
        paintLocalZoom();
        if (seat === 1 || seat === 2) emitHud(localHud);
      }

      root.querySelectorAll('[data-zoom]').forEach((input) => {
        input.value = String(Math.round(camZoom * 100));
        input.addEventListener('input', () => setCamZoom(Number(input.value) / 100));
      });
      root.querySelectorAll('[data-zoom-reset]').forEach((btn) => {
        btn.addEventListener('click', () => setCamZoom(1));
      });
      root.querySelectorAll('[data-overlay-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const wrap = btn.closest('.cam-stack');
          const cam = wrap && wrap.querySelector('.hand-cam');
          if (!cam) return;
          const off = cam.classList.toggle('is-mat-off');
          btn.textContent = off ? 'Show mat' : 'Hide mat';
        });
      });
      root.querySelectorAll('[data-zoom-val]').forEach((label) => {
        label.textContent = `${camZoom.toFixed(2)}×`;
      });
      root.querySelectorAll('.hand-cam').forEach((cam) => {
        cam.addEventListener('wheel', (ev) => {
          if (!cam.classList.contains('is-mine')) return;
          const wrap = cam.closest('[data-side]') || cam.parentElement;
          const dock = wrap.querySelector('[data-cam-zoom]');
          if (!dock || dock.hidden) return;
          ev.preventDefault();
          setCamZoom(camZoom + (ev.deltaY < 0 ? 0.08 : -0.08));
        }, { passive: false });
      });

      function renderChrome() {
        const mine = seat === 1 || seat === 2;
        const top = mine ? panelFor(seat === 1 ? 2 : 1, 'Their hand', 'Waiting for their hand cam') : panelFor(1, player1 && player1.handle, 'Waiting for seat 1');
        const bottom = mine ? panelFor(seat, 'Your hand', 'Link your hand cam') : panelFor(2, player2 && player2.handle, 'Waiting for seat 2');
        const linked = peers.some((p) => p.connectionState === 'connected');
        const stalled = peers.some((p) => p.connectionState === 'failed' || p.terminal);
        const theirLive = Boolean(top.stream);
        const myLive = Boolean(bottom.stream);
        const verified = linked && theirLive && myLive;
        const connectedPeer = peers.find((p) => p.connectionState === 'connected');
        const badge = root.querySelector('[data-badge]');
        if (badge) {
          badge.classList.toggle('ok', verified);
          badge.textContent = verified
            ? 'Verified live'
            : linked
              ? 'Linked · both cams'
              : joined
                ? 'Waiting for opponent'
                : 'Connecting…';
        }
        const rtt = root.querySelector('[data-rtt]');
        if (rtt) {
          rtt.hidden = !(connectedPeer && connectedPeer.rttMs != null);
          rtt.textContent = connectedPeer && connectedPeer.rttMs != null ? `${connectedPeer.rttMs} ms` : '';
        }
        const stall = root.querySelector('[data-stall]');
        if (stall) stall.hidden = !stalled;
        const actions = root.querySelector('[data-actions]');
        if (actions) {
          if (mine) {
            actions.innerHTML = `<button type="button" class="btn" data-cam-toggle>${localStream ? 'Stop cam' : 'Link hand cam'}</button>
              <button type="button" class="btn ghost" data-copy>Copy table link</button>`;
            actions.querySelector('[data-cam-toggle]').onclick = () => {
              if (localStream) {
                stopCam();
                return;
              }
              void enableCam();
            };
            actions.querySelector('[data-copy]').onclick = async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast(root, 'Table link copied — send it to your opponent', true);
              } catch (_err) {
                toast(root, 'Could not copy', false);
              }
            };
          } else {
            actions.innerHTML = `<p class="muted">Watching. Players control health, mana, turns, and cameras.</p>`;
          }
        }
        const errEl = root.querySelector('[data-cam-err]');
        if (errEl) {
          errEl.hidden = !camError || camModalOpen;
          errEl.textContent = camError;
        }
        renderCamModal();

        const clockMount = root.querySelector('[data-clock]');
        if (clockMount) {
          const clockKey = `${clock.started ? 1 : 0}|${clock.flipping ? 1 : 0}|${clock.active}|${clock.seq}|${seat}`;
          if (clockMount.dataset.key !== clockKey) {
            clockMount.dataset.key = clockKey;
            clockMount.innerHTML = clockBarHtml(clock, { 1: handleName(1), 2: handleName(2) }, seat);
            const flipBtn = clockMount.querySelector('[data-coin-flip]');
            if (flipBtn) flipBtn.onclick = () => flipFirst();
            const resetBtn = clockMount.querySelector('[data-clock-reset]');
            if (resetBtn) resetBtn.onclick = () => resetClock();
          }
        }

        function paintSide(key, panel) {
          const wrap = root.querySelector(`[data-side="${key}"]`);
          if (!wrap) return;
          const cam = wrap.querySelector('.hand-cam');
          cam.classList.toggle('is-mine', panel.mine);
          bindCam(cam, panel.stream, panel.mine, panel.zoom);
          const zoomDock = wrap.querySelector('[data-cam-zoom]');
          if (zoomDock) zoomDock.hidden = !(panel.mine && panel.stream);
          if (panel.mine) paintLocalZoom();
          const label = cam.querySelector('.cam-label');
          if (label) label.textContent = panel.label;
          const state = cam.querySelector('.cam-state');
          if (state) {
            state.hidden = !panel.stream;
            state.textContent = panel.stream ? 'Cam live' : '';
            state.classList.toggle('ok', Boolean(panel.stream));
          }
          const wait = cam.querySelector('.cam-waiting span');
          if (wait) wait.textContent = panel.waiting;
          const hudMount = wrap.querySelector('[data-hud]');
          const hint = panel.stream ? 'Cam live' : (panel.hud.camLive ? 'Cam live' : 'No cam');
          const meta = hudMeta(clock, panel.n, panel.mine);
          hudMount.innerHTML = hudHtml(panel.hud, panel.mine, hint, meta);
          if (panel.mine) {
            hudMount.querySelectorAll('[data-life]').forEach((btn) => {
              btn.onclick = () => patchMine({ life: clamp(localHud.life + Number(btn.getAttribute('data-life')), 0, LIFE_MAX) });
            });
            hudMount.querySelectorAll('[data-mana]').forEach((btn) => {
              btn.onclick = () => setUsed(Number(btn.getAttribute('data-mana')));
            });
            const turn = hudMount.querySelector('[data-turn]');
            if (turn) turn.onclick = () => passTurn();
            const coin = hudMount.querySelector('[data-coin]');
            if (coin) coin.onclick = () => spendCoin();
          }
        }
        paintSide('top', top);
        paintSide('bottom', bottom);

        const lock = root.querySelector('[data-lock]');
        if (lock) {
          const hostCanLock = typeof opts.canReport === 'function' ? opts.canReport() : Boolean(opts.canReport);
          const canLock = Boolean((opts.onResult || opts.onWinner) && (opts.matchOpen !== false) && player1 && player2 && !opts.matchComplete);
          if (canLock && hostCanLock) {
            const bo = [1, 3, 5].includes(Number(opts.bestOf)) ? Number(opts.bestOf) : 3;
            const need = Math.ceil(bo / 2);
            lock.hidden = false;
            const lockKey = `open|host|${busy ? 1 : 0}|${bo}`;
            if (lock.dataset.key !== lockKey) {
              lock.dataset.key = lockKey;
              lock.innerHTML = `<p class="muted">When the paper match is over, type the games won and lock the series. First to ${need} (best of ${bo}).</p>
                <div class="irl-score-grid">
                  <label>${esc(player1.handle)}
                    <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="${need}" step="1" data-score="1" value="${esc(scoreDraft[1])}" ${busy ? 'disabled' : ''}>
                  </label>
                  <label>${esc(player2.handle)}
                    <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="${need}" step="1" data-score="2" value="${esc(scoreDraft[2])}" ${busy ? 'disabled' : ''}>
                  </label>
                </div>
                <button type="button" class="btn" data-lock-series ${busy ? 'disabled' : ''}>Lock series</button>`;
              lock.querySelectorAll('[data-score]').forEach((input) => {
                input.oninput = () => {
                  scoreDraft[input.getAttribute('data-score')] = input.value;
                };
              });
              lock.querySelector('[data-lock-series]').onclick = async () => {
                const s1 = Number(scoreDraft[1]);
                const s2 = Number(scoreDraft[2]);
                busy = true;
                renderChrome();
                try {
                  if (opts.onResult) {
                    await opts.onResult({ score1: s1, score2: s2, bestOf: bo });
                  } else {
                    const winner = s1 > s2 ? player1 : player2;
                    await opts.onWinner(winner);
                  }
                  toast(root, 'Series locked', true);
                } catch (err) {
                  toast(root, err && err.message ? err.message : 'Could not lock the match', false);
                } finally {
                  busy = false;
                  renderChrome();
                }
              };
            }
          } else if (canLock) {
            lock.hidden = false;
            const lockKey = `open|guest|${busy ? 1 : 0}`;
            if (lock.dataset.key !== lockKey) {
              lock.dataset.key = lockKey;
              lock.innerHTML = `<p class="muted">Only the host can lock this series. Sit, play, and keep health and mana in sync — the host types the games won when the paper match is over.</p>
                ${typeof opts.onHostGate === 'function' ? '<button type="button" class="btn" data-host-lock>Host sign in to lock</button>' : ''}`;
              const gate = lock.querySelector('[data-host-lock]');
              if (gate) {
                gate.onclick = async () => {
                  try {
                    const ok = await opts.onHostGate();
                    if (ok) renderChrome();
                  } catch (err) {
                    toast(root, err && err.message ? err.message : 'Host sign-in failed', false);
                  }
                };
              }
            }
          } else if (opts.matchComplete) {
            lock.hidden = false;
            lock.innerHTML = `<p class="muted">This match is locked on the bracket.</p>`;
          } else {
            lock.hidden = true;
            lock.innerHTML = '';
          }
        }
      }

      function close() {
        clearTimeout(flipTimer);
        if (localStream) localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
        p2p.close();
      }

      renderChrome();
      if (joined) emitHello();
      void p2p.join();
      return { close };
    }

    function paint(options) {
      if (seat === null) {
        document.body.classList.add('irl-open');
        paintPicker();
        return;
      }
      document.body.classList.add('irl-open');
      live = startLive(options || {});
    }

    paint();
    return () => {
      document.body.classList.remove('irl-open');
      if (live) live.close();
    };
  }

  global.DdlIrlTable = {
    mount,
    START_LIFE,
    LIFE_MAX,
    MANA_MAX,
  };
})(window);
