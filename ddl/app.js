const D = window.DDL;
if (!D) {
  document.body.innerHTML = "<p style='padding:2rem'>Missing web/data/ddl.js — run <code>python scripts/scrape.py</code>.</p>";
  throw new Error("DDL data missing");
}

const $ = (id) => document.getElementById(id);
const CLASSES = ["Crown", "Bow", "Wizard", "Zombie", "Pirate", "Neutral", "All"];
const CLASS_COLOR = {
  Crown: "class-crown",
  Bow: "class-bow",
  Wizard: "class-wizard",
  Zombie: "class-zombie",
  Pirate: "class-pirate",
  Neutral: "class-neutral",
  All: "class-all",
};

document.getElementById("scraped-at").textContent = D.scraped_at
  ? `Card data last pulled ${new Date(D.scraped_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}.`
  : "";

function legalFor(card, heroClass) {
  const heroes = Array.isArray(heroClass) ? heroClass.filter(Boolean) : [heroClass];
  if (card.all_class || card.class === "All" || card.class === "Neutral") return true;
  return heroes.includes(card.class);
}

function chips(card) {
  const bits = [
    card.class,
    card.type,
    card.pill,
    card.keyword,
    card.gallery_revealed ? "In gallery" : "Play only",
    card.rarity,
  ].filter(Boolean);
  return bits
    .map((b) => `<span class="chip ${CLASS_COLOR[b] || ""}">${b}</span>`)
    .join("");
}

function statsLine(card) {
  if (card.type === "Creature") return `${card.mana} mana · ${card.attack}/${card.hp}`;
  return `${card.mana} mana · ${card.type}`;
}

function artHtml(card, cls = "card-art") {
  const fallback = `<div class="card-fallback ${CLASS_COLOR[card.class] || ""}" ${card.render ? "hidden" : ""}>${card.name.slice(0, 1)}</div>`;
  if (!card.render) return fallback;
  return `<img class="${cls}" src="${card.render}" alt="" loading="lazy" onerror="const p=this.parentElement; this.remove(); const fb=p && p.querySelector('.card-fallback'); if(fb) fb.hidden=false;">${fallback}`;
}

function cardHtml(card) {
  return `<button type="button" class="card" data-id="${card.id}">
    <div class="card-art-wrap">${artHtml(card)}</div>
    <div class="card-body">
      <div class="card-top">
        <div>
          <div class="name">${card.name}</div>
          <div class="serial">${card.id}</div>
        </div>
        <div class="stats">${statsLine(card)}</div>
      </div>
      ${card.text ? `<div class="text">${card.text}</div>` : ""}
      <div class="chips">${chips(card)}</div>
    </div>
  </button>`;
}

function fillClassSelect(sel, withAll) {
  sel.innerHTML = (withAll ? `<option value="">All classes</option>` : "") +
    CLASSES.filter((c) => c !== "Neutral" && c !== "All" || withAll)
      .map((c) => `<option value="${c}">${c === "All" ? "All-class" : c}</option>`)
      .join("");
}

/* ---------- Cards ---------- */
const q = $("q");
const fClass = $("f-class");
const fType = $("f-type");
const fPill = $("f-pill");
const fRevealed = $("f-revealed");
const fSort = $("f-sort");
fillClassSelect(fClass, true);

function renderClassChips() {
  const chipsEl = $("class-chips");
  if (!chipsEl) return;
  const opts = ["", ...CLASSES];
  const label = (c) => c === "" ? "All classes" : c === "All" ? "All-class" : c;
  chipsEl.innerHTML = opts.map((c) => `
    <button type="button" class="chip-btn ${CLASS_COLOR[c] || ""} ${fClass.value === c ? "active" : ""}" data-class="${c}">
      ${label(c)}
    </button>`).join("");
}

function filteredCards() {
  const term = (q.value || "").trim().toLowerCase();
  const list = D.cards.filter((c) => {
    if (fClass.value) {
      const v = fClass.value;
      const ok =
        c.class === v ||
        (c.classes || []).includes(v) ||
        (v !== "Neutral" && c.all_class);
      if (!ok) return false;
    }
    if (fType.value && c.type !== fType.value) return false;
    if (fPill.value && c.pill !== fPill.value) return false;
    if (fRevealed.checked && !c.gallery_revealed) return false;
    if (!term) return true;
    return `${c.name} ${c.id} ${c.text} ${c.keyword} ${c.pill}`.toLowerCase().includes(term);
  });
  const sort = fSort?.value || "mana";
  list.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "class") return a.class.localeCompare(b.class) || a.mana - b.mana || a.name.localeCompare(b.name);
    return (a.mana || 0) - (b.mana || 0) || a.name.localeCompare(b.name);
  });
  return list;
}

function renderCards() {
  const list = filteredCards();
  const shown = D.revealed.length;
  $("card-meta").textContent = list.length === D.cards.length
    ? `${list.length} cards · ${shown} have official gallery art`
    : `${list.length} matching · ${D.cards.length} in the set`;
  $("card-grid").innerHTML = list.length
    ? list.map(cardHtml).join("")
    : `<p class="empty">Nothing matches those filters. Clear a filter or try a shorter search.</p>`;
  renderClassChips();
}

$("class-chips")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-class]");
  if (!btn) return;
  fClass.value = btn.dataset.class;
  renderCards();
});

["input", "change"].forEach((ev) => {
  [q, fClass, fType, fPill, fRevealed, fSort].filter(Boolean).forEach((el) => el.addEventListener(ev, renderCards));
});

$("card-grid").addEventListener("click", (e) => {
  const node = e.target.closest("[data-id]");
  if (node) openModal(node.dataset.id);
});
$("view-prices").addEventListener("click", (e) => {
  const node = e.target.closest("[data-id]");
  if (node) openModal(node.dataset.id);
});

function closeModal() {
  $("modal").hidden = true;
}

function openModal(id) {
  hideCardPeek();
  const c = D.cards.find((x) => x.id === id);
  if (!c) return;
  const decks = (c.in_decks || [])
    .map((d) => D.decks.find((x) => x.id === d)?.name)
    .filter(Boolean);
  const rarity = c.scarcity != null
    ? `${c.rarity} · shows up in about ${c.rarity_pct}% of pack slots${c.tier ? " · " + c.tier : ""}`
    : "Rarity is not in the gallery yet, so the price page uses a simple estimate.";
  $("modal-card").innerHTML = `
    <button type="button" class="modal-close" id="modal-close" aria-label="Close">×</button>
    <div class="modal-layout">
      <div class="card-art-wrap">${artHtml(c)}</div>
      <div>
        <p class="eyebrow">${c.id}</p>
        <h2 id="modal-title">${c.name}</h2>
        <p class="stats">${statsLine(c)}</p>
        <div class="chips">${chips(c)}</div>
        <p>${c.text || "This card does not have printed rules text."}</p>
        <p class="lede">${decks.length ? "Named in official lists: " + decks.join(", ") : "Not named in the four public archetype lists."}</p>
        <p class="lede">${rarity}</p>
      </div>
    </div>`;
  $("modal").hidden = false;
  $("modal-close")?.focus();
}
$("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal" || e.target.id === "modal-close") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("modal") && !$("modal").hidden) closeModal();
    else hideCardPeek();
    return;
  }
  if (e.key !== "Enter" && e.key !== " ") return;
  const ref = e.target.closest && e.target.closest("[data-peek]");
  if (!ref) return;
  e.preventDefault();
  showCardPeek(ref.dataset.peek, ref, "pin");
});

/* Hover / tap: show the actual card next to a gold name. */
let peekMode = null;
let peekId = "";
let peekGuardUntil = 0;
let peekHideTimer = 0;

function peekCss() {
  return `#card-peek{display:none;position:fixed;z-index:99999;width:260px;pointer-events:none;filter:drop-shadow(0 16px 32px #000000aa)}
#card-peek.is-on{display:block}
#card-peek.is-pin{pointer-events:auto;width:min(320px,calc(100vw - 2rem))}
#card-peek img{width:100%;height:auto;display:block;border-radius:14px;background:#0d0a07}
#card-peek .peek-fallback{padding:1rem;border-radius:14px;background:#1a1410;border:1px solid #c4892a;color:#f8f1e4}
#card-peek .peek-fallback b{display:block;font-family:Georgia,serif;font-size:1.2rem;margin-bottom:.25rem}
#card-peek-scrim{display:none;position:fixed;inset:0;background:#000000b8;z-index:99998}
#card-peek-scrim.is-on{display:block}
#peek-close{position:absolute;top:.4rem;right:.4rem;width:2rem;height:2rem;border-radius:999px;border:1px solid #4a3c2c;background:#1d1610;color:#f8f1e4;cursor:pointer;font-size:1.1rem}`;
}

