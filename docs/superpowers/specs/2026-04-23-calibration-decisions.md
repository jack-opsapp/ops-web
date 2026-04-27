# CALIBRATION — Phase 2 Brainstorm Decisions

> **Status:** Phase 2 complete. All decisions confirmed by Jackson 2026-04-23.
> **Feeds:** Phase 3 (spec) at `2026-04-23-calibration-design.md`
> **Inventory source:** `2026-04-23-calibration-inventory.md`

---

## Decisions at a glance

| # | Topic | Decision |
|---|-------|----------|
| 1 | **Destination name** | CALIBRATION |
| 2 | **Route** | `/calibration` |
| 3 | **Sidebar icon** | **Radar** (replaces current Brain icon on the ai-setup page) |
| 4 | **Permission gate** | Reuse `email.configure_ai` (current `phase_c` gate) — no new permission |
| 5 | **Role / access model** | Company admins only (single tenant). `/admin/system` continues to host OPS-operator cross-company toggles. |
| 6 | **Scope (Broad)** | Absorbs: ai-setup (interview + scan + mining + dashboard), `/agent/comms-config` (10-step autonomy wizard), `/intel` (knowledge graph as CORPUS view), phase-c-dashboard widget from `/agent/queue`. Does NOT absorb: task-types wizard, duplicate-review sheet, `/admin/system` AI toggles, import-pipeline / email-setup wizards. Links to all non-absorbed surfaces. |
| 7 | **Operating tempo** | **Live supervisor** — ongoing learning, visited weekly. Not a one-time setup. |
| 8 | **IA model** | **Command-deck dashboard** — 5 tiles with live counts; click any tile → drill in to full section. Persistent RECENT rail on the main deck. |
| 9 | **Tile names** | `INPUTS / CORPUS / CONFIG / ACTIVITY / MILESTONES` |
| 10 | **First-run experience** | **Wizard mode until complete.** If Interview + Scan + Mining are all incomplete, `/calibration` locks into the 3-step onboarding flow. Once all three are done (or explicitly skipped), flips permanently to the command deck. |
| 11 | **Re-run semantics** | **Independent, accumulative.** Each input source re-runs on its own. Corpus accumulates — a new Email Scan adds/updates facts, does not delete facts from Interview or Mining. Confidence scores update when sources agree/disagree. |
| 12 | **`/intel` absorption** | **Primary CORPUS view.** Clicking the CORPUS tile lands directly on the knowledge graph (full `/intel` UI). Facts + Entities + Voice Profile are secondary drawers on the same view. `/intel` route redirects to `/calibration?section=corpus`. |
| 13 | **`/agent/queue` coordination** | Move the phase-c-dashboard widget into CALIBRATION (under MILESTONES / ACTIVITY). `/agent/queue` becomes queue-only (action cards + filters). Single source of truth. |
| 14 | **Comms-config wizard** | **Full-screen wizard launched from CONFIG.** CONFIG tile shows current autonomy config summary (read-only) with a prominent `RE-RUN WIZARD` button → full-screen 10-step wizard (existing component reused). `/agent/comms-config` redirects to `/calibration?section=config&wizard=open`. |
| 15 | **Activity prominence** | **Persistent RECENT rail on main deck** (last 3-5 events) + ACTIVITY tile drill-in for full history + live stream. Addresses bug-report #5 explicitly ("need to see incoming emails / leads being observed"). |
| 16 | **Milestone announcement** | **Persistent notification rail entry + tile accent pulse.** Action label: `REVIEW`. User opts in via `/calibration` — capability unlocked, not auto-applied. |
| 17 | **Mobile / tablet** | **Fully touch-adapted.** Deck tiles and drill-ins reflow for tablet portrait/landscape. Touch targets ≥56dp. Knowledge graph may degrade gracefully with a `view on desktop` CTA if WebGL perf is inadequate. |
| 18 | **Feature flag migration** | **Collapse `ai_email_review` into `phase_c`.** Migration script copies any `ai_email_review=true` companies into `phase_c=true`. Deprecate `ai_email_review` in `feature-flag-definitions.ts`. Single gate post-rollout. |

---

## Implications for Phase 3 (spec)

### Pages to write specs for

1. **`/calibration` (command deck)** — 5 tiles + RECENT rail, live-updating. Two modes: pre-completion (wizard overlay) vs. post-completion (deck).
2. **`/calibration?section=inputs`** — drill-in with Interview / Email Scan / Database Mining sub-sections, each independently re-runnable.
3. **`/calibration?section=corpus`** — absorbs the full `/intel` UI as primary view. Knowledge graph + Facts drawer + Entities drawer + Voice Profile drawer.
4. **`/calibration?section=config`** — read-only summary + RE-RUN WIZARD button. Opens the existing comms-config 10-step wizard full-screen.
5. **`/calibration?section=activity`** — full activity history + live stream.
6. **`/calibration?section=milestones`** — autonomy milestones progression (absorbs phase-c-dashboard widget).

