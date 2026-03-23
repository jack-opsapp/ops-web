# Import Review Wizard Redesign

> Spec date: 2026-03-23
> Status: Approved
> Scope: Redesign the email pipeline import wizard's review phase (Step 4) into a guided sequential flow with keyboard-driven carousel navigation, company contact consolidation, and improved AI terminal detection.

---

## Problem Statement

The current import wizard Step 4 (Review) presents all scanned leads in a single scrollable list partitioned into three sections (flagged, terminal, active). With 92 leads from the initial scan, this is overwhelming. Three specific failures:

1. **Poor won/lost detection.** Only 5 of 92 leads received terminal flags. Many completed projects remain classified as active because the AI lacks time-based heuristics and trade-specific completion signals.
2. **No company consolidation.** Multiple contacts from the same company (e.g., 4 people at WJ Construction) appear as separate leads instead of being grouped under one client with sub-contacts.
3. **All-at-once presentation.** Users must mentally sort 92 items across different decision types simultaneously — noise filtering, terminal classification, contact grouping, and stage confirmation.

## Solution

Replace the monolithic review list with a **4-sub-step guided flow** inside Step 4, each presenting a focused decision type. Sub-steps use a **vertical card carousel** with keyboard navigation for fast power-user triage.

---

## Overall Wizard Structure

### Vertical Stepper Rail

Replace the current 5-dot horizontal progress bar with a vertical stepper rail on the left side of the wizard modal. The right side is the content area.

```
┌──────────────────┐ ┌──────────────────────────────┐
│ ✓ CONNECT        │ │                              │
│ ✓ SCAN           │ │    [ACTIVE STEP CONTENT]     │
│ ✓ SOURCES        │ │                              │
│ ◉ REVIEW         │ │                              │
│   ◉ filter       │ │                              │
│   ○ consolidate  │ │                              │
│   ○ triage       │ │                              │
│   ○ confirm      │ │                              │
│ ○ ACTIVATE       │ │                              │
└──────────────────┘ └──────────────────────────────┘
```

- Completed steps: checkmark icon, muted text
- Current step: accent highlight (`#597794`), filled circle
- Future steps: dimmed circle, dimmed text
- Sub-steps only visible when user is in the REVIEW phase
- Sub-step labels: `filter`, `consolidate`, `triage`, `confirm`
- Rail width: fixed ~160px, content area fills remaining space

### Step labels
- CONNECT (step 1)
- SCAN (step 2)
- SOURCES (step 3)
- REVIEW (step 4, contains 4 sub-steps)
- ACTIVATE (step 5)

---

## Card Carousel Component

Shared UI primitive used by sub-steps 1, 2, and 3. A vertically-stacked card deck with one card in focus.

### Layout

```
┌─────────────────────────────────────────────┐
│  [STEP TITLE]              [N of TOTAL]     │
│                                             │
│  ┌─ previous card (compressed) ──────────┐  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌═══════════════════════════════════════┐   │
│  ║                                      ║   │
│  ║         FOCUSED CARD                 ║   │
│  ║         (full height, interactive)   ║   │
│  ║                                      ║   │
│  ║  [action buttons / keyboard hints]   ║   │
│  ╚═══════════════════════════════════════╝   │
│                                             │
│  ┌─ next card (compressed) ──────────────┐  │
│  └───────────────────────────────────────┘  │
│                                             │
│  [keyboard hint bar]   [SKIP TO NEXT STEP →]│
└─────────────────────────────────────────────┘
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↓` or `Enter` | Accept current selection, advance to next card |
| `↑` | Go back to previous card |
| `1`, `2`, `3` | Select action by number (context-dependent) |
| `Backspace` | Discard current card |

### Behavior

- Previous card shows above in compressed form (name + chosen action badge)
- Next card peeks below in compressed form (name only)
- Smooth vertical slide transition on navigate (200ms, `[0.22, 1, 0.36, 1]` easing)
- Progress counter "N of TOTAL" in top right
- "Skip to next step" button always visible — lets user accept all AI defaults for remaining cards
- Cards animate in/out with transform+opacity only (no layout animation)

