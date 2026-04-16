"""
OPS Feature Release — Instagram Carousel Generator
1080x1350 (4:5 portrait) carousel for new feature announcements.

Visually distinct from blog carousel:
- No image. Pure typography + structure.
- Feature name is the hero — oversized.
- Accent-colored short rule for product announcement feel.
- Version badge prominent.
- Spec-sheet energy, not editorial.

Chrome: [ OPS UPDATE ]
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from carousel_generator import (
    W, H, BG, SURFACE_2, WHITE, GRAY, MUTED, BORDER_RGB, ACCENT,
    COLOR_MAP, blend_with_bg,
    gradient_bg, noise_layer, rule, tracked, tracked_width,
    wrap, finalize, font,
    _parse_colored_text, _draw_colored_line,
    _draw_bar_chart, _draw_comparison, _draw_equation, _draw_flowchart,
)


# ─── FEATURE TITLE SLIDE ──────────────────────────────────

def title_slide(feature_name: str, tagline: str, path: str,
                version: str = None, category: str = "NEW FEATURE",
                slide_i: int = 0, total: int = 5):
    """
    Feature release title — no image, pure typography.

    ┌─────────────────────────┐
    │ [ OPS UPDATE ]  [1/tot] │  ← chrome
    │                         │
    │                         │
    │ [ NEW FEATURE ]         │  ← Kosugi category label
    │ ▬▬▬▬▬                   │  ← short accent rule
    │                         │
    │ SMART                   │  ← Mohave Bold, oversized hero
    │ SCHEDULING              │
    │                         │
    │ V2.4                    │  ← Kosugi version badge
    │                         │
    │ tagline text here       │  ← Mohave Regular, secondary
    │                         │
    │ ─── rule ────────────── │
    │ OPSAPP.CO               │
    └─────────────────────────┘
    """
    M = 80
    cw = W - M * 2

    f_label    = font("Kosugi-Regular.ttf", 14)
    f_category = font("Kosugi-Regular.ttf", 14)
    f_feature  = font("Mohave-Bold.ttf", 96)
    f_version  = font("Kosugi-Regular.ttf", 16)
    f_tagline  = font("Mohave-Regular.ttf", 30)
    f_footer   = font("Kosugi-Regular.ttf", 13)

    # ── Pre-calculate layout for vertical centering
    footer_y = H - 60

    # Feature name lines
    feature_lines = wrap(feature_name.upper(), f_feature, cw)
    feature_lh = 108
    feature_h = len(feature_lines) * feature_lh

    # Tagline lines
    tag_lines = wrap(tagline, f_tagline, cw)
    tag_lh = 42
    tag_h = len(tag_lines) * tag_lh

    # Total content block:
    # category(20) + gap(16) + accent_rule(20) + gap(28) +
    # feature_name + gap(20) + version(24) + gap(32) + tagline
    ver_h = 24 if version else 0
    ver_gap = 20 if version else 0
    content_h = (20 + 16 + 20 + 28 + feature_h + ver_gap + ver_h +
                 32 + tag_h)

    usable_top = 90
    usable_bottom = footer_y - 40
    usable_h = usable_bottom - usable_top
    start_y = usable_top + (usable_h - content_h) // 2
    start_y = max(usable_top, start_y)

    # ── Build
    img = gradient_bg(W, H)
    draw = ImageDraw.Draw(img)

    # ── Chrome
    chrome_y = 40
    tracked(draw, "[ OPS UPDATE ]", f_label, M, chrome_y, GRAY, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_label.getbbox(ind)[2] - f_label.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=GRAY, font=f_label)

    # ── Category label
    cur_y = start_y
    tracked(draw, f"[ {category} ]", f_category, M, cur_y, MUTED, 3)
    cur_y += 20 + 16

    # ── Accent-colored short rule — product announcement marker
    draw.line([(M, cur_y), (M + 60, cur_y)], fill=ACCENT, width=2)
    cur_y += 20 + 28

    # ── Feature name — oversized hero
    for ln in feature_lines:
        draw.text((M, cur_y), ln, fill=WHITE, font=f_feature)
        cur_y += feature_lh

    # ── Version badge
    if version:
        cur_y += ver_gap
        tracked(draw, version.upper(), f_version, M, cur_y, MUTED, 3)
        cur_y += ver_h

    # ── Tagline
    cur_y += 32
    for ln in tag_lines:
        draw.text((M, cur_y), ln, fill=GRAY, font=f_tagline)
        cur_y += tag_lh

    # ── Footer
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO", f_footer, M, footer_y, MUTED, 3)

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] Feature Title → {path}")


# ─── FEATURE CONTENT SLIDE ─────────────────────────────────

def content_slide(header: str, lines: list[str], path: str,
                  slide_i: int = 1, total: int = 5,
                  visual: dict = None):
    """
    Feature detail slide — vertically centered content.
    [ OPS UPDATE ] chrome. Same visual element support as blog.
    """
    img = gradient_bg(W, H)
    draw = ImageDraw.Draw(img)
    M = 80
    cw = W - M * 2

    f_label    = font("Kosugi-Regular.ttf", 14)
    f_header   = font("Mohave-Bold.ttf", 52)
    f_body     = font("Mohave-Regular.ttf", 34)
    f_footer   = font("Kosugi-Regular.ttf", 13)
    f_vis_val  = font("Kosugi-Regular.ttf", 28)
    f_vis_lbl  = font("Kosugi-Regular.ttf", 16)
    f_vis_step = font("Kosugi-Regular.ttf", 20)

    # ── Chrome
    chrome_y = 40
    tracked(draw, "[ OPS UPDATE ]", f_label, M, chrome_y, MUTED, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_label.getbbox(ind)[2] - f_label.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=MUTED, font=f_label)

    # ── Footer
    footer_y = H - 60
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO", f_footer, M, footer_y, MUTED, 3)

    # ── Calculate content height for centering
    usable_top = 90
    usable_bottom = footer_y - 30
    usable_h = usable_bottom - usable_top

    h_lines = wrap(header.upper(), f_header, cw)
    h_lh = 62
    header_h = len(h_lines) * h_lh + 16 + 6  # + accent rule + gap

    body_lh = 60
    body_gap = 8
    body_h = 0
    for line in lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw - 36)
        body_h += len(wrapped) * body_lh + body_gap

    vis_h = 0
    vis_gap = 40
    if visual:
        vtype = visual.get("type", "")
        if vtype == "bars":
            bar_count = len(visual.get("data", []))
            vis_h = bar_count * (26 + 32 + 24) + vis_gap
        elif vtype == "equation":
            vis_h = 80 + vis_gap
        elif vtype == "comparison":
            vis_h = 80 + vis_gap
        elif vtype == "flow":
            step_count = len(visual.get("steps", []))
            vis_h = step_count * 52 + (step_count - 1) * 40 + vis_gap

    total_content_h = header_h + 36 + body_h + vis_h
    start_y = usable_top + (usable_h - total_content_h) // 2
    start_y = max(usable_top, start_y)

    # ── Header
    cur_y = start_y
    for i, ln in enumerate(h_lines):
        draw.text((M, cur_y + i * h_lh), ln, fill=WHITE, font=f_header)
    cur_y += len(h_lines) * h_lh + 16

    # ── Accent short rule (instead of white — distinguishes from blog)
    draw.line([(M, cur_y), (M + 60, cur_y)], fill=ACCENT, width=2)
    cur_y += 36

    # ── Body with color markup
    for line in lines:
        parsed = _parse_colored_text(line)
        raw = "".join(t for t, _ in parsed)
        wrapped = wrap(raw, f_body, cw - 36)
        for j, wl in enumerate(wrapped):
            if j == 0:
                draw.text((M, cur_y), "—", fill=GRAY, font=f_body)
                if len(parsed) > 1 or parsed[0][1] is not None:
                    _draw_colored_line(draw, parsed, f_body, M + 36, cur_y, WHITE)
                else:
                    draw.text((M + 36, cur_y), wl, fill=WHITE, font=f_body)
            else:
                draw.text((M + 36, cur_y), wl, fill=WHITE, font=f_body)
            cur_y += body_lh
        cur_y += body_gap

    # ── Visual element
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

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] {header} → {path}")


# ─── FEATURE CTA SLIDE ────────────────────────────────────

def cta_slide(feature_name: str, path: str, slug: str = None,
              slide_i: int = 4, total: int = 5):
    """
    Feature CTA — references the actual feature name.
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

    # Chrome
    chrome_y = 56
    tracked(draw, "[ OPS UPDATE ]", f_label, M, chrome_y, MUTED, 3)
    ind = f"{slide_i + 1}/{total}"
    ind_w = f_label.getbbox(ind)[2] - f_label.getbbox(ind)[0]
    draw.text((W - M - ind_w, chrome_y), ind, fill=MUTED, font=f_label)

    # Footer
    footer_y = H - 60
    rule(draw, M, footer_y - 14, cw)
    tracked(draw, "OPSAPP.CO", f_footer, M, footer_y, MUTED, 3)

    # CTA block — vertically centered
    block_center_y = H // 2 - 40

    tracked(draw, "[ NOW AVAILABLE ]", f_small, M, block_center_y - 60, MUTED, 3)

    # Accent rule
    draw.line([(M, block_center_y - 30), (M + 60, block_center_y - 30)],
              fill=ACCENT, width=2)

    # CTA with actual feature name
    cta_lines = wrap(f"TRY {feature_name.upper()}.", f_cta, cw)
    cta_lh = 74
    for i, ln in enumerate(cta_lines):
        draw.text((M, block_center_y + i * cta_lh), ln, fill=WHITE, font=f_cta)

    cta_bottom = block_center_y + len(cta_lines) * cta_lh + 30

    url = f"opsapp.co{f'/{slug}' if slug else ''}"
    draw.text((M, cta_bottom), url, fill=GRAY, font=f_url)
    tracked(draw, "LINK IN BIO", f_small, M, cta_bottom + 40, MUTED, 3)

    finalize(img, path)
    print(f"  [{slide_i+1}/{total}] CTA → {path}")


