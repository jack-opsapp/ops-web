# OPS MCP Complete Read Catalogue — P2 Design

**Status:** Approved for local implementation by Jackson on 2026-08-22. This approval covers the isolated branch build only; it does not authorize a database apply, push, deployment, OAuth grant change, or production exposure.

## 1. Outcome

Complete the OPS remote MCP read surface so an authorized assistant can answer the ordinary operating questions a trades business asks of OPS without receiving generic database access.

The existing eleven production reads remain unchanged. Twenty-two purpose-built reads add customer context, work management, site evidence, sales documents, payments, expenses, supply, company context, team context, integration health, and an operational overview. The resulting catalogue contains thirty-three read-only tools. Every write capability, including all existing prepare/commit shells, remains unavailable and externally disabled.

“Complete” means all useful business data that can be exposed through a bounded, permission-preserving product contract. It does not mean every stored column.

## 2. Permanent boundary

The MCP may return current, actor-visible business facts needed to understand or operate the company. It must never expose:

- database, SQL, schema, migration, queue, lease, retry, or raw audit internals;
- OAuth tokens, provider credentials, webhook secrets, cursor material, encryption material, or authentication/session data;
- billing-provider, Stripe, banking, payroll, tax-filing, or payment-instrument secrets;
- private employee email, phone, home address, emergency contact, live location, device, Firebase, or authentication identifiers;
- role-administration internals, permission overrides, or security-policy data;
- deleted, merged-away, soft-deleted, superseded, or cross-company records;
- raw provider payloads, raw setting JSON, internal model prompts, unrestricted memory, or unrestricted company exports;
- raw storage paths, permanent file URLs, private attachment provenance, or unbounded file bodies;
- free-form internal notes by default. A capability may return a specifically approved narrative field only when its contract marks it as untrusted business data and its permission variant explicitly permits it.

There is no `get_record`, `query_table`, generic search graph, arbitrary filter, arbitrary sort, arbitrary column selection, or user-supplied company identifier.

## 3. Chosen architecture

### 3.1 Immutable policy manifest and exposure registry

Finalize and test all twenty-two P2 input and authorization contracts and implementations, then mint `2026-08-22.capability-manifest.v8` once. V8 contains the existing eleven reads and the complete twenty-two-read P2 policy catalogue. Approved names in this design do not enter the registry early: v8 is minted only after every input schema, selector, permission requirement, OAuth requirement, risk tier, output bound, domain method, and repository boundary is final and green. Existing v7 grants and callers continue through exact v7/v8 compatibility bridges; new RPCs accept v8 only.

Rollout state is separated from proof/policy identity. Refactor external registration into a small immutable, server-owned `MCP_EXPOSURE_CATALOG` with its own revision. `2026-08-22.mcp-exposure.v1` contains exactly the eleven production reads and their seven currently grantable OAuth scopes. A later, separately authorized exposure-catalogue revision is a new constant that may add one proven capability or coherent wave plus only its required grantable scopes; an existing revision is never edited in place. The server rejects an exposure entry unless the manifest says `operation=read`, a concrete domain mapping exists, the capability is implemented, its complete OAuth labels exist in that exposure revision, and the active server configuration names that exact revision. Writes and unimplemented reads can never enter the exposure catalogue.

This avoids repeated SQL reproof bridges while preserving a capability-sized rollout and rollback switch. V8 application code can therefore contain all twenty-two implemented P2 reads while the production host still sees exactly eleven.

### 3.2 Fixed domain tools, not a generic browser

Every read follows the existing chain:

```text
MCP transport
  -> trusted ActorContext and stored OAuth grant
  -> closed manifest selector
  -> nominal domain authorization
  -> nominal repository
  -> one fixed service-role RPC
  -> same-statement authority and source reproof
  -> strict private snapshot validation
  -> pure bounded service projection
  -> AgentResult serialized as untrusted data
```

Tool input can select only documented discriminated variants. It cannot select company, actor, permission, SQL relation, column, direction, or arbitrary sort.

### 3.3 Existing tools are byte-compatible

All eleven production reads keep their current capability IDs, schema revisions, arguments, result shapes, limits, ordering, cursor behavior, and public behavior. P2 limits do not retrofit onto them. Existing boundaries that still support v6 continue to accept exact v6, v7, or v8 until a separately proven drain/removal. The bridge behavior is:

