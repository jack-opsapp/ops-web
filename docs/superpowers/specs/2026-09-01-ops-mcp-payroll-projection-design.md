# OPS MCP Payroll Projection — Phase 6 Design

## Outcome

Add one dormant, read-only `check_payroll_readiness` capability for the golden task: “Can I make payroll on the 15th?” It returns a sourced decision for one exact company-local target date, a cash-only floor, best/base/worst projections, the actual per-payer payment-delay distributions used, exact obligation and receivable attribution, freshness, and precise evidence gaps.

Phase 6 is local-only. Active MCP exposure remains v2. Exposure v8, manifest v14, and the database migration are implementation artifacts until a separate release authorizes push, deployment, migration application, grant/client registration, and activation.

## Contract boundary

- Host input is exactly `{ target_date: "YYYY-MM-DD" }`. Company, timezone, currency, observation time, cash, payroll records, obligations, receivables, payer history, definitions, and thresholds are server-owned.
- The target must be today through 93 company-local days ahead.
- The answer is `yes`, `no`, `at_risk`, or `insufficient_evidence`.
- `yes` requires complete decision-critical evidence and enough current cash to pay all OPS-recorded obligations through the final payroll cutoff without relying on a receivable.
- `no` requires complete evidence and a negative best case after every modeled receivable that could arrive before cutoff.
- `at_risk` means complete evidence crosses zero between best/base/worst scenarios.
- `insufficient_evidence` names every decision-critical missing, stale, invalid, inconsistent, or bounded source. It never invents a number.

## Authoritative sources

- Available cash: `expense_settings.forecast_current_balance`, captured by `forecast_balance_updated_at`, in `companies.currency_code`.
- A signed recorded cash balance remains truthful cash evidence. A negative balance is a deficit, not malformed data.
- Scheduled obligations: active `recurring_expenses`, extended additively with nullable `obligation_kind` and `due_time_local`.
- Scheduled-obligation coverage: `expense_settings.forecast_obligations_confirmed_through` and `forecast_obligations_confirmed_at`, both nullable. A decision requires coverage through the target date and a confirmation no older than 24 hours or older than any included recurring-obligation update.
- Current reimbursement obligations: approved/partially-approved/auto-approved `expense_batches` with `paid_at IS NULL`, using the canonical owed-amount rule and validating line currencies.
- Outstanding receivables: non-deleted sent, awaiting-payment, partially-paid, or past-due `invoices`, reconciled against non-void payments dated on or before the company-local business date. Future-dated payments never alter an as-of snapshot.
- Per-payer behavior: historical fully settled invoices grouped by `client_id`; non-void as-of payments of every sign are netted by date, and settlement is the first date from which cumulative net payments remain at or above invoice total through all later adjustments. `invoice.paid_at` is not used as the payment date, and legitimate imported settlement delays have no arbitrary ten-year cap.

No invoice due date is treated as an expected payment date. A due date is only the zero point for an observed payer-delay distribution.

## Timing and scenarios

- Every payroll recurring expense due on `target_date` must be explicitly classified as `payroll` and have `due_time_local`. The payroll cutoff is the latest payroll due time that day; all payroll due that day is included. PostgreSQL time and timestamp precision is preserved through six fractional digits so same-second ordering cannot change the answer.
- A same-day target is usable only before its exact company-local payroll cutoff. Once that instant has passed, OPS returns `payroll_cutoff_elapsed` and `insufficient_evidence` instead of using cash captured after payroll was already due.
- Other recurring obligations are expanded from `next_due_date` by cadence through the cutoff. An overdue recorded occurrence remains money owed and is included; crossing the current business date never makes it disappear. Same-day obligations are included only when their exact due time is at or before payroll cutoff.
- Approved unpaid reimbursements are already due and therefore precede payroll.
- Receivables carry date precision only. A projected arrival on the payroll date is excluded because its intraday arrival time is unknown.
- A payer distribution requires at least five fully settled historical invoices. Best uses empirical p25 delay; base uses p50. Worst includes zero receivable inflow because a historical distribution is not a collection guarantee. P75 remains disclosed as distribution evidence.
- Percentiles use deterministic nearest-rank selection over sorted observed delay days. Negative delay is allowed; no delay is inferred for missing history.
- If the best modeled arrival date has already passed while the invoice remains open, OPS does not roll that missed prediction forward. The receivable becomes unmodeled and can force `insufficient_evidence` when payroll depends on it.

