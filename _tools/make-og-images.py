#!/usr/bin/env python3
"""Build 1200x630 Open Graph cards from live site art (logo + name on background)."""
from __future__ import annotations

import gzip
import json
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FONT_DIR = os.path.join(os.path.dirname(__file__), "og-fonts")
W, H = 1200, 630
GOLD = (232, 163, 23, 255)
CREAM = (246, 231, 200, 255)


def load_font(name: str, size: int, variation: bytes | None = None) -> ImageFont.FreeTypeFont:
    path = os.path.join(FONT_DIR, name)
    if not os.path.isfile(path):
        path = r"C:\Windows\Fonts\georgiab.ttf"
    font = ImageFont.truetype(path, size)
    if variation and hasattr(font, "set_variation_by_name"):
        try:
            font.set_variation_by_name(variation)
        except OSError:
            try:
                font.set_variation_by_axes([900])
            except OSError:
                pass
    return font


def cinzel(size: int) -> ImageFont.FreeTypeFont:
    return load_font("Cinzel-Bold.ttf", size, b"Black")


def outfit(size: int) -> ImageFont.FreeTypeFont:
    return load_font("Outfit-Bold.ttf", size)


def nunito(size: int) -> ImageFont.FreeTypeFont:
    font = load_font("Nunito-Bold.ttf", size)
    if hasattr(font, "set_variation_by_axes"):
        try:
            font.set_variation_by_axes([800])
        except OSError:
            pass
    return font