- v6 executes the frozen core and returns the current v6 value unchanged;
- v7 returns the exact current v7 value unchanged;
- v8 recursively re-proves that same frozen value only in proof metadata;
- null, unknown, mixed, or malformed manifest revisions fail closed;
- business strings are never rewritten during reproof.

The same rule covers Phase C and raw-evidence boundaries. Old v6 or v7 support is removed only in a separately authorized future change after cursor TTL plus deployment/request drain is proven.

### 3.4 Shared kernel and domain isolation

Before adding P2 behavior, split the current monolithic read registry into behavior-identical domain modules and freeze the existing serialized manifest and eleven-tool external list with tests. One integration owner exclusively owns the manifest aggregator, exposure catalogue, OAuth catalogue, shared cursor/proof kernel, durable MCP limiter adapter, domain-service composition, repository bundle, and MCP dispatch map. The matching limiter migration and RPC have that same integration owner so no domain can ship a private rate-limit interpretation.

New domains live behind narrow modules containing contracts, nominal authorization, repository, pure service, and tests. The P2 read kernel sits alongside the live implementations rather than refactoring their behavior. It provides capability-specific cursor schemas, proof/collection coupling, exact serializer measurement, and atomic item/proof/evidence reduction.

The existing generic entity boundary does not authorize every P2 entity type. Estimate, invoice, payment, expense, artifact, catalog, company, team, and connection reads therefore require dedicated typed same-statement authorization paths. No domain may treat browser services, RLS, or a cloned generic proof as sufficient authority.

## 4. Complete P2 tool catalogue

### 4.1 Customer context

#### `get_customer_context`

Exact current customer reference. Closed sections are `profile`, `contacts`, `preferences`, `duplicate_state`, and `job_rollup`.

Safe output includes canonical customer and parent relationship, display/business address, contactability state, bounded business contacts when explicitly requested for a closed purpose, scheduling/communication preferences, duplicate ambiguity, and counts/status summaries of actor-visible jobs. A closed `business_notes` section may return bounded current customer notes as untrusted data. Contact values require the contact OAuth scope and a current concrete relationship; exact-contact search still never echoes its lookup value. Financial detail is not returned here.

`job_rollup` is a separately selected component. It requires `ops.jobs.read` and the exact current `pipeline.view=all|assigned` and/or `projects.view=all|assigned` authority for every requested job kind, matching `list_customer_jobs`. If the caller explicitly requests a kind it cannot read, the whole request fails before source access. An unrequested kind contributes no rows, counts, or inferred warning.

### 4.2 Daily operations

#### `list_tasks`

Bounded actor-visible tasks with closed job, assignee, status, schedule-window, overdue, unassigned, and actionable views. Returns task/job references, safe title/type, priority, state, schedule/confirmation state, due window, and safe assignee display names. It excludes internal estimate/line identifiers without financial authority and private staff identity.

#### `get_task_context`

Exact task read with safe operational facts, fixed blocker codes, schedule/confirmation/version facts, permitted assignee display names, linked-job identity, dependencies, material readiness, and evidence state. A closed `notes` section may return bounded task notes as explicitly marked untrusted business data; it is omitted by default.

#### `list_site_visits`

Implements the already-approved contract. `booked_appointments` is keyed only by `booked_at`; `visit_history` is keyed by `created_at`. It never reinterprets legacy `scheduled_at` as a booking.

#### `get_site_visit_context`

Exact visit context with booking/lead identity, state, checklist completion summary, artifact counts by safe kind/review inclusion, and bounded timeline facts. Closed, explicitly requested sections may return bounded visit notes, measurements, and checklist answer values as untrusted business data. It excludes internal notes, identity drafts, calendar/provider identifiers, attendee JSON, raw annotation state, and storage URLs.

#### `list_job_artifacts`

Bounded metadata across project photos, site-visit artifacts, attributed email attachments, generated/document artifacts, deck designs, and current human-authored job notes. Returns opaque evidence reference, safe kind/source, capture or document time, review/client visibility state, MIME family, byte size, and availability. Filenames, captions, titles, subjects, and note excerpts are untrusted data. It excludes provider IDs, sender provenance, private author/contact data, annotations/layers, raw paths, deleted notes, and financial contents already represented by sales-document reads.

#### `get_job_artifact_evidence`

