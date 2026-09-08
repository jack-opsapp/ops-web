# Owner review compatibility repair — 2026-09-08

The authenticated production owner-review trial persisted a correct policy preview but the service rejected its response. The existing default tax ID is canonical PostgreSQL UUID text with non-RFC variant bits. `FinancialPolicyPreviewSchema.tax.id` incorrectly used RFC-strict `z.uuid()` instead of the shared PostgreSQL UUID contract used by financial-document capabilities.

The repair changes only that returned tax-ID schema. It does not alter the stored tax, tax rate, owner/actor/company authorization, source snapshots, exact preview hashes, enrollment decisions, financial effect seal, OAuth exposure or save authority. No migration is required.

Verification:

- Red: parameterized real component review/retry regression passed the ordinary UUID case but failed the existing-database UUID case (2 passed, 1 failed; enrollment button absent).
- Green: 28 focused tests passed across six files, including the component, owner service/route, readiness contract, canonical UUID rejection cases and financial canary.
- Full TypeScript validation passed with an 8 GiB Node heap. The default heap exhausted memory. The larger run exposed one pre-existing test-table tuple error; the canary table now wraps RPC row arrays in named `data` cases, so expiry and stale-consent checks exercise actual row arrays instead of malformed objects.
- Astra independently reviewed all three changed files and found no actionable issues.
- `git diff --check` passed. Signed-in production readback after release remains required; these tests are not financial host acceptance.
