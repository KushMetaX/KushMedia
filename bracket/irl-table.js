/**
 * Doginal Dogs Legends IRL table: two hand cams, synced 40 HP,
 * turn-counted crystals (T1 = 1, cap 10, leftover lost), used-mana pips,
 * second-player Coin (+1 once), gold Legends playmat overlay,
 * 60s shot clock, Companion lane peeks, hand lock, deck lock, watcher.
 * Referee alerts live in irl-ref.js and must not touch the lane scanner.
 */
(function (global) {
  const START_LIFE = 40;
  const LIFE_MAX = 40;
  const MANA_MAX = 10;
  const TURN_MS = 60000;

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
      turnLeftMs: TURN_MS,
      turnEndsAt: 0,
      searching: 0,
      searchKind: '',
      searchLeftMs: 0,
    };
  }

  function remainingMs(clock) {
    if (!clock || !clock.started) return 0;
    if (clock.searching) return Math.max(0, Number(clock.searchLeftMs) || 0);
    const ends = Number(clock.turnEndsAt) || 0;
    if (ends) return Math.max(0, ends - Date.now());
    return Math.max(0, Number(clock.turnLeftMs) || 0);
  }

  function armTurn(clock) {
    clock.searching = 0;
    clock.searchKind = '';
    clock.searchLeftMs = 0;
    clock.turnLeftMs = TURN_MS;
    clock.turnEndsAt = Date.now() + TURN_MS;
  }

  function formatShot(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    return `${m}:${String(total % 60).padStart(2, '0')}`;
  }

  function searchKindOf(value) {
    if (value === 'gy' || value === 'hand' || value === 'deck' || value === 'banish') return value;
    return '';
  }

  function searchLabel(kind) {
    if (kind === 'gy') return 'GY';
    if (kind === 'hand') return 'hand';
    if (kind === 'banish') return 'Banish';
    return 'deck';
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
      turnLeftMs: remainingMs(clock),
      searching: clock.searching === 2 ? 2 : clock.searching === 1 ? 1 : 0,
      searchKind: searchKindOf(clock.searchKind),
      searchLeftMs: Math.max(0, Number(clock.searchLeftMs) || 0),
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
    const left = remainingMs(clock);
    const searching = searchKindOf(clock.searchKind) && (clock.searching === 1 || clock.searching === 2);
    const searchName = names[clock.searching] || 'Player';
    const mineActive = seated && clock.active === mine;
    const searchBtns = mineActive
      ? (searching && clock.searching === mine
        ? `<button type="button" class="btn irl-search-btn" data-search-end>Resume timer</button>`
        : `<div class="irl-search-row">
            <button type="button" class="mini" data-search="deck">Search deck</button>
            <button type="button" class="mini" data-search="gy">Search GY</button>
            <button type="button" class="mini" data-search="hand">Look at hand</button>
          </div>`)
      : '';
    return `<div class="irl-clock is-live">
      <div class="irl-clock-row">
        <p class="irl-clock-title">Turn ${turnN} · ${esc(activeName)}</p>
        ${seated ? '<button type="button" class="btn ghost irl-clock-reset" data-clock-reset>Reset turns</button>' : ''}
      </div>
      <p class="irl-shot${left <= 10000 && !searching ? ' is-ember' : ''}${searching ? ' is-paused' : ''}" data-shot>
        <span data-shot-val>${esc(formatShot(left))}</span>
        <span data-shot-note>${searching
          ? `${esc(searchName)} searching ${esc(searchLabel(clock.searchKind))} · timer paused`
          : '60s shot clock · auto-pass at 0:00'}</span>
      </p>
      ${searchBtns}
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
    next.searching = raw.searching === 2 ? 2 : raw.searching === 1 ? 1 : 0;
    next.searchKind = searchKindOf(raw.searchKind);
    next.searchLeftMs = Math.max(0, Number(raw.searchLeftMs) || 0);
    const left = Math.max(0, Number(raw.turnLeftMs));
    next.turnLeftMs = Number.isFinite(left) ? left : TURN_MS;
    if (!next.started) {
      next.turnEndsAt = 0;
    } else if (next.searching) {
      next.turnEndsAt = 0;
      if (!next.searchLeftMs) next.searchLeftMs = next.turnLeftMs;
    } else {
      next.turnEndsAt = Date.now() + next.turnLeftMs;
    }
    return next;
  }

  function emptySlot() {
    return { id: '', occupied: false, source: '', conf: 0 };
  }

  function emptySeatBoard() {
    return {
      extra: emptySlot(),
      banish: emptySlot(),
      creatures: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()],
      spells: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()],
    };
  }

  function emptyBoard() {
    return { seq: 0, 1: emptySeatBoard(), 2: emptySeatBoard() };
  }

  function parseSlot(raw) {
    const next = emptySlot();
    if (!raw || typeof raw !== 'object') return next;
    next.id = String(raw.id || '').toUpperCase();
    if (next.id && !/^V\d{3}$/.test(next.id)) next.id = '';
    next.occupied = Boolean(raw.occupied || next.id);
    next.source = raw.source === 'pin' || raw.source === 'detect' ? raw.source : (next.id ? 'pin' : '');
    next.conf = clamp(Number(raw.conf) || 0, 0, 1);
    return next;
  }

  function parseSeatBoard(raw) {
    const next = emptySeatBoard();
    if (!raw || typeof raw !== 'object') return next;
    next.extra = parseSlot(raw.extra);
    next.banish = parseSlot(raw.banish);
    next.creatures = [0, 1, 2, 3, 4].map((i) => parseSlot(raw.creatures && raw.creatures[i]));
    next.spells = [0, 1, 2, 3, 4].map((i) => parseSlot(raw.spells && raw.spells[i]));
    return next;
  }

  function parseBoard(raw) {
    const next = emptyBoard();
    if (!raw || typeof raw !== 'object') return next;
    next.seq = Math.max(0, Number(raw.seq) || 0);
    next[1] = parseSeatBoard(raw[1] || (raw.seats && raw.seats[1]));
    next[2] = parseSeatBoard(raw[2] || (raw.seats && raw.seats[2]));
    return next;
  }

  function boardWire(board) {
    return {
      seq: board.seq,
      1: board[1],
      2: board[2],
    };
  }

  function laneSlotOf(seatBoard, key) {
    if (!seatBoard || !key) return emptySlot();
    if (key === 'extra') return seatBoard.extra;
    if (key === 'banish') return seatBoard.banish;
    const m = String(key).match(/^(creature|spell)-(\d)$/);
    if (!m) return emptySlot();
    const arr = m[1] === 'creature' ? seatBoard.creatures : seatBoard.spells;
    return arr[Number(m[2])] || emptySlot();
  }

  function writeLane(seatBoard, key, slot) {
    const next = parseSlot(slot);
    if (key === 'extra') seatBoard.extra = next;
    else if (key === 'banish') seatBoard.banish = next;
    else {
      const m = String(key).match(/^(creature|spell)-(\d)$/);
      if (!m) return;
      const arr = m[1] === 'creature' ? seatBoard.creatures : seatBoard.spells;
      arr[Number(m[2])] = next;
    }
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
  const ZOOM_MAX = 3.5;
  const ZOOM_STORE = 'ddl-irl-cam-zoom';
  const HD_VIDEO = { width: { ideal: 1920 }, height: { ideal: 1080 } };

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
    if (/front|selfie|face[\s_-]?cam|facing\s*front|前置|前摄|true[- ]?depth|facing\s*user/.test(s)) n -= 20;
    if (/back|rear|environment|facing\s*back|facing\s*environment|后置|后摄/.test(s)) n += 12;
    if (/tele|telephoto|periscope/.test(s)) n -= 8;
    if (/ultra[\s-]?wide|ultrawide|\buw\b|超广|0[\.,]5\s*x|\.5x/.test(s)) n += 8;
    else if (/\bwide\b/.test(s)) n += 4;
    return n;
  }

  function trackFacing(track) {
    try {
      const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
      if (settings.facingMode) return String(settings.facingMode);
    } catch (_err) {}
    try {
      const caps = track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      const modes = caps && caps.facingMode;
      if (Array.isArray(modes) && modes.length === 1) return String(modes[0]);
    } catch (_e) {}
    return '';
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
    let caps = {};
    try { caps = track.getCapabilities() || {}; } catch (_err) {}
    const minZ = hardwareZoomMin(track);
    const focusModes = caps.focusMode;
    const advanced = [];
    if (minZ != null) advanced.push({ zoom: minZ });
    if (Array.isArray(focusModes) && focusModes.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (!advanced.length) return;
    try {
      await track.applyConstraints({ advanced });
    } catch (_err) {
      if (minZ == null) return;
      try {
        await track.applyConstraints({ zoom: minZ });
      } catch (_e) {}
    }
  }

  function isFrontCam(track) {
    const facing = trackFacing(track);
    if (facing === 'user') return true;
    if (facing === 'environment') return false;
    return scoreCamLabel(track && track.label) < 0;
  }

  async function listVideoInputs() {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return [];
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.filter((device) => device.kind === 'videoinput' && device.deviceId);
    } catch (_err) {
      return [];
    }
  }

  function openVideo(gum, video) {
    return gum({ audio: false, video });
  }

  async function openDevice(gum, deviceId) {
    try {
      return await openVideo(gum, { deviceId: { exact: deviceId }, ...HD_VIDEO });
    } catch (_err) {
      return openVideo(gum, { deviceId: { exact: deviceId } });
    }
  }

  function rankVideoInputs(cams) {
    return cams
      .map((cam) => ({ cam, score: scoreCamLabel(cam.label) }))
      .sort((a, b) => b.score - a.score);
  }

  async function switchToRearWidest(gum, stream) {
    const phone = isPhoneCam();

    async function replaceStream(current, opener) {
      const prevId = trackDeviceId(camTrack(current));
      const wasFront = isFrontCam(camTrack(current));
      stopStream(current);
      try {
        const next = await opener();
        if (isFrontCam(camTrack(next)) && !wasFront && prevId) {
          stopStream(next);
          const restored = await openDevice(gum, prevId);
          await applyWidestHardwareZoom(restored);
          return restored;
        }
        await applyWidestHardwareZoom(next);
        return next;
      } catch (err) {
        if (prevId) {
          try {
            const restored = await openDevice(gum, prevId);
            await applyWidestHardwareZoom(restored);
            return restored;
          } catch (_e) {}
        }
        throw err;
      }
    }

    if (isFrontCam(camTrack(stream))) {
      const rearTries = [
        { facingMode: { exact: 'environment' }, ...HD_VIDEO },
        { facingMode: { ideal: 'environment' }, ...HD_VIDEO },
        { facingMode: 'environment' },
      ];
      for (let i = 0; i < rearTries.length; i += 1) {
        try {
          stream = await replaceStream(stream, () => openVideo(gum, rearTries[i]));
          if (!isFrontCam(camTrack(stream))) break;
        } catch (_err) {}
      }
    }

    await applyWidestHardwareZoom(stream);

    async function adoptBest(current) {
      const cams = await listVideoInputs();
      if (!cams.length) return current;
      const ranked = rankVideoInputs(cams);
      const labeledRear = ranked.filter((row) => row.score > 0);
      const unlabeled = ranked.every((row) => row.score === 0);
      const curId = trackDeviceId(camTrack(current));
      const curFront = isFrontCam(camTrack(current));
      let pick = labeledRear[0] || null;

      if (!pick && unlabeled && phone && cams.length > 1) {
        const fallback = cams.find((cam) => cam.deviceId !== curId) || cams[1] || cams[0];
        pick = { cam: fallback, score: 0 };
      } else if (!pick && curFront) {
        pick = ranked.find((row) => row.cam.deviceId !== curId) || null;
      }

      if (!pick || pick.cam.deviceId === curId) return current;
      const curScore = scoreCamLabel(camTrack(current) && camTrack(current).label);
      if (!curFront && !unlabeled && pick.score <= curScore) return current;
      try {
        return await replaceStream(current, () => openDevice(gum, pick.cam.deviceId));
      } catch (_err) {
        return current;
      }
    }

    stream = await adoptBest(stream);
    stream = await adoptBest(stream);
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
        { audio: false, video: { facingMode: { exact: 'environment' }, ...HD_VIDEO } },
        { audio: false, video: { facingMode: { ideal: 'environment' }, ...HD_VIDEO } },
        { audio: false, video: { facingMode: 'environment' } },
        { audio: false, video: true },
      ]
      : [
        { audio: false, video: { facingMode: { ideal: 'environment' }, ...HD_VIDEO } },
        { audio: false, video: HD_VIDEO },
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
      return await switchToRearWidest(gum, stream);
    } catch (_err) {
      await applyWidestHardwareZoom(stream);
      return stream;
    }
  }

  function emptySeat(handle) {
    return { handle: handle || 'Seat', life: START_LIFE, mana: 0, turn: false, camLive: false, zoom: 1, panX: 0, panY: 0 };
  }

  function applyCamTransform(el, zoom, panX, panY) {
    if (!el) return;
    const z = Number.isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : 1;
    const px = clamp(Number(panX) || 0, -1, 1) * Math.max(0, z - 1) * 50;
    const py = clamp(Number(panY) || 0, -1, 1) * Math.max(0, z - 1) * 50;
    el.style.setProperty('--cam-zoom', String(z));
    el.style.setProperty('--cam-x', `${px}%`);
    el.style.setProperty('--cam-y', `${py}%`);
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
    ['Extra', 'is-side', 'extra'],
    ['Creature', '', 'creature-0'],
    ['Creature', '', 'creature-1'],
    ['Creature', '', 'creature-2'],
    ['Creature', '', 'creature-3'],
    ['Creature', '', 'creature-4'],
    ['Banish', 'is-side', 'banish'],
  ];
  const LANE_BOT = [
    ['Deck', 'is-side', 'deck'],
    ['Spell / Trap', '', 'spell-0'],
    ['Spell / Trap', '', 'spell-1'],
    ['Spell / Trap', '', 'spell-2'],
    ['Spell / Trap', '', 'spell-3'],
    ['Spell / Trap', '', 'spell-4'],
    ['GY', 'is-side', 'gy'],
  ];

  function laneRowHtml(row) {
    return `<div class="lane-row">${row.map(([name, klass, key]) =>
      `<button type="button" class="lane-slot${klass ? ` ${klass}` : ''}" data-lane="${esc(key)}" aria-label="${esc(name)}"><b>${esc(name)}</b><span class="lane-card-name" data-lane-name></span></button>`
    ).join('')}</div>`;
  }

  function laneOverlayHtml() {
    return `<div class="lane-overlay">
      <div class="lane-board">${laneRowHtml(LANE_TOP)}${laneRowHtml(LANE_BOT)}</div>
      <div class="lane-reserve" data-lane-reserve>
        <button type="button" class="lane-slot is-side is-hand" data-lane="hand" disabled aria-label="Hand"><b>Hand</b></button>
      </div>
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
      <div class="cam-chips">
        <p class="cam-chip cam-label"></p>
        <p class="cam-chip cam-state"></p>
      </div>
      <div class="hand-cam">
        <div class="cam-frame">
          <video playsinline webkit-playsinline autoplay muted></video>
          <canvas class="hand-canvas" aria-hidden="true"></canvas>
          ${laneOverlayHtml()}
        </div>
        <div class="cam-waiting"><span>${esc(waiting)}</span></div>
      </div>
      <div class="cam-zoom" data-cam-zoom hidden>
        <label class="cam-zoom-lbl">Closer <span data-zoom-val>1.00×</span></label>
        <input type="range" data-zoom min="100" max="350" step="1" value="100" aria-label="Bring camera view closer">
        <button type="button" class="mini" data-cam-cycle hidden>Switch cam</button>
        <button type="button" class="mini" data-overlay-toggle>Hide mat</button>
        <button type="button" class="mini" data-zoom-reset>Reset</button>
        <p class="cam-zoom-hint">Lock your 40-card list, then line creatures / spells in the gold boxes. Face-down cards sit in the landscape Hand box under the mat. Extra, Deck, Banish, GY, and Hand stay unnamed. Double-click a play lane to correct.</p>
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
          <p class="hud-life${dead ? ' dead' : low ? ' low' : ''}" data-hero="${meta.seat || ''}">${seatHud.life}</p>
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
      ${mine && meta.canPass ? `<div class="irl-ref-btns">
        <button type="button" class="btn ghost" data-attack="1">${meta.attackMode ? 'Cancel attack' : 'Declare attack'}</button>
      </div>` : ''}
      ${turnBtn}
    </div>`;
  }

  function bindCam(el, stream, muted, zoom, panX, panY) {
    const video = el.querySelector('video');
    const waiting = el.querySelector('.cam-waiting');
    el.classList.toggle('is-live', Boolean(stream));
    applyCamTransform(el, zoom, panX, panY);
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

    function seedPlayName(n) {
      const entry = n === 1 ? player1 : n === 2 ? player2 : null;
      if (!entry) return '';
      return String(entry.playName || (entry.registeredDeck && entry.registeredDeck.playName) || '').trim();
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
        <p class="muted">After you sit, submit your DDL TCG in-game name to lock a saved Play list — or paste / pick a Companion 40. Then point the rear camera at the mat. Creature and spell/trap boxes match official art and the printed name against that list — Skip vs Spark vs Plague is easy in a 40, not in all 111. Extra, Deck, Banish, and GY stay unnamed. Each turn is 60 seconds.</p>
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
      let board = emptyBoard();
      const decks = { 1: null, 2: null };
      const hands = { 1: 0, 2: 0 };
      const handLabels = { 1: [], 2: [] };
      const handStatus = { 1: 'off', 2: 'off' };
      const handWatchers = { top: null, bottom: null };
      const remoteHud = { 1: null, 2: null };
      const peerSeat = new Map();
      const streamsByPeer = new Map();
      let localStream = null;
      let camZoom = readStoredZoom();
      let camPanX = 0;
      let camPanY = 0;
      let videoInputCount = 0;
      let camError = '';
      let camModalOpen = seat === 1 || seat === 2;
      let camBusy = false;
      let busy = false;
      let scoreDraft = { 1: '', 2: '' };
      let flipTimer = 0;
      let shotTimer = 0;
      let watchTimer = 0;
      let lastWatch = { 1: '', 2: '' };
      const detectHold = { 1: {}, 2: {} };
      const attack = { mode: '', attackers: [], target: null };
      const refLog = [];
      const logHeld = new Set();
      let pickerLane = null;
      let catalogReady = false;
      let playNameDraft = seedPlayName(seat);
      let pasteErr = '';
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
        if (next.seq <= clock.seq) return false;
        clock = next;
        syncLocalFromClock();
        return true;
      }

      function adoptBoard(raw) {
        const next = parseBoard(raw);
        if (next.seq <= board.seq) return false;
        board = next;
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
          if (msg.k === 'board') {
            if (claimed !== 1 && claimed !== 2) return;
            if (adoptBoard(msg.board)) renderChrome();
            return;
          }
          if (msg.k === 'deck') {
            if (claimed !== 1 && claimed !== 2) return;
            if (msg.seat !== claimed) return;
            decks[msg.seat] = parseLockedDeck(msg.deck);
            renderChrome();
            return;
          }
          if (msg.k !== 'hello' && msg.k !== 'hud') return;
          if (msg.seat !== 1 && msg.seat !== 2) return;
          if (claimed !== msg.seat) return;
          peerSeat.set(_from, msg.seat);
          if (msg.clock) adoptClock(msg.clock);
          if (msg.board) adoptBoard(msg.board);
          if (msg.deck) decks[msg.seat] = parseLockedDeck(msg.deck);
          const prev = remoteHud[msg.seat] || emptySeat(msg.handle || handleName(msg.seat));
          remoteHud[msg.seat] = {
            handle: msg.k === 'hello' ? (msg.handle || prev.handle) : prev.handle,
            life: Number.isFinite(msg.life) ? msg.life : prev.life,
            mana: clock.used[msg.seat] || 0,
            turn: clock.started && clock.active === msg.seat,
            camLive: Boolean(msg.cam),
            zoom: Number.isFinite(msg.zoom) ? clamp(msg.zoom, ZOOM_MIN, ZOOM_MAX) : (prev.zoom || 1),
            panX: Number.isFinite(msg.panX) ? clamp(msg.panX, -1, 1) : (prev.panX || 0),
            panY: Number.isFinite(msg.panY) ? clamp(msg.panY, -1, 1) : (prev.panY || 0),
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
          panX: camPanX,
          panY: camPanY,
          clock: clockWire(clock),
          board: boardWire(board),
          deck: decks[seat],
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
          panX: camPanX,
          panY: camPanY,
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
        armTurn(clock);
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

      function lifeOf(n) {
        if (n === seat) return Number(localHud.life) || 0;
        const hud = remoteHud[n];
        return Number(hud && hud.life) || START_LIFE;
      }

      function appendRefLog(list) {
        const current = new Set();
        (list || []).forEach((n) => {
          if (!n || !n.text) return;
          const key = `${n.kind}|${n.text}`;
          current.add(key);
          if (logHeld.has(key)) return;
          logHeld.add(key);
          refLog.push({
            kind: n.kind,
            level: n.level || '',
            seat: n.seat || 0,
            text: n.text,
            at: Date.now(),
          });
        });
        [...logHeld].forEach((key) => {
          if (!current.has(key)) logHeld.delete(key);
        });
        if (refLog.length > 80) refLog.splice(0, refLog.length - 80);
        renderRefLog();
      }

      function renderRefLog() {
        const list = root.querySelector('[data-ref-log-list]');
        if (!list) return;
        list.innerHTML = refLog.slice(-40).map((n) => {
          const cls = n.level === 'illegal' ? 'is-bad' : (n.level === 'ok' ? 'is-ok' : '');
          return `<li class="${cls}">${esc(n.text)}</li>`;
        }).join('');
        const wrap = root.querySelector('[data-ref-log]');
        if (wrap) wrap.hidden = refLog.length === 0;
      }

      function setPhaseNote(text) {
        const el = root.querySelector('[data-phase]');
        if (!el) return;
        el.hidden = !text;
        el.textContent = text || '';
      }

      function resetAttack() {
        attack.mode = '';
        attack.attackers = [];
        attack.target = null;
      }

      function attackHint() {
        if (attack.mode === 'poison') return 'Snake Venom: tap a Pirate you control';
        if (attack.mode === 'attacker') return 'Tap your creature, then an enemy body or their life';
        if (attack.mode === 'target') return 'Tap an enemy creature or their life total';
        return '';
      }

      function applyAttackVerdict(verdict) {
        const notes = (verdict && verdict.notes) || [];
        appendRefLog(notes);
        const alertEl = root.querySelector('[data-alerts]');
        if (alertEl && notes.length) {
          alertEl.hidden = false;
          alertEl.textContent = notes.map((n) => n.text).join(' · ');
          alertEl.classList.toggle('is-ok', notes.every((n) => n.level === 'ok'));
        }
        const ok = Boolean(verdict && verdict.ok);
        toast(root, notes[0] ? notes[0].text : (ok ? 'Attack is legal' : 'Illegal attack'), ok);
      }

      function judgeCurrentAttack() {
        const Ref = global.DdlIrlRef;
        const Cat = global.DdlIrlCatalog;
        if (!Ref || !attack.attackers.length || !attack.target) return;
        const verdict = Ref.judgeAttack({
          seatN: seat,
          boardSeat: board[seat],
          enemyBoard: board[seat === 1 ? 2 : 1],
          clock,
          attackers: attack.attackers,
          target: attack.target,
          catalog: Cat,
        });
        applyAttackVerdict(verdict);
      }

      function onAttackLane(seatN, key) {
        const Ref = global.DdlIrlRef;
        const Cat = global.DdlIrlCatalog;
        if (!Ref) return;
        if (attack.mode === 'poison') {
          if (seatN !== seat) return;
          const card = Cat && Cat.byId(laneSlotOf(board[seat], key).id);
          if (!card || card.type !== 'Creature') return;
          const pirate = String(card.class || '') === 'Pirate' || (card.classes || []).indexOf('Pirate') >= 0 || card.all_class;
          if (!pirate) {
            toast(root, 'Poison needs a Pirate you control', false);
            return;
          }
          Ref.grantPoison(seat, key);
          appendRefLog([{ kind: 'venom', level: 'ok', seat, text: `${card.name} has Poison until end of turn.` }]);
          toast(root, `${card.name} has Poison this turn`, true);
          resetAttack();
          renderChrome();
          return;
        }
        if (seatN === seat && String(key).indexOf('creature-') === 0) {
          if (attack.mode === 'target' && attack.target && attack.attackers.indexOf(key) < 0) {
            attack.attackers.push(key);
            judgeCurrentAttack();
            return;
          }
          attack.attackers = [key];
          attack.mode = 'target';
          toast(root, 'Now tap the enemy creature or their life', true);
          renderChrome();
          return;
        }
        if (attack.mode === 'target' && seatN !== seat && String(key).indexOf('creature-') === 0) {
          attack.target = { kind: 'creature', seat: seatN, key };
          judgeCurrentAttack();
        }
      }

      function onHeroTarget(n) {
        if (attack.mode !== 'target' || n === seat) return;
        attack.target = { kind: 'hero', seat: n, key: '' };
        judgeCurrentAttack();
      }

      function passTurn(reason) {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started) return;
        if (reason === 'timeout') {
          if (clock.searching) return;
          if (remainingMs(clock) > 250) return;
        } else if (clock.active !== seat) return;
        const ending = clock.active;
        const next = clock.active === 1 ? 2 : 1;
        const Ref = global.DdlIrlRef;
        const Cat = global.DdlIrlCatalog;
        const phase = [];
        if (Ref && Cat) {
          phase.push(...(Ref.phaseNotes('end', ending, board[ending], Cat) || []));
          phase.push(...(Ref.phaseNotes('start', next, board[next], Cat) || []));
        }
        clock.active = next;
        clock.turns[next] = (clock.turns[next] || 0) + 1;
        clock.used = { 1: 0, 2: 0 };
        clock.coinArmed = false;
        resetAttack();
        armTurn(clock);
        if (phase.length) {
          appendRefLog(phase);
          setPhaseNote(phase.map((n) => n.text).join(' · '));
        } else {
          setPhaseNote('');
        }
        pushClock();
      }

      function beginSearch(kind) {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started || clock.active !== seat) return;
        const nextKind = searchKindOf(kind);
        if (!nextKind) return;
        if (clock.searching === seat) return;
        clock.searchLeftMs = remainingMs(clock);
        clock.searching = seat;
        clock.searchKind = nextKind;
        clock.turnEndsAt = 0;
        clock.turnLeftMs = clock.searchLeftMs;
        pushClock();
      }

      function endSearch() {
        if (seat !== 1 && seat !== 2) return;
        if (clock.searching !== seat) return;
        const Ref = global.DdlIrlRef;
        if (Ref && typeof Ref.canResume === 'function') {
          const st = Ref.seatMem ? Ref.seatMem(seat) : null;
          const pileSeat = (st && st.expectOn) || seat;
          const check = Ref.canResume(pileSeat, clock.searchKind);
          if (check && check.ok === false) {
            toast(root, `Put the ${Ref.pileLabel(check.missing)} back before resuming.`, false);
            return;
          }
        }
        const left = Math.max(0, Number(clock.searchLeftMs) || 0);
        clock.searching = 0;
        clock.searchKind = '';
        clock.searchLeftMs = 0;
        clock.turnLeftMs = left;
        clock.turnEndsAt = Date.now() + left;
        pushClock();
      }

      function parseLockedDeck(raw) {
        if (!raw || typeof raw !== 'object' || !raw.locked) return null;
        const Cat = global.DdlIrlCatalog;
        const heroes = Array.isArray(raw.heroes) ? raw.heroes.map(String) : [String(raw.hero || '')].filter(Boolean);
        const counts = raw.counts && typeof raw.counts === 'object' ? raw.counts : {};
        const checked = Cat ? Cat.validateDeck(counts, heroes) : { ok: false, total: 0, counts, rows: [], errors: ['Catalog missing'] };
        return {
          locked: true,
          name: String(raw.name || 'Locked list'),
          hero: String(raw.hero || heroes[0] || ''),
          heroes,
          counts: checked.counts,
          rows: checked.rows,
          total: checked.total,
          ok: checked.ok,
          errors: checked.errors,
        };
      }

      function emitDeck() {
        if (seat !== 1 && seat !== 2) return;
        p2p.send({ k: 'deck', seat, deck: decks[seat] });
      }

      function emitBoard() {
        if (seat !== 1 && seat !== 2) return;
        p2p.send({ k: 'board', board: boardWire(board) });
      }

      function pushBoard() {
        if (seat !== 1 && seat !== 2) return;
        board.seq += 1;
        emitBoard();
        renderChrome();
      }

      function pinLane(seatN, key, id) {
        if (seat !== 1 && seat !== 2) return;
        const Watch = global.DdlIrlWatch;
        if (Watch && Watch.isPileLane(key)) return;
        const cardId = String(id || '').toUpperCase();
        writeLane(board[seatN], key, cardId
          ? { id: cardId, occupied: true, source: 'pin', conf: 1 }
          : emptySlot());
        pushBoard();
      }

      function feedVerified(n, streamOn) {
        if (!streamOn) return false;
        if (handStatus[n] === 'ready') return hands[n] > 0;
        return true;
      }

      function handHintFor(n, streamOn, camLive) {
        const status = handStatus[n];
        if (!streamOn && !camLive) return 'No cam';
        if (status === 'loading') return 'Loading tracker';
        if (status === 'error') return streamOn ? 'Cam live' : 'Cam live';
        if (hands[n] > 0) {
          const labels = (handLabels[n] || []).join(' · ');
          return labels ? `${labels} locked` : 'Hand locked';
        }
        if (streamOn) return 'Show a hand';
        return camLive ? 'Cam live' : 'No cam';
      }

      function bindHands(sideKey, panel) {
        const Hands = global.DdlIrlHands;
        const cam = root.querySelector(`[data-side="${sideKey}"] .hand-cam`);
        if (!cam || !Hands) return;
        const video = cam.querySelector('video');
        const canvas = cam.querySelector('.hand-canvas');
        const stream = panel.stream;
        const prev = handWatchers[sideKey];
        if (prev && prev.stream === stream) return;
        if (prev && prev.stop) prev.stop();
        handWatchers[sideKey] = null;
        if (!stream || !video || !canvas) {
          hands[panel.n] = 0;
          handStatus[panel.n] = 'off';
          return;
        }
        const n = panel.n;
        const watcher = Hands.watch(video, canvas, (count, labels, status) => {
          if (status) handStatus[n] = status;
          if (status !== 'loading' && status !== 'error') {
            hands[n] = Number(count) || 0;
            handLabels[n] = labels || [];
          }
          const wrap = root.querySelector(`[data-side="${sideKey}"]`);
          const state = wrap && wrap.querySelector('.cam-state');
          if (state && panel.stream) {
            state.hidden = false;
            const hint = handHintFor(n, true, true);
            state.textContent = hint;
            state.classList.toggle('ok', hands[n] > 0 || handStatus[n] === 'error');
            state.classList.toggle('warn', handStatus[n] === 'ready' && hands[n] === 0);
          }
        });
        handWatchers[sideKey] = { stream, stop: watcher.stop };
      }

      function paintLanes(cam, seatN) {
        const Cat = global.DdlIrlCatalog;
        const Watch = global.DdlIrlWatch;
        const seatBoard = board[seatN];
        cam.querySelectorAll('[data-lane]').forEach((el) => {
          const key = el.getAttribute('data-lane');
          const pile = Watch && Watch.isPileLane(key);
          const slot = laneSlotOf(seatBoard, key);
          const card = !pile && slot.id && Cat ? Cat.byId(slot.id) : null;
          el.classList.toggle('is-pile', Boolean(pile));
          el.classList.toggle('is-filled', Boolean(!pile && (slot.id || slot.occupied)));
          el.classList.toggle('is-alert', key === 'extra' && slot.occupied);
          el.classList.toggle('is-searching', Boolean(clock.searching === seatN && (clock.searchKind === key || (clock.searchKind === 'gy' && key === 'banish'))));
          el.classList.toggle('is-attack', Boolean(attack.mode && key.indexOf('creature-') === 0 && (attack.attackers.indexOf(key) >= 0 || (attack.mode === 'target' && seatN !== seat))));
          el.disabled = Boolean(pile);
          if (card) {
            el.setAttribute('data-peek', card.id);
            el.setAttribute('aria-label', card.name);
            el.classList.toggle('is-auto', slot.source === 'detect');
          } else {
            el.removeAttribute('data-peek');
            el.setAttribute('aria-label', key);
            el.classList.remove('is-auto');
          }
          const typeEl = el.querySelector('b');
          if (typeEl) typeEl.hidden = Boolean(card);
          const nameEl = el.querySelector('[data-lane-name]');
          if (nameEl) {
            nameEl.hidden = !card;
            nameEl.textContent = card ? card.name : '';
          }
          el.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (pile) return;
            if (attack.mode) {
              onAttackLane(seatN, key);
              return;
            }
            if (card && Cat) {
              Cat.showPeek(card.id, el, 'pin');
              return;
            }
            if (seat !== 1 && seat !== 2) return;
            pickerLane = { seat: seatN, key };
            renderLanePicker();
          };
          el.ondblclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (pile) return;
            if (seat !== 1 && seat !== 2) return;
            pickerLane = { seat: seatN, key };
            renderLanePicker();
          };
        });
      }

      function lockMyDeck(counts, meta) {
        const Cat = global.DdlIrlCatalog;
        if (seat !== 1 && seat !== 2 || !Cat) return;
        const heroes = meta && meta.heroes ? meta.heroes : [];
        const checked = Cat.validateDeck(counts, heroes);
        decks[seat] = {
          locked: true,
          name: (meta && meta.name) || 'Locked list',
          hero: (meta && meta.hero) || (heroes[0] || ''),
          heroes,
          counts: checked.counts,
          rows: checked.rows,
          total: checked.total,
          ok: checked.ok,
          errors: checked.errors,
        };
        emitDeck();
        renderChrome();
      }

      function renderDecksPanel() {
        const mountEl = root.querySelector('[data-decks]');
        if (!mountEl) return;
        const Cat = global.DdlIrlCatalog;
        const semi = Boolean(opts.semiIrl);
        const mine = seat === 1 || seat === 2;
        const quota = Cat && typeof Cat.sanitizeClassQuota === 'function'
          ? Cat.sanitizeClassQuota(opts.deckClassQuota)
          : null;
        const quotaLabel = quota && Cat && typeof Cat.classQuotaLabel === 'function'
          ? Cat.classQuotaLabel(quota)
          : '';
        function packHtml(n) {
          const pack = decks[n];
          const name = handleName(n);
          if (!pack) return `<p class="muted">${esc(name)} · no list locked</p>`;
          const status = pack.ok ? 'Locked 40' : `Locked · ${esc((pack.errors && pack.errors[0]) || 'check list')}`;
          return `<p><strong>${esc(name)}</strong> · ${esc(pack.name)} · ${esc(status)}</p>`;
        }
        const customs = Cat ? Cat.customDecks().slice() : [];
        const registered = mine && ((seat === 1 ? opts.player1 : opts.player2) || {}).registeredDeck;
        if (registered && registered.counts) {
          customs.unshift({
            id: 'registered-tourney',
            name: `${registered.name || 'Registered deck'} (tournament lock)`,
            hero: '',
            heroes: [],
            cards: registered.counts,
          });
        }
        const customOpts = customs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${esc((d.heroes || []).join('/'))})</option>`).join('');
        mountEl.hidden = false;
        const key = `d|${semi ? 1 : 0}|${mine ? seat : 0}|${decks[1] ? decks[1].total : 0}|${decks[2] ? decks[2].total : 0}|${catalogReady ? 1 : 0}|${customs.length}|${pasteErr ? 'err' : '0'}|${quotaLabel || '0'}`;
        if (mountEl.dataset.key === key) return;
        mountEl.dataset.key = key;
        mountEl.innerHTML = `<p class="hud-kicker">${semi ? 'Semi-IRL · verified lists' : 'Deck lock'}</p>
          <p class="muted">${semi
            ? 'Paste the list you exported from ddltcg.com/play, or pick a Companion list. Auto-ID matches official art and printed names on that list only (Skip / Spark / Plague / Houdini, not all 111).'
            : 'Paste your ddltcg.com/play export to lock a 40 (or pick a Companion list). Auto-ID matches art and names from that list — not the whole 111-card pool.'}</p>
          ${quotaLabel ? `<p class="deck-quota-note" role="status"><strong>You need ${esc(quotaLabel)} in this deck.</strong>${quota.class === 'Neutral' ? ' Neutral cards count toward this mix.' : ' Mini, Midi, and Mega count as the hero class. Neutral does not.'}</p>` : ''}
          ${packHtml(1)}${packHtml(2)}
          ${mine ? `<div class="irl-deck-lock">
            <label>DDL TCG in-game name <span class="muted">(optional)</span>
              <input data-play-name maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Hero name on Play" value="${esc(playNameDraft)}">
            </label>
            ${customOpts ? `<label>My decks<select data-custom-deck><option value="">Pick a saved list</option>${customOpts}</select></label>` : '<p class="muted">No Companion My decks on this browser. Paste your Play export below.</p>'}
            <label>Paste your Play export<textarea data-deck-paste rows="4" spellcheck="false" placeholder="# DDL TCG&#10;# name: My Deck&#10;3× Blade&#10;# serials: V015,V015,V015"></textarea></label>
            ${pasteErr ? `<p class="err">${esc(pasteErr)}</p>` : ''}
            <div class="row wrap">
              <button type="button" class="btn" data-deck-lock>Lock my list</button>
              <button type="button" class="btn ghost" data-export-list>Export selected</button>
            </div>
          </div>` : ''}`;
        const nameEl = mountEl.querySelector('[data-play-name]');
        if (nameEl) {
          nameEl.oninput = () => {
            playNameDraft = String(nameEl.value || '').trim();
          };
        }
        function selectedList() {
          const liveCat = global.DdlIrlCatalog;
          const pasted = mountEl.querySelector('[data-deck-paste]');
          if (liveCat && typeof liveCat.parsePlayList === 'function' && pasted && String(pasted.value || '').trim()) {
            const parsed = liveCat.parsePlayList(pasted.value);
            if (parsed.count) {
              return {
                counts: parsed.counts,
                meta: {
                  name: parsed.name || 'Pasted list',
                  hero: '',
                  heroes: liveCat.heroesFromCounts ? liveCat.heroesFromCounts(parsed.counts) : [],
                },
                unknown: parsed.unknown || [],
              };
            }
          }
          const sel = mountEl.querySelector('[data-custom-deck]');
          const picked = sel && sel.value;
          if (picked) {
            const custom = customs.find((d) => d.id === picked);
            if (custom) {
              return {
                counts: custom.cards,
                meta: { name: custom.name, hero: custom.hero, heroes: custom.heroes },
              };
            }
          }
          if (mine && decks[seat] && decks[seat].counts) {
            return {
              counts: decks[seat].counts,
              meta: { name: decks[seat].name, heroes: decks[seat].heroes, slot: decks[seat].slot },
            };
          }
          return null;
        }
        const lockBtn = mountEl.querySelector('[data-deck-lock]');
        if (lockBtn) {
          lockBtn.onclick = async () => {
            const liveCat = global.DdlIrlCatalog;
            if (!liveCat) return toast(root, 'Companion catalog failed to load. Refresh the page.', false);
            try {
              if (typeof liveCat.load === 'function') await liveCat.load();
            } catch (_err) {
              return toast(root, 'Companion catalog failed to load. Refresh the page.', false);
            }
            const picked = selectedList();
            if (!picked) return toast(root, 'Paste your Play export or pick a saved deck', false);
            if (picked.unknown && picked.unknown.length) {
              pasteErr = `Could not read: ${picked.unknown.slice(0, 4).join(', ')}`;
              mountEl.dataset.key = '';
              renderDecksPanel();
              return toast(root, pasteErr, false);
            }
            pasteErr = '';
            const checked = liveCat.validateDeck(picked.counts, picked.meta.heroes);
            if (quota && typeof liveCat.evaluateClassQuota === 'function') {
              const mix = liveCat.evaluateClassQuota(picked.counts, quota);
              if (!mix.ok) return toast(root, mix.message || 'This list misses the class mix', false);
            }
            if (!checked.ok) toast(root, checked.errors[0] || 'List is not a legal 40', false);
            lockMyDeck(picked.counts, picked.meta);
            if (checked.ok) toast(root, 'List locked for this table', true);
          };
        }
        const exportBtn = mountEl.querySelector('[data-export-list]');
        if (exportBtn) {
          exportBtn.onclick = async () => {
            const liveCat = global.DdlIrlCatalog;
            const picked = selectedList();
            if (!picked) return toast(root, 'Paste your Play export or pick a saved deck', false);
            if (!liveCat || typeof liveCat.exportDeckText !== 'function') {
              return toast(root, 'Companion catalog failed to load. Refresh the page.', false);
            }
            try {
              if (typeof liveCat.load === 'function') await liveCat.load();
            } catch (_err) {
              return toast(root, 'Companion catalog failed to load. Refresh the page.', false);
            }
            const text = liveCat.exportDeckText({
              name: picked.meta.name,
              playName: playNameDraft,
              counts: picked.counts,
              heroes: picked.meta.heroes,
            });
            await liveCat.copyText(text, exportBtn);
          };
        }
      }

      function renderLanePicker() {
        const mountEl = root.querySelector('[data-lane-picker]');
        if (!mountEl) return;
        const Cat = global.DdlIrlCatalog;
        const Watch = global.DdlIrlWatch;
        if (pickerLane && Watch && Watch.isPileLane(pickerLane.key)) pickerLane = null;
        if (!pickerLane) {
          mountEl.hidden = true;
          mountEl.innerHTML = '';
          return;
        }
        const cards = Cat ? Cat.cards() : [];
        const locked = decks[pickerLane.seat];
        const pool = locked && locked.rows && locked.rows.length
          ? locked.rows.map((row) => Cat.byId(row.id)).filter(Boolean)
          : cards;
        mountEl.hidden = false;
        mountEl.innerHTML = `<div class="irl-cam-dialog" role="dialog" aria-modal="true">
          <p class="hud-kicker">Pin card · ${esc(pickerLane.key)}</p>
          <h2>Companion lookup</h2>
          <input type="search" data-lane-q placeholder="Name or Vxxx" autocomplete="off">
          <div class="irl-card-pick" data-lane-results></div>
          <div class="irl-seat-grid">
            <button type="button" class="btn ghost" data-lane-clear>Clear lane</button>
            <button type="button" class="btn ghost" data-lane-cancel>Close</button>
          </div>
        </div>`;
        const q = mountEl.querySelector('[data-lane-q]');
        const results = mountEl.querySelector('[data-lane-results]');
        function paintResults() {
          const term = String(q.value || '').trim().toLowerCase();
          const hits = pool.filter((c) => {
            if (!term) return true;
            return c.id.toLowerCase().includes(term) || c.name.toLowerCase().includes(term);
          }).slice(0, 24);
          results.innerHTML = hits.map((c) =>
            `<button type="button" class="mini" data-pin-id="${esc(c.id)}">${esc(c.name)} <span class="muted">${esc(c.id)}</span></button>`
          ).join('') || '<p class="muted">No cards match.</p>';
          results.querySelectorAll('[data-pin-id]').forEach((btn) => {
            btn.onclick = () => {
              pinLane(pickerLane.seat, pickerLane.key, btn.getAttribute('data-pin-id'));
              pickerLane = null;
              renderLanePicker();
            };
          });
        }
        paintResults();
        q.oninput = paintResults;
        q.focus();
        mountEl.querySelector('[data-lane-cancel]').onclick = () => {
          pickerLane = null;
          renderLanePicker();
        };
        mountEl.querySelector('[data-lane-clear]').onclick = () => {
          pinLane(pickerLane.seat, pickerLane.key, '');
          pickerLane = null;
          renderLanePicker();
        };
      }

      function tickShot() {
        if (!clock.started) return;
        const shot = root.querySelector('[data-shot]');
        if (shot) {
          const left = remainingMs(clock);
          const val = shot.querySelector('[data-shot-val]');
          if (val) val.textContent = formatShot(left);
          shot.classList.toggle('is-ember', left <= 10000 && !clock.searching);
          shot.classList.toggle('is-paused', Boolean(clock.searching));
        }
        const active = clock.active;
        const offCam = clock.started && !clock.searching && handStatus[active] === 'ready' && hands[active] === 0;
        const note = root.querySelector('[data-shot-note]');
        if (note && !clock.searching) {
          const atk = attackHint();
          note.textContent = atk
            ? atk
            : (offCam
              ? `${handleName(active)} · hands off cam`
              : '60s shot clock · auto-pass at 0:00');
        }
        if (!clock.searching && remainingMs(clock) <= 0) passTurn('timeout');
      }

      function runWatch() {
        if (runWatch.busy) return;
        runWatch.busy = true;
        runWatch.tick = (runWatch.tick || 0) + 1;
        try {
        const Watch = global.DdlIrlWatch;
        const Cat = global.DdlIrlCatalog;
        if (!Watch || !Cat) return;
        const notes = [];
        let reading = 0;
        ['top', 'bottom'].forEach((side) => {
          const wrap = root.querySelector(`[data-side="${side}"]`);
          if (!wrap) return;
          const video = wrap.querySelector('video');
          const cam = wrap.querySelector('.hand-cam');
          if (!video || !cam || !cam.classList.contains('is-live')) return;
          if (!cam.classList.contains('is-mine') && runWatch.tick % 2 === 0) return;
          const seatN = Number(cam.getAttribute('data-board-seat'));
          if (seatN !== 1 && seatN !== 2) return;
          const slots = [...cam.querySelectorAll('[data-lane]')].map((el) => ({
            key: el.getAttribute('data-lane'),
            el,
          })).filter((row) => Watch.isPlayLane(row.key));
          const counts = decks[seatN] && decks[seatN].counts ? decks[seatN].counts : null;
          const prefer = counts ? Object.keys(counts).filter((id) => Number(counts[id]) > 0) : [];
          const hits = Watch.scan(video, slots, prefer);
          reading += hits.filter((h) => h.id).length;
          const hold = detectHold[seatN] || (detectHold[seatN] = {});
          let changed = false;
          ['extra', 'deck', 'banish', 'gy', 'hand'].forEach((key) => {
            const cur = laneSlotOf(board[seatN], key);
            if (cur.id || cur.occupied || cur.source) {
              writeLane(board[seatN], key, emptySlot());
              changed = true;
            }
          });
          hits.forEach((hit) => {
            const cur = laneSlotOf(board[seatN], hit.key);
            if (cur.source === 'pin') return;
            const st = hold[hit.key] || (
              cur.source === 'detect' && cur.id
                ? { locked: cur.id, pending: '', hits: 0, misses: 0, conf: cur.conf || 0 }
                : { locked: '', pending: '', hits: 0, misses: 0, conf: 0 }
            );
            const raw = hit.id || '';
            let next = null;
            if (st.locked) {
              if (raw === st.locked) {
                st.misses = 0;
                st.pending = '';
                st.hits = 0;
                st.conf = Math.max(st.conf, hit.conf || 0);
              } else if (!raw) {
                st.misses += 1;
                st.pending = '';
                st.hits = 0;
                if (st.misses >= 2) {
                  st.locked = '';
                  st.conf = 0;
                  next = emptySlot();
                }
              } else if (raw === st.pending) {
                st.hits += 1;
                st.misses = 0;
                if (st.hits >= 2) {
                  st.locked = raw;
                  st.conf = hit.conf || 0;
                  st.pending = '';
                  st.hits = 0;
                  next = {
                    id: raw,
                    occupied: true,
                    source: 'detect',
                    conf: hit.conf,
                  };
                }
              } else {
                st.pending = raw;
                st.hits = 1;
                st.misses = 0;
              }
            } else if (raw) {
              if (raw === st.pending) st.hits += 1;
              else {
                st.pending = raw;
                st.hits = 1;
              }
              st.misses = 0;
              const need = 2;
              if (st.hits >= need) {
                st.locked = raw;
                st.conf = hit.conf || 0;
                st.pending = '';
                st.hits = 0;
                next = {
                  id: raw,
                  occupied: true,
                  source: 'detect',
                  conf: hit.conf,
                };
              }
            } else {
              st.pending = '';
              st.hits = 0;
            }
            hold[hit.key] = st;
            if (next) {
              writeLane(board[seatN], hit.key, next);
              changed = true;
            }
          });
          const sig = hits.map((h) => {
            const slot = laneSlotOf(board[seatN], h.key);
            return `${h.key}:${slot.occupied ? 1 : 0}:${slot.id}`;
          }).join('|');
          if (changed) {
            lastWatch[seatN] = sig;
            paintLanes(cam, seatN);
            if (seat === 1 || seat === 2) {
              board.seq += 1;
              emitBoard();
            }
          } else if (sig !== lastWatch[seatN]) {
            lastWatch[seatN] = sig;
          }
          const Ref = global.DdlIrlRef;
          if (Ref) {
            try {
              const peek = global.DdlIrlHands && DdlIrlHands.peek ? DdlIrlHands.peek(video) : null;
              const pileEls = [...cam.querySelectorAll('[data-lane]')].filter((el) => {
                const key = el.getAttribute('data-lane');
                return key === 'deck' || key === 'gy' || key === 'extra' || key === 'banish' || key === 'hand';
              });
              const enemySeat = seatN === 1 ? 2 : 1;
              const verdict = Ref.observe({
                seatN,
                hits,
                boardSeat: board[seatN],
                enemyBoard: board[enemySeat],
                clock,
                lockedCounts: counts,
                catalog: Cat,
                video,
                pileEls,
                landmarks: peek && peek.landmarks,
                life: { 1: lifeOf(1), 2: lifeOf(2) },
                available: availableOf(clock, seatN),
                used: clock.used[seatN] || 0,
                wentSecond: seatN === secondOf(clock),
                coinArmed: Boolean(clock.coinArmed && clock.active === seatN),
                coinSpent: Boolean(clock.coinSpent),
                offCam: Boolean(clock.started && !clock.searching && clock.active === seatN && handStatus[seatN] === 'ready' && hands[seatN] === 0),
              });
              notes.push(...(verdict.notes || []));
              if (verdict.searchKind && seat === seatN && !clock.searching) {
                beginSearch(verdict.searchKind);
              }
              if (verdict.spendMana != null && seat === seatN && (clock.used[seat] || 0) !== verdict.spendMana) {
                setUsed(verdict.spendMana, true);
              }
              if (verdict.coinHint && seat === seatN) {
                toast(root, 'This play is 1 over. Spend the Coin (+1).', true);
              }
              if (verdict.pickPoison && seat === seatN) {
                attack.mode = 'poison';
                attack.attackers = [];
                attack.target = null;
              }
            } catch (_err) {
              notes.push(...Watch.alertsFromScan(seatN, hits, board[seatN], clock, decks[seatN] && decks[seatN].counts, Cat.byId));
            }
          } else {
            notes.push(...Watch.alertsFromScan(seatN, hits, board[seatN], clock, decks[seatN] && decks[seatN].counts, Cat.byId));
          }
        });
        const alertEl = root.querySelector('[data-alerts]');
        if (alertEl) {
          const unique = [];
          const seen = new Set();
          notes.forEach((n) => {
            if (!n || seen.has(n.text)) return;
            seen.add(n.text);
            unique.push(n);
          });
          alertEl.hidden = unique.length === 0;
          alertEl.textContent = unique.map((n) => n.text).join(' · ');
          alertEl.classList.toggle('is-ok', unique.length > 0 && unique.every((n) => n.level === 'ok'));
          appendRefLog(unique);
        }
        const watchNote = root.querySelector('[data-watch-note]');
        if (watchNote) {
          const mine = (seat === 1 || seat === 2) ? decks[seat] : (decks[1] || decks[2]);
          const n = mine && mine.counts
            ? Object.keys(mine.counts).filter((id) => Number(mine.counts[id]) > 0).length
            : 0;
          watchNote.textContent = n
            ? (reading
              ? `Auto-ID is reading ${reading} lane${reading === 1 ? '' : 's'} from your ${n}-card list.`
              : `Line a printed card inside a gold creature or spell box. Matching art from your ${n}-card list.`)
            : 'Lock a 40-card list so auto-ID only matches those cards. Until then it still tries every creature/spell.';
        }
        } finally {
          runWatch.busy = false;
        }
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

      function setUsed(n, fromRef) {
        if (seat !== 1 && seat !== 2) return;
        if (!clock.started || clock.active !== seat) return;
        const avail = availableOf(clock, seat);
        let next = clamp(Number(n) || 0, 0, avail);
        if (!fromRef && (clock.used[seat] || 0) === next && next !== 0) next -= 1;
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
          : 'Tap <b>Allow camera</b>. iPhone and Android will show a system Allow/Block prompt — look at the top of the screen. Then point the <b>rear</b> camera at your cards.';
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
          void refreshVideoInputs();
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
          panX: mine ? camPanX : clamp(Number(hud.panX) || 0, -1, 1),
          panY: mine ? camPanY : clamp(Number(hud.panY) || 0, -1, 1),
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
        <p class="irl-phase" data-phase hidden></p>
        <p class="irl-alert" data-alerts hidden></p>
        <p class="muted" data-watch-note></p>
        <details class="irl-ref-log" data-ref-log hidden>
          <summary>Referee log</summary>
          <ol data-ref-log-list></ol>
        </details>
        <div class="irl-card irl-decks" data-decks></div>
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
        <div class="irl-cam-overlay" data-lane-picker hidden></div>
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
        applyCamTransform(mineCam, camZoom, camPanX, camPanY);
        const wrap = mineCam.closest('[data-side]') || mineCam.parentElement;
        const label = wrap.querySelector('[data-zoom-val]');
        if (label) label.textContent = `${camZoom.toFixed(2)}×`;
        const input = wrap.querySelector('[data-zoom]');
        if (input && Number(input.value) !== Math.round(camZoom * 100)) {
          input.value = String(Math.round(camZoom * 100));
        }
        wrap.querySelectorAll('[data-cam-cycle]').forEach((btn) => {
          btn.hidden = videoInputCount < 2;
        });
      }

      function setCamZoom(factor, keepPan) {
        camZoom = clamp(Number(factor) || 1, ZOOM_MIN, ZOOM_MAX);
        writeStoredZoom(camZoom);
        if (!keepPan && camZoom <= 1.01) {
          camPanX = 0;
          camPanY = 0;
        }
        paintLocalZoom();
        if (seat === 1 || seat === 2) emitHud(localHud);
      }

      async function refreshVideoInputs() {
        videoInputCount = (await listVideoInputs()).length;
        paintLocalZoom();
      }

      async function cycleCam() {
        if (!localStream || camBusy || (seat !== 1 && seat !== 2)) return;
        const gum = getUserMediaFn();
        if (!gum) return;
        const cams = await listVideoInputs();
        if (cams.length < 2) return;
        const ranked = rankVideoInputs(cams);
        const rear = ranked.filter((row) => row.score >= 0).map((row) => row.cam);
        const pool = rear.length > 1 ? rear : cams;
        const curId = trackDeviceId(camTrack(localStream));
        const idx = Math.max(0, pool.findIndex((cam) => cam.deviceId === curId));
        const next = pool[(idx + 1) % pool.length];
        if (!next || next.deviceId === curId) return;
        camBusy = true;
        try {
          const prevId = curId;
          stopStream(localStream);
          localStream = null;
          let stream;
          try {
            stream = await openDevice(gum, next.deviceId);
          } catch (_err) {
            stream = await openDevice(gum, prevId);
          }
          await applyWidestHardwareZoom(stream);
          localStream = stream;
          p2p.setLocalStream(stream);
          videoInputCount = cams.length;
          emitHud(localHud);
          renderChrome();
        } catch (_err) {
          toast(root, 'Could not switch camera', false);
        }
        camBusy = false;
      }

      root.querySelectorAll('[data-zoom]').forEach((input) => {
        input.value = String(Math.round(camZoom * 100));
        input.addEventListener('input', () => setCamZoom(Number(input.value) / 100, true));
      });
      root.querySelectorAll('[data-zoom-reset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          camPanX = 0;
          camPanY = 0;
          setCamZoom(1);
        });
      });
      root.querySelectorAll('[data-cam-cycle]').forEach((btn) => {
        btn.addEventListener('click', () => { void cycleCam(); });
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
          setCamZoom(camZoom + (ev.deltaY < 0 ? 0.08 : -0.08), true);
        }, { passive: false });
        const pointers = new Map();
        let pinchDist = 0;
        let panEmit = 0;
        function emitPanFrame() {
          paintLocalZoom();
          if (panEmit) return;
          panEmit = requestAnimationFrame(() => {
            panEmit = 0;
            if (seat === 1 || seat === 2) emitHud(localHud);
          });
        }
        cam.addEventListener('pointerdown', (ev) => {
          if (!cam.classList.contains('is-mine') || !localStream) return;
          if (ev.target.closest('.lane-slot')) return;
          cam.setPointerCapture(ev.pointerId);
          pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          if (pointers.size === 2) {
            const pts = [...pointers.values()];
            pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          }
          if (camZoom > 1.01) cam.classList.add('is-panning');
        });
        cam.addEventListener('pointermove', (ev) => {
          if (!pointers.has(ev.pointerId)) return;
          const prev = pointers.get(ev.pointerId);
          pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          if (pointers.size === 2) {
            const pts = [...pointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            if (pinchDist > 0 && dist > 0) setCamZoom(camZoom * (dist / pinchDist), true);
            pinchDist = dist;
            return;
          }
          if (camZoom <= 1.01) return;
          const rect = cam.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          camPanX = clamp(camPanX + ((ev.clientX - prev.x) / rect.width) * 2, -1, 1);
          camPanY = clamp(camPanY + ((ev.clientY - prev.y) / rect.height) * 2, -1, 1);
          emitPanFrame();
        });
        function endPointer(ev) {
          pointers.delete(ev.pointerId);
          if (pointers.size < 2) pinchDist = 0;
          if (!pointers.size) cam.classList.remove('is-panning');
        }
        cam.addEventListener('pointerup', endPointer);
        cam.addEventListener('pointercancel', endPointer);
      });

      function renderChrome() {
        const mine = seat === 1 || seat === 2;
        const top = mine ? panelFor(seat === 1 ? 2 : 1, 'Their hand', 'Waiting for their hand cam') : panelFor(1, player1 && player1.handle, 'Waiting for seat 1');
        const bottom = mine ? panelFor(seat, 'Your hand', 'Link your hand cam') : panelFor(2, player2 && player2.handle, 'Waiting for seat 2');
        const linked = peers.some((p) => p.connectionState === 'connected');
        const stalled = peers.some((p) => p.connectionState === 'failed' || p.terminal);
        const theirLive = Boolean(top.stream);
        const myLive = Boolean(bottom.stream);
        const verifiedHands = feedVerified(top.n, theirLive) && feedVerified(bottom.n, myLive);
        const verified = linked && theirLive && myLive && verifiedHands;
        const connectedPeer = peers.find((p) => p.connectionState === 'connected');
        const badge = root.querySelector('[data-badge]');
        if (badge) {
          badge.classList.toggle('ok', verified);
          const trackerDown = handStatus[top.n] === 'error' || handStatus[bottom.n] === 'error';
          badge.textContent = verified
            ? (trackerDown ? 'Verified live · cams' : 'Verified live')
            : linked && theirLive && myLive
              ? 'Linked · show both hands'
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
          const clockKey = `${clock.started ? 1 : 0}|${clock.flipping ? 1 : 0}|${clock.active}|${clock.seq}|${clock.searching}|${clock.searchKind}|${seat}`;
          if (clockMount.dataset.key !== clockKey) {
            clockMount.dataset.key = clockKey;
            clockMount.innerHTML = clockBarHtml(clock, { 1: handleName(1), 2: handleName(2) }, seat);
            const flipBtn = clockMount.querySelector('[data-coin-flip]');
            if (flipBtn) flipBtn.onclick = () => flipFirst();
            const resetBtn = clockMount.querySelector('[data-clock-reset]');
            if (resetBtn) resetBtn.onclick = () => resetClock();
            clockMount.querySelectorAll('[data-search]').forEach((btn) => {
              btn.onclick = () => beginSearch(btn.getAttribute('data-search'));
            });
            const resume = clockMount.querySelector('[data-search-end]');
            if (resume) resume.onclick = () => endSearch();
          }
        }

        function paintSide(key, panel) {
          const wrap = root.querySelector(`[data-side="${key}"]`);
          if (!wrap) return;
          const cam = wrap.querySelector('.hand-cam');
          cam.classList.toggle('is-mine', panel.mine);
          cam.setAttribute('data-board-seat', String(panel.n));
          bindCam(cam, panel.stream, panel.mine, panel.zoom, panel.panX, panel.panY);
          bindHands(key, panel);
          paintLanes(cam, panel.n);
          const zoomDock = wrap.querySelector('[data-cam-zoom]');
          if (zoomDock) zoomDock.hidden = !(panel.mine && panel.stream);
          if (panel.mine) paintLocalZoom();
          const label = wrap.querySelector('.cam-label');
          if (label) label.textContent = panel.label;
          const state = wrap.querySelector('.cam-state');
          if (state) {
            const hint = handHintFor(panel.n, Boolean(panel.stream), panel.hud.camLive);
            state.hidden = !panel.stream && hint === 'No cam';
            state.textContent = panel.stream ? hint : '';
            state.classList.toggle('ok', hands[panel.n] > 0 || (panel.stream && handStatus[panel.n] === 'error'));
            state.classList.toggle('warn', Boolean(panel.stream) && handStatus[panel.n] === 'ready' && hands[panel.n] === 0);
          }
          const wait = cam.querySelector('.cam-waiting span');
          if (wait) wait.textContent = panel.waiting;
          const hudMount = wrap.querySelector('[data-hud]');
          const hint = handHintFor(panel.n, Boolean(panel.stream), panel.hud.camLive);
          const meta = Object.assign(hudMeta(clock, panel.n, panel.mine), {
            seat: panel.n,
            attackMode: Boolean(panel.mine && attack.mode),
          });
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
            const atk = hudMount.querySelector('[data-attack]');
            if (atk) {
              atk.onclick = () => {
                if (attack.mode) resetAttack();
                else {
                  attack.mode = 'attacker';
                  toast(root, attackHint(), true);
                }
                renderChrome();
              };
            }
          } else {
            const hero = hudMount.querySelector('[data-hero]');
            if (hero) {
              hero.classList.toggle('is-target', attack.mode === 'target');
              hero.onclick = () => onHeroTarget(panel.n);
            }
          }
        }
        paintSide('top', top);
        paintSide('bottom', bottom);
        renderDecksPanel();

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
                ${typeof opts.onHostGate === 'function' ? '<button type="button" class="btn" data-host-lock>Admin or host can lock</button>' : ''}`;
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

      function onPeekCorrect(e) {
        const lane = e.detail && e.detail.lane;
        const seatN = Number(e.detail && e.detail.seat);
        if (!lane || (seatN !== 1 && seatN !== 2)) return;
        const Watch = global.DdlIrlWatch;
        if (Watch && Watch.isPileLane(lane)) return;
        pickerLane = { seat: seatN, key: lane };
        renderLanePicker();
      }

      function close() {
        clearTimeout(flipTimer);
        clearInterval(shotTimer);
        clearInterval(watchTimer);
        window.removeEventListener('ddl-irl-peek-correct', onPeekCorrect);
        if (global.DdlIrlHands) DdlIrlHands.stopAll();
        if (global.DdlIrlCatalog) DdlIrlCatalog.hidePeek();
        Object.keys(handWatchers).forEach((k) => {
          if (handWatchers[k] && handWatchers[k].stop) handWatchers[k].stop();
          handWatchers[k] = null;
        });
        if (localStream) localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
        p2p.close();
      }

      if (global.DdlIrlCatalog) {
        DdlIrlCatalog.bindPeekRoot(root);
        window.addEventListener('ddl-irl-peek-correct', onPeekCorrect);
        DdlIrlCatalog.load().then(() => {
          catalogReady = true;
          if (global.DdlIrlWatch) DdlIrlWatch.loadPrints();
          renderChrome();
        }).catch(() => {
          catalogReady = false;
        });
      }
      shotTimer = setInterval(tickShot, 250);
      watchTimer = setInterval(runWatch, 800);
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
    TURN_MS,
  };
})(window);
