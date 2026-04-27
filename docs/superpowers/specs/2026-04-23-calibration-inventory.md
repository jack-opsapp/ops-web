# CALIBRATION — Phase 1 Inventory

> **Status:** Phase 1 complete (audit only). No design, no code yet.
> **Purpose:** Single map of every AI- and Phase-C-related touchpoint in OPS-Web that CALIBRATION may absorb, coordinate with, or redirect.
> **Written:** 2026-04-23
> **Source of truth for:** Phase 2 (brainstorm) → Phase 3 (spec) → Phase 4 (implementation plan)

---

## 1. Executive summary

- **Total files touching AI / phase_c:** 65 (26 UI, 24 API, 15 services)
- **Top-level routes currently hosting AI surfaces:** 5 (`/settings/integrations/ai-setup`, `/agent/comms-config`, `/agent/queue`, `/inbox`, `/intel`) + 2 admin (`/admin/system`, `/admin/email`)
- **Feature flags gating AI:** 3 (`phase_c`, `ai_email_review`, `ai_auto_send`)
- **Crons running AI-backed work:** 9 (memory-decay, schedule-optimization, project-health, project-status-updates, auto-confirm-schedules, appointment-reminders, financial-digest, payment-reminders, email-sync)
- **Existing bug reports in the CALIBRATION area:** 6 (3 are stopgap-fixed already; 3 remain open as scope input)
- **Knowledge corpus tables (Supabase):** `agent_memories`, `agent_knowledge_graph`, `graph_entities`, `agent_writing_profiles`, `email_thread_category_corrections`, `gmail_scan_jobs`, `admin_feature_overrides`, `agent_actions`

**Key finding:** CALIBRATION is not just the ai-setup page. It is the aggregation of everything that trains, governs, or displays the AI's internal state. It touches 5 user-facing routes and 2 admin routes, is gated by 3 feature flags, and has distinct categories: inputs (what the AI learns from), knowledge (what it has learned), behavior config (how it acts), runtime (what it produces), and operator admin (per-company overrides).

---

## 2. Classification legend

| Tag | Meaning | In CALIBRATION scope? |
|-----|---------|------------------------|
| **TRAINING_DATA_INPUT** | User provides raw material (interview, email corpus, DB records) that the AI extracts facts from. | ✅ Yes — the "Inputs" column |
| **EXTRACTED_KNOWLEDGE** | Stores or displays the extracted facts / corpus / memory / writing profile. | ✅ Yes — the "Corpus" column |
| **AI_BEHAVIOR_CONFIG** | Configures *how* the AI operates — autonomy levels, filter rules, category mappings, feature flag toggles, learning corrections. | ✅ Yes — the "Configuration" column |
| **PHASE_C_RUNTIME_UI** | Live runtime the AI *produces* — drafts, triage, suggestions, confirm strips. Product experience, not calibration. | ⚠️ Coordinate but exclude — visible to end users; CALIBRATION is operator-facing |
| **PHASE_C_RUNTIME_LOGIC** | Server-side runtime that uses the trained system — draft generation, extraction pipelines, autonomous crons. | ⚠️ Coordinate but exclude — backend; CALIBRATION may *surface* health, not own |
| **ADMIN_OPERATOR** | OPS internal operator-only admin tools for toggling company AI features. | ❓ Open question — see §11 |

---

## 3. Top-level routes (current state)

