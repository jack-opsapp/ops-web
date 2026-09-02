# OPS MCP Recurring Price Preview — Phase 7 Design

## Outcome

Add one dormant MCP preparation capability for golden task 14:

> Raise every selected recurring-service account by a validated percentage in a requested month, draft the notices, and identify evidence-backed churn risk.

The capability stops at a truthful, ephemeral preview package. It cannot send a notice, change a price, edit a contract, create an invoice, alter service, persist preview or draft business content, confirm, or commit. The existing MCP transport still records ordinary rate-limit and audit metadata such as an input digest and result byte count.

## Host input

The host supplies exactly three values:

- `service_selector`: one bounded service name.
- `increase_percent`: an exact positive decimal string, at most four fractional digits and no more than 100.
- `effective_month`: canonical `YYYY-MM`.

Actor, tenant, scopes, account identities, pricing, the exact RRULE, currency, rounding, effective dates, tax, notice rules, exceptions, contact routes, risk evidence, and batch limits are server-owned. The API rejects year zero, unsafe control/format characters, prompt-like selector text, and out-of-window months as non-retryable invalid input.

## Authority model

The new private `agent_recurring_service_price_policies` table is the fail-closed contractual bridge. One active row binds a tenant, client, recurring task type, exact authorized percentage and effective month, exact price-source line item and hash, exact notice contact, notice days, adjustment permission, optional grandfathering, and a policy-source reference/hash. No policy row means `terms_unavailable`; it never means permission.

The server independently revalidates every binding:

- active recurrence, client, task type, and company, with only accepted or in-progress projects eligible and canonical inactive project states omitted;
- unique service selection and one bounded account/service identity per client; multiple relevant recurrence rows produce one explicit `duplicate_account_service` exclusion with the first two recurrence source references/hashes instead of spending multiple account slots;
- exact accepted/converted estimate or delivered invoice line-item price source;
- source line item still belongs to the same tenant, client, and task type;
- simple per-unit pricing only: quantity one, zero line-item and document-level discount, no positive minimum charge, non-null optional-selection flags, and optional estimate lines only when selected;
- valid company ISO currency and exact minor-unit arithmetic;
- tax treatment only when the pinned line is explicitly taxable and its active rate remains complete; missing, inactive, unsafe, or out-of-range tax preserves verified price facts but produces `tax_unavailable`, while a non-taxable line ignores a populated legacy tax ID;
- contact belongs to the client and resolves to one unique normalized email;
- requested month has a real recurrence occurrence after exact skip/reschedule exceptions, including sparse century-old COUNT rules and long-distance moves, while computationally dense histories fail closed before the aggregate work ceiling; conflicting RRULE `UNTIL` and database end anchors fail closed because their production semantics can diverge;
- the effective occurrence satisfies the recorded contractual notice period;
- adjustment is allowed and grandfathering has ended;
- provider correspondence for the chosen address is readable under the Phase 4 normalization revision within the disclosed 8,760-elapsed-hour window.

Any ambiguity, staleness, missing evidence, invalid recurrence, unsupported currency, or batch overflow fails closed.

The source path is deliberately split without weakening snapshot truth. A first authorized RPC returns only the bounded recurrence-driving catalog. RRULEs outside the non-expanding canonical uppercase alphabet are rejected before the database estimates or constructs catalog JSON. The service removes a row only when exact, conservatively parsed recurrence semantics prove it ended before the requested month. A second authorized RPC accepts those selected recurrence IDs and returns both a freshly recomputed catalog and all selected details under one PostgreSQL statement snapshot. The service requires canonical equality of both catalogs, exact equality of the recomputed selection, and exact one-to-one recurrence/identity evidence before calculating. Both catalog classifications spend one shared request budget. It reauthorizes after the reads and performs the final SQL authority assertion immediately before returning the bounded result.

## Preview and risk