function ensureCardPeek() {
  if (!document.getElementById("card-peek-css")) {
    const css = document.createElement("style");
    css.id = "card-peek-css";
    css.textContent = peekCss() + `.card-ref{color:#e8b84a !important;-webkit-text-fill-color:#e8b84a !important;font-weight:800;text-decoration:underline dotted;cursor:help}`;
    document.head.appendChild(css);
  }
  let scrim = $("card-peek-scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.id = "card-peek-scrim";
    document.body.appendChild(scrim);
  }
  let el = $("card-peek");
  if (!el) {
    el = document.createElement("div");
    el.id = "card-peek";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
  }
  return el;
}

function hideCardPeek() {
  clearTimeout(peekHideTimer);
  peekMode = null;
  peekId = "";
  const el = $("card-peek");
  const scrim = $("card-peek-scrim");
  if (el) {
    el.classList.remove("is-on", "is-pin");
    el.innerHTML = "";
  }
  if (scrim) scrim.classList.remove("is-on");
}

function placePeek(el, x, y) {
  const pad = 12;
  const w = el.offsetWidth || 260;
  const h = el.offsetHeight || 360;
  let left = x + 18;
  let top = y - h * 0.35;
  if (left + w > window.innerWidth - pad) left = x - w - 18;
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function showCardPeek(id, evOrAnchor, mode) {
  const c = D.cards.find((x) => x.id === id);
  if (!c) return;
  const el = ensureCardPeek();
  const scrim = $("card-peek-scrim");
  const reuse = peekId === id && peekMode === mode && el.classList.contains("is-on");
  peekMode = mode;
  peekId = id;
  if (!reuse) {
    const art = c.render
      ? `<img src="${c.render}" alt="${esc(c.name)}" width="260" height="347">`
      : `<div class="peek-fallback"><b>${esc(c.name)}</b><span>${esc(statsLine(c))}</span><p>${esc(c.text || "This card does not have printed rules text.")}</p></div>`;
    el.innerHTML = `${mode === "pin" ? `<button type="button" id="peek-close" aria-label="Close">×</button>` : ""}${art}`;
    const img = el.querySelector("img");
    if (img) {
      img.addEventListener("load", () => {
        if (peekId === id && mode === "hover" && evOrAnchor && evOrAnchor.clientX != null) {
          placePeek(el, evOrAnchor.clientX, evOrAnchor.clientY);
        }
      }, { once: true });
    }
  }
  el.classList.add("is-on");
  el.classList.toggle("is-pin", mode === "pin");
  if (mode === "pin") {
    el.style.left = "50%";
    el.style.top = "50%";
    el.style.transform = "translate(-50%, -50%)";
    if (scrim) scrim.classList.add("is-on");
    peekGuardUntil = Date.now() + 400;
  } else {
    el.style.transform = "";
    if (scrim) scrim.classList.remove("is-on");
    const x = evOrAnchor && evOrAnchor.clientX != null ? evOrAnchor.clientX : (evOrAnchor && evOrAnchor.getBoundingClientRect ? evOrAnchor.getBoundingClientRect().right : 40);
    const y = evOrAnchor && evOrAnchor.clientY != null ? evOrAnchor.clientY : (evOrAnchor && evOrAnchor.getBoundingClientRect ? evOrAnchor.getBoundingClientRect().top : 40);
    placePeek(el, x, y);
  }
}

function initCardPeek() {
  ensureCardPeek();
  const cancelHide = () => clearTimeout(peekHideTimer);
  const laterHide = () => {
    if (peekMode === "pin") return;
    clearTimeout(peekHideTimer);
    peekHideTimer = setTimeout(hideCardPeek, 80);
  };

  document.addEventListener("mouseover", (e) => {
    if (peekMode === "pin" || ($("modal") && !$("modal").hidden)) return;
    const ref = e.target.closest("[data-peek]");
    if (!ref) return;
    cancelHide();
    showCardPeek(ref.dataset.peek, e, "hover");
  });
  document.addEventListener("mousemove", (e) => {
    if (peekMode !== "hover") return;
    const ref = e.target.closest("[data-peek]");
    if (!ref) return;
    const el = $("card-peek");
    if (el && el.classList.contains("is-on")) placePeek(el, e.clientX, e.clientY);
  });
  document.addEventListener("mouseout", (e) => {
    if (peekMode !== "hover") return;
    const ref = e.target.closest("[data-peek]");
    if (!ref) return;
    const to = e.relatedTarget;
    if (to && ref.contains(to)) return;
    laterHide();
  });
  document.addEventListener("click", (e) => {
    if (Date.now() < peekGuardUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest("#peek-close") || e.target.id === "card-peek-scrim") {
      e.preventDefault();
      hideCardPeek();
      return;
    }
    const ref = e.target.closest("[data-peek]");
    if (ref) {
      e.preventDefault();
      e.stopPropagation();
      showCardPeek(ref.dataset.peek, ref, "pin");
      return;
    }
    if (peekMode === "pin" && !e.target.closest("#card-peek")) hideCardPeek();
  }, true);
}

/* ---------- Mechanics ---------- */
function renderMechanics() {
  const m = D.mechanics;
  const r = D.rules;
  $("view-mechanics").innerHTML = `
    <header class="view-intro">
      <h2>How a match works</h2>
      <p>${m.game} — ${m.set}. You and your opponent each start at ${r.hero_hp} health. First to 0 loses. Decks are ${r.deck_size} cards. You can hold ${r.hand_max} cards.</p>
    </header>
    <div class="stat-pills">
      <span>${r.hero_hp} hero HP</span>
      <span>${r.deck_size}-card decks</span>
      <span>Max 3 copies</span>
      <span>Hand of ${r.hand_max}</span>
      <span>${r.equal_kills ? "Equal attack kills both" : "Equal attack does not kill"}</span>
    </div>

    <h3>Your turn, in three parts</h3>
    <div class="guide-grid">
      ${m.turn.map((t, i) => `<article class="guide-card"><span class="num">${i + 1}</span><p>${t}</p></article>`).join("")}
    </div>
    <article class="rule">
      <h3>Mana and the Coin</h3>
      <p>Leftover mana disappears at the end of the turn. ${m.mana.coin}</p>
      <p>${m.mana.boost_mode}</p>
    </article>

    <h3>The board</h3>
    <div class="guide-grid">
      <article class="guide-card"><h3>5 creature lanes</h3><p>${m.board.adjacency}</p></article>
      <article class="guide-card"><h3>5 spell / trap slots</h3><p>Passive spells and traps sit here for the rest of the game. Do not fill every slot on turn 2.</p></article>
      <article class="guide-card"><h3>Hand of ${m.board.hand_max}</h3><p>${m.board.overflow}</p></article>
    </div>

    <article class="rule">
      <h3>Building a deck</h3>
      <p>${m.deck.class_rule} You may run up to ${m.deck.max_copies} copies of a card. ${m.deck.neutral}</p>
    </article>

    <article class="rule">
      <h3>Traps are not optional</h3>
      <p>Live games are full of Ambush, Frost Lock, Blast, and Typhoon. Featured lists run <b>4–7 traps</b> unless the deck is a dedicated trap wall (Wizard Trap Lab). Race lists keep the floor (4) so the crackback does not just win. Counter the hole in your class as much as you build the clock.</p>
    </article>

    <h3>The three card types</h3>
    <div class="kw-grid">
      ${Object.entries(m.card_types).map(([k, v]) => `<article class="rule"><h3>${k}</h3><p>${v}</p></article>`).join("")}
    </div>

    <article class="rule">
      <h3>Combat, said plainly</h3>
      <p>${m.combat.select}</p>
      <p>${m.combat.kill_gate}</p>
      <p>${m.combat.equal_kills_text} ${m.combat.sickness} ${m.combat.rush_face}</p>
      <p>${m.combat.poison} ${m.combat.stacking}</p>
    </article>

    <h3>Words on the cards</h3>
    <p class="lede">${m.pills_vs_names}</p>
    <div class="kw-grid">
      ${Object.entries(m.keywords).map(([k, v]) => `<article class="rule"><h3>${k}</h3><p>${v}</p></article>`).join("")}
    </div>

    <h3>The four ways people win</h3>
    <div class="kw-grid">
      ${m.engines.map((e) => `<article class="rule"><h3>${e.name}</h3><p>${e.idea}</p></article>`).join("")}
    </div>

    <h3>Class advantages and disadvantages</h3>
    <p class="lede">Each class has a clock and a hole. Live players play the hole: Ambush the Mary swing, Frost Lock the Boogie, Typhoon the Garden. Pack answers for the hole as much as cards for the clock.</p>
    <div class="class-guide">
      ${(window.DDL_CLASSES || []).map((c) => `
        <article class="rule class-sheet">
          <p class="eyebrow ${CLASS_COLOR[c.id] || ""}">${c.role}</p>
          <h3>${c.id}</h3>
          <p>${c.clock}</p>
          <div class="pros-cons">
            <div>
              <h4>Advantage</h4>
              <p>${c.advantage}</p>
            </div>
            <div>
              <h4>Disadvantage</h4>
              <p>${c.disadvantage}</p>
            </div>
          </div>
          <p><b>Beats</b> ${c.beats}</p>
          <p><b>Loses to</b> ${c.loses}</p>
          <p class="lede">Wants: ${c.wants.join(" · ")}</p>
        </article>`).join("")}
    </div>

    <details class="fold">
      <summary>
        <span class="fold-title">Two-class mixes</span>
        <span class="fold-sub">Play’s builder asks for one hero class. Official lists still pair two colors, the same way Aggro Pack is Pirate + Zombie. Mini, Midi, and Mega count as every class, which turns on “if you control a …” spells.</span>
      </summary>
      <div class="mix-list">
        <div class="mix-row"><b>Pirate + Zombie</b><span>Shared Haunt. Pirate punches through walls (Venom) and draws when Pirates die (Chum). Zombie cashes Haunt on demand (Boogie, Sacrifice, Pact).</span></div>
        <div class="mix-row"><b>Bow + Wizard</b><span>Garden doubles Play; Scheme doubles end-of-turn. Two clocks. Mini keeps Bow spells live. Traps cover the Garden turn.</span></div>
        <div class="mix-row"><b>Crown + Wizard</b><span>Damage on both phases: Goji / Meditation at the start, Scheme / Surge at the end. Traps buy time while the math arms.</span></div>
        <div class="mix-row"><b>Crown + Bow</b><span>Icy and Taunt buy time. Garden Aria is the closer. Pulse keeps you alive against fast decks.</span></div>
        <div class="mix-row"><b>Crown + Zombie</b><span>Two graveyards. Shield / Avenge plus Shepherd / Reborn. The slowest fair deck.</span></div>
        <div class="mix-row"><b>Crown + Pirate</b><span>Dusty and Crown Taunts force trades. Haunt pays you. Icy blanks their face damage.</span></div>
        <div class="mix-row"><b>Bow + Pirate</b><span>Rush, Garden Play, and Venom / Loopy punching through walls. Fastest fair mix that is not pure Haunt.</span></div>
        <div class="mix-row"><b>Bow + Zombie</b><span>Play-summons (Cherry / Sweetie) plus graveyard-summons (Shepherd). Garden doubles the Play half.</span></div>
        <div class="mix-row"><b>Wizard + Pirate</b><span>Haunt face damage and Scheme end-of-turn burn at once. Blast reflects their Boogie.</span></div>
        <div class="mix-row"><b>Wizard + Zombie</b><span>Sacrifice / Boogie cash Haunt. Scheme only doubles Wizard end-of-turn — sit Surge next to Spark, Reaper next to Haunt bodies.</span></div>
      </div>
    </details>

    <article class="rule">
      <h3>Ways to play</h3>
      <ul>${m.modes.map((x) => `<li>${x}</li>`).join("")}</ul>
    </article>
  `;
}

/* ---------- Score + cook ---------- */
function scoreCard(card, arch, heroClass) {
  const text = (card.text || "").toLowerCase();
  const mana = Math.max(1, card.mana || 1);
  let s = 0;
  if (card.type === "Creature") s += ((card.attack || 0) + (card.hp || 0)) / mana * 5;
  if (Array.isArray(heroClass)) {
    if (heroClass.includes(card.class)) s += 6;
  } else if (card.class === heroClass) s += 4;
  if (card.all_class) s += 3;
  if ((card.in_decks || []).length) s += 10;

  const haunt = card.pill === "Haunt" || /haunt/.test(text);
  const eot = /end of your turn/.test(text);
  const sot = /start of your turn/.test(text);
  const extra = /additional time/.test(text);
  const draw = /draw/.test(text);
  const face = /enemy hero/.test(text);
  const destroy = /destroy/.test(text);
  const summon = /summon/.test(text);

  if (arch === "aggro") {
    if (mana <= 3) s += 10;
    if (mana >= 7) s -= 8;
    if (haunt) s += 14;
    if (["Pirate", "Zombie"].includes(card.class) || card.all_class) s += 6;
    if (face) s += 8;
    if (draw) s += 4;
    if (card.keyword === "Poison" || /poison/.test(text)) s += 10;
    if (card.type === "Trap") {
      const name = (card.name || "").toLowerCase();
      s += /ambush|blast|frost lock/.test(name) ? 8 : 3;
    }
    if (/typhoon|hunter/.test((card.name + text).toLowerCase())) s += 6;
    if (/boogie|sacrifice|pact|snake venom|chum/.test((card.name + text).toLowerCase())) s += 12;
  }
  if (arch === "control") {
    if (["Crown", "Neutral"].includes(card.class) || card.all_class) s += 5;
    if (sot || extra) s += 12;
    if (card.keyword === "Taunt") s += 8;
    if (card.type === "Trap") s += 9;
    if (/typhoon|hunter/.test((card.name + " " + text).toLowerCase())) s += 7;
    if (destroy && mana >= 5) s += 8;
    if (/immune|restore/.test(text)) s += 7;
    if (mana <= 1 && card.type === "Creature" && !sot) s += 2;
  }
  if (arch === "midrange") {
    if (["Bow", "Wizard"].includes(card.class) || card.all_class) s += 6;
    if (card.pill === "Play" && card.type === "Creature") s += 8;
    if (/garden|love shot|love bomb|connection|aria|mama/.test((card.name + " " + text).toLowerCase())) s += 12;
    if (summon) s += 6;
    if (card.keyword === "Poison") s += 6;
    if (mana >= 2 && mana <= 5) s += 4;
    if (card.type === "Trap") s += 7;
    if (/typhoon|hunter/.test((card.name + " " + text).toLowerCase())) s += 6;
  }
  if (arch === "combo") {
    if (["Wizard", "Neutral"].includes(card.class) || card.all_class) s += 5;
    if (eot || extra || /scheme|surge|wiggles|spark|poke/.test((card.name + " " + text).toLowerCase())) s += 14;
    if (card.type === "Trap") s += 11;
    if (/add up to 2 traps|wizard spell/.test(text)) s += 10;
    if (card.type === "Creature" && mana >= 6 && !eot) s -= 4;
  }
  return s;
}

function copiesFor(score) {
  if (score >= 28) return 3;
  if (score >= 18) return 2;
  return 1;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function rankBadge(band) {
  const b = String(band || "C").toUpperCase();
  return `<span class="rank rank-${b.toLowerCase()}" title="Strength band ${b}">${b}</span>`;
}

function rankDeck(rows, opts = {}) {
  const heroes = opts.heroes || [];
  const total = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const byType = { Creature: 0, Spell: 0, Trap: 0 };
  const qty = {};
  const names = new Set();
  let mana = 0;
  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + r.qty;
    qty[r.name] = (qty[r.name] || 0) + r.qty;
    names.add(r.name);
    mana += (r.mana || 0) * r.qty;
  }
  const avg = total ? mana / total : 0;
  const notes = [];
  let s = 30;
  const has = (n) => names.has(n);
  const n = (name) => qty[name] || 0;

  if (total === 40) s += 5;
  else {
    s -= Math.abs(40 - total) * 4;
    notes.push(total < 40 ? `${40 - total} cards short of 40` : `${total - 40} over 40`);
  }

  const traps = byType.Trap || 0;
  if (traps >= 4 && traps <= 7) {
    s += 10;
    notes.push(`${traps} traps — healthy answer density`);
  } else if (traps >= 8 && traps <= 12) {
    s += 8;
    notes.push(`${traps} traps — trap-lab shape (allowed for Wizard walls)`);
  } else if (traps === 3) {
    s += 3;
    notes.push("3 traps — light; most lists want 4–7 unless they are a dedicated race");
  } else if (traps <= 2) {
    s -= 12;
    notes.push(`${traps} trap${traps === 1 ? "" : "s"} — live players punish lists with no answers`);
  } else {
    s -= 6;
    notes.push(`${traps} traps — five slots, you will flood them`);
  }

  const kit = ["Ambush", "Blast", "Frost Lock", "Counterspell", "Typhoon", "Hunter", "Pitfall", "Divine Shield"].filter(has);
  s += Math.min(kit.length, 6) * 3;
  if (kit.length >= 4) notes.push("Broad answer kit: " + kit.slice(0, 4).join(", "));
  else if (kit.length <= 1) notes.push("Narrow answers — live players will play around the one trap you have");

  if (!has("Typhoon") && !has("Hunter")) {
    s -= 4;
    notes.push("No Typhoon/Hunter — their Scheme, Garden, or Meditation sits");
  }
  if (!has("Frost Lock") && !has("Icy") && !has("Blast")) {
    s -= 5;
    notes.push("No Frost Lock, Blast, or Icy — burst lethal is live against you");
  }

  let engines = 0;
  if (has("Garden") && (has("Aria") || has("Mary"))) engines++;
  if (has("Scheme") && (has("Wiggles") || has("Spark") || has("Poke"))) engines++;
  if (has("Meditation") && (has("Atlas") || has("Helios")) && has("Goji")) engines++;
  if ((has("Boogie") || has("Haunted House") || has("Reaper")) && (has("Toot") || has("Blade") || has("Dumpy"))) engines++;
  if (has("Snake Venom") && (has("Chum The Water") || has("Buster")) && (has("Blade") || has("Web"))) engines++;
  s += Math.min(engines, 3) * 7;
  if (has("Volt") && traps >= 8) s += 4;
  if (engines >= 2) notes.push("Two win cons — harder to trap both");
  if (engines === 0) {
    s -= 8;
    notes.push("No assembled engine (Garden, Scheme, Atlas stack, Haunt detonate, or Venom tempo)");
  }

  if (has("Snake Venom")) s += 3;
  if (has("Icy")) s += 2;
  if (has("Chum The Water")) s += 2;
  if (n("Garden") >= 2 || n("Scheme") >= 2 || n("Meditation") >= 2) s += 2;

  if (avg >= 2.2 && avg <= 3.15) s += 5;
  else if (avg > 3.4) {
    s -= 6;
    notes.push("High curve — dies to Haunt before it arms");
  } else if (avg < 2.05 && traps < 5) {
    s -= 2;
    notes.push("Very cheap — wins early or dies to the wall");
  }

  if ((byType.Creature || 0) >= 18 && byType.Creature <= 24) s += 2;
  if ((byType.Creature || 0) < 12 && !has("Scheme") && !has("Wiggles")) s -= 4;

  if (heroes.length) {
    const bad = rows.filter((r) => !legalFor(r, heroes));
    if (bad.length) {
      s -= 12;
      notes.push("Illegal off-class: " + [...new Set(bad.map((r) => r.name))].join(", "));
    }
  }

  s = Math.max(0, Math.min(100, Math.round(s)));
  const band = s >= 84 ? "S" : s >= 74 ? "A" : s >= 64 ? "B" : s >= 52 ? "C" : "D";
  return { score: s, band, notes, traps, avg, byType, total, clocks: engines };
}

function rankedFeatured() {
  return (window.DDL_BUILDS || []).map((b) => {
    const { rows, counts } = expandBuild(b);
    const rank = rankDeck(rows, { heroes: b.heroes || [b.hero] });
    return { build: b, rows, counts, rank };
  }).sort((a, b) => b.rank.score - a.rank.score || a.build.name.localeCompare(b.build.name));
}

function cookDeck(heroClass, arch) {
  arch = arch || "aggro";
  const heroes = Array.isArray(heroClass) ? heroClass.filter(Boolean) : [heroClass];
  const pool = D.cards.filter((c) => legalFor(c, heroes)).map((c) => ({
    card: c,
    score: scoreCard(c, arch, heroes),
  }));
  pool.sort((a, b) => b.score - a.score);

  const targets = {
    aggro: { creatures: 22, spells: 14, traps: 4, avg: 2.2 },
    control: { creatures: 16, spells: 17, traps: 7, avg: 3.0 },
    midrange: { creatures: 22, spells: 13, traps: 5, avg: 2.5 },
    combo: { creatures: 14, spells: 14, traps: 12, avg: 2.6 },
  }[arch];

  const counts = { Creature: 0, Spell: 0, Trap: 0, total: 0, mana: 0 };
  const list = [];

  function canTake(type) {
    const key = type.toLowerCase() + "s";
    const cap = targets[key];
    if (cap == null) return true;
    if (counts[type] >= cap && counts.total < 36) return false;
    return counts[type] < cap + 2;
  }

  for (const row of pool) {
    if (counts.total >= 40) break;
    const c = row.card;
    if (!canTake(c.type)) continue;
    const want = Math.min(copiesFor(row.score), 40 - counts.total);
    if (want <= 0) continue;
    list.push({ ...c, qty: want, score: row.score });
    counts[c.type] += want;
    counts.total += want;
    counts.mana += want * (c.mana || 0);
  }

  if (counts.total < 40) {
    for (const row of pool) {
      if (counts.total >= 40) break;
      const existing = list.find((x) => x.id === row.card.id);
      if (existing && existing.qty < 3) {
        existing.qty += 1;
        counts.total += 1;
        counts[row.card.type] += 1;
        counts.mana += row.card.mana || 0;
      }
    }
  }

  const trapNeed = (targets.traps || 0) - counts.Trap;
  if (trapNeed > 0) {
    const trapPool = pool.filter((r) => r.card.type === "Trap");
    for (const row of trapPool) {
      if (counts.Trap >= targets.traps) break;
      const existing = list.find((x) => x.id === row.card.id);
      const have = existing ? existing.qty : 0;
      const add = Math.min(copiesFor(row.score + 8), 3 - have, targets.traps - counts.Trap, 40);
      if (add <= 0) continue;
      while (counts.total + add > 40) {
        const drop = [...list].reverse().find((x) => x.type !== "Trap" && x.qty > 0 && (x.score || 0) < 30);
        if (!drop) break;
        drop.qty -= 1;
        counts.total -= 1;
        counts[drop.type] -= 1;
        counts.mana -= drop.mana || 0;
        if (drop.qty <= 0) {
          const i = list.indexOf(drop);
          if (i >= 0) list.splice(i, 1);
        }
      }
      if (counts.total + add > 40) break;
      if (existing) existing.qty += add;
      else list.push({ ...row.card, qty: add, score: row.score });
      counts.Trap += add;
      counts.total += add;
      counts.mana += add * (row.card.mana || 0);
    }
    const cleaned = list.filter((x) => x.qty > 0);
    list.length = 0;
    list.push(...cleaned);
  }

  const avg = counts.total ? counts.mana / counts.total : 0;
  return { list, counts, avg, targets };
}

function cardById(id) {
  return D.cards.find((c) => c.id === id);
}

function expandBuild(build) {
  const rows = [];
  let total = 0;
  for (const [id, qty, name, role] of build.cards) {
    const c = cardById(id);
    if (!c) continue;
    rows.push({
      ...c,
      qty,
      role,
      listName: name,
      splash: (build.heroes || []).length > 1 && c.class !== build.hero && c.class !== "Neutral" && !c.all_class && c.class !== "All",
    });
    total += qty;
  }
  const counts = { Creature: 0, Spell: 0, Trap: 0, total, mana: 0 };
  const curve = Array(11).fill(0);
  for (const r of rows) {
    counts[r.type] += r.qty;
    counts.mana += r.qty * (r.mana || 0);
    curve[Math.min(10, r.mana || 0)] += r.qty;
  }
  counts.avg = total ? counts.mana / total : 0;
  return { rows, counts, curve };
}

function deckText(title, hero, rows) {
  const heroes = Array.isArray(hero) ? hero.filter(Boolean).join(" + ") : hero;
  const lines = [`DDL TCG — ${title}`, `Class: ${heroes}`, `40 cards · max 3 copies`, ""];
  for (const type of ["Creature", "Spell", "Trap"]) {
    const group = rows.filter((r) => r.type === type).sort((a, b) => a.mana - b.mana || a.name.localeCompare(b.name));
    if (!group.length) continue;
    lines.push(`## ${type}s (${group.reduce((s, r) => s + r.qty, 0)})`);
    for (const r of group) lines.push(`${r.qty} ${r.name} (${r.id})`);
    lines.push("");
  }
  return lines.join("\n");
}

function serialText(rows) {
  return rows
    .slice()
    .sort((a, b) => a.mana - b.mana || a.name.localeCompare(b.name))
    .map((r) => `${r.qty}x ${r.id} ${r.name}`)
    .join("\n");
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = prev; }, 1400);
    }
  } catch (e) {
    window.prompt("Copy this list", text);
  }
}