Exact evidence retrieval. Returns bounded note/body/extracted text when the artifact type has an approved safe projection, always marked as untrusted business data. Binary content uses an MCP `resource_link` to the OPS-owned `/api/mcp/evidence/[token]` route. The signed token contains only opaque audience/client, grant, actor, company, parent, artifact, source-revision, nonce, issued-at, and expiry claims; it is valid for at most five minutes, signed with a dedicated server-only key, persisted only as a one-way nonce digest, and single-use.

Redemption requires the same OAuth bearer and client audience that received the link. In one database statement it re-resolves the current unrevoked grant, actor/company membership, exact source permission, parent visibility, current nondeleted artifact row, source revision, and safe-scan state. Token possession alone never authorizes delivery, and revocation immediately invalidates a copied link. The route accepts only `GET`, follows no redirects, emits `Cache-Control: no-store`, supports no byte ranges, allowlists MIME families, enforces a type-specific `Content-Length` ceiling before streaming, and never logs or audits the token, URL, storage path, or payload. Issuance and redemption use separate durable actor/company/grant/capability byte-rate buckets and immutable privacy-safe audit events. It never returns a raw storage key, provider URL, or permanent signed URL.

#### `list_work_queue`

Actor-visible operational queue combining actionable tasks, email threads requiring action, lead follow-up due/overdue, safe next commitments, and match-needs-review items. Closed source selectors are independently authorized before any row is read. Each typed card contains only the authority available for its source. Correspondence subject/snippet requires correspondence plus inbox and linked-job authority. An explicitly requested source without the complete authority union fails the whole call before source access; an unrequested default source may be omitted with one fixed warning, but contributes no row, count, or inferred existence signal. It excludes provider identifiers, participant lists, draft bodies, raw notification/queue/lease/retry rows, audit records, and raw error strings.

### 4.3 Financial documents and costs

#### `list_sales_documents`

Closed document kinds `estimate` and `invoice`, independently authorized. Returns bounded customer/job-visible headers: document reference, number, safe title, status, issue/expiry/due/paid dates, currency, total, paid/balance where applicable, and update time.

#### `get_sales_document`

Exact estimate or invoice with safe header, bounded ordered line projection, client-facing text marked as untrusted data, and estimate payment milestones when present. It excludes internal notes, storage paths, provider IDs, creator IDs, line unit cost without separate supplier-cost authority, configured-option JSON, internal pricing rules, and source payloads.

#### `list_payments`

Bounded received-payment ledger by exact invoice, customer, job, date window, normalized method category, or reconciliation state. It returns amount, currency, date, linked invoice, and void state. It requires full financial authority in addition to visible invoice/job authority; assigned-only invoice authority is insufficient. It excludes payment reference notes, processor/provider IDs, actor IDs, raw methods, and instrument details. Job-level quoted/invoiced/paid summaries remain in the existing `get_job_summary` financial section.

#### `list_expenses`

Closed views `job`, `mine`, `company`, `pending_approval`, and `reimbursement_batches`. Returns bounded safe expense headers and, for job view, visible allocation amounts/percentages. Reimbursement batches return period, safe submitter display projection, lifecycle, total/approved amount, paid timestamp, and `owed|paid` disposition. Every view has a separate authorization variant.

#### `get_expense_context`

Exact visible expense with category, merchant, date, amount/currency, lifecycle state, safe allocation references, batch/payout state, and receipt-presence state. A submitter or current authorized approver may receive the bounded review reason needed to understand the lifecycle; it is untrusted business data. It excludes raw receipt URLs/thumbnails, OCR/source JSON, unrestricted notes, accounting IDs, payment-method free text, employee contact data, and policy/configuration blobs.

### 4.4 Catalog, inventory, purchasing, and supplier cost

#### `search_catalog_items`

Closed family/SKU/category/tag query with active, stock-state, low-stock, and category filters. Returns family/variant labels, SKU, quantity/unit, effective threshold/status, safe tags, and update time. It excludes supplier cost, internal notes, import/setup staging, provider identifiers, and source JSON.

#### `get_catalog_item`

Exact family or variant with safe description/image, options/value labels, unit/SKU, recipe relationships, sale price, availability/thresholds, and bounded physical-stock aggregate by status/location/safe lot label. A closed `supplier_costs` section additionally requires full catalogue and company-financial authority plus its explicit OAuth consent; it returns only validated supplier label, unit cost/currency/basis, effective time, current/default state, and source freshness. It excludes supplier contact, internal notes, raw paths, import staging, provider identifiers, and source JSON.

#### `list_purchase_orders`

