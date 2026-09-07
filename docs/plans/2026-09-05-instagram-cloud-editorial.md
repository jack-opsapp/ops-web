# Cloud Instagram editorial production

Status: deployed and active in preparation-only mode after explicit approval; first publication remains separately unauthorized. Operational contract and release procedure: `docs/social/cloud-editorial-operations.md`.

Required Skills: custom-skills:executing-plans, superpowers:test-driven-development, supabase:supabase, ops-copywriter:ops-copywriter, superpowers:verification-before-completion.

## Design

Replace dependence on local scheduled Claude sessions with a Vercel worker and a durable Supabase editorial ledger. Reuse the existing seven-template renderer and ten-minute veto/publishing system. Do not import the unreliable old task prompts.

Five weekday slots at 10:00 Vancouver time (permanent UTC−7, pinned to avoid stale runtime timezone data): blog signals Monday/Thursday, practical protocols Tuesday, product/practical Wednesday, rotating dispatch/proof/release/roast Friday. Rotation is a preference: only use supported source material. Recent live blogs are authoritative inputs; other posts draw a fresh practical angle from those inputs. Product, release, proof, and dispatch formats require explicit supporting source evidence. No private customer data, invented testimonials, or inferred release status.

One run per local date. Same-day catchup until 20:00; do not dump yesterday's backlog. A database lease owns each attempt, reserves a conservative model allowance, and caps attempts at three. Store the source snapshot, reviewed submission, exact evidence excerpts, review verdict, and usage. Retries reuse the saved package after generation. Each run has one stable publisher idempotency key. Recovery never bypasses the existing renderer/publisher's failed or uncertain states.

Control lives in a service-only settings row, initially off. Prepare mode saves packages only and cannot enqueue a social post. Publish mode may enqueue only runs originally created in publish mode. Changing modes never releases earlier previews. Recheck control immediately before handoff. Admin-gated read API exposes run history and preparation output for verification; normal publishing continues through the existing social command deck and notification rail. No new visual system.

Two bounded OpenAI calls per attempt (writer, independent editor), existing monitored workload client, no SDK retries, no tools/network authority, 64KB serialized request bound and 4,000 completion tokens per call. Reserve $0.75 per attempt against a $20 monthly estimate allowance; do not refund reservations after crashes. Current standard Sol prices are $4/M input and $20/M output. Budget controls are conservative estimates, not a provider billing guarantee; hosting/storage are additional. Model/pricing selection is fixed in reviewed code.

## Implementation and verification

1. Add policy/source/candidate schemas and behavioral tests: Vancouver/DST slots, freshness, repeat suppression, evidence checks, voice, safe URLs and output ownership. Run failing tests then implement.
2. Add service-only control/run tables and invoker RPCs for atomic claims, budgets, leases, checkpoint/finalization, terminal recovery. Test exact migration in disposable local PostgreSQL, including concurrent claims, stale owners, budget exhaustion, access grants, and replay.
3. Add source repository, bounded writer/editor adapter and worker. Test prepare/off gates, retry/checkpoint behavior, source withdrawal, duplicate output, failed delivery reconciliation and no blind publication.
4. Add authenticated cron (every 15 minutes) and admin read route; register cron and document required activation. Test auth and safe errors.
5. Render a local nonpublishing fixture through the production renderer, run focused social regression tests and targeted TypeScript. Review source independently before release. Update bible and runbook, commit only this feature.

## Release boundary

Production database migration, code deployment, paid cloud activation and first real publication require Jackson's explicit approval. First deploy off, verify authorization and schema, activate prepare for a bounded canary, inspect the actual output, then enable publishing only after explicit approval. Do not use the existing submission endpoint as a preview: it starts automatic publication after its veto window.

## Local completion evidence (2026-09-05)

- All five implementation steps completed. Fresh focused social/API/admin verification: 273 passed, one opt-in paid canary skipped. The first parallel run had one image-render timeout; the full serial run passed, including that unchanged regression.
- Targeted production TypeScript and formatting passed. Exact migration passed in isolated PostgreSQL, including concurrent claims, mode changes during rendering, source withdrawal, terminal states, preview isolation, budget reservations, notification replay and service-only grants.
- A real writer/editor canary produced four JPEG slides through the production renderer. The real CloudProduction component rendered its saved output in a static browser fixture and was visually inspected. Successful canary model estimate: US$0.052068; an earlier failed attempt is excluded from that estimate.
- Independent review findings were fixed and covered by regressions: carousel image reuse, off-during-render handoff, persisted terminal state, rejected editor audit, same-source retry and shared alt-text limit.
- Full application build, cloud cron execution, live storage/notification delivery and first Instagram publication were not performed for this new feature. Production activation remains off and pending explicit approval.