const CHECK_KEY = "ddl-build-check";
function loadChecks() {
  try { return JSON.parse(localStorage.getItem(CHECK_KEY) || "{}"); }
  catch { return {}; }
}
function saveChecks(map) {
  localStorage.setItem(CHECK_KEY, JSON.stringify(map));
}

let activeBuildId = (window.DDL_BUILDS && window.DDL_BUILDS[0]?.id) || "";
let kindFilter = "all";

function filteredBuilds() {
  return (window.DDL_BUILDS || []).filter((b) => {
    if (kindFilter === "mono") return (b.heroes || [b.hero]).length === 1;
    if (kindFilter === "mix") return (b.heroes || []).length > 1;
    return true;
  });
}

function renderBuildNav() {
  const builds = filteredBuilds();
  const groups = [
    { label: "One class", items: builds.filter((b) => (b.heroes || [b.hero]).length === 1) },
    { label: "Two classes", items: builds.filter((b) => (b.heroes || []).length > 1) },
  ].filter((g) => g.items.length);
  $("build-nav").innerHTML = groups.map((g) => `
    <p class="nav-label">${g.label}</p>
    ${g.items.map((b) => {
      const { rows } = expandBuild(b);
      const rank = rankDeck(rows, { heroes: b.heroes || [b.hero] });
      return `
    <button type="button" data-build="${b.id}" class="${b.id === activeBuildId ? "active" : ""}">
      <span class="bn-name">${b.name} ${rankBadge(rank.band)}</span>
      <span class="bn-sub">${(b.heroes || [b.hero]).join(" / ")} · ${b.arch} · ${rank.traps} traps</span>
    </button>`;
    }).join("")}
  `).join("");
}