Included accounts receive current/proposed minor-unit prices, tax treatment, the exact RRULE, exact effective date, ready-to-send draft subject/body, source references, and a stable per-account preview ID. Draft subjects are capped at 200 UTF-8 bytes without splitting a Unicode code point. Percentage math supports four meaningful fractional digits (surplus trailing zeros are canonicalized), tax fractions are rendered as percentages, and currency rounding occurs once at the ISO minor unit. A change below that currency precision is excluded. The complete UTF-8-ordered package receives a SHA-256 plan hash over authoritative inputs and source revisions. Observation/generation timestamps and their derived evidence-window endpoints are disclosed but excluded from stable identity.

Churn risk is an explainable classification, not a prediction:

- `high`: readable inbound provider evidence contains a narrowly noun-bound explicit cancellation or price-objection signal.
- `medium`: readable inbound evidence contains a narrowly service/charge-bound complaint signal or the account has coherent company-local collectible late-payment evidence from a positive paid or outstanding invoice.
- `unknown`: evidence is unreadable or insufficient. Absence of a negative signal never becomes a low-risk claim.

Every classification includes structured evidence, stable hashes/references, the exact 8,760-elapsed-hour correspondence window, and whether evidence is complete within that window. Returned evidence never includes raw correspondence text. Provider content therefore informs the route and risk without entering model context as instructions. Provider reads use three bounded identity branches, exact tenant/time composition, GIN address lookup, a 1,000-row result cap, and a 1,001 overflow sentinel; individual normalized bodies are capped at 20,000 UTF-8 bytes. Newer unrelated materials, logistics, or quantity messages cannot erase an older service-price or billing signal.

## Safety and rollout

The capability is `prepare`, high risk, exact-preview confirmation class, and deterministic. It is bounded to 100 account identities with a 101 overflow sentinel, a 10,001-row recurrence catalog sentinel, one 100,000-unit recurrence-classification budget shared across both catalog passes, 3,000 evidence references, 4,000,000 output characters, and 64-character decimal strings. Catalog construction fails before materialization when a conservative UTF-8 estimate exceeds 3,500,000 bytes or target-month exceptions cross 10,000; the serialized catalog and the entire detail wrapper each have an exact 4,000,000 UTF-8-byte server ceiling. It requires exactly eight tool/grant scopes (`ops.catalog.read`, `ops.company.read`, `ops.correspondence.read`, `ops.customer_contacts.read`, `ops.customers.read`, `ops.financial_documents.read`, `ops.operations.prepare`, and `ops.schedule.read`) and eight actor permissions (`calendar.view`, `catalog.products.view`, `catalog.view`, `clients.view`, `email.view`, `estimates.view`, `invoices.view`, and `settings.company`). Registered v9 clients are pinned to the exact 16-scope v9 ceiling; narrowed, broadened, or serialized-scope drift fails closed. Collections consent catalogue v3 and price-preview consent catalogue v4 preserve exact labels for their separate prepare operations. Exposure v9 is additive to dormant v8, while the active exposure remains exactly v2. Every inherited tool accepts only its historical manifest/exposure pair or v15/v9; the v15/v9 route also rechecks the exact 16-scope registered client ceiling and serialization, v4 consent revision, and exact accepted labels before any domain read. There is no commit or send capability and no durable preview business state.

Applying the local migration later would add one private policy table and several B-tree/GIN indexes. The cost is additional database storage, index-build I/O and locking, plus write amplification on recurrence, exception, provider-source, invoice, client, and price-source changes. No hosted tier or paid third-party service is added by this implementation; production cost remains unmeasured until an authorized migration rehearsal reports the real table and index sizes.

Verification includes contract and invariant tests, service/repository adversarial tests, disposable PostgreSQL 17 runtime tests, legacy regressions, type/lint/format checks, bundle/build proof, and an independent reviewer pass. No migration is applied and nothing is pushed, deployed, granted, or activated.
