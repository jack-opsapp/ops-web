# Requested immediate Instagram draft — September 5, 2026

Jackson asked to run preparation now. This is a real production-services draft initiated from the local operator session, not a cloud-scheduler execution. Deployed code, scheduled cadence, production environment and Instagram publication settings were unchanged.

- Draft: **A clean report can still be wrong.** Title: **Run the closed-job test**.
- Source: https://opsapp.co/journal/claude-fable-5-1-first-test-gpt-5-7-astra (live source ID `e0d5ff01-97cd-4168-bcc3-70b2cd094d2b`).
- Date identity: `2026-09-05`, kind blog, mode prepare, state prepared.
- Completed notification: `2026-09-06T00:12:29.32119+00:00`. Independent readback at 00:12:47 confirmed five previews, null post ID, zero social posts and one matching operator notification.
- Both writer and editor received the complete Sam Parr guide; fingerprint is retained in `result.json`. Both approved output and evidence are saved.
- Model calls: writer 9,336 input / 1,619 output; editor 9,925 input / 162 output. Total estimated US$0.112664. Recovery reused the saved package; no further model calls. Three conservative reservations remain US$2.25 against the unchanged US$20 monthly allowance.
- All five images independently returned HTTP 200 as 1080 × 1350 JPEGs with matching stored checksums. Evidence: `public-asset-readback.json`. Local JPEGs are the matching renderer output.
- Replaying the existing claim returned zero rows. Replaying the notification RPC returned zero notifications. Nothing entered the publishing queue.

## Failures found and corrected locally

1. The pinned HTTPS resolver used the single-address callback format even when Node requested `all:true`. Native Node reproduced `ERR_INVALID_IP_ADDRESS`; the same image returned 200 normally. The fix returns exactly the validated address in the required array or scalar shape. Private-address and redirect guards remain enforced. Regression: `tests/unit/social/public-media-transport.test.ts`.
2. JSONB changed the order of saved source properties. Byte-comparing JSON strings incorrectly marked an unchanged source as changed during retry. The fix compares each source field by value. All real source fields were independently revalidated before recovery. Regression: `tests/unit/social/editorial/repository-source.test.ts`.
3. The Mac's AWS identity permits blog uploads only. Production asset credentials are sensitive/unreadable, so no credentials were exported and no IAM changes were made. The requested draft was saved through the existing renderer's Supabase backend into the pre-existing public `social-media` bucket. This does not prove the scheduled cloud worker's S3 upload.

The first failed run retained the approved copy. The exact row's retry time was advanced after the image fix; a later mistaken `SOURCE_CHANGED` terminal state was repaired after full source-value verification. Both operator interventions are recorded in `attempt_log`. Attempt count, reservations, source and package were preserved.

## Release boundary

Automatic approval review rejected the production push because the immediate-run request did not explicitly authorize a production deployment. The protected manual POST trigger and both fixes remain local, tested with 291 focused tests and targeted TypeScript. A deployment approval question is pending. Existing automatic preparation remains configured, but the discovered image/retry fixes still need deployment. No first Instagram publication is authorized or performed.

`draft.md` is the reviewable caption and five-slide artifact; `result.json` is the saved production package. `invocation.json`, `completion.json` and `public-asset-readback.json` record the actual outcome.
