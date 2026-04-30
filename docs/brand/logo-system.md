# OPS Logo System

Authoritative ruleset for OPS brand-mark placement and animation in OPS-Web.
Cross-references the canonical visual spec at
`ops-design-system-v2/project/colors_and_type.css` and the chevron-split
loader animation at `ops-design-system-v2/project/logo-loader.jsx`.

## Variants

There are three lockup variants. Pick the one that matches the context, never
the one that "fits the slot."

| Variant | Component | Aspect | Use for |
|---|---|---|---|
| Mark only | `<OpsMark />` | 1:1 | Tight nav/sidebar/footer slots, version markers, dim brand presence |
| Horizontal lockup | `<OpsLockup orientation="horizontal" />` | ~1.59:1 | Headers, auth screens, setup wizards, marketing footers, any in-flow brand placement |
| Vertical stack | `<OpsLockup orientation="vertical" />` | 1:1 | Full-screen heroes, lockout, PIN, /locked — the only contexts where the wordmark sits centered below the mark with breathing room |

## Animation: `<LogoLoader />`

Loading screens, splash states, and slow page-transition boundaries MUST use
the animated `<LogoLoader />` component (`@/components/brand/logo-loader`).

- Pure SVG + Framer Motion, no canvas, no Three.js
- Chevrons translate ±X only (no Y, no rotation)
- OPS letters revealed via SVG clip-path as the chevrons separate
- Single ease curve `[0.22, 1, 0.36, 1]` — no spring/bounce
- 4.2s default cycle; `loop` prop defaults to `true`
- `prefers-reduced-motion`: collapses to a static centered horizontal lockup
  with a 600ms opacity fade-in (same Entry/Arrival emotional beat, different
  motion). Verified accessible.

```tsx
import { LogoLoader } from "@/components/brand";

export default function Loading() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <LogoLoader size={120} />
    </div>
  );
}
```

DO NOT pair the LogoLoader with a separate `animate-pulse` wrapper — the
chevron-split is the animation; layered pulses muddy the intent.

## Placement ruleset

| Context | Variant | Sizing notes |
|---|---|---|
| App header (sidebar collapsed) | Mark only | 16–24px, monochrome inherit `currentColor` |
| App header (sidebar expanded) | Horizontal | 28–32px tall, left-aligned |
| Sidebar version footer | Mark only | 16px, opacity 0.4 — utilitarian |
| Login / Register / Join / Welcome | Horizontal | 24–28px on mobile header, 32px on auth-hero corner |
| /locked, /pin, lockout overlays | Vertical stack | 80–96px centered |
| Setup wizard splash (in-flow) | Horizontal | 64px (`h-16`) — never vertical |
| Onboarding loading (auth/employee gate) | `<LogoLoader />` | 120–140px |
| Dashboard loading (auth + onboarding gates) | `<LogoLoader />` | 120px |
| Auth layout loading | `<LogoLoader />` | 120px |
| Empty states (no projects/invoices/etc) | Mark only | 48px, opacity 0.4 |
| Footer (marketing + portal) | Horizontal | 24px |
| Email templates | Horizontal | Light-bg-safe asset; 28px |
| Error / 404 boundary footer | Horizontal | 12–14px, opacity 0.4 |

### Hard rules

1. **Never** use a vertical-stack in a non-hero context. The 1:1 aspect
   wastes space and reads as "splash" semantically — only correct when the
   surrounding screen is also a splash.
2. **Never** apply rotation, Y-translation, or spring physics to any logo
   render. The brand has zero tolerance for bouncy motion.
3. **Never** layer two animations (e.g. `animate-pulse` wrapping
   `<LogoLoader />`). One animation per render.
4. **Never** drop below 11px of legible mark in any rendering — see the
   audit's note on the portal verify footer's `h-2.5` placement; bump to
   `h-3.5` minimum.
5. The mark is monochrome and inherits `currentColor`. If you need a
   different colour, set the parent's `color`, not a `fill` prop.

## Migration history

- 2026-04-26 (Round 2 batch PR): Setup splash switched from vertical-stack
  to horizontal per the QA bug `7fdf86b1`. The five loading-state placements
  (auth gate, dashboard gate, auth layout, setup, employee-setup) were
  switched from `animate-pulse(-live)` + `OpsLockup` to `<LogoLoader />`.
  See `docs/brand/logo-audit-2026-04-26.md` for the full audit.
- Pre-2026-04-26: ad-hoc placement; some loading screens used Tailwind
  `animate-pulse`, others used a custom `animate-pulse-live`. Standardised
  to `<LogoLoader />`.
