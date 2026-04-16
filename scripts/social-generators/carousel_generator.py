"""
OPS Blog Carousel — Instagram Slide Generator
Built from .interface-design/system.md

1080x1350 (4:5 portrait) Instagram carousel.
Design system: x.ai / spacex.com / anduril.com aesthetic.
Monochromatic. Left-aligned. Precision accents only.
"""

import argparse
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# ─── DESIGN TOKENS (from system.md) ────────────────────────
W, H = 1080, 1350

BG        = (10, 10, 10)       # #0A0A0A
SURFACE_1 = (13, 13, 13)       # #0D0D0D
SURFACE_2 = (20, 20, 20)       # #141414
WHITE     = (255, 255, 255)    # text-primary
GRAY      = (153, 153, 153)    # text-secondary #999999
MUTED     = (60, 60, 60)       # barely visible labels
BORDER    = (255, 255, 255, 26)# rgba(255,255,255,0.10)
BORDER_RGB = (36, 36, 36)      # 10% white on #0A0A0A ≈ #242424
ACCENT    = (89, 119, 148)     # #597794 — PRECISION TOOL, not paint bucket

# Portal palette — from portal theme.ts / curated-colors.ts / globals.css
# These are the exact colors the client portal draws from.
C_SUCCESS  = (157, 181, 130)   # #9DB582 — portal-success, profit, accepted
C_NEGATIVE = (181, 130, 137)   # #B58289 — portal-error, cost, completed
C_ALERT    = (196, 168, 104)   # #C4A868 — portal-warning, revenue, amber
C_STEEL    = (129, 149, 181)   # #8195B5 — in-progress, active, steel blue
C_RECV     = (212, 165, 116)   # #D4A574 — receivables, warm amber
C_OVERDUE  = (147, 50, 26)     # #93321A — overdue only (harsh, use sparingly)
C_ESTIMATED = (181, 163, 129)  # #B5A381 — estimated, pending
C_ARCHIVED = (161, 130, 181)   # #A182B5 — archived, inactive

# Named color map for slide data — all portal-sourced
COLOR_MAP = {
    "green": C_SUCCESS, "profit": C_SUCCESS, "positive": C_SUCCESS, "accepted": C_SUCCESS,
    "red": C_NEGATIVE, "loss": C_NEGATIVE, "negative": C_NEGATIVE, "cost": C_NEGATIVE,
    "expense": C_NEGATIVE,
    "yellow": C_ALERT, "amber": C_ALERT, "revenue": C_ALERT, "warning": C_ALERT,
    "blue": C_STEEL, "active": C_STEEL, "accent": ACCENT, "steel": C_STEEL,
    "recv": C_RECV, "receivable": C_RECV,
    "overdue": C_OVERDUE,
    "estimated": C_ESTIMATED, "pending": C_ESTIMATED,
    "archived": C_ARCHIVED, "purple": C_ARCHIVED,
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
    """Blend a color with BG at given opacity — simulates lower opacity fill."""
    return tuple(int(c * opacity + bg * (1 - opacity)) for c, bg in zip(color, BG))


def gradient_bg(w: int, h: int) -> Image.Image:
    """Subtle top-to-bottom linear gradient. #101010 top → #0A0A0A bottom."""
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(h):
        v = int(16 - 6 * (y / h))  # 16 → 10
        arr[y, :] = [v, v, v]
    return Image.fromarray(arr)


def noise_layer(w: int, h: int, strength: float = 0.015) -> Image.Image:
    """Film grain at low opacity."""
    n = np.random.randint(0, 255, (h, w), dtype=np.uint8)
    alpha = (n.astype(np.float64) * strength).astype(np.uint8)
    layer = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    layer.putalpha(Image.fromarray(alpha))
    return layer


def rule(draw, x, y, length):
    """1px divider at ~10% white opacity."""
    draw.line([(x, y), (x + length, y)], fill=BORDER_RGB, width=1)


def tracked(draw, text, f, x, y, color, spacing=4):
    """Kosugi-style letter-spaced text."""
    for ch in text:
        draw.text((x, y), ch, fill=color, font=f)
        x += f.getbbox(ch)[2] - f.getbbox(ch)[0] + spacing


def tracked_width(text, f, spacing=4):
    w = 0
    for i, ch in enumerate(text):
        bb = f.getbbox(ch)
        w += bb[2] - bb[0]
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


def feather_image(path: str, canvas_w: int, canvas_h: int,
                  top_offset: int = 90, fade_end_y: int = 0) -> Image.Image:
    """
    Load image, place below top_offset (black band for chrome),
    scale to fill, and dissolve bottom edge so it meets the title text.
    fade_end_y = the y-coordinate where the image should be fully gone.
    """
    img = Image.open(path).convert("RGBA")

    # Available height for the image
    avail_h = (fade_end_y or int(canvas_h * 0.70)) - top_offset
    scale = max(canvas_w / img.width, avail_h / img.height)
    nw, nh = int(img.width * scale), int(img.height * scale)
    img = img.resize((nw, nh), Image.LANCZOS)

    # Center crop to canvas width
    if nw > canvas_w:
        left = (nw - canvas_w) // 2
        img = img.crop((left, 0, left + canvas_w, nh))
        nw = canvas_w

    # Slight darken for text contrast
    img = ImageEnhance.Brightness(img).enhance(0.75)
    img = ImageEnhance.Color(img).enhance(0.80)

    # Bottom-fade gradient: solid top 55%, then linear fade to 0
    grad = np.zeros((nh, canvas_w), dtype=np.uint8)
    for y in range(nh):
        t = y / nh
        if t < 0.55:
            a = 255
        else:
            a = int(255 * (1.0 - (t - 0.55) / 0.45))
        grad[y, :] = max(0, a)

    img.putalpha(Image.fromarray(grad, mode="L"))

    # Place at top_offset — leaving black band above
    result = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    result.paste(img, (0, top_offset), img)
    return result


def finalize(img: Image.Image, path: str):
    """Apply noise + save."""
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, noise_layer(img.width, img.height))
    img.convert("RGB").save(path, "PNG", quality=95)


