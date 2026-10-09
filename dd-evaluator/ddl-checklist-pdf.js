/**
 * Rise of the Pack checklist PDF.
 * Same sheet as the completed checklist: #, name, rarity, class, Base, Holo,
 * Full Art, and a status. A checked box plus "2x" means two copies. A dash means
 * none. Chase names use Base for a non-full-art copy and Full Art for the chase
 * print. Import reads those boxes (or the same text in a finished PDF).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDLChecklistPdf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PDF_LIB_SRC = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const PDFJS_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js";
  const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
  const FORMAT = "rotp-checklist-1";
  const ROW_H = 12.6;
  const DASH = "\u2014";

  function qtyFromText(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text || text === DASH || text === "\u2013" || text === "-" || text === "\u2012") return 0;
    const marked = text.match(/(\d+)\s*x/i);
    const plain = text.match(/^(\d+)$/);
    const hit = marked || plain;
    if (!hit) return 0;
    const n = parseInt(hit[1], 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(999, n);
  }

  function rawOf(collection, id, print) {
    const row = collection && collection[id] && collection[id][print];
    if (row == null) return 0;
    if (typeof row === "number") return Math.max(0, Math.min(999, row));
    return Math.max(0, Math.min(999, Number(row.raw) || 0));
  }

  function countsFromCollection(check, collection) {
    const counts = {};
    check.cards.forEach((card) => {
      counts[card.id] = {
        base: rawOf(collection, card.id, "base"),
        holo: rawOf(collection, card.id, "holo"),
        fa: rawOf(collection, card.id, "fa"),
      };
    });
    return counts;
  }

  function pile(check, counts) {
    const out = {
      crBase: 0, crHolo: 0, crN: 0, fa: 0, faN: 0, names: 0,
      master: 0, rawBase: 0, rawHolo: 0, rawFa: 0,
      missing: [], needHolo: [],
    };
    check.cards.forEach((card) => {
      const q = counts[card.id] || {};
      const base = q.base || 0;
      const holo = q.holo || 0;
      const art = q.fa || 0;
      if (base || holo || art) out.names += 1;
      out.rawBase += base;
      out.rawHolo += holo;
      out.rawFa += art;
      if (card.chase) {
        out.faN += 1;
        if (art) {
          out.fa += 1;
          out.master += 1;
        }
      } else {
        out.crN += 1;
        if (base) {
          out.crBase += 1;
          out.master += 1;
        }
        if (holo) {
          out.crHolo += 1;
          out.master += 1;
        }
      }
      if (!base && !holo && !art) out.missing.push(card);
      else if (!card.chase && base && !holo) out.needHolo.push(card);
    });
    out.raw = out.rawBase + out.rawHolo + out.rawFa;
    out.nameN = check.cards.length;
    out.masterN = check.master;
    return out;
  }

  function statusFor(card, q) {
    const base = q.base || 0;
    const holo = q.holo || 0;
    const art = q.fa || 0;
    if (card.chase) {
      if (art && base) return { label: "HAVE FA +base", tone: "green", fill: "have-base" };
      if (art) return { label: "HAVE FA", tone: "green", fill: "have" };
      if (base) return { label: "NEED FA", tone: "orange", fill: "zebra" };
      return { label: "MISSING", tone: "red", fill: "miss" };
    }
    if (base && holo) return { label: "BASE+HOLO", tone: "ink", fill: "zebra" };
    if (base) return { label: "NEED HOLO", tone: "orange", fill: "zebra" };
    if (holo) return { label: "NEED BASE", tone: "orange", fill: "zebra" };
    return { label: "MISSING", tone: "red", fill: "miss" };
  }

  function clusterRows(items) {
    const rows = [];
    items.forEach((item) => {
      const text = String(item.text || "").trim();
      if (!text) return;
      let row = null;
      for (let i = 0; i < rows.length; i += 1) {
        if (Math.abs(rows[i].y - item.y) <= 3) {
          row = rows[i];
          break;
        }
      }
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push({ text, x: item.x, y: item.y });
    });
    return rows;
  }

  function qtyInRange(items, x0, x1) {
    const parts = items.filter((item) => item.x >= x0 && item.x < x1).sort((a, b) => a.x - b.x);
    if (!parts.length) return 0;
    let best = qtyFromText(parts.map((part) => part.text).join(""));
    parts.forEach((part) => {
      best = Math.max(best, qtyFromText(part.text));
    });
    return best;
  }

  /**
   * Read a finished checklist from positioned text (the completed sheet has no form fields).
   * `pages` is an array of item lists: { text, x, y } with y consistent inside each page.
   * Columns match the sheet: Base ~248, Holo ~318, Full Art ~388.
   */
  function parseTextItems(pages, check) {
    const byNo = new Map(check.cards.map((card) => [card.no, card]));
    const counts = {};
    const seen = new Set();
    pages.forEach((items) => {
      clusterRows(items).forEach((row) => {
        const numItem = row.items.find((item) => item.x < 46 && /^\d{3}$/.test(item.text));
        if (!numItem) return;
        const no = parseInt(numItem.text, 10);
        const card = byNo.get(no);
        if (!card || seen.has(card.id)) return;
        seen.add(card.id);
        counts[card.id] = {
          base: qtyInRange(row.items, 240, 310),
          holo: qtyInRange(row.items, 310, 380),
          fa: qtyInRange(row.items, 380, 470),
        };
      });
    });
    return { counts, seen: seen.size };
  }

  function readFormCounts(form) {
    const counts = {};
    let fields = 0;
    let format = "";
    form.getFields().forEach((field) => {
      const name = field.getName();
      if (name === "ddl.format") {
        try { format = field.getText() || ""; } catch (_err) { format = ""; }
        return;
      }
      const match = /^qty\.(V\d{3})\.(base|holo|fa)$/.exec(name);
      if (!match) return;
      fields += 1;
      let text = "";
      try { text = field.getText() || ""; } catch (_err) { text = ""; }
      if (!counts[match[1]]) counts[match[1]] = {};
      counts[match[1]][match[2]] = qtyFromText(text);
    });
    return { counts, fields, format };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ddl-pdf="' + src + '"]');
      if (existing) {
        if (existing.dataset.ready === "1") resolve();
        else existing.addEventListener("load", () => resolve(), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.ddlPdf = src;
      script.onload = () => {
        script.dataset.ready = "1";
        resolve();
      };
      script.onerror = () => reject(new Error("Could not load the PDF tools. Check your connection and try again."));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfLib(passed) {
    if (passed && passed.PDFDocument) return passed;
    const scope = typeof globalThis !== "undefined" ? globalThis : window;
    if (scope.PDFLib) return scope.PDFLib;
    await loadScript(PDF_LIB_SRC);
    if (!scope.PDFLib) throw new Error("Could not load the PDF tools. Check your connection and try again.");
    return scope.PDFLib;
  }

  async function ensurePdfJs() {
    const scope = typeof globalThis !== "undefined" ? globalThis : window;
    if (!scope.pdfjsLib) await loadScript(PDFJS_SRC);
    const pdfjsLib = scope.pdfjsLib;
    if (!pdfjsLib) throw new Error("Could not load the PDF tools. Check your connection and try again.");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      const code = await (await fetch(PDFJS_WORKER)).text();
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    }
    return pdfjsLib;
  }

  function checklistFileName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "DDL_TCG_Checklist_" + pad(now.getMonth() + 1) + pad(now.getDate()) + now.getFullYear() + ".pdf";
  }

  function savePdf(bytes, name) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name || checklistFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  async function buildPdf(check, collection, pdfLib) {
    const lib = await ensurePdfLib(pdfLib);
    const { PDFDocument, StandardFonts, rgb } = lib;
    const counts = countsFromCollection(check, collection);
    const stats = pile(check, counts);
    const any = stats.raw > 0;
    const doc = await PDFDocument.create();
    const fonts = {
      roman: await doc.embedFont(StandardFonts.TimesRoman),
      bold: await doc.embedFont(StandardFonts.TimesRomanBold),
      italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    };
    const color = {
      purple: rgb(0.102, 0.039, 0.180),
      gold: rgb(0.910, 0.745, 0.290),
      white: rgb(1, 1, 1),
      cream: rgb(1, 0.988, 0.965),
      tan: rgb(0.953, 0.922, 0.847),
      miss: rgb(1, 0.804, 0.824),
      have: rgb(0.953, 0.898, 0.961),
      haveBase: rgb(0.988, 0.894, 0.925),
      green: rgb(0.106, 0.369, 0.125),
      orange: rgb(0.902, 0.353, 0),
      red: rgb(0.718, 0.110, 0.110),
      ink: rgb(0.102, 0.078, 0.020),
      muted: rgb(0.35, 0.32, 0.28),
    };
    const classDot = {
      Crown: rgb(0.85, 0.65, 0.13),
      Bow: rgb(0.18, 0.62, 0.32),
      Wizard: rgb(0.25, 0.45, 0.85),
      Neutral: rgb(0.45, 0.45, 0.48),
      Zombie: rgb(0.35, 0.55, 0.22),
      Pirate: rgb(0.90, 0.45, 0.15),
      All: rgb(0.55, 0.28, 0.72),
    };
    const form = doc.getForm();

    function rarColor(tier) {
      if (tier === "GIGA") return rgb(0.55, 0.22, 0.62);
      if (tier === "UR") return rgb(0.72, 0.15, 0.42);
      return color.ink;
    }

    function fillFor(st, index) {
      if (st.fill === "miss") return color.miss;
      if (st.fill === "have") return color.have;
      if (st.fill === "have-base") return color.haveBase;
      return index % 2 ? color.tan : color.cream;
    }

    function toneColor(tone) {
      if (tone === "green") return color.green;
      if (tone === "orange") return color.orange;
      if (tone === "red") return color.red;
      return color.ink;
    }

    function drawHeader(page, subtitle) {
      const width = page.getWidth();
      const height = page.getHeight();
      page.drawRectangle({ x: 0, y: height - 48, width, height: 48, color: color.purple });
      page.drawRectangle({ x: 0, y: height - 51, width, height: 3, color: color.gold });
      page.drawText("DOGINAL DOGS LEGENDS", {
        x: 28, y: height - 22, size: 13, font: fonts.bold, color: color.gold,
      });
      page.drawText(subtitle, {
        x: 28, y: height - 38, size: 11, font: fonts.bold, color: color.white,
      });
      const lines = ["X in box = 1st copy", "each hash after = +1"];
      lines.forEach((line, i) => {
        const w = fonts.roman.widthOfTextAtSize(line, 8);
        page.drawText(line, {
          x: width - 28 - w, y: height - 20 - i * 12, size: 8, font: fonts.roman, color: color.white,
        });
      });
      return height - 51;
    }

    function drawFooter(page, pageNo) {
      const width = page.getWidth();
      page.drawRectangle({ x: 0, y: 0, width, height: 22, color: color.purple });
      page.drawText("Read from your printed ticks  \u00b7  hashes = extras", {
        x: 28, y: 7, size: 8, font: fonts.roman, color: color.white,
      });
      const label = "Page " + pageNo;
      const w = fonts.roman.widthOfTextAtSize(label, 8);
      page.drawText(label, { x: width - 28 - w, y: 7, size: 8, font: fonts.roman, color: color.white });
    }

    function drawColumns(page, yTop) {
      page.drawRectangle({ x: 22, y: yTop - 14, width: 568, height: 14, color: color.purple });
      const headers = [
        [28, "#"], [48, "NAME"], [150, "RAR"], [188, "CLASS"],
        [248, "BASE"], [318, "HOLO"], [388, "FULL ART"], [478, "STATUS"],
      ];
      headers.forEach(([x, label]) => {
        page.drawText(label, { x, y: yTop - 10.5, size: 7.5, font: fonts.bold, color: color.gold });
      });
      return yTop - 14;
    }

    function drawDash(page, x, baseline) {
      page.drawText(DASH, { x, y: baseline, size: 8, font: fonts.roman, color: color.muted });
    }

    function drawQty(page, name, n, x, bottom, fill) {
      const baseline = bottom + 2.6;
      if (n > 0) {
        const box = 9;
        const by = bottom + 1.8;
        page.drawRectangle({
          x, y: by, width: box, height: box, borderColor: color.green, borderWidth: 0.9,
        });
        page.drawLine({
          start: { x: x + 1.6, y: by + 4.3 }, end: { x: x + 3.5, y: by + 2.1 },
          thickness: 1.05, color: color.green,
        });
        page.drawLine({
          start: { x: x + 3.4, y: by + 2.2 }, end: { x: x + 7.5, y: by + 7.3 },
          thickness: 1.05, color: color.green,
        });
      }
      const field = form.createTextField(name);
      field.setText(n > 0 ? n + "x" : DASH);
      field.addToPage(page, {
        x: x + (n > 0 ? 11 : 0),
        y: bottom + 1.3,
        width: 28,
        height: 10,
        borderWidth: 0,
        backgroundColor: fill,
        textColor: n > 0 ? color.green : color.muted,
        font: n > 0 ? fonts.bold : fonts.roman,
      });
      field.setFontSize(n > 0 ? 9 : 8);
      field.setMaxLength(5);
    }

    function drawCardRow(page, card, index, bottom) {
      const q = counts[card.id] || { base: 0, holo: 0, fa: 0 };
      const st = statusFor(card, q);
      const fill = fillFor(st, index);
      page.drawRectangle({ x: 22, y: bottom, width: 568, height: ROW_H, color: fill });
      const baseline = bottom + 2.8;
      const rar = card.tier === "CR" ? "C/R" : card.tier;
      page.drawText(String(card.no).padStart(3, "0"), {
        x: 28, y: baseline, size: 7.5, font: fonts.roman, color: color.ink,
      });
      page.drawText(card.name, { x: 48, y: baseline, size: 8, font: fonts.bold, color: color.ink });
      page.drawText(rar, { x: 150, y: baseline, size: 7.5, font: fonts.bold, color: rarColor(card.tier) });
      page.drawCircle({ x: 192, y: baseline + 2.4, size: 2.1, color: classDot[card.class] || color.muted });
      page.drawText(card.class, { x: 198, y: baseline, size: 7.5, font: fonts.roman, color: color.ink });
      if (card.chase) {
        drawQty(page, "qty." + card.id + ".base", q.base, 248, bottom, fill);
        drawDash(page, 322, baseline);
        drawQty(page, "qty." + card.id + ".fa", q.fa, 388, bottom, fill);
        if (q.fa > 0) {
          page.drawText("CHASE", { x: 432, y: baseline, size: 6.5, font: fonts.bold, color: color.orange });
        }
      } else {
        drawQty(page, "qty." + card.id + ".base", q.base, 248, bottom, fill);
        drawQty(page, "qty." + card.id + ".holo", q.holo, 318, bottom, fill);
        drawDash(page, 392, baseline);
      }
      page.drawText(st.label, {
        x: 478, y: baseline, size: 7, font: fonts.bold, color: toneColor(st.tone),
      });
    }

    function drawTablePage(page, cards, top, pageNo) {
      let cursor = top;
      cards.forEach((card, index) => {
        cursor -= ROW_H;
        drawCardRow(page, card, index, cursor);
      });
      drawFooter(page, pageNo);
    }

    const page1 = doc.addPage([612, 792]);
    const sub = any ? "Rise of the Pack  \u00b7  YOUR completed checklist" : "Rise of the Pack  \u00b7  blank checklist";
    let y = drawHeader(page1, sub);
    y -= 16;
    const read = "Read: checked box = copy #1. Vertical hashes after the box = extra copies (2x / 3x / 4x).";
    page1.drawText(read, { x: 28, y: y, size: 8, font: fonts.bold, color: color.ink });
    y -= 16;
    page1.drawRectangle({ x: 22, y: y - 4, width: 568, height: 16, color: color.purple });
    const summary = [
      [32, "C/R BASE names  " + stats.crBase + "/" + stats.crN],
      [168, "C/R HOLO names  " + stats.crHolo + "/" + stats.crN],
      [318, "FULL ART  " + stats.fa + "/" + stats.faN],
      [430, "NAMES  " + stats.names + "/" + stats.nameN],
    ];
    summary.forEach(([x, label]) => {
      page1.drawText(label, { x, y: y, size: 8, font: fonts.bold, color: color.gold });
    });
    y -= 8;
    const rowTop = drawColumns(page1, y);
    drawTablePage(page1, check.cards.slice(0, 51), rowTop, 1);

    const page2 = doc.addPage([612, 792]);
    y = drawHeader(page2, sub);
    y -= 8;
    drawTablePage(page2, check.cards.slice(51, 105), drawColumns(page2, y), 2);

    const page3 = doc.addPage([612, 792]);
    y = drawHeader(page3, sub);
    y -= 8;
    drawTablePage(page3, check.cards.slice(105), drawColumns(page3, y), 3);

    const page4 = doc.addPage([612, 792]);
    y = drawHeader(page4, "Chase  \u00b7  missing  \u00b7  totals");
    y -= 22;
    page4.drawText("19 Full Art Chase", { x: 28, y: y, size: 13, font: fonts.bold, color: color.ink });
    y -= 8;
    page4.drawRectangle({ x: 22, y: y - 16, width: 568, height: 16, color: color.purple });
    [
      [30, "#"], [50, "NAME"], [150, "RARITY"], [210, "CLASS"],
      [280, "FULL ART"], [370, "NON-FA COPY"], [470, "STATUS"],
    ].forEach(([x, label]) => {
      page4.drawText(label, { x, y: y - 12, size: 8, font: fonts.bold, color: color.gold });
    });
    y -= 16;
    const chase = check.cards.filter((card) => card.chase);
    chase.forEach((card, index) => {
      y -= 14;
      const q = counts[card.id] || { base: 0, fa: 0 };
      const owned = q.fa > 0;
      const fill = owned ? (q.base > 0 ? color.haveBase : color.have) : color.miss;
      page4.drawRectangle({ x: 22, y: y, width: 568, height: 14, color: fill });
      const baseline = y + 3.2;
      page4.drawText(String(card.chaseNo || index + 1).padStart(2, "0"), {
        x: 30, y: baseline, size: 8, font: fonts.roman, color: color.ink,
      });
      page4.drawText(card.name, { x: 50, y: baseline, size: 9, font: fonts.bold, color: color.ink });
      if (card.aliases && card.aliases[0]) {
        const nameW = fonts.bold.widthOfTextAtSize(card.name, 9);
        page4.drawText(card.aliases[0], {
          x: 54 + nameW, y: baseline, size: 7, font: fonts.italic, color: color.muted,
        });
      }
      page4.drawText(card.tier, { x: 150, y: baseline, size: 8, font: fonts.bold, color: rarColor(card.tier) });
      page4.drawText(card.class, { x: 210, y: baseline, size: 8, font: fonts.roman, color: color.ink });
      if (q.fa > 0) {
        const bx = 280;
        const by = y + 2.4;
        page4.drawRectangle({
          x: bx, y: by, width: 9, height: 9, borderColor: color.green, borderWidth: 0.9,
        });
        page4.drawLine({
          start: { x: bx + 1.6, y: by + 4.3 }, end: { x: bx + 3.5, y: by + 2.1 },
          thickness: 1.05, color: color.green,
        });
        page4.drawLine({
          start: { x: bx + 3.4, y: by + 2.2 }, end: { x: bx + 7.5, y: by + 7.3 },
          thickness: 1.05, color: color.green,
        });
        page4.drawText(q.fa + "x", { x: 292, y: baseline, size: 9, font: fonts.bold, color: color.green });
      } else {
        page4.drawText(DASH, { x: 284, y: baseline, size: 8, font: fonts.roman, color: color.muted });
      }
      if (q.base > 0) {
        page4.drawText("yes  " + q.base + "x", { x: 370, y: baseline, size: 8, font: fonts.roman, color: color.ink });
      } else {
        page4.drawText(DASH, { x: 370, y: baseline, size: 8, font: fonts.roman, color: color.muted });
      }
      page4.drawText(owned ? "OWNED" : "NEED", {
        x: 470, y: baseline, size: 8, font: fonts.bold, color: owned ? color.green : color.red,
      });
    });

    y -= 22;
    page4.drawText("Still missing (zero copies)", { x: 28, y: y, size: 12, font: fonts.bold, color: color.ink });
    y -= 14;
    if (!stats.missing.length) {
      page4.drawText("Nothing is missing.", { x: 36, y: y, size: 9, font: fonts.roman, color: color.ink });
      y -= 14;
    } else if (stats.missing.length > 18) {
      wrapText(stats.missing.map((card) => card.name).join("  \u00b7  "), fonts.roman, 8, 540).forEach((line) => {
        page4.drawText(line, { x: 28, y: y, size: 8, font: fonts.roman, color: color.red });
        y -= 11;
      });
    } else {
      stats.missing.forEach((card) => {
        page4.drawText("\u00b7  " + card.name, { x: 36, y: y, size: 9, font: fonts.roman, color: color.red });
        y -= 11;
      });
    }
    const allChase = stats.missing.length > 0 && stats.missing.every((card) => card.chase);
    const missNote = stats.missing.length + " name" + (stats.missing.length === 1 ? "" : "s") + " with nothing in the pile."
      + (allChase ? " All remaining holes are chase cards." : "");
    page4.drawText(missNote, { x: 36, y: y, size: 8, font: fonts.italic, color: color.muted });
    y -= 18;
    page4.drawText("Need holo (have base, no foil)", { x: 28, y: y, size: 12, font: fonts.bold, color: color.ink });
    y -= 14;
    const holoLine = stats.needHolo.length ? stats.needHolo.map((card) => card.name).join("  \u00b7  ") : "None.";
    wrapText(holoLine, fonts.roman, 8, 540).forEach((line) => {
      page4.drawText(line, { x: 28, y: y, size: 8, font: fonts.roman, color: color.orange });
      y -= 11;
    });
    y -= 8;
    page4.drawText("Totals", { x: 28, y: y, size: 12, font: fonts.bold, color: color.ink });
    y -= 6;
    const totalRows = [
      ["C/R base names owned (unique)", stats.crBase + " / " + stats.crN],
      ["C/R holo names owned (unique)", stats.crHolo + " / " + stats.crN],
      ["Full art chase owned", stats.fa + " / " + stats.faN],
      ["Master-set print types", stats.master + " / " + stats.masterN],
      ["Unique names you have at least 1 of", stats.names + " / " + stats.nameN],
      ["Raw cards counted (all copies)", stats.raw + "  (base " + stats.rawBase + " \u00b7 holo " + stats.rawHolo + " \u00b7 FA " + stats.rawFa + ")"],
    ];
    totalRows.forEach(([label, value]) => {
      y -= 16;
      page4.drawRectangle({ x: 22, y: y, width: 568, height: 16, color: color.purple });
      page4.drawText(label, { x: 30, y: y + 4, size: 8, font: fonts.bold, color: color.gold });
      const vw = fonts.bold.widthOfTextAtSize(value, 8);
      page4.drawText(value, { x: 584 - vw, y: y + 4, size: 8, font: fonts.bold, color: color.white });
    });
    drawFooter(page4, 4);

    const marker = form.createTextField("ddl.format");
    marker.setText(FORMAT);
    marker.addToPage(page1, {
      x: 2, y: 2, width: 8, height: 6, borderWidth: 0, textColor: color.purple, backgroundColor: color.purple,
    });
    marker.setFontSize(1);
    form.updateFieldAppearances(fonts.bold);

    doc.setTitle("DDL TCG Rise of the Pack \u2014 Completed Collection");
    doc.setAuthor("Kush collection");
    doc.setSubject("Rise of the Pack checklist");
    return doc.save();
  }

  function wrapText(text, font, size, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  async function textItemsFromBytes(bytes) {
    const pdfjsLib = await ensurePdfJs();
    const doc = await pdfjsLib.getDocument({ data: bytes, disableWorker: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.filter((item) => item.str && item.str.trim()).map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
      })));
    }
    return pages;
  }

  async function parsePdf(bytes, check, pdfLib) {
    const lib = await ensurePdfLib(pdfLib);
    let formResult = null;
    try {
      const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
      formResult = readFormCounts(doc.getForm());
    } catch (_err) {
      formResult = null;
    }
    if (formResult && (formResult.format === FORMAT || formResult.fields >= 150)) {
      return formResult.counts;
    }
    const pages = await textItemsFromBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const parsed = parseTextItems(pages, check);
    if (parsed.seen < 100) {
      throw new Error("That PDF is not a Rise of the Pack checklist. Download a checklist, type 1x / 2x in the boxes, save, and import that file.");
    }
    return parsed.counts;
  }

  async function download(check, collection) {
    const bytes = await buildPdf(check, collection);
    savePdf(bytes, checklistFileName());
  }

  async function readFile(file, check) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parsePdf(bytes, check);
  }

  return {
    FORMAT,
    qtyFromText,
    countsFromCollection,
    pile,
    parseTextItems,
    readFormCounts,
    buildPdf,
    parsePdf,
    download,
    readFile,
    checklistFileName,
  };
});
