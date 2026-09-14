# Phase 19 approval focused re-review

Verdict: PASS — all five findings closed; zero remaining findings in the requested scope. No new authority, privacy, receipt binding, or PostgreSQL time implementation defect found in the scoped review.

## Closures

1. **Chosen visit identity: CLOSED.** `20260910205717_agent_site_visit_workflow.sql:203–213` seals visit ID, authorized parent title/address and company-local appointment context. Parent joins require matching company plus actor visibility. `site-visit-changes-preview.tsx:125–143` renders that context and full visit reference; the answer proposal schema requires context ID to equal the target visit. Render tests distinguish targets.
2. **Exact appointment time: CLOSED.** Before/after and visit context include numeric UTC offset. The two historical Edmonton fold instants render differently. A second-precision remainder found during this re-review was fixed and independently rechecked; see closure evidence below.
3. **Template key: CLOSED.** Preview renders old/new slug through the checklist-key pair (`site-visit-changes-preview.tsx:231`). The permanent slug discrimination case passes.
4. **Substituted receipt: CLOSED.** Shared `site-visit-workflow-binding.ts` is used by both approval and host services. It checks exact actor/company/action/change/seal, operation, chosen visit, row count/unique IDs, company/parent/value/provenance, prior rows, missing requirements, effects, appointment and time proof. The approval service independently checks executed action identity/type/action data and persisted receipt. Original visit/company/row/value substitutions now fail even when both receipt copies agree. Actual receipts for all seven operations pass the validator.
5. **Null reminder semantics: CLOSED.** Both before/after null reminders say crew reminder defaults. Explicit zero remains 0 minutes before. Permanent rendered regression passes.

## Additional precision closure

The initial re-review reproduced identical text for accepted `2028-11-02T10:00:00` and `2028-11-02T10:00:45` bookings, America/Vancouver UTC−07:00, because short time formatting omitted seconds. Root fixed the shared formatter at `src/components/agent/site-visit-changes-preview.tsx:54`: nonzero seconds use medium time formatting. This applies to before/after appointments, visit context, and expiry.

Independent scratch test changed from the original equality reproduction to asserting different rendered text and passed against the fixed source. The new permanent visit-context seconds regression also passed. This remainder is CLOSED.

## Independent verification

- Node 22.23.2, five focused suites: **101 tests passed** (13 rendered UI, 27 approval, 36 forms, 15 service, 10 time proof).
- Final permanent rendered UI suite: **14 passed**, including the newly added seconds case. Independent scratch rendered suite: **14 passed** with the seconds discrimination assertion. `results.log` retains the original reproduction; `closure-results.log` records its fix.
- Independently ran the current synthetic PostgreSQL workflow runner with isolated scratch logs and port 55479: **24 PASS groups**, including DST gap/fold, explicit offsets, exact time proof, changed company timezone/ABA, current grant/role/RLS boundaries, and concurrent writer rejection.
- Fresh outputs from that independent database run: **37 values validated** under Node 22.23.2, including proposals/receipts for all seven operation families and eight actual PostgreSQL timezone cases.
- SQL time interpreter uses PostgreSQL timezone catalog, validates the civil timestamp, enumerates matching offsets, rejects nonexistent/unresolved repeated local times and invalid explicit offsets. `civil-time.ts` uses strict civil parsing and exact arithmetic only; it does not consult Node IANA rules. Service preflight checks proof against appointment/request, and prepare/commit bind the current proof and graph. Scoped time-authority implementation: PASS.

Artifacts: `/private/tmp/p19-approval-rereview-ku3r4m6k/` contains scratch UI test/config, results.log, closure-results.log, copied local runner, SQL logs, `sql/workflow-outputs.jsonl`, and `sql/contract-results.json`. Initial sandbox PostgreSQL initialization could not allocate shared memory; the authorized isolated local retry completed successfully. No production access, source edits, iOS builds, or new agents.
