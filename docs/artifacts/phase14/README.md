# Phase 14 verification — 2026-09-06

Scope: dormant exact task schedule/crew preparation and OPS approval. No production migration or activation has occurred as part of this verification. No real customer task mutation, provider send or grant change was performed.

## Verified local outcome

- 49 focused application tests passed across 8 files (`vitest-domain.log`).
- 35 prior customer-update, customer-message and schedule-dispatch tests passed across 7 files (`vitest-regression.log`).
- 43 delivery-source replay/normalization tests passed across 2 files (`vitest-delivery-replay.log`).
- 51 actual PostgreSQL assertions passed: 15 canonical/receipt, 20 negative/conflict/rollback, 16 crew/reminder/multi-target/security/UTC-rollover checks. Final runner exit 0. Logs: `runtime-tests.log`, `runtime-negative.log`, `runtime-positive.log`.
- Four real independent-session concurrency cases passed, including the production `reschedule_site_visit` function in both booking/approval orders. `concurrency-result.json` records observed barriers. Duplicate approval returns the same receipt; a preexisting project row lock fails immediately without deadlock.
- Full `tsc --noEmit --incremental false` passed. Final Next production build also passed compilation, type checking, static generation and trace collection using inert placeholder Supabase build credentials. `production-build.log` records preexisting warnings: image-route runtime re-export, libheif dynamic require, client async_hooks resolution warning, old Browserslist data. No production environment secrets were needed.
- Production preview component rendered with fictional typed fixtures, real Tailwind tokens and brand fonts. Browser inspection at desktop and 390px phone width showed complete before/after/scopes/effects text; phone document width and content width both 390px. The existing approval-detail tests cover integration. This is component visual proof, not signed-in production acceptance.
- Design audit: new preview typography uses Mohave/Cake Mono/JetBrains Mono tokens, spacing uses the existing 8-point scale, borders and text use named tokens, no hardcoded styling values. Included business text is rendered inertly. Existing approval controls are reused.

Local PostgreSQL uses live-captured canonical functions and representative task, scope, project and reminder triggers. Booking concurrency uses the real captured staff reschedule function graph. Fixtures intentionally omit unrelated foreign keys and the entire production/provider trigger graph; do not interpret these tests as a production clone or an external delivery canary.

## Migration artifacts and preflight

| Source | SHA-256 | State |
|---|---|---|
| `20260906234703_task_mutation_time_validation.sql` | `6b2455ec97e4aa06a4e051e37b00f8691405e30a162de7ac8e460d81fc08e158` | Awaiting exact production approval |
| `20260906235016_agent_schedule_crew_approval.sql` | `477d0d54baf5f6d8566a763c30cae9dc2c2d091b5d754c71dbff2c27a49d5520` | Awaiting exact production approval |

Fresh production read-only preflight at **2026-09-07 00:57:34 UTC** matched all required original definitions:

- Canonical task mutation MD5: `6511f1a0732408c8ef45d94c729c7d31`.
- Canonical schedule producer MD5: `bc89e2b1daac48d5413d1a16579d7959`.
- Canonical reminder trigger MD5: `12cf588ad8cfcc43075964bdd3fca235`.
- Phase 14 ledger absent; v16 clients 0; v16 grants 0.
- Vancouver November 2 midnight still resolves to 08:00Z in hosted PostgreSQL, while current rules and local Node/PostgreSQL resolve 07:00Z. The code fails closed on timezone mismatch; it does not repair hosted tzdata. A verified platform timezone refresh and separate activation/business-canary authority are still required.

## Reproduce

Use Node v24.19.0 (the bundled runtime here), installed project dependencies and PostgreSQL 17 binaries. `tests/sql/agent-schedule-change-run-runtime.sh` owns a disposable private-socket database, executes all local SQL/races, and removes its cluster on exit. It requires macOS shared-memory permission, not production access. Vitest commands and complete results are in the retained logs. The Next build requires syntactically present Supabase URL/keys; this proof uses `https://phase14-build.invalid` and nonsecret placeholder keys.

The separate Bible contract is `specs/2026-09-06-ops-mcp-schedule-crew-approval.md`. Its release record distinguishes code deployment, pending SQL, inactive consent/exposure and unproven business acceptance.