# ─── SLIDE GENERATORS ──────────────────────────────────────

def title_slide(post_num: int, title: str, subtitle: str, path: str,
                thumbnail: str = None, slide_i: int = 0, total: int = 5):
    """
    Title slide layout:
    ┌─────────────────────┐
    │ [label]     [#/tot] │  ← black band, chrome always legible
    │                     │
    │   (feathered photo) │  ← starts below chrome, fills middle
    │   dissolves here ↓  │
    │ ─── rule ─────────  │  ← image fades right into title
    │ TITLE               │
    │ TITLE LINE 2        │  ← large Mohave Bold
    │ subtitle text       │  ← Mohave Regular, secondary
    │ ─── rule ─────────  │  ← footer rule
    │ OPSAPP.CO / JOURNAL │  ← footer
    └─────────────────────┘
    """
    M = 80
    cw = W - M * 2
    CHROME_BAND = 90  # black band height for header chrome

    # ── Fonts
    f_label   = font("Kosugi-Regular.ttf", 14)
    f_num     = font("Kosugi-Regular.ttf", 14)
    f_title   = font("Mohave-Bold.ttf", 78)
    f_sub     = font("Mohave-Regular.ttf", 28)
    f_footer  = font("Kosugi-Regular.ttf", 13)

    # ── Pre-calculate text block position (need this before placing image)
    footer_y = H - 60
    title_lines = wrap(title.upper(), f_title, cw)
    sub_lines = wrap(subtitle, f_sub, cw)
    title_lh = 88
    sub_lh = 38
    title_h = len(title_lines) * title_lh
    sub_h = len(sub_lines) * sub_lh
    gap = 20
    block_h = title_h + gap + sub_h

    # Title block anchored above footer
    rule_above_title = footer_y - 40 - block_h - 24
    title_y = rule_above_title + 24

    # Image should fade out right at the rule above the title
    fade_target = rule_above_title

    # ── Build image
    img = gradient_bg(W, H)

    if thumbnail and os.path.exists(thumbnail):
        img = img.convert("RGBA")
        img = Image.alpha_composite(img,
            feather_image(thumbnail, W, H, top_offset=CHROME_BAND, fade_end_y=fade_target))
        img = img.convert("RGB")

    draw = ImageDraw.Draw(img)

    # ── Top chrome (on black band — always legible)
    chrome_y = 40
    tracked(draw, "OPS JOURNAL", f_label, M, chrome_y, GRAY, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_num.getbbox(ind)[2] - f_num.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=GRAY, font=f_num)

    # ── Rule above title
    rule(draw, M, rule_above_title, cw)

    # ── Title
    for i, ln in enumerate(title_lines):
        draw.text((M, title_y + i * title_lh), ln, fill=WHITE, font=f_title)

    # ── Subtitle
    sub_y = title_y + title_h + gap
    for i, ln in enumerate(sub_lines):
        draw.text((M, sub_y + i * sub_lh), ln, fill=GRAY, font=f_sub)

    # ── Footer
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO / JOURNAL", f_footer, M, footer_y, MUTED, 3)

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] Title → {path}")