Bounded status/supplier/delivery-window query returning PO reference, supplier display name, expected date, state, line count, quantities, and safe variant labels. An explicitly requested `costs` section requires the supplier-cost authority and may add validated totals. Supplier contact, payment data, source JSON, and unrestricted notes are excluded.

#### `get_purchase_order`

Exact PO with safe bounded snapshotted lines and fulfillment state. A closed `costs` section applies the same supplier-cost authority as catalogue detail. Supplier contact, provider/payment data, source JSON, and unrestricted notes remain excluded.

### 4.5 Company, team, integrations, and overview

#### `get_company_context`

Returns company display name, industry/trade, locale, timezone, currency, working window/calendar, public logo, precise-scheduling mode, inventory mode, catalog-setup state, and user-facing capability support. It excludes billing/subscription/Stripe state, raw settings, client-communication JSON, company codes, seat/account-holder/admin IDs, and internal feature/rollout controls.

#### `list_team_members`

Active members only: stable opaque member reference, display name, active state, optional display image/color, and safe trade/team label. It excludes all private contact, home/emergency/location/device/authentication data and role-administration internals.

#### `list_team_availability`

Bounded date window returning display-only member references and server-derived availability blocks or daily capacity states. It excludes private calendar event text, provider IDs, exact personal location, leave narratives, and unavailable members outside the actor's team authority.

#### `get_integration_health`

Coarse company integration health: provider/type, configured/active/reconnect/disabled state, sync-enabled state, last healthy provider-progress time, calendar-consent boolean, and fixed reason codes such as `needs_reconnect`, `webhook_expired`, `webhook_setup_failed`, and `sync_stale`. It excludes tokens, expiry/history/page tokens, webhook/client-state identifiers, filter/autonomy settings, queue/lease rows, and raw provider errors.

#### `get_operational_overview`

Bounded server-computed counts and fixed health indicators across work due, schedule readiness, unresolved correspondence, financial attention, stock attention, and integration attention. Every component is selected and authorized independently. An explicitly requested unauthorized component fails the whole call before any component reads; an unrequested default component may be omitted with one fixed warning and contributes no count or inferred existence signal. No drill-down data appears that the actor could not obtain through the corresponding domain read.

## 5. Authorization and consent

### 5.1 New OAuth scopes

Add these scopes without widening any persisted grant:

| Scope                          | Consent meaning                                      |
| ------------------------------ | ---------------------------------------------------- |
| `ops.tasks.read`               | See tasks and work that needs attention              |
| `ops.site_visits.read`         | See site visits and their evidence status            |
| `ops.files.read`               | See authorized job photos, files, and documents      |
| `ops.financial_documents.read` | See estimates and invoices in detail                 |
| `ops.payments.read`            | See payment records on authorized invoices           |
| `ops.expenses.read`            | See authorized expenses and reimbursements           |
| `ops.catalog.read`             | See products, stock levels, and selling prices       |
| `ops.purchasing.read`          | See purchase orders                                  |
| `ops.catalog_costs.read`       | See authorized supplier cost facts                   |
| `ops.company.read`             | See the company operating profile                    |
| `ops.team.read`                | See the team directory and company availability      |
| `ops.integrations.read`        | See integration health without credentials           |
| `ops.operations.read`          | See authorized work queues and operational summaries |

The existing customer, customer-contact, job, schedule, photo, correspondence, and financial scopes remain in force. Composite tools require the union of the selected components' scopes.

Existing OAuth grants retain their stored scope array byte-for-byte. A connected host must run a new authorization/consent flow to obtain any new scope. Refreshing an old grant cannot add scopes.

Registered scope vocabulary and currently grantable scope vocabulary are separate. The immutable exposure-catalogue revision owns the exact externally visible tool set and exact grantable scope set. Dark capabilities do not make their scopes grantable. Blank scope requests resolve only to the scopes required by that exposure revision, never to every registered future scope. Explicit requests must also remain within the dynamically registered client's stored scope ceiling. Authorization codes and grants record the immutable consent-catalogue revision, exposure-catalogue revision, and exact accepted labels.

An existing dynamic client whose stored ceiling predates a new scope cannot obtain that scope through authorization or refresh. The operator must deliberately reconnect the host and complete a fresh dynamic client registration, then review and approve the newly requested labels. The server does not silently widen or replace an existing client ceiling. The old client and its grants remain valid only for their original ceiling until explicitly revoked. Acceptance tests prove old-client rejection, fresh-registration eligibility, exact visible consent, unchanged old-grant refresh, and revocation of the disposable replacement grant.