| Route | Purpose | Flag gate | CALIBRATION verdict |
|-------|---------|-----------|---------------------|
| `/settings/integrations/ai-setup` | 4-step AI onboarding (interview → email scan → DB mining → dashboard). Stopgap-fixed for full-height + skip-trap nav on 2026-04-23. | `phase_c` | **ABSORB** — this is the core of CALIBRATION. Delete + redirect. |
| `/agent/comms-config` | 10-step wizard configuring autonomy per email type (status updates, confirmations, payment, invoice cover, reschedule, subcontractor). | `phase_c` | **ABSORB** — move under CALIBRATION as the "autonomy config" sub-surface. Possibly rename sections. |
| `/agent/queue` | Approval queue for agent-proposed actions + embedded PhaseCDashboard mission-control widget. | `phase_c` (some actions) | **COORDINATE** — runtime surface (end-user). CALIBRATION links out; queue remains its own destination. |
| `/inbox` | Four-rail thread inbox with category classification, AI drafts, thread-context panel showing Phase C insights. | `phase_c` | **COORDINATE** — pure runtime. But recategorization writes to `email_thread_category_corrections`, which is the learning loop → CALIBRATION should surface that learning. |
| `/intel` | Knowledge graph UI (clients + Phase C entities + edges). | `phase_c` (informed) | **OPEN QUESTION** — could absorb as the "Corpus" view inside CALIBRATION, or stay separate. See §11. |
| `/admin/system` | Ops operator admin: per-company phase_c / ai_email_review toggles, memory stats, feature flags. | Admin email only | **OPEN QUESTION** — §11. Current /admin/system is the OPS Ltd. operator panel. |
| `/admin/email` | Ops operator admin: newsletter / triggers / funnels / schedules (non-AI). | Admin email only | Not in CALIBRATION scope. |

---

## 4. Feature flag map

All flags defined in `src/lib/feature-flags/feature-flag-definitions.ts`:

| Slug | Route gate | Permission gate | What it controls | Notes |
|------|-----------|-----------------|------------------|-------|
| `phase_c` | `/settings/integrations` | `email.configure_ai` | The entire Phase C pipeline: email-scan, extract-facts, mine-database, analyze-memory, draft generation, autonomy crons, comms-config access, inbox context panel, learning service, autonomy dashboard. | **Primary gate.** Server-side checked via `AdminFeatureOverrideService.isAIFeatureEnabled()`. |
| `ai_email_review` | `/settings/integrations` | `email.configure_ai` | Legacy email review feature. Route + permission overlap completely with `phase_c`. | **Redundant.** CALIBRATION should resolve: keep both (with separate semantics) or collapse into `phase_c`. |
| `ai_auto_send` | (no route) | (no permission) | Separate gate for *autonomous* draft sending (vs. draft-only). Checked in auto-send service + settings API. | Autonomy tier gate. Can be disabled while `phase_c` drafting is enabled. |

**Toggled via:** `admin_feature_overrides` table, managed by `AdminFeatureOverrideService`. First-enable of `phase_c` fires a comms-wizard notification to the company admin.

---

## 5. UI components (26)

### 5a. TRAINING_DATA_INPUT (6)

| File | Route / surface | One-sentence purpose |
|------|-----------------|----------------------|
| `src/components/settings/ai-intake-interview.tsx` | `/settings/integrations/ai-setup` step 1 | Multi-step chat interview collecting business / pricing / communication / team data for corpus seeding. |
| `src/components/settings/ai-database-mining.tsx` | `/settings/integrations/ai-setup` step 3 | Mines existing estimates / clients / projects / tasks for pricing patterns and relationships; stores with confidence 1.0. |
| `src/components/settings/email-setup-wizard.tsx` | Embedded modal (from integrations tab) | Gmail OAuth + inbox filter setup; the front-door for email corpus ingestion. |
| `src/components/settings/import-pipeline-wizard.tsx` | Embedded modal (from integrations tab) | 9-step email import wizard (connect → analyze → confirm-sources → filter-flagged → consolidate-contacts → triage → confirm-pipeline → activate). Primary training data ingestion path. |
| `src/components/settings/wizard-steps/*` (14 files) | Sub-steps of import-pipeline-wizard | activate-step, analyze-step, confirm-pipeline-step, confirm-sources-step, connect-step, consolidate-contacts-step, consolidation-utils, email-thread-view, filter-flagged-step, import-progress, stepper-rail, triage-step, card-carousel, glass-action-button. |
| `src/components/settings/task-types-wizard.tsx` + `wizard/*` (7 files) | `/settings?tab=task-types` | 5-step task type configuration (industry → task types → dependencies gate → dependency timeline → review). Feeds task-type learning. |

