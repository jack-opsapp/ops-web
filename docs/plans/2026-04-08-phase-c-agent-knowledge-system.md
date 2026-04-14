# Phase C — OPS Agent Knowledge System

**Date:** April 8, 2026
**Status:** Planning
**Goal:** Build the OPS AI agent into a business intelligence layer that learns each company's operations deeply enough to autonomously handle email, then expand to invoicing, project management, and scheduling.
**Beta target:** Internal use with Canpro Deck and Rail

---

## Architecture Overview

### Three-Layer Knowledge Stack

```
┌─────────────────────────────────────────────────────┐
│                   OPS AGENT                          │
│                                                      │
│   Email Agent → Invoice Agent → Project Agent → ...  │
│                                                      │
├─────────────────────────────────────────────────────┤
│              CONTEXT ASSEMBLY LAYER                   │
│                                                      │
│   Assembles the right knowledge for the right task   │
│   at the right moment from all three layers below    │
│                                                      │
├──────────┬──────────────────┬───────────────────────┤
│ LAYER 1  │    LAYER 2       │    LAYER 3            │
│ Semantic │    Knowledge     │    Live Business      │
│ Memory   │    Graph         │    Data (RAG)         │
│          │                  │                        │
│ Facts    │ Entities &       │ Invoices, estimates,  │
│ Prefs    │ relationships    │ projects, clients,    │
│ Style    │ with temporal    │ line items, payments, │
│ Patterns │ validity         │ team, schedule        │
│          │                  │                        │
│ pgvector │ graph_entities + │ Direct Supabase       │
│ search   │ agent_knowledge  │ queries               │
│          │ _graph           │                        │
└──────────┴──────────────────┴───────────────────────┘
```

### Progressive Autonomy Ladder

```
Level 0: OBSERVE      ─── Day 1. Silently learn from all emails + database.
    │
    ▼  (25+ emails, confidence > 0.2)
Level 1: AVAILABLE    ─── Notification: "AI drafting is ready." Badge in inbox.
    │
    ▼  (100+ emails, confidence > 0.5)
Level 2: DRAFT        ─── User clicks to generate draft. Reviews before sending.
    │
    ▼  (250+ emails, confidence > 0.75, user opts in)
Level 3: AUTO-DRAFT   ─── Every inbound email gets pre-generated draft for review.
    │
    ▼  (95% approval over 20+ drafts, user opts in)
Level 4: AUTO-SEND    ─── Sends after configurable delay. User can cancel.
    │
    ▼  (user configures per email category)
Level 5: PER-CATEGORY ─── Different trust levels for different email types.
```

### Writing Profile (12 Dimensions)

| # | Dimension | Current | Target |
|---|-----------|---------|--------|
| 1 | Formality score | Partial (deep analysis every 25 emails) | Continuous, weighted rolling average |
| 2 | Sentence length | Captured | Keep |
| 3 | Paragraph structure | Missing | Bullet preference, paragraph length |
| 4 | Hedging frequency | Missing | "perhaps", "might", "I think" detection |
| 5 | Punctuation style | Missing | Em-dashes, semicolons, exclamations |
| 6 | Vocabulary complexity | Missing | Jargon usage, reading level |
| 7 | Engagement style | Missing | Questions, direct address, asides |
| 8 | Greeting patterns | Captured | Keep |
| 9 | Closing patterns | Captured | Keep |
| 10 | Response structure | Missing | How they open, transition, close |
| 11 | Tone markers | Partial (every 25 emails) | Continuous tracking |
| 12 | Email length per context | Missing | Short/medium/long by relationship type |

### Edit Learning (Full Spectrum)

Current: only learns greeting/closing changes after 3+ repetitions.
Target: learn across ALL dimensions — tone shifts, phrasing preferences, content corrections, pricing language, formality adjustments. Every edit to a draft is a training signal.

---

## Phased Build Plan

The system is built domain-by-domain. Each domain follows the same pattern:
1. Knowledge acquisition (what does the agent need to know?)
2. Context assembly (how does it get the right knowledge at the right moment?)
3. Action generation (what does the agent produce?)
4. Feedback loop (how does it learn from corrections?)
5. Autonomy graduation (how does it earn trust?)

---

## DOMAIN 1: EMAIL (Sprints E1-E5)

Email is the foundation. All other domains build on the knowledge layer established here.

### Sprint E1 — Fix the Learning Pipeline

**Goal:** The agent learns from ALL sent emails, not just opportunity-linked ones.

#### E1.1 — Process all outbound emails in sync

**File:** `src/lib/api/services/sync-engine.ts`

