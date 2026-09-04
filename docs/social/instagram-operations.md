# Instagram Publishing Operations

This runbook covers the OPS Web queue, renderer, operator veto, Vercel worker, and Meta Instagram publishing boundary.

## Current release state

Production code and both social migrations were deployed and independently
verified on 2026-09-03. The required Vercel values are configured, including a
rotated sensitive `CRON_SECRET` and pinned `INSTAGRAM_API_VERSION=v25.0`. The
admin route and fail-closed agent and cron boundaries were verified against the
production domain.

No Instagram account is connected and no real Instagram post has been sent.
An admin must complete `CONNECT INSTAGRAM` before the worker can publish, and
the first live post remains a separate explicit release gate.

## Production prerequisites

- An Instagram professional account added to the OPS Meta app's Instagram API setup.
- Instagram business login configured with the exact production redirect URI:
  `https://app.opsapp.co/api/admin/social/instagram/callback`.
- Meta permissions `instagram_business_basic` and
  `instagram_business_content_publish` approved for the account setup.
- A currently supported Graph API version selected deliberately from the Meta app configuration.
- Public HTTPS JPEG URLs that Meta can fetch without cookies, headers, or expiring signatures.
- A Vercel plan that supports the configured two-minute cron schedule.
- The `20260901235149_create_social_publishing.sql` and
  `20260902195639_create_instagram_connection.sql` migrations applied and independently read back.

## Vercel environment contract

All values are server-only. Never prefix them with `NEXT_PUBLIC_`.