function curveHtml(curve) {
  const max = Math.max(1, ...curve);
  return `<div class="curve" title="Mana curve">${curve.map((n, i) =>
    `<i style="height:${Math.max(8, (n / max) * 100)}%" title="${i}${i === 10 ? "+" : ""} mana: ${n}"><span>${i === 10 ? "10+" : i}</span></i>`
  ).join("")}</div>`;
}

function renderBuildPanel() {
  const build = (window.DDL_BUILDS || []).find((b) => b.id === activeBuildId);
  if (!build) return;
  const { rows, counts, curve } = expandBuild(build);
  const checks = loadChecks()[build.id] || {};
  const done = rows.filter((r) => checks[r.id]).reduce((s, r) => s + r.qty, 0);
  const groups = ["Creature", "Spell", "Trap"].map((type) => ({
    type,
    items: rows.filter((r) => r.type === type).sort((a, b) => a.mana - b.mana || a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length);

  const man = derivePlayManual(build, rows);
  const rank = rankDeck(rows, { heroes: build.heroes || [build.hero] });
  const classBits = (build.heroes || [build.hero]).map((h) => (window.DDL_CLASSES || []).find((c) => c.id === h)).filter(Boolean);
  const panel = $("build-panel");
  const playOpen = panel.querySelector("[data-fold='play']")?.open;
  const howOpen = panel.querySelector("[data-fold='how']")?.open;
  panel.innerHTML = `
    <article class="build-panel">
      <p class="eyebrow">${(build.heroes || [build.hero]).join(" + ")} · ${build.arch} · ${rankBadge(rank.band)} ${rank.score} · save in Play as “${build.preset}”</p>
      <h2>${build.name}</h2>
      <p class="panel-note">${build.tagline}</p>
      <p class="stat-row">
        <span>${counts.total} / 40 cards</span>
        <span>${counts.Creature} creatures</span>
        <span>${counts.Spell} spells</span>
        <span>${counts.Trap} traps</span>
        <span>Avg ${counts.avg.toFixed(1)} mana</span>
        <span>${done} ticked off</span>
        <span>Strength ${rank.band} · ${rank.score}</span>
      </p>
      <p class="trap-plan">${esc(build.trapPlan || "")}</p>
      <div class="pros-cons">
        <div>
          <h4>Advantage</h4>
          <p>${esc(build.advantage || classBits.map((c) => c.advantage).join(" "))}</p>
        </div>
        <div>
          <h4>Disadvantage</h4>
          <p>${esc(build.disadvantage || classBits.map((c) => c.disadvantage).join(" "))}</p>
        </div>
      </div>
      ${(build.vsNotes || []).length ? `<div class="vs-notes">${build.vsNotes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
      ${curveHtml(curve)}
      <p class="curve-caption">Mana curve — how many cards cost 0 through 10+</p>
      <div class="btn-row">
        <button type="button" data-copy="list">Copy decklist</button>
        <button type="button" data-copy="serials">Copy serials</button>
        <a class="btn ghost" href="https://ddltcg.com/play" target="_blank" rel="noopener">Open Play</a>
        <button type="button" class="ghost" data-copy="reset">Clear ticks</button>
      </div>
      ${groups.map((g) => `
        <h3 class="type-h">${g.type}s · ${g.items.reduce((s, r) => s + r.qty, 0)}</h3>
        ${g.items.map((r) => `
          <label class="check-row ${checks[r.id] ? "done" : ""}">
            <input type="checkbox" data-cid="${r.id}" ${checks[r.id] ? "checked" : ""}>
            <span class="row-art" aria-hidden="true">${artHtml(r, "row-thumb")}</span>
            <span class="qty">${r.qty}×</span>
            <span>
              <button type="button" class="linkish cn" data-open="${r.id}">${r.name} <span class="serial">${r.id} · ${statsLine(r)}</span></button>
              <div class="role">${r.role || ""}</div>
            </span>
            <span class="chip ${CLASS_COLOR[r.class] || ""}">${r.splash ? "Other class · " : ""}${r.class}</span>
          </label>`).join("")}
      `).join("")}
      <details class="fold" data-fold="play"${playOpen ? " open" : ""}>
        <summary>
          <span class="fold-title">How to play this list</span>
          <span class="fold-sub">Lanes, turn order, combos, and what to watch for. Hover or tap a gold name to see the card.</span>
        </summary>
        ${renderPlayManual(man)}
      </details>
      <details class="fold" data-fold="how"${howOpen ? " open" : ""}>
        <summary>
          <span class="fold-title">How to enter it in Play</span>
          <span class="fold-sub">${build.why}</span>
        </summary>
        <ol class="how-steps">
          ${build.how.map((s) => `<li>${s.replace("ddltcg.com/play", '<a href="https://ddltcg.com/play" target="_blank" rel="noopener">ddltcg.com/play</a>')}</li>`).join("")}
        </ol>
      </details>
    </article>`;
}

function renderRankTable() {
  const host = $("rank-table");
  if (!host) return;
  const rows = rankedFeatured();
  host.innerHTML = `
    <article class="price-box rank-box">
      <h3>Strength board</h3>
      <p class="lede">Scored on trap density (4–7 unless it is a trap wall), answers, engines, and finishers. Counter weight counts as much as the clock. Tap a row to open that list.</p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>List</th>
            <th>Classes</th>
            <th>Plan</th>
            <th class="num">Traps</th>
            <th class="num">Score</th>
            <th>Band</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="click-row ${r.build.id === activeBuildId ? "is-active" : ""}" data-build-row="${r.build.id}">
              <td>${i + 1}</td>
              <td>${esc(r.build.name)}</td>
              <td>${esc((r.build.heroes || [r.build.hero]).join(" + "))}</td>
              <td>${esc(r.build.arch)}</td>
              <td class="num">${r.rank.traps}</td>
              <td class="num">${r.rank.score}</td>
              <td>${rankBadge(r.rank.band)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </article>`;
}

function renderCooked() {
  const hero = $("cook-class").value || "Pirate";
  const splash = $("cook-class-2")?.value || "";
  const heroes = splash && splash !== hero ? [hero, splash] : [hero];
  const arch = $("cook-arch")?.value || "aggro";
  const { list, counts, avg, targets } = cookDeck(heroes, arch);
  const rank = rankDeck(list, { heroes });
  const ev = list.reduce((s, c) => s + estimatedUsd(c) * c.qty, 0);
  const title = `${heroes.join(" / ")} ${$("cook-arch")?.selectedOptions?.[0]?.text || arch}`;
  const man = derivePlayManual(
    { hero, heroes, tags: { aggro: ["haunt", "tempo"], control: ["sot", "traps"], midrange: ["garden", "play"], combo: ["scheme", "eot", "traps"] }[arch], why: `Generated ${heroes.join(" + ")} list using the same engine scoring as the featured mixes.` },
    list
  );
  $("cooked").innerHTML = `
    <div class="cooked">
      <h3>${title}</h3>
      <p class="lede">A generated 40 using the same class scoring and a ${arch} curve. Aggro now aims at 4 traps; midrange 5; control 7; combo keeps a trap wall.</p>
      <p class="stat-row">
        <span>${counts.total} / 40</span>
        <span>${counts.Creature} creatures (aim ${targets.creatures})</span>
        <span>${counts.Spell} spells (aim ${targets.spells})</span>
        <span>${counts.Trap} traps (aim ${targets.traps})</span>
        <span>Avg ${avg.toFixed(1)} mana</span>
        <span>Strength ${rank.band} · ${rank.score}</span>
        <span>Est. $${ev.toFixed(0)}</span>
      </p>
      <p class="trap-plan">${rank.notes.slice(0, 3).map(esc).join(" · ")}</p>
      <div class="btn-row">
        <button type="button" id="copy-cooked">Copy decklist</button>
        <button type="button" class="ghost" id="copy-cooked-s">Copy serials</button>
        <button type="button" class="ghost" id="cook-to-custom">Edit in My decks</button>
      </div>
      <div class="deck-list">
        ${list.map((c) => `<div><b>${c.qty}×</b> ${c.name} <span class="serial">${c.id} · ${c.mana} mana · ${c.type} · ${c.class}</span></div>`).join("")}
      </div>
      <details class="fold">
        <summary>
          <span class="fold-title">How to play this list</span>
          <span class="fold-sub">Generated from the cards actually in it. Hover or tap a gold name to see the card.</span>
        </summary>
        ${renderPlayManual(man)}
      </details>
    </div>`;
  $("copy-cooked").onclick = (e) => copyText(deckText(title, heroes, list), e.target);
  $("copy-cooked-s").onclick = (e) => copyText(serialText(list), e.target);
  $("cook-to-custom").onclick = () => {
    loadCookedIntoDraft(list, heroes, title);
    showTab("builder");
    history.replaceState(null, "", "#builder");
    document.querySelectorAll("[data-builder]").forEach((b) => b.classList.toggle("active", b.dataset.builder === "edit"));
    $("builder-edit").hidden = false;
    $("builder-cook").hidden = true;
  };
}

function renderDecks() {
  fillClassSelect($("cook-class"), false);
  $("cook-class").value = "Pirate";
  const mixB = $("cook-class-2");
  mixB.innerHTML = `<option value="">No second class</option>` + ["Pirate", "Zombie", "Crown", "Bow", "Wizard"].map((c) => `<option value="${c}">${c}</option>`).join("");
  const a = $("mix-a");
  const b = $("mix-b");
  const opts = ["Pirate", "Zombie", "Crown", "Bow", "Wizard"].map((c) => `<option value="${c}">${c}</option>`).join("");
  a.innerHTML = opts;
  b.innerHTML = `<option value="">Mono</option>` + opts;
  a.value = "Pirate";
  b.value = "Zombie";
  if (!activeBuildId && window.DDL_BUILDS?.[0]) activeBuildId = window.DDL_BUILDS[0].id;
  renderRankTable();
  renderBuildNav();
  renderBuildPanel();
  renderCooked();
  initCustomBuilder();
}

$("cook-btn").addEventListener("click", renderCooked);
$("cook-class").addEventListener("change", renderCooked);
$("cook-class-2").addEventListener("change", renderCooked);
$("cook-arch").addEventListener("change", renderCooked);

document.querySelectorAll(".kind-btn[data-kind]").forEach((btn) => {
  btn.addEventListener("click", () => {
    kindFilter = btn.dataset.kind;
    document.querySelectorAll(".kind-btn[data-kind]").forEach((b) => b.classList.toggle("active", b === btn));
    const vis = filteredBuilds();
    if (!vis.some((b) => b.id === activeBuildId) && vis[0]) activeBuildId = vis[0].id;
    renderBuildNav();
    renderBuildPanel();
    renderRankTable();
  });
});

$("mix-go").addEventListener("click", () => {
  const a = $("mix-a").value;
  const b = $("mix-b").value;
  const heroes = b && b !== a ? [a, b] : [a];
  const found = (window.DDL_BUILDS || []).find((d) => {
    const hs = d.heroes || [d.hero];
    if (hs.length !== heroes.length) return false;
    return heroes.every((h) => hs.includes(h));
  });
  if (found) {
    kindFilter = "all";
    document.querySelectorAll(".kind-btn[data-kind]").forEach((k) => k.classList.toggle("active", k.dataset.kind === "all"));
    activeBuildId = found.id;
    renderBuildNav();
    renderBuildPanel();
    renderRankTable();
    $("build-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

$("rank-table")?.addEventListener("click", (e) => {
  const row = e.target.closest("[data-build-row]");
  if (!row) return;
  activeBuildId = row.dataset.buildRow;
  kindFilter = "all";
  document.querySelectorAll(".kind-btn[data-kind]").forEach((k) => k.classList.toggle("active", k.dataset.kind === "all"));
  renderBuildNav();
  renderBuildPanel();
  renderRankTable();
  $("build-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("build-nav").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-build]");
  if (!btn) return;
  activeBuildId = btn.dataset.build;
  renderBuildNav();
  renderBuildPanel();
  renderRankTable();
});

$("build-panel").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    e.preventDefault();
    e.stopPropagation();
    openModal(open.dataset.open);
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (!copy) return;
  const build = (window.DDL_BUILDS || []).find((b) => b.id === activeBuildId);
  const { rows } = expandBuild(build);
  if (copy.dataset.copy === "list") copyText(deckText(build.name, build.hero, rows), copy);
  if (copy.dataset.copy === "serials") copyText(serialText(rows), copy);
  if (copy.dataset.copy === "reset") {
    const all = loadChecks();
    delete all[build.id];
    saveChecks(all);
    renderBuildPanel();
  }
});

$("build-panel").addEventListener("change", (e) => {
  const box = e.target.closest("input[data-cid]");
  if (!box) return;
  const all = loadChecks();
  all[activeBuildId] = all[activeBuildId] || {};
  if (box.checked) all[activeBuildId][box.dataset.cid] = true;
  else delete all[activeBuildId][box.dataset.cid];
  saveChecks(all);
  renderBuildPanel();
});

/* ---------- Custom decks ---------- */
const CUSTOM_KEY = "ddl-custom-decks";
let customDecks = [];
let activeCustomId = "";
let draft = { id: "", name: "", hero: "Pirate", heroes: ["Pirate"], cards: {} };
let builderReady = false;

function loadCustomDecks() {
  try { customDecks = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); }
  catch { customDecks = []; }
  if (!Array.isArray(customDecks)) customDecks = [];
}

function saveCustomDecks() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customDecks));
}

function draftHeroes() {
  const a = $("custom-class")?.value || draft.hero || "Pirate";
  const b = $("custom-class-2")?.value || "";
  const heroes = b && b !== a ? [a, b] : [a];
  draft.hero = a;
  draft.heroes = heroes;
  return heroes;
}

function draftRows() {
  return Object.entries(draft.cards)
    .map(([id, qty]) => {
      const c = cardById(id);
      return c && qty ? { ...c, qty } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.mana - b.mana || a.name.localeCompare(b.name));
}

function setDraftQty(id, qty) {
  qty = Math.max(0, Math.min(3, qty));
  if (qty <= 0) delete draft.cards[id];
  else draft.cards[id] = qty;
  renderCustom();
}

function loadCookedIntoDraft(list, heroes, title) {
  draft = {
    id: "",
    name: title || "Generated 40",
    hero: heroes[0],
    heroes,
    cards: Object.fromEntries(list.map((c) => [c.id, c.qty])),
  };
  if ($("custom-name")) $("custom-name").value = draft.name;
  if ($("custom-class")) $("custom-class").value = heroes[0];
  if ($("custom-class-2")) $("custom-class-2").value = heroes[1] || "";
  activeCustomId = "";
  renderCustom();
}

function parseDeckText(text) {
  const unknown = [];
  let added = 0;
  for (const line of String(text || "").split(/\n|;/)) {
    const raw = line.trim();
    if (!raw || /^#|^DDL|^Class:|^40 cards|^##/i.test(raw)) continue;
    let qty = 1;
    let rest = raw;
    const m = raw.match(/^(\d+)\s*[x×]\s*(.+)$/i) || raw.match(/^(\d+)\s+(.+)$/);
    if (m) {
      qty = Math.min(3, Number(m[1]) || 1);
      rest = m[2].trim();
    } else {
      const tail = raw.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
      if (tail) {
        rest = tail[1].trim();
        qty = Math.min(3, Number(tail[2]) || 1);
      }
    }
    const idm = rest.match(/V\d{3}/i);
    let card = idm ? cardById(idm[0].toUpperCase()) : null;
    if (!card) {
      const name = rest.replace(/\s*\(V\d{3}.*\)$/i, "").trim();
      card = D.cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
    }
    if (!card) unknown.push(raw);
    else {
      draft.cards[card.id] = Math.min(3, (draft.cards[card.id] || 0) + qty);
      added += 1;
    }
  }
  return { added, unknown };
}

function classSheetHtml(heroes) {
  const sheets = (window.DDL_CLASSES || []).filter((c) => heroes.includes(c.id));
  if (!sheets.length) return "";
  return sheets.map((c) => `
    <article class="class-mini">
      <p class="eyebrow ${CLASS_COLOR[c.id] || ""}">${c.id} · ${c.role}</p>
      <div class="pros-cons">
        <div><h4>Advantage</h4><p>${esc(c.advantage)}</p></div>
        <div><h4>Disadvantage</h4><p>${esc(c.disadvantage)}</p></div>
      </div>
      <p><b>Beats</b> ${esc(c.beats)}</p>
      <p><b>Loses to</b> ${esc(c.loses)}</p>
    </article>`).join("");
}

function renderCustomNav() {
  const nav = $("custom-nav");
  if (!nav) return;
  if (!customDecks.length) {
    nav.innerHTML = `<p class="lede">No saved lists yet.</p>`;
    return;
  }
  nav.innerHTML = customDecks.map((d) => {
    const rows = Object.entries(d.cards || {}).map(([id, qty]) => {
      const c = cardById(id);
      return c ? { ...c, qty } : null;
    }).filter(Boolean);
    const rank = rankDeck(rows, { heroes: d.heroes || [d.hero] });
    return `<button type="button" data-custom="${d.id}" class="${d.id === activeCustomId ? "active" : ""}">
      <span class="bn-name">${esc(d.name || "Untitled")} ${rankBadge(rank.band)}</span>
      <span class="bn-sub">${esc((d.heroes || [d.hero]).join(" / "))} · ${rank.traps} traps · ${rank.score}</span>
    </button>`;
  }).join("");
}

function renderCustom() {
  if (!$("custom-list")) return;
  draft.name = $("custom-name")?.value || draft.name;
  const heroes = draftHeroes();
  const rows = draftRows();
  const rank = rankDeck(rows, { heroes });
  const total = rank.total;
  $("custom-rank").innerHTML = `
    <p class="stat-row">
      <span>${total} / 40</span>
      <span>${rank.byType.Creature || 0} creatures</span>
      <span>${rank.byType.Spell || 0} spells</span>
      <span>${rank.byType.Trap || 0} traps</span>
      <span>Avg ${(rank.avg || 0).toFixed(1)} mana</span>
      <span>Strength ${rankBadge(rank.band)} ${rank.score}</span>
    </p>
    <ul class="rank-notes">${rank.notes.map((n) => `<li>${esc(n)}</li>`).join("") || "<li>Add cards to see a rank.</li>"}</ul>
    ${classSheetHtml(heroes)}`;

  const groups = ["Creature", "Spell", "Trap"].map((type) => ({
    type,
    items: rows.filter((r) => r.type === type),
  })).filter((g) => g.items.length);
  $("custom-list").innerHTML = groups.length
    ? groups.map((g) => `
      <h3 class="type-h">${g.type}s · ${g.items.reduce((s, r) => s + r.qty, 0)}</h3>
      ${g.items.map((r) => `
        <div class="pick-row">
          <span class="row-art" aria-hidden="true">${artHtml(r, "row-thumb")}</span>
          <span class="qty-step">
            <button type="button" data-qty="${r.id}" data-d="-1">−</button>
            <b>${r.qty}</b>
            <button type="button" data-qty="${r.id}" data-d="1">+</button>
          </span>
          <span>
            <button type="button" class="linkish cn" data-open="${r.id}">${esc(r.name)} <span class="serial">${r.id} · ${statsLine(r)}</span></button>
            <div class="role">${esc((r.text || "").replace(/^(Play|Passive|Trap|Haunt):\s*/i, "").slice(0, 90))}</div>
          </span>
          <span class="chip ${CLASS_COLOR[r.class] || ""}">${legalFor(r, heroes) ? r.class : "Illegal · " + r.class}</span>
        </div>`).join("")}`).join("")
    : `<p class="empty">Paste a list or tap cards on the left. Aim for 40, with 4–7 traps unless you are building a dedicated race or a trap wall.</p>`;

  const term = ($("custom-q")?.value || "").trim().toLowerCase();
  const pool = D.cards.filter((c) => {
    if (!legalFor(c, heroes)) return false;
    if (!term) return c.type === "Trap" || c.mana <= 3 || (c.in_decks || []).length;
    return `${c.name} ${c.id} ${c.text} ${c.keyword} ${c.pill} ${c.class}`.toLowerCase().includes(term);
  }).slice(0, term ? 80 : 40);
  $("custom-pool").innerHTML = pool.map((c) => {
    const q = draft.cards[c.id] || 0;
    return `<button type="button" class="pool-card ${q ? "in" : ""}" data-add="${c.id}">
      <span class="qty">${q ? q + "×" : "+"}</span>
      <span>${esc(c.name)} <span class="serial">${c.id} · ${c.mana} · ${c.type}</span></span>
    </button>`;
  }).join("") || `<p class="lede">Nothing matches.</p>`;
  renderCustomNav();
}

function persistDraft() {
  draft.name = ($("custom-name")?.value || "Untitled").trim() || "Untitled";
  draftHeroes();
  const rec = {
    id: draft.id || ("c-" + Date.now()),
    name: draft.name,
    hero: draft.hero,
    heroes: draft.heroes,
    cards: { ...draft.cards },
    updated: new Date().toISOString(),
  };
  const i = customDecks.findIndex((d) => d.id === rec.id);
  if (i >= 0) customDecks[i] = rec;
  else customDecks.unshift(rec);
  draft.id = rec.id;
  activeCustomId = rec.id;
  saveCustomDecks();
  renderCustom();
}

function openCustom(id) {
  const d = customDecks.find((x) => x.id === id);
  if (!d) return;
  activeCustomId = id;
  draft = { id: d.id, name: d.name, hero: d.hero, heroes: d.heroes || [d.hero], cards: { ...(d.cards || {}) } };
  $("custom-name").value = d.name || "";
  $("custom-class").value = d.hero || "Pirate";
  $("custom-class-2").value = (d.heroes || [])[1] || "";
  renderCustom();
}

function initCustomBuilder() {
  if (!$("custom-class") || builderReady) {
    renderCustom();
    return;
  }
  builderReady = true;
  loadCustomDecks();
  fillClassSelect($("custom-class"), false);
  $("custom-class").value = "Pirate";
  $("custom-class-2").innerHTML = `<option value="">No second class</option>` +
    ["Pirate", "Zombie", "Crown", "Bow", "Wizard"].map((c) => `<option value="${c}">${c}</option>`).join("");
  if (customDecks[0]) openCustom(customDecks[0].id);
  else renderCustom();

  $("custom-new").addEventListener("click", () => {
    activeCustomId = "";
    draft = { id: "", name: "", hero: $("custom-class").value || "Pirate", heroes: [$("custom-class").value || "Pirate"], cards: {} };
    $("custom-name").value = "";
    $("custom-paste").value = "";
    renderCustom();
  });
  $("custom-save").addEventListener("click", persistDraft);
  $("custom-delete").addEventListener("click", () => {
    if (!activeCustomId) {
      draft.cards = {};
      renderCustom();
      return;
    }
    customDecks = customDecks.filter((d) => d.id !== activeCustomId);
    saveCustomDecks();
    activeCustomId = customDecks[0]?.id || "";
    if (activeCustomId) openCustom(activeCustomId);
    else {
      draft = { id: "", name: "", hero: "Pirate", heroes: ["Pirate"], cards: {} };
      $("custom-name").value = "";
      renderCustom();
    }
  });
  $("custom-clear").addEventListener("click", () => {
    draft.cards = {};
    renderCustom();
  });
  $("custom-parse").addEventListener("click", () => {
    const { unknown } = parseDeckText($("custom-paste").value);
    renderCustom();
    if (unknown.length) window.alert("Could not match: " + unknown.slice(0, 8).join(", "));
  });
  ["custom-class", "custom-class-2"].forEach((id) => $(id).addEventListener("change", renderCustom));
  $("custom-name").addEventListener("input", () => { draft.name = $("custom-name").value; });
  $("custom-q").addEventListener("input", renderCustom);
  $("custom-nav").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-custom]");
    if (btn) openCustom(btn.dataset.custom);
  });
  $("custom-pool").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    setDraftQty(btn.dataset.add, (draft.cards[btn.dataset.add] || 0) + 1);
  });
  $("custom-list").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) {
      openModal(open.dataset.open);
      return;
    }
    const step = e.target.closest("[data-qty]");
    if (!step) return;
    const id = step.dataset.qty;
    setDraftQty(id, (draft.cards[id] || 0) + Number(step.dataset.d));
  });
  document.querySelector("#view-builder")?.addEventListener("click", (e) => {
    const copy = e.target.closest("[data-copy]");
    if (!copy) return;
    const rows = draftRows();
    if (copy.dataset.copy === "custom-list") copyText(deckText(draft.name || "Custom 40", draftHeroes(), rows), copy);
    if (copy.dataset.copy === "custom-serials") copyText(serialText(rows), copy);
  });
  document.querySelectorAll("[data-builder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-builder]").forEach((b) => b.classList.toggle("active", b === btn));
      const edit = btn.dataset.builder === "edit";
      $("builder-edit").hidden = !edit;
      $("builder-cook").hidden = edit;
    });
  });
}

/* ---------- Prices ---------- */
function estimatedUsd(card) {
  const shop = D.shop;
  const box = shop.box_usd;
  const cardsPerBox = shop.packs_per_box * shop.cards_per_pack;
  const bulk = box / cardsPerBox;
  if (card.scarcity != null && card.rarity_pct) {
    const known = D.cards.filter((c) => c.scarcity != null);
    const same = known.filter((c) => c.rarity === card.rarity);
    const copies = (card.rarity_pct / 100) * cardsPerBox / Math.max(same.length, 1);
    const chase = card.full_art ? 1.35 : 1;
    return (box / Math.max(copies, 0.15)) * chase / Math.max(known.length / 8, 1);
  }
  const fallback = { Creature: 1.15, Spell: 1, Trap: 1.25 }[card.type] || 1;
  return bulk * fallback * (1 + (card.mana || 0) / 25) * (card.keyword === "Taunt" ? 1.1 : 1);
}

function renderPrices() {
  const shop = D.shop;
  const pack = shop.box_usd / shop.packs_per_box;
  const perCard = shop.box_usd / (shop.packs_per_box * shop.cards_per_pack);
  const priced = D.cards
    .map((c) => ({ ...c, usd: estimatedUsd(c) }))
    .sort((a, b) => b.usd - a.usd);

  const byRarity = {};
  for (const c of D.cards) {
    if (!c.rarity) continue;
    byRarity[c.rarity] ||= { n: 0, pct: c.rarity_pct, tier: c.tier };
    byRarity[c.rarity].n += 1;
  }

  $("view-prices").innerHTML = `
    <header class="view-intro">
      <h2>What a box is worth</h2>
      <p>There is no public singles market yet. These numbers are estimates from pack math, not asking prices.</p>
    </header>
    <article class="price-box">
      <h3>${shop.product}</h3>
      <p>Official shop: <a href="${shop.url}">$${shop.box_usd}</a> · ${shop.packs_per_box} packs · ${shop.cards_per_pack} cards each · <b>${shop.status.replace("_", " ")}</b> · ships ${shop.ships}.</p>
      <p>About $${pack.toFixed(2)} per pack, or $${perCard.toFixed(2)} if you treat every card as equal. ${shop.note}</p>
    </article>
    <details class="fold">
      <summary>
        <span class="fold-title">How the estimate is made</span>
        <span class="fold-sub">Gallery cards use published rarity odds. The rest use a simple type and mana guess.</span>
      </summary>
      <p class="lede">For gallery-revealed cards, treat <code>rarityPct</code> as that rarity’s share of pack slots, split it across known cards of the same rarity, then scale to the 111-card set. Cards not in the gallery yet use a type / mana heuristic until official odds land.</p>
    </details>
    <article class="price-box">
      <h3>Rarity weights we know so far</h3>
      <table>
        <thead><tr><th>Rarity</th><th>Known cards</th><th>Share of pack slots</th></tr></thead>
        <tbody>
          ${Object.entries(byRarity).map(([k, v]) => `<tr><td>${k}</td><td>${v.n}</td><td>${v.pct}%</td></tr>`).join("")}
        </tbody>
      </table>
    </article>
    <article class="price-box">
      <h3>Highest estimated singles</h3>
      <table>
        <thead><tr><th>Card</th><th>Class</th><th>Rarity</th><th class="num">Estimate</th></tr></thead>
        <tbody>
          ${priced.slice(0, 40).map((c) => `<tr class="click-row" data-id="${c.id}">
            <td>${c.name} <span class="serial">${c.id}${c.gallery_revealed ? "" : " · Play only"}</span></td>
            <td>${c.class}</td>
            <td>${c.rarity || "Not listed yet"} ${c.tier ? "· " + c.tier : ""}</td>
            <td class="num">$${c.usd.toFixed(2)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </article>
  `;
}

/* ---------- Tabs ---------- */
function showTab(id) {
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.tab === id;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + id));
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  showTab(btn.dataset.tab);
  history.replaceState(null, "", "#" + btn.dataset.tab);
});

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href^='#']");
  if (!a) return;
  const id = a.getAttribute("href").slice(1);
  if (!["cards", "mechanics", "decks", "builder", "prices"].includes(id)) return;
  e.preventDefault();
  showTab(id);
  history.replaceState(null, "", "#" + id);
});

initCardPeek();
renderCards();
renderMechanics();
renderDecks();
renderPrices();
const startTab = (location.hash || "#cards").slice(1);
if (["cards", "mechanics", "decks", "builder", "prices"].includes(startTab)) showTab(startTab);
