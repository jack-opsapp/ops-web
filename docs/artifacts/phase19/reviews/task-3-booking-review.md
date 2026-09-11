# Focused canonical booking review

**Current ruling after fixes: approved for the named canonical-booking vertical.** The initial findings below are preserved as review history; the re-review section at the end supersedes the initial merge assessment.

Scope: completed canonical booking migration `20260910204942_site_visit_canonical_actor_booking.sql`, booking fixture builder, SQL assertions, and runner. Read-only source review; the only checkout write is this requested report. No production queries or mutations. The unfinished overall MCP workflow is not assessed as completed.

## Strengths

- Compared each extracted private core directly to its captured live function with a generated unified diff. Book, reschedule, and cancel retain their validation order, defaults, reminder clear semantics, activity effects, queue effects, stage movement, and replay behavior. The substantive extraction changes are explicit active actor/company lookup, actor permission helper, and exact-value booking tokens.
- Completion differs from the captured private completion implementation only by minting the activity-link token before updating `activity_id`. The existing completion aggregation, terminal rules, and activity upsert remain intact.
- Explicit actor cores and token minting are revoked from PUBLIC, anon, authenticated, and service_role. Public wrappers preserve their signatures and resolve Firebase/auth IDs through the existing identity helper. CREATE OR REPLACE preserves the original public function ACLs in production.
- Tokens are bound to transaction, backend, visit, and expected JSON values and consumed before mutation. The gate is dormant by default, applies to either old/new company, and keeps ordinary capture/status advancement possible. The service-role bypass is explicit and consistent with the requested existing backend-writer compatibility.

## Important findings

### P1 — Block direct deletion of protected bookings

File: `supabase/migrations/20260910204942_site_visit_canonical_actor_booking.sql:58-59` (guard implementation also assumes NEW throughout lines 24-55).

The trigger only covers INSERT and UPDATE. Captured live grants include DELETE for authenticated and anon; captured `company_isolation` and restrictive `assigned_lead_scope_delete` policies allow a legitimately authorized phone user to delete a booked visit. DELETE therefore avoids the new guard entirely, removes the appointment, and never invokes canonical cancellation, its activity, pending create/update neutralization, or remote calendar deletion. The captured calendar trigger itself only covers INSERT/UPDATE.

Reproduced in disposable PG17: installed the captured site_visits RLS policies, granted only SELECT/DELETE to authenticated, set the real fixture Firebase-style claim, booked an assigned lead, then `SET ROLE authenticated; DELETE ...` returned `DELETE 1`. All nine original checks still passed immediately before this reproduction. The synthetic fixture then retained one pending create. That orphan detail is fixture-specific because FKs are omitted; the bypass and absent canonical deletion path do not depend on those omitted FKs.

Fix: add a DELETE branch using OLD before any NEW access; reject direct authenticated/anon deletion of enabled booked rows, with an explicit intentional trusted service-role/purge exception if needed. Preserve unbooked/disabled compatibility. Add an actual-role regression proving denial and canonical cancel success. Do not merely include DELETE in the trigger event list without making the body DELETE-safe.

Evidence: `/private/tmp/booking-review-t009uvh4/delete-proof.sql`, `/private/tmp/booking-review-t009uvh4/delete-proof.log`.

### P2 — Exercise the live capacity guard and application roles in the booking fixture

Files: `tests/sql/build-site-visit-booking-fixture.py:59-68`, `tests/sql/site-visit-mcp-booking.sql:15-60`, `tests/sql/site-visit-mcp-booking-run.sh:12`.

The builder installs helper bodies but only two synthetic triggers. It omits the captured live `site_visits_guard_agent_approved_capacity` trigger (and its backing capacity dependencies), all captured RLS policies and existing public function ACLs. Tests set JWT claims but run every RPC and raw update as postgres. The privilege test samples three negative privileges; it does not execute public wrappers as authenticated, trusted backend writes as service_role, or demonstrate a private-call denial under either role. Consequently the nine notices accurately prove the fixture assertions, but do not establish the requested real-role, capacity-fence, or full trigger compatibility.

Fix: add a bounded integration fixture that installs the captured capacity trigger/dependencies, real site_visits policies and relevant ACLs, then test public book/reschedule/cancel/complete as authenticated, private-entry denial as authenticated and service_role, trusted provider metadata writes as service_role, and disallowed phone metadata writes. Cover a real capacity conflict, a non-conflicting booking, no-op reschedule, and cancellation while a fence exists. Keep unsupported unrelated trigger families explicitly outside the proof claim. Add one mismatched JWT vs explicit actor service-role case on a new lead so the stage transition proves explicit-actor behavior through `move_opportunity_stage`.

## Concurrency and additional bounded proof