### 5b. EXTRACTED_KNOWLEDGE (4)

| File | Route / surface | One-sentence purpose |
|------|-----------------|----------------------|
| `src/components/settings/ai-setup-dashboard.tsx` | `/settings/integrations/ai-setup` step 4 | Displays aggregate corpus stats (facts, entities, edges, writing profile confidence, emails analyzed) and readiness across three capabilities. |
| `src/components/agent/phase-c-dashboard.tsx` | Embedded in `/agent/queue` | Read-only mission-control widget across 5 domains (email, projects, invoicing, scheduling, comms) + autonomy milestones reached. |
| `src/components/ops/inbox/thread-context-panel.tsx` | `/inbox` right pane | Per-thread Phase C insights (sender frequency, similar-thread classifications, related memories). Shows the AI's knowledge per thread. |
| `src/app/(dashboard)/intel/page.tsx` | `/intel` | Knowledge graph visualization — clusters of entities (clients, projects, Phase C people/companies/services/materials) with edges. |

### 5c. AI_BEHAVIOR_CONFIG (8)

| File | Route / surface | One-sentence purpose |
|------|-----------------|----------------------|
| `src/app/(dashboard)/settings/integrations/ai-setup/page.tsx` | `/settings/integrations/ai-setup` | 4-step orchestrator gated on phase_c — the current AI setup hub. |
| `src/components/agent/comms-config-wizard/comms-config-wizard.tsx` | `/agent/comms-config` | 10-step wizard configuring autonomy level (off / draft / auto-draft / auto-send) for every email type. |
| `src/components/settings/auto-send-settings.tsx` | `/settings?tab=integrations` (inside AutonomyStatusPanel) | Toggle auto-send globally + business hours + delay min/max + approval-rate gate display. |
| `src/components/settings/autonomy-status-panel.tsx` | `/settings?tab=integrations` | Dashboard showing current autonomy level + emails analyzed + confidence + approval rate + per-category autonomy map. |
| `src/components/settings/email-category-autonomy.tsx` | Inside AutonomyStatusPanel | Per-category (LEAD / CLIENT / VENDOR / etc.) autonomy level selector. |
| `src/components/settings/email-filter-builder.tsx` | `/settings/integrations/ai-setup` sub-component | Email filter rule builder (field / operator / value) controlling which inbox messages feed the AI. |
| `src/components/settings/filter-funnel-canvas.tsx` | Embedded in email-setup-wizard | Visual funnel canvas for inbox filter chain. |
| `src/components/settings/client-comms-settings-tab.tsx` | `/settings?tab=client-comms` | Read-only summary of comms autonomy config with "Re-run Setup Wizard" that routes to `/agent/comms-config`. |
| `src/components/settings/integrations-tab.tsx` | `/settings?tab=integrations` | Hosts Gmail connections + ImportPipelineWizard + AutonomyStatusPanel + AutoSendSettings + AnalysisProgressBanner. |

### 5d. PHASE_C_RUNTIME_UI (5 — coordinate, exclude from absorption)

| File | Route / surface | One-sentence purpose |
|------|-----------------|----------------------|
| `src/app/(dashboard)/inbox/page.tsx` | `/inbox` | Runtime inbox with AI-classified threads, drafts, commitments rail. |
| `src/components/ops/inbox/category-chip.tsx` | `/inbox` rows & header | Category badge + recategorize trigger (writes to category_corrections → learning loop). |
| `src/components/agent/task-schedule-confirm-strip.tsx` | `/projects/[id]` task form | Phase_c-gated schedule confirm strip wrapping the confirm button. |
| `src/components/agent/confirm-schedule-button.tsx` | `/projects/[id]` task form | 3-state button (tentative / confirmed / auto-pending) fires ClientSchedulingCommsService. |
| `src/components/ops/mention-textarea.tsx` | Comment/note fields | **NOT AI-specific** — @ mention parsing for user mentions. Appeared in grep but belongs to collaboration, not CALIBRATION. Exclude. |

