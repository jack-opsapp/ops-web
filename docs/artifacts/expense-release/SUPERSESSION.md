# Expense release supersession (2026-09-15 UTC)

Two migrations were applied to production on 2026-09-15 through the Supabase migration mechanism,
which stamps its own apply-time ledger version. The prepared filename versions below were never
applied under their own names and no longer correspond to any ledger row. This file records the
mapping so the prepared bodies stay traceable.

## Ledger `20260915062403` — `expense_release_atomic`

Applied 2026-09-15T06:24:03Z. The applied SQL is a single atomic bundle:
146,738 bytes, SHA-256 `4d53da61929337ab783070818f387ac1e8650cd900230fd7685418a32c543d22`,
`statements[1]` MD5 `4d1122b53e9e0218df4d243149fcae0d`.

The bundle supersedes these four prepared constituents, which it contains:

| Prepared version | Name | SHA-256 |
|---|---|---|
| `20260912012607` | `expense_decision_company_authority` | `07b6791dbeb19e365d20361242d5cb1103cff6b5037ce0a56d3c4e5a3b3d6cef` |
| `20260912203328` | `expense_accounting_lifecycle` | `77b420827c616996a062f35787e6bb257141b1c7da468a4253a61536ee922e23` |
| `20260914200910` | `expense_payroll_reimbursement_projection` | `78db2cee099061cd5d31be11a8de4c174cbb6022a0c66c590f08feb53902dc0b` |
| `20260914214748` | `expense_admin_correction_review` | `f5a6d66815c8e9468817fc28d24a5fe1d7caa68dcb671b3b379a1ad227b5f015` |

## Ledger `20260915062603` — `project_task_reopen_receipts`

Applied 2026-09-15T06:26:03Z. Prepared under filename version `20260914210950`; applied unchanged.
12,417 bytes, SHA-256 `18845d0b67e5b6116ec4e41c165e5a85e4472e22e8f99a60580a462e004b2657`,
`statements[1]` MD5 `b9472e0fd4867fe627796963a8dd9183`.

| Prepared version | Applied version | Name |
|---|---|---|
| `20260914210950` | `20260915062603` | `project_task_reopen_receipts` |

## Rule

**The archived constituents must never be replayed.** They are kept for provenance and as test
fixtures only — they are the exact bodies the SQL harnesses and their assertions were built
against, which is why the harnesses load them from the archive rather than from the bundle.
Production already carries their effects through `20260915062403`. Applying any constituent
individually — to production or to any environment expected to match it — is out of contract.

Migration discovery must see only the two applied files:

- `supabase/migrations/20260915062403_expense_release_atomic.sql`
- `supabase/migrations/20260915062603_project_task_reopen_receipts.sql`

## Verification

Each archived constituent and each applied file was SHA-256 verified against the values above at
the time this record was written. For both applied files the whole-file MD5 (trailing newline
included) equals the ledger `statements[1]` MD5, confirming the checked-in copy is byte-identical
to what production ran.
