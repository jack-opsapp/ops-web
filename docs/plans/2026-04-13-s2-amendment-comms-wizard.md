# Sprint S2 — Amendment: Communications Configuration Wizard

**Date:** 2026-04-13
**Runs after:** Sprint S2 base implementation
**Purpose:** Give users granular control over every autonomous email type via a configuration wizard that appears at the right moment in the autonomy ladder.

## Mission
Users should never be surprised by autonomous emails. Before any scheduling or client
communication emails go out automatically, the user must walk through a configuration
wizard that lets them choose which email types to enable, when they fire, and how much
granularity they want. This amendment runs AFTER S2 completes.

## Critical Standards
We do not ever shelf things for later development, or for the production pass. We are building for
production. We do not take the easier route to save time. We do things right the first time,
regardless of the cost. We do not settle for less than perfection. No exceptions. Always make use
of skills and plugins available.

Read CLAUDE.md at C:\OPS\CLAUDE.md and C:\OPS\ops-web\CLAUDE.md.
Read the design system at: .interface-design/system.md.

## Context

The S2 sprint added 4 new client communication types:
- send_appointment_confirmation
- send_day_before_reminder
- send_subcontractor_coordination
- process_reschedule_request

Combined with prior sprints, the full outgoing email picture is:
- AI drafts (compose integration) — E1-E5
- Status update emails — P3
- Invoice cover emails — I1
- Payment reminders (4 tiers) — I2
- Appointment confirmations — S2 (currently fires on task creation — TOO AGGRESSIVE)
- Day-before reminders — S2 (currently daily cron, 1 day ahead — not configurable)
- Reschedule request replies — S2
- Subcontractor coordination — S2

This is a LOT of email. Without user configuration, a company like Canpro could receive
multiple confirmations per task (as schedules shuffle), daily reminders they don't want,
and status emails when they prefer to call clients directly. Meanwhile, high-volume
contractors may want everything fully automated. The wizard must handle both extremes.

## Core Issues to Fix

### Issue A — "Confirmed date/time" needs an explicit state

In S2 as written, sendAppointmentConfirmation fires from executeCreateTask. This means
every task creation sends a confirmation email — including during schedule shuffling.
But some users DO want automatic confirmation sending for every booking. The fix is to
introduce a "schedule confirmed" state that users can control, and let the wizard
configure how it's set and what happens when it is.

**Two ways tasks can become "confirmed" (user picks one via wizard):**

**Approach A: Explicit confirm action**
- Every task has a "Confirm Schedule" button
- Clicking sets `schedule_confirmed_at` timestamp AND fires the configured action
- User can "un-confirm" if the task needs to shuffle again

**Approach B: Automatic confirm after grace period**
- Tasks auto-confirm after being stable (unchanged) for X hours
- Default: 4 hours, configurable 0-24 hours
- If user drags a task 5 times in one afternoon, the grace period resets each time
- Once stable for X hours, task auto-confirms and fires the configured action
- Best for users who shuffle during planning but want automation once set

**Five autonomy levels the user can pick (wizard Step 3):**
1. OFF — no confirmations ever
2. MANUAL ONLY — "Send Confirmation" button, no auto behavior
3. DRAFT ON CONFIRM — when task becomes confirmed, draft goes to approval queue
4. AUTO-SEND ON CONFIRM — when task becomes confirmed, drafts and auto-sends after delay
5. FULL AUTO — draft + auto-send immediately when task gets a date (no confirm step)

Levels 4 and 5 have a cancellable send delay (5-60 min). Level 5 is gated behind
writing profile confidence ≥0.85 and ≥50 prior confirmations at level 3 or 4.

**Implementation:**
- Add migration: `ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS schedule_confirmed_at TIMESTAMPTZ`
- Remove the fire-and-forget call from executeCreateTask that calls sendAppointmentConfirmation
- Replace with a new function `onTaskScheduleConfirmed(companyId, userId, taskId)` that
  fires the configured action based on `client_comms_settings.appointment_confirmation.level`
- New API route: `POST /api/agent/confirm-schedule` with { taskId } to explicitly confirm
- New API route: `POST /api/agent/unconfirm-schedule` with { taskId } to revert
- Background job or trigger to detect auto-confirm (tasks with start_date set, unchanged
  for settings.auto_confirm_after_hours, not yet confirmed)
- Add "Confirm Schedule" button to task detail view (shows different states: Tentative,
  Confirmed, Auto-confirms in X hours)

