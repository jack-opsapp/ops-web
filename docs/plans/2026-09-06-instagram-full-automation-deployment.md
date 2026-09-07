# Instagram Full Automation Deployment Implementation Plan

> Implementation uses `custom-skills:executing-plans`, as required by the OPS root instructions. This document records the release path; it does not grant deployment, migration, first-publication, or recurring-publication authority.

**Goal:** Prepare one clear takeaway post for every newly published OPS blog, alongside a recurring mix of other Instagram formats, and operate the approved publishing workflow entirely in the cloud.

**Architecture:** Move writing and editing to native Claude Cloud Routines using Jackson's subscription, subject to account-access and end-to-end proof. Preserve OPS cloud discovery, rendering, OAuth connection, publication queue, and notifications. Add durable identity for individual blog posts instead of treating two weekday slots as complete blog coverage. Keep creation separate from delivery so retries, subscription-limit pauses, and busy publishing days cannot silently discard an article. Do not use subscription credentials as an API-key replacement inside the Vercel generator.

**Tech stack:** Existing Next.js/TypeScript application, Vercel cron/functions, Supabase ledger and storage integration, existing S3 integration, native Claude Cloud Routines for subscription-funded authoring, Meta Instagram publishing client. The existing OpenAI API generator remains the currently deployed implementation until an approved cutover.

**Design system:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`; local `.interface-design/system.md` for existing admin patterns. The current root design system overrides stale font guidance in older files. Raster styling uses the centralized social theme because ImageResponse cannot resolve product CSS variables.

**Required skills:** `custom-skills:executing-plans`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`. Load current platform documentation and any additional skills required by implementation changes.

## Verified starting point

Checked 2026-09-06 23:58 UTC:

- `app.opsapp.co` resolves to READY production deployment `dpl_EgCpWezF2g2Bd5u1JE1yj85hgPdp`, source `4907dc649c28009079a600c78e7bbdcdb26b502e`.
- Production settings: `prepare`, US$20 monthly estimated generation allowance; one prepared run, zero published social posts.
- Production scheduler invocations were observed at 23:15, 23:30, and 23:45 UTC, all HTTP 200. These idle ticks do not prove successful scheduled generation.
- The existing daily selector chooses blog adaptations Monday/Thursday and other formats Tuesday/Wednesday/Friday. Its identity is a date, so it does not guarantee coverage of every blog.
- The writer explicitly says to extract one idea rather than summarize the article. This conflicts with Jackson's clarified blog-takeaway requirement.
- The tested manual trigger and two reliability fixes remain local: `d85c956d4`, `003566c8a`, `931723891`. The previous focused suite passed 291 tests; that result predates the new work in this plan.
- The Fable draft used the source blog thumbnail. Its cover treatment rendered every headline but ignored slide bodies. Five generated image files therefore did not demonstrate an understandable carousel.
- The one-time session run proved the existing Supabase social-media storage path. The deployed worker's S3 upload path and a first real Meta publication remain unproven.

## Product contract

1. Each newly published blog has one independently tracked Instagram adaptation. Repeated discovery, article edits, retries, and process restarts do not create duplicate posts.
2. A blog carousel identifies the article's actual subject, explains its main takeaways, and leads to the exact full article. It must stand alone for a reader who has never seen the blog.
3. Reusing the article cover is appropriate when the title and imagery clearly identify the same article. Subsequent slides prioritize readable explanations rather than repeating the same cover composition.
4. Other content retains its own recurring schedule: practical protocol Tuesday, supported OPS product behavior Wednesday, supported rotating format Friday. Blog publication drives blog posts; Monday/Thursday sampling no longer substitutes for complete coverage.
5. Both writing and editing retain the complete versioned Sam Parr guide and OPS evidence/voice requirements.
6. Every source is accounted for: queued, in progress, held, ready, published, or explicitly blocked. Failure, quality rejection, and budget exhaustion never masquerade as successful coverage.
7. Posting is paced through the delivery queue. A burst of blogs creates tracked work rather than simultaneous Instagram publications.
8. The approved recurring policy is preview, edit/stop opportunity, then automatic publication after the veto window. A human approval is not required for every routine future post once that policy is explicitly activated.
9. Jackson prefers included account usage and accepts whichever provider supports reliable cloud runs. Use native subscription-funded cloud authoring with no automatic paid API fallback or purchase of additional usage. Keep queued work during quota exhaustion and report the delay.

