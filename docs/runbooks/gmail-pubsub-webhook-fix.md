# Runbook: Fix Gmail Real-Time Webhook (Pub/Sub topic mismatch)

**Status:** Open — requires manual GCP console actions.
**Owner:** Jackson.
**Date opened:** 2026-04-18.

## Symptom

Wizard activation fails (or Gmail real-time push never fires). Server logs show:

```
webhook: Gmail users.watch (webhook setup): Invalid topicName does not match projects/civic-champion-439517-e7/topics/*
```

`email_connections.webhook_subscription_id` stays `NULL` for the user who just connected Gmail.

## Root Causes

1. **Wrong GCP project.** The Pub/Sub topic currently lives in `ops-ios-app`, but the Gmail OAuth client is registered in `civic-champion-439517-e7`. Gmail requires the topic to be in the **same project as the OAuth client** — this is a hard requirement, not a soft suggestion.
2. **Trailing newline in env var.** `vercel env pull` shows `GOOGLE_PUBSUB_TOPIC = "projects/ops-ios-app/topics/gmail-push\n"`. Even with the right project the trailing `\n` would break Gmail's regex match.

Code now defensively trims env var reads (see `src/lib/api/services/providers/gmail-provider.ts:412`, `src/app/api/integrations/email/webhook/gmail/route.ts:25-26`, `src/lib/api/services/providers/microsoft365-provider.ts:108-109`) so a future newline can't reintroduce the bug. Fixing the project mismatch is manual.

---

## Part 1 — GCP console (manual)

You are logged into the GCP console as the Google Workspace account that owns the Gmail OAuth client. The target project is **`civic-champion-439517-e7`**.

### 1.1 Create the Pub/Sub topic

