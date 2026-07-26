# Phase C Guided Catalog and Inventory Onboarding — Design Specification

> **Date:** 2026-07-24
>
> **Status:** Approved in founder design review
>
> **First acceptance company:** Canpro Deck and Rail
>
> **Primary operator:** `canprojack@gmail.com`
>
> **Scope:** OPS Web catalog guided setup, task-type linking, specialized-tool handoff, and a separate opening-inventory import tool

---

## 1. Outcome

Phase C becomes a stateful catalog specialist that can interview a trades business, understand the difference between what the customer buys and how the company performs the work, reconcile the proposed structure against the live catalog, and create a complete quoting and material system only after explicit approval.

Catalog creation and opening-inventory entry are separate operations:

1. Phase C builds and verifies the catalog structure.
2. The catalog is usable for quoting with zero opening quantities.
3. Phase C offers a separate Inventory Import tool for the company's real stock count.

Canpro's DekSmart vinyl membrane system is the first full acceptance case. The design is generic; no Canpro-only rules belong in the core agent.

---

## 2. Current Product Gap

The existing OPS Web guided path is a one-shot proposal generator, not a true Phase C setup:

- Its prompt prioritizes flat sell items and explicitly forbids stock, recipes, and task types beyond one trade.
- It accepts prior-turn strings but does not conduct a durable, question-by-question interview.
- Its proposal and commit contracts cannot carry all product options, stock families, physical stock units, task-type links, cost components, or specialized-tool connections required by this use case.
- Some rich editor concepts are local UI state and do not round-trip through the commit payload.
- The commit route writes products and stock families in separate calls, so a later failure can leave an accurately reported but partially completed setup.
- Task types can be created and deduplicated, but the setup proposal cannot reliably link the returned task-type ID to the products it creates.

The existing safety foundations remain valuable and should be extended:

- `catalog.run_setup` permission gate
- company-scoped writes
- session lock
- strict proposal validation
- live read/merge behavior
- content-addressed idempotency keys
- explicit partial-save reporting
- completion notification

---

## 3. Product Principles

1. **Read first.** Phase C inspects the live company catalog before asking questions or proposing records.
2. **One useful question at a time.** It asks only about unresolved decisions that materially affect the catalog.
3. **Customer reality and internal reality stay separate.** Customer choices, staff-only choices, purchasing rules, recipes, labor, and inventory are modeled independently.
4. **Never invent.** Unknown SKUs, costs, dimensions, coverage, task types, or compatibility rules remain unresolved.
5. **Show the change before making it.** The operator sees create, reuse, update, merge, and unresolved actions before approval.
6. **One explicit write gate.** The interview and review are read-only. `CREATE CATALOG` is the first catalog mutation.
7. **Retries are safe.** A lost response, refresh, or repeated confirmation cannot create duplicates.
8. **Success is verified.** Phase C reads the committed records back before showing `CATALOG READY`.
9. **Opening stock never blocks catalog setup.** Quantities may start at zero and be populated later.
10. **Specialized OPS tools are capabilities, not hardcoded trade logic.** Phase C uses a deck-design capability when enabled and falls back to manual measurements when it is unavailable.

### 3.1 Approaches considered

#### Catalog structure

1. **Two sell products and two membrane stock families — selected.** Keeps
   60mil staff-only, prevents invalid thickness/colour combinations, and gives
   each system an unambiguous recipe.
2. **One sell product with a hidden thickness option — rejected.** Fewer records,
   but the hidden choice can leak into customer UI and makes colour and material
   compatibility harder to validate.
3. **Flat sell items with a manual material list — rejected.** Fastest initial
   entry, but it does not produce reliable inventory, cut-list, or cost behavior.

#### Opening inventory

1. **Separate Inventory Import with an explicit post-setup handoff — selected.**
   Catalog success is independent while the importer retains the new catalog as
   matching context.
2. **Embed inventory upload inside catalog setup — rejected.** A bad file or
   interrupted stock count would block an otherwise valid quoting catalog.
3. **Use an unrelated generic importer — rejected.** It would lose the approved
   catalog mappings and ask the operator to repeat work.

---

## 4. Recommended Catalog Architecture

### 4.1 Sell products