### 5.2 Exact OPS permission mapping

Every selector maps to the following current permission identifiers. “Linked-job visibility” means exact `pipeline.view=all|assigned` for an opportunity and exact `projects.view=all|assigned` for a project, re-proved against the selected entity in the same statement.

- Customer profile/preferences/duplicate state: `clients.view=all|assigned`. `job_rollup` additionally requires `ops.jobs.read` plus linked-job visibility for every selected kind. Contacts additionally require `ops.customer_contacts.read`; a correspondence-derived contact also requires `ops.correspondence.read`, `email.view=own|all`, and the selected `inbox.view=own|assigned|all` branch.
- Tasks: `tasks.view=all|assigned` AND `projects.view=all|assigned` for the linked project. Schedule detail additionally requires `ops.schedule.read` and `calendar.view=own|all` for the selected branch.
- Site visits: `ops.site_visits.read`; linked rows retain the existing `calendar.view ∧ clients.view ∧ pipeline.view` variant, while unlinked history requires `pipeline.view=all`. Artifact/evidence sections additionally require `ops.files.read` and `photos.view=all|assigned`.
- Project photos and site-visit media: `ops.files.read`, `projects.view=all|assigned` or the exact site-visit authority above, and `photos.view=all|assigned`.
- Deck designs: `ops.files.read`, `projects.view=all|assigned`, and `deck_builder.view=all|assigned`.
- Current project notes: `ops.files.read` and `projects.view=all|assigned`. Current opportunity activity notes use `pipeline.view=all|assigned`. Deleted or superseded notes are never eligible.
- Attributed email attachments: `ops.files.read`, `ops.correspondence.read`, `email.view=own|all`, `inbox.view=own|assigned|all`, and linked-job visibility. Sender, recipient, provider, and mailbox identifiers remain excluded.
- Generated sales-document artifacts: `ops.files.read`, `ops.financial_documents.read`, `documents.view=all`, the selected `estimates.view=all|assigned` or `invoices.view=all|assigned` branch, and linked-job visibility.
- Expense receipts: `ops.files.read`, `ops.expenses.read`, and `expenses.view=own|all`. Reading another employee's receipt requires `expenses.view=all`; a current assigned approver additionally needs `expenses.approve=all|assigned`, with assigned authority tied to every disclosed allocation/project.
- Estimate and invoice headers/detail: `ops.financial_documents.read`, the selected `estimates.view=all|assigned` or `invoices.view=all|assigned` branch, and linked-job visibility. Project financial detail additionally requires `projects.view_financials=all`.
- Payments: `ops.payments.read`, `invoices.view=all|assigned`, `finances.view=all`, and linked-job visibility. Assigned-only invoice authority never substitutes for `finances.view=all`.
- Expense `mine`: `ops.expenses.read` and `expenses.view=own|all`. Expense `company`: `expenses.view=all`. `pending_approval`: `expenses.view=all` and `expenses.approve=all|assigned`, with the assigned branch tied to every disclosed allocation/project. `reimbursement_batches` and batch-linked detail use the same own/all/approval rule and never expose another employee through an aggregate count.
- Catalogue/stock: `ops.catalog.read`, `catalog.view=all`, and `catalog.products.view=all`. Purchase orders: `ops.purchasing.read` and `catalog.orders.view=all`. Supplier-cost sections additionally require `ops.catalog_costs.read`, `catalog.products.view=all`, and `finances.view=all`.
- Company: `ops.company.read` and `settings.company=all`. Team directory: `ops.team.read` and `team.view=all`. Company availability additionally requires `calendar.view=all`; an explicit self-only variant may use `calendar.view=own` without widening it.
- Integration health: `ops.integrations.read` and `settings.integrations=all`. Mailbox rows additionally require `email.view=own|all`; accounting rows require `accounting.view=all`.
- Work queue: `ops.operations.read` plus each selected source's exact union above. Lead items require `ops.jobs.read` and `pipeline.view=all|assigned`; task items require task authority; correspondence items require correspondence/email/inbox/linked-job authority; schedule items require schedule authority; financial and expense items require their exact financial authority.
- Operational overview: `ops.operations.read`, `reports.view=all`, and every explicitly selected component's complete OAuth and permission union. One component can never lend authority to another.

