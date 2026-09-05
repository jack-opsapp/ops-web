# Phase 12 release candidate proof

Implementation commit: `71586d989`. Integrated with current shared main at `00bfc2499b384c2d5e6eb6feedcaa5b754ec7332`.

- PostgreSQL 17: 52 checks passed on the exact migration, including two overlapping company updates. See runtime-proof.md and runtime-result.json.
- Integrated application regression: 396 tests passed across 41 files, including MCP/OAuth/registry, exact update approval/privacy, and current Instagram release checks.
- Full TypeScript check passed with an 8 GiB heap after integration.
- Actual preview components were inspected in an isolated browser with synthetic records and production styles/fonts. This does not establish authenticated hosted acceptance.
- Read-only production preflight: 30 business triggers and 62 nested helper definitions unchanged from the reviewed graph; zero v14 clients, grants and approval actions.

## Database approval boundary

Automatic approval review rejected `supabase_apply_migration` for the exact source `supabase/migrations/20260904233000_agent_customer_opportunity_update.sql`. SHA-256: `e478142143fe9ebde253a1231cba34255a8d9757556187a6f324677c981831b2`.

The rejected operation would create private proposal/receipt persistence and one technical effect fingerprint, install service-only guarded RPCs, restrict access to this new approval type, and amend the existing assignment core/constraint and provider-draft suppression helper. It grants no OAuth client, tenant authority, host acceptance, schedule or business canary. Existing assignment machinery is touched, so this requires Jackson's exact production migration approval. No workaround or alternate DDL path was used.

Independent readback after rejection: private.agent_customer_updates is absent and the Phase 12 migration ledger count is zero. No database change was applied.

The dormant application code is backward compatible: the active exposure remains v2, no new proposal exists, and the visibility RPC is called only for this new action type. Existing queue paths do not require the unapplied database objects. Final application deployment status and the pending migration boundary are recorded in the Bible specification `specs/2026-09-04-ops-mcp-customer-opportunity-updates.md`.

Deployment uses the existing OPS hosting/database resources; no new paid service or tier is introduced. Provider usage remains under the existing plans.

## Approved activation continuation

Jackson explicitly approved the exact migration and enabling write access. The original migration was applied as production ledger `20260905033402_agent_customer_opportunity_update`, 77,521 bytes, MD5 `2b6326f6bc1c63706c9b20d0b1cdfa41`, SHA-256 `e478142143fe9ebde253a1231cba34255a8d9757556187a6f324677c981831b2`. Independent readback confirmed both private tables with RLS/no browser access, service-only mutation RPCs, restrictive SELECT/INSERT/UPDATE/DELETE rules, one valid technical effect fingerprint and zero proposals. The reviewed graph retained all 30 triggers and 62 helpers with only the two intended assignment functions changed.

The activation migration `20260905033621_agent_customer_update_oauth_activation.sql` updates the live bearer resolver for v14 while preserving v1/v2 and the v3 canary gate, requires immutable identity/consent/label/ceiling bindings, and permits least-privilege client ceilings without weakening the mandatory five update scopes. Tested SHA-256 `b1d8423379a94c2dbf0d0b5b3d694769ac4637a0d8af77f7b409e5533da8bbac`.

Verification: 104 real PostgreSQL OAuth assertions plus 44 authority/transaction assertions, 1,041 application/MCP/consent/public-guide tests, full TypeScript check, and independent review passed. Consent and English/Spanish guide distinguish read from prepare-for-approval. No hosted user consent, production grants, tokens or business edits are performed by this release. Existing connectors retain old scopes and need a new connection plus OPS consent for customer updates. Final applied activation ledger and production deployment are recorded in the Bible contract.