Create two sellable products rather than one product with a thickness option.

#### Product A — standard

| Field | Value |
|---|---|
| Name | `Vinyl membrane installation` |
| Internal system | DekSmart Ultra 68mil fuzzyback |
| Customer visibility | Normal quoting product |
| Customer thickness choice | None |
| Pricing unit | square foot |
| Base price | $11.73/sqft |
| Minimum charge | $1,500 before GST |
| Tax | GST added |
| Quantity source | Finished deck surface area |
| Customer option | Colour only |
| Task type | Existing `Vinyl Install` |

The 68mil specification may appear in internal details and contract/specification text. It must not render as a customer-selectable thickness.

#### Product B — exception

| Field | Value |
|---|---|
| Name | `Vinyl membrane installation — 60mil` |
| Internal system | DekSmart Ultra 60mil smoothback |
| Customer visibility | Hidden from ordinary customer/storefront selection |
| Staff visibility | Selectable on a quote |
| Quote description | Explicitly identifies 60mil |
| Pricing unit | square foot |
| Base price | $12.73/sqft |
| Minimum charge | $1,500 before GST |
| Tax | GST added |
| Quantity source | Finished deck surface area |
| Customer option | Colour only |
| Task type | Existing `Vinyl Install` |

Canpro does not normally sell 60mil. It remains available for staff to select when a project requires it.

### 4.2 Pricing rule

For either product:

```text
subtotal_before_tax = max(finished_deck_area_sqft × price_per_sqft, 1500.00)
GST = applied on top of subtotal_before_tax
```

All colours use the same selling price. Colour selection changes the material variant, not the selling price.

### 4.3 Separate membrane stock families

Create or reconcile two stock families:

1. `DekSmart Ultra 68mil membrane`
2. `DekSmart Ultra 60mil smoothback membrane`

Do not combine thickness into a single family. Separate families prevent invalid thickness/colour combinations and make recipe resolution deterministic.

#### 68mil colour variants

1. Cobblestone
2. Pebblestone
3. Antique Beige
4. Dove Grey
5. Venetian Taupe
6. Sahara Beige
7. Slate Grey
8. River Rock
9. Sienna
10. Carrera
11. Mojave
12. Malibu
13. Royal Oak
14. Silver Maple
15. Hansberry
16. Heritage
17. Driftwood
18. Boardwalk
19. Shorewood

#### 60mil colour variants

1. Antique Beige
2. Dove Grey

The sell-product colour values must map explicitly to the matching stock variants. A colour label alone is not a recipe selector.

---

## 5. Canpro Material Systems

### 5.1 68mil system

| Component | Catalog identity | Cost and packaging | Rule |
|---|---|---|---|
| Membrane | DekSmart Ultra 68mil fuzzyback | $2.82/sqft standard; $2.62/sqft condo; 72in × 75ft roll; 450 sqft | Colour-selected stock variant |
| Summer adhesive | `VG2510` — DekSmart 2510 Contact, 19 L | $219 standard; $204 condo; approximately 400 sqft/pail | Internal summer selection |
| Winter adhesive | `VG15023` — Silaprene Winter Contact, 19 L | $228 standard; $213 condo; approximately 400 sqft/pail | Internal winter selection |
| Drip flashing | `VDF15` — 30ga galvanized, 2in × 2.25in with 3/8in kick, 2.5in drop | $0.96/LF; 8ft stick | Exposed deck edges |
| Angle flashing | `VDF05` — 30ga galvanized, 1.5in × 2.5in, no kick | $0.88/LF; 8ft stick | Wall/parapet edges |
| Clip | Grey Vinyl Clip | $0.39/LF; 10ft stick | Exposed edges; 68mil only |
| Labor | Vinyl installation labor | $2.00/sqft | Internal cost component |

The installer, not the customer, chooses summer or winter adhesive. The recipe expresses these as a mutually exclusive internal choice.

### 5.2 60mil system