### Expandable Email Thread

Available on every card across all sub-steps. Toggle via click or keyboard shortcut (`E` key).

**Data source:** The scan stores up to 6 email excerpts per lead (`emailExcerpts` array) with body content truncated to 4,000 characters each. This is sufficient for review — most trade emails are short. The excerpts are already stripped of quoted reply chains during the scan phase.

**If the user needs full thread content:** Add a "View full thread" link that opens the thread in Gmail (construct URL from `threadId`: `https://mail.google.com/mail/u/0/#inbox/{threadId}`). This avoids the need for a new API endpoint to fetch full bodies at review time.

- Email excerpt bodies displayed in full (up to 4,000 chars each, up to 6 excerpts)
- Quoted reply chains already stripped during scan (existing `stripQuotedContent` function)
- Most recent emails first
- Direction indicators: `←` inbound, `→` outbound
- Sender name + relative date per email
- "Show older messages (N more)" button when >3 excerpts
- "View full thread in Gmail →" link at bottom of expanded thread

---

## Sub-step 1: Filter Flagged Items

**Purpose:** Remove noise before any pipeline decisions. Binary choice only.

**Appears only if:** The scan produced leads with `needsReview === true`. If none, skip to sub-step 2.

### Card Content

```
┌═══════════════════════════════════════┐
║  ⚠ [FLAG REASON]                     ║
║  "[flag description]"                ║
║                                      ║
║  Client Name                         ║
║  email@example.com · N emails        ║
║  "Last email subject"                ║
║  Last: [relative date]               ║
║                                      ║
║  [▼ Show thread]                     ║
║                                      ║
║  [1: IMPORT]  [2: DISCARD]           ║
╚═══════════════════════════════════════╝
```

### Flag reasons and AI defaults

| Flag | Description | AI Default |
|------|-------------|------------|
| `legal` | Settlement, dispute, or lawyer correspondence | Discard |
| `job_seeker` | Someone looking for work or employment | Discard |
| `collections` | Invoice dispute or overdue payment follow-up | Import |
| `platform_bid` | Bid invitation from Procore, BuilderTrend, etc. | Import |
| `warranty` | Past client reporting an issue after completion | Import |
| `ambiguous` | Relationship direction is unclear | Import |

### Keyboard

| Key | Action |
|-----|--------|
| `1` | Import |
| `2` | Discard |
| `Backspace` | Discard |
| `Enter` / `↓` | Accept AI default, next card |

### Output

- Imported leads proceed to sub-step 2 (consolidation) or sub-step 3 (triage)
- Discarded leads are removed from the pipeline entirely

---

## Sub-step 2: Consolidate Contacts

**Purpose:** Group people from the same company under one client. Distinguish multiple leads per client.

**Appears only if:** The scan detected leads that share a non-public email domain or company name. If none need consolidation, skip to sub-step 3.

### Detection Logic

Group leads for consolidation when:
- Two or more leads share the same email domain (excluding public domains: gmail.com, yahoo.com, hotmail.com, outlook.com, icloud.com, shaw.ca, telus.net, etc.)
- Two or more leads have the same `client.name` (case-insensitive)

### Card Content

```
┌═══════════════════════════════════════┐
║  WJ CONSTRUCTION                     ║
║  4 contacts from wjconstruction.ca   ║
║                                      ║
║  ┌─ Contacts ──────────────────────┐ ║
║  │  ● Mich    mich@wjconstruct..  │ ║
║  │  ● Eric    eric@wjconstruct..  │ ║
║  │  ● Leonard leonard@wjconstr..  │ ║
║  │  ● Gilbert gilbert@wjconstr..  │ ║
║  └─────────────────────────────────┘ ║
║                                      ║
║  ┌─ Leads ─────────────────────────┐ ║
║  │  1. "Exterior Railings (SEL)"  │ ║
║  │     via Eric · 3 emails         │ ║
║  │     [edit title]                │ ║
║  │                                 │ ║
║  │  2. "Bid - 2060 Weiler Ave"    │ ║
║  │     via Leonard · 5 emails      │ ║
║  │     [edit title]                │ ║
║  └─────────────────────────────────┘ ║
║                                      ║
║  [▼ Show threads]                    ║
║                                      ║
║  [CONFIRM]  [MERGE INTO 1 LEAD]     ║
╚═══════════════════════════════════════╝
```

