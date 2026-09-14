# Email routing continuation verification

The post-release audit reproduced three independent routing gaps: unrelated surname suggestions suppressed valid inquiries; uncertain replies on new provider threads did not join an existing open lead; third-party introductions inherited the introducer's completed job. A downstream commercial detector also read a delivery duration as a confirmed date, while an appointment review reused an immutable key after its reason changed.

The correction requires plausible complete names, with a narrow explicit couple-contact review exception. Uncertain correspondence may join only the exact customer's unique open sales record when no existing project competes. Proven new work cannot reuse a closed relationship. A current affirmative introduction names the actual recipient as the customer while retaining the introducer as email author; the referrer's signature does not populate customer facts. Referral identity currently requires recipient display-name evidence, as preserved by Gmail; bare recipient addresses alone do not establish that identity.

Commercial duration/quote language no longer implies acceptance. Appointment review reasons have separate immutable keys, with exact unchanged legacy envelopes retaining their original key. Project identity and conversion guards remain enforced.

Verification on the integrated production base:

- 842 tests passed across 14 affected suites.
- 11 focused tests using the actual sync engine passed, including new reply, authorized review recovery, existing-project controls, referral creation/replay, and existing-job routing.
- All 15 changed TypeScript source/test files have zero scoped diagnostics; imported dependencies have 21 existing diagnostics.
- The full sync suite has the same 36 named failures on the unchanged base and this repair. Both initial new regressions pass after the correction. This is not a claim that the repository-wide test suite is green.
- Exact two-message recovery preflight passed against production. Recovery is separately journaled and must be read back after application.

Deployment, recovery, and production rechecks are recorded separately. No new database migration is required for these application corrections. Cross-customer thread recovery needs an additional guarded database contract and separate migration approval. Customer source emails, identities, database snapshots, and private recovery manifests remain outside this public repository.
