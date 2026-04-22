---
name: OPS Motion Identity
version: 1
created: 2026-04-21
platforms: [web, ios]

aesthetic: Military tactical minimalist — Apple-depth glass × defense-tech (xAI / SpaceX / Anduril / Palantir). Pure black canvas, glass + hairlines, zero box-shadows. Monochrome by default; color is meaning, never decoration.

motion_personality: Crisp, precise, restrained. Things move with conviction and stop with conviction. No spring physics, no bounce — drag-and-drop reorder is the lone exception. Subtle staggered entries for hierarchy. Slow ambient pulses for breath. Draw-on sequences for moments that matter.

speed:
  enter: 200ms          # panel / component enter
  exit: 150ms           # hover, dismiss, exit
  transition: 250ms     # page transitions
  complex: 800ms        # hero count-up; row stagger 300ms + 50ms/item; card flip 350ms; chart bar grow 400-600ms

easing:
  enter: cubic-bezier(0.22, 1, 0.36, 1)   # EASE_SMOOTH — single curve everywhere
  exit:  cubic-bezier(0.22, 1, 0.36, 1)
  spring: { stiffness: 0, damping: 0 }    # NO spring physics; drag-and-drop reorder is the only exception

celebration: Understated — the result speaks. State change is the celebration. Acceptable; subtle pulse on data refresh, draw-on sequence for moments that matter (hero count-up to a record, status transitions on long-tracked deals). Forbidden; confetti, particles, bounce, color flashes, sound.

haptics: Sparingly — primary CTA only, light impact. Never on scroll, never on hover-equivalent (long-press), never decorative. iOS UIImpactFeedbackGenerator(.light) on commit / save. UINotificationFeedbackGenerator(.warning) reserved for destructive confirmation.

colors:
  background: "#000000"                      # pure black canvas
  surface:    rgba(18,18,20,0.58)            # .glass-surface + blur(28px) saturate(1.3) + 1px hairline
  surface_dense: rgba(18,18,20,0.78)         # .glass-dense — modals, popovers, dropdowns, toasts
  accent:     "#6F94B0"                      # steel blue — primary CTA fill + focus rings ONLY
  text:       "#EDEDED"                      # primary; ladder: text-2 #B5B5B5 / text-3 #8A8A8A / text-mute #6A6A6A (decorative)
  success:    "#9DB582"                      # olive
  warning:    "#C4A868"                      # tan
  error:      "#B58289"                      # rose; brick #93321A reserved for destructive borders only
  border:     rgba(255,255,255,0.10)         # standard hairline
  border_glass: rgba(255,255,255,0.09)       # on glass surfaces

typography:
  primary:    Mohave                         # body, names, hero numbers (300 at 76-84px)
  secondary:  JetBrains Mono                 # ALL numbers, timestamps, // prefixes, [brackets], 11px micro labels
  display:    Cake Mono Light                # uppercase voice — page titles, buttons, badges, section headers (300 ONLY; never 400/700 in product UI)
  weights:    [300, 400, 500]
  caps_labels: true                          # UPPERCASE for authority, sentence case for content. Never Title Case Like This.
  tracking:   "0em (Cake Mono natural); 0.16-0.20em on 11px JetBrains Mono category labels"
  numbers:    "always mono; font-feature-settings: 'tnum' 1, 'zero' 1; 11px minimum, no exceptions"

radii:
  small:  4px    # tags / chips
  medium: 5px    # buttons, inputs
  large:  10px   # panels, cards, widgets
  modal:  12px   # modals, popovers, dropdowns, floating windows, toasts
  bar:    2px    # funnel / progress tracks
  hover:  6px    # sidebar item hover background
  avatar: full   # the only fully-rounded element; no 999px pills anywhere else

reduced_motion: required   # every animation checks prefers-reduced-motion (web) or UIAccessibility.isReduceMotionEnabled (iOS); fallback is opacity-only at 150ms

source_of_truth: C:\OPS\.interface-design\system.md   # v2 spec (982 lines, last updated 2026-04-21); supplemented by .interface-design/new-system-extracted/ bundle
---

## Emotional Arc

**Starting state:** Anxious. A trades business owner — roofer, plumber, electrician, landscaper, detailer — checking the dashboard between job sites or in the truck cab. Anxious about what's slipping. Unsure who owes what. Tomorrow is a question mark. Texts and paper compete for attention. The business runs on memory and luck.

**Target state:** Certainty. Quiet confidence. The deck shows the shape of the business and nothing surprises you. Every number formatted (no NaN, no raw timestamps, no `86.5671641`). Every status known. Motion never asks for attention — it confirms what just happened and gets out of the way.

## Brand Direction

Motion serves certainty, not delight. Things move with the conviction of a well-built tool — no overshoot, no settling, no springiness. The single easing curve `cubic-bezier(0.22, 1, 0.36, 1)` is a contract: every transition starts decisively, eases into place, and stops with finality. No hesitation, no rebound.

Animation has three legitimate jobs:

1. **Reveal hierarchy on entry** — staggered rows, 300ms + 50ms/item, so the eye finds the most important value first.
2. **Confirm a state change** — a brief opacity/transform on commit, never longer than 250ms.
3. **Honor a moment that matters** — the hero number count-up (800ms quadratic ease-out), a card flip (350ms perspective rotateY), a draw-on reveal on a record value. Used sparingly. Once a screen at most.

Decorative animation is a design failure. No bouncy buttons. No spring-physics modals. No confetti on save. No color flashes on success. No 2019 SaaS template moves. The result speaks. If a value just changed, it is now the new value — typewriter / draw-on reveal is permitted only when the value carries narrative weight (revenue total ticking up to a record, a long-tracked deal closing). Otherwise: snap.

**Hover and press states.** Hover lightens — `rgba(255,255,255,0.05)` background, text brightens from `text-2` → `text`. Never a color change. Pressed adds `rgba(255,255,255,0.08)` background and `rgba(255,255,255,0.18)` border. No shrink, no shadow collapse. Focus is `1.5px solid #6F94B0` with 2px offset from black — the only place the steel-blue accent appears on a non-CTA element.

**Reduced motion is non-negotiable.** Every animation MUST check `prefers-reduced-motion` (web) or `UIAccessibility.isReduceMotionEnabled` (iOS) and fall back to a 150ms opacity-only transition. Equivalence, not compromise.

**Haptics on iOS are a privilege, not a habit.** Light impact on primary CTA confirmation. Heavier on destructive confirmation. Nothing on scroll, nothing on hover-equivalent (long-press), nothing on ambient updates. The phone is in a tool belt or on a dashboard mount — the operator may not even be looking.

**Scope of "animation"** in this project: everything from a 150ms hover transition up to a 3D card flip. Marketing-site moments (hero scenes, scroll narratives, ambient backgrounds on `try-ops`) follow the same rules — no exception for "the marketing site is more expressive." It is not.

**When in doubt: do less.** The OPS deck is a quiet room. Motion is the door clicking shut behind you.