| Component | Catalog identity | Cost and packaging | Rule |
|---|---|---|---|
| Membrane | DekSmart Ultra 60mil smoothback | $3.18/sqft standard; $2.98/sqft condo; 72in × 75ft roll; 450 sqft | Colour-selected stock variant |
| Latex adhesive | `VG4500` — DekSmart 4500 Latex, 19 L | $193 standard; $178 condo; approximately 450 sqft/pail | Required |
| Drip flashing | `VDFG` — Grey PVC-coated, 2in × 2.25in with 3/8in kick, 2.5in drop | $3.44/LF standard; $3.14/LF condo; 8ft stick | Exposed deck edges |
| Angle flashing | `VDF05` — 30ga galvanized, 1.5in × 2.5in, no kick | $0.88/LF; 8ft stick | Wall/parapet edges |
| Wall contact | Contact adhesive at walls | Not separately tracked | Installation note only |
| Clip | None | — | Must not be added |
| Labor | Vinyl installation labor | $2.25/sqft | Internal cost component |

### 5.3 Cost treatment

- Standard supplier cost is the default.
- Condo cost is an internal purchasing override available only when the job/order is explicitly tagged `CONDO`.
- Condo pricing is never customer-facing and never inferred from customer or project text.
- All costs are CAD and tax-exclusive.
- Labor and material cost components remain distinct.
- Do not place the labor-only rate in the product's total `unit_cost`.
- Margin reporting rolls up the selected membrane, adhesive, linear materials, clips where applicable, waste, and labor.

---

## 6. Quantities, Geometry, and Inventory Semantics

### 6.1 Quoting

Finished deck surface area drives:

- customer quantity
- sell price
- base membrane demand
- adhesive demand
- labor cost

### 6.2 Membrane ordering

Membrane is ordered from the supplier by full roll or pre-cut. Exact cut requirements come from each deck's dimensions, not area alone.

When Deck Designer is available:

- deck surface geometry provides quote area
- its Vinyl Cut List provides required cuts
- exposed edges provide drip-flashing demand
- wall/parapet edges provide angle-flashing demand
- exposed edges provide 68mil clip demand

When Deck Designer is unavailable, Phase C requests:

- finished deck area
- deck dimensions or required cut list
- exposed-edge linear feet
- wall/parapet-edge linear feet

The catalog stores the relationship and manual fallback. It does not implement a Canpro-specific geometry algorithm.

### 6.3 Physical membrane inventory

Track every usable full roll, supplier pre-cut, and offcut under the correct thickness and colour variant.

Each physical stock unit records:

- thickness/family
- colour variant
- width
- original length
- remaining length
- location
- label or lot code when available
- status

All Canpro stock defaults to `Canpro Shop`.

### 6.4 Adhesive inventory

- Purchasing demand rounds up to whole pails.
- An opened pail may remain in inventory as 1/4, 1/2, 3/4, or one full pail.
- The usable remainder is always rounded down to the nearest quarter-pail.
- Approximate purchasing demand:

```text
68mil contact pails = ceil(area_sqft / 400)
60mil latex pails   = ceil(area_sqft / 450)
```

### 6.5 Linear stock

- Drip and angle flashing are purchased and counted as full 8ft sticks.
- Vinyl Clip is purchased and counted as full 10ft sticks.
- Job demand rounds up to full sticks for purchasing.
- Canpro does not bank leftover flashing or clip pieces as inventory.

### 6.6 Opening quantities

Catalog setup creates the structure with zero opening quantities. Phase C never estimates current stock from historical jobs or purchasing patterns.

---

## 7. Phase C Interview

### 7.1 Conversation state

The setup session must be durable across refresh, temporary network loss, and resumed work. It stores:

- company and operator
- setup mode
- source material supplied by the operator
- normalized facts
- unresolved questions
- contradictions
- live matches
- proposed records and actions
- validation issues
- approval state
- commit journal and read-back results

Chat messages are presentation. Structured facts and decisions are the source of truth.

### 7.2 Question policy

Phase C asks one high-value question at a time when a required decision cannot be safely derived from:

1. live company data
2. an operator-provided file
3. a verified supplier source
4. a prior answer in the same setup session

It confirms contradictions rather than choosing the most recent statement silently.

For example, a conflict over whether 68mil uses clip must block the affected recipe until resolved.

### 7.3 Required distinctions

The interview must classify every answer into one or more of:

- customer-facing product
- customer-facing option
- staff-only choice
- quote disclosure
- pricing rule
- material compatibility
- purchasing rule
- inventory rule
- labor cost
- task-type behavior
- specialized-tool input