## Money and integrity

- PostgreSQL emits decimal amounts as strings no longer than 64 characters. `NaN`, infinities, and wider numerics become a bounded invalid sentinel. TypeScript converts only exact company-currency minor units; no floats, silent rounding, or cross-currency conversion.
- Blank, oversized, or unsupported source cadence/currency text is normalized to a bounded invalid sentinel before contract parsing, then reported as the precise schedule/currency gap instead of turning the entire read unavailable.
- Non-finite or non-canonical source dates/timestamps are retained as invalid evidence, including a future invoice delivery timestamp. Calendar arithmetic preserves literal years 0001-9999 and unmodels any receivable whose projected date would leave that range.
- Open invoice balance is recomputed from non-void payments and compared with stored `amount_paid` and `balance_due`. A mismatch is disclosed and the receivable is not modeled.
- Provider IDs are not used to collapse records. Duplicate non-null provider identities are an integrity gap because two locally distinct records may otherwise be silently double-counted.
- Source rows and output evidence use opaque typed refs only. Customer, recurring-expense, and free-text contents remain untrusted business data and never select tools, authority, definitions, or actions.
- Result validation independently re-derives typed provenance, item sums, scenario attribution, payer-sample uniqueness and bounds, cash freshness, target horizon, cutoff timing, completeness state, and the exact decision. An unrelated overflow or evidence-gap flag cannot mask altered arithmetic or refs.

## Database and authority

- One bounded `SECURITY DEFINER` RPC, `read_agent_payroll_readiness_as_system`, returns the snapshot.
- Execute authority is revoked from `public`, `anon`, and `authenticated`, then granted only to `service_role`.
- The RPC rechecks the actor, company, active OAuth client/grant, exact grant revision and scope ceiling, consent labels, permission snapshot, manifest v14, exposure v8, and exact required scopes.
- Required permissions are `expenses.view`, `invoices.view`, `reports.view`, and `settings.company`, all company-wide.
- Required scopes are `ops.company.read`, `ops.expenses.read`, `ops.financial_documents.read`, `ops.financials.read`, and `ops.payments.read`.
- A new `payroll_readiness` read-domain revision is bumped by source triggers. Existing revisions and prior dormant exposure bytes remain immutable.
- Additive columns are accepted only with the exact nullable type, precision, no default, no identity/generated behavior, and exact check constraints; same-named drift fails migration replay closed.
- All collections and scalar widths are bounded; a reached collection bound is decision-critical insufficient evidence. The maximum source snapshot is 154,555 characters, below the separate 400,000-character result ceiling.

## Cost boundary

Phase 6 adds no paid service, model call, background job, or durable analytical result. If the migration is later approved, its four partial/composite indexes consume ordinary existing PostgreSQL storage and add maintenance work only to qualifying source-table writes. Runtime cost is one bounded service-role read per tool call.

## Versioned definitions

- Result schema: `2026-09-01.v1`
- Metric definition: `payroll-readiness:2026-09-01.v1`
- Capability manifest: `2026-09-01.capability-manifest.v14`
- Dormant exposure: `2026-09-01.mcp-exposure.v8`
- Cash and obligation-confirmation freshness: 24 hours
- Projection horizon: 93 company-local days
- Minimum payer sample: 5 fully settled invoices

## Verification

Tests must prove strict input and SQLSTATE mapping, target boundaries, the frozen exhaustive currency exponent table, exact conversion and checked aggregate overflow, valid/malformed/overdue recurrence behavior including literal years below 0100, pre/post same-day payroll cutoff, canonical reimbursement amounts across all accepted states and null/zero/positive approval values, durable net settlement across same-day and later reversals, invalid payer amounts, empirical percentiles, same-day receivable exclusion, future delivery rejection, canonical projection bounds, decision rules, item-level attribution, maximum source/result shape, every fail-closed gap, authority revalidation, v1-v7 byte stability, active v2 identity, source bounds, exact metadata/constraint/index guards, migration replay/parity, and disposable PostgreSQL 17 runtime behavior.