# ─── ORCHESTRATOR ──────────────────────────────────────────

def generate_feature_carousel(feature_name: str, tagline: str,
                               slides_data: list[dict], out_dir: str,
                               version: str = None, category: str = "NEW FEATURE",
                               slug: str = None) -> list[str]:
    """Generate a complete feature release carousel."""
    os.makedirs(out_dir, exist_ok=True)
    total = len(slides_data) + 2
    paths = []

    p = os.path.join(out_dir, "slide_01_title.png")
    title_slide(feature_name, tagline, p, version, category, 0, total)
    paths.append(p)

    for i, s in enumerate(slides_data):
        p = os.path.join(out_dir, f"slide_{i+2:02d}_content.png")
        content_slide(s["header"], s["lines"], p, i + 1, total,
                      visual=s.get("visual"))
        paths.append(p)

    p = os.path.join(out_dir, f"slide_{total:02d}_cta.png")
    cta_slide(feature_name, p, slug, total - 1, total)
    paths.append(p)

    print(f"\nFeature Carousel: {len(paths)} slides → {out_dir}")
    return paths


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--feature-name", type=str, required=True)
    parser.add_argument("--tagline", type=str, required=True)
    parser.add_argument("--version", type=str, default=None)
    parser.add_argument("--category", type=str, default="NEW FEATURE")
    parser.add_argument("--slug", type=str, default=None)
    parser.add_argument("--slides", nargs="+", required=True,
                        help="'HEADER|line1|line2|...'")
    parser.add_argument("--output-dir", type=str, default="./feature_output/")
    args = parser.parse_args()

    slides = [{"header": s.split("|")[0], "lines": s.split("|")[1:]}
              for s in args.slides]

    generate_feature_carousel(args.feature_name, args.tagline,
                               slides, args.output_dir,
                               args.version, args.category, args.slug)
