# Restricted site-visit OAuth trial verification — 2026-09-14

Implementation: exact client/actor/company-bound V22 exposure / V17 consent, fourteen scopes and twenty-one tools. Public registration remains V23 / V9. The migration seeds no company compatibility, effect policy, binding, OAuth client/grant, or business record.

## Verified locally

- Focused OAuth, subject resolver, bearer, exposure, candidate protocol and approval-service regression run: **802 tests passed across 20 files** with one worker, Node 22.23.2. No repository-wide baseline claim.
- Production-focused TypeScript and site-visit protocol TypeScript: exit 0.
- Real PostgreSQL 17 socket-only fixture: **53 assertions passed** using checked-in production function definitions and synthetic identities only. Covers consent, consumed code and grant minting; exact-subject lookup; no internal/API write bypass; exact OPS approval; readable queue/RLS helper; idempotent prepare/save/replay; permission and compatibility removal; separate OAuth definition and business effect seals; real wall-clock expiry; refresh rejection/revocation; immutable bindings; unrelated public V14/V23 client/grant/token preservation.
- Initial red fixture failed specifically with `SITE_VISIT_TRIAL_NOT_IMPLEMENTED`. Initial subject resolver and refresh tests reproduced the missing V22 lifecycle. The native bearer defense test separately reproduced acceptance after modeled subject-binding loss, then passed after adding V22 to the existing secondary defense.
- Independent Astra review identified the approval-queue visibility regression caused by stripping the original MCP identity. A real SQL assertion reproduced that failure. The guarded patch now preserves the original grant/client/scopes while refreshing permissions, and both visibility helpers pass. Reviewer closed the finding. Internal/API prepare still rejects.
- `git diff --check`: clean.

## Reproduction

Run `bash tests/sql/site-visit-trial-run.sh red` to observe the missing-trial baseline, or `bash tests/sql/site-visit-trial-run.sh green` to apply the pending migration to an isolated local database and exercise the complete fixture. Generated diagnostics remain under `docs/artifacts/phase19/trial-{red,green}/`; the harness stops its own server and retains its exact scratch directory for bounded debugging.

The fixture uses real checked-in OAuth definitions and actual private site-visit/workflow kernels; it is not a production database, browser UI or native Claude/ChatGPT/Codex acceptance run. Successful synthetic direct approval does not substitute for a human-visible OPS review and save in the native-host trial.

## Release and activation boundaries

Production preflight at 2026-09-14 20:28:27 UTC: zero site-visit compatibility enrollments/effect policies, zero active financial/catalog trials, new trial table absent. Nine existing function definitions are fingerprint-guarded in the new migration; no broad production function source export is required.

Release must use the current remote production commit plus only this scoped change, not the shared local main's unrelated unreleased history. No existing grant is repinned. The separately approved test-company enrollment remains gated on compatible-phone pending-work recovery and fresh exact host consent. Neither has been claimed by these tests. All saves remain exact OPS operator approvals. No provider messages, physical start/completion, financial/catalog resealing, paid API fallback, or App Store release is included.