Currently `processOutboundEmail()` and `WritingProfileService.updateFromEmail()` are only called inside `processSentEmail()` for thread-linked emails. Change: call them for EVERY outbound email that passes through the sync engine, regardless of whether it has a linked opportunity.

- Move memory/profile calls to run after activity creation for all sent emails
- For emails without an opportunity, still extract facts, entities, and writing style
- Gate behind `phase_c` flag (already exists)

#### E1.2 — Fix migration drift

Create proper migration files for production schema state:

**New migration: `041_phase_c_schema_alignment.sql`**
- CREATE TABLE `graph_entities` (if not exists) with all columns: id, company_id, entity_type, name, normalized_name, email, properties (JSONB), confidence, source, embedding (vector(1536)), created_at, updated_at. Unique constraint: (company_id, entity_type, normalized_name)
- ALTER TABLE `agent_knowledge_graph` ADD COLUMN `source_entity_id` UUID REFERENCES graph_entities(id), `target_entity_id` UUID REFERENCES graph_entities(id), `link_type` TEXT, `confidence` FLOAT (if not exists). Add unique constraint: (company_id, source_entity_id, predicate, target_entity_id)
- ALTER TABLE `agent_writing_profiles` ADD COLUMN `profile_type` TEXT NOT NULL DEFAULT 'general' (if not exists). Drop old unique constraint (company_id, user_id), add new: (company_id, user_id, profile_type)
- ALTER TABLE `agent_memories` ADD COLUMN `entity_id` UUID REFERENCES graph_entities(id) (if not exists)
- NOTE: `valid_from`/`valid_to` exist on `agent_knowledge_graph` (migration 036), NOT on `agent_memories`. Do not add them to `agent_memories` unless new code requires temporal fact validity.

This is a reconciliation migration — it must be idempotent (IF NOT EXISTS everywhere) since production already has these.

**Known inconsistency to fix:** `agent_writing_profiles.tone_traits` is written as `{ "friendly": true }` (object) by `WritingProfileService` but as `["direct", "professional"]` (array) by `MemoryService.buildWritingProfiles()`. Standardize to object format in Sprint E4.

#### E1.3 — Implement vector search for memory retrieval

**File:** `src/lib/api/services/memory-service.ts`

Currently `getContextForDraft()` uses simple category-based filtering. Replace with:
- Generate embedding for the draft context (thread summary + client info)
- Vector similarity search against `agent_memories.embedding` using pgvector
- Combine with category filtering for hybrid retrieval
- Use Supabase's `<=>` operator for cosine distance

This requires populating embeddings during `processOutboundEmail()` — add embedding generation (OpenAI `text-embedding-3-small`) when creating memory entries.

#### E1.4 — Memory decay mechanism

**New cron:** `/api/cron/memory-decay` (daily)
- Reduce `decay_score` for memories not accessed recently
- Prune memories below threshold (0.1) that are older than 6 months
- Consolidate duplicate/near-duplicate memories (merge if cosine similarity > 0.95)

---

### Sprint E2 — Database Context Layer (RAG over Business Data)

**Goal:** Agent can access real pricing, client history, project data — not just email-extracted text.

#### E2.1 — Business data context service

**New file:** `src/lib/api/services/business-context-service.ts`

Functions:
- `getClientContext(companyId, clientEmail)` — client record, all projects, invoices, estimates, payment history, communication frequency
- `getPricingContext(companyId, serviceType?)` — recent estimates with line items, average pricing per service, material costs, markup patterns
- `getProjectContext(companyId, projectId?)` — project details, tasks, calendar events, assigned team
- `getCompanyContext(companyId)` — services offered, service area, team members, standard terms, typical response times

Each function returns a structured summary (not raw rows) suitable for injection into an LLM prompt.

#### E2.2 — Integrate business context into draft generation

**File:** `src/lib/api/services/ai-draft-service.ts`

Update `generateDraft()` to call `BusinessContextService` alongside `MemoryService.getContextForDraft()`:
- If the thread involves a known client → inject client context (past projects, payment terms, pricing history)
- If the thread mentions pricing/quoting → inject pricing context (recent estimates for similar work)
- If the thread references a project → inject project context
- Always inject company context (services, team, area)

This gives the agent access to the same information the human would look up before drafting a reply.

#### E2.3 — Database-sourced authoritative facts

During the intake/onboarding flow (Sprint E3), mine the database for high-confidence facts:
- Parse all estimates to extract service/pricing patterns → store as `agent_memories` with confidence 1.0
- Parse client records for relationship patterns → store as knowledge graph edges
- Parse project history for seasonal patterns, common services

