# Phase C — Manual Testing Flow

**Deploy under test:** `4b7183b` — `dpl_EVA2VdEXzXAxUqxb5BR84UG71ZAq` → production after it turns `READY`.
**Environment:** `https://app.opsapp.co` — real Canpro data. Follow the safety rules in § 0 before doing anything.
**Tester:** Jackson (`canprojack@gmail.com`, role `admin` on Canpro Deck and Rail).

---

## 0. Safety rules (read first)

1. **There is a leftover test row** in `agent_actions` that I inserted earlier to prove the disconnect between the DB and the UI. After the new deploy ships, it will appear in Jackson's approval queue as a **High priority** client-health-alert card titled `"E2E Test Client has 85% late payment rate — 3 currently overdue ($4,250.00)"`. The action type is `client_health_alert` which is **acknowledgement-only** — approving it has zero side effects (no emails, no state changes). You can safely approve OR reject it as part of the test. Cleanup SQL is in § 6.
2. **Do not approve any other action type without reading § 5 first.** Some executors actually send email or mutate project state.
3. **If anything looks wrong during testing, stop and rollback** via `vercel rollback` to `dpl_8jBzPhfepkdH2D8USKDS4t23RTuu` (commit `26d65dd`). The previous deploy is marked `isRollbackCandidate: true`.

---

## 1. Deploy sanity check (2 minutes)

1. Go to `https://vercel.com/jacksons-projects-f76fa6e8/ops-web`
2. Latest production deploy should be `dpl_EVA2VdEXzXAxUqxb5BR84UG71ZAq` (commit `4b7183b`), state **READY**
3. Hard-reload `https://app.opsapp.co/dashboard` (Ctrl+Shift+R)
4. Open DevTools → Console tab
5. Dashboard should load normally. Only expected errors in console:
   - Firebase `Cross-Origin-Opener-Policy` warnings (6×, pre-existing, see bug doc)
   - Supabase 406 on `expense_settings` (pre-existing, see bug doc)
   - Nothing else

**If you see a red 500 error from `/api/agent/queue`:** screenshot it and tell me.

---

## 2. The big test — approval queue actually shows data

This is the test that would have failed before commit `4b7183b`.

1. Navigate to `https://app.opsapp.co/agent/queue`
2. Page title should be **"Agent Queue | OPS"**
3. The page should show:
   - **AGENT QUEUE** heading, `[Review and manage AI-proposed actions]` caption
   - **PHASE C AGENT STATUS** card with 5 domains (Email / Projects / Invoicing / Scheduling / Client Comms)
   - **[AUTONOMY MILESTONES]** row
   - Stats cards: **[PENDING] 1**, [APPROVED TODAY] 0, [REJECTED TODAY] 0, [AVG RESPONSE] --
   - **✅ CRITICAL:** Pending = 1 (not 0). That's the test row.
4. Below the stats, the action list should render **one action card**:
   - Title / summary: `"E2E Test Client has 85% late payment rate — 3 currently overdue ($4,250.00)"`
   - Priority badge: **HIGH**
   - Confidence: `92%`
   - Source: `payment_analysis`
   - Created: `2026-04-14`

### What to click

- **Open DevTools → Network tab first**, filter to `/api/agent`
- Reload the page
- You should see these all return **200** (not 401, not 500):
  - `GET /api/agent/phase-c-status`
  - `GET /api/agent/queue?status=pending`
  - `GET /api/agent/queue?statsOnly=true`
  - `GET /api/agent/queue?countOnly=true`
- Click the filter chips at the top (All / Pending / Approved / Executed / Rejected / etc.) → the card should appear/disappear correctly
- Click the priority filter chips (Urgent / High / Normal / Low) → the card should appear only under "High" and "All"

### If the action card does NOT show

That means the `setSupabaseOverride` fix didn't take effect, or the rollback commit restored. Double-check the deploy SHA and tell me.

---

## 3. The approval flow — reject the test row

This tests the PATCH route (`/api/agent/queue/[actionId]`) which I also fixed.

1. On the action card, click **Reject** (should be a button on the card — looks like an X or "Decline")
2. If a dialog asks for notes, type `Cleanup: automated test row from smoke test`
3. Click confirm
4. The card should disappear from the pending list
5. Switch the status filter to **Rejected** — card should now appear there
6. Stats strip should update: `[PENDING] 0`, `[REJECTED TODAY] 1`

### Network check

After clicking reject, you should see:
- `PATCH /api/agent/queue/5baf4ff3-11e9-4340-a9b1-fad5ad993e6f` → **200**
- Followed by a refetch: `GET /api/agent/queue?...` → **200**


Looks good
---

## 4. Comms wizard gating (1 minute)

This tests `/api/agent/comms-wizard/gating` — the 6th route I fixed.

1. Navigate to `https://app.opsapp.co/agent/comms-config`
2. **Expected behavior:** the route calls the gating endpoint, sees that Canpro has **zero emails analyzed** (no writing profile), and **redirects you back to `/agent/queue`**. This is correct — the wizard refuses to load without voice training data.
3. In DevTools → Network, you should see:
   - `GET /api/agent/comms-wizard/gating` → **200** with a JSON body like:
     ```json
     {
       "phaseCEnabled": true/false,
       "writingProfileConfidence": 0,
       "priorConfirmationsSent": 0,
       "fullAutoUnlocked": false,
       "thresholds": { "minConfidence": 0.85, "minPriors": 50 }
     }
     ```