The generic entity authorizer remains limited to the entity kinds it currently understands. Estimate, invoice, payment, expense, artifact, catalogue, company, team, and integration reads each use a dedicated nominal authorizer and fixed same-statement RPC proof; implementations may not translate the table name into a generic entity claim.

Authorization proofs are nominal, deep-frozen, actor/company/manifest/policy-bound, and cannot be reconstructed from plain objects.

## 6. Contract and result rules

Every new P2 list:

- defaults to at most 25 returned items and reads at most a 26th page sentinel;
- has a hard source-inspection sentinel of 501 before public projection;
- uses deterministic canonical ordering documented per capability;
- uses an opaque signed cursor bound to capability/schema/manifest/ranking revision, actor, company, grant scopes, permission snapshot, normalized filters, source revision, read time, and prior order witness;
- expires after the existing fifteen-minute cursor TTL and rejects cross-tool, cross-filter, cross-actor, cross-company, stale-permission, stale-source, and forged replay;
- returns a mandatory collection proof, including a valid empty result;
- never returns partial completeness when the source bound, data validity, proof, or output budget fails.

Every result:

- uses the existing `AgentResult` envelope and stable privacy-safe error vocabulary;
- is strict-parsed and deeply frozen at the repository boundary;
- is measured with the exact MCP untrusted-data serializer and remains at or below 60,000 serialized characters;
- treats all business strings as data, never instructions;
- contains no caller-supplied actor, company, permission, authority, sort, or proof material;
- has immutable evidence/provenance locators with no raw storage/provider identifiers;
- emits fixed gaps/warnings instead of raw database/provider errors.

Every monetary value reuses the existing strict `MoneySchema`: `{ amount_minor: <safe integer>, currency: <ISO 4217 code> }`. SQL validates the currency and its exponent before projection; TypeScript never constructs money from a JavaScript decimal, accepts `NaN`/infinity, rounds an out-of-contract value, or aggregates unlike currencies. Sales documents, payments, expenses, reimbursements, catalogue costs, purchase orders, and overview totals all use this representation.

Composite selection is fail-closed. If the caller explicitly selects a component, source kind, section, or job kind without its complete OAuth and OPS permission union, the whole request fails before any repository access. Only a component introduced by a documented default—and not explicitly requested—may be omitted with one fixed warning. An omitted component contributes no row, count, aggregate, or existence signal.

Exact evidence reads have smaller type-specific byte/count limits and never make a list tool an unbounded download channel.

Broad reads, evidence issuance/redemption, and overview reads require the shared durable rate-limit path. The limiter is an atomic database-backed boundary keyed by actor, company, OAuth grant, capability, and fixed bucket/window policy. It records no business query or evidence token. The MCP server may keep an in-process limiter only as an additional burst guard; it fails closed when the durable limiter is unavailable and is never the production enforcement boundary for enumeration-sensitive capabilities. Multi-instance races, retries, expiry, timeout, audit coupling, and limiter-unavailable behavior are mandatory runtime tests.

## 7. Database design

### 7.1 Migration decomposition

Use the imperative migration workflow and create filenames with `supabase migration new`; never hand-invent a migration version. Keep compatibility, revision infrastructure, indexes/triggers, and domain RPCs independently reviewable. The numbering below is the eventual database apply order, not the development authoring order: the v8 compatibility migration is finalized only after all twenty-two implementations and their candidate policies are green.

1. **Manifest v8 compatibility only** — freeze the existing public readers behind exact private cores and expose every exact revision the boundary currently supports: v6/v7/v8 where v6 remains live, including Phase C and raw evidence. No new table, trigger, index, or P2 RPC belongs here.
2. **Domain revision kernel only** — add a private company/domain revision table, closed domain vocabulary, private advance helpers, and no public RPC.
3. **OAuth consent-catalog versioning only** — persist the exact consent-catalog revision and registered-client scope ceiling used for each authorization/grant.
4. **Durable MCP rate limiter only** — add the private atomic bucket table/function, service-only consume RPC, cleanup bounds, and immutable privacy-safe audit coupling. The external server fails closed when this boundary is absent; there is no browser grant and no in-memory production substitute.
5. **Per-domain source fences and indexes** — one bounded migration per domain, followed by role-specific DML proof for any expression-index helper graph.
6. **Per-domain fixed RPCs** — separate from the source/index migration so SQL authorization/proof review is not hidden inside index work.
7. **Operational overview last** — consume already-proven private domain projections and the exact sorted domain-revision vector in one outer statement.

