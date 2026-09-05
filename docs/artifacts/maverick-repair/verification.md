# Maverick MCP repair verification — 2026-09-05

Status: four reported repairs verified locally; production migration and push/deployment await Jackson's explicit approval. Production remains on `3a89c08ca1f5b827ccac2f6194842e83f8f7abc8` / `dpl_CTSMvUZksuStAK6yxFNxp5hWPmco`.

## Changes and proof

1. Validated OAuth scopes now use ASCII ordering, matching the consent catalogue and PostgreSQL `COLLATE "C"`. A regression passes all 21 scopes through the actual principal constructor, actor resolver, service reauthorization and repository; its RPC boundary assertion reproduced the catalog/catalog-cost swap before the fix. Exact identities, scope set, grant revision, consent labels and database authority checks remain enforced.
2. Conversation recent-turn/evidence projections retain their required connection, subject and distinct hash aliases while reading authoritative provider content. The full live v8 → v7 → v6 → v5 → v4 → v3 chain also exposed an invalid manifest-reproof call hidden behind the missing-column error. These conversation RPCs return a strict raw snapshot, without manifest-proof fields. Their wrappers now return that snapshot while retaining input/revision validation; the existing TypeScript repository independently validates its authorization binding. The generic reproof helper is unchanged.
3. All-day task context, discovery windows, overdue classification and work-queue attention use the established job-summary civil-date convention. Stored UTC date parts represent inclusive civil dates; each company-local midnight is resolved separately, with the end advanced by one civil date. The Paving March 15–16 fixture now ends March 17 at 07:00Z. Timed instants remain unchanged. Tests cover 23/25-hour days, 71/73-hour multi-day spans, partial dates, fractional timezone offsets and exact overlap/overdue boundaries. Summary agreement checks use its actual canonical civil-date helper/formula, not the complete summary RPC.
4. Harmless task/site-visit/integration selection order is normalized, and read-window UTC timestamps accept seconds plus optional 1–3 fractional digits, normalized to milliseconds. Duplicate/unknown selections, invalid calendar dates, non-UTC input and authority violations still fail. Canonical evidence/output timestamps remain strict. Advertised input schemas explain all-day exclusivity and the conditional project, financial-component, contact-purpose and job-kind requirements. Immutable capability/authorization catalogue fingerprints remain unchanged.

## Verification

- **892 tests / 78 files passed**, covering contracts, actors, immutable registry, customer updates, conversation repository/service, tasks, site visits, integrations, transport and grant-pinned exposure.
- **60 PostgreSQL assertions passed**: 16 conversation, 41 task and 3 invariant checks. Two pre-repair failures reproduced. Migration replay passed, with invariant readback repeated. Unexpected function drift was rejected.
- Full `tsc --noEmit --incremental false` passed with an 8 GiB heap. Focused ESLint passed without warnings/errors. `git diff --check` passed.
- Database invariants compare every synthetic business/grant/revision row and original function OIDs, owners, ACLs, security-definer flags, search paths and volatility. All remained unchanged. The new private helper denies execution to application roles.
- Live readback at **2026-09-05 19:05:14 UTC** confirms all seven production function hashes still match the guarded pre-repair definitions, the existing Maverick grant remains active with its original revision and 21 scopes, Paving's stored dates/updated_at are unchanged, and Maverick has **zero customer-update proposals**.

Reproduce the SQL proof with `bash tests/sql/agent-maverick-repair-run-runtime.sh`. It creates/removes only its own PostgreSQL 17 cluster using a unique Unix socket; no TCP or production connection. The fixture uses live function/column snapshots and real authority helpers. Unrelated production FKs, write-trigger execution and provider workers are not reproduced. The original Maverick reports and other Phase 12 artifacts remain untouched.

Exact migration: `supabase/migrations/20260905184652_agent_maverick_read_repairs.sql`.
SHA-256: `4c4022d54ba0278ca4d0d33705ce10c358242a00d4dfdb3bbb3a54aace40838d`.
The migration changes seven read functions and adds one private read helper; no table, business-row, grant, exposure or RLS-policy mutation. The readable SQL delta is [function-changes.diff](function-changes.diff).

## Additional platform finding and release limits

Production PostgreSQL's installed timezone data still resolves Vancouver midnight on November 2, 2026 to **08:00Z**; current local PostgreSQL/Node resolve **07:00Z**. B.C. [adopted permanent UTC−7 after March 8, 2026](https://news.gov.bc.ca/releases/2026AG0013-000209). This is an existing platform timezone-data mismatch, separate from the one-day task defect. The repair consistently uses the database's canonical resolver and does not replace timezone rules with an application-specific override. Production timezone-data refresh and post-November cross-runtime correctness remain unresolved; no claim is made that this migration fixes them. Fall-back fixtures use Los Angeles, which still observes that transition.

No production migration, push, deployment, proposal, business update or external message was performed. After release approval, rerun the authenticated Maverick conversation/task/input cases and the identical-title no-change probe, then independently read back the task and proposal count. Actual prepare/approve/commit remains a separate business action requiring exact authorization.

These changes introduce no new paid service or tier; existing hosting/database usage applies. A timezone platform upgrade is outside this release and needs its own operational assessment before execution.