This classification prevents internal decisions such as adhesive or thickness from accidentally appearing as customer options.

### 7.4 Sources and confidence

Every proposed fact records its source:

- live OPS data
- operator answer
- uploaded document
- verified supplier material
- deterministic calculation

Unknown values remain unknown. Phase C must not generate plausible-looking SKUs or costs.

---

## 8. Live Reconciliation

Before proposing a catalog, Phase C loads the company's active and soft-deleted:

- products
- product options and values
- pricing modifiers
- product material recipes
- stock families
- catalog axes, variants, and mappings
- physical stock units
- units and categories
- task types

Matching uses stable IDs and external identities first, then normalized exact identities, then operator-reviewed fuzzy matches.

### 8.1 Canpro reconciliation fixture

A read-only production check on 2026-07-24 confirmed one active `Vinyl` stock
family with `Type` and `Color` axes. It contains:

- 12 of 19 68mil colour variants, each tagged `68mil Fuzzy`
- both 60mil colour variants, each tagged `60mil Smooth`
- one blank variant with no axis values
- zero quantity on every variant
- no supplier SKUs or unit-cost overrides
- no physical stock units
- no recipe references

The missing 68mil colours are:

- Cobblestone
- Venetian Taupe
- River Rock
- Sienna
- Carrera
- Malibu
- Shorewood

The approved identity-preserving split is:

1. Rename the existing family to `DekSmart Ultra 68mil membrane`.
2. Preserve the 12 existing 68mil variant IDs and their colour identities.
3. Add the seven missing 68mil colour variants.
4. Create `DekSmart Ultra 60mil smoothback membrane` with its own `Color` axis.
5. Re-parent the two existing 60mil variant IDs into the new family and replace
   their old Type/Color joins with the new family's colour joins.
6. Remove the now-redundant `Type` axis from the 68mil family after the 60mil
   variants have moved.
7. Archive the blank variant only after preflight reconfirms that it has no
   quantity, physical units, recipes, option mappings, orders, allocations, or
   other live references.

The split must run through a purpose-built, company-scoped transaction so the
existing 60mil variant IDs are not discarded merely because the current setup
RPC cannot express a re-parent operation. If any referenced row prevents the
identity-preserving split, Phase C returns to review with the exact blocker.

The setup review must show every reused, moved, created, and archived record. It
must not create a second equivalent `Vinyl` structure or duplicate colours.

---

## 9. Task-Type Behavior

Both vinyl installation products link to:

```text
Vinyl Install
id: a53dd13d-dc0c-4df0-88d6-118404b161ce
```

For any company:

1. Search active task types by normalized display name.
2. Prefer an exact existing match.
3. Present close matches for operator confirmation.
4. If no match exists, ask: `Create Vinyl Install?`
5. Create it only after confirmation and with the required permission.
6. Use the returned ID to link every approved product in the same setup.
7. A retry must reuse the existing task type.

If creation fails or the operator lacks permission, keep the catalog draft intact. Do not report the products as fully ready while their required task-type link is missing. The operator may explicitly approve an unlinked product only after a visible warning.

The Phase C proposal, payload builder, and commit contract must carry `task_type_id`; creating a task type without linking it is incomplete.

---

## 10. Review and Commit

### 10.1 Review language

The review groups actions by outcome:

- `CREATE`
- `REUSE`
- `UPDATE`
- `MERGE`
- `ARCHIVE`
- `NEEDS INPUT`

The operator sees:

- two sell products
- customer and staff visibility
- prices, tax, and minimum charges
- colour options and stock mappings
- task-type links
- material systems and compatibility
- labor rates
- opening quantities
- unresolved supplier identifiers

### 10.2 Final action

The write button is:

```text
CREATE CATALOG
```

No catalog mutation occurs before this action.

### 10.3 Preflight

Immediately before committing, Phase C re-reads all matched records and checks:

- the company and operator session are unchanged
- the operator still has `catalog.run_setup`
- task types still resolve
- product and variant matches still exist
- no new duplicates appeared
- source rows have not changed since review
- recipes resolve to concrete variants or valid selectors
- all quantities and prices are valid
- required feature/schema capabilities are available

