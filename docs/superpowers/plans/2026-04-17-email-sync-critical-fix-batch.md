# Email Sync Pipeline — Critical Fix Batch

**Date:** 2026-04-17
**Branch:** `feat/visual-system-foundation`
**Scope:** 7 critical bugs discovered during Canpro (`a612edc0-5c18-4c4d-af97-55b9410dd077`) Phase C manual testing
**Status:** Discovered, characterised, and DB-patched where necessary. Code fixes pending.

---

## 0. Context for the executing agent

This plan is the result of an end-to-end test of the email import → sync → Phase C pipeline against real Canpro Deck & Rail production data. The previous agent rebuilt the sync pipeline (17-bug perfection pass, commits `b8baba30` + `25e5609d`), then a manual testing run surfaced 7 additional bugs in the surrounding orchestration code — NOT in the sync engine itself.

The sync engine is now production-healthy. These 7 bugs are in:
- The activate wizard route and its post-activation UI refresh
- The analyze-memory (Phase C) entrypoint's auth requirements
- The import route's image-extraction phase
- The analyze-status polling loop's auth handling
- The Google Pub/Sub webhook setup path

**You must fix all 7 bugs in this plan. Skipping any of them leaves production broken for at least one customer segment (typically the multi-admin company accounts that share a Gmail inbox).**

### Recent commits you should be aware of

| Commit | Purpose |
|---|---|
| `5718ed0d` | AsyncLocalStorage-based `runWithSupabase` replaces module-level `setSupabaseOverride` for race-safe background work |
| `be8c2328` | Lazy-init guard so `helpers.ts` stays client-safe |
| `c42142a5` | Wizard state-restoration hardening — `canAutoSaveRef` + `lastSaveFingerprintRef` defenses against default-state overwrite |
| `c7d21bd8` | Uncommitted wizard UI improvements — `GlassActionButton`, `KeyHint`, shared `htmlToPlainText` |

### Required reading before starting

1. `src/lib/supabase/helpers.ts` — understand `runWithSupabase` vs the legacy `setSupabaseOverride`. New code MUST use `runWithSupabase` for anything running inside `after(...)` callbacks.
2. `src/components/settings/import-pipeline-wizard.tsx` — the 1200-line wizard this plan touches indirectly. Know its state flow before editing adjacent files.
3. `src/app/api/integrations/email/activate/route.ts` — the route that ships the user over the finish line. 3 of the 7 bugs are here or caused by it.
4. `src/app/api/integrations/email/analyze-memory/route.ts` — Phase C entrypoint. Bug #23 is here at line 198.

### Ground-truth production state (as of 2026-04-17 17:20 PDT)