## Task 0: Prove subscription-funded cloud authoring

**Decision, 2026-09-06:** Prefer Claude Code Cloud Routines because the official service supports both scheduled runs and authenticated external triggers, allowing OPS to trigger an exact blog job. Routines consume subscription usage and run without the Mac. They remain a research-preview service, so documentation establishes capability rather than this account's access or production reliability. [Official routines documentation](https://code.claude.com/docs/en/routines).

OpenAI also documents cloud scheduled tasks using uploaded context, skills and connected tools, and ChatGPT Work shares Codex usage. It is a supported alternative if Claude account access or the integration cannot be proved; do not start two authoring systems. [Scheduled tasks](https://learn.chatgpt.com/docs/automations), [usage model](https://learn.chatgpt.com/docs/pricing).

1. Verify Cloud Routines availability, actual remaining subscription/routine limits, connected account, network access and usage-credit behavior in Jackson's account. Do not infer access from the presence of the local Claude application. Do not enable paid overage or change account-wide billing settings without authorization.
2. Place the complete Sam Parr guide, OPS editorial rules, format requirements and bounded writer/editor instructions in cloud-accessible versioned files. Do not depend on Mac paths. Native Claude performs the writing and editorial review; a cloud script must not call the existing OpenAI generator and silently create API charges.
3. Build a narrowly scoped authoring bridge: claim one durable OPS assignment, fetch that assignment's public sources, and return a validated draft package. Authenticate each operation, bind completion to the claimed job/source snapshot, reject stale/duplicate/foreign assignments, and keep Instagram credentials in OPS. Prefer OAuth for a connector; if using routine/API credentials, keep them in supported secret storage and scope them to the required actions. Never expose provider subscription session credentials.
4. The existing `/api/internal/social/posts` handler proceeds into rendering and the publication-review queue; it is not an appropriate prepare-only canary endpoint. Add or adapt a separate held-draft completion path with server-enforced mode and ownership checks before a routine is given write access.
5. Use the documented routine trigger for an exact blog job plus scheduled recovery that reconciles OPS pending assignments. Batch due non-blog work when practical. Preserve delivery records when a trigger fails or its acknowledgement is uncertain; do not fan out duplicate sessions blindly. Native routine schedules have a documented minimum interval of one hour; OPS's lightweight scheduler can retain its own cadence without starting a model session on every tick.
6. Routines share normal account usage and have a daily run cap. Extra runs can be rejected until reset; usage credits may permit paid overage if enabled. Inspect this account's behavior, pace dispatch, retain deferred jobs and avoid implying uninterrupted or unlimited execution. [Usage and limits](https://code.claude.com/docs/en/routines#usage-and-limits).
7. Test one held draft through a real native cloud session before switching off the old generator. Prove the run's account-based usage and absence of OpenAI/Anthropic model API calls in the bridge. Cut over only after the approved deployment and account scheduling configuration; retire the old API authoring path and duplicate local routines together. Do not remove a shared API key used by unrelated OPS features.

## Task 1: Make the blog carousel understandable

**Skills:** OPS copywriter, OPS design, frontend design, design-system audit.

**Existing files:** `src/lib/social/editorial/generator.ts`, `policy.ts`, `src/lib/social/contract.ts`, `src/lib/social/template-selector.ts`, `src/lib/social/template-catalog.ts`, `src/lib/social/render/render-social-post.tsx`, `src/lib/social/render/frame.tsx`, `src/lib/social/render/theme.ts`, and the affected files in `src/lib/social/render/treatments/`.

1. Add a focused regression using the saved Fable package: every substantive slide body must appear in the render tree, and later slides must not silently become title-only covers. Run it before changing the renderer and capture the failure.
2. Give blog adaptations their own writing instructions: identify the subject; select the article's key takeaways; preserve the context that makes them meaningful; end with a truthful reading action. Keep other formats' prompts separate.
3. Require the editor to check article identity, coverage of the selected takeaways, intelligibility without the caption, and the relationship between cover imagery and subject. Do not rely on factual grounding alone as a clarity test.
4. Compose a clear cover, readable takeaway slides, and an ending reading action. Carry each slide's body through all eligible treatments. Keep internal treatment labels out of audience-facing artwork.
5. Use `SOCIAL_THEME.canvas`, `text`, `textSecondary`, `line`, and `SOCIAL_FONTS.display/body/mono`; add documented spacing/type tokens when required rather than spreading new literals through components. Preserve the design-system font roles.
6. Render the repaired Fable post, a different blog topic, and representative non-blog formats. Inspect every real JPEG at phone viewing size for missing copy, overflow, contrast, relevance, and sequence. Add behavioral regression coverage for problems found; do not treat a successful image encoding as visual approval.
7. Verify the audience can reach the exact article from the chosen Instagram call to action on the actual account. Do not assume a printed caption URL provides a clickable path. Prefer the existing journal/profile route if it serves that need; do not silently overwrite profile links or introduce another public site without reviewing the concrete change.
8. Commit the coherent copy/render repair with its focused evidence.

## Task 2: Track every newly published blog

**Skills:** Supabase, systematic debugging, verification.

**Existing files:** `src/lib/social/editorial/repository.ts`, `worker.ts`, `policy.ts`, `runtime.ts`, `routes.ts`, `src/app/api/cron/social-editorial/route.ts`, and related tests under `tests/unit/social/editorial/` and `tests/sql/social-editorial-runtime.mjs`.

1. Re-read live table schemas, RLS, grants, publication timestamp behavior, and current production migrations through Supabase MCP. Inspect all paths that publish `blog_posts`; discovery must observe shared live state rather than only the admin editor.
2. Implement durable per-blog discovery keyed by the immutable blog ID, separate from recurring date-based jobs. Use a persisted rollout boundary and pagination so new publications cannot fall between scans. Preserve the existing daily ledger and its completed Fable preview/audit.
3. Generate an additive migration with the repository's migration tooling after confirming the current schema. Do not rewrite an applied migration or apply the new migration to production during local implementation.
4. Require one adaptation job per blog and separate stable identities for recurring posts. A blog used as evidence for a protocol must not count as having received its own takeaway post.
5. Persist source snapshots, generation output, retry state, ownership leases, and downstream publication identity. Refresh changed source content before publication; cancellation/unpublication blocks delivery. Edits to an already published blog do not automatically republish it to Instagram.
6. Keep unfinished jobs across dates. Bound retries, show blocked reasons, and retain the work for deliberate recovery. Budget exhaustion delays jobs and notifies the operator rather than dropping them or increasing the allowance.
7. Preserve existing preview-only behavior and mode-change fences. Enabling future publication must not flush old held drafts into the queue.
8. Prove: several blogs published on one date all create distinct jobs; repeated discovery creates zero duplicates; a crash resumes saved work; a source used by another format still gets its blog adaptation; source withdrawal blocks delivery; concurrent claims cannot double-submit; exhausted budget preserves pending coverage; ordinary edits do not trigger another post.
9. Update the admin read model to distinguish each article and recurring job using existing social inspection patterns. Keep title, source, preview, delivery state, and actionable failures visible without exposing internal credentials or implementation identifiers.
10. Commit the migration and application work in coherent units after local SQL and focused application checks pass.

## Task 3: Complete reliability and delivery behavior

**Existing files:** `src/lib/social/public-media.ts`, `src/lib/social/asset-store.ts`, `src/lib/social/editorial/repository.ts`, `src/lib/social/publisher.ts`, `src/lib/social/publish-policy.ts`, `src/lib/social/publish-cron-handler.ts`, `src/lib/social/notification-service.ts`, `vercel.json`.

1. Integrate the already-tested image-download and source-value comparison fixes plus the protected manual draft trigger into current production source. Preserve concurrent changes, especially cron workload control and schedule staggering; do not push this stale worktree wholesale.
2. Choose and prove the production social-asset upload path without exporting secrets or weakening shared storage permissions. Do not change the global storage backend just to repair social posting.
3. Pace ready jobs through the existing publishing queue. Preview assets and caption must match the actual publication package. Start the veto period only when the full preview is available; no publication before its deadline.
4. Verify STOP/edit behavior, publication mode changes, duplicate protection, expiry handling, and uncertain Meta outcomes. A timeout after Meta may have accepted a post must enter reconciliation rather than blind re-publication.
5. Validate existing account renewal behavior and cloud monitoring for missed scheduler heartbeats, stuck jobs, publication failures, token problems, and budget pauses. A monitor must operate independently of the Mac and of the worker it monitors. Use existing cloud health infrastructure where it provides that guarantee.
6. Keep in-app preview/failure notifications. Do not add Slack, email, or other external messages without explicit authorization for that channel and purpose.
7. Run the appropriate focused social/API/admin regression suite, local migration harness, targeted TypeScript and production build. Inspect actual JPEGs and the admin preview. Record exact results; previous test totals are not evidence for these new changes.

## Task 4: Deploy preparation and prove cloud execution

**Authorization gate:** Present the exact tested code release and additive migration after local work is complete. Jackson's explicit approval is required before the production push/deployment and migration. The earlier rejected push is not authorization for this larger release.

1. Integrate only this feature's changes onto current production source, preserving sibling work. Check the final diff and re-run affected checks.
2. Apply the approved additive migration with publication disabled; verify actual schema, access rules, preserved audit rows, and preparation mode independently.
3. Deploy the approved code and verify the customer-facing domain targets that version with its intended schedules and workload controls.
4. Run one blog adaptation and one supported non-blog format through native subscription-funded cloud authoring. Verify the exact account/run, saved source, writer/editor references, render output, public image retrieval, notification, held state, and absence of model API calls in OPS for those jobs.
5. Verify at least one genuine scheduled execution from provider logs and durable output. Repeat discovery/invocation and confirm no duplicate job, generation, notification, or social publication. No step depends on a running Mac.
6. Inventory the older local Instagram generators/publishers and their pending outputs. Before cloud publication is activated, disable the exact duplicate schedules with authorized, reversible changes and reconcile any pending posts. Preserve unrelated blog-writing and newsletter workflows.

## Task 5: First publication and recurring activation

**Authorization gate:** Show Jackson the finished first post. Obtain explicit authority for that real publication and the recurring automatic-publishing policy. This is separate from permission to deploy code; the approval can cover the first post and future qualifying posts together if stated explicitly.

1. Run the approved post through its full preview and veto path.
2. Independently verify the Instagram media ID/permalink, correct account, caption, complete carousel, working article access path, and exactly one matching durable published row. Inspect the actual Instagram result.
3. Activate recurring publication only after the first-post proof and within the approved policy. Release new qualifying work; do not automatically release earlier held drafts.
4. Verify the production setting, future queue pacing, STOP control, renewal path and independent cloud failure monitoring. Record the legacy schedule cutover and a rollback procedure that also accounts for posts already in a veto/publishing state.
5. Update `/Users/jacksonsweet/Projects/OPS/ops-software-bible/03_DATA_ARCHITECTURE.md`, `04_API_AND_INTEGRATION.md`, `07_SPECIALIZED_FEATURES.md`, and `docs/social/cloud-editorial-operations.md` with precise local/deployed/live proof boundaries. Preserve unrelated dirty Bible content.

## Cost and completion evidence

- Subscription-funded runs consume Jackson's shared Claude allowance and routine limits. Keep pending work when limits are reached; do not automatically buy credits or fall back to paid model API calls. Verify plan eligibility and account billing controls before claiming there will be no overage. Hosting and storage remain separate existing OPS costs.
- The currently deployed API generator still has its US$20 estimated monthly allowance until cutover. Its prior draft was estimated at US$0.112664. Neither amount describes native subscription pricing. This plan amendment changes the preferred architecture only; it has not changed production settings or account billing. Prove the replacement before an approved cutover disables this generator, and quantify any newly proposed hosting or external-service cost.
- Full deployment is complete only when every eligible new blog is durably accounted for, other formats run on their own cadence, artwork is readable and faithful to its source, scheduled cloud execution is proven, one approved post is verified on Instagram, the recurring policy is active, duplicate local publishers are retired, and cloud failure/renewal monitoring is operational.
- Test output alone, a READY deployment, an HTTP 200 cron tick, or a saved draft does not satisfy that completion standard.
