"""Build printed-name fingerprints for the handheld card scanner (bracket/ddl-name-prints.js).

The name sits on the band under the CREATURE/SPELL tabs (about 68-72% down the card on
every frame style, full arts included). Each card stores that band as a small whiteness
mask (min of R,G,B stretched), so matching follows the letter shapes rather than the art.
"""
from __future__ import annotations

import base64
import json
import re
import ssl
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = ROOT / "dd-evaluator" / "ddl-checklist.js"
OUT = ROOT / "bracket" / "ddl-name-prints.js"
CACHE = Path(__file__).resolve().parent / ".cache" / "card-renders"
CTX = ssl.create_default_context()

BOX = {"x0": 0.16, "y0": 0.674, "x1": 0.84, "y1": 0.724}
W, H = 128, 12
# Framed cards print the name in white: min(R,G,B) keeps it and drops coloured art and texture.
WHITE_LO, WHITE_HI = 140, 230
# Full arts (UR / GIGA) print it in black with a thin white outline: max(R,G,B) below DARK_HI.
DARK_LO, DARK_HI = 40, 110
FULL_ART_TIERS = {"UR", "GIGA"}


def card_rows() -> dict[str, tuple[str, str]]:
    raw = CHECKLIST.read_text(encoding="utf-8")
    rows = sorted({(int(n), name, tier) for n, name, tier in re.findall(r"\[(\d+),\s*'([^']*)',\s*'([^']*)'", raw)})
    return {f"V{n:03d}": (name, tier) for n, name, tier in rows}


def fetch(cid: str) -> Path:
    dest = CACHE / f"{cid}.png"
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        f"https://ddltcg.com/card_renders/{cid}.png",
        headers={"User-Agent": "KushMedia-ddl-name-prints/1.0"},
    )
    with urllib.request.urlopen(req, context=CTX, timeout=40) as res:
        dest.write_bytes(res.read())
    return dest


def band(path: Path, dark: bool) -> bytes:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    crop = im.crop((
        round(w * BOX["x0"]), round(h * BOX["y0"]),
        round(w * BOX["x1"]), round(h * BOX["y1"]),
    ))
    mask = Image.new("L", crop.size)
    if dark:
        mask.putdata([max(0, min(255, round((DARK_HI - max(p)) * 255 / (DARK_HI - DARK_LO)))) for p in crop.getdata()])
    else:
        mask.putdata([max(0, min(255, round((min(p) - WHITE_LO) * 255 / (WHITE_HI - WHITE_LO)))) for p in crop.getdata()])
    return bytes(mask.resize((W, H), Image.Resampling.BOX).getdata())


def main() -> None:
    rows = card_rows()
    names = {cid: name for cid, (name, _tier) in rows.items()}
    dark = [cid for cid, (_name, tier) in rows.items() if tier in FULL_ART_TIERS]
    cards = {}
    for cid in rows:
        cards[cid] = base64.b64encode(band(fetch(cid), cid in dark)).decode("ascii")
    seen: dict[str, list[str]] = {}
    for cid, name in names.items():
        seen.setdefault(name.strip().lower(), []).append(cid)
    print("shared names", {k: v for k, v in seen.items() if len(v) > 1}, "dark", len(dark))
    pack = {"w": W, "h": H, "box": BOX, "names": names, "dark": dark, "cards": cards}
    OUT.write_text(
        "/** Printed-name fingerprints for the handheld card scanner (built by _tools/build-ddl-name-prints.py). */\n"
        "window.DDL_NAME_PRINTS = " + json.dumps(pack, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print("wrote", OUT, "cards", len(cards), "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
