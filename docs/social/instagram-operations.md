# Instagram Publishing Operations

This runbook covers the OPS Web queue, renderer, operator veto, Vercel worker, and Meta Instagram publishing boundary.

## Current release state

The feature code and migration are local only. It is **not deployed**, the database migration has not been applied, Vercel environment values have not been added, and no real Instagram post has been sent. Each production step requires explicit approval.

## Production prerequisites

- An Instagram professional account connected to the correct Facebook Page and Meta app.
- A Meta access token with the publishing permissions required by the account setup.
- A verified Instagram professional account ID.
- A currently supported Graph API version selected deliberately from the Meta app configuration.
- Public HTTPS JPEG URLs that Meta can fetch without cookies, headers, or expiring signatures.
- A Vercel plan that supports the configured two-minute cron schedule.
- The `20260901235149_create_social_publishing.sql` migration applied and independently read back.

## Vercel environment contract

All values are server-only. Never prefix them with `NEXT_PUBLIC_`.

| Variable | Required | Purpose |
|---|---:|---|
| `SOCIAL_AUTOMATION_SECRET` | Yes | 32+ character bearer secret for scheduled-agent submissions |
| `CRON_SECRET` | Yes | Vercel cron bearer secret; the route fails closed when missing or shorter than 32 characters |
| `INSTAGRAM_ACCESS_TOKEN` | Yes | Meta token used only by the server-side Graph client |
| `INSTAGRAM_USER_ID` | Yes | Instagram professional account ID |
| `INSTAGRAM_API_VERSION` | Yes | Explicit supported Graph API version, for example the version approved in the Meta app at release time |
| `INSTAGRAM_API_ORIGIN` | No | Defaults to `https://graph.facebook.com`; exists for testability and controlled API routing |
| `SOCIAL_OPERATOR_USER_ID` | Recommended | OPS `users.id` receiving review/publication/failure notifications |
| `SOCIAL_OPERATOR_COMPANY_ID` | Recommended | Company invariant paired with the operator user |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` | When `STORAGE_BACKEND=s3` | Public rendered-asset storage |
| `STORAGE_BACKEND` | No | `s3` by default; set `supabase` for the existing public `social-media` bucket fallback |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | Queue, blog verification, notifications, and Supabase Storage fallback |

If the two dedicated social operator IDs are absent, notifications fall back to `PMF_OPERATOR_USER_ID` and `PMF_OPERATOR_COMPANY_ID`. If neither complete pair exists, publishing still works but review notifications are skipped with a server warning. Configure the dedicated pair in production.

Generate the two bearer secrets independently with a cryptographically secure generator. Store them only in Vercel’s encrypted environment settings and the scheduled agent’s secret store. Rotate either secret immediately after suspected disclosure.

## Runtime flow

1. The agent calls `POST /api/internal/social/posts` with bearer auth and `Idempotency-Key`.
2. OPS Web validates the live blog source and versioned content contract.
3. The selector chooses one of seven treatments using fit, title length, media, recent repetition, and feed balance.
4. The renderer produces public 1080 × 1350 JPEGs. S3 is the default; Supabase Storage is the fallback.
5. The post enters `review` and opens a 10-minute veto window in `/admin/social`.
6. An operator may edit and regenerate, stop, or publish immediately. Editing begins a fresh 10-minute window.
7. Vercel calls `GET /api/cron/social-publish` every two minutes. The worker atomically claims no more than two due rows.
8. For each claim, OPS checks `content_publishing_limit`, creates and polls Meta containers, publishes once, then stores the media ID and permalink.
9. Success resolves the veto notification. Exhausted or terminal failure creates a persistent operator notification.

The table is service-role only. Browser roles have no queue privileges or RLS policy. Admin mutations pass the existing Firebase admin-email gate.

## Retry and duplicate safety

- Database claims use `FOR UPDATE SKIP LOCKED`, a unique claim token, and a three-minute expiry.
- The worker uses bounded retry delays of **5, 15, and 60 minutes**.
- HTTP 429, HTTP 5xx, and Graph errors marked transient are retryable.
- Validation, permission, account, media, and terminal container failures remain failed until an operator corrects the cause and chooses `RETRY NOW`.
- An agent delivery retry must reuse its original `Idempotency-Key`.
- `PUBLISH NOW` and `RETRY NOW` use the same claim and quota checks as the cron worker.

Meta’s `media_publish` response has a uniquely dangerous failure mode: the network can fail after Meta accepted the post but before OPS received the media ID. This becomes `PUBLISH_OUTCOME_UNKNOWN`. **Do not retry** that row. First inspect the Instagram profile and Meta tools, identify whether the post is live, and reconcile the database manually. A blind retry can publish a duplicate.

Likewise, `PUBLISHED_ACK_NOT_PERSISTED` means Meta returned success but the durable acknowledgement failed. Do not retry. Reconcile the Instagram media ID/permalink and the row under a controlled database repair.

## Operator actions

### Edit

Available only in `review` or `failed`. The existing assets stay intact while the replacement is rendered. A failed regeneration restores the prior asset metadata and records `SOCIAL_EDIT_RENDER_FAILED`. A successful regeneration resets attempts and opens a new veto window.

### Stop

Available only in `review` or `failed`. It moves the row permanently to `cancelled`, clears future work, and resolves its review notification. The audit record and rendered assets remain available.

### Publish now

Available in `review`. It records the admin identity and requests the same atomic publisher used by cron. It does not bypass Meta quota or container readiness.

### Retry now

Available in `failed`. Use only after the named root cause is corrected. It resets the bounded attempt counter, atomically claims the row, and uses the normal Meta path.

Published and cancelled rows are immutable in the admin API.

## Failure response

1. Open `/admin/social` and record the post ID, error code, attempt count, and latest audit event.
2. For `PUBLISH_OUTCOME_UNKNOWN` or `PUBLISHED_ACK_NOT_PERSISTED`, stop. Do not retry. Reconcile Instagram first.
3. For quota exhaustion, wait for the `content_publishing_limit` window to recover.
4. For token or permission failures, rotate/re-authorize the Meta token, update Vercel Production and Preview values deliberately, then retry one row.
5. For media fetch or container failures, verify each stored JPEG is public, returns `image/jpeg`, and is exactly 1080 × 1350. Regenerate through `EDIT COPY` if needed.
6. For worker/auth failures, verify `CRON_SECRET` matches Vercel’s bearer header and inspect function logs without printing secrets.
7. After repair, read back the row and Instagram profile. Never infer publication from one HTTP response.

## Token rotation

1. Create or refresh the token through the approved Meta account flow.
2. Verify the token belongs to the intended Instagram professional account and exposes the required publishing permissions.
3. Update `INSTAGRAM_ACCESS_TOKEN` in Vercel Preview first.
4. Run a mocked or dedicated non-publishing configuration check; never use a customer-facing post as a credential probe.
5. Update Production only with explicit deployment approval.
6. Revoke the previous token after the new value is verified.
7. Record the rotation date and owner outside the repository. Never commit tokens.

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

1. Review and apply the Supabase migration; verify schema, RLS, grants, functions, and zero-row claim behavior.
2. Configure Preview environment variables and verify the agent/auth/render/admin paths with Meta publishing disabled.
3. Configure a Meta test path and verify one deliberate single image and one carousel.
4. Configure Production environment values.
5. Deploy OPS Web with explicit approval.
6. Verify the Vercel cron registration and one zero-work invocation.
7. Submit a controlled post, inspect the exact artifact in `/admin/social`, and stop it during the veto window.
8. Submit a second controlled post and explicitly authorize the first real Instagram publication.
