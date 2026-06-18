# Design-Conformance Audit — Books surface + P2 shell

**Date:** 2026-06-11 · **Trigger:** Jackson judged recent wave output "sloppy… a cheap replica" of the design system
**Method:** 7 parallel dimension auditors (color/accent, typography, surfaces/depth, spacing/layout, voice/copy/i18n, motion, composition-vs-kit) against `ops-design-system/project/DESIGN.md` + `ui_kits/ops-web/`; every high-severity finding independently re-verified against the code on disk.
**Result:** 76 findings — **20 high (all 20 confirmed)**, 42 med, 14 low.
**Full findings with verbatim evidence + exact fixes:** `2026-06-11-design-conformance-audit-full.json` (same directory). The remediation wave works from that file.

## Verdict in one paragraph

**Books is largely authentic OPS** — earth tones, financial ramps, glass tiers, `// TITLE` grammar, mono tabular numbers, and the instrument strip genuinely compose like the kit. **The P2 shell is where the replica reading comes from**: it speaks a private dialect of almost-tokens — accent parked permanently on edge-rail chrome (the single most banned placement), an invented third glass recipe (`rgba(10,10,10,0.25)` blur-12) stamped on every top-bar control, the sidebar on the wrong glass tier, 22 type sites below the 11px floor, Cake Mono at improvised 10/12/13px, Mohave moonlighting as tracked-uppercase display, 0.04–0.06 hairlines instead of `--line`, fractional radii, and feel-based durations (120/160/260ms). Everything rendered at ~90% of spec scale and ~60% of spec contrast — a careful fan re-creation rather than the instrument itself.

## Two systemic defects (poison everything; fix once, fix globally)

1. **Slashed zero is enabled nowhere.** DESIGN.md's non-negotiable `font-feature-settings: "tnum" 1, "zero" 1` is absent from the product CSS — every number on every surface renders the wrong zero. One global CSS fix.
2. ~~The 28px control tier is unsanctioned drift~~ — **RULED (Jackson, 2026-06-11): "36px is NOT the spec. That seems like mobile touch targets. THERE ARE NO TOUCH TARGETS ON WEB."** The 28px workbar tier (table-v2 lineage, copied by Books and Catalog) is **sanctioned** for web. Every "undersized control" finding in this audit is **void**. DESIGN.md §9's 36px button row describes the standard button, not a web floor, and §15's 44px touch-target row is iOS-only. Remediation must amend DESIGN.md to document the compact workbar tier explicitly so future audits stop flagging density as a defect. (Slashed-zero defect #1 stands.)

## High-severity classes (20 confirmed — file:line + fixes in the JSON)

- Accent on navigation/rail chrome (edge tabs `accent="accent"`, 4 sites) — most-banned placement
- Invented glass recipes (top-bar blur-12 chip glass ×4; sidebar on `glass-dense` instead of `glass-surface`)
- Type below the 11px absolute floor (22 sites, shell-concentrated: 9–10px mono dust)
- Cake Mono off-scale (10/12/13px; spec roles are 14 button / 11 badge / 15–32 display)
- Mohave as tracked-uppercase display (breadcrumbs, nested page titles — Cake Mono's job)
- Per-row icon-button toolbars in Books tables (up to 5 bare glyphs/row — "icons are metadata, not actions")
- Brick rendered as text; text-mute doing informational work (17 sites)
- Coach-mark empty states ported verbatim ("Create your first invoice to get started"), Title Case, first-person "we'll"
- es dictionaries for the shell are EN mirrors with a literal `"__": "TODO"` marker; `Intl.NumberFormat("en-US")` hardcoded ×3
- Modal/tooltip keyframes never converted to the OPS curve; top bar missing `prefers-reduced-motion` entirely

## Disposition

- Remediation is its own wave: **`WEB OVERHAUL - P3-3`** (shell + Books conformance pass, this punch list to zero).
- Root cause + prevention: sessions read the design system but never invoked the enforcement skills; reading ≠ enforcement. Master plan §6 now mandates registered-skill invocation, kit-traceable composition, and an `audit-design-system` done-gate per wave (commit `c0e5af8c`).
- The Catalog wave (P3-2, in flight) must not copy the 28px tier or the shell's private dialect — flagged to that session.