Exposure-catalogue revisions are code-only immutable registry revisions, not SQL migrations and not manifest reproofs. Publishing one remains a separately authorized release action after all relevant database boundaries already exist and are proven.

Each migration is independently fresh-installable, compatible with the real forward ledger, replay-safe where project convention requires it, and applies with all P2 capabilities still dark.

Do not extend the existing single `private.agent_operational_read_revisions` counter across every P2 table. Add `private.agent_read_domain_revisions(company_id uuid, domain text, source_revision bigint, updated_at timestamptz)` with a closed domain vocabulary and no application-role table access. Cursor-capable reads bind a canonical digest of their sorted domain revision vector; cross-domain reads bind several revisions rather than pretending one bigint proves every source.

The durable limiter uses `private.agent_mcp_rate_limit_buckets` and one fixed `public.consume_agent_mcp_rate_limit_as_system(...)` RPC. The table key is a keyed digest of company, actor, OAuth grant, capability, bucket policy, and window start; it stores only counters and expiry, never the raw query, evidence token, business identifiers, or result. The RPC is one atomic insert/update statement, accepts only a closed server-owned policy ID and fixed requested unit count, rechecks the active grant/actor/company/capability binding, returns a strict allow/remaining/reset projection, and is executable only by `service_role`. Cleanup is bounded by indexed expiry and cannot run in the request path as an unbounded sweep.

Evidence redemption uses `private.agent_mcp_evidence_redemptions` only for a keyed nonce digest, bound identities/revision digests, issued/expiry/redeemed timestamps, and privacy-safe outcome code. One fixed service-only redemption RPC atomically validates and consumes the nonce while re-proving current grant and artifact authority in the same statement. It cannot store a bearer, token, URL, raw object key, filename, business text, or payload bytes. Expired rows have bounded indexed cleanup; immutable MCP audit remains the durable operator record.

### 7.2 RPC security

Every public read RPC is `STABLE SECURITY DEFINER` only when privileged access is necessary, has a fixed `search_path`, explicitly validates the service-role request boundary, revokes `PUBLIC`, `anon`, and `authenticated`, and grants only `service_role`. Private helpers remain non-executable by application roles unless an expression index requires a deliberately audited immutable helper grant to roles that already write the indexed table.

The SQL statement re-resolves current actor/company membership, permission snapshot, selected permission scopes, entity visibility, soft-delete/current identity, source revision, and source validity. RLS is defense in depth, not the MCP authority source.

Legacy text identifiers are shape-checked before UUID conversion. No raw cast can turn malformed source data into a database error or a different record.

### 7.3 Index and write-path safety

Indexes must match the exact canonical predicates and ordering used by each bounded source gate. Production-shaped custom and generic plan tests prove no unbounded source scan and aggregate source work at or below the frozen sentinel.

Expression-index helper graphs are catalog-audited before apply. Every role that already writes an indexed source table must retain the exact transitive helper execution needed for ordinary INSERT/UPDATE/DELETE; `PUBLIC` and unrelated helpers remain denied. Runtime migration tests exercise representative writes under every actual writer role with rollback.

Oversized or malformed source strings must remain writable and surface as a fixed invalid-source result; an expression index must not make an unrelated application write fail.

## 8. Implementation waves

### Wave A — shared foundation and daily operations

First split the monolithic read registry into behavior-identical domain modules, add the bounded P2 read/proof/cursor kernel alongside the live implementations, add the durable limiter and domain source revisions, fix OAuth consent-catalogue/scope-ceiling behavior, freeze the binary artifact identity/resource-link/redemption contract, and finalize every P2 candidate contract without assigning the immutable v8 revision. Implement customer context, tasks, and work queue against the internal candidate-policy set. The active manifest remains v7 and the initial exposure-catalogue revision remains the exact production eleven, so every P2 read remains absent from the host.

### Wave B — money

Implement job artifacts and evidence redemption first, then the two existing site-visit reads against that frozen artifact boundary. Implement sales documents, payments, expenses, and reimbursements. Money reads require the strict shared money representation, currency/source-validity proofs, and independent full-scope tests.

### Wave C — supply and company

Implement catalog/stock, purchase orders, supplier cost, company context, team members, availability, and integration health.

### Wave D — integrated acceptance