### 5e. ADMIN_OPERATOR (3)

| File | Route / surface | One-sentence purpose |
|------|-----------------|----------------------|
| `src/app/admin/system/_components/feature-flags-tab.tsx` | `/admin/system` → Feature Flags | User special permissions + per-company AI feature grid (phase_c, ai_email_review). |
| `src/app/admin/system/_components/company-ai-features.tsx` | `/admin/system` → Feature Flags tab | Per-company toggles for phase_c / ai_email_review with enabled-at timestamps. |
| `src/components/admin/ai-features-panel.tsx` | `/admin` (secondary) | Alternative admin UI for toggling AI features + memory stats (facts / entities / profiles) + memory reset. |

### 5f. Orthogonal but related (3)

| File | Route / surface | Note |
|------|-----------------|------|
| `src/components/ops/duplicate-review-sheet.tsx` | Triggered from any list | Duplicate entity merge sheet (clients / opportunities / projects / tasks). *Not phase_c gated,* but same IA cluster (classification/merge rules). **Open question for §11.** |
| `src/components/ops/duplicate-pair-card.tsx` | Inside DuplicateReviewSheet | Pair comparison card for 2-entity merges. |
| `src/components/ops/duplicate-cluster-card.tsx` | Inside DuplicateReviewSheet | Cluster card for N-entity merges with winner selection. |

---

## 6. API endpoints (24)

### 6a. TRAINING_DATA_INPUT (3)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/integrations/ai-setup/email-scan` | POST / GET (poll) | Scans 12 months of outbound email in 50-email batches → `MemoryService` facts + `WritingProfileService` profile. |
| `/api/integrations/ai-setup/extract-facts` | POST | Extracts structured facts from intake-interview responses (pricing, materials, team, comms style); seeds writing profile from Q8 examples. |
| `/api/integrations/ai-setup/mine-database` | POST | Mines estimates / clients / projects / tasks for pricing patterns, client-service relationships, seasonal trends. |

### 6b. EXTRACTED_KNOWLEDGE (2)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/intel/graph` | GET | Unified knowledge graph — merges live OPS records + Phase C entities/edges/writing profiles; cluster-resolved. |
| `/api/intel/entity/[entityId]` | GET | Drill-down detail for a single entity (Phase C or live OPS). |

### 6c. AI_BEHAVIOR_CONFIG (4)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/integrations/email/auto-send/settings` | GET / PUT | Manages autonomy milestones, auto-draft enablement, category-level autonomy, ai_auto_send gate. |
| `/api/admin/ai-features` | GET | (admin) List companies with AI feature override status. |
| `/api/admin/ai-features/[companyId]` | PATCH | (admin) Toggle `phase_c` / `ai_email_review` for a specific company; fires first-enable notification. |
| `/api/agent/comms-wizard/gating` | GET | Returns writing-profile confidence + prior appointment-confirmations; unlocks FULL AUTO when confidence ≥ 0.85 AND priors ≥ 50. |

### 6d. PHASE_C_RUNTIME_LOGIC (13)

| Route | Purpose |
|-------|---------|
| `/api/integrations/email/analyze-memory` (POST) | Phase C entry: classify threads → run chunked extraction (12 threads × 550s budget) → fire continuation. |
| `/api/integrations/email/analyze-memory-continue` (POST) | Phase C continuation: resume extraction from persisted state → finalize (profiles + stats + notification). |
| `/api/inbox/phase-c-backfill` (POST) | Targeted backfill over LEAD + CLIENT threads (90 days); 10 threads / 2 concurrency; idempotent. |
| `/api/integrations/email/ai-draft` (POST) | Generate AI email draft (memory optional); invokes AIDraftService. |
| `/api/integrations/email/draft` (POST) | Generate pipeline-lead draft (phase_c-gated, confidence gate). |
| `/api/inbox/threads/[id]` (PATCH) | Recategorize trigger — writes correction → fires phase-c-learning-service. |
| `/api/inbox/commitments/[id]` (PATCH) | Resolve / reopen commitment (unblocks COMMITMENTS rail). |
| `/api/agent/phase-c-status` (GET) | 30-day aggregated status across 5 domains + autonomy milestones. |
| `/api/agent/confirm-schedule` (POST) | Mark task schedule-confirmed → fire client-scheduling-comms dispatcher. |
| `/api/agent/unconfirm-schedule` (POST) | Revert confirmation → propose "schedule changed" email. |
| `/api/agent/team-availability` (GET) | Team availability for scheduling comms. |
| `/api/integrations/email/webhook/gmail` (POST) | Gmail push webhook → triggers sync + classification. |
| `/api/integrations/email-webhook` (POST) | Legacy / fallback webhook entry. |

