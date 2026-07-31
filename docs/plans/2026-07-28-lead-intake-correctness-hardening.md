# Lead-intake correctness hardening implementation plan

**Goal:** Prevent contextual locality, unverified staff sender identity, and sticky historical stage repairs from creating or preserving false leads.

**Safety boundary:** Work only in this isolated worktree. Do not apply migrations, repair production data, mutate Gmail, push, merge, or deploy.

## 1. Establish one property-address identity boundary

- Add one shared TypeScript parser/normalizer that returns an identity only for:
  - a sufficiently specific civic/street address;
  - an explicit rural property form;
  - an explicit parcel/lot identifier.
- Preserve unit identity and canonical street/directional variants.
- Return no identity for cities, municipalities, neighbourhoods, regions, postal codes alone, vague areas, and mailing-only PO boxes.
- Replace address identity logic in:
  - opportunity relationship matching and existing-project conversion;
  - import lead deduplication and import extraction exclusion;
  - operator contact hygiene;
  - daily client/opportunity/project duplicate detection.
- Add the equivalent SQL boundary and route conversion preflight plus email conversion dedup through it.
- Prove negative locality cases and positive civic, unit, highway, rural-route, range-road, lot/concession, and parcel cases.

## 2. Add authoritative staff alias identity

- Add an RLS-protected `user_email_aliases` table with immutable company/user ownership, exact normalized email uniqueness, explicit status (`pending`, `verified`, `rejected`), evidence, and verification audit fields.
- Add a service-only guarded RPC that records a strongly corroborated sender as a pending alias without treating it as verified.
- Load active team-member names, registered emails, phones, and alias records into the authoritative operator identity.
- Classify exact registered and verified alias emails as operator-authored.
- For an unknown secondary sender, require one unique active member match using the full normalized team phone in the author-controlled signature plus the member’s full name; registered-team-email To/CC is additional evidence, never fuzzy authority.
- Treat a strongly corroborated but unverified sender as outbound with `match_needs_review`, persist the pending alias audit, and continue routing the real external To/CC recipients as eligible customer contacts.
- Use the same resolution in steady ingestion, provider-history replay, pending-lead replay, and the exact recovery worker.
- Keep public-domain customers external unless exact registered/verified identity or the complete corroboration contract applies.

## 3. Make decisive rejection a guarded Lost outcome

- Keep Won/discarded and operator-owned terminal Lost stages protected.
- Allow manually pinned non-terminal stages to be evaluated against newer durable customer evidence.
- Add a service-only guarded declined-disposition RPC that:
  - locks the opportunity and validates assignment/stage snapshots;
  - validates the exact persisted customer sender and evidence high-water mark;
  - rejects stale/out-of-order evidence and pending projections;
  - applies an idempotent Lost disposition with `price` when financial/price evidence exists, otherwise `customer_declined`;
  - supersedes only non-terminal or prior engine-owned dispositions;
  - records the stage transition and evidence provenance atomically.
- Call the RPC for deterministic declined outcomes before deferral/Won handling.
- Preserve temporary budget/timing deferrals as a separate `budget_timing` outcome with follow-up.
- Prove repaired historical false-Won behavior, newer acceptance/rejection precedence, manual terminal protection, retries, idempotency, and stale evidence rejection.

## 4. Keep contracts and documentation current

- Update generated database types for the alias table and new RPCs.
- Update the OPS Software Bible’s email-ingestion identity, address matching, and commercial lifecycle sections.
- Add migration contract tests and focused end-to-end ingestion/recovery tests.

## 5. Verify and package

- Run focused red/green tests for each boundary.
- Run the broader email ingestion, relationship, commercial outcome, summary, correspondence, recovery, assignment, and notification suites.
- Run TypeScript, lint on changed files, and a production build.
- Re-read the three live records and exposed locality-only leads without writes.
- Commit coherent atomic changes with conventional commit messages.
- Prepare a guarded, approval-only production repair and release sequence for Paul, Sandra, and Jason.
