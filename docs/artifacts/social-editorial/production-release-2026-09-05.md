# Cloud editorial release — 2026-09-05

Jackson explicitly approved production migration, deployment and preparation-only activation with a US$20 monthly estimated model allowance. First real Instagram publication is not authorized. No publication or queue submission was performed.

## Deployed source and schedule

- Source: `baa32daadafd37a931bd2bae9b6cee2147eb17fb`.
- Vercel deployment: `dpl_7QzcFZb7nh8uTXwWne7kvCsaDv51`, full build READY at 23:50:52 UTC.
- Production alias independently returned by Vercel: `app.opsapp.co`.
- Deployment hostname: `ops-eswhf6igy-jacksons-projects-f76fa6e8.vercel.app`.
- Vercel `crons ls` returned `enabled: true` and `/api/cron/social-editorial`, `*/15 * * * *`, targeting that exact hostname.
- The weekday generation window is 10:00–20:00 Vancouver, pinned UTC−7. First opportunity after this Saturday activation: Monday 2026-09-07 10:00 Vancouver / 17:00 UTC.

## Database readbacks

Supabase project `ijeekuhbatykdomumfjx` applied the exact additive migration as `20260905233314`. Schema verification confirmed RLS, no anon/authenticated access, and all seven RPCs with invoker security, fixed empty search paths and service-role-only execution. The RLS-with-no-policy advisor notes are intentional for these service-only tables.

| Time (UTC) | Verified state |
| --- | --- |
| 23:48:39 | Exact singleton `id=true`, mode `off`, allowance `20.00`, runs 0, social posts 0 |
| 23:51:50 | Guarded update matched `id=true AND mode=off AND monthly_budget_usd=20`; returned mode `prepare`, allowance `20.00` |
| 23:52:20 | Independent readback: mode `prepare`, allowance `20.00`, runs 0, social posts 0 |
| 23:52:46 | Readback after cloud invocation: mode `prepare`, allowance `20.00`, runs 0, social posts 0 |

Required environment names were present. Only the non-secret operator IDs were inspected: the normalized fallback identifies active Jackson Sweet and an active matching company. Existing trailing whitespace prompted the tested normalization fix. No credential was printed or exported. A bulk environment-export request was rejected by automatic approval review; verification proceeded through metadata, exact non-secret IDs and Vercel's server-side authenticated cron invocation.

## Runtime checks

| Time (UTC) | Request | Result |
| --- | --- | --- |
| 23:51:24 | Unauthenticated `/api/cron/social-editorial` | 401, `Cache-Control: no-store`, fixed unauthorized response |
| 23:51:25 | Unauthenticated `/api/admin/social/editorial` | 401, `Cache-Control: no-store`, fixed unauthorized response |
| 23:51:25 | Vercel authenticated cron, mode off | 200, final deployment, cache BYPASS |
| 23:52:25 | Vercel authenticated cron, mode prepare, Saturday | 200, final deployment, cache BYPASS; zero run/post rows afterward |

`runCloudEditorial` loads the guide before recovery and worker execution. Successful authenticated invocations therefore prove the guide is readable in the cloud bundle. The CLI does not return the function response body: the runtime fingerprint was not directly observed. The deployed file and the full-guide local canary both have SHA-256 `33eb69c729c46c56995cedcb87955b732eeba763b0d6a93401e3e6c404ab086e`.

## Local proof and limits

- Final focused social/API/admin regression: 277 tests passed across 28 files; optional paid canary skipped by default.
- Targeted TypeScript passed. The full final production build passed on Vercel.
- Exact migration passed the disposable PostgreSQL concurrency, stale-lease, attempt/budget, mode-change, source-withdrawal, preview isolation, recovery, grants and notification-replay tests.
- Separate real full-guide writer/editor canary produced five 1080 × 1350 JPEGs through the production renderer. Successful-attempt model estimate: US$0.094948; earlier failed usage is excluded. Both stages received the complete versioned guide as style guidance, with OPS rules and source evidence taking priority.

Production model generation, asset storage, authenticated admin draft inspection and draft-notification delivery are not yet observed because no eligible weekday has occurred since activation. No schedule override or forced publication was used. The first scheduled run will supply that end-to-end runtime evidence. Preparing drafts needs no running Mac; publishing remains disabled by the `prepare` setting.