---

### Sprint E3 — Fast-Track Knowledge Acquisition

**Goal:** Canpro's agent is useful in hours, not months.

#### E3.1 — Intake interview

**New page:** `src/app/(dashboard)/settings/integrations/ai-setup/page.tsx`
**New component:** `src/components/settings/ai-intake-interview.tsx`

Conversational onboarding flow (10-15 questions, one at a time):

**Business Basics:**
1. "What services does your company offer?" (multi-select + custom)
2. "What's your primary service area?" (geographic)
3. "What materials do you commonly use?" (trade-specific)

**Pricing:**
4. "What are your typical price ranges per service?" (structured input: service → range)
5. "Do you have standard rates for common items?" (e.g., per linear foot, per square foot)
6. "What are your standard payment terms?" (NET-30, 50/50, etc.)

**Communication Style:**
7. "How would you describe your communication style with clients?" (multiple choice + custom)
8. "Paste 2-3 example emails you're proud of" (direct style learning)
9. "Any phrases you always/never use?" (vocabulary preferences)

**Business Rules:**
10. "What's your typical response time to client inquiries?"
11. "Are there services you DON'T offer that people commonly ask about?"
12. "Any seasonal patterns in your business?" (e.g., busy spring-fall)

**Team:**
13. "Who handles what? Map team members to responsibilities"
14. "Are there topics only certain people should respond to?"

Each answer → stored as high-confidence memory facts + knowledge graph entries.
Example responses → analyzed for writing profile seeding.

The UI should feel like a conversation, not a form. Use a chat-like interface with the agent asking questions and the user responding naturally. Render with AI Elements `<MessageResponse>` for the agent's questions.

#### E3.2 — Bulk email analysis

**Enhancement to:** `/api/integrations/email/analyze-memory`

Currently processes only classified threads. Add a "full history scan" mode:
- Fetch ALL sent emails from the last 12 months (paginated, respect rate limits)
- Process in batches of 50 (existing batch infrastructure)
- Extract facts, entities, writing profile data from every outbound email
- Show progress in UI: "Analyzed 347 of 1,204 emails"

Trigger: button on the AI setup page after intake interview completes.

#### E3.3 — Database mining

**New API:** `/api/integrations/ai-setup/mine-database`

Automated extraction from existing business data:
- Scan all estimates → extract service types, pricing patterns, line item templates
- Scan all invoices → extract payment terms, average amounts, client payment behavior
- Scan all projects → extract common project types, typical durations, team assignments
- Scan all clients → extract relationship patterns, communication frequency, preferences

Store as authoritative facts (confidence 1.0) in `agent_memories` and edges in `agent_knowledge_graph`.

---

### Sprint E4 — Enhanced Writing Profile & Edit Learning

**Goal:** Agent reproduces the user's voice across all dimensions, and learns from every correction.

#### E4.1 — 12-dimension writing profile extraction

**File:** `src/lib/api/services/writing-profile-service.ts`

Expand `updateFromEmail()` to extract all 12 dimensions:
- Add regex/NLP for hedging detection, punctuation patterns, engagement markers
- Track paragraph structure (bullets vs prose, paragraph length)
- Track vocabulary complexity (unique word ratio, average word length)
- Track email length distribution per relationship type
- Store new dimensions in `vocabulary_preferences` JSONB (already exists, underused)

#### E4.2 — Full-spectrum edit learning

**File:** `src/lib/api/services/ai-draft-service.ts`

Expand `learnFromEdits()` beyond greetings/closings:
- **Tone shifts:** detect formality changes between original and final
- **Content corrections:** identify added/removed facts, pricing adjustments
- **Phrasing preferences:** detect systematic word substitutions (e.g., user always changes "residence" to "home")
- **Structure changes:** detect if user consistently restructures paragraphs
- Store learned preferences in `agent_writing_profiles.vocabulary_preferences`
- Feed content corrections back as `agent_memories` with type `correction`

#### E4.3 — Per-relationship-type learning

Edit patterns should be tracked per relationship type (already have 10 profile types in schema).
If a user consistently makes different edits to vendor emails vs client emails, the agent should learn separate preferences for each.

---

### Sprint E5 — Auto-Draft Mode & Notifications

**Goal:** The proactive experience — drafts waiting for review, clear notifications, Superhuman-like flow.

#### E5.1 — Auto-draft generation on inbound email

**Enhancement to:** `src/lib/api/services/sync-engine.ts`