### 6e. ADMIN_OPERATOR (2)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/ai-features/[companyId]/memory` | GET / DELETE | (admin) View memory facts + graph OR reset all memory for a company. |
| `/api/admin/email/last-email` | GET | (admin) Debug last email seen per company. |

---

## 7. Services & hooks (15)

### 7a. EXTRACTED_KNOWLEDGE (4)

| File | Role |
|------|------|
| `src/lib/api/services/memory-service.ts` | **Layer 1 of knowledge stack.** Extracts facts / entities / relationships from threads via OpenAI gpt-4o-mini; manages `agent_memories`, `graph_entities`, `agent_knowledge_graph`. |
| `src/lib/api/services/business-context-service.ts` | **Layer 3 of knowledge stack.** Queries live OPS data (clients, projects, invoices) → LLM-friendly summaries for RAG injection. |
| `src/lib/api/services/writing-profile-service.ts` | Extracts 12-dimension writing profile (formality, hedging, greetings, closings, etc.) from outbound email corpus. |
| `src/lib/api/services/phase-c-learning-service.ts` | **Learning loop.** When a user recategorizes a thread, propagates correction to similar threads (same sender domain OR participants hash) and writes a domain-level rule memory. |

### 7b. AI_BEHAVIOR_CONFIG (3)

| File | Role |
|------|------|
| `src/lib/api/services/admin-feature-override-service.ts` | Per-company AI feature gate (`phase_c`, `ai_email_review`, `ai_auto_send`); fires first-enable notification. |
| `src/lib/api/services/email-filter-service.ts` | Email filter rule evaluation (field / operator / value matching). |
| `src/lib/api/services/duplicate-detection-service.ts` | Entity duplicate detection across clients / opportunities / projects / tasks. |

### 7c. PHASE_C_RUNTIME_LOGIC (8 — coordinate, exclude)

| File | Role |
|------|------|
| `phase-c-pipeline-helpers.ts` | Chunked pipeline orchestration (lock / persist state / dispatch continuation / finalize). |
| `draft-generator.ts` | Lead-reply drafts in company voice (phase_c + confidence ≥ 0.5 gate). |
| `ai-draft-service.ts` | Client / vendor / subtrade / internal drafts with business context + financial intelligence. |
| `auto-send-service.ts` | Auto-send scheduling with randomized delays + business hours; cron processor. |
| `approval-queue-service.ts` | Central service for all agent-proposed actions (projects / tasks / invoices / email). |
| `ai-sync-reviewer.ts` | Feature-gated AI review on each sync cycle; combined stage-eval + opportunity summary. |
| `autonomy-milestone-service.ts` | Tracks milestones (drafting available → auto-draft → auto-send). |
| `client-scheduling-comms-service.ts` | Dispatcher for schedule-triggered comms (confirm / reschedule / reminder). |
| `schedule-optimization-service.ts`, `payment-reminder-service.ts`, `invoice-suggestion-service.ts`, `task-suggestion-service.ts`, `financial-intelligence-service.ts`, `project-lifecycle-service.ts` | Domain-specific agent proposers. |
| `sync-engine.ts` | Gmail sync with AI classification pipeline. |

### 7d. Hooks / stores (3)