### Company Name

- Auto-detected from email domain (strip TLD, title-case) or from AI-extracted company name
- Editable — user can correct "Wjconstruction" to "WJ Construction"

### Lead Titles

- **Blank by default** for single-lead clients
- **Required** when a client has multiple leads — auto-populated from address if found in emails, otherwise blank for user to fill in
- Editable inline on the card
- Maps to `opportunities.title` in the database

### Actions

| Action | Result |
|--------|--------|
| Confirm | 1 client, N sub-contacts, M separate leads/opportunities |
| Merge into 1 lead | 1 client, N sub-contacts, 1 combined lead |
| Remove contact (per contact X button) | Eject contact from group, becomes standalone lead again |

### Keyboard

| Key | Action |
|-----|--------|
| `1` | Confirm (keep separate leads) |
| `2` | Merge into 1 lead |
| `Backspace` | Discard entire group |
| `Enter` / `↓` | Accept default (Confirm), next group |
| `↑` | Previous group |

Sub-step 2 uses the same number-key pattern as sub-steps 1 and 3 for muscle-memory consistency. The more complex interactions (editing company name, editing lead titles, removing contacts) require mouse/touch — keyboard shortcuts handle only the primary group-level decisions.

### Output

- Confirmed groups pass to sub-step 3 as structured client+leads bundles
- Contacts within a group become sub-contacts of the client entity
- Leads within a group become separate opportunities linked to the same client

---

## Sub-step 3: Triage Completed Work

**Purpose:** Every remaining lead gets sorted: Won, Lost, Still Active, or Discard.

**Shows:** All leads that passed sub-steps 1 and 2. For consolidated clients with multiple leads, each lead appears as its own card (with the client name + title as label).

### Card Content

```
┌═══════════════════════════════════════┐
║  Gordon Van Den Broek                ║
║  gvdbroek@telus.net · 8 emails      ║
║  Last: today · $1,650               ║
║                                      ║
║  [▼ Show thread]                     ║
║                                      ║
║  [1: WON]  [2: LOST]  [3: ACTIVE]   ║
╚═══════════════════════════════════════╝
```

For multi-lead clients:

```
┌═══════════════════════════════════════┐
║  WJ Construction — Royal Bay         ║
║  via Eric · 3 emails                 ║
║  Last: 5d ago                        ║
║  ...                                 ║
║  [1: WON]  [2: LOST]  [3: ACTIVE]   ║
╚═══════════════════════════════════════╝
```

### AI Pre-selection Logic

Current behavior: only flags `likely_won` / `likely_lost` based on email content signals. This misses most completed projects.

**Improved heuristics (additive, not replacing content analysis):**

| Signal | Pre-selection | Confidence |
|--------|--------------|------------|
| `terminalFlag === 'likely_won'` | Won | High |
| `terminalFlag === 'likely_lost'` | Lost | High |
| Last activity >30 days ago AND last outbound was a quote/price | Won | Medium |
| Last activity >30 days ago AND last message was inbound asking for quote, no outbound reply | Lost | Medium |
| Last activity >21 days ago AND thread ended with outbound booking/scheduling language | Won | Medium |
| All other leads | Active | Default |

These heuristics run client-side on the existing scan data (dates, outbound count, last message direction are already available). No additional API calls needed.

### Keyboard

| Key | Action |
|-----|--------|
| `1` | Won |
| `2` | Lost |
| `3` | Active |
| `Backspace` | Discard |
| `Enter` / `↓` | Accept AI default, next card |
| `↑` | Previous card |

### Output