## Approved release and canonical copy guide (2026-09-05)

Jackson approved production migration, deployment, and preparation-only cloud activation with the US$20 monthly allowance. His follow-up asked whether the workflow references the actual Sam Parr guide. Both stages now receive the complete versioned file, record its SHA-256 on the package/rejection audit, and prioritize OPS constraints over website-specific examples. The deployed cron also reads the guide and returns its fingerprint as a zero-cost bundle-readiness check. Input bound is 64KB; the conservative attempt reservation is US$0.75, preserving the same monthly allowance. Exact local PostgreSQL and 274 focused social/API/admin tests passed. A fresh full-guide canary produced five JPEGs for US$0.094948; first real Instagram publication remains unauthorized.

## Production release evidence (2026-09-05 23:52 UTC)

Final source `baa32daadafd37a931bd2bae9b6cee2147eb17fb` passed the full Vercel build as `dpl_7QzcFZb7nh8uTXwWne7kvCsaDv51` and is aliased to `app.opsapp.co`. Migration `20260905233314` is applied with service-only access. Independent readback confirmed `prepare`, US$20 allowance, zero editorial runs and zero social posts after activation. Authenticated cron invocations before and after activation returned HTTP 200 on the final deployment; both unauthenticated routes returned HTTP 401 with `Cache-Control: no-store`. Vercel reports the enabled 15-minute schedule on that deployment. Final focused verification passed 277 tests across 28 files and targeted TypeScript. The worker loaded the full guide in the cloud; no production model call, asset write or draft notification was forced outside the weekday window. First scheduled generation opportunity is Monday 2026-09-07 10:00 Vancouver (17:00 UTC). See `docs/artifacts/social-editorial/production-release-2026-09-05.md` for proof and remaining runtime limits.

## Requested immediate draft (2026-09-05 Vancouver)

Jackson requested a run now after preparation activation. The schedule correctly skips Saturday, so add a secret-authenticated POST-only `prepare_now` entry point on the existing cloud route. Bind the request to today's actual Vancouver date; do not fake the clock, change the schedule, reset the ledger, or enable publishing. Reuse source selection, full-guide writer/editor, renderer, leases, daily identity, budget and notification outbox. Require preparation both before the claim and on the claimed row to fence a concurrent switch to publishing. Test auth/body validation, current-date handling, weekend preparation, unchanged GET behavior, claim refusal and the mode race; deploy atop current production, invoke once and independently inspect the actual saved package/assets, notification and zero post queue.

## Immediate draft outcome and pending fixes (2026-09-06 00:12 UTC)

The production push was rejected by automatic approval review for lack of explicit authorization for this turn's production deployment. No push was retried or deployment performed. A safer one-time session invocation used existing production services and left deployed code/configuration unchanged. It produced “A clean report can still be wrong” / “Run the closed-job test,” five verified 1080 × 1350 JPEGs, one exact operator notification and zero social posts. Model estimate US$0.112664; only the first attempt called the writer/editor. Three preserved attempt reservations total US$2.25 against the unchanged US$20 allowance.

The live run exposed two bugs: Node's `lookup({all:true})` callback needs an address array, and JSONB reorders source properties, making JSON-string comparison incorrectly report a changed source on retry. Both were reproduced before fixes, covered by regressions, and corrected locally. The completed source was independently revalidated before repairing that exact mistaken terminal status; both operator recovery actions are retained in `attempt_log`, with no attempt/budget reset. Local S3 credentials are blog-prefix-only; sensitive production S3 credentials cannot be read back. This manual run used the already-existing public Supabase `social-media` bucket through the renderer's supported backend. No IAM, environment, schedule or schema changes were made.

Final focused social/API/admin verification: 291 passed across 30 files, targeted TypeScript passed. An approval question is pending for deploying the manual trigger and both reliability fixes. The scheduled worker's production S3 upload and these fixes in the cloud are not yet verified.
