"""
OPS Insight — Instagram Post Generator
1080x1080 square. Single-image insight/stat/tip post.

Not serialized like OPP. Data-driven, not motivational.
Supports color markup and optional visual elements.
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ─── DESIGN TOKENS (from portal theme + system.md) ────────
S = 1080

BG        = (10, 10, 10)       # #0A0A0A
WHITE     = (255, 255, 255)
GRAY      = (153, 153, 153)    # #999999
MUTED     = (60, 60, 60)
BORDER_RGB = (36, 36, 36)

# Portal palette
C_SUCCESS   = (157, 181, 130)  # #9DB582
C_NEGATIVE  = (181, 130, 137)  # #B58289
C_ALERT     = (196, 168, 104)  # #C4A868
C_STEEL     = (129, 149, 181)  # #8195B5
C_RECV      = (212, 165, 116)  # #D4A574
C_OVERDUE   = (147, 50, 26)    # #93321A
C_ESTIMATED = (181, 163, 129)  # #B5A381
C_ARCHIVED  = (161, 130, 181)  # #A182B5

COLOR_MAP = {
    "green": C_SUCCESS, "profit": C_SUCCESS, "positive": C_SUCCESS,
    "red": C_NEGATIVE, "loss": C_NEGATIVE, "negative": C_NEGATIVE,
    "cost": C_NEGATIVE, "expense": C_NEGATIVE,
    "yellow": C_ALERT, "amber": C_ALERT, "revenue": C_ALERT, "warning": C_ALERT,
    "blue": C_STEEL, "active": C_STEEL, "steel": C_STEEL,
    "recv": C_RECV, "receivable": C_RECV,
    "overdue": C_OVERDUE,
    "estimated": C_ESTIMATED, "pending": C_ESTIMATED,
    "purple": C_ARCHIVED, "archived": C_ARCHIVED,
}

# ─── FONT PATHS ─────────────────────────────────────────────
FONT_DIR = os.environ.get("OPS_FONT_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "..", "public", "fonts"))

def _fp(name): return os.path.join(FONT_DIR, name)
FALLBACK = "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf"

def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for p in [_fp(name), FALLBACK]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except: continue
    return ImageFont.load_default()


# ─── UTILITIES ──────────────────────────────────────────────

def blend_with_bg(color: tuple, opacity: float = 0.4) -> tuple:
    return tuple(int(c * opacity + bg * (1 - opacity)) for c, bg in zip(color, BG))


def gradient_bg() -> Image.Image:
    arr = np.zeros((S, S, 3), dtype=np.uint8)
    for y in range(S):
        v = int(16 - 6 * (y / S))
        arr[y, :] = [v, v, v]
    return Image.fromarray(arr)


def noise_layer(strength: float = 0.015) -> Image.Image:
    n = np.random.randint(0, 255, (S, S), dtype=np.uint8)
    alpha = (n.astype(np.float64) * strength).astype(np.uint8)
    layer = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    layer.putalpha(Image.fromarray(alpha))
    return layer


def rule(draw, x, y, length):
    draw.line([(x, y), (x + length, y)], fill=BORDER_RGB, width=1)


def tracked(draw, text, f, x, y, color, spacing=4):
    for ch in text:
        draw.text((x, y), ch, fill=color, font=f)
        x += f.getbbox(ch)[2] - f.getbbox(ch)[0] + spacing


def tracked_width(text, f, spacing=4):
    w = 0
    for i, ch in enumerate(text):
        w += f.getbbox(ch)[2] - f.getbbox(ch)[0]
        if i < len(text) - 1: w += spacing
    return w


def wrap(text, f, max_w):
    words, lines, cur = text.split(), [], []
    for w in words:
        test = " ".join(cur + [w])
        if (f.getbbox(test)[2] - f.getbbox(test)[0]) <= max_w:
            cur.append(w)
        else:
            if cur: lines.append(" ".join(cur))
            cur = [w]
    if cur: lines.append(" ".join(cur))
    return lines


import re

def _parse_colored_text(text: str) -> list[tuple]:
    parts = []
    last = 0
    for m in re.finditer(r'\{(\w+):([^}]+)\}', text):
        if m.start() > last:
            parts.append((text[last:m.start()], None))
        color_name = m.group(1).lower()
        color = COLOR_MAP.get(color_name, WHITE)
        parts.append((m.group(2), color))
        last = m.end()
    if last < len(text):
        parts.append((text[last:], None))
    return parts if parts else [(text, None)]


def _draw_colored_line(draw, parts, f, x, y, default_color):
    cx = x
    for text, color in parts:
        c = color or default_color
        draw.text((cx, y), text, fill=c, font=f)
        bb = f.getbbox(text)
        cx += bb[2] - bb[0]


def _draw_bar_chart(draw, bars, x, y, w, f_label):
    """Horizontal bars — Kosugi labels, low-opacity fill, full-opacity border."""
    bar_h = 28
    gap = 20
    bar_opacity = 0.35
    cur_y = y

    for b in bars:
        label = b.get("label", "")
        val = b.get("value", 0)
        color = COLOR_MAP.get(b.get("color", ""), GRAY)
        bar_fill = blend_with_bg(color, bar_opacity)
        pct = val / (max(bb.get("value", 0) for bb in bars) or 100)
        val_str = str(b.get("display", val))

        draw.text((x, cur_y), label.upper(), fill=GRAY, font=f_label)
        lbl_w = f_label.getbbox(label.upper())[2] - f_label.getbbox(label.upper())[0]
        draw.text((x + lbl_w + 12, cur_y), val_str, fill=color, font=f_label)
        cur_y += 22

        bar_w = int((w - 40) * pct)
        bar_w = max(bar_w, 16)
        draw.rounded_rectangle(
            [(x, cur_y), (x + bar_w, cur_y + bar_h)],
            radius=3, fill=bar_fill, outline=color, width=1
        )
        cur_y += bar_h + gap

    return cur_y - y


def _draw_comparison(draw, left_label, left_val, right_label, right_val,
                     left_color, right_color, x, y, w, f_val, f_label):
    lc = COLOR_MAP.get(left_color, GRAY)
    rc = COLOR_MAP.get(right_color, GRAY)
    half_w = (w - 40) // 2

    draw.text((x, y), left_label.upper(), fill=GRAY, font=f_label)
    draw.text((x, y + 24), left_val, fill=lc, font=f_val)

    mid_x = x + half_w + 20
    draw.line([(mid_x, y), (mid_x, y + 56)], fill=MUTED, width=1)

    draw.text((mid_x + 24, y), right_label.upper(), fill=GRAY, font=f_label)
    draw.text((mid_x + 24, y + 24), right_val, fill=rc, font=f_val)

    return 68


# ─── MAIN GENERATOR ────────────────────────────────────────

def generate_insight(headline: str, stat: str = None,
                     stat_label: str = None,
                     stat_color: str = None,
                     context_lines: list[str] = None,
                     source: str = None,
                     visual: dict = None,
                     output_path: str = "insight_output.png"):
    """
    One-off insight post layout:
    ┌─────────────────────────┐
    │ [ OPS INSIGHT ]         │  ← Kosugi stamp
    │                         │
    │ 73%                     │  ← hero stat (optional), colored
    │ [ OF TRADES OWNERS ]    │  ← stat label — ties number to meaning
    │ HEADLINE TEXT            │  ← Mohave Bold, primary
    │ HEADLINE LINE 2         │
    │ ─── rule ────────────── │
    │                         │
    │ Context line 1.         │  ← Mohave Regular, supporting text
    │ Context line 2.         │
    │                         │
    │ [ visual element ]      │  ← optional bar/comparison
    │                         │
    │ ─── rule ────────────── │
    │ OPSAPP.CO    source     │  ← footer
    └─────────────────────────┘

    Vertically centered between chrome and footer.
    """
    img = gradient_bg()
    draw = ImageDraw.Draw(img)
    M = 100
    cw = S - M * 2

    f_stamp    = font("Kosugi-Regular.ttf", 13)
    f_stat     = font("Kosugi-Regular.ttf", 64)
    f_headline = font("Mohave-Bold.ttf", 44)
    f_body     = font("Mohave-Regular.ttf", 28)
    f_source   = font("Kosugi-Regular.ttf", 11)
    f_footer   = font("Kosugi-Regular.ttf", 12)
    f_vis_val  = font("Kosugi-Regular.ttf", 24)
    f_vis_lbl  = font("Kosugi-Regular.ttf", 14)

    context_lines = context_lines or []

    # ── Chrome
    tracked(draw, "[ OPS INSIGHT ]", f_stamp, M, 70, MUTED, 3)

    # ── Footer
    footer_y = S - 64
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO", f_footer, M, footer_y, MUTED, 3)
    if source:
        sw = tracked_width(source.upper(), f_source, 3)
        tracked(draw, source.upper(), f_source, S - M - sw, footer_y + 2, MUTED, 3)

    # ── Calculate total content height for centering
    usable_top = 110
    usable_bottom = footer_y - 30
    usable_h = usable_bottom - usable_top

    f_stat_lbl = font("Kosugi-Regular.ttf", 14)
    stat_h = 80 if stat else 0
    stat_label_h = 28 if (stat and stat_label) else 0
    headline_lines = wrap(headline.upper(), f_headline, cw)
    headline_lh = 54
    headline_h = len(headline_lines) * headline_lh
    rule_h = 36  # rule + gap below headline

    body_lh = 46
    body_h = 0
    for line in context_lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw)
        body_h += len(wrapped) * body_lh

    vis_h = 0
    vis_gap = 30
    if visual:
        vtype = visual.get("type", "")
        if vtype == "bars":
            vis_h = len(visual.get("data", [])) * (22 + 28 + 20) + vis_gap
        elif vtype == "comparison":
            vis_h = 68 + vis_gap
        elif vtype == "image":
            # Custom pre-rendered image — agent generates with matplotlib/pillow
            # Height estimated from the image itself, capped to fit
            _img_path = visual.get("path", "")
            if _img_path and os.path.exists(_img_path):
                _tmp = Image.open(_img_path)
                scale = min(cw / _tmp.width, 300 / _tmp.height)
                vis_h = int(_tmp.height * scale) + vis_gap
                _tmp.close()
            else:
                vis_h = 0

    total_h = stat_h + stat_label_h + headline_h + rule_h + body_h + vis_h
    start_y = usable_top + (usable_h - total_h) // 2
    start_y = max(usable_top, start_y)
    cur_y = start_y

    # ── Hero stat + label
    if stat:
        sc = COLOR_MAP.get(stat_color or "", WHITE)
        draw.text((M, cur_y), stat, fill=sc, font=f_stat)
        cur_y += stat_h
        if stat_label:
            tracked(draw, f"[ {stat_label.upper()} ]", f_stat_lbl, M, cur_y, GRAY, 3)
            cur_y += stat_label_h

    # ── Headline
    for ln in headline_lines:
        draw.text((M, cur_y), ln, fill=WHITE, font=f_headline)
        cur_y += headline_lh

    # ── Rule
    cur_y += 12
    rule(draw, M, cur_y, 80)
    cur_y += rule_h

    # ── Context lines with color markup
    for line in context_lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw)
        for j, wl in enumerate(wrapped):
            if len(parsed) > 1 or parsed[0][1] is not None:
                _draw_colored_line(draw, parsed, f_body, M, cur_y, GRAY)
            else:
                draw.text((M, cur_y), wl, fill=GRAY, font=f_body)
            cur_y += body_lh

    # ── Visual element
    if visual:
        cur_y += 12
        vtype = visual.get("type", "")
        if vtype == "bars":
            _draw_bar_chart(draw, visual.get("data", []),
                           M, cur_y, cw, f_vis_lbl)
        elif vtype == "comparison":
            _draw_comparison(draw,
                           visual.get("left_label", ""),
                           visual.get("left_val", ""),
                           visual.get("right_label", ""),
                           visual.get("right_val", ""),
                           visual.get("left_color", "red"),
                           visual.get("right_color", "green"),
                           M, cur_y, cw, f_vis_val, f_vis_lbl)
        elif vtype == "image":
            # Composite a pre-rendered image (matplotlib chart, custom graphic, etc.)
            img_path = visual.get("path", "")
            if img_path and os.path.exists(img_path):
                custom_img = Image.open(img_path).convert("RGBA")
                # Scale to fit content width, cap height at 300px
                scale = min(cw / custom_img.width, 300 / custom_img.height)
                new_w = int(custom_img.width * scale)
                new_h = int(custom_img.height * scale)
                custom_img = custom_img.resize((new_w, new_h), Image.LANCZOS)
                # Paste onto main image (left-aligned)
                img = img.convert("RGBA")
                img.paste(custom_img, (M, cur_y), custom_img)
                img = img.convert("RGB")
                draw = ImageDraw.Draw(img)  # refresh draw after conversion

    # ── Noise + save
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, noise_layer())
    img.convert("RGB").save(output_path, "PNG", quality=95)
    print(f"Generated: {output_path} ({S}x{S})")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headline", type=str, required=True)
    parser.add_argument("--stat", type=str, default=None)
    parser.add_argument("--stat-label", type=str, default=None)
    parser.add_argument("--stat-color", type=str, default=None)
    parser.add_argument("--context", nargs="+", default=[])
    parser.add_argument("--source", type=str, default=None)
    parser.add_argument("--output", type=str, default="insight_output.png")
    args = parser.parse_args()
    generate_insight(args.headline, args.stat, args.stat_label,
                     args.stat_color, args.context, args.source,
                     output_path=args.output)