- Won leads → imported with `stage: "won"`, `win_probability: 100`, `actual_close_date` set to last email date (requires `actualCloseDate` field addition to `ImportPayload` — see API Changes below)
- Lost leads → imported with `stage: "lost"`, `win_probability: 0`
- Active leads → proceed to sub-step 4 for stage confirmation
- Discarded leads → removed entirely

---

## Sub-step 4: Confirm Pipeline

**Purpose:** Final review of active leads before import. Stage editing. Full email thread access.

**UI:** Scrollable list (NOT carousel) — grouped by AI-assigned stage with collapsible sections.

### Layout

```
┌─────────────────────────────────────────────┐
│  CONFIRM PIPELINE                           │
│                                             │
│  ┌─ QUALIFYING (4) ──────────────────────┐  │
│  │  Sandra Arts          ▾ Qualifying ▼  │  │
│  │  Barry Carlson        ▾ Qualifying ▼  │  │
│  │  WJ Construction — Royal Bay      ▼   │  │
│  │                       ▾ Qualifying    │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─ QUOTED (12) ─────────────────────────┐  │
│  │  Gordon Van Den Broek ▾ Quoted    ▼   │  │
│  │  Amir Afshar          ▾ Quoted    ▼   │  │
│  │  ...                                  │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ─── Summary ─────────────────────────────  │
│  42 active · 18 won · 3 lost · 11 discard  │
│                                             │
│  [← BACK]            [IMPORT 63 LEADS]      │
└─────────────────────────────────────────────┘
```

### Per-lead row

- Client name (+ title if multi-lead)
- Stage dropdown — **all stages including won/lost**: new_lead, qualifying, quoting, quoted, follow_up, negotiation, won, lost. User may realize during final review that a lead should be terminal.
- **▼ chevron** — toggles email thread

### Expanded email thread

- Email excerpt bodies displayed in full (up to 4,000 chars each, up to 6 excerpts per lead)
- Quoted reply chains already stripped during scan
- Most recent first
- `←` inbound / `→` outbound direction indicator
- Sender name + relative date
- "Show older messages (N more)" for threads with >3 excerpts
- "View full thread in Gmail →" link at bottom
- Thread container scrolls independently if tall

### Summary bar

Persistent at bottom of scroll area (sticky). Shows:
- Count of active leads (going into pipeline)
- Count of won leads
- Count of lost leads
- Count of discarded leads
- Total = all four added together

Import button count = active + won + lost (everything except discarded).

### Actions

- **Back** — return to sub-step 3 (triage)
- **Import N Leads** — triggers the import API, advances to import progress screen, then step 5 (Activate)

---

## Data Model

### Opportunity title field

- `opportunities.title` — already exists in the schema (type: `text`, nullable)
- **Blank by default** for single-lead clients
- **Populated** only when a client has multiple leads, as a distinguishing label
- Source: address extracted from email, or user-entered
- Not forced, not AI-generated

### No new database tables or columns required

The existing schema supports all changes:
- `opportunities.title` — lead title/subtitle
- `opportunities.stage` — triage result
- `clients` + `sub_clients` — company consolidation
- `opportunity_email_threads` — thread linkage
- `gmail_scan_jobs.result` — scan data already contains all needed fields

### Client creation from consolidation

When a group is confirmed in sub-step 2:
- One `clients` record created with the company name
- Individual contacts become `sub_clients` records linked to the client
- Each lead becomes a separate `opportunities` record linked to the same client via `client_id`

---

## Type Changes

### ConsolidationGroup (new type in `email-import.ts`)

```typescript
export interface ConsolidationGroup {
  /** Auto-generated group ID (domain or normalized company name) */
  id: string;
  /** Display name for the company — editable by user */
  companyName: string;
  /** Shared email domain (null if grouped by name match) */
  domain: string | null;
  /** All contacts in this group, each referencing their original lead */
  contacts: Array<{
    leadId: string;
    name: string;
    email: string;
    phone: string | null;
  }>;
  /** Distinct leads/projects within this group */
  leads: Array<{
    leadId: string;
    /** Editable title — blank by default, user fills in to distinguish */
    title: string;
    /** Which contact is the primary for this lead */
    primaryContactEmail: string;
    correspondenceCount: number;
    lastMessageDate: string;
  }>;
  /** User's decision: 'confirm' keeps separate leads, 'merge' combines into one */
  decision: 'confirm' | 'merge' | null;
}
```