### Issue B — Appointment reminder timing is hardcoded

Current: cron at 2pm UTC fires reminders for tasks scheduled tomorrow. User can't change
the "1 day ahead" timing. Canpro wants "2 days before."

**Fix:**
- Settings: `client_comms_settings.appointment_reminder.lead_days: number` (default 1, range 0-7)
- Rename cron from `/api/cron/day-before-reminders` to `/api/cron/appointment-reminders`
- Update vercel.json cron path
- For each company, read `settings.appointment_reminder.lead_days`
- Query tasks where `start_date::date = (now + lead_days days)::date`
- Also read `settings.appointment_reminder.send_hour_local` (default 14 = 2pm in user's tz)

### Issue C — Configuration Wizard (the main feature)

Build a wizard that appears when the user crosses certain autonomy milestones, walking
them through configuration BEFORE any autonomous emails go out.

## Tasks

### AMEND.1 — Fix the appointment confirmation trigger (Issue A)

1. Migration: add `schedule_confirmed_at TIMESTAMPTZ` to project_tasks (IF NOT EXISTS)
2. Migration: add `schedule_confirmed_by UUID` to project_tasks (IF NOT EXISTS)
3. Remove the automatic fire-and-forget call from executeCreateTask in
   approval-queue-service.ts that invokes sendAppointmentConfirmation
4. Create new service method: `ClientSchedulingCommsService.onTaskScheduleConfirmed(
   companyId, userId, taskId)` which:
   - Reads company's `client_comms_settings.appointment_confirmation.level`
   - If level is 'off' or 'manual', does nothing
   - If 'draft_on_confirm', calls sendAppointmentConfirmation (existing flow — goes to queue)
   - If 'auto_send_on_confirm', calls sendAppointmentConfirmation with auto_send flag set
   - If 'full_auto', same as auto_send_on_confirm (the difference is WHEN this is called)
5. Create new API routes (both admin/owner gated):
   - `POST /api/agent/confirm-schedule` { taskId }
     - Sets schedule_confirmed_at = now() and schedule_confirmed_by = user.id
     - Calls onTaskScheduleConfirmed
     - Returns { confirmed: true, actionTaken: string }
   - `POST /api/agent/unconfirm-schedule` { taskId }
     - Clears schedule_confirmed_at
     - If the task's reschedule-changed policy says "draft schedule changed email",
       proposes one via the queue
6. Add "Confirm Schedule" button to task detail view:
   - Only renders if phase_c enabled AND level is not 'off'
   - Shows state: "Tentative" / "Confirmed (sent)" / "Auto-confirms in X hours"
   - Calls the confirm API
7. For 'full_auto' level: add a hook in executeCreateTask (or wherever tasks get dates set)
   that fires onTaskScheduleConfirmed immediately. Only fires if level === 'full_auto'.
8. For automatic confirm approach: add an HOURLY cron
   `/api/cron/auto-confirm-schedules/route.ts` that finds tasks where:
   (Note: originally speced as daily; hourly gives <=1h grace-period
   precision instead of daily's 4h–28h window for a 4h grace period.)
   - start_date IS NOT NULL
   - schedule_confirmed_at IS NULL
   - updated_at < (now() - settings.auto_confirm_after_hours)
   - company settings level is 'draft_on_confirm', 'auto_send_on_confirm', or 'full_auto'
     AND confirmation_mode is 'automatic'
   For each matching task, calls onTaskScheduleConfirmed.

### AMEND.2 — Fix the reminder timing (Issue B)

1. Settings schema addition:
   ```typescript
   client_comms_settings.appointment_reminder: {
     enabled: boolean,          // default true
     lead_days: number,          // default 1, range 0-7
     send_hour_local: number,    // default 14 (2pm), range 6-20
     include_weather: boolean,   // default true
   }
   ```
2. Rename `/api/cron/day-before-reminders/route.ts` to
   `/api/cron/appointment-reminders/route.ts`
3. Update vercel.json cron path
4. Update cron logic:
   - For each company with phase_c enabled AND appointment_reminder.enabled:
     - Read lead_days (default 1)
     - Compute target_date = today + lead_days days
     - Query project_tasks WHERE start_date::date = target_date AND status in correct values
     - For each task, call sendAppointmentReminder (service method rename from sendDayBeforeReminder)
5. Update settings UI: numeric slider 0-7 days, preview text showing example
   ("Reminders will send 2 days before scheduled date")

### AMEND.3 — Communications Configuration Wizard

**New component:** src/components/agent/comms-config-wizard.tsx
**New page:** src/app/(dashboard)/agent/comms-config/page.tsx

A multi-step wizard with professional, tactical styling (following the design system).

**Trigger conditions:**
- User's writing profile confidence crosses 0.75 for the first time (Level 3 milestone)
- OR user explicitly opens from settings ("Configure Communications" button)
- OR user first enables phase_c and has not yet configured (wizard_version mismatch)

**Persistence:**
- Store `comms_wizard_completed_at` timestamp in `client_comms_settings`
- Store `comms_wizard_version` (integer, current = 1) — increment when wizard changes
- If completed AND version matches, don't auto-show. User can always re-run from settings.

**Wizard structure (10 steps):**

---

**Step 1 — Welcome + Overview**
- Title: "YOUR AI COMMUNICATIONS"
- Brief: "Your writing profile is ready. The OPS agent can send these emails on your behalf,
  with as much or as little autonomy as you want. Let's set it up."
- Card grid showing all 6 email types with icons:
  - Status updates (CalendarDays)
  - Appointment confirmations (CalendarCheck)
  - Appointment reminders (Bell)
  - Payment reminders (DollarSign)
  - Invoice cover emails (FileText)
  - Reschedule request responses (Repeat)
  - Subcontractor coordination (Users)
- Estimated time: "2 minutes"
- CTA: "Begin Setup"

---

**Step 2 — Status Update Emails (P3)**
- Heading: "STATUS UPDATES"
- Description: "Send clients a summary of project progress on a schedule."
- Options (radio cards):
  - Off (default)
  - Weekly (which day? dropdown)
  - Biweekly
  - Monthly
  - Only when project stage changes
- Autonomy sub-option (if not Off):
  - Draft to approval queue (default)
  - Auto-send after delay
- Preview: rendered example status email
- "Skip" / "Next"

---

**Step 3 — Appointment Confirmations (S2) — REVISED**

Heading: "APPOINTMENT CONFIRMATIONS"
Description: "When you schedule a crew visit, decide how confirmations should be sent to the client."

**Primary autonomy selector (5 options as selectable cards):**

```
○ OFF
  "Never send confirmation emails. I'll handle client communication outside OPS."

○ MANUAL ONLY
  "I'll click 'Send Confirmation' when I'm ready. Best if you shuffle schedules
  frequently while planning."

○ DRAFT ON CONFIRM   [recommended]
  "When I mark a task as 'Schedule Confirmed', draft a confirmation email to the
  approval queue for my review. I approve and send."

○ AUTO-SEND ON CONFIRM
  "When I mark a task as 'Schedule Confirmed', draft and auto-send the email after
  a short delay. I can cancel if I need to."

○ FULL AUTO   [advanced]
  "Draft and auto-send the moment a task gets a scheduled date. No manual confirmation
  step. Best for high-volume consistent work."
  [Locked if: writing profile confidence < 0.85 OR prior confirmations < 50]
```

**If DRAFT ON CONFIRM or AUTO-SEND ON CONFIRM selected, show sub-question:**

```
"How should tasks become 'confirmed'?"

○ Explicit: I'll click a Confirm button on each task
○ Automatic: Tasks auto-confirm after being stable for [X] hours
  (numeric input, default 4, range 1-24)
```

**If AUTO-SEND ON CONFIRM or FULL AUTO, show sub-question:**

```
"Delay before sending (how long can you cancel the draft?)"

Slider: 0, 5, 15, 30, 60 minutes (default 15)
```

**Separate question (always shown if level is not Off):**

```
"When I reschedule an already-confirmed task:"

○ Do nothing (I'll handle it)
○ Notify me in-app only
○ Draft a 'schedule changed' email to the approval queue (default)
○ Auto-send a 'schedule changed' email
```

**Preview:** show an example confirmation email with the user's writing profile applied

**Warning banner (only if FULL AUTO selected):**
"This sends emails automatically without your review. You can always cancel within
the delay window. We recommend trying DRAFT ON CONFIRM first for a few weeks."

---

**Step 4 — Appointment Reminders (S2)**
- Heading: "VISIT REMINDERS"
- Description: "Remind clients before their scheduled visit."
- Enable toggle (default ON)
- Lead time slider: 0 (day-of), 1, 2, 3, 4, 5, 6, 7 days (default 1)
- Time of day: dropdown (6am, 9am, 12pm, 2pm, 4pm, 6pm) — default 2pm
- Include weather warnings: toggle (default ON)
- Autonomy sub-option:
  - Draft to approval queue (default)
  - Auto-send after delay
- Preview: example reminder with weather note

---

**Step 5 — Payment Reminders (I2)**
- Heading: "PAYMENT REMINDERS"
- Description: "Follow up on overdue invoices automatically."
- Enable toggle (default ON)
- Escalation preset:
  - Standard (7/14/30/45 days) — default
  - Gentle (14/30/45/60 days)
  - Aggressive (3/7/14/30 days)
  - Custom (4 numeric inputs)
- Max reminders per invoice: 1-4 slider (default 4)
- Show 4 escalation previews (friendly → firm → final → collections)
- Autonomy sub-option:
  - Draft to approval queue (default)
  - Auto-send after delay (with warning: "Final notice emails are serious — review first")

---

**Step 6 — Invoice Cover Emails (I1)**
- Heading: "INVOICE COVER EMAILS"
- Description: "When you create an invoice, the agent can draft a cover email to the client."
- Enable toggle (default ON)
- When to propose:
  - Always when invoice is created
  - Only for invoices over $X threshold (numeric input, default $0)
- Autonomy:
  - Draft to queue (default — financial documents should always be reviewed)
  - Auto-send after delay (with strong warning)

---

**Step 7 — Reschedule Request Processing (S2)**
- Heading: "RESCHEDULE REQUESTS"
- Description: "When a client emails asking to reschedule, the agent can detect it, find
  alternatives, and draft a response."
- Enable toggle (default ON)
- Behavior:
  - Detect and notify only (agent flags the request, you handle response)
  - Detect and draft response (default)
- Confidence threshold slider (0.5-0.9, default 0.6) with explanation: "Higher = fewer
  false positives but might miss edge cases"
- Autonomy:
  - Draft to queue (recommended — reschedule replies need context)
  - Auto-send after delay (not recommended)
- Warning: "AI detection isn't perfect. The agent will propose responses through the
  approval queue — you always review before sending (unless auto-send is enabled)."

---

**Step 8 — Subcontractor Coordination (S2)**
- Heading: "SUBCONTRACTOR COORDINATION"
- Description: "Draft coordination emails to subcontractors with project details,
  schedules, and access info."
- Enable toggle (default OFF — this is an on-demand feature)
- When enabled:
  - Manual trigger only (button in project view) — default
  - Auto-suggest when project stage transitions to a phase that needs a subtrade

---

**Step 9 — Default Per-Category Autonomy Overrides**
- Heading: "EMAIL CATEGORIES"
- Description: "You can set different trust levels per relationship type. These override
  the choices above for specific email categories."
- Reuse the EmailCategoryAutonomy component from E5.3
- Categories: client_new_inquiry, client_quoting, client_active_project, client_followup,
  vendor_ordering, vendor_inquiry, subtrade_coordination, warranty_claim, internal, general
- Each can be set to: Off / Draft on request / Auto-draft / Auto-send
- Warning shown when selecting Auto-send on any category

---

**Step 10 — Summary + Finish**
- Heading: "YOU'RE SET"
- Checkmark summary of all choices made:
  - Status updates: [setting]
  - Appointment confirmations: [level] with [confirm mode]
  - Appointment reminders: [N] days before at [time]
  - Payment reminders: [preset] schedule, max [N] reminders
  - Invoice cover emails: [setting]
  - Reschedule requests: [setting]
  - Subcontractor coordination: [setting]
- Key message: "You can change ANY of these settings anytime from Settings →
  Communications. The agent will remind you occasionally to review as your business grows."
- Two CTAs:
  - "Open Settings" → /settings/integrations (focused on client-comms tab)
  - "Finish" → /agent/queue

### AMEND.4 — Trigger the Wizard

1. **Milestone trigger** — extend autonomy-milestone-service.ts:
   - New milestone: `comms_wizard_ready` — fires when:
     - Writing profile confidence crosses 0.75 (Level 3)
     - AND comms_wizard_completed_at is NULL (or wizard_version mismatch)
   - Fires once per milestone transition
   - Notification:
     ```typescript
     {
       type: "ai_milestone",
       title: "CONFIGURE YOUR AI COMMUNICATIONS",
       body: "Your AI is ready to handle client communications. Take 2 minutes to set up
         how you want it to work.",
       persistent: true,
       action_url: "/agent/comms-config",
       action_label: "Configure",
     }
     ```

2. **First phase_c enable trigger:**
   - When phase_c is first enabled for a company, fire the same notification
   - Check by seeing if it's the first enable event in the last 7 days

3. **Route:** src/app/(dashboard)/agent/comms-config/page.tsx
   - Renders CommsConfigWizard component
   - Pre-populates from existing settings if re-running
   - On completion, sets comms_wizard_completed_at and wizard_version, redirects to /agent/queue

4. **Settings entry point:** Add prominent "Re-run Setup Wizard" button at the top of
   client-comms-settings-tab.tsx

### AMEND.5 — Update Settings Tab

Update src/components/settings/client-comms-settings-tab.tsx:
1. Header section: "Communications configured: [date]" with "Re-run Setup Wizard" button
2. 7 collapsible sections (one per email type), each showing current config at a glance
3. "Edit" link on each section jumps to the relevant wizard step
4. Current config shown in Kosugi with [bracket] captions
5. Respect the same design system rules as the wizard itself

### AMEND.6 — i18n

Create/extend: src/i18n/dictionaries/en/comms-wizard.json and es/comms-wizard.json

Keys needed for all 10 wizard steps:
- Step titles and descriptions
- All option labels and sub-option labels
- Sub-question text
- Warning messages
- Preview email content
- Button labels (Back, Next, Skip, Finish, Begin Setup)
- Summary section labels
- Status display text (Tentative, Confirmed, Auto-confirms in X hours)
- All structured summary types for settings display

ZERO hardcoded English. All text through t(). Spanish with correct diacritics (á, é, í, ó, ú, ñ).

### AMEND.7 — Design System

The wizard is the user's first deep interaction with the agent system. Make it feel
premium and deliberate, not like a form.

- Full-height page layout with dark theme (#0D0D0D background)
- Progress indicator at top: 10 segments, filling as user advances, Mohave labels "01" through "10"
- Each step: frosted glass panel centered, max-width 640px
- Mohave UPPERCASE step headers
- Kosugi descriptions in [brackets]
- Option cards: 56dp minimum tap targets, clear selected state with subtle accent border
- No shadows, borders only
- Between-step transitions: opacity + translateX (slide in from right), 250ms, EASE_SMOOTH
- Reduced motion: cross-fade only, no slide
- "Back" and "Next" buttons: 56dp touch targets, accent ONLY on the primary action (Next)
- Example email previews: rendered in a muted frosted glass sub-panel with monospace
  font for the draft text
- Sliders: custom styled to match design system (no default browser sliders)
- Radio cards (the option cards): border-left accent when selected, subtle background shift

### AMEND.8 — Execution and Wiring Verification

After all amendment work is complete, verify:

1. The migration for `schedule_confirmed_at` is idempotent and runs cleanly
2. executeCreateTask no longer auto-fires sendAppointmentConfirmation
3. New /api/agent/confirm-schedule route works with manual task button
4. New /api/agent/unconfirm-schedule route works and handles "schedule changed" email option
5. Auto-confirm cron correctly detects stable tasks and fires confirmation
6. Full auto level fires immediately on task creation (only when level === 'full_auto')
7. Appointment reminder cron reads lead_days from settings (not hardcoded 1)
8. Cron folder renamed to appointment-reminders, vercel.json updated to match
9. Wizard renders at /agent/comms-config with all 10 steps
10. Wizard triggers via milestone notification when confidence crosses 0.75
11. Wizard triggers on first phase_c enable
12. All 10 steps render with back/next navigation, state persists across steps
13. Step 3 (appointment confirmations) shows all 5 options with correct sub-questions
14. FULL AUTO option is locked when confidence < 0.85 or prior confirmations < 50
15. Sub-questions conditionally appear based on primary selection
16. "What happens when I reschedule confirmed task" question is always shown if level not Off
17. Choices persist to client_comms_settings JSONB
18. comms_wizard_completed_at and wizard_version set on completion
19. Re-run button from settings re-opens wizard with current values pre-populated
20. Settings tab shows current config for all 7 email types, with Edit jumps to wizard
21. All text via i18n — zero hardcoded English, Spanish diacritics correct
22. 56dp touch targets throughout
23. Design system compliance (dark theme, fonts, radii, borders, animations)
24. Reduced motion respected (cross-fade instead of slide)
25. Phase C gated on the wizard route
26. Admin/owner role check on the wizard route AND all new API routes
27. Client comms settings tab is imported and rendered in settings page
   (double-check this — don't repeat the I3 mistake where financial settings was unreachable)
