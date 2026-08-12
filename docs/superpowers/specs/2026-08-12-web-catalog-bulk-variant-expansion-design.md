# Web Catalog Bulk Variant Expansion — Design

## Outcome

OPS-Web gives a catalog manager one foreground operation for adding a real option axis across many existing stock families. The canonical operation labels every current rail variant `Round top` under `Top profile`, then creates the corresponding `Flat top` combinations with zero stock and blank SKUs.

This is a dimensional-expansion tool. It does not edit quantities, rename arbitrary variants, duplicate families, or import a spreadsheet.

## Entry and authority

- Entry: Catalog kebab → STOCK → `Bulk Add Variants`.
- The entry is rendered only when `can("catalog.manage")` is true.
- The dialog re-checks the client permission before apply.
- PostgreSQL independently resolves the Firebase caller's active company and requires `catalog.manage:all`; no role name grants authority.
- The RPC is `SECURITY INVOKER` and is executable only by `anon` and `authenticated`, matching the live Firebase-to-Supabase bridge.

## Web-native workflow

The feature is one large dense-glass dialog with a fixed header, one internal scroll region, and a fixed footer. It remains a single accessible Radix dialog, so focus is trapped, Escape closes when no apply is running, and focus returns to the kebab trigger.

The neutral progress strip is `FAMILIES → CHANGE → REVIEW`. Only the footer's primary action uses steel blue. Stage changes use the OPS ease curve and become opacity-only under reduced motion.

### FAMILIES

- Fetch active, non-deleted stock families with their active variants, active option axes, active values, and active joins.
- Search matches family, category, option name, and option value.
- Every family remains visible. A structural preflight disables unsafe rows and states the exact reason: no active variants, duplicate normalized axes/values, unknown values, incomplete assignments, multiple values on one axis, or duplicate active signatures.
- `SELECT VISIBLE` selects only safe families in the current result set. `CLEAR VISIBLE` removes only those visible selections.
- The selected count remains visible while the list scrolls.

### CHANGE

- Inputs: option name, existing/source value, and 1–20 new values.
- Whitespace is trimmed and collapsed; comparisons are case-insensitive.
- Empty values, repeated normalized values, and source-value no-ops are blocked at the owning field.
- Suggestions are derived from the selected families and remain editable text, not a restrictive picker.

### REVIEW

- Show exact selected-family, existing-label, new-variant, and already-present counts.
- State preservation rules once: current identities, stock, SKUs, settings, and history stay in place; new rows start at zero with blank SKUs.
- Each family shows `before → after` active-variant counts.
- Expansion reveals every source combination and the resulting combinations, including already-present skips.
- Apply is enabled only with a current valid preview, `catalog.manage`, connectivity, at least one real addition, and no in-flight request.

## Draft and recovery

- Persist stage, family IDs, field values, and the lowercase UUID idempotency key under a company-scoped local-storage key.
- Search is transient. Success or explicit discard clears the draft.
- Offline operators can select and edit. Apply is disabled with a direct connection message.
- Network uncertainty keeps the same idempotency key so a retry replays a committed response.
- Stale catalog state triggers an immediate catalog-family and stock refresh, returns to the refreshed review, and writes nothing.
- Idempotency-key reuse with changed input refreshes the catalog and rotates the local key only after the server rejects the conflict.

## Client planning contract

The pure planner mirrors the approved iOS planner while tightening whitespace normalization and source-value validation:

1. Validate the global change.
2. Validate each selected family structurally.
3. Resolve at most one normalized target axis per family.
4. If the axis is new, mark every active variant for the existing value and clone every combination for every new value.
5. If the axis exists, require at least one active variant carrying the source value and clone only those variants.
6. Carry every non-target axis through unchanged.
7. Omit combinations whose normalized signature already exists.
8. Build an exact source snapshot and deterministic fingerprint for stale detection.

The snapshot includes every field whose change can alter the operation: family identity/name, option/value identity/name/order, active variant identity, SKU, quantity, safe copied settings, active state, and option-value joins.

## Database contract

`public.catalog_bulk_expand_variants(uuid, text, jsonb)` performs one transaction:

1. Resolve and verify the caller's company and `catalog.manage:all` permission.
2. Validate the lowercase UUID idempotency key and bounded payload.
3. Acquire a company-scoped transaction advisory lock.
4. Replay an identical receipt or reject changed input under the same key.
5. Lock all selected families and active source variants in UUID order.
6. Rebuild every source snapshot and validate every family before the first write.
7. Resolve/create the target axis and values.
8. Add the existing-value join to current variants only when the axis is new.
9. Clone source variants with zero quantity and null SKU, copying only price/cost overrides, thresholds, unit, and active state.
10. Insert only the new option-value joins and write the company-scoped receipt.

The function never updates existing variant rows and never reads from or writes to `catalog_stock_units`, deductions, orders, snapshots, or other history to manufacture clones. Existing foreign-key relationships remain attached to their original variant IDs.

Normalized active-axis and active-value unique indexes close the concurrency gap. The live schema preflight found no normalized axis/value duplicates; the existing active-signature duplicates remain safe because both client and server disable those families instead of adding a global matrix constraint.

## Refresh and completion

The successful mutation awaits active TanStack refetches for both catalog stock and bulk-family snapshots before the dialog reports completion. No notification-rail event is created because the work is synchronous and already has foreground completion feedback.

## Accessibility and responsive behavior

- Standard web form controls remain at the design-system 36px tier; the workflow is not a compact workbar.
- Keyboard users can search, select, add/remove values, move back/forward, expand families, and apply without pointer input.
- Disabled family rows expose their reason; metrics and step state have explicit accessible labels.
- At narrow widths the dialog becomes one column, metrics wrap, and the family/change/review content owns one vertical scroll region without hiding the footer.
- All visible and accessible strings are in the catalog dictionaries in English and Spanish.