If live state changed, Phase C returns to review with an exact diff.

### 10.4 Commit semantics

The commit is an idempotent execution plan with a stable session ID and per-action content hash.

- Replaying an identical plan returns the prior result.
- Changing the plan creates a new content identity.
- Each completed action is journaled.
- A failure after earlier writes reports exactly what is live.
- Resume continues from verified state rather than repeating completed actions.
- Completion is stamped only after every required action passes read-back verification.

Where one database transaction cannot contain every record type, the UI must not imply atomicity. It shows a recoverable partial state and a single `FINISH SETUP` action.

### 10.5 Completion

Only a fully verified setup shows:

```text
CATALOG READY
Vinyl installation is ready to quote. Opening inventory is still zero.
```

Catalog completion creates the normal notification-rail event.

---

## 11. Supplier SKU Handling

The operator requires DekSmart supplier SKUs, but public supplier material does not expose the membrane colour codes or the Grey Vinyl Clip ordering code.

Rules:

- Populate every verified DekSmart SKU.
- Never generate an internal-looking substitute in the supplier SKU field.
- Allow a nullable supplier SKU when the catalog identity is unambiguous from family and colour.
- Persist an operator-visible verification item for every missing supplier SKU.
- Missing supplier SKUs do not block quoting.
- Inventory Import may backfill the supplier SKU when a trusted uploaded list provides it.
- A successful backfill resolves the corresponding verification item.
- A conflict between an existing SKU and an imported SKU requires operator review.

Known supplier SKUs in this acceptance case:

- `VG2510`
- `VG15023`
- `VG4500`
- `VDF15`
- `VDF05`
- `VDFG`

Unknown supplier identifiers:

- 21 membrane colour variants
- Grey Vinyl Clip

---

## 12. Inventory Import Tool

### 12.1 Boundary

Inventory Import is a separate, reusable OPS tool. It is launched after catalog completion or from a permanent catalog action.

Catalog setup does not wait for the import, and an import failure cannot roll back the catalog.

### 12.2 Completion prompt

```text
ADD OPENING INVENTORY

Do you have a current inventory list to add? Upload it and OPS will match each
item to this catalog before anything is saved.

UPLOAD LIST
ENTER MANUALLY
NOT NOW
```

Selecting `NOT NOW` leaves inventory at zero and keeps `Add opening inventory` available from the catalog.

### 12.3 Inputs

The first version accepts:

- XLSX
- CSV
- pasted plain-text inventory lists

It does not require the file to use OPS column names.

### 12.4 Import pipeline

1. Upload or paste.
2. Parse to immutable source rows.
3. Detect headers, units, quantities, locations, SKUs, dimensions, and descriptions.
4. Match each row to a live catalog family and variant.
5. Normalize the row to a proposed inventory operation.
6. Flag unmatched, duplicate, contradictory, or ambiguous rows.
7. Show the complete dry-run preview.
8. Require explicit `ADD INVENTORY` confirmation.
9. Commit idempotently.
10. Read back quantities and physical stock units.

Phase C may suggest a match, but it cannot save an ambiguous row.

### 12.5 Canpro row interpretations

The importer understands:

- full membrane rolls
- supplier pre-cuts
- usable membrane offcuts
- full and partial adhesive pails
- full 8ft flashing sticks
- full 10ft Vinyl Clip sticks

For membrane stock, one source row may create one or more physical `catalog_stock_units`.

For adhesives:

- normalize usable stock to quarter-pail increments
- round an imprecise remainder down conservatively

For flashing and clip:

- import full-stick counts only
- do not create inventory from leftover pieces

The default location is `Canpro Shop`, but the operator may change it in review.

### 12.6 Duplicate prevention

The importer stores:

- source-file hash
- sheet identity
- normalized row fingerprint
- matched target
- proposed operation
- committed operation ID

Uploading the same list again must show the prior import rather than add the quantities twice. A changed file receives a new version and compares against the last committed import.

### 12.7 Permissions and failures