When a new inbound email arrives on a linked thread AND confidence > 0.75 AND user has opted in:
1. Generate draft using `AiDraftService.generateDraft()`
2. Store in `ai_draft_history` with status `auto_drafted`
3. Trigger notification (see E5.2)

This runs as a background task (`after()` / `waitUntil()`) during sync processing.

#### E5.2 — Notification system for autonomy milestones

**New notifications (add to existing notification system):**

| Event | Trigger | Message | CTA |
|-------|---------|---------|-----|
| Draft available | Confidence crosses 0.2 (first time) | "AI email drafting is ready for you" | "Try it" → settings |
| Auto-draft ready | Confidence crosses 0.75 + 250 emails | "Auto-draft is available — drafts ready before you open emails" | "Turn on" / "Not now" |
| Auto-send suggested | 95% approval over 20+ drafts | "Your drafts are sent without changes 95% of the time. Enable auto-send?" | "Enable" / "Not yet" |
| New auto-draft | Auto-draft generated for inbound email | "Draft ready for: [subject]" | "Review" → compose |

Store notification state in `email_connections` metadata (which milestones have been shown, dismissed, or accepted).

#### E5.3 — Per-category autonomy settings (Superhuman pattern)

**New component:** `src/components/settings/email-category-autonomy.tsx`

Let users configure different trust levels per email category:
- Client inquiries: auto-draft
- Vendor follow-ups: auto-send
- New leads: draft on request only
- Internal: auto-send
- Warranty/complaints: never auto-send

Categories derived from thread classification (already exists in memory service).

---

## DOMAIN 2: PROJECT MANAGEMENT (Sprints P1-P3)

**Prerequisite:** Domain 1 complete. Knowledge layer established.

### Sprint P1 — Project Creation Agent

**Goal:** Agent can create projects from email context.

#### P1.1 — Project creation tool

**New file:** `src/lib/api/services/agent-tools/create-project-tool.ts`

The agent gets a new "tool" (in the AI SDK sense) that can:
- Create a project with title, client, address, scope
- Pre-populate from email thread context (client name, address, service description)
- Create initial tasks based on common patterns for that service type

#### P1.2 — Approval queue UI

**New page:** `src/app/(dashboard)/agent/queue/page.tsx`

Central queue for all pending agent actions:
- List of proposed actions with context (why the agent wants to do this)
- Approve / Reject / Edit buttons
- Batch approve for routine actions
- Filter by action type, confidence, urgency

This is the foundational UI for ALL autonomous actions across all domains.

#### P1.3 — Project suggestion from email

When the agent detects a new client inquiry that could become a project:
1. Draft reply (existing)
2. ALSO suggest: "Create project for [client]?" with pre-filled details
3. Action queued in approval queue
4. On approve → project created, linked to opportunity/thread

---

### Sprint P2 — Task Assignment Agent

**Goal:** Agent can create and assign tasks within projects.

#### P2.1 — Task creation/assignment tool

Agent can:
- Create tasks within a project
- Suggest task type based on project service type
- Suggest team member assignment based on skills/availability/history
- Suggest scheduling based on calendar availability

#### P2.2 — Schedule awareness

Agent reads calendar data to:
- Know who's available when
- Suggest realistic scheduling
- Warn about conflicts
- Factor in travel time between job sites (if location data available)

---

### Sprint P3 — Project Lifecycle Automation

**Goal:** Agent handles routine project management tasks autonomously.

- Auto-create follow-up tasks when project stage changes
- Send status update emails to clients at configurable intervals
- Flag overdue tasks and suggest reassignment
- Archive completed projects after configurable delay

---

## DOMAIN 3: INVOICING (Sprints I1-I3)

**Prerequisite:** Domain 2 complete. Agent understands project lifecycle.

### Sprint I1 — Invoice Draft Generation

**Goal:** Agent can draft invoices from project/estimate data.

#### I1.1 — Invoice generation tool

Agent can:
- Generate invoice from estimate (copy line items, apply changes)
- Generate invoice from project completion (time/materials or fixed price)
- Apply standard payment terms from company settings
- Include personalized cover message using writing profile

#### I1.2 — Dollar-amount safety rails

Financial actions get extra scrutiny:
- All invoices require approval (no auto-send for financial documents)
- Amount thresholds: invoices > $5,000 require explicit confirmation
- Duplicate detection: warn if similar invoice exists for same client/project
- Line item validation: flag if pricing deviates >20% from historical patterns

### Sprint I2 — Invoice Follow-Up

Agent handles collections:
- Auto-generate payment reminder emails at configurable intervals (7, 14, 30 days overdue)
- Escalate tone gradually (friendly → firm → final notice)
- Use writing profile for tone matching
- Flag accounts with repeated late payments

