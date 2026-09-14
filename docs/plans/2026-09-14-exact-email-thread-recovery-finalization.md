# Exact email thread recovery finalization

**Goal:** Finalize a previously proven exact-message recovery across different customers without weakening ordinary same-client thread reassignment.

**Architecture:** A separate service-role RPC requires an active actor, exact live mailbox lease, immutable per-message recovery receipts, complete attachment custody, and current full opportunity/thread/link snapshots. It updates only the two thread ownership projections and writes one immutable finalization receipt in a single transaction. Existing exact-message RPCs own message moves, counters, attachment reattribution, and lifecycle reconstruction.

**Tech stack:** PostgreSQL 17, PL/pgSQL, isolated local SQL harness.

**Design system:** N/A; no product interface or copy.

**Required skills:** custom-skills:writing-plans, superpowers:test-driven-development, supabase:supabase, superpowers:verification-before-completion.

## Implementation and proof

1. Verify live schemas and existing child-reparent, mailbox lease, permission, receipt, and attachment contracts read-only. Keep customer identities in the private incident directory.
2. Write an executable PostgreSQL harness with synthetic customers and real ownership triggers. Demonstrate failure while the finalization RPC is absent.
3. Add only the private finalization ledger and exact actor-aware RPC. Retain the existing reassignment function and its same-client fence unchanged.
4. Test complete four-message success, replay, non-service actors, stale/expired lease, changed actor or receipt evidence, incomplete/mixed ownership, extra messages, unresolved attachments, changed identity/stage/archive/assignment/project snapshots, transaction rollback, and guard cleanup.
5. Record the exact private recovery order: create from the referred customer's own meaningful inbound, move remaining messages using exact RPCs, complete attachment scans and recovery receipts, capture finalization snapshots, finalize, independently read back, refresh canonical summaries, release the lease in nested finally.

## Release boundary

This task prepares a migration and local proof only. The parent task must obtain explicit production migration approval before application. The existing inbound-only recovery work registration is not extended, and the legacy thread reassignment overload is never used. The private plan must account for outbound exact-message RPCs and every attachment receipt separately.

## Verified local proof

The PostgreSQL 17 harness installs the actual deployed ownership triggers and attachment-state function against minimal synthetic tables. It runs 23 assertions and 37 expected-error contracts, plus concurrent insert/update fencing and rollback readback. Provider/storage workers and live permission policy data are not simulated; permission helpers are explicit test boundaries. The finalizer stabilizes all seven message/attachment/inspection/conversion dependency tables through transaction end. No existing helper or reassignment function is changed.