| File | Role |
|------|------|
| `src/stores/duplicate-review-store.ts` | Zustand store for duplicate review sheet open/close state. |
| `src/lib/hooks/use-duplicate-reviews.ts` | TanStack query for duplicate clusters + merge / dismiss mutations. |
| `src/lib/hooks/use-inbox-threads.ts` | TanStack query for classified inbox threads. |

---

## 8. Crons (9)

| Cron path | Schedule | Phase_c-gated? | What it does |
|-----------|----------|----------------|--------------|
| `/api/cron/memory-decay` | Daily 3am UTC | Yes (per-company) | Decay / prune / consolidate agent_memories; protects unresolved commitments with future due dates. |
| `/api/cron/schedule-optimization` | Daily 5am | Yes | Analyze today + tomorrow schedules → propose optimizations via ScheduleOptimizationService. |
| `/api/cron/project-health` | Daily 8am | Yes | Detect overdue tasks + archivable projects → propose reminders / archival. |
| `/api/cron/auto-confirm-schedules` | Hourly | Yes | For companies w/ auto confirmation, mark stable tasks (> grace period) confirmed → fire dispatcher. |
| `/api/cron/project-status-updates` | Weekly Mon 9am | Yes | Generate status-update email drafts for active projects → propose via agent_actions. |
| `/api/cron/appointment-reminders` | (check route) | Yes | Generate appointment-reminder emails. |
| `/api/cron/payment-reminders` | (check route) | Yes | Generate payment-reminder emails. |
| `/api/cron/financial-digest` | (check route) | Yes | Weekly financial digest. |
| `/api/cron/email-sync` | Frequent | Some | Trigger Gmail sync for due connections. |

---

## 9. Existing bug reports (Supabase `bug_reports`)

Filter: `screen_name ILIKE '%ai-setup%' OR '%inbox%' OR '%agent%'` + `category='feature_request'` with Phase C keywords. 6 results:

| Date | Screen | Category | Summary | Status vs CALIBRATION |
|------|--------|----------|---------|-----------------------|
| 2026-04-21 | Inbox | bug | "Build out weekly email/text with company report (or for crew, their report)" | Feature request. Runtime — coordinate, not CALIBRATION core. |
| 2026-04-21 | Inbox | bug | "Merge/Duplicates Review, no support for creating subclients of suspected Duplicates" | Touches duplicate detection rules → **CALIBRATION candidate** if we absorb duplicate config. |
| 2026-04-15 | Settings.Integrations.Ai-setup | bug | "ops admin panel: need to consolidate tabs" | **This IS CALIBRATION.** Supports the consolidation case. |
| 2026-04-15 | Settings.Integrations.Ai-setup | bug | "ops admin panel: need to remove scrollview from page" | **Fixed by stopgap** (full-height plan). |
| 2026-04-15 | Settings.Integrations.Ai-setup | bug | "Phase C next steps; need to make sure incoming emails and leads are actually being observed" | **Status visibility gap** — CALIBRATION needs a live "what is the AI doing right now" panel. |
| 2026-04-15 | Settings.Integrations.Ai-setup | bug | "when on inbox tab, user cannot click to another tab" | **Fixed by stopgap** (skip-trap nav fix). |

**Signal:** 3 of 6 are already CALIBRATION-shaped feedback. The "need to consolidate tabs" + "need status visibility" + "duplicate subclient support" are all direct inputs for Phase 2 brainstorm.

---

## 10. File collision risk

**`src/components/layouts/dashboard-layout.tsx`** is the shared sidebar + chrome. Per the handoff, it already mounts:
- NotificationRail (Group A separate session may be active)
- BugReportButton (Group E1 on hold)
- FAB (Group E1 on hold)
- Setup gate logic

CALIBRATION needs a new sidebar nav entry here. **Coordinate before editing.**

The stopgap `ai-setup-admin-panel.md` plan also touches the ai-setup page layout. Once CALIBRATION lands, that page becomes dead code — delete the page, delete its layout entry (if any), redirect `/settings/integrations/ai-setup` → `/calibration/?section=...`.

