# Guided Catalog Choice Disclosure Implementation Plan

> **For Codex:** Use `custom-skills:executing-plans` and the OPS UI skill stack.

**Goal:** Keep long Phase C choices readable without allowing them to enlarge or
overlap the floating composer.

**Architecture:** Lift quick-answer selection state to the interview, render the
current choices within the matching assistant transcript turn, and leave the
existing answer/upload form in a compact floating composer. Preserve the
transcript as the sole scroll owner.

**Tech stack:** React, TypeScript, Tailwind tokens, Framer Motion, Lucide,
Vitest, Playwright.

### Task 1 — Lock the regression

- Add a long-choice component test for transcript ownership, type treatment,
  disclosure semantics, and composer separation.
- Add a 915×685 browser test for real bounding boxes, internal overflow,
  computed typography, send inset, footer alignment, and glass treatment.
- Confirm both fail on the existing implementation.

### Task 2 — Move choices into the conversation

- Extract a quick-answer disclosure component.
- Lift multi-choice selection state so the transcript choices and composer SEND
  share one answer.
- Expand choices naturally with no `max-height` or nested overflow.
- Reset selection and disclosure state on each new Phase C question.
- Scroll only the transcript after a disclosure layout change.

### Task 3 — Correct the floating controls

- Add the SEND right inset without increasing its 32px control height.
- Left-align the footer controls.
- Apply the existing glass background, blur, border, radius, type, hover, focus,
  and disabled tokens to each footer chip.

### Task 4 — Verify

- Run Guided Catalog Setup component tests and the complete catalog suite.
- Run the viewport suite at 915×685, 1280×720, 1440×900, and 390×844.
- Inspect screenshots and measured boxes.
- Run type-check, lint, production build, diff check, and design-token audit.
- Commit the focused change. Do not push or deploy.