def _parse_colored_text(text: str) -> list[tuple]:
    """
    Parse text with color markup: {color:text} → list of (text, color|None).
    Example: "Revenue up {green:+32%} this quarter" →
        [("Revenue up ", None), ("+32%", C_SUCCESS), (" this quarter", None)]
    """
    import re
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


def _draw_colored_line(draw, parts: list[tuple], f, x: int, y: int, default_color):
    """Draw a line with mixed colors."""
    cx = x
    for text, color in parts:
        c = color or default_color
        draw.text((cx, y), text, fill=c, font=f)
        bb = f.getbbox(text)
        cx += bb[2] - bb[0]


def _draw_bar_chart(draw, bars: list[dict], x: int, y: int, w: int, f_label, f_value):
    """
    Draw a minimal horizontal bar chart.
    bars: [{"label": "Materials", "value": 62, "color": "cost"},
           {"label": "Labor", "value": 28, "color": "blue"}, ...]
    All text is Kosugi (f_label for labels, f_value for display values).
    Bar fills use lower opacity (blended with BG) for subtlety.
    Returns height consumed.
    """
    bar_h = 32
    gap = 24
    bar_opacity = 0.35  # subtle fill, not loud
    cur_y = y

    # Labels above bars (not beside — avoids cramped horizontal layout)
    for b in bars:
        label = b.get("label", "")
        val = b.get("value", 0)
        color = COLOR_MAP.get(b.get("color", ""), GRAY)
        bar_fill = blend_with_bg(color, bar_opacity)
        pct = val / (max(bb.get("value", 0) for bb in bars) or 100)
        val_str = str(b.get("display", val))

        # Label + value on same line above the bar
        draw.text((x, cur_y), label.upper(), fill=GRAY, font=f_label)
        lbl_w = f_label.getbbox(label.upper())[2] - f_label.getbbox(label.upper())[0]
        draw.text((x + lbl_w + 16, cur_y), val_str, fill=color, font=f_label)
        cur_y += 26

        # Bar — low opacity fill + 1px border at full color
        bar_w = int((w - 40) * pct)
        bar_w = max(bar_w, 20)  # minimum visible bar
        draw.rounded_rectangle(
            [(x, cur_y), (x + bar_w, cur_y + bar_h)],
            radius=3, fill=bar_fill, outline=color, width=1
        )
        cur_y += bar_h + gap

    return cur_y - y


def _draw_equation(draw, equation: str, x: int, y: int, f_large, f_label):
    """
    Draw a simple equation/formula display.
    E.g. "Revenue - Costs = Profit"
    Returns height consumed.
    """
    parts = _parse_colored_text(equation)
    _draw_colored_line(draw, parts, f_large, x, y, WHITE)
    bb = f_large.getbbox(equation.replace('{', '').replace('}', ''))
    return (bb[3] - bb[1]) + 20