### Redirects to wire

| Old route | New route |
|-----------|-----------|
| `/settings/integrations/ai-setup` | `/calibration` |
| `/agent/comms-config` | `/calibration?section=config&wizard=open` |
| `/intel` | `/calibration?section=corpus` |

### Dead code to delete (after CALIBRATION ships)

- `src/app/(dashboard)/settings/integrations/ai-setup/page.tsx` (the stopgap-fixed page)
- `src/app/(dashboard)/agent/comms-config/page.tsx`
- `src/app/(dashboard)/intel/page.tsx`
- `docs/superpowers/plans/2026-04-23-ai-setup-admin-panel.md` plan's output (the stopgap full-height + skip-trap fix becomes dead code)

### Components to reuse (not rewrite)

- `AiIntakeInterview` — move under `/calibration?section=inputs&source=interview`
- `AiDatabaseMining` — move under `/calibration?section=inputs&source=mining`
- `AiSetupDashboard` content → becomes the MILESTONES tile body
- `CommsConfigWizard` — reuse verbatim, launched full-screen from CONFIG
- `AutonomyStatusPanel` + `AutoSendSettings` + `EmailCategoryAutonomy` → become the CONFIG tile read-only summary body
- `EmailFilterBuilder` + `FilterFunnelCanvas` → CONFIG tile's filter sub-section
- `PhaseCDashboard` (currently on `/agent/queue`) → MILESTONES tile body
- `ThreadContextPanel` — unchanged (runtime, not absorbed)
- `/intel` page entity graph — becomes primary CORPUS body

### New components required

- `CalibrationCommandDeck` — 5-tile layout + RECENT rail, live-updating
- `CalibrationWizardShell` — first-run 3-step wizard (wraps existing Interview + Scan + Mining)
- `InputsSection` — drill-in with 3 re-runnable sub-sections
- `CorpusSection` — wraps the knowledge graph + Facts / Entities / Voice drawers
- `ConfigSection` — read-only summary with RE-RUN WIZARD launcher
- `ActivitySection` — full activity history + live stream (uses Supabase realtime?)
- `MilestonesSection` — wraps PhaseCDashboard + autonomy milestone progression
- `RecentRail` — live last-3-5-events rail for the main deck
- `MilestoneNotificationTrigger` — fires persistent notification on milestone crossing

### Coordination warnings

- **`src/components/layouts/dashboard-layout.tsx`** — add Radar icon + `CALIBRATION` sidebar entry. Coordinate with Group A NotificationRail session if active.
- **Flag migration script** — one-time SQL migration at `supabase/migrations/YYYYMMDD_collapse_ai_email_review_to_phase_c.sql`. Must run before CALIBRATION ships to avoid gate drift.
- **`feature-flag-definitions.ts`** — remove `ai_email_review` from `FEATURE_FLAG_ROUTES` and `FEATURE_FLAG_PERMISSIONS` dictionaries.

### Out of scope for CALIBRATION (confirmed)

- `/inbox` (runtime) — stays as-is. Recategorization still fires phase-c-learning-service; learnings surface in CALIBRATION's ACTIVITY tile only.
- `/agent/queue` — stays as approval queue only (widget removed).
- `/admin/system` — stays as OPS-operator cross-company panel.
- `/admin/email` — unrelated (newsletter / triggers).
- Task types wizard — stays at `/settings?tab=task-types`. CONFIG tile can link to it.
- Duplicate-review sheet — stays as a runtime sheet. CONFIG tile may surface duplicate detection settings; the sheet itself is unchanged.
- Import pipeline wizard / email setup wizard — stays as modal from `/settings?tab=integrations`. INPUTS tile may link to them.
- `mention-textarea` — not AI-related; collaboration feature.

---

## Status

Phase 2 complete. Ready to proceed to **Phase 3 — Spec** at `OPS-Web/docs/superpowers/specs/2026-04-23-calibration-design.md`.

Skills to load for Phase 3:
- `superpowers:writing-plans` (for the eventual Phase 4 plan)
- `interface-design` + `.interface-design/system.md` (visual spec)
- `frontend-design`
- `animation-studio:animation-architect` (motion gateway)
- `animation-studio:web-animations` (after architect)
- `ops-copywriter` (all copy)
- `mobile-ux-design` (tablet support confirmed)