| Field | Value |
|---|---|
| Canpro company id | `a612edc0-5c18-4c4d-af97-55b9410dd077` |
| Canpro Gmail connection id | `abcf9c4e-e1ea-44ba-a6f6-b21faa290f73` |
| Canpro admin user id (Jackson) | `283d49df-90a1-4abb-b94c-3e9f17f02c0d` |
| Connection status | `active` |
| Connection user_id | `null` ← bug #23 |
| Webhook subscription | `null` ← bug #22 |
| Phase C feature flag | `enabled` |
| agent_memories rows | `0` ← symptom of #23 |
| agent_writing_profiles rows | `0` ← symptom of #23 |
| agent_knowledge_graph rows | `0` ← symptom of #23 |
| Historical scan job (usable) | `ae5837ef-ad92-4b3d-8658-3468d17d3600` |
| Phantom rescan job | `1df78c25-f2bd-43ef-acdc-e13228190d50` (91 leads, 847 emails — product of bug #20) |
| Successful import job | `a27dc96d-ecb2-4bdb-8c1f-c349f11b24ba` (25 clients + 71 opps + 94 labels, 0 errors, manually marked import_complete after 300s timeout) |

---

## 1. Priority order

Execute in this order. Each bug's fix is independent but they share some touched files, so commit after each.

1. **#23** Phase C `user_id` gate — Critical. Entire feature broken for multi-admin customers.
2. **#19** Integrations tab stale after activate — Critical. Users double-click activate, triggering #20.
3. **#20** Wizard reopen auto-rescans — Critical. Wastes OpenAI/Gmail budget. Depends on #21 fix.
4. **#21** Activate wipes `lastScanJobId` / `lastImportJobId` — High. Breaks wizard restoration + contributes to #20.
5. **#22** Webhook silent setup failure — High. Sync lags 60 min instead of real-time.
6. **#18** Image extraction exceeds 300s maxDuration — High. Leaves jobs stuck.
7. **#17** analyze-status 401 auth polling — Medium. UI goes silent during long imports.

---

## 2. Bug #23 — Phase C bails on null user_id (CRITICAL)

**File:** `src/app/api/integrations/email/analyze-memory/route.ts`

**Problem:** Line 198 returns early with `console.error("[analyze-memory] Connection has no userId")` whenever `connection.userId` is null. Company-type OAuth connections legitimately land with `user_id = null` because `src/app/api/integrations/gmail/route.ts:43-47` only enforces userId for `type === 'individual'`. Result: Phase C never runs for any company-type connection. Canpro has had Phase C enabled for 2 days, run Phase A+B twice, and has exactly 0 agent_memories / writing_profiles / knowledge_graph rows.

### Fix — two-part

#### Part A: Make OAuth init always carry the current user's id even for company connections

**File:** `src/app/api/integrations/gmail/route.ts`

Before (L23-48):
```ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const type = (searchParams.get("type") || "company") as "company" | "individual";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Gmail integration not configured. GOOGLE_CLIENT_ID is missing." },
      { status: 500 }
    );
  }

  // Individual connections must carry a userId — the wizard already enforces
  // this on the client side, but we fail loudly here too so a missing userId
  // can't silently degrade into an un-owned connection.
  if (type === "individual" && !userId) {
    return NextResponse.json(
      { error: "userId is required for individual connections" },
      { status: 400 }
    );
  }
```

After — require userId for BOTH types; the wizard already has it in the auth store regardless:
```ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const userId = searchParams.get("userId");
  const type = (searchParams.get("type") || "company") as "company" | "individual";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Gmail integration not configured. GOOGLE_CLIENT_ID is missing." },
      { status: 500 }
    );
  }

  // Both connection types require a userId so Phase C memory/writing-profile
  // extraction can attribute artifacts to a real user. Company-type connections
  // attribute to whichever admin ran the wizard — matches the way other
  // shared-resource features (estimates, invoices) track "createdBy" while
  // still being visible to the whole company.
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required — wizard must pass the current user's id" },
      { status: 400 }
    );
  }
```

And mirror in `src/app/api/integrations/microsoft365/route.ts` — same pattern, enforce userId for both types.

**Client-side:** Audit every caller of `/api/integrations/gmail?...` and `/api/integrations/microsoft365?...` to confirm they always pass `userId`. Likely files: `src/components/settings/wizard-steps/connect-step.tsx`, any manual-reconnect flows. Use `useAuthStore().currentUser?.id`.

#### Part B: Backfill Canpro's current null user_id

Run via Supabase SQL editor:
```sql
UPDATE email_connections
SET user_id = '283d49df-90a1-4abb-b94c-3e9f17f02c0d'
WHERE id = 'abcf9c4e-e1ea-44ba-a6f6-b21faa290f73'
  AND user_id IS NULL
RETURNING id, user_id, email, type;
```

Then trigger Phase C against the last successful scan to populate agent_memories / writing_profiles / knowledge_graph:
```bash
curl -X POST "https://app.opsapp.co/api/integrations/email/analyze-memory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -d '{
    "jobId": "1df78c25-f2bd-43ef-acdc-e13228190d50",
    "connectionId": "abcf9c4e-e1ea-44ba-a6f6-b21faa290f73",
    "companyId": "a612edc0-5c18-4c4d-af97-55b9410dd077"
  }'
```

(Use the latest scan job — `1df78c25` is current as of this writing; the backfill call is idempotent-safe because MemoryService.processImportBatch upserts.)

#### Part C: Fail loudly on null user_id going forward

In `analyze-memory/route.ts` around line 198, replace the silent `return` with a persistent notification so ops can see it:

```ts
if (!userId) {
  console.error(`[analyze-memory] Connection ${connectionId} has no userId — Phase C skipped`);

  // Surface the failure so it doesn't rot silently. The reconnect flow will
  // carry a userId when the fix deploys, so this should be very rare in the
  // future — but if it fires, we want to see it.
  await supabase.from("notifications").insert({
    user_id: null,
    company_id: companyId,
    type: "role_needed",
    title: "AI knowledge extraction skipped — reconnect required",
    body: "The email connection is missing an owner. Reconnect your inbox in Settings → Integrations to enable AI draft assistance.",
    is_read: false,
    persistent: true,
    action_url: "/settings?tab=integrations",
    action_label: "Reconnect",
  });
  return;
}
```

### Verification

After Part A ships AND Part B backfill runs:
```sql
-- Phase C tables should grow
SELECT
  (SELECT COUNT(*) FROM agent_memories WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077') as memories,
  (SELECT COUNT(*) FROM agent_writing_profiles WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077') as profiles,
  (SELECT COUNT(*) FROM agent_knowledge_graph WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077') as edges;
-- Expect non-zero values in all three columns.
```

Commit message template: `fix(phase-c): require userId on OAuth init so company connections populate memory + profile tables`

---

## 3. Bug #19 — Integrations tab shows "Activate your email sync" after successful activation (CRITICAL)

**File:** `src/components/settings/integrations-tab.tsx` (look around L507-557 where the CTA is rendered)

**Problem:** After Jackson clicked Activate in the wizard, the tile still showed "Activate your email sync" CTA as if nothing happened. DB confirmed `status=active` immediately after. Jackson clicked the CTA again, re-opening the wizard, which triggered bug #20 (phantom rescan).

The wizard's `onComplete` callback at `integrations-tab.tsx:329-333`:
```ts
onComplete={() => {
  setWizardOpen(false);
  toast.success("Pipeline import complete");
  queryClient.invalidateQueries({ queryKey: queryKeys.gmailConnections.all });
}}
```

`invalidateQueries` schedules a refetch but the new data may not arrive before the tile re-renders. The CTA guard depends on `importComplete`, `hasAnyConnection`, `wizardDone` — if any of those read stale data, the CTA is shown.

### Fix

Change the rendering guard to also react to `connection.status === 'active'`, not just `importComplete`. Read the activation status directly from the connection record:

```ts
// Around the amber "Pipeline import not configured" block at L526-538, guard ADDITIONALLY on connection status
{hasAnyConnection && !wizardDone && !activeJobId && companyConnections[0]?.status !== 'active' && (
  // ... existing block
)}

// After activation, render an "Active" confirmation row instead of any setup CTA
{hasAnyConnection && companyConnections[0]?.status === 'active' && (
  <div className="flex items-start gap-[8px] px-2 py-1.5 rounded border border-[rgba(107,143,113,0.3)] bg-[rgba(107,143,113,0.08)]">
    <Check className="w-[16px] h-[16px] text-[#6B8F71] shrink-0 mt-[2px]" />
    <div className="flex-1 min-w-0">
      <span className="font-mohave text-body-sm text-[#6B8F71] block">
        Pipeline sync active
      </span>
      <span className="font-kosugi text-micro text-text-mute">
        Syncing every {companyConnections[0].syncIntervalMinutes ?? 60} minutes.
        <button
          onClick={() => openWizard()}
          className="ml-1 underline underline-offset-2 hover:text-text-2"
        >
          Re-run setup
        </button>
      </span>
    </div>
  </div>
)}
```

Also tighten the invalidation — await the refetch, don't fire-and-forget:
```ts
onComplete={async () => {
  setWizardOpen(false);
  toast.success("Pipeline import complete");
  await queryClient.invalidateQueries({ queryKey: queryKeys.gmailConnections.all });
  await queryClient.refetchQueries({ queryKey: queryKeys.gmailConnections.all });
}}
```

### Verification

1. Start a fresh activation via the wizard.
2. Click Activate in Step 5.
3. Wizard closes.
4. Tile should transition directly to "Pipeline sync active" (green) without any flash of the amber "not configured" state.
5. No Gmail ghost-rescans should kick off in `gmail_scan_jobs`.

Commit message template: `fix(integrations-tab): reflect active status immediately after wizard activation`

---

## 4. Bug #20 — Reopening wizard after activation triggers a rescan (CRITICAL)

**File:** `src/components/settings/import-pipeline-wizard.tsx` (L255-459 — the state-restoration effect)

**Problem:** The wizard's state-restoration effect happily runs a fresh analyze when `filters.lastScanJobId` and `filters.lastImportJobId` are both null — which is exactly what bug #21 leaves behind after activation. Combined with #19 (user re-clicks the stale CTA), the wizard auto-triggers Phase A on 847 emails every time.

### Fix

Add an early return at the top of `checkWizardState` when the wizard is already completed:

```ts
const checkWizardState = async () => {
  try {
    const res = await fetch(`/api/integrations/email/connection?id=${initialConnectionId}`);
    if (!res.ok) return;
    const conn = await res.json();
    const filters = conn.syncFilters || {};

    // Wizard already completed AND connection is active — nothing to do.
    // This used to read only `wizardCompleted`, but when combined with the
    // activate route wiping job IDs (see fix #21), the wizard would fall
    // through to auto-scan behaviour. Gate on status=active so the wizard
    // stays dormant for already-set-up connections.
    if (filters.wizardCompleted && conn.status === 'active') return;

    // ... rest of the existing code
  }
}
```

Also — when a user clicks the "Re-run setup" link (from the #19 fix), they explicitly choose to re-run. That path should start at Step 4 (review existing scan) rather than restart the scan. Pass an explicit `reopen` prop the wizard can use to skip auto-scan dispatches.

### Verification

After fix #19 + #20:
1. Activate once.
2. Refresh the page.
3. Click the tile to reopen the wizard.
4. **No new `gmail_scan_jobs` row should be created.**
5. Wizard should either stay closed (if guarded out) or land on the already-populated review view without kicking a fresh analyze.

Commit message template: `fix(wizard): do not auto-analyze when connection is already active`

---

## 5. Bug #21 — Activate route wipes `lastScanJobId` and `lastImportJobId` from sync_filters (HIGH)

**File:** `src/app/api/integrations/email/activate/route.ts` (L80-93)

**Problem:**
```ts
await EmailService.updateConnection(connectionId, {
  syncFilters: {
    ...syncProfile,
    wizardCompleted: true,
    wizardStep: 5,
  },
  ...
});
```
The `syncFilters` field is REPLACED with `{...syncProfile, wizardCompleted, wizardStep}`. The existing `lastScanJobId`, `lastImportJobId`, `reviewState`, and any other persisted wizard state are clobbered. The `email/connection` PATCH route does this correctly (reads existing first, then merges — see `src/app/api/integrations/email/connection/route.ts:67-75`). Activate should follow the same pattern.

### Fix

```ts
// Read existing filters so activation preserves wizard state (lastScanJobId,
// lastImportJobId, reviewState, etc.) instead of clobbering them.
const existingFilters = (connection.syncFilters as Record<string, unknown>) || {};

await EmailService.updateConnection(connectionId, {
  syncFilters: {
    ...existingFilters,
    ...syncProfile,
    wizardCompleted: true,
    wizardStep: 5,
  },
  syncIntervalMinutes,
  syncEnabled: true,
  opsLabelId: labelId,
  webhookSubscriptionId: webhookSubscriptionId || undefined,
  webhookExpiresAt: webhookExpiresAt || undefined,
  status: "active",
});
```

### Verification

After an activation:
```sql
SELECT
  sync_filters->>'lastScanJobId' as last_scan_job_id,
  sync_filters->>'lastImportJobId' as last_import_job_id,
  sync_filters->>'wizardCompleted' as wizard_completed
FROM email_connections
WHERE email = 'canprojack@gmail.com';
-- All three should be populated, not just wizardCompleted.
```

Commit message template: `fix(activate): merge syncFilters instead of replace to preserve wizard state`

---

## 6. Bug #22 — Webhook setup failed silently during activation (HIGH)

**File:** `src/app/api/integrations/email/activate/route.ts` (L60-78)

**Problem:** Activation swallows webhook errors into a `warnings[]` array that the wizard never displays. Canpro ended up with `webhook_subscription_id = null` and silently fell back to the 60-min cron. For a product that sells "the app that pulls you out of the chaos", 60 min of latency between a client message and the activity appearing in OPS is unacceptable.

Likely root cause candidates (check in this order):

1. **Env var missing** in the production Vercel project: `GOOGLE_PUBSUB_TOPIC`. Run `vercel env ls production` and confirm. If missing, the `GmailProvider.setupWebhook` throws `ProviderApiError: GOOGLE_PUBSUB_TOPIC env var not configured` per the 16-bug sync pipeline rebuild.
2. **Topic doesn't exist** in the Google Cloud project or **Gmail app isn't authorized** to publish to it. Check the topic exists at `projects/<project>/topics/<GOOGLE_PUBSUB_TOPIC>` and that the OPS Gmail Cloud service account has `pubsub.publisher` on it.
3. **Stale Gmail token** on the connection. The token refresh path should handle this (B7 from the sync-pipeline rebuild), but if the warning message mentions 401/403 from Gmail, the token is the culprit.

### Fix

**Part A — diagnose the actual failure.** Add the error message to the warning payload that's returned, so the wizard can surface it. Currently:
```ts
warnings.push({ step: "webhook", message });
```
The wizard's `ActivateStep` component does not render `warnings` at all. Update `src/components/settings/wizard-steps/activate-step.tsx` to render each warning as a callout below the success state:

```tsx
{result.warnings?.length > 0 && (
  <div className="mt-3 space-y-2 p-3 border border-amber-500/30 bg-amber-500/8 rounded">
    <h5 className="font-kosugi text-micro uppercase text-amber-400">
      Partial success
    </h5>
    {result.warnings.map((w, i) => (
      <p key={i} className="font-mohave text-body-sm text-text-2">
        <span className="text-amber-400">{w.step}:</span> {w.message}
      </p>
    ))}
    <p className="font-kosugi text-micro text-text-mute">
      Sync will still run on the 60-minute cron. You can retry setup from Settings.
    </p>
  </div>
)}
```

**Part B — fix the underlying webhook setup.** Once you know the actual error, fix the environment. Expected resolution: set `GOOGLE_PUBSUB_TOPIC` env var. Supporting env vars to verify (from commit `25e5609d`): `GOOGLE_PUBSUB_SERVICE_ACCOUNT`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`.

**Part C — also ensure the webhook-renewal cron retries null-subscription rows.** Check `src/app/api/cron/webhook-renewal/route.ts` — the sync-rebuild commit claimed "Webhook renewal cron filter relaxed to also pick up null-subscription rows for retry" (B6). Verify that's still the case; if not, add `or(webhook_subscription_id.is.null, webhook_expires_at.lt.now()+7_days)` to the filter.

### Verification

1. Deploy the fix.
2. Trigger a fresh activation on a test connection.
3. Check the DB row: `webhook_subscription_id` should be non-null, `webhook_expires_at` should be in the future (Gmail Pub/Sub subscriptions have a 7-day max).
4. Send a new email to the connected mailbox. Within ~5 seconds, the push notification should land at `/api/integrations/email/webhook/gmail` and a new activity row should appear.

Commit message template: `fix(email-activate): surface webhook failures + verify GOOGLE_PUBSUB_TOPIC env`

---

## 7. Bug #18 — Image extraction in import route exceeds Vercel `maxDuration = 300s` (HIGH)

**File:** `src/app/api/integrations/email/import/route.ts`

**Problem:** `maxDuration = 300;` at L29. The lead-creation loop finishes in ~150s for 94 leads. Then "Extracting images from emails..." starts at L509+ — fetches Gmail attachment metadata, downloads attachments, uploads to Supabase Storage. For 71 new opps × 1-5 threads × multiple images × ~1s each, image extraction alone is 5-10 min. Function gets killed at 300s. The final `status: 'import_complete'` write at L643-660 never runs, so the job is stuck in `importing` forever and the wizard can't advance.

On Canpro this required manual DB fixup to unblock (see the "ground-truth state" section).

### Fix

Split image extraction into its own background route so the import route can finish and write `status: 'import_complete'` promptly.

#### Step 1: New route

Create `src/app/api/integrations/email/extract-images/route.ts`:

```ts
/**
 * OPS Web - Post-Import Image Extraction
 *
 * POST /api/integrations/email/extract-images
 * Body: { jobId, connectionId, companyId, opportunityIds: string[] }
 *
 * Runs in the background via after(); pulls image attachments from email
 * threads and uploads them to Supabase Storage. Split from the main import
 * route because the attachment fetch+upload cycle can easily exceed the
 * import route's 300s maxDuration budget, leaving import jobs stuck in
 * 'importing' status indefinitely.
 */
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";

export const maxDuration = 800; // Pro plan max

export async function POST(request: NextRequest) {
  const { jobId, connectionId, companyId, opportunityIds } = await request.json();

  if (!jobId || !connectionId || !companyId || !Array.isArray(opportunityIds)) {
    return NextResponse.json({ error: "jobId, connectionId, companyId, opportunityIds required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const connection = await runWithSupabase(supabase, () => EmailService.getConnection(connectionId));
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
      // IMPORTANT: lift the entire image-extraction loop currently in
      // import/route.ts L509-641 verbatim, BUT:
      //   - Take oppThreadMap as input (serialize opp_id → threadIds[] +
      //     allowedSenders[] into the request body) instead of rebuilding
      //     from the `leads` array.
      //   - Write `result.imagesExtracted` back to the gmail_scan_jobs row
      //     on completion, as an incremental update to the existing result.
      // End result: import route completes in under 180s; image extraction
      // catches up in the background with its own 800s budget.
    });
  });

  return NextResponse.json({ ok: true });
}
```

#### Step 2: Modify `import/route.ts`

Move the `result.imagesExtracted = 0` and ALL image-extraction code (L509-641) out of `runImport`. After the lead-creation loop and BEFORE writing `status: 'import_complete'`:

```ts
// Collect opportunity → {threadIds, allowedSenders} for image extraction
const oppThreadPayload = Array.from(oppThreadMap.entries()).map(([_, v]) => ({
  opportunityId: v.opportunityId,
  threadIds: v.threadIds,
  allowedSenders: Array.from(v.allowedSenders),
}));

// Mark the import complete FIRST so the wizard advances, then dispatch
// image extraction to a separate function with its own budget.
await supabase
  .from("gmail_scan_jobs")
  .update({
    status: "import_complete",
    progress: {
      stage: "import_complete",
      percent: 100,
      message: "Import complete! Extracting images in background...",
      totalLeads: leads.length,
      processedLeads: leads.length,
      clientsCreated: result.clientsCreated,
      leadsCreated: result.leadsCreated,
      labelsApplied: result.labelsApplied,
    },
    result,
  })
  .eq("id", jobId);

// Fire-and-forget image extraction
after(async () => {
  try {
    await fetch(`${getAppUrl()}/api/integrations/email/extract-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        connectionId,
        companyId,
        opportunityIds: Array.from(oppMap.values()),
        oppThreadPayload,
      }),
    });
  } catch (err) {
    console.error("[email-import] Failed to dispatch image extraction:", err);
  }
});
```

#### Step 3: Fix the `updated_at` non-bumping issue (related)

`gmail_scan_jobs.updated_at` is never bumped by `updateProgress()` because the app only writes to `progress` and `status`. Add to every `supabase.from("gmail_scan_jobs").update({...})` call:
```ts
{ ..., updated_at: new Date().toISOString() }
```

Or install a trigger:
```sql
CREATE OR REPLACE FUNCTION bump_gmail_scan_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gmail_scan_jobs_updated_at
BEFORE UPDATE ON gmail_scan_jobs
FOR EACH ROW EXECUTE FUNCTION bump_gmail_scan_jobs_updated_at();
```

Prefer the trigger — it's centralized.

### Verification

1. Deploy + run a fresh import of >50 leads with image attachments.
2. `status` flips to `import_complete` within ~180s regardless of image count.
3. A separate invocation of `/api/integrations/email/extract-images` runs for up to 800s.
4. `result.imagesExtracted` grows over time until the extraction settles.
5. No stuck `status: 'importing'` rows after any future import.

Commit message template: `fix(email-import): split image extraction into separate 800s background route`

---

## 8. Bug #17 — analyze-status polling returns 401 when Firebase token expires (MEDIUM)

**File:** `src/app/api/integrations/email/analyze-status/route.ts` (L14-18)

**Problem:** The import wizard polls `/api/integrations/email/analyze-status?jobId=...` every few seconds. The route uses `verifyAdminAuth(request)` which rejects expired Firebase tokens. When the user's Firebase token expires mid-session (common for long-running imports), the polling loop goes silent — UI shows no progress updates even though the server is working.

### Fix

**Client-side retry with token refresh.** Find the hook driving the polling (likely `src/components/settings/wizard-steps/import-progress.tsx` or similar). On 401, call `auth.currentUser?.getIdToken(true)` (the force-refresh flavour) and retry once before surfacing the error:

```ts
const pollStatus = async () => {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/integrations/email/analyze-status?jobId=${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token expired mid-session — force-refresh and retry once
    const fresh = await auth.currentUser?.getIdToken(true);
    const retry = await fetch(`/api/integrations/email/analyze-status?jobId=${jobId}`, {
      headers: { Authorization: `Bearer ${fresh}` },
    });
    if (!retry.ok) throw new Error(`Poll failed after refresh: ${retry.status}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  return res.json();
};
```

Audit the codebase for other places that poll authed endpoints — `src/lib/hooks/use-import-status.ts` if it exists, or wherever `analyze-status` is called client-side.

**Server-side hardening (optional follow-up):** `verifyAdminAuth` could accept slightly-stale tokens within a 30-second grace window. Low-priority; client-side retry handles 99% of cases.

### Verification

1. Start an import.
2. Force a token expiry by running `await firebase.auth().currentUser.getIdTokenResult()` in DevTools — note the expiry.
3. Wait past the expiry.
4. UI should continue showing progress smoothly; one 401 in the network tab followed by a successful retry.

Commit message template: `fix(wizard-polling): force Firebase token refresh on 401 before surfacing error`

---

## 9. Shared verification checklist

After ALL 7 fixes land, do this end-to-end on a fresh test connection (NOT Canpro — use a scratch company or personal Gmail):

- [ ] OAuth init rejects missing userId for both company and individual types
- [ ] Fresh connection lands with `user_id` populated
- [ ] Analyze Phase A → B → C runs in sequence, producing rows in all three agent_* tables
- [ ] Import lands `status: import_complete` within ~180s
- [ ] Background image extraction runs separately and completes (verify `result.imagesExtracted > 0`)
- [ ] Activate leaves `lastScanJobId`, `lastImportJobId`, `reviewState` intact in sync_filters
- [ ] After activate: integrations tab shows green "Pipeline sync active" without needing refresh
- [ ] Clicking into the tile after active: wizard stays dormant, NO new scan job created
- [ ] Webhook subscription is non-null, `webhook_expires_at` is in the future
- [ ] Send a new email to the mailbox: within 5s a new row appears in `activities`
- [ ] `/api/agent/comms-wizard/gating` returns `writingProfileConfidence > 0` after Phase C has processed enough emails
- [ ] Force Firebase token expiry mid-polling: UI recovers silently

Then finally backfill Canpro's connection:
```sql
UPDATE email_connections
SET user_id = '283d49df-90a1-4abb-b94c-3e9f17f02c0d'
WHERE id = 'abcf9c4e-e1ea-44ba-a6f6-b21faa290f73' AND user_id IS NULL;
```

And retrigger Phase C (see Part B of bug #23).

---

## 10. Non-obvious gotchas

1. **Use `runWithSupabase`, not `setSupabaseOverride`.** The AsyncLocalStorage pattern was shipped in commit `5718ed0d` to fix a concurrent-request RLS race. Any new code that runs inside `after(...)` MUST use `runWithSupabase` or the race re-opens. See `src/lib/supabase/helpers.ts`.

2. **`next/server` `after()` preserves AsyncLocalStorage context.** You can set the supabase client via `runWithSupabase` at the top of an `after()` body, and every nested service call (`ClientService.createClient`, etc.) will see it correctly.

3. **`helpers.ts` is a client-safe module.** Don't add Node-only imports like `async_hooks` without guarding — see the lazy `getStorage()` pattern. Webpack will break the client bundle otherwise.

4. **`gmail_scan_jobs` is used for BOTH analyze and import jobs.** They share progress JSONB with different `stage` values. Don't assume a row is one or the other without checking `status`.

5. **Canpro's connection data is real production data.** Don't delete or soft-delete any of the 25 clients / 71 opportunities / 72 activities that the successful import created. The DB backfill for `user_id` is the only DB write you need to do for this bug batch.

6. **The wizard state has two separate defenses now.** Commit `c42142a5` added `canAutoSaveRef` (gates auto-save until restoration completes) and `lastSaveFingerprintRef` (skips byte-identical writes). If you touch the wizard's state flow, preserve both.

7. **Vercel plan has `maxDuration` caps.** Pro plan = 300s for standard functions, 800s for routes with `export const maxDuration = 800;`. `extract-images` needs the 800s setting.

8. **Don't use `git push --force` on `feat/visual-system-foundation`.** It's an active development branch with ~20 commits Jackson is sitting on.

---

## 11. After you're done

1. Open a single PR titled **"fix(email-sync): 7-bug post-activation critical batch"**.
2. In the PR description, link back to this plan file.
3. Include verification output (screenshots of the DB queries from § 9) in the PR body.
4. Request review from Jackson before merging. He'll want to sanity-check the activate UI flow in person.
5. After merge, DO NOT manually activate Canpro's connection again — it's already active and the backfill + retrigger handles Phase C.
