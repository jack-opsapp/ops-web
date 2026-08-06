# Systems Repair W1-6 production verification

Date: 2026-07-31
Production project: `ijeekuhbatykdomumfjx`
Disposable tenant: `ZZ_REPAIR_REHEARSAL_2026-07-31`

## Export

- Real production route returned HTTP 200.
- Exported 96 customer-data tables in 9.235 seconds over 107 database requests.
- Formerly omitted descendants were present: one `project_tasks` row and two
  `line_items` rows.
- The site-visit fixture was present.

## Atomic deletion

- The first destructive run failed at step 180 of 199 because
  `task_mutation_events` has an immutable-delete trigger.
- PostgreSQL returned SQLSTATE `55000`; every earlier purge mutation rolled
  back. The disposable tenant row and all 474 company/table fingerprint pairs
  remained. The only fixture fingerprint change was the pre-transaction auth
  resolver filling its previously empty identity link.
- Migration `20260731170226_account_purge_immutable_event_exception` added an
  exact-company, DELETE-only maintenance exception to the three immutable event
  triggers. It does not disable triggers or foreign keys. Direct service claims
  and UPDATE remain blocked.
- The successful rerun returned HTTP 200, completed 199 of 199 steps in one
  `purge_company_data` RPC, and reported 51 affected rows in 1.184 seconds
  over five database requests.
- `opportunity_manual_outbound_cycle_receipts` reported zero at its explicit
  step because its correspondence, opportunity, and activity foreign keys are
  all `ON DELETE CASCADE`; an earlier parent step had already removed it.

## Residual and cross-tenant audit

- The initial post-commit audit found two
  `user_permission_change_deliveries` rows created by the later user
  tombstones. The manifest now purges that delivery table after permission
  overrides and users; a regression test pins the ordering. The two disposable
  rows were removed.
- All 220 manifest tables were audited: zero hard-delete rows remained and zero
  soft-deleted tables retained an active fixture row.
- Retained audit/category rows and tombstones were removed as final fixture
  cleanup.
- A scan of every public UUID/text column found zero values with the fixture
  prefix. Public users, Auth users, and Storage objects also returned zero.
- Across non-fixture companies, no company/table pair disappeared and no row
  count decreased between the saved preflight and post-commit snapshots.
  Forty fingerprints changed during the roughly three-hour live interval due
  to normal inserts and updates; all row-count changes were increases.

## Collateral integrity findings

- The malformed notification tenant was traced to notification
  `002213ee-edd2-4ecc-8274-bac4c3300972`, an `email_anomaly` alert created on
  2026-07-18. The anomaly route copied `PMF_OPERATOR_COMPANY_ID` directly from
  the deployment environment, including its final newline.
- Every PMF operator-alert path now shares one boundary that trims environment
  values and rejects a non-UUID company id. The live
  `notifications_company_id_canonical` constraint is `NOT VALID`: it blocks
  future malformed writes without rewriting the one historical real-company
  row, whose repair was outside the fixture-only production write authority.
- The live `projects.status` default is the accepted lowercase value `rfq`,
  matching migration `20260730220727_fix_unusable_status_column_defaults`.

## Verification gates

- TypeScript type-check passed.
- Final focused verification passed: 123 tests across the manifest,
  delete/export routes, PMF normalization, affected operator-alert paths, and
  the notification tenant-key migration.
- Live function ownership and ACL readback passed: purge helpers are owned by
  `postgres`; only `service_role` can execute the public definer helper.
- Supabase security advisor reported no finding for the new purge functions.