### Sprint I3 — Financial Intelligence

Agent provides financial insights:
- Revenue forecasting from pipeline + historical patterns
- Seasonal adjustment recommendations
- Pricing optimization suggestions based on win/loss rates
- Cash flow alerts based on outstanding invoices

---

## DOMAIN 4: SCHEDULING (Sprints S1-S2)

**Prerequisite:** Domain 2 task assignment working.

### Sprint S1 — Smart Scheduling

Agent optimizes crew scheduling:
- Suggest daily crew assignments based on skills, location, availability
- Optimize route sequences to minimize travel time
- Handle rescheduling cascades when things change
- Weather-aware scheduling (outdoor work)

### Sprint S2 — Client Communication

Agent handles scheduling communications:
- Send appointment confirmations to clients
- Send day-before reminders
- Handle rescheduling requests via email
- Coordinate with subcontractors

---

## Shared Infrastructure (Built Once, Used Everywhere)

### Approval Queue (Sprint E5 / P1)
- Central UI at `/agent/queue`
- All domain agents submit actions to the same queue
- Per-action-type autonomy settings
- Audit log of all approved/rejected actions

### Agent Orchestrator
- Routes intent to the correct domain agent
- Shares knowledge layer across all agents
- Enforces safety rails and permission boundaries
- Tracks confidence per domain independently

### Feedback System
- Every agent action (draft, project, invoice, task) trackable
- Edit distance + change detection for all outputs
- Corrections feed back into knowledge layer
- Confidence adjusts based on approval/rejection rates

---

## Canpro Beta Checklist

What we need before going live with Canpro:

### Must Have (Sprint E1-E3)
- [ ] Fix learning pipeline — process ALL sent emails
- [ ] Fix migration drift — reconciliation migration
- [ ] Implement vector search for memory retrieval
- [ ] Build business context service (database RAG)
- [ ] Build intake interview UI
- [ ] Run bulk email analysis on Canpro's history
- [ ] Mine Canpro's database for authoritative facts
- [ ] Enable `phase_c` flag for Canpro's company ID

### Should Have (Sprint E4-E5)
- [ ] Enhanced 12-dimension writing profile
- [ ] Full-spectrum edit learning
- [ ] Auto-draft mode with notifications
- [ ] Autonomy milestone notifications

### Nice to Have (Domains 2-4)
- [ ] Approval queue UI (foundational for all future domains)
- [ ] Project suggestion from email

---

## Success Metrics

### Email Domain
- **Draft acceptance rate:** % of drafts sent without edits (target: >80% after 30 days)
- **Time to first draft:** how quickly after connect the agent produces usable drafts (target: <24 hours with intake + bulk scan)
- **Edit convergence:** edits decrease over time as agent learns (track weekly)
- **User satisfaction:** qualitative feedback from Canpro team

### Knowledge Quality
- **Fact accuracy:** sample facts, verify against reality (target: >95%)
- **Entity resolution accuracy:** check for duplicates/mismatches (target: >90%)
- **Pricing accuracy:** compare agent's pricing knowledge vs actual estimates (target: within 10%)

### Progressive Autonomy
- **Time to Level 2 (draft on request):** target <1 week with fast-track
- **Time to Level 3 (auto-draft):** target <4 weeks
- **Time to Level 4 (auto-send):** target only if user wants it

---

## Technical Dependencies

| Dependency | Status | Needed For |
|------------|--------|-----------|
| OpenAI API (`gpt-5.4-mini`) | Available | Draft generation, fact extraction |
| OpenAI API (`text-embedding-3-small`) | Available | Vector embeddings |
| pgvector extension | Installed in Supabase | Vector similarity search |
| Supabase RLS | Configured | All Phase C tables |
| Gmail API | Connected (Canpro) | Email sync, send |
| Vercel Cron | Configured | Auto-send, memory decay |
| Feature flags system | Built | Phase C gating |

---

## Open Questions

1. **Model choice for drafting:** Currently using `gpt-5.4-mini`. Should we test Claude for better style matching? Or use AI Gateway to A/B test?
2. **Embedding model:** `text-embedding-3-small` (1536 dim) vs smaller model for cost? How much embedding do we need?
3. **Memory consolidation frequency:** How often should we merge/prune memories? Daily? Weekly?
4. **Per-user vs per-company knowledge:** Some facts are company-wide (pricing, services), others are user-specific (writing style). How do we handle team members who write differently?
5. **Multi-user drafting:** If multiple team members use drafting, do they share a knowledge base but have separate writing profiles?
