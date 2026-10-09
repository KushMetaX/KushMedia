/**
 * Rise of the Pack checklist: tick cards by hand or scan them with a phone / webcam / photo.
 * Shares `ddl-collection-v1` with the DD Evaluator's DDL mode (same checklist PDF).
 */
(function () {
  "use strict";

  const CHECK = window.DDL_CHECKLIST;
  const view = document.getElementById("view-checklist");
  if (!view) return;
  if (!CHECK || !Array.isArray(CHECK.cards)) {
    document.getElementById("cl-summary").innerHTML = '<p class="meta">The checklist data did not load. Refresh the page to try again.</p>';
    return;
  }

  const STORE_KEY = "ddl-collection-v1";
  const AUTO_KEY = "ddl-scan-auto";
  const CAMERA_KEY = "ddl-scan-camera";
  const SCAN_SCRIPTS = ["shared/ddl-prints.js?v=cl1", "shared/ddl-name-prints.js?v=cl4", "shared/irl-watch.js?v=cl7"];
  const LABEL = CHECK.printLabels;
  const byId = new Map(CHECK.cards.map((c) => [c.id, c]));
  const $ = (id) => document.getElementById(id);

  let collection = load();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  /* ---------- storage ---------- */

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (_err) {
      return {};
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(collection)); } catch (_err) { /* private mode */ }
  }

  function held(id, print) {
    const row = collection[id] && collection[id][print];
    if (!row) return { raw: 0, graded: [] };
    return { raw: Math.max(0, Number(row.raw) || 0), graded: Array.isArray(row.graded) ? row.graded : [] };
  }

  function count(id, print) {
    const h = held(id, print);
    return h.raw + h.graded.length;
  }

  function setRaw(id, print, raw) {
    const h = held(id, print);
    const next = Math.max(0, Math.min(999, raw));
    collection[id] = collection[id] || {};
    if (!next && !h.graded.length) delete collection[id][print];
    else collection[id][print] = { raw: next, graded: h.graded };
    if (!Object.keys(collection[id]).length) delete collection[id];
    save();
    render();
  }

  function clearPrint(id, print) {
    if (collection[id]) {
      delete collection[id][print];
      if (!Object.keys(collection[id]).length) delete collection[id];
    }
    save();
    render();
  }

  /* ---------- summary ---------- */

  function stat(label, have, total) {
    const pct = total ? Math.round((have / total) * 100) : 0;
    return `<div class="cl-stat">
      <span class="cl-stat-l">${label}</span>
      <span class="cl-stat-v">${have}<small> / ${total}</small></span>
      <span class="cl-bar"><i style="width:${pct}%"></i></span>
    </div>`;
  }

  function renderSummary() {
    let names = 0, prints = 0, chase = 0, holos = 0, total = 0, dupes = 0;
    const chaseTotal = CHECK.cards.filter((c) => c.chase).length;
    const holoTotal = CHECK.cards.filter((c) => c.prints.includes("holo")).length;
    CHECK.cards.forEach((c) => {
      let any = false;
      slotList(c).forEach((p) => {
        const n = count(c.id, p);
        if (!n) return;
        any = true;
        total += n;
        dupes += n - 1;
        if (!c.prints.includes(p)) return;
        prints += 1;
        if (p === "fa") chase += 1;
        if (p === "holo") holos += 1;
      });
      if (any) names += 1;
    });
    $("cl-summary").innerHTML = `
      ${stat("Names", names, CHECK.names)}
      ${stat("Master set", prints, CHECK.master)}
      ${stat("Holos", holos, holoTotal)}
      ${stat("Full Art chase", chase, chaseTotal)}
      <div class="cl-stat cl-stat-plain">
        <span class="cl-stat-l">Cards held</span>
        <span class="cl-stat-v">${total}</span>
        <span class="cl-stat-s">${dupes} spare${dupes === 1 ? "" : "s"} for trade</span>
      </div>`;
  }

  /* ---------- list ---------- */

  function matchesQuery(card, q) {
    if (!q) return true;
    const num = q.replace(/^#|^v0*/i, "");
    if (/^\d+$/.test(num)) return card.no === Number(num);
    const hay = [card.name, card.id, card.class, card.tierLabel].concat(card.aliases || []).join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function filtered() {
    const q = $("cl-q").value.trim();
    const tier = $("cl-tier").value;
    const cls = $("cl-class").value;
    const show = $("cl-show").value;
    return CHECK.cards.filter((c) => {
      if (!matchesQuery(c, q)) return false;
      if (tier && c.tier !== tier) return false;
      if (cls && c.class !== cls) return false;
      const official = c.prints.map((p) => count(c.id, p));
      const copies = slotList(c).map((p) => count(c.id, p));
      if (show === "missing" && official.every((n) => n > 0)) return false;
      if (show === "owned" && official.every((n) => !n) && copies.every((n) => !n)) return false;
      if (show === "spares" && copies.every((n) => n < 2)) return false;
      return true;
    });
  }

  function slotList(card) {
    return card.chase ? ["base", "fa"] : card.prints;
  }

  function printCell(card, p) {
    const h = held(card.id, p);
    const n = h.raw;
    const on = n + h.graded.length > 0;
    const label = p === "base" && card.chase ? "Base" : LABEL[p];
    return `<div class="cl-print${on ? " on" : ""}" data-hold="${card.id}|${p}">
      <button type="button" class="cl-tick" data-tick aria-pressed="${on}">${label}</button>
      <span class="cl-qty"><button type="button" data-step="-1" aria-label="One less ${esc(card.name)} ${esc(label)}">−</button><b>${n}</b><button type="button" data-step="1" aria-label="One more ${esc(card.name)} ${esc(label)}">+</button>${h.graded.length ? `<small class="cl-graded" title="${h.graded.length} graded">+${h.graded.length}</small>` : ""}</span>
    </div>`;
  }

  function rowHtml(card) {
    const done = card.prints.every((p) => count(card.id, p) > 0);
    return `<li class="cl-row${done ? " done" : ""}">
      <span class="cl-no">${String(card.no).padStart(3, "0")}</span>
      <img class="cl-thumb" src="${esc(card.render)}" alt="" loading="lazy" width="42" height="58">
      <span class="cl-name">
        <b>${esc(card.name)} <span class="serial cl-serial">#${String(card.no).padStart(3, "0")}</span></b>
        <span class="cl-tags"><span class="chip cl-tier-${card.tier}">${esc(card.tierLabel)}</span><span class="chip class-${card.class.toLowerCase()}">${esc(card.class)}</span></span>
      </span>
      <span class="cl-prints">${slotList(card).map((p) => printCell(card, p)).join("")}</span>
    </li>`;
  }

  function renderRows() {
    const list = filtered();
    $("cl-rows").innerHTML = list.length
      ? list.map(rowHtml).join("")
      : '<li class="cl-empty">No cards match these filters.</li>';
    $("cl-meta").textContent = `${list.length} of ${CHECK.cards.length} cards shown`;
  }

  function render() {
    renderSummary();
    renderRows();
  }

  /* ---------- checklist PDF ---------- */

  function keepGrades(prev) {
    return prev && Array.isArray(prev.graded)
      ? prev.graded.filter((g) => typeof g === "string" && /^(PSA|BGS|CGC|SGC) \d+(\.5)?$/.test(g)).slice(0, 50)
      : [];
  }

  function applyPdfCounts(counts) {
    const clean = {};
    CHECK.cards.forEach((card) => {
      slotList(card).forEach((p) => {
        const raw = Math.max(0, Math.min(999, Number(counts[card.id] && counts[card.id][p]) || 0));
        const graded = keepGrades(collection[card.id] && collection[card.id][p]);
        if (raw || graded.length) {
          clean[card.id] = clean[card.id] || {};
          clean[card.id][p] = { raw, graded };
        }
      });
    });
    collection = clean;
    save();
    render();
  }

  async function exportFile() {
    const btn = $("cl-export");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Making PDF…";
    try {
      if (!window.DDLChecklistPdf) throw new Error("The checklist PDF tools did not load. Refresh and try again.");
      await window.DDLChecklistPdf.download(CHECK, collection);
    } catch (err) {
      window.alert(err.message || "Could not make the checklist PDF.");
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  function importFile(file) {
    if (!window.DDLChecklistPdf) {
      window.alert("The checklist PDF tools did not load. Refresh and try again.");
      return;
    }
    window.DDLChecklistPdf.readFile(file, CHECK).then((counts) => {
      applyPdfCounts(counts);
    }).catch((err) => {
      window.alert(err && err.message ? err.message : "That PDF is not a Rise of the Pack checklist.");
    });
  }

  async function copyMissing() {
    const lines = [];
    CHECK.cards.forEach((c) => {
      const missing = c.prints.filter((p) => !count(c.id, p));
      if (missing.length) lines.push(`${c.id} ${c.name} (${missing.map((p) => LABEL[p]).join(", ")})`);
    });
    const text = lines.length
      ? `# DDL ${CHECK.set} - missing ${lines.length}\n${lines.join("\n")}`
      : `# DDL ${CHECK.set} - master set complete`;
    try {
      await navigator.clipboard.writeText(text);
      flash("cl-copy", "Copied");
    } catch (_err) {
      window.prompt("Copy your missing list", text);
    }
  }

  function flash(id, text) {
    const btn = $(id);
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }

  /* ---------- scanner ---------- */

  // A close call must repeat. A clear winner among the set is shown on the frame it is read.
  const SCAN_STREAK = 2;
  // Best-guess score above which the frame probably holds a card that is not yet readable.
  const SCAN_NEAR = 0.42;
  const scan = {
    stream: null, timer: 0, busy: false, lastId: "", streak: 0,
    cooldownUntil: 0, justAdded: "", shownId: "", misses: 0, gone: 0, photo: false,
  };
  let scriptsReady = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load the card scanner. Check your connection and try again."));
      document.head.appendChild(s);
    });
  }

  function loadScanner() {
    if (!scriptsReady) {
      scriptsReady = SCAN_SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .then(() => {
          const W = window.DdlIrlWatch;
          if (!W || typeof W.scanStill !== "function" || !W.printCount()) throw new Error("The card scanner did not load.");
          return W;
        })
        .catch((err) => {
          scriptsReady = null;
          throw err;
        });
    }
    return scriptsReady;
  }

  function status(text) {
    $("cl-status").textContent = text;
  }

  function autoMode() {
    return $("cl-auto").value;
  }

  function guideRectInVideo(video, guide) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    return {
      x: (gr.left - vr.left - offX) / scale,
      y: (gr.top - vr.top - offY) / scale,
      w: gr.width / scale,
      h: gr.height / scale,
    };
  }

  function addButtons(card) {
    return card.prints.map((p) => {
      const n = count(card.id, p);
      return `<button type="button" class="btn" data-scan-add="${card.id}|${p}">+ ${LABEL[p]}${n ? ` <small>(have ${n})</small>` : ""}</button>`;
    }).join("");
  }

  function readName(hit) {
    return hit && hit.nameText ? String(hit.nameText).toUpperCase() : "";
  }

  function resultHtml(card, ranked, note, hit) {
    const read = readName(hit);
    const artOk = !!(hit && hit.artOk);
    const alts = (ranked || []).filter((r) => r.id !== card.id).slice(0, 3)
      .map((r) => byId.get(r.id)).filter(Boolean)
      .map((c) => `<button type="button" class="cl-alt" data-scan-pick="${c.id}">${esc(c.name)}</button>`).join("");
    return `<div class="cl-hit">
      <img src="${esc(card.render)}" alt="">
      <div>
        <p class="cl-hit-name"><b>${esc(card.name)}</b> <span class="serial">${card.id}</span></p>
        ${read ? `<p class="meta cl-read">Name read: <b>${esc(read)}</b>${artOk ? " <span>matches the art</span>" : ""}</p>` : ""}
        <p class="meta">${esc(note || (card.chase ? "Full Art chase card." : "The camera can't tell Base from Holo, so pick one."))}</p>
        <div class="cl-hit-add">${addButtons(card)}</div>
        ${alts ? `<p class="meta cl-alts">Not it? ${alts}</p>` : ""}
      </div>
    </div>`;
  }

  function clearResult() {
    scan.shownId = "";
    const box = $("cl-result");
    if (box) box.innerHTML = "";
    const dlg = $("cl-scan-dialog");
    if (dlg) dlg.classList.remove("has-result");
  }

  function showCard(card, ranked, note, hit) {
    const box = $("cl-result");
    box.innerHTML = resultHtml(card, ranked, note, hit);
    scan.shownId = card.id;
    $("cl-scan-dialog").classList.add("has-result");
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function addFromScan(id, print, via, read) {
    const card = byId.get(id);
    if (!card || !card.prints.includes(print)) return;
    setRaw(id, print, held(id, print).raw + 1);
    scan.justAdded = id;
    scan.cooldownUntil = Date.now() + 1200;
    scan.misses = 0;
    clearResult();
    if (navigator.vibrate) navigator.vibrate(35);
    const lead = read ? `Read "${read}". ` : "";
    status(scan.photo
      ? `${lead}Added ${card.name} ${LABEL[print]}. Pick another photo or add by name.`
      : `${lead}Added ${card.name} ${LABEL[print]}. Show the next card. To add another copy, move it out of the frame and back.`);
    const li = document.createElement("li");
    li.innerHTML = `<span><b>${esc(card.name)}</b> ${LABEL[print]}${via ? ` <small>${esc(via)}</small>` : ""}</span>
      <button type="button" class="cl-undo" data-undo="${id}|${print}">Undo</button>`;
    $("cl-log").prepend(li);
  }

  function handleHit(card, ranked, hit, note) {
    const mode = autoMode();
    const print = card.chase ? "fa" : mode;
    const read = readName(hit);
    if (hit && hit.artOk && mode !== "ask" && card.prints.includes(print)) {
      addFromScan(card.id, print, "scanned", read);
      return;
    }
    status(read ? `Read "${read}". Pick the print to add it.` : `Found ${card.name}. Pick the print to add it.`);
    showCard(card, ranked, note || "", hit);
  }

  /** Name text for the status line. A card is only opened once this name and the art are the same card. */
  function confidentName(out) {
    const name = out && out.name;
    if (!name || !name.id || !(name.score >= 0.55) || !(name.gap >= 0.03)) return null;
    return name;
  }

  function scanTick() {
    const video = $("cl-video");
    const W = window.DdlIrlWatch;
    if (!W || !video.videoWidth || Date.now() < scan.cooldownUntil) return;
    const out = W.scanFrame(video, guideRectInVideo(video, $("cl-guide")));
    const name = confidentName(out);
    if (out.hit) {
      scan.gone = 0;
      scan.misses = 0;
      scan.streak = out.hit.id === scan.lastId ? scan.streak + 1 : 1;
      scan.lastId = out.hit.id;
      const read = (name && name.id === out.hit.id ? String(name.text || "") : (out.hit.nameText || "")).toUpperCase();
      const need = out.hit.decisive ? 1 : SCAN_STREAK;
      if (scan.streak < need) {
        if (read && out.hit.id !== scan.shownId) status(`Reading "${read}"... hold it steady.`);
        return;
      }
      if (out.hit.id === scan.justAdded || out.hit.id === scan.shownId) return;
      const card = byId.get(out.hit.id);
      if (!card) return;
      handleHit(card, out.ranked, Object.assign({}, out.hit, { artOk: true }));
      return;
    }
    scan.streak = 0;
    scan.lastId = "";
    if (!(out.top && out.top.score >= SCAN_NEAR)) {
      scan.gone += 1;
      scan.misses = 0;
      if (scan.gone >= 2) scan.justAdded = "";
      if (!scan.shownId) status("Hold one card flat inside the frame.");
      return;
    }
    scan.gone = 0;
    scan.misses += 1;
    if (scan.shownId) return;
    const read = name ? String(name.text || "").toUpperCase() : "";
    if (name && out.top && name.id !== out.top.id) status(`The name reads "${read}" but the art doesn't match that card. Hold it steady, or add it by name below.`);
    else if (scan.misses >= 8) status("Still reading. Fill the frame with the card, keep the name in view and tilt it away from glare.");
    else status(read ? `Reading "${read}"... hold it steady.` : "Card seen. Hold it steady so the name can be read.");
  }

  function loop() {
    if (!scan.stream) return;
    const started = performance.now();
    try { scanTick(); } catch (_err) { /* one bad frame should not stop the loop */ }
    const spent = performance.now() - started;
    scan.timer = window.setTimeout(loop, Math.max(40, 120 - spent));
  }

  async function listCameras() {
    const select = $("cl-camera");
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
    const current = scan.stream && scan.stream.getVideoTracks()[0];
    const currentId = current && current.getSettings ? current.getSettings().deviceId : "";
    select.innerHTML = devices.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Camera ${i + 1}`)}</option>`).join("");
    if (currentId) select.value = currentId;
    select.closest(".field").hidden = devices.length < 2;
  }

  function torchTrack() {
    const track = scan.stream && scan.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    return caps && caps.torch ? track : null;
  }

  /** getUserMedia must be reached before the first await so the tap still counts as the gesture. */
  async function startCamera(deviceId, strict) {
    stopCamera();
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (deviceId) video.deviceId = strict ? { exact: deviceId } : { ideal: deviceId };
    else video.facingMode = { ideal: "environment" };
    scan.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const el = $("cl-video");
    el.srcObject = scan.stream;
    await el.play().catch(() => {});
    $("cl-stage").classList.remove("is-photo");
    scan.photo = false;
    $("cl-torch").hidden = !torchTrack();
    $("cl-torch").setAttribute("aria-pressed", "false");
    listCameras().catch(() => {});
    status("Hold one card flat inside the frame.");
    loop();
  }

  function stopCamera() {
    window.clearTimeout(scan.timer);
    scan.timer = 0;
    if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
    scan.stream = null;
    const el = $("cl-video");
    if (el) el.srcObject = null;
    scan.lastId = "";
    scan.streak = 0;
    scan.justAdded = "";
    scan.misses = 0;
  }

  function cameraBlockedHelp(err) {
    const ua = navigator.userAgent;
    const brave = !!navigator.brave;
    const app = brave ? "Brave" : "your browser";
    const android = /Android/i.test(ua);
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const msg = String((err && err.message) || "");
    if (/dismiss/i.test(msg)) return "The camera prompt was closed. Tap Live camera to ask again.";
    if (/system/i.test(msg)) {
      return android
        ? `Your phone is blocking the camera for ${app}. Open Android Settings › Apps › ${brave ? "Brave" : "your browser"} › Permissions › Camera › Allow, then tap Live camera.`
        : `Your computer is blocking the camera for ${app}. On Windows: Settings › Privacy & security › Camera, turn on camera access for desktop apps. On Mac: System Settings › Privacy & Security › Camera, tick ${app}. Then press Live camera.`;
    }
    if (ios) return `Camera is blocked. Open iOS Settings › ${brave ? "Brave" : "Safari"} › Camera › Ask or Allow, reload this page, then tap Live camera. Or use a photo.`;
    if (android) return `Camera is blocked for this site. Tap the icon left of the address bar › Permissions › Camera › Allow, then tap Live camera. If no prompt appears, allow Camera for ${app} in Android Settings › Apps.`;
    return `Camera is blocked for this site. Click the icon at the left of the address bar, set Camera to Allow, then press Live camera.${brave ? " In Brave you can also check brave://settings/content/camera." : ""} Or use a photo.`;
  }

  function cameraError(err) {
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return cameraBlockedHelp(err);
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No camera found. Use a photo or add cards by name below.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The camera is busy or blocked by another app. Close other apps using it, or use a photo instead.";
    }
    return (err && err.message) || "Could not start the camera.";
  }

  async function openScanner() {
    const dlg = $("cl-scan-dialog");
    clearResult();
    if (!dlg.open) dlg.showModal();
    if (!window.isSecureContext) {
      status("The camera only works on the https:// version of this page. Use a photo or add cards by name below.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status("This browser can't open the camera. Use a photo or add cards by name below.");
      return;
    }
    status("Allow camera access to start scanning.");
    const scripts = loadScanner();
    scripts.catch(() => {});
    let saved = "";
    try { saved = localStorage.getItem(CAMERA_KEY) || ""; } catch (_err) { /* ignore */ }
    try {
      await startCamera(saved, false);
    } catch (err) {
      status(cameraError(err));
      return;
    }
    try {
      await scripts;
    } catch (err) {
      stopCamera();
      status(err.message);
      return;
    }
    if (!dlg.open) stopCamera();
  }

  async function scanPhoto(file) {
    const dlg = $("cl-scan-dialog");
    if (!dlg.open) dlg.showModal();
    stopCamera();
    scan.photo = true;
    clearResult();
    $("cl-torch").hidden = true;
    status("Reading your photo…");
    let W;
    try {
      W = await loadScanner();
    } catch (err) {
      status(err.message);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("That file isn't an image the browser can open."));
        el.src = url;
      });
      const max = 1400;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const preview = $("cl-photo-preview");
      preview.src = canvas.toDataURL("image/jpeg", 0.85);
      $("cl-stage").classList.add("is-photo");
      const best = W.scanStill(canvas);
      if (!best) {
        status("No card matched in that photo. Crop close to one card with the full face showing, or add it by name below.");
        return;
      }
      const card = byId.get(best.hit.id);
      if (!card) return;
      const read = readName(best.hit);
      best.hit.artOk = true;
      status(read ? `Read "${read}" in your photo.` : `Found ${card.name} in your photo.`);
      showCard(card, best.ranked, "", best.hit);
    } catch (err) {
      status(err.message || "Could not read that photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function renderManual() {
    const q = $("cl-manual").value.trim();
    const box = $("cl-manual-hits");
    if (!q) {
      box.innerHTML = "";
      return;
    }
    const hits = CHECK.cards.filter((c) => matchesQuery(c, q)).slice(0, 6);
    box.innerHTML = hits.length
      ? hits.map((c) => `<div class="cl-manual-row">
          <span><b>${esc(c.name)}</b> <span class="serial">${c.id}</span></span>
          <span class="cl-hit-add">${c.prints.map((p) => `<button type="button" class="btn ghost" data-manual-add="${c.id}|${p}">+ ${LABEL[p]}</button>`).join("")}</span>
        </div>`).join("")
      : '<p class="meta">No card by that name or number.</p>';
  }

  /* ---------- events ---------- */

  const tierSelect = $("cl-tier");
  tierSelect.innerHTML = '<option value="">Every rarity</option>' +
    [["CR", "Common / Rare"], ["UR", "Ultra Rare"], ["GIGA", "Giga Rare"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const classes = [...new Set(CHECK.cards.map((c) => c.class))].sort();
  $("cl-class").innerHTML = '<option value="">Every class</option>' + classes.map((c) => `<option>${esc(c)}</option>`).join("");

  $("cl-q").addEventListener("input", renderRows);
  ["cl-tier", "cl-class", "cl-show"].forEach((id) => $(id).addEventListener("change", renderRows));

  $("cl-rows").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-hold]");
    if (!cell) return;
    const [id, print] = cell.dataset.hold.split("|");
    if (e.target.closest("[data-tick]")) {
      if (count(id, print)) clearPrint(id, print);
      else setRaw(id, print, 1);
      return;
    }
    const step = e.target.closest("[data-step]");
    if (step) {
      const h = held(id, print);
      const next = h.raw + Number(step.dataset.step);
      if (next <= 0 && !h.graded.length) clearPrint(id, print);
      else setRaw(id, print, Math.max(0, next));
    }
  });

  $("cl-scan").addEventListener("click", openScanner);
  $("cl-export").addEventListener("click", exportFile);
  $("cl-copy").addEventListener("click", copyMissing);
  $("cl-import").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importFile(file);
    e.target.value = "";
  });
  $("cl-clear").addEventListener("click", () => {
    if (!Object.keys(collection).length) return;
    if (!window.confirm("Clear every card from your checklist on this device?")) return;
    collection = {};
    save();
    render();
  });

  const dlg = $("cl-scan-dialog");
  dlg.addEventListener("close", () => {
    stopCamera();
    scan.photo = false;
    $("cl-stage").classList.remove("is-photo");
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) {
      dlg.close();
      return;
    }
    const add = e.target.closest("[data-scan-add]");
    if (add) {
      const [id, print] = add.dataset.scanAdd.split("|");
      addFromScan(id, print, scan.photo ? "photo" : "scanned");
      return;
    }
    const manual = e.target.closest("[data-manual-add]");
    if (manual) {
      const [id, print] = manual.dataset.manualAdd.split("|");
      addFromScan(id, print, "by name");
      renderManual();
      return;
    }
    const pick = e.target.closest("[data-scan-pick]");
    if (pick) {
      const card = byId.get(pick.dataset.scanPick);
      if (card) showCard(card, [], card.chase ? "Full Art chase card." : "Pick the print to add it.");
      return;
    }
    const undo = e.target.closest("[data-undo]");
    if (undo) {
      const [id, print] = undo.dataset.undo.split("|");
      const h = held(id, print);
      if (h.raw > 1 || h.graded.length) setRaw(id, print, h.raw - 1);
      else clearPrint(id, print);
      const li = undo.closest("li");
      li.classList.add("undone");
      undo.remove();
      if (scan.justAdded === id) scan.justAdded = "";
      return;
    }
    if (e.target.closest("#cl-torch")) {
      const track = torchTrack();
      if (!track) return;
      const on = $("cl-torch").getAttribute("aria-pressed") !== "true";
      track.applyConstraints({ advanced: [{ torch: on }] })
        .then(() => $("cl-torch").setAttribute("aria-pressed", String(on)))
        .catch(() => { $("cl-torch").hidden = true; });
    }
  });

  $("cl-camera").addEventListener("change", (e) => {
    const id = e.target.value;
    try { localStorage.setItem(CAMERA_KEY, id); } catch (_err) { /* ignore */ }
    startCamera(id, true).catch((err) => status(cameraError(err)));
  });

  $("cl-live").addEventListener("click", () => {
    if (scan.stream) return;
    openScanner();
  });

  $("cl-photo").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) scanPhoto(file);
    e.target.value = "";
  });

  try {
    const savedAuto = localStorage.getItem(AUTO_KEY);
    if (savedAuto && [...$("cl-auto").options].some((o) => o.value === savedAuto)) $("cl-auto").value = savedAuto;
  } catch (_err) { /* ignore */ }
  $("cl-auto").addEventListener("change", (e) => {
    try { localStorage.setItem(AUTO_KEY, e.target.value); } catch (_err) { /* ignore */ }
    if (scan.photo) return;
    scan.lastId = "";
    scan.streak = 0;
    clearResult();
  });

  $("cl-manual").addEventListener("input", renderManual);

  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    collection = load();
    render();
  });

  render();
})();
