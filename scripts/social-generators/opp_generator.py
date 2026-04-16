"""
OPS Performance Protocol (OPP) — Instagram Post Generator
Built from .interface-design/system.md

1080x1080 Instagram square.
Tactical minimalist. Field manual aesthetic.
Monochromatic — black, white, grays. Zero decorative color.
"""

import argparse
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ─── DESIGN TOKENS (from system.md) ────────────────────────
S = 1080  # square

BG        = (10, 10, 10)       # #0A0A0A
WHITE     = (255, 255, 255)    # text-primary
GRAY      = (153, 153, 153)    # text-secondary
MUTED     = (60, 60, 60)       # barely visible
BORDER_RGB = (36, 36, 36)      # 10% white on dark

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


def generate_opp(number: int, title: str, lines: list[str], output_path: str):
    """
    OPP layout — field manual page:
    ┌─────────────────────────┐
    │ OPS PERFORMANCE PROTOCOL│  ← tiny stamp, Kosugi
    │                         │
    │ #011                    │  ← hero number, Mohave Bold 96
    │ SET THE STANDARD        │  ← title, Mohave Light, secondary
    │ ─── rule ────────────── │
    │                         │
    │ Body line 1.            │
    │ Body line 2.            │  ← Mohave Regular, generous rhythm
    │ Body line 3.            │
    │ Body line 4.            │
    │ Body line 5.            │
    │                         │
    │ ─── rule ────────────── │
    │ OPSAPP.CO    OPP / 011  │  ← footer
    └─────────────────────────┘
    """
    img = gradient_bg()
    draw = ImageDraw.Draw(img)
    M = 100  # margin

    cw = S - M * 2

    f_stamp  = font("Kosugi-Regular.ttf", 13)
    f_number = font("Mohave-Bold.ttf", 96)
    f_title  = font("Mohave-Light.ttf", 28)
    f_body   = font("Mohave-Regular.ttf", 32)
    f_footer = font("Kosugi-Regular.ttf", 12)

    # ── Classification stamp — top left, barely there
    tracked(draw, "OPS PERFORMANCE PROTOCOL", f_stamp, M, 70, MUTED, 3)

    # ── Hero number
    num_str = f"#{number:03d}"
    draw.text((M, 150), num_str, fill=WHITE, font=f_number)

    # ── Title — Mohave Light, deliberately understated
    draw.text((M, 264), title.upper(), fill=GRAY, font=f_title)

    # ── Structural rule
    rule(draw, M, 320, cw)

    # ── Body — generous vertical rhythm
    body_y = 376
    body_lh = 58
    for line_text in lines:
        wrapped = wrap(line_text, f_body, cw)
        for wl in wrapped:
            draw.text((M, body_y), wl, fill=WHITE, font=f_body)
            body_y += body_lh
        body_y += 6

    # ── Footer
    footer_y = S - 64
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO", f_footer, M, footer_y, MUTED, 3)
    series = f"OPP / {number:03d}"
    sw = tracked_width(series, f_footer, 3)
    tracked(draw, series, f_footer, S - M - sw, footer_y, MUTED, 3)

    # ── Noise + save
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, noise_layer())
    img.convert("RGB").save(output_path, "PNG", quality=95)
    print(f"Generated: {output_path} ({S}x{S})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--number", type=int, required=True)
    parser.add_argument("--title", type=str, required=True)
    parser.add_argument("--lines", nargs="+", required=True)
    parser.add_argument("--output", type=str, default="opp_output.png")
    args = parser.parse_args()
    generate_opp(args.number, args.title, args.lines, args.output)