1. Open https://console.cloud.google.com/cloudpubsub/topic/list?project=civic-champion-439517-e7
2. Click **CREATE TOPIC**.
3. Topic ID: `gmail-push`
4. Leave **Add a default subscription** checked (we'll reconfigure it below) or uncheck — we'll create the subscription explicitly in step 1.3.
5. Leave schema unset. Click **CREATE**.

Full topic resource name will be: `projects/civic-champion-439517-e7/topics/gmail-push`

### 1.2 Grant Gmail permission to publish to the topic

Gmail publishes notifications via a Google-managed service account. Without this grant `users.watch` will silently succeed but no messages ever publish.

1. In the topic detail page, open the **Permissions** side panel (or **PERMISSIONS** tab).
2. Click **ADD PRINCIPAL**.
3. New principal: `gmail-api-push@system.gserviceaccount.com`
4. Role: **Pub/Sub Publisher** (`roles/pubsub.publisher`)
5. Click **SAVE**.

### 1.3 Create the push subscription

1. In the topic detail page, click **CREATE SUBSCRIPTION**.
2. Subscription ID: `gmail-push-sub-web`
3. Delivery type: **Push**.
4. Endpoint URL: `https://app.opsapp.co/api/integrations/email/webhook/gmail`
5. Check **Enable authentication**.
6. Service account: pick an existing service account in `civic-champion-439517-e7` that has `roles/iam.serviceAccountTokenCreator` (or create a new one named `gmail-pubsub-pusher`). This account's email is what the webhook route will verify against.
7. Audience: `https://app.opsapp.co/api/integrations/email/webhook/gmail`
8. Ack deadline: 60 seconds (default is fine).
9. Click **CREATE**.

Record two values for the env step:

- `<PUSH_SA_EMAIL>` — the service account email you selected in step 6.
- `<AUDIENCE>` — `https://app.opsapp.co/api/integrations/email/webhook/gmail` (what you typed in step 7).

### 1.4 Confirm the IAM binding (audience auth)

Google will not actually mint OIDC tokens for the push service account unless the project's push auth is configured. This is usually automatic when you picked a service account in step 1.3, but verify:

1. Open **IAM & Admin → IAM** for `civic-champion-439517-e7`.
2. Find the Pub/Sub service agent — it looks like `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com`.
3. Confirm it has `roles/iam.serviceAccountTokenCreator` on `<PUSH_SA_EMAIL>` (or project-wide). If missing, grant it.

---

## Part 2 — Vercel env vars

Run these from `OPS-Web/` with the Vercel CLI logged in. **Critical: do NOT paste the value directly into the Vercel web UI with a trailing newline.** Use the methods below which guarantee no newline.

### 2.1 Update `GOOGLE_PUBSUB_TOPIC`

```bash
# Remove the old (wrong-project, trailing-newline) value from production
vercel env rm GOOGLE_PUBSUB_TOPIC production

# Add the new value. Pipe via printf (no trailing newline) rather than echo.
printf "projects/civic-champion-439517-e7/topics/gmail-push" | vercel env add GOOGLE_PUBSUB_TOPIC production
```

If `vercel env add` prompts interactively instead of reading stdin, save the value to a file without a trailing newline and paste from that file:

```bash
printf "projects/civic-champion-439517-e7/topics/gmail-push" > /tmp/topic.txt
# Verify no trailing newline (wc -c should return exactly 56):
wc -c /tmp/topic.txt
# 56 /tmp/topic.txt   ← must be 56, not 57
# Then run `vercel env add GOOGLE_PUBSUB_TOPIC production` and paste the file contents.
```

### 2.2 Update `GOOGLE_PUBSUB_PUSH_AUDIENCE` (if changed)

Only if the audience changed from its current value:

```bash
vercel env rm GOOGLE_PUBSUB_PUSH_AUDIENCE production
printf "https://app.opsapp.co/api/integrations/email/webhook/gmail" | vercel env add GOOGLE_PUBSUB_PUSH_AUDIENCE production
```

### 2.3 Update `GOOGLE_PUBSUB_SERVICE_ACCOUNT`

Set to `<PUSH_SA_EMAIL>` from step 1.3:

```bash
vercel env rm GOOGLE_PUBSUB_SERVICE_ACCOUNT production
printf "<PUSH_SA_EMAIL>" | vercel env add GOOGLE_PUBSUB_SERVICE_ACCOUNT production
```

### 2.4 Verify no trailing newlines

```bash
vercel env pull .env.verify.production --environment=production
grep -E "GOOGLE_PUBSUB_(TOPIC|PUSH_AUDIENCE|SERVICE_ACCOUNT)=" .env.verify.production | cat -A
# Every line must end with a `$` sigil and nothing after it — no `\n$`.
rm .env.verify.production
```

Note: the code now calls `.trim()` on all three env vars, so a newline wouldn't break things anyway. But keeping the stored value clean avoids masking a future paste-error regression.

---

## Part 3 — Redeploy

```bash
# From OPS-Web/
vercel --prod
```

Or trigger a redeploy from the Vercel dashboard (**Deployments → Redeploy latest**) to pick up the new env.

---

## Part 4 — Reconnect Gmail (per user)

The old `email_connections` row has no `webhook_subscription_id` because `users.watch` failed. Reconnecting refires `users.watch` against the corrected topic.

1. User opens https://app.opsapp.co/settings/integrations
2. Click Gmail → **Disconnect**.
3. Click **Connect Gmail** → complete OAuth.
4. Within a few seconds, sync-engine calls `setupWebhook()` which calls `/watch` against the new topic.

---

## Part 5 — Verification

### 5.1 `email_connections.webhook_subscription_id` is populated

In Supabase SQL editor (or via MCP):

```sql
select
  id,
  email,
  provider,
  webhook_subscription_id,
  webhook_expires_at,
  status,
  last_synced_at
from email_connections
where email = '<user-email>'
  and provider = 'gmail'
order by created_at desc
limit 1;
```

Expect `webhook_subscription_id` to be non-null (it's the Gmail `historyId` returned by `/watch`) and `webhook_expires_at` to be ~7 days in the future.

### 5.2 Vercel runtime logs show a successful `users.watch`

```bash
vercel logs --follow --since=10m | grep -i "users.watch\|webhook setup"
```

Expect **no** `Invalid topicName` errors. A successful setup logs nothing; failure surfaces via `ProviderApiError`.

### 5.3 Live push delivery

Send a test email to the connected Gmail inbox. Within ~5 seconds the webhook route should receive a POST:

```bash
vercel logs --follow --since=2m | grep -i "Gmail Webhook"
```

Expect no `Audience mismatch` / `Service account mismatch` / `Invalid token` errors. If you see any, the env var values in Part 2 don't match what Pub/Sub is actually sending — re-check step 1.3 (service account email) and step 1.4 (audience URL).

### 5.4 Sync fires

```sql
select id, email, last_synced_at, last_sync_error
from email_connections
where email = '<user-email>'
  and provider = 'gmail';
```

`last_synced_at` should advance shortly after the test email arrives. `last_sync_error` should be null.

---

## Decision: GCP project architecture

### Current state

- **OAuth client** (Gmail, Calendar): `civic-champion-439517-e7` — an auto-generated GCP project name, not something we chose.
- **Pub/Sub topic** (pre-fix): `ops-ios-app` — created during iOS work when we assumed topics could live anywhere.
- These mismatch. Gmail rejects the combination. Hence this runbook.

### Near-term (do now — this runbook)

Create the topic in `civic-champion-439517-e7`. Unblocks production in ~20 minutes of console work. Zero migration cost. Downside: the project is still auto-named, which is confusing.

### Long-term options

Three paths worth considering when next you touch OAuth:

1. **Rename `civic-champion-439517-e7` → `ops-app-web`** (or `ops-app`).
   - GCP project **names** can be updated freely. Project **IDs** cannot — `civic-champion-439517-e7` will stay as the immutable ID, but the display name can change.
   - Pros: cheapest, zero migration, improves dashboard clarity.
   - Cons: the project ID stays ugly. Resource ARNs (topic names, service account emails) still embed the old ID. The OAuth consent screen shows the project name only, so end users see "OPS App Web" regardless — this is fine.
   - **Recommended.**

2. **Migrate to a new properly-named `ops-app-web` project.**
   - Pros: clean IDs, clean ARNs, fresh start.
   - Cons: non-trivial. Requires: creating new OAuth client, re-verifying with Google (scope review can take 4-6 weeks for `gmail.modify`), updating every env var, re-publishing the OAuth consent screen, asking every existing Gmail-connected user to reconnect (their refresh tokens become invalid). **High risk, high friction.** Only worth it if the current project is actually compromised or you want to hand ownership off.

3. **Consolidate iOS + web into a single `ops-app` project.**
   - Technically possible — one project can host multiple OAuth clients (one per platform).
   - Pros: single source of truth for all Google integrations. Easier billing. Cleaner.
   - Cons: same migration cost as option 2 (new OAuth client needed for web, same re-verify timeline). Also ties iOS and web blast radius — a misconfigured API quota affects both.
   - Worth considering only if Google requires it for some future feature (e.g. shared Workspace add-on). For now, separation is fine.

### Recommendation

Do **option 1** (rename) after this runbook is complete and production is stable. Do **not** migrate projects unless forced. The auto-generated ID in resource ARNs is cosmetic ugliness, not a functional problem.

Log the decision in `ops-software-bible/` once done so future-you has context when opening the GCP console in 6 months.

---

## Post-fix cleanup

- **Delete the stale topic** in `ops-ios-app` once production is verified — it'll otherwise show up as an orphaned resource on next audit: https://console.cloud.google.com/cloudpubsub/topic/list?project=ops-ios-app
- **Audit other env vars** for trailing newlines: `vercel env pull .env.production --environment=production && cat -A .env.production | grep '\\n\$'` — anything that shows a `\n` before `$` end-of-line has the same risk.
- **Update `ops-software-bible/04_INTEGRATIONS_BACKEND.md`** with the Gmail real-time architecture (OAuth project, topic project, subscription type) so this mismatch is documented going forward.
