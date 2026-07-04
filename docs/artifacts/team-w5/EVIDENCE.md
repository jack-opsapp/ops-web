# W5 — Team surface + per-member permission exceptions · Evidence

Branch `feat/team-permission-exceptions` · 2026-07-03 · verified against dev (port 3200, `DEV_BYPASS_AUTH`, operator PETE / MAVERICK PROJECTS LTD).

## 1. Screenshots (1280×900)

- `01-roster.png` — the rebuilt Settings › TEAM roster: `// CREW` instrument strip (4 members · 4/10 seats · 6 open · 4 active · 0 pending), JetBrains Mono tabular numbers, RegisterTable roster with RBAC Role tags, PETE's ADMIN shield, `[YOU]` marker, state-aware filter chips (ALL / UNASSIGNED), outlined-accent ADD MEMBER CTA.

Member access view (captured + visually confirmed in-session; accessibility tree below documents every element). Opening member **Mike Metcalf** (`d875654c`), who holds real `catalog.*` override rows, rendered:

```
← TEAM                                                    [ SAVE CHANGES ]
┌ Mike Metcalf · vipermike1974@outlook.com · 000…      [ SEATED ] ┐
// ROLE   [ Admin ] [ Owner ] [ Office ] [ Operator ] [ Crew ] [ Unassigned ]
          (SPEC Operator filtered out — internal ops-console role)
// ACCESS   [ 5 EXCEPTIONS ]                                  RESET ALL
  // CORE OPERATIONS                                                  +
  // FINANCIAL                                                   [5]  −
     Estimates            [ NONE | View Only | Manage | Full Access ]
     Invoices             [ NONE | ... ]
     Pipeline             [ NONE | ... ]
     Products             [ NONE | ... ]
     Catalog  [CUSTOM] [ADDED] ↺   [ NONE | ... ]   ← exception tag + reset
     Expenses / Accounting / Financial Summaries  [ NONE | ... ]
  // RESOURCES  +      // PEOPLE & LOCATION  +      // ADMIN  +
```

The exception editor works end-to-end against real override data: the category carrying exceptions auto-expands, deviations from the role carry an `ADDED`/`WIDENED`/`NARROWED`/`REVOKED` tag + a reset-to-role control, the count + `RESET ALL` track live edits, and Save is dirty-gated. Zero console errors across roster + member view.

> Data-fidelity note: these dev shots were taken **before** the migration was applied to prod (apply is Jackson's gate). Pre-migration, cross-member `user_roles` reads are blocked by the old own-row-only policy, so other members' Role tags read UNASSIGNED and Mike's role baseline doesn't load (his catalog overrides therefore all classify as ADDED). Post-migration the roster tags resolve and exception classification reflects the real role baseline. PETE's ADMIN tag resolves via `is_company_admin` and is unaffected.

## 2. Permission engine — test output (vitest, 59/59)

```
✓ tests/unit/permissions/resolve.test.ts        (20 tests)   role∪override resolution, exceptions, diff round-trip, admin bypass, min-mutation
✓ tests/unit/permissions/registry.test.ts       ( 5 tests)   registry ⊇ DB; spec.admin excluded; view_financials out of Manage tier
✓ tests/unit/permissions/catalog-run-setup-registration.test.ts ( 7 tests)   inventory.manage registered; dead inventory bits stay retired
✓ tests/integration/permission-overrides-route.test.ts (13 tests)   guard chain: 400/401/403/409, registry+scope validation, upsert/clear/notify
✓ tests/integration/role-permissions-route.test.ts     (11 tests)   preset/cross-company/permission guards, transactional replace + restore
✓ tests/integration/user-role-delete-route.test.ts     ( 3 tests)   role removal + legacy column reset
Test Files  6 passed (6)   Tests  59 passed (59)
```

## 3. Read-only prod proof of the exact bug (before migration)

Crew user `5d737580` holds a `deck_builder.view` override at scope `all`, but their role grants only `assigned`:

```
role_scope   = assigned
override_row = all granted=true
public.has_permission('5d737580…','deck_builder.view','all')  →  FALSE   ← override ignored (the bug)
```

After migration `20260703120000` the same call returns TRUE (override widens assigned→all). Safety recon confirmed all 18 existing override rows are grants (14 `all`, 4 `assigned`), **zero revokes** → the function change is widen-only for existing data; none touch the financial RLS-ceiling tables; the 1 stale (wrong-company) row is correctly ignored.

## 4. Design-system audit — PASS

Zero bare hex in the new components. The single `rgba(255,255,255,0.18)` is the toggle active-border DESIGN.md §9 documents as tokenless (used verbatim in the shipped roles-tab). All colors/radii/fonts/motion trace to tokens; px literals are icon sizes matching shipped conventions.

## 5. Gated on Jackson

1. **Apply migration `20260703120000_permission_overrides_engine` to prod** (auto-mode correctly blocked the direct apply as a production change).
2. **Merge `feat/team-permission-exceptions`** (auto-deploys to customers).