### ImportPayload additions (modify existing type in `email-import.ts`)

Add the following fields to the per-lead object in `ImportPayload.leads`:

```typescript
leads: Array<{
  // ... existing fields ...
  /** Opportunity title — only set when client has multiple leads */
  title: string | null;
  /** For won/lost leads: close date derived from last email activity */
  actualCloseDate: string | null;
}>;
```

### Triage decision tracking

The `triageDecisions` map is ephemeral client-side state (not persisted to a type). It maps `leadId → 'won' | 'lost' | 'active' | 'discard'` and is used to partition leads into the correct buckets before building the `ImportPayload`.

The `AnalyzedLead.enabled` field is **repurposed**: set to `false` for any lead discarded in sub-step 1 (filter) OR sub-step 3 (triage). The `triageDecisions` map is the canonical source during the review flow; `enabled` is reconciled to match before building the import payload.

---

## API Changes

### Import route (`/api/integrations/email/import/route.ts`)

1. **Accept `title` field per lead.** When creating the opportunity, use `lead.title` if provided instead of falling back to `lead.description`.

2. **Accept `actualCloseDate` field per lead.** When a lead has `stage: "won"` or `stage: "lost"`, use the provided `actualCloseDate` (derived from `lastMessageDate`) instead of `new Date()`.

Current code (line ~372):
```typescript
actualCloseDate: isTerminal ? new Date() : null
```

Change to:
```typescript
actualCloseDate: isTerminal ? (lead.actualCloseDate ? new Date(lead.actualCloseDate) : new Date()) : null
```

### ResolveDuplicatesStep disposition

The existing `ResolveDuplicatesStep` (`wizard-steps/resolve-duplicates-step.tsx`) is **replaced** by the Consolidate Contacts sub-step (sub-step 2). Its client-matching functionality (exact email match, domain match, name match) is absorbed into the consolidation detection logic. The `verify-leads` API endpoint it calls can be reused by sub-step 2 for server-side duplicate checking against existing clients in the database.

---

## Public Domain List

The consolidation step's domain grouping must use the existing `PUBLIC_EMAIL_DOMAINS` constant from `@/lib/types/pipeline` rather than maintaining a parallel list. This ensures consistency with the scan phase's domain filtering.

---

## i18n

All user-facing strings must be added to the dictionary system:
- New namespace: `src/i18n/dictionaries/{en,es}/import-wizard.json`
- Covers: step labels, sub-step labels, button text, flag descriptions, keyboard hints, empty states, summary labels
- Access via `useDictionary("import-wizard")`

---

## AI Classifier Changes

### Improved terminal detection prompt

Add to the thread classification system prompt:

```
TERMINAL DETECTION — apply these rules IN ADDITION to content signals:
- If the thread's last activity was >30 days ago AND the last outbound message
  contained pricing/quote language → flag as "likely_won" (most quoted jobs that
  go silent were accepted and completed)
- If the thread's last activity was >30 days ago AND the last message was inbound
  with no outbound reply → flag as "likely_lost" (dropped lead)
- If the thread's last activity was >21 days ago AND outbound messages contained
  scheduling/booking language ("booked for", "scheduled", "see you on") → flag
  as "likely_won"
- Trade industry context: silence after a quote is more often acceptance than
  rejection. Err toward "likely_won" for old quoted threads.
```

### Company domain grouping

During scan result processing (client-side, not in the API):
- Extract domain from each lead's `client.email`
- Filter out public email providers
- Group leads sharing a non-public domain
- Pre-build consolidation groups for sub-step 2

---

## Component Architecture

### New components

