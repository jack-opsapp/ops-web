# Cloud Instagram editorial production

Status: implemented and verified locally; no production activation or publication authorized. Operational contract and release procedure: `docs/social/cloud-editorial-operations.md`.

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