| Variable                                                                    |                  Required | Purpose                                                                                      |
| --------------------------------------------------------------------------- | ------------------------: | -------------------------------------------------------------------------------------------- |
| `SOCIAL_AUTOMATION_SECRET`                                                  |                       Yes | 32+ character bearer secret for scheduled-agent submissions                                  |
| `CRON_SECRET`                                                               |                       Yes | Vercel cron bearer secret; the route fails closed when missing or shorter than 32 characters |
| `INSTAGRAM_APP_ID`                                                          |                       Yes | Instagram App ID from Meta business login settings                                           |
| `INSTAGRAM_APP_SECRET`                                                      |                       Yes | Instagram App Secret from Meta business login settings                                       |
| `INSTAGRAM_TOKEN_ENC_KEY`                                                   |                       Yes | OPS-generated base64 32-byte AES-256-GCM key; never stored in Supabase                       |
| `INSTAGRAM_API_VERSION`                                                     |                       Yes | Pinned supported version; the build defaults to `v25.0`                                      |
| `INSTAGRAM_GRAPH_ORIGIN`                                                    |                        No | Defaults to the official `https://graph.instagram.com` host                                  |
| `SOCIAL_OPERATOR_USER_ID`                                                   |                       Yes | Active OPS `users.id` receiving review/publication/recovery notifications                    |
| `SOCIAL_OPERATOR_COMPANY_ID`                                                |                       Yes | Exact active company paired with the operator user                                           |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` | When `STORAGE_BACKEND=s3` | Public rendered-asset storage                                                                |
| `STORAGE_BACKEND`                                                           |                        No | `s3` by default; set `supabase` for the existing public `social-media` bucket fallback       |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                     |                       Yes | Queue, blog verification, notifications, and Supabase Storage fallback                       |

If the two dedicated social operator IDs are absent, notifications fall back to `PMF_OPERATOR_USER_ID` and `PMF_OPERATOR_COMPANY_ID`. If neither complete pair exists, review notifications are skipped and any recovery alert remains durably pending; the worker will not acknowledge that outbox row until it can create the persistent notification. Configure the dedicated pair in production.

OPS generates `SOCIAL_AUTOMATION_SECRET`, `CRON_SECRET`, and
`INSTAGRAM_TOKEN_ENC_KEY` independently with a cryptographically secure
generator. Store them only in Vercel's encrypted environment settings; only the
automation bearer also belongs in the scheduled agent's secret store. Jackson
supplies the Meta App ID and App Secret. Rotate a value immediately after
suspected disclosure.

The Instagram user ID and access token are not Vercel variables. An admin opens
`/admin/social`, chooses `CONNECT INSTAGRAM`, and completes Meta login. OPS
exchanges the one-hour grant for a long-lived credential valid for roughly 60
days, encrypts it before database storage, and records only safe account
metadata in the admin response. The browser and scheduled agent never receive
the token or app secret.

## Runtime flow

1. An admin connects the professional account once from `/admin/social`.
2. The agent calls `POST /api/internal/social/posts` with bearer auth and `Idempotency-Key`.
3. OPS Web validates the live blog source and versioned content contract.
4. The selector chooses one of seven treatments using fit, title length, media, recent repetition, and feed balance.
5. The renderer produces public 1080 × 1350 JPEGs. S3 is the default; Supabase Storage is the fallback.
6. The post enters `review` and opens a 10-minute veto window in `/admin/social`.
7. An operator may edit and regenerate, stop, or publish immediately. Editing begins a fresh 10-minute window.
8. Vercel calls `GET /api/cron/social-publish` every two minutes. Before claiming work, the worker verifies the connection and takes the single-worker token-refresh lease when needed.
9. For each claim, OPS checks `content_publishing_limit`, creates and polls Meta containers, publishes once, then stores the media ID and permalink.
10. Success resolves the veto notification. Exhausted, stale, or uncertain work enters a leased database outbox; the persistent operator notification and outbox acknowledgement commit atomically.

Every Meta request has a 12-second network deadline. The queue also records `claimed`, `container_ready`, `publish_requested`, and `publish_succeeded` stages under the active claim token. That ledger is the authority for crash recovery.

The table is service-role only. Browser roles have no queue privileges or RLS policy. Admin mutations pass the existing Firebase admin-email gate.

## Retry and duplicate safety

- Database claims use `FOR UPDATE SKIP LOCKED`, a unique claim token, and a three-minute expiry.
- The worker uses bounded retry delays of **5, 15, and 60 minutes**.
- Four total attempts provide the initial delivery plus all three bounded retries.
- HTTP 429, HTTP 5xx, and Graph errors marked transient are retryable.
- Validation, permission, account, media, and terminal container failures remain failed until an operator corrects the cause and chooses `RETRY NOW`.
- An agent delivery retry must reuse its original `Idempotency-Key`.
- `PUBLISH NOW` and `RETRY NOW` use the same claim and quota checks as the cron worker.

Meta’s `media_publish` response has a uniquely dangerous failure mode: the network can fail after Meta accepted the post but before OPS received the media ID. This becomes `PUBLISH_OUTCOME_UNKNOWN`. **Do not retry** that row. First inspect the Instagram profile and Meta tools, identify whether the post is live, and reconcile the database manually. A blind retry can publish a duplicate.

Likewise, `PUBLISHED_ACK_NOT_PERSISTED` means Meta returned success but the durable acknowledgement failed. Do not retry. Reconcile the Instagram media ID/permalink and the row under a controlled database repair.

An expired claim is recoverable only before `media_publish`: `claimed` and `container_ready` may be reclaimed while an attempt remains. If the final pre-publish lease expires, the row becomes terminal `PUBLISH_ATTEMPTS_EXHAUSTED` instead of staying stranded in `publishing`. Expired `publish_requested` or `publish_succeeded` rows are moved to `reconciliation_required` and locked from edit, stop, publish, and retry actions. A `rendering` row older than 15 minutes becomes `STALE_RENDERING`; edit it to build a fresh package. All four transitions create replayable recovery-notification work.

When an operator successfully begins a corrective edit, stops the post, or requests a safe retry, the same database transaction cancels any pending recovery-notification lease and resolves the exact persistent failure alert. A failed replacement render creates a fresh recovery event, so fixing one failure can never hide the next one.

## Operator actions

### Edit

Available only in `review` or `failed`. The complete existing content, selection, and asset package stays intact while the replacement renders. A failed regeneration records `SOCIAL_EDIT_RENDER_FAILED` without swapping any part of the prior package. A successful regeneration atomically swaps the complete replacement, resets attempts, and opens a new veto window.

### Stop

Available only in `review` or `failed`. It moves the row permanently to `cancelled`, clears future work, and resolves its review notification. The audit record and rendered assets remain available.

### Publish now

Available in `review`. It records the admin identity and requests the same atomic publisher used by cron. It does not bypass Meta quota or container readiness.

### Retry now

Available in safely retryable `failed` states. Use only after the named root cause is corrected. It resets the bounded attempt counter, atomically claims the row, and uses the normal Meta path. Reconciliation-required and failed-edit rows never expose this action.

Published and cancelled rows are immutable in the admin API.

## Failure response

### OAuth completion incident — 2026-09-04

The redirect allowlist change reached the OPS callback. Production request
`2w868-1788560282142-8defd3a8dfff` at 22:18:02 UTC failed during connection
completion on deployment `dpl_7BCJY52J5SB6KwmY7qdCrLSzCUH3`. Its one-time state
was consumed; no connection or social post was stored. The existing callback
log contains only a generic failure, and Vercel has no saved trace. The exact
completion failure is not yet proven.

The diagnostic change in this worktree is **local, pending production approval**.
It logs source-defined stages (`state_validation`, `admin_validation`,
`code_exchange`, `token_upgrade`, `profile_lookup`, `token_encryption`, and
`connection_storage`), allowlisted local error codes, numeric HTTP/provider
codes, and fixed response-shape labels. The service also records `oauth_exchange`
when the nested Meta flow fails. It never logs credentials, authorization codes,
state, emails, URLs, provider messages, stack traces, or response bodies. Public
callback responses and all OAuth/publishing behavior are unchanged.

After an approved deployment, start one fresh `CONNECT INSTAGRAM` attempt and
read the two stage-level log entries for that request. Correct the evidenced
failure, then verify the encrypted account row and displayed username. An
expired or consumed authorization code must never be replayed. Do not infer a
successful connection from callback HTTP 307 alone, and do not publish a test
post.

### Publishing failures

1. Open `/admin/social` and record the post ID, error code, attempt count, and latest audit event.
2. For `PUBLISH_OUTCOME_UNKNOWN` or `PUBLISHED_ACK_NOT_PERSISTED`, stop. Do not retry. Reconcile Instagram first.
3. For quota exhaustion, wait for the `content_publishing_limit` window to recover.
4. For token or permission failures, use `RECONNECT INSTAGRAM` in `/admin/social`, verify the connected username, then retry one row.
5. For media fetch or container failures, verify each stored JPEG is public, returns `image/jpeg`, and is exactly 1080 × 1350. Regenerate through `EDIT COPY` if needed.
6. For worker/auth failures, verify `CRON_SECRET` matches Vercel’s bearer header and inspect function logs without printing secrets.
7. After repair, read back the row and Instagram profile. Never infer publication from one HTTP response.

## Token renewal and reconnection

Meta long-lived Instagram user tokens are valid for about 60 days. The existing
two-minute worker checks the encrypted connection before claiming posts. Once a
token reaches seven days before expiry and is at least 24 hours old, one worker
claims the database refresh lease, asks Meta for a replacement, encrypts it, and
atomically swaps it into the connection row. Other workers continue without
refreshing the same credential.

If proactive refresh fails while the current token remains valid, publishing may
continue with the current credential and the safe refresh failure is retained
for operations. Expired, revoked, malformed, or scope-deficient credentials fail
closed before a post claim. Use `RECONNECT INSTAGRAM`; do not paste a token into
Vercel or the database.

## Storage operations

Rendered objects use deterministic keys:

```text
social-media/{postId}/{renderVersion}/slide-{nn}.jpg
```

S3 objects are written with immutable public caching. The Supabase Storage fallback writes to the public `social-media` bucket. Both paths persist SHA-256 digest, dimensions, byte count, content type, order, alt text, and storage key in `social_posts`. Source images are normalized and stripped of metadata before composition.

## Schedule and cost

The two-minute cron runs about 21,600 times in a 30-day month. Vercel does not charge a separate cron fee; invocations consume the project’s normal function allowance. Sub-daily cron schedules require Pro or Enterprise. Rendering occurs only on submission or edit, so idle ticks perform a bounded indexed claim and exit. No new rendering vendor is required.

Before production approval, re-check the current [Vercel Cron Jobs documentation](https://vercel.com/docs/cron-jobs) and [Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing) because limits and rates can change.

## Production activation checklist

Do not combine these gates into one inferred action.

1. Review and apply both Supabase migrations; run `OPS_RUN_SOCIAL_POSTGRES_RUNTIME=1` against an isolated PostgreSQL 17 database to verify exact migration application, RLS/grants, concurrent claims, refresh leases, every expired-stage branch, atomic recovery notifications, and zero-row replay.
2. Configure Preview environment variables and verify the agent/auth/render/admin paths with Meta publishing disabled.
3. Add the exact callback URI to Meta business login settings, open `/admin/social`, choose `CONNECT INSTAGRAM`, and verify the expected `@username` compact state.
4. Configure Production environment values.
5. Deploy OPS Web with explicit approval.
6. Verify the Vercel cron registration and one zero-work invocation.
7. Submit a controlled post, inspect the exact artifact in `/admin/social`, and stop it during the veto window.
8. Submit a second controlled post and explicitly authorize the first real Instagram publication, then verify one deliberate carousel.