| Component | File | Purpose |
|-----------|------|---------|
| `WizardStepperRail` | `wizard-steps/stepper-rail.tsx` | Vertical step navigation with sub-step support |
| `CardCarousel` | `wizard-steps/card-carousel.tsx` | Reusable vertical carousel with keyboard nav |
| `FilterFlaggedStep` | `wizard-steps/filter-flagged-step.tsx` | Sub-step 1: flag triage |
| `ConsolidateContactsStep` | `wizard-steps/consolidate-contacts-step.tsx` | Sub-step 2: company grouping |
| `TriageStep` | `wizard-steps/triage-step.tsx` | Sub-step 3: won/lost/active sort |
| `ConfirmPipelineStep` | `wizard-steps/confirm-pipeline-step.tsx` | Sub-step 4: final review + stage edit |
| `EmailThreadView` | `wizard-steps/email-thread-view.tsx` | Shared full email thread renderer |

### Modified components

| Component | File | Changes |
|-----------|------|---------|
| `ImportPipelineWizard` | `import-pipeline-wizard.tsx` | Replace horizontal dots with stepper rail, manage 4 sub-steps within step 4 |

### Removed components

| Component | File | Reason |
|-----------|------|--------|
| `ReviewImportStep` | `wizard-steps/review-import-step.tsx` | Replaced by 4 sub-step components |
| `ResolveDuplicatesStep` | `wizard-steps/resolve-duplicates-step.tsx` | Replaced by ConsolidateContactsStep (sub-step 2). Server-side duplicate checking reuses the `verify-leads` endpoint. |

### Shared state

The wizard parent (`ImportPipelineWizard`) manages:
- `leads: AnalyzedLead[]` — master lead list, mutated by each sub-step
- `currentSubStep: 1 | 2 | 3 | 4` — which review sub-step is active
- `consolidationGroups: ConsolidationGroup[]` — detected company groups from sub-step 2
- `triageDecisions: Map<string, 'won' | 'lost' | 'active' | 'discard'>` — triage results from sub-step 3

Each sub-step receives the relevant slice of state and reports decisions back up.

---

## Keyboard Accessibility

All keyboard shortcuts work alongside mouse/touch interaction. The carousel traps focus when active. Escape closes the wizard (with confirmation if mid-review).

Focus management:
- On sub-step enter: focus the first carousel card
- On card advance: focus moves to next card
- On sub-step complete: focus moves to next sub-step's first element
- On thread expand: focus stays on the card, thread scrolls into view

---

## Animation

All animations follow OPS design system standards:
- `transform` and `opacity` only — no layout animation
- 200ms transitions with `[0.22, 1, 0.36, 1]` easing
- Card slide: vertical `translateY` with opacity fade
- Section collapse: opacity fade only (no height animation — use `display` toggle or conditional rendering)
- Respect `prefers-reduced-motion`: skip all transitions, show content immediately

---

## Edge Cases

| Case | Handling |
|------|----------|
| 0 flagged leads | Skip sub-step 1, start at sub-step 2 |
| 0 consolidation groups | Skip sub-step 2, start at sub-step 3 |
| All leads discarded | Show empty state at sub-step 4 with "No leads to import" and back button |
| Back: sub-step 2 → 1 | Filter decisions preserved. Previously-discarded leads remain discarded but can be toggled back to Import by revisiting their card. |
| Back: sub-step 3 → 2 | Consolidation state preserved. Triage decisions cleared for any leads affected by re-grouping. |
| Back: sub-step 4 → 3 | Triage decisions preserved. Carousel resumes at the first card (not where user left off — positions are not tracked). |
| Very large scan (200+ leads) | Carousel always virtualizes — only render focused card + 2 neighbors. AnimatePresence tracks 3 elements max. |
| Wizard closed mid-review | Sub-step decisions serialized to `connection.sync_filters.reviewState` as JSON (lead IDs + decisions only, not full lead data — keeps payload small). Restored on reopen. |
| Browser refresh during review | Same as wizard close — `reviewState` restored from connection. If `reviewState` is stale (>24 hours), discard it and restart from sub-step 1. |
| "Skip to next step" in sub-step 2 | AI default for all consolidation groups is "Confirm" (keep grouping as detected). Partial edits (renamed company, edited titles) are preserved. |
