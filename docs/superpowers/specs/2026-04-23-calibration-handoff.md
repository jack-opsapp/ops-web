# CALIBRATION — Handoff Prompt for a Dedicated Session

> **Purpose:** This doc is a paste-ready prompt for a separate Claude Code session to design and ship CALIBRATION — a new top-level destination in OPS-Web that consolidates all Phase C + AI backend knowledge in one place.
>
> **Why a separate session:** This is a feature project, not a bug fix. Scope comparable to the notification rail redesign (Group A). The prompt below is self-contained — assumes zero context from the session that wrote it.

---

## Paste into new Claude Code terminal

```
I need to design and build a new top-level destination in OPS-Web called
CALIBRATION. It consolidates everything AI- and Phase-C-related under one
roof: inputs (interview, email scan, DB mining), extracted knowledge/corpus,
and all associated configuration (email filters, agent/wizard configs,
duplicate detection, classification rules, task type learning, feature
flags). Currently these are scattered across /settings/integrations and
other routes.

The current /settings/integrations/ai-setup page has just received two
surgical polish fixes (full-height layout + skip-trap nav fix) — see
OPS-Web/docs/superpowers/plans/2026-04-23-ai-setup-admin-panel.md. Those
fixes are NOT CALIBRATION; they're the stopgap until CALIBRATION lands.

## Your job (four phases)

### Phase 1 — Inventory audit

Before any design, inventory every existing AI / Phase-C touchpoint:

1. Grep the OPS-Web codebase for:
   - `phase_c` feature flag usage
   - AI-related components: `ai-intake-interview.tsx`, `ai-database-mining.tsx`,
     `ai-setup-dashboard.tsx`, `comms-config-wizard/*`, `ai-setup-*`
   - Email filter / triage: `filter-funnel-canvas.tsx`, `email-filter-*`
   - Duplicate detection: anything under `duplicate-*`
   - Auto-classification: mention-textarea, category-chip, inbox triage
   - Any other route or component behind the `phase_c` flag

2. For each touchpoint, record:
   - File path
   - Route (if it has a UI surface)
   - What it does (one sentence)
   - Whether it generates training data, stores extracted knowledge, or
     configures AI behavior

3. Output the audit at:
   OPS-Web/docs/superpowers/specs/2026-04-23-calibration-inventory.md

### Phase 2 — Brainstorm

Use the `superpowers:brainstorming` skill. Key questions to resolve with
Jackson (canprojack@gmail.com):

- **IA model**: command-deck dashboard (status tiles + drill-in), sidebar-
  in-sidebar (sub-nav), horizontal tab bar, split-view (source tree + active
  area), or something else?
- **Primary view**: when you open /calibration, do you land on an overview
  dashboard, the interview, or the extracted knowledge?
- **Re-run semantics**: can each input source be re-run independently?
  Does re-running one invalidate extracted knowledge from the others?
- **Live vs one-time**: is calibration ongoing (constantly learning) or
  one-time setup + occasional re-runs?
- **Permissions**: who can access /calibration? Company admins only? A new
  `calibration.manage` permission?
- **Trades context**: field crews (gloves, sun, truck) — is calibration
  touchable from mobile, or desk-only?
- **Copy**: section names, empty states, status labels — all through
  ops-copywriter skill

### Phase 3 — Spec

Write a spec at:
OPS-Web/docs/superpowers/specs/2026-04-23-calibration-design.md

Covering:
- Visual design (every screen, every state)
- Interaction states (hover, active, loading, error, empty, success)
- Information architecture
- Animation / motion (via animation-studio:animation-architect)
- Responsive behavior
- Accessibility
- Copy (v2 voice rules — see below)
- Permissions
- Migration (how existing pages/routes redirect, how data moves, how
  feature flags handle the transition)

### Phase 4 — Plan

Write an implementation plan at:
OPS-Web/docs/superpowers/plans/2026-04-23-calibration-implementation.md

Per the OPS planning standard (see /Users/jacksonsweet/.claude/CLAUDE.md
and /Users/jacksonsweet/Projects/OPS/CLAUDE.md):
- Verified file list
- Copy-paste-ready code
- 2-5 min granular tasks
- Commit after each
- Permission gating specified
- Browser verification at the end

## Context you need

**Design system (canonical):**
/Users/jacksonsweet/Projects/OPS/ops-design-system-v2/
- README.md — voice rules, visual foundations, motion
- project/colors_and_type.css — canonical CSS tokens
- project/SKILL.md — portable skill definition

**Internal spec v2:**
OPS-Web/.interface-design/system.md

**Project CLAUDE.md:**
OPS-Web/CLAUDE.md — spec v2 consolidation, z-index scale, FAB rules, fonts

**Voice rules (non-negotiable):**
- Never "Welcome back!", never emoji, never "Oops"
- `// OPERATOR :: NAME`, `SYS:: <event> · HH:MM`, `3 UNREAD`
- Sentence case for content; UPPERCASE for authority
- Numbers always JetBrains Mono tabular-lining with slashed zero
- CALIBRATION is the name — military tactical minimalist, xAI/SpaceX vibe

**Visual rules (non-negotiable):**
- Pure #000 canvas, glass-surface / glass-dense only
- Sharp corners: 10/12/5/4 radii, no 999px pills except avatars
- Zero box-shadows on dark
- Motion: cubic-bezier(0.22, 1, 0.36, 1), 150/200/250ms
- prefers-reduced-motion fallback to 150ms opacity

**Schema context:**
- Supabase project: ijeekuhbatykdomumfjx (OPS prod)
- Phase C feature flag gates access
- bug_reports table — filter for `screen_name ILIKE '%ai-setup%'` or
  `category = 'feature_request'` with phase_c context to find existing bug
  reports touching this area

**Existing plans/specs to read:**
- OPS-Web/docs/superpowers/plans/2026-04-21-full-height-pages.md
- OPS-Web/docs/superpowers/plans/2026-04-23-ai-setup-admin-panel.md
- OPS-Web/docs/superpowers/plans/2026-03-09-notification-rail-design.md
- OPS-Web/docs/superpowers/specs/ (recent specs for design pattern examples)

**Skills to load upfront:**
- superpowers:brainstorming (Phase 2)
- superpowers:writing-plans (Phase 4)
- interface-design + .interface-design/system.md
- frontend-design
- animation-studio:animation-architect (required — motion gateway)
- animation-studio:web-animations (after architect)
- ops-copywriter (for all copy)
- mobile-ux-design (user often on tablet in truck)
- business-rules-consultant (for permissions + access model)
- codebase-consultant (for Phase 1 inventory — multiple subsystems)

**Naming locked:**
- Top-level destination name: CALIBRATION
- Three known sub-sources: INTERVIEW, EMAIL SCAN, DATA MINING
- Route: /calibration (with /settings/integrations/ai-setup redirecting)
- Sidebar icon: open — Brain (current) or alternatives (Sparkles, Cpu,
  Activity, Radar) — raise in brainstorm

**Precision rules:**
- Never guess data types, column names, API behavior — use Supabase MCP
- Perfection is integral — no "good enough", no TODOs, no deferred work
- Ask Jackson clarifying questions before committing to design choices

**File collision warning:**
src/components/layouts/dashboard-layout.tsx is high-traffic. It mounts:
- NotificationRail (Group A — separate session may be active)
- BugReportButton (Group E1 — on hold)
- FAB (Group E1 — on hold)
- Setup gate logic
CALIBRATION needs a sidebar nav entry in this file. Coordinate.

**User profile (Jackson Sweet):**
- Runs CanPro Deck and Rail (trades contractor)
- Designs features from firsthand contractor experience
- Extremely fast dev pace (8-9 parallel Claude terminals)
- Wants perfection; complexity is acceptable if it's the right answer
- Prefers terse, point-form communication
- Asks clarifying questions rather than letting agents guess

Start with Phase 1 (inventory). No design or code until the audit is
complete and Jackson has reviewed it.
```

---

## Notes for the main session

After the CALIBRATION session completes Phase 1 inventory, we'll have a full map of what the current page should eventually absorb. Phases 2–4 happen in that session with Jackson as design/product partner.

Once CALIBRATION lands, the stopgap fixes in `2026-04-23-ai-setup-admin-panel.md` become dead code — delete the page, delete its layout entry, redirect the route.