def _draw_comparison(draw, left_label: str, left_val: str, right_label: str,
                     right_val: str, left_color: str, right_color: str,
                     x: int, y: int, w: int, f_val, f_label):
    """
    Draw a side-by-side comparison block. All text Kosugi.
    Returns height consumed.
    """
    lc = COLOR_MAP.get(left_color, GRAY)
    rc = COLOR_MAP.get(right_color, GRAY)
    half_w = (w - 40) // 2

    # Left label above value
    draw.text((x, y), left_label.upper(), fill=GRAY, font=f_label)
    draw.text((x, y + 28), left_val, fill=lc, font=f_val)

    # Divider — use GRAY for visibility
    mid_x = x + half_w + 20
    draw.line([(mid_x, y), (mid_x, y + 66)], fill=MUTED, width=1)

    # Right label above value
    draw.text((mid_x + 24, y), right_label.upper(), fill=GRAY, font=f_label)
    draw.text((mid_x + 24, y + 28), right_val, fill=rc, font=f_val)

    return 80


def _draw_flowchart(draw, steps: list[dict], x: int, y: int, w: int,
                    f_label, f_step):
    """
    Vertical flowchart — thin-bordered boxes connected by downward lines.
    steps: [{"text": "SYSTEMIZE", "color": "green"}, ...]
    Returns height consumed.

    Layout per step:
    ┌─────────────────────────┐
    │  STEP TEXT               │   ← Mohave Bold, color or WHITE
    └─────────────────────────┘
              │                    ← thin connector line
              ▼
    """
    box_h = 52
    box_w = min(w, 580)  # deliberate, not stretched
    connector_h = 40  # generous breathing room between steps
    pad_x = 24
    cur_y = y

    for i, step in enumerate(steps):
        text = step.get("text", "")
        color_name = step.get("color", "")
        text_color = COLOR_MAP.get(color_name, WHITE)
        border_color = COLOR_MAP.get(color_name, BORDER_RGB)

        # Box — thin 1px border, subtle tinted fill
        box_fill = blend_with_bg(text_color, 0.06) if color_name else None
        draw.rounded_rectangle(
            [(x, cur_y), (x + box_w, cur_y + box_h)],
            radius=4, outline=border_color, width=1, fill=box_fill
        )

        # Step text — Kosugi, left-aligned inside box
        draw.text((x + pad_x, cur_y + 16), text.upper(), fill=text_color, font=f_step)

        cur_y += box_h

        # Connector line + arrow (skip after last step)
        if i < len(steps) - 1:
            line_x = x + 40  # left-biased, not centered
            line_top = cur_y + 6
            line_bot = cur_y + connector_h - 6

            # GRAY for visible connectors
            draw.line([(line_x, line_top), (line_x, line_bot)],
                      fill=GRAY, width=1)

            # Downward chevron — slightly larger for visibility
            arrow_y = line_bot
            draw.line([(line_x - 6, arrow_y - 7), (line_x, arrow_y)],
                      fill=GRAY, width=1)
            draw.line([(line_x + 6, arrow_y - 7), (line_x, arrow_y)],
                      fill=GRAY, width=1)

            cur_y += connector_h

    return cur_y - y