- Reading and drafting require catalog/inventory view access.
- Saving requires `inventory.manage` and `catalog.stock.adjust`.
- If permission is missing, preserve the draft and identify the required owner/admin action.
- Offline parsing may continue when possible; saving waits for connectivity.
- A failed row does not silently disappear.
- Partial writes report exact committed rows and resume safely.
- Long-running imports create a persistent notification that resolves when review or completion occurs.

---

## 13. Specialized OPS Capability Seam

Phase C may discover enabled OPS capabilities through an internal manifest. Users see `// OPS TOOLS`; they do not see MCP terminology.

Each capability declares:

- stable ID and version
- plain-language name
- required inputs
- structured outputs
- feature and permission gates
- side-effect class: read, calculate, draft, or write
- confirmation policy
- fallback behavior

### 13.1 Catalog-relevant capabilities

#### Deck geometry

**Purpose:** Provide area, cut plan, exposed edges, and wall/parapet edges from an enabled Deck Designer record.

**Side effect:** Read/calculate.

**Fallback:** Manual dimensions and linear-foot inputs.

#### Opening inventory import

**Purpose:** Convert a current inventory list into a reviewed inventory draft.

**Side effect:** Draft until `ADD INVENTORY`; write after confirmation.

**Fallback:** Manual stock entry.

This specification defines the contracts and the Phase C connection points. A system-wide capability registry, builder-facing menu, and retrofit of every specialized OPS feature remain a separate initiative.

---

## 14. Permissions

The guided catalog experience is visible only when the user can view the catalog and the company has the feature enabled.

| Action | Required permission |
|---|---|
| Read catalog context | `catalog.view` |
| Run guided setup and commit structure | `catalog.run_setup` |
| Manage products directly | `catalog.products.manage` or the canonical catalog-manage equivalent |
| Import a source file | `catalog.import` |
| Save opening inventory | `inventory.manage` and `catalog.stock.adjust` |

Permissions are checked:

- before the flow starts
- before a capability is offered
- immediately before each write

The agent never elevates authority through a service role on behalf of an unpermitted operator.

---

## 15. Error and Recovery Contract

| Scenario | Required behavior |
|---|---|
| No network during interview | Preserve the durable draft; identify which live checks are stale |
| No network during commit | Do not assume failure; reconcile by idempotency key on reconnect |
| Agent returns malformed structure | Reject invalid fields; keep the conversation and known facts |
| Existing catalog changes during review | Re-read, show the delta, and require renewed approval |
| Duplicate product/family/task type appears | Re-plan as reuse/merge; never create another duplicate |
| Required SKU unknown | Leave nullable, create a verification item, continue quoting setup |
| Required unit or variant cannot resolve | Block the affected recipe; do not silently drop it |
| Task-type creation fails | Preserve draft and mark products incomplete |
| Catalog partly commits | State exactly what is live and offer `FINISH SETUP` |
| Import row is ambiguous | Hold row for review; do not save it |
| Same inventory list uploaded twice | Show prior import; do not increment inventory again |
| Browser refresh or sign-out | Resume after authentication if the session is still authorized |
| Another setup session is active | Show the existing session and prevent concurrent conflicting commits |

---

## 16. Acceptance Criteria

### 16.1 Canpro catalog

The acceptance run must prove:

- one standard 68mil installation product at $11.73/sqft
- one staff-only 60mil product at $12.73/sqft
- $1,500 minimum before GST for both
- no customer-facing thickness choice
- colour is quote-selectable and maps to stock
- all 19 68mil and both 60mil colours exist exactly once
- both products link to the existing `Vinyl Install` task type
- correct, mutually exclusive 68mil and 60mil material systems
- 68mil includes Grey Vinyl Clip
- 60mil excludes clip
- 60mil wall contact is not separately tracked
- standard and condo supplier costs are distinct
- labor cost is separate from material cost
- opening inventory is zero
- all inventory locations default to Canpro Shop
- the existing partial Vinyl family is reconciled rather than duplicated
- missing supplier SKUs are visible and not invented

### 16.2 Agent behavior

- asks one unresolved question at a time
- identifies contradictions
- separates customer and staff choices
- shows source and confidence
- makes no writes before confirmation
- rechecks permissions and live state before commit
- retries without duplicates
- reports partial results honestly
- verifies the final live state

### 16.3 Inventory import

