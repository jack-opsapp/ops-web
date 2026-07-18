# Leads Chase Parity — Web Handoff

**From:** iOS Leads tab redesign (ops-ios `feat/lead-assignment`, spec `ops-ios docs/superpowers/specs/2026-07-17-leads-tab-redesign-design.md` §9)
**Date filed:** 2026-07-18
**Status:** NOT built — three web items filed for a web session to pick up.

## Context

iOS shipped the chase system: `opportunities.handled_at` is the operator's
"handled — their move now" declaration. Both columns below are LIVE on prod
(migration `leads_chase_handled_at_and_summary_stamp`, applied 2026-07-18):

```sql
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS handled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz NULL;
```

The bucket rule iOS now runs (`PipelineViewModel.isAwaitingReply`):

> A lead is **YOUR MOVE** (formerly "waiting on you" / "reply due") only when
> `stage != 'new_lead' AND last_message_direction = 'in' AND
> (handled_at IS NULL OR last_inbound_at > handled_at)`.
> A newer inbound after a flip re-arms the lead automatically — no cron.

When iOS flips a lead (HANDLED ✓) it PATCHes `handled_at = now()` AND
`next_follow_up_at` = the comeback date in one request. Comeback rule:
default now + 3 days; an existing FUTURE follow-up that is sooner is kept;
past-due dates are always replaced.

## The three parity items

1. **Respect `handled_at` in web triage.** Wherever web computes the
   "reply due" / ball-in-court state for leads (pipeline board chips, inbox
   rail ball-in-court model), apply the same rule above so a lead an
   operator marked handled on the phone does not still scream "reply due"
   on the desk. Web should also offer its own handled affordance writing
   the same two-column PATCH (share the comeback rule).

2. **Set `ai_summary_updated_at` when writing `ai_summary`.** The summary
   writer (`evaluateStagesWithSummary()` path in the email sync engine)
   should stamp `ai_summary_updated_at = now()` in the same UPDATE that
   writes `ai_summary`. Both clients render a freshness stamp
   ("UPDATED 2D AGO") only when the column is non-null — until the writer
   stamps it, summaries simply show unstamped, nothing breaks.

3. **Optional vocabulary alignment.** iOS chips/headers now read
   `YOUR MOVE` / `WAITING` (replacing WAITING ON YOU / WAITING ON THEM /
   REPLY DUE). Adopting the same words on web pipeline chips keeps the one
   language everywhere; purely cosmetic, no data dependency.

## Also good to know (no action required)

- `activities.type` now receives `'text_message'` rows from iOS (the web
  enum `TextMessage` in `src/lib/types/pipeline.ts` already defines it —
  timelines should render these like any outbound touch).
- `email_attachments` gained an additive RLS policy
  (`email_attachments_lead_files_select`: attributed + opportunity_id +
  `private.current_user_can_view_opportunity`) so iOS can list a lead's
  attributed attachments. Web's service-role reads are unaffected.
- iOS deleted every weighted/win-probability render from lead surfaces;
  the `win_probability` column stays (schema compatibility) and Books/web
  may keep reading it.
