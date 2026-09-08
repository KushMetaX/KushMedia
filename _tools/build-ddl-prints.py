"""Build name + art fingerprints for IRL lane auto-ID."""
from __future__ import annotations

import json
import math
import ssl
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CARDS_JS = ROOT / "bracket" / "ddl-cards.js"
OUT = ROOT / "bracket" / "ddl-prints.js"
CACHE = Path(__file__).resolve().parent / ".cache" / "card-renders"
CTX = ssl.create_default_context()

# Art stays inside the illustration. The printed name sits on the dark
# band under the CREATURE/SPELL tabs (~0.62–0.70), not on the cream text box.
ART = {"x0": 0.11, "y0": 0.09, "x1": 0.89, "y1": 0.515}
NAME = {"x0": 0.10, "y0": 0.615, "x1": 0.90, "y1": 0.705}
FULL = {"x0": 0.08, "y0": 0.07, "x1": 0.92, "y1": 0.93}
ART_W, ART_H = 28, 24
NAME_W, NAME_H = 64, 14
FULL_W, FULL_H = 24, 32


def load_cards():
    raw = CARDS_JS.read_text(encoding="utf-8")
    start = raw.index("{")
    end = raw.rindex("}") + 1
    pack = json.loads(raw[start:end])
    return pack["cards"]


def crop_box(im: Image.Image, box: dict) -> Image.Image:
    w, h = im.size
    return im.crop((
        int(w * box["x0"]),
        int(h * box["y0"]),
        int(w * box["x1"]),
        int(h * box["y1"]),
    ))


def gray_hue(im: Image.Image, tw: int, th: int) -> tuple[list[int], list[float]]:
    rgb = im.convert("RGB").resize((tw, th), Image.Resampling.LANCZOS)
    gray = []
    hues = [0] * 8
    for r, g, b in rgb.getdata():
        gray.append(int(0.3 * r + 0.59 * g + 0.11 * b))
        mx = max(r, g, b)
        mn = min(r, g, b)
        if mx < 24 or mx - mn < 14:
            continue
        df = mx - mn
        if mx == r:
            hue = ((g - b) / df) % 6
        elif mx == g:
            hue = (b - r) / df + 2
        else:
            hue = (r - g) / df + 4
        if hue < 0:
            hue += 6
        hues[min(7, int((hue / 6) * 8))] += 1
    total = sum(hues) or 1
    hues = [round(n / total, 4) for n in hues]
    return gray, hues


def name_ink(im: Image.Image) -> list[int]:
    band = crop_box(im, NAME).convert("L")
    band = band.resize((band.width * 2, band.height * 2), Image.Resampling.BICUBIC)
    band = ImageOps.autocontrast(band, cutoff=2)
    pix = list(band.getdata())
    w, h = band.size
    mean = sum(pix) / len(pix)
    thr = mean + 28
    xs = [x for y in range(h) for x in range(w) if pix[y * w + x] >= thr]
    if len(xs) < 8:
        ink = band.resize((NAME_W, NAME_H), Image.Resampling.LANCZOS)
        return [1 if p >= 140 else 0 for p in ink.getdata()]
    pad = max(4, int((max(xs) - min(xs)) * 0.06))
    trimmed = band.crop((max(0, min(xs) - pad), 0, min(w, max(xs) + pad + 1), h))
    ink = trimmed.resize((NAME_W, NAME_H), Image.Resampling.LANCZOS)
    pix2 = list(ink.getdata())
    t2 = sum(pix2) / len(pix2) + 16
    return [1 if p >= t2 else 0 for p in pix2]


def art_color(im: Image.Image) -> list[int]:
    rgb = crop_box(im, ART).convert("RGB").resize((4, 3), Image.Resampling.LANCZOS)
    out: list[int] = []
    for r, g, b in rgb.getdata():
        out.extend([int(r), int(g), int(b)])
    return out


def fingerprint(im: Image.Image) -> dict:
    full_g, _ = gray_hue(crop_box(im, FULL), FULL_W, FULL_H)
    art_g, art_h = gray_hue(crop_box(im, ART), ART_W, ART_H)
    return {"g": full_g, "a": art_g, "h": art_h, "n": name_ink(im), "c": art_color(im)}


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return
    req = urllib.request.Request(url, headers={"User-Agent": "KushMedia-ddl-prints/1.0"})
    with urllib.request.urlopen(req, context=CTX, timeout=40) as res:
        dest.write_bytes(res.read())


def ncc(a: list[int], b: list[int]) -> float:
    n = min(len(a), len(b))
    if not n:
        return 0.0
    ma = sum(a[:n]) / n
    mb = sum(b[:n]) / n
    num = da = db = 0.0
    for i in range(n):
        xa = a[i] - ma
        xb = b[i] - mb
        num += xa * xb
        da += xa * xa
        db += xb * xb
    if da < 1e-6 or db < 1e-6:
        return 0.0
    return num / math.sqrt(da * db)


def wash_gray(im: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(im)
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray = gray.point(lambda p: 36 + int(p * 0.72))
    return gray.convert("RGB")


def report_neighbors(cards: list[dict], packed: dict, images: dict[str, Image.Image]) -> None:
    prints = packed["cards"]
    focus = "V041"
    if focus not in prints:
        return
    mine = prints[focus]
    ranked = []
    for cid, fp in prints.items():
        if cid == focus:
            continue
        ranked.append((
            ncc(mine["n"], fp["n"]),
            ncc(mine["a"], fp["a"]),
            cid,
            next((c["name"] for c in cards if c["id"] == cid), cid),
        ))
    ranked.sort(reverse=True)
    print("Surge name neighbors:")
    for name_s, art_s, cid, name in ranked[:6]:
        print(f"  {cid} {name:20} name={name_s:.3f} art={art_s:.3f}")
    ranked.sort(key=lambda row: row[1], reverse=True)
    print("Surge art neighbors:")
    for name_s, art_s, cid, name in ranked[:6]:
        print(f"  {cid} {name:20} name={name_s:.3f} art={art_s:.3f}")
    src = images.get(focus)
    if src is None:
        return
    washed = fingerprint(wash_gray(src))
    hits = []
    for cid, fp in prints.items():
        hits.append((ncc(washed["n"], fp["n"]), ncc(washed["a"], fp["a"]), cid))
    hits.sort(reverse=True)
    top = hits[0]
    second = hits[1][0] if len(hits) > 1 else 0
    print(
        f"washed Surge top={top[2]} name={top[0]:.3f} art={top[1]:.3f} gap={top[0] - second:.3f}"
    )


def main() -> None:
    cards = load_cards()
    packed = {
        "aw": ART_W,
        "ah": ART_H,
        "nw": NAME_W,
        "nh": NAME_H,
        "gw": FULL_W,
        "gh": FULL_H,
        "art": ART,
        "name": NAME,
        "full": FULL,
        "cards": {},
    }
    images = {}
    for card in cards:
        cid = card["id"]
        url = card.get("render") or f"https://ddltcg.com/card_renders/{cid}.png"
        dest = CACHE / f"{cid}.png"
        try:
            fetch(url, dest)
            im = Image.open(dest)
            images[cid] = im
            packed["cards"][cid] = fingerprint(im)
            print("ok", cid, card["name"])
        except Exception as err:
            print("fail", cid, err)
    report_neighbors(cards, packed, images)
    OUT.write_text(
        "/** Precomputed name + art fingerprints for IRL lane auto-ID. */\n"
        "window.DDL_PRINTS = "
        + json.dumps(packed, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print("wrote", OUT, "cards", len(packed["cards"]))


if __name__ == "__main__":
    main()