def content_slide(header: str, lines: list[str], path: str,
                  slide_i: int = 1, total: int = 5,
                  visual: dict = None):
    """
    Content slide — vertically centered.

    Lines support color markup: {green:+32%}, {red:-15%}, {amber:$4,200}
    Colors map to OPS semantic palette (system.md).

    Optional visual dict:
      {"type": "bars", "data": [{"label": "...", "value": 62, "color": "cost"}, ...]}
      {"type": "equation", "text": "{revenue:Revenue} - {cost:Costs} = {profit:Profit}"}
      {"type": "comparison", "left_label": "...", "left_val": "...", "left_color": "red",
       "right_label": "...", "right_val": "...", "right_color": "green"}
    """
    img = gradient_bg(W, H)
    draw = ImageDraw.Draw(img)
    M = 80
    cw = W - M * 2

    f_label  = font("Kosugi-Regular.ttf", 14)
    f_header = font("Mohave-Bold.ttf", 52)
    f_body   = font("Mohave-Regular.ttf", 34)
    f_footer = font("Kosugi-Regular.ttf", 13)
    # Visual elements — Kosugi is the primary font inside graphics
    f_vis_val = font("Kosugi-Regular.ttf", 28)   # values in comparisons, equations
    f_vis_lbl = font("Kosugi-Regular.ttf", 16)   # labels in bar charts, comparisons
    f_vis_step = font("Kosugi-Regular.ttf", 20)  # flowchart step text

    # ── Chrome zone: top 90px
    chrome_y = 40
    tracked(draw, "OPS JOURNAL", f_label, M, chrome_y, MUTED, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_label.getbbox(ind)[2] - f_label.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=MUTED, font=f_label)

    # ── Footer zone: bottom 80px
    footer_y = H - 60
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO / JOURNAL", f_footer, M, footer_y, MUTED, 3)

    # ── Calculate content block height for vertical centering
    usable_top = 90
    usable_bottom = footer_y - 30
    usable_h = usable_bottom - usable_top

    # Header height
    h_lines = wrap(header.upper(), f_header, cw)
    h_lh = 62
    header_h = len(h_lines) * h_lh + 16 + 6  # + rule + gap

    # Body height
    body_lh = 60
    body_gap = 8
    body_h = 0
    for line in lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw - 36)
        body_h += len(wrapped) * body_lh + body_gap

    # Visual height
    vis_h = 0
    vis_gap = 40
    if visual:
        vtype = visual.get("type", "")
        if vtype == "bars":
            bar_count = len(visual.get("data", []))
            vis_h = bar_count * (26 + 32 + 24) + vis_gap  # label + bar + gap per row
        elif vtype == "equation":
            vis_h = 80 + vis_gap
        elif vtype == "comparison":
            vis_h = 80 + vis_gap
        elif vtype == "flow":
            step_count = len(visual.get("steps", []))
            vis_h = step_count * 52 + (step_count - 1) * 40 + vis_gap
        elif vtype == "image":
            _img_path = visual.get("path", "")
            if _img_path and os.path.exists(_img_path):
                _tmp = Image.open(_img_path)
                scale = min(cw / _tmp.width, 400 / _tmp.height)
                vis_h = int(_tmp.height * scale) + vis_gap
                _tmp.close()

    total_content_h = header_h + 36 + body_h + vis_h
    start_y = usable_top + (usable_h - total_content_h) // 2
    start_y = max(usable_top, start_y)  # clamp

    # ── Draw header
    cur_y = start_y
    for i, ln in enumerate(h_lines):
        draw.text((M, cur_y + i * h_lh), ln, fill=WHITE, font=f_header)
    cur_y += len(h_lines) * h_lh + 16

    # Short rule
    rule(draw, M, cur_y, 100)
    cur_y += 36

    # ── Draw body lines with color markup
    for line in lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw - 36)

        for j, wl in enumerate(wrapped):
            if j == 0:
                draw.text((M, cur_y), "—", fill=GRAY, font=f_body)
                # Draw with colors
                if len(parsed) > 1 or parsed[0][1] is not None:
                    _draw_colored_line(draw, parsed, f_body, M + 36, cur_y, WHITE)
                else:
                    draw.text((M + 36, cur_y), wl, fill=WHITE, font=f_body)
            else:
                draw.text((M + 36, cur_y), wl, fill=WHITE, font=f_body)
            cur_y += body_lh
        cur_y += body_gap

    # ── Draw visual element
    if visual:
        cur_y += 16
        vtype = visual.get("type", "")
        if vtype == "bars":
            _draw_bar_chart(draw, visual.get("data", []),
                           M, cur_y, cw, f_vis_lbl, f_vis_val)
        elif vtype == "equation":
            _draw_equation(draw, visual.get("text", ""), M, cur_y,
                          f_vis_val, f_vis_lbl)
        elif vtype == "comparison":
            _draw_comparison(draw,
                           visual.get("left_label", ""),
                           visual.get("left_val", ""),
                           visual.get("right_label", ""),
                           visual.get("right_val", ""),
                           visual.get("left_color", "red"),
                           visual.get("right_color", "green"),
                           M, cur_y, cw, f_vis_val, f_vis_lbl)
        elif vtype == "flow":
            _draw_flowchart(draw, visual.get("steps", []),
                           M, cur_y, cw, f_vis_lbl, f_vis_step)
        elif vtype == "image":
            img_path = visual.get("path", "")
            if img_path and os.path.exists(img_path):
                custom_img = Image.open(img_path).convert("RGBA")
                scale = min(cw / custom_img.width, 400 / custom_img.height)
                new_w = int(custom_img.width * scale)
                new_h = int(custom_img.height * scale)
                custom_img = custom_img.resize((new_w, new_h), Image.LANCZOS)
                img = img.convert("RGBA")
                img.paste(custom_img, (M, cur_y), custom_img)
                img = img.convert("RGB")
                draw = ImageDraw.Draw(img)

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] {header} → {path}")