---

## 11. Open questions for Jackson (Phase 2 brainstorm triggers)

These must be answered before design begins:

### A. Scope boundaries

1. **Absorb `/agent/comms-config`?** Move the 10-step wizard inside CALIBRATION as the "Autonomy Config" section, OR keep it at `/agent/comms-config` and link from CALIBRATION?
2. **Absorb `/intel` knowledge graph?** The graph visualizes the extracted corpus. Make it the "Corpus" primary view inside CALIBRATION, OR keep `/intel` as its own destination and deep-link from CALIBRATION?
3. **Absorb `/agent/queue`?** This is runtime (approval of agent proposals). Keep separate, but surface a "current queue depth" metric inside CALIBRATION?
4. **Absorb `/admin/system` AI toggles?** The per-company admin panel is OPS-operator-only. Two options:
   - (a) Keep admin separate; CALIBRATION is for company admins inside their tenant.
   - (b) Build CALIBRATION with role-aware views — company admins see their own corpus; OPS operators see a company picker at the top that switches context.
5. **Absorb task-types wizard?** Task type learning is part of "how the AI understands your work." Move under CALIBRATION, or leave in `/settings?tab=task-types`?
6. **Absorb import-pipeline-wizard / email-setup-wizard?** These are the primary training data ingestion paths but currently live under `/settings?tab=integrations` as modal wizards. Move or link?
7. **Absorb duplicate-review-sheet?** Not phase_c gated but conceptually "classification/merge rules the AI follows." Include duplicate detection tuning inside CALIBRATION, or leave as a runtime sheet?

### B. IA model

8. **Command-deck dashboard** (status tiles + drill-in) vs **split-view** (source tree on left + active area on right) vs **horizontal tab bar** (Inputs / Corpus / Config / Activity) vs **sidebar-in-sidebar**?
9. **Primary view on `/calibration`:** overview dashboard, or land on the last section used, or land on the interview if incomplete?

### C. Operating model

10. **Live vs one-time:** Is CALIBRATION ongoing (constantly learning, always something to look at) or one-time setup + occasional re-runs?
11. **Re-run semantics:** Can each input source (interview / email scan / DB mining) be re-run independently? Does re-running one invalidate knowledge from the others, or does the corpus accumulate?
12. **Collapse `phase_c` + `ai_email_review`?** The two flags gate the same route + permission. Can we deprecate `ai_email_review` during CALIBRATION rollout?

### D. Permissions & access

13. **Who accesses `/calibration`?** Company admins only? Create a new `calibration.manage` permission, or reuse `email.configure_ai`?
14. **Mobile/tablet touch?** The user often operates from a tablet in a truck. Is CALIBRATION touchable (mobile-adapted) or desk-only?

### E. Naming & icon

15. **Sidebar icon:** Keep Brain, or switch to Sparkles / Cpu / Activity / Radar?
16. **Sub-section names:** currently INTERVIEW / EMAIL SCAN / DATA MINING (from handoff). Also ADD: CORPUS? AUTONOMY? LEARNING? STATUS?

### F. Status visibility (from bug #5)

17. **"Is the AI observing my emails right now?"** Jackson's bug report asks for live visibility into Phase C pipeline state. Should CALIBRATION include a live activity feed / status panel showing: last scan, current queue, pending extractions, recent learnings?

---

## 12. What CALIBRATION is NOT (hard exclusions)

- Not the runtime inbox (`/inbox`) — stays separate.
- Not the agent queue (`/agent/queue`) — stays separate but may surface depth.
- Not the confirm-schedule strip on task forms — stays in place.
- Not `/admin/email` (newsletter / triggers) — separate domain.
- Not the mention-textarea — appeared in grep but belongs to collaboration.

---

## 13. Next phase

After Jackson reviews §11 open questions, proceed to Phase 2 (brainstorm) with `superpowers:brainstorming` skill. No design or code until §11 is resolved.