- Opportunity FOR UPDATE serializes duplicate canonical bookings on one lead; reschedule/cancel lock the visit and retain terminal checks. The fixture currently proves sequential duplicate rejection, not a two-session race.
- The canonical booking core locks the opportunity at lines 93-98, then calls `move_opportunity_stage` at line 186. The captured move helper obtains `lock_lead_assignment_company` before locking the opportunity. A simultaneous independent stage move can therefore invert company/opportunity ordering. This is inherited from the captured live booking body, not introduced by extraction, and is not presented as a new regression. Before claiming deadlock-free integration, take the company lock before the opportunity consistently (or use a documented equivalent retry/order strategy) and add a deterministic two-session check.
- Nine checks do not prove token replay isolation across transactions/backends, altered expected-value rejection, enabled-vs-disabled legacy compatibility, or cross-company/deactivated actor rejection. The token design supports the expected protection on inspection, but a completed local authority proof should include these targeted negative cases.
- Existing capacity guard uses a try-advisory lock and rejects fixed-snapshot isolation; neither those outcomes nor full MCP transaction lock ordering are covered here. No inference about unfinished MCP commit code is made.

## Verification performed

- Read the complete 648-line migration and all three fixture files.
- Compared captured live book/reschedule/cancel/completion bodies against new definitions.
- Inspected captured identity, permission, relationship, completion, calendar, live trigger, grant, and RLS metadata; inspected the existing local capacity-guard definition.
- Independently ran the original booking harness in a separate disposable PostgreSQL 17 cluster, with logs redirected to `/private/tmp/booking-review-t009uvh4/`. All nine PASS notices reproduced; original project artifacts were not overwritten.
- Reproduced the DELETE hole under authenticated role with captured row policies. PostgreSQL shared-memory initialization required the approved local sandbox escalation. Cluster was stopped and removed by the runner.

## Assessment

Ready to merge this focused vertical: **with fixes**. The canonical extraction is faithful and the nine existing assertions are real, but protected-booking DELETE must be closed and the named role/capacity integration boundaries need direct proof. No production release, activation, full MCP workflow completion, or calendar provider reconciliation is claimed.


## Re-review of completed fixes

**Ruling: accepted for this focused canonical-booking vertical. No remaining demonstrated functional blocker in the reviewed changes.** This does not approve activation, deployment, the unfinished sealed MCP transaction, or whole-system behavior.

### Findings disposition

- **P1 resolved.** The guard now handles DELETE first, consults OLD for booked/company state, returns OLD for allowed compatibility paths, and rejects enabled booked non-service-role deletion with `SITE_VISIT_BOOKING_RPC_REQUIRED`. The trigger includes DELETE. Independently reproduced the actual authenticated-role regression with captured RLS/table grants; it requires the exact guard error rather than accepting an unrelated missing privilege error. The service-role exception is intentional and visible in code.
- **P2 addressed for the named permission/capacity fixture.** The builder now installs captured site_visits row policies and table grants, plus current captured capacity functions, fence columns, and the live-named capacity trigger. A real overlapping active task/fence causes the canonical booking call to reject with the precise capacity-conflict error. Existing booking/reschedule/cancel/completion checks also run with that trigger installed. This closes the original omission of the capacity trigger and supplies an actual application-role denial test.
- **Inherited lock-order concern corrected on inspection.** `book_site_visit_for_actor` now acquires the actor company's lead-assignment lock before opportunity FOR UPDATE, matching the captured stage mover. Reentrant stage movement keeps canonical side effects. This resolves the identified inversion on the normal same-company booking path; a general multi-session deadlock proof was not performed.

### Independent verification

Rebuilt and ran the expanded fixture in a fresh disposable PostgreSQL 17 cluster. **All 11 PASS notices reproduced.** Logs are `/private/tmp/booking-rereview-__i8cdmi/booking-tests.log`; fixture and migration logs are in the same directory. The runner stopped and removed its database cluster. Project-owned logs were not overwritten. Source changes were not made by the reviewer.

### Exact proof boundary

The eleven checks establish canonical effects, scoped rejection, booking overwrite protection, completion compatibility, actual-role DELETE denial, and approved-task capacity-conflict rejection in this named fixture. They do **not** establish every unrelated production FK/trigger interaction or remote calendar reconciliation.

The broader matrix suggested in the first review remains outside these eleven assertions: public RPC success under SET ROLE authenticated, explicit service-role caller execution with mismatched JWT actor, service-role metadata update, full public-function ACL recreation, cross-backend token replay, company-gate disabled compatibility, and deterministic two-session concurrency. The implementation did not add tests for all of these. This is recorded as a limit on proof, not represented as covered or as an independently observed defect. Any subsequent claim of full role/transaction integration must be backed by that broader workflow's tests.