def cta_slide(slug: str, path: str, slide_i: int = 4, total: int = 5):
    """
    CTA slide — anchored to bottom like title slide.
    LEFT-aligned. No center. Ever.
    """
    img = gradient_bg(W, H)
    draw = ImageDraw.Draw(img)
    M = 80
    cw = W - M * 2

    f_label  = font("Kosugi-Regular.ttf", 14)
    f_cta    = font("Mohave-Bold.ttf", 64)
    f_url    = font("Mohave-Regular.ttf", 26)
    f_small  = font("Kosugi-Regular.ttf", 13)
    f_footer = font("Kosugi-Regular.ttf", 13)

    # Top chrome
    chrome_y = 56
    tracked(draw, "OPS JOURNAL", f_label, M, chrome_y, MUTED, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_label.getbbox(ind)[2] - f_label.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=MUTED, font=f_label)

    # Footer
    footer_y = H - 60
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO / JOURNAL", f_footer, M, footer_y, MUTED, 3)

    # CTA block — vertically centered in canvas
    block_center_y = H // 2 - 40

    # [ READ MORE ] label
    tracked(draw, "[ READ MORE ]", f_small, M, block_center_y - 60, MUTED, 3)

    # Rule
    rule(draw, M, block_center_y - 30, 80)

    # CTA text
    draw.text((M, block_center_y), "READ THE", fill=WHITE, font=f_cta)
    draw.text((M, block_center_y + 74), "FULL ARTICLE.", fill=WHITE, font=f_cta)

    # URL
    url = f"opsapp.co/journal/{slug}"
    draw.text((M, block_center_y + 180), url, fill=GRAY, font=f_url)

    # Link in bio
    tracked(draw, "LINK IN BIO", f_small, M, block_center_y + 220, MUTED, 3)

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] CTA → {path}")


def generate_carousel(post_num: int, title: str, subtitle: str,
                      slides_data: list[dict], slug: str, out_dir: str,
                      thumbnail: str = None) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    total = len(slides_data) + 2
    paths = []

    p = os.path.join(out_dir, "slide_01_title.png")
    title_slide(post_num, title, subtitle, p, thumbnail, 0, total)
    paths.append(p)

    for i, s in enumerate(slides_data):
        p = os.path.join(out_dir, f"slide_{i+2:02d}_content.png")
        content_slide(s["header"], s["lines"], p, i + 1, total,
                      visual=s.get("visual"))
        paths.append(p)

    p = os.path.join(out_dir, f"slide_{total:02d}_cta.png")
    cta_slide(slug, p, total - 1, total)
    paths.append(p)

    print(f"\nCarousel: {len(paths)} slides → {out_dir}")
    return paths


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--post-number", type=int, required=True)
    parser.add_argument("--title", type=str, required=True)
    parser.add_argument("--subtitle", type=str, required=True)
    parser.add_argument("--slug", type=str, required=True)
    parser.add_argument("--thumbnail", type=str, default=None)
    parser.add_argument("--slides", nargs="+", required=True,
                        help="'HEADER|line1|line2|...'")
    parser.add_argument("--output-dir", type=str, default="./carousel_output/")
    args = parser.parse_args()

    slides = [{"header": s.split("|")[0], "lines": s.split("|")[1:]}
              for s in args.slides]

    generate_carousel(args.post_number, args.title, args.subtitle,
                      slides, args.slug, args.output_dir, args.thumbnail)