def georgia(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", size)


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    tw, th = size
    src = im.convert("RGBA")
    sw, sh = src.size
    scale = max(tw / sw, th / sh)
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    src = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return src.crop((left, top, left + tw, top + th))


def darken(im: Image.Image, amount: float = 0.42) -> Image.Image:
    overlay = Image.new("RGBA", im.size, (12, 6, 2, int(255 * amount)))
    return Image.alpha_composite(im.convert("RGBA"), overlay)


def vignette(im: Image.Image, strength: int = 170) -> Image.Image:
    layer = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(layer)
    margin = 48
    draw.ellipse((-margin, -margin, im.size[0] + margin, im.size[1] + margin), fill=255)
    layer = layer.filter(ImageFilter.GaussianBlur(90))
    inv = Image.eval(layer, lambda p: 255 - int((255 - p) * (strength / 255)))
    shade = Image.new("RGBA", im.size, (8, 4, 2, 0))
    shade.putalpha(Image.eval(inv, lambda p: int((255 - p) * 0.85)))
    return Image.alpha_composite(im.convert("RGBA"), shade)


def circle_thumb(im: Image.Image, size: int) -> Image.Image:
    src = cover(im.convert("RGBA"), (size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size - 2, size - 2), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(src, (0, 0), mask)
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(ring)
    d.ellipse((2, 2, size - 3, size - 3), outline=(232, 163, 23, 230), width=5)
    d.ellipse((8, 8, size - 9, size - 9), outline=(255, 214, 120, 90), width=2)
    return Image.alpha_composite(out, ring)


def rounded_thumb(im: Image.Image, size: int, radius: int = 28) -> Image.Image:
    src = cover(im.convert("RGBA"), (size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(src, (0, 0), mask)
    return out


def text_size(font: ImageFont.FreeTypeFont, text: str, stroke: int = 0) -> tuple[int, int]:
    bbox = font.getbbox(text, stroke_width=stroke)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def fit_line(text: str, max_width: int, make_font, start: int, floor: int = 36, stroke: int = 0) -> tuple[ImageFont.FreeTypeFont, int, int]:
    size = start
    while size > floor:
        font = make_font(size)
        tw, th = text_size(font, text, stroke)
        if tw <= max_width:
            return font, tw, th
        size -= 2
    font = make_font(floor)
    tw, th = text_size(font, text, stroke)
    return font, tw, th


def wrap_words(text: str, font: ImageFont.FreeTypeFont, max_width: int, stroke: int = 0) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        tw, _ = text_size(font, trial, stroke)
        if tw <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines[:3]


def draw_centered_line(canvas: Image.Image, text: str, font: ImageFont.FreeTypeFont, cx: int, y: int, fill, stroke: int = 0, stroke_fill=(40, 18, 6, 220)) -> int:
    draw = ImageDraw.Draw(canvas)
    tw, th = text_size(font, text, stroke)
    x = int(cx - tw / 2)
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
    return th


def draw_left_line(canvas: Image.Image, text: str, font: ImageFont.FreeTypeFont, x: int, y: int, fill, stroke: int = 0, stroke_fill=(40, 18, 6, 220)) -> tuple[int, int]:
    draw = ImageDraw.Draw(canvas)
    tw, th = text_size(font, text, stroke)
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
    return tw, th


def save_jpeg(im: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgb = Image.new("RGB", im.size, (12, 6, 2))
    rgb.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1])
    rgb.save(path, "JPEG", quality=90, optimize=True, progressive=True)
    print("wrote", path, os.path.getsize(path))


def save_gz_rgba(im: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = im.convert("RGBA").tobytes()
    with gzip.open(path, "wb", compresslevel=9) as fh:
        fh.write(raw)
    print("wrote", path, os.path.getsize(path))


def paint_lockup(canvas: Image.Image, logo: Image.Image, kicker: str, title: str, kicker_font, title_maker, gap: int = 36) -> None:
    text_max = 720
    stroke = 3
    title_font, title_w, title_h = fit_line(title.upper(), text_max, title_maker, 78, 34, stroke)
    lines = wrap_words(title.upper(), title_font, text_max, stroke)
    if len(lines) > 1:
        title_font, _, title_h = fit_line(max(lines, key=len), text_max, title_maker, 64, 32, stroke)
        lines = wrap_words(title.upper(), title_font, text_max, stroke)
    line_sizes = [text_size(title_font, line, stroke) for line in lines]
    text_w = max((w for w, _ in line_sizes), default=0)
    text_h = sum(h for _, h in line_sizes) + max(0, len(lines) - 1) * 8
    kick_h = 0
    kick_w = 0
    if kicker:
        kick_w, kick_h = text_size(kicker_font, kicker.upper(), 1)
        text_w = max(text_w, kick_w)
        text_h += kick_h + 14
    lockup_w = logo.size[0] + gap + text_w
    lockup_h = max(logo.size[1], text_h)
    x0 = (W - lockup_w) // 2
    y0 = (H - lockup_h) // 2
    canvas.alpha_composite(logo, (x0, y0 + (lockup_h - logo.size[1]) // 2))
    tx = x0 + logo.size[0] + gap
    ty = y0 + (lockup_h - text_h) // 2
    if kicker:
        draw_left_line(canvas, kicker.upper(), kicker_font, tx, ty, GOLD, 1, (40, 18, 6, 200))
        ty += kick_h + 14
    for line in lines:
        _, lh = draw_left_line(canvas, line, title_font, tx, ty, CREAM, stroke, (28, 12, 4, 230))
        ty += lh + 8


def make_tourney_base() -> Image.Image:
    flames = Image.open(os.path.join(ROOT, "bracket", "flames.jpg"))
    canvas = vignette(darken(cover(flames, (W, H)), 0.38), 160)
    return canvas


def make_tourney_logo() -> Image.Image:
    crest = Image.open(os.path.join(ROOT, "bracket", "crest.jpg"))
    return circle_thumb(crest, 268)


def build_tourney_default() -> Image.Image:
    canvas = make_tourney_base()
    paint_lockup(canvas, make_tourney_logo(), "DDL Tourney", "Legends Bracket", cinzel(28), cinzel)
    return canvas


def build_tourney_base_only() -> Image.Image:
    """Crest already placed; text is drawn later (static default also uses paint_lockup)."""
    return make_tourney_base()


def build_ddl() -> Image.Image:
    mascot = Image.open(os.path.join(ROOT, "ddl", "mascot.png"))
    bg = Image.new("RGBA", (W, H), (18, 14, 10, 255))
    glow = cover(mascot, (W, H)).filter(ImageFilter.GaussianBlur(28))
    glow = Image.eval(glow, lambda p: int(p * 0.45))
    bg = Image.alpha_composite(bg, glow)
    shade = Image.new("RGBA", (W, H), (10, 8, 6, 90))
    bg = Image.alpha_composite(bg, shade)
    logo = rounded_thumb(mascot, 300, 36)
    paint_lockup(bg, logo, "Rise of the Pack", "DDL Companion", nunito(26), georgia)
    return bg


def build_evaluator() -> Image.Image:
    bg_src = Image.open(os.path.join(ROOT, "assets", "DDBG.png"))
    canvas = vignette(darken(cover(bg_src, (W, H)), 0.48), 150)
    logo_src = Image.open(os.path.join(ROOT, "assets", "collection-logo.png"))
    logo = rounded_thumb(logo_src, 240, 28)
    plate = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle((0, 0, 255, 255), radius=32, fill=(12, 10, 6, 210), outline=(232, 197, 71, 180), width=3)
    plate.alpha_composite(logo, (8, 8))
    paint_lockup(canvas, plate, "Doginal Dogs", "Price Evaluator", cinzel(26), cinzel)
    return canvas


def build_glyph_atlas() -> None:
    chars = (
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
        "0123456789 .,'-:&!?/+#()[]@"
    )
    font = cinzel(96)
    stroke = 4
    pads = []
    metrics = []
    for ch in chars:
        glyph = ch
        tw, th = text_size(font, glyph, stroke)
        pad_w = max(8, tw + 12)
        pad_h = 128
        tile = Image.new("RGBA", (pad_w, pad_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(tile)
        bbox = font.getbbox(glyph, stroke_width=stroke)
        x = 6 - bbox[0]
        y = 20 - bbox[1]
        fill = CREAM if ch != " " else (0, 0, 0, 0)
        draw.text((x, y), glyph, font=font, fill=fill, stroke_width=stroke, stroke_fill=(28, 12, 4, 230))
        pads.append(tile)
        metrics.append({"ch": ch, "w": pad_w, "h": pad_h, "advance": tw + 4})
    atlas_w = sum(im.size[0] for im in pads)
    atlas = Image.new("RGBA", (atlas_w, 128), (0, 0, 0, 0))
    x = 0
    glyphs = {}
    for tile, meta in zip(pads, metrics):
        atlas.alpha_composite(tile, (x, 0))
        glyphs[meta["ch"]] = {"x": x, "w": meta["w"], "h": meta["h"], "advance": meta["advance"]}
        x += tile.size[0]
    out_dir = os.path.join(ROOT, "bracket", "og-assets")
    save_gz_rgba(atlas, os.path.join(out_dir, "glyphs.rgba.gz"))
    with open(os.path.join(out_dir, "glyphs.json"), "w", encoding="utf-8") as fh:
        json.dump({"width": atlas_w, "height": 128, "glyphs": glyphs}, fh, indent=2)
    print("wrote glyphs.json", atlas_w, "x", 128)


def main() -> None:
    share = build_tourney_default()
    save_jpeg(share, os.path.join(ROOT, "bracket", "share.jpg"))
    save_jpeg(share, os.path.join(ROOT, "bracket", "og.jpg"))
    save_jpeg(share, os.path.join(ROOT, "tourney", "public", "og.jpg"))
    save_jpeg(share, os.path.join(ROOT, "tourney", "graphics", "og.jpg"))
    save_gz_rgba(make_tourney_base(), os.path.join(ROOT, "bracket", "og-assets", "base.rgba.gz"))
    save_gz_rgba(make_tourney_logo(), os.path.join(ROOT, "bracket", "og-assets", "crest.rgba.gz"))
    with open(os.path.join(ROOT, "bracket", "og-assets", "crest.json"), "w", encoding="utf-8") as fh:
        json.dump({"width": 268, "height": 268}, fh)
    build_glyph_atlas()
    ddl = build_ddl()
    save_jpeg(ddl, os.path.join(ROOT, "ddl", "og.jpg"))
    evaluator = build_evaluator()
    save_jpeg(evaluator, os.path.join(ROOT, "dd-evaluator", "og.jpg"))


if __name__ == "__main__":
    main()