Implement operational overview only after every source-domain private projection is stable. Once all twenty-two implementations and candidate policies are final and green, mint v8 exactly once and finalize its compatibility migration. Then run the full thirty-three-tool v8 manifest/domain matrix, the exact eleven-tool initial exposure matrix, database runtime matrix, adversarial privacy suite, v6/v7 continuity suite, and real host workflows. A separately authorized release may then publish a new immutable exposure-catalogue revision containing only the proven capabilities approved for that release. V8 itself is never mutated, and neither deployment nor a manifest change silently expands the host's tool set or grantable scopes.

## 9. Verification gates

No capability is complete without all applicable gates:

1. **Contract RED/GREEN:** strict inputs, closed selectors, strict outputs, invalid combinations, forbidden fields, and exact serialized budget.
2. **Authorization RED/GREEN:** actor/company/grant/manifest/policy binding; every `all|assigned|own` branch; composite AND-authority; revoked/stale permission behavior.
3. **Repository adversarial proof:** fully rehashed field/order/filter/source/cursor tampering, duplicate identities, malformed timestamps/numerics/Unicode, cancellation, stale fences, and privacy-safe errors.
4. **Database runtime:** PostgreSQL 17 compile, real function calls, empty/sentinel/stale/invalid cases, ACL/readback, migration convergence, ordinary DML under every indexed-table writer role, and exact v7 continuity.
5. **Performance:** production-shaped `EXPLAIN (ANALYZE, BUFFERS)` for selective, broad, assigned, empty, and hostile filters; no executed source sequential scan where the bounded contract requires an index; aggregate inspected work respects the sentinel.
6. **Transport:** exact exposure-catalogue tool set, read-only annotations, durable rate/audit coverage, no write or P2 premature exposure, exact serializer budget, timeout/abort, and zero internal error leakage. Evidence tests cover copied-token revocation, wrong bearer/client/audience, wrong actor/company/parent, replay, expiry, source drift, unsafe scan state, disallowed MIME/size/method/range, no-store/no-redirect behavior, and privacy-safe logs/audits.
7. **Whole branch:** Node 22 type-check, formatting, all agent-control-plane tests, affected integration tests, SQL statement parsing, independent P0/P1 review, and a complete branch review.
8. **Production rollout when separately authorized:** database first with exact ledger/readback while v7 remains live; code deploy with new reads still dark; authenticated old-eleven canary; capability-sized exposure; real Claude task chain; immutable audit readback; disposable-grant revoke and next-call rejection; rollback proof.

## 10. Failure and privacy behavior

- Hidden and nonexistent entities are indistinguishable.
- Invalid caller input returns `INVALID_ARGUMENT` before repository access.
- Missing authority returns the fixed forbidden/scope result without entity existence disclosure.
- Stale permission or source fences return `STALE_CONTEXT` with only canonical operational revision atoms.
- A malformed, ambiguous, oversized, or internally inconsistent source returns a fixed terminal gap or privacy-safe internal result; no partial rows survive.
- Provider/database/internal error text never enters MCP output or audit detail visible to the host.
- Composite tools fail the entire request when an explicitly requested component lacks authority. Only an unrequested documented default may be omitted with a fixed warning; it contributes no row, count, aggregate, or existence signal.

## 11. Cost and operations

The build needs no new vendor or infrastructure subscription. It adds bounded Supabase query/index work, Vercel function execution, immutable audit rows, and—only when requested—short-lived object-storage delivery/egress for authorized evidence. Cost protection comes from per-tool rate buckets, source and output sentinels, short deadlines, no background model generation, and no generic export path.

No implementation step in this branch may apply a migration, mutate production data, push, deploy, issue/revoke a real grant, or expose a capability without Jackson's separate explicit authorization.

## 12. Alternatives rejected

### Generic read/query API

Rejected because it turns authorization into an open-ended filter/column problem, invites prompt-driven data exploration, produces poor tool selection, and cannot provide capability-specific privacy and completeness proofs.

### One monolithic RPC or one giant migration

Rejected because it couples unrelated permissions and source validity, makes rollback and performance proof opaque, and recreates the failure mode where a single helper/index mistake can break unrelated application writes.

### Repeated manifest revisions per domain

Rejected because they would force repeated reproof bridges and grant/policy compatibility churn during one approved catalogue programme. One immutable v8 policy catalogue plus separately versioned immutable exposure catalogues keeps policy/evidence stable while allowing capability-sized rollout and rollback.

### Exposing stored columns because the user can see them in OPS-Web

Rejected. MCP is a model-facing, composable interface with different aggregation and prompt-injection risks. Every field must earn a purpose-built projection and authority proof.