- imports XLSX, CSV, and pasted lists
- maps rows to the newly completed catalog
- handles rolls, cuts, offcuts, quarter-pails, and full sticks
- defaults to Canpro Shop
- blocks ambiguous rows
- previews every write
- requires confirmation
- prevents duplicate imports
- supports `NOT NOW` without losing the future entry point

---

## 17. Verification Strategy

### Automated

- conversation-state reducer tests
- proposal schema and semantic-validator tests
- customer/staff visibility tests
- thickness-option prohibition tests
- colour-to-variant mapping tests
- recipe compatibility tests
- task-type reuse/create/link tests
- live reconciliation and blank-variant tests
- content-addressed idempotency tests
- lost-response reconciliation tests
- partial-commit recovery tests
- inventory parser and field-mapping tests
- import fingerprint/deduplication tests
- physical stock-unit creation tests
- quarter-pail rounding tests
- full-stick rounding tests
- permission matrix tests
- i18n key-parity tests

### Integration

- authenticated Canpro-shaped fixture through review and commit
- existing partial family upgraded in place
- products read back with task type, prices, minimum, tax, visibility, options, and recipes
- second identical commit produces no new records
- inventory import after catalog completion
- second identical inventory import produces no stock change

### End to end

As `canprojack@gmail.com`:

1. Open Catalog.
2. Start guided setup.
3. Complete or resume the Phase C interview.
4. Review the exact Canpro blueprint.
5. Confirm `CREATE CATALOG`.
6. Observe `CATALOG READY`.
7. Choose `UPLOAD LIST`, `ENTER MANUALLY`, or `NOT NOW`.
8. Create a 68mil quote and confirm no thickness choice is shown.
9. Staff-select the 60mil product and confirm the quote states 60mil.
10. Confirm the calculated minimum and GST behavior.

---

## 18. Explicit Non-Goals

- Building a Canpro-specific deck geometry engine inside catalog setup
- Exposing MCP terminology to users
- Building the system-wide OPS capability registry in this workstream
- Retrofitting every specialized OPS build in this workstream
- Estimating Canpro's current inventory
- Adding reorder alerts for job-ordered membrane
- Treating flashing or clip offcuts as stock
- Offering supply-only vinyl products
- Offering thickness as a customer choice
- Automatically applying condo pricing
- Inventing missing supplier SKUs

---

## 19. Source Register

| Source | Facts used |
|---|---|
| Canpro operator interview, 2026-07-24 | Selling rules, pricing, minimum, tax, staff/customer visibility, material compatibility, labor, inventory semantics, location, and workflow decisions |
| Canpro-provided `Deksmart Material Costs Reference`, last updated April 2026 | Standard and condo costs, packaging, coverage, supplier SKUs, and purchasing terms |
| `https://www.deksmart.com/colors-patterns.php` | Current 68mil and 60mil colour lists |
| `https://www.deksmart.com/pdfs/DekSmart%20Ultra%20Products%20-%20Data%20Sheet%20-%20low%20res.pdf` | 68mil construction, width, length, and published colour reference |
| `https://www.deksmart.com/pdfs/DekSmart%20Smoothback%20Products%20-%20Data%20Sheet%20-%20low%20res.pdf` | 60mil smoothback construction, width, length, and colours |
| Read-only production query for company `a612edc0-5c18-4c4d-af97-55b9410dd077`, 2026-07-24 | Existing Vinyl family, Type/Color axes, 15 variants, zero quantities, zero stock-unit references, and zero recipe references |

Supplier costs are operator-provided commercial data. Public DekSmart material
corroborates the product specifications but does not publish every dealer price
or ordering code.

---

## 20. Final Product Copy

### Catalog confirmation

```text
CREATE CATALOG
```

### Catalog success

```text
CATALOG READY
Vinyl installation is ready to quote. Opening inventory is still zero.
```

### Inventory handoff

```text
ADD OPENING INVENTORY

Do you have a current inventory list to add? Upload it and OPS will match each
item to this catalog before anything is saved.

UPLOAD LIST
ENTER MANUALLY
NOT NOW
```

### Recoverable partial state

```text
SETUP NEEDS ATTENTION
Some catalog items are live. Review the remaining items and finish setup.

FINISH SETUP
```