4. **If the response is empty `{}` or throws 500:** it means the route still can't read the DB. Tell me.

Response: {
    "phaseCEnabled": false,
    "writingProfileConfidence": 0,
    "priorConfirmationsSent": 0,
    "fullAutoUnlocked": false,
    "thresholds": {
        "minConfidence": 0.85,
        "minPriors": 50
    }
}

---

## 5. Action type safety reference

If you want to play around with the approval queue more, here's the safe/unsafe map. **Only approve types marked SAFE.**

| Action type | Approval does what | Safe to approve? |
|---|---|---|
| `client_health_alert` | Acknowledgement only | ✅ SAFE |
| `financial_insight` | Acknowledgement only | ✅ SAFE |
| `create_project` | **Creates a real project row** | ⚠️ mutates DB |
| `create_task` | **Creates a real project_task row** | ⚠️ mutates DB |
| `create_invoice` | **Creates a real invoice + line items** | ⚠️ mutates DB |
| `reassign_task` | **Mutates task.team_member_ids** | ⚠️ mutates DB |
| `archive_project` | **Sets project.status = 'archived'** | ⚠️ mutates DB |
| `send_status_email` | **SENDS AN EMAIL** to a real client | ❌ UNSAFE |
| `send_invoice_email` | **SENDS AN EMAIL** with invoice PDF attached | ❌ UNSAFE |
| `send_payment_reminder` | **SENDS AN EMAIL** dunning a real client | ❌ UNSAFE |
| `send_appointment_confirmation` | **SENDS AN EMAIL** to a real client | ❌ UNSAFE |
| `send_day_before_reminder` | **SENDS AN EMAIL** to a real client | ❌ UNSAFE |
| `send_schedule_changed` | **SENDS AN EMAIL** to a real client | ❌ UNSAFE |
| `send_subcontractor_coordination` | **SENDS AN EMAIL** to a subcontractor | ❌ UNSAFE |
| `process_reschedule_request` | **SENDS AN EMAIL REPLY** | ❌ UNSAFE |

**Rule of thumb:** anything starting with `send_` writes an email to a real inbox via SendGrid/Gmail. Do not approve in production.

---

## 6. Cleanup — remove the test row

After you're done testing, delete the test row I inserted. Run this in the Supabase SQL editor:

```sql
-- Delete the Phase C E2E test row.
-- ID is deterministic: 5baf4ff3-11e9-4340-a9b1-fad5ad993e6f
-- If you already rejected it via the UI (§3), the row will still exist
-- with status='rejected'. Either way, delete it fully:

DELETE FROM agent_actions
WHERE id = '5baf4ff3-11e9-4340-a9b1-fad5ad993e6f'
  AND source_id LIKE 'phase-c-e2e-%'  -- extra safety: only my test rows
RETURNING id, action_type, status, context_summary;
```

Expected: 1 row returned. If 0, it was already deleted.

Then verify nothing is leftover from my earlier smoke tests:

```sql
SELECT id, action_type, status, context_summary, source_id, created_at
FROM agent_actions
WHERE source_id LIKE 'smoke-%'
   OR source_id LIKE 'phase-c-e2e-%'
   OR context_source = 'production_readiness_smoke_test';
```

Expected: 0 rows.

---

## 7. What NOT to expect (yet)

These Phase C features need baseline state before they do anything useful. You won't see them until Canpro has built up history:

- **Writing profile** — needs to ingest existing emails from Jackson's Gmail. Until then, every draft/wizard gates out.
- **Agent knowledge graph** — needs the AI setup mining step to run.
- **Client health alerts** — won't surface until there are overdue invoices to analyze.
- **Payment reminders** — won't surface until invoices exist in sent/past_due states.
- **Status updates** — the cron picks up active projects that haven't been updated in N days; needs the client_comms_settings.status_update.cadence to be set to something other than "off".
- **Subcontractor coordination** — fully manual trigger.
- **Schedule-changed emails** — fire when a confirmed task's date is moved. Needs tasks to be schedule-confirmed first.

Once the writing profile is built (via Settings → Integrations → AI Setup → scan Gmail), the comms wizard unlocks, the autonomy milestones start firing, and the approval queue starts filling up organically.

---

## 8. Report back checklist

When you're done, tell me:

- [ READY] Deploy state (READY / ERROR / BUILDING)
- [YES ] Did the test action card appear in the queue? (Y/N)
- [ YES, but we will need to fix UI. They should use segmented picker that we have standardized] Did the status filter chips correctly hide/show the card? (Y/N)
- [ Yes ] Did reject → the card disappear + show up under "Rejected"? (Y/N)
- [ Y] Did `/agent/comms-config` redirect to `/agent/queue` with a 200 on the gating endpoint? (Y/N)
- [ N] Any red 500s in the console from Phase C routes? (paste the stack)
- [ N] Any 401s except on `/api/dashboard-preferences`? (those are the pre-existing auth-rotation noise)
- [ Y, need to fix the chips to change to segmented pickers.] Any UI bugs I should log in the bug-report doc?
- [N ] Did you run the cleanup SQL in § 6? (Y/N + row count returned)
