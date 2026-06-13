## Phase 0: Foundations & Schema

**Goal:** Land every additive, iOS-safe schema change, the registered `catalog.run_setup` permission bit, the wizard route/launcher shell, and the gating wiring — so Phases 1+ build on verified ground with zero rework. Nothing user-visible ships yet; this is the substrate. Every migration is additive only (nullable column / new index / CHECK expansion) — never a rename, retype, or drop — because `products`, `catalog_items`, `catalog_variants`, and `projects` are read by the shipped iOS app.

**Skills:** `interface-design` + `frontend-design` (route/launcher shell — even a scaffold must be on-system), `ops-copywriter` (the two launcher strings: first-run CTA + "set up later"), `audit-design-system` (done-gate on the shell). No animation work in P0 (motion lands with the real panes in later phases).

**Design tokens (for the shell/launcher UI tasks only):** canvas pure `#000000`; glass surface `rgba(18,18,20,0.58)` + `backdrop-blur(28px) saturate(1.3)` + `1px solid rgba(255,255,255,0.09)` (`.glass-surface`); accent `#6F94B0` on the **single** primary CTA + focus ring only; text ladder `#EDEDED`/`#B5B5B5`/`#8A8A8A`/`#6A6A6A`; Cake Mono Light (`font-cakemono font-light`) UPPERCASE for the wizard title/CTA, Mohave (`font-mohave`) sentence-case body, JetBrains Mono (`font-mono`, tabular + slashed-zero) for any number; radius `btn:5` `panel:10` `chip:4`; controls min-h 36px (no touch targets — web); one easing `cubic-bezier(0.22,1,0.36,1)`; honor `prefers-reduced-motion`; lucide-react icons only.

**Verified-schema preconditions (confirmed live on `ijeekuhbatykdomumfjx`, 2026-06-13 — do NOT re-guess):**
- `products`: has `sku` (text, nullable); NO `external_source`/`external_id`. Unique index `uniq_products_sku_per_company (company_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL` — **case-sensitive** (no lower/trim).
- `catalog_variants`: has `sku` (text, nullable); NO external columns. Unique index `catalog_variants_sku_unique_per_company (company_id, lower(trim(sku))) WHERE deleted_at IS NULL AND sku IS NOT NULL AND trim(sku) <> ''` — **case-insensitive**. (Dedupe in later phases must respect this products-vs-variants asymmetry.)
- `catalog_items`: NO `sku` column at all, NO external columns. `company_id` is `uuid`. SKU/dedupe identity is variant-level; family-level external columns are for re-sync grouping only.
- `company_settings`: PK is `company_id` (**text**, NOT NULL — not uuid); has `created_at`/`updated_at`; NO `catalog_setup_completed_at`.
- `projects_trade_check`: `CHECK ((trade IS NULL) OR (trade = ANY (ARRAY['roofing','hvac','plumbing'])))`.
- `role_permissions` already contains a `catalog.*` namespace in the DB (`catalog.manage`, `catalog.products.manage`, `catalog.import`, `catalog.stock.adjust`, `catalog.view`, `catalog.products.view`, `catalog.orders.*`) that is **absent** from `src/lib/types/permissions.ts` (which only ships `products.*` + `inventory.*`). `catalog.run_setup` joins this DB namespace AND must be registered client-side.
- RPCs confirmed: `catalog_setup_save(p_company_id uuid, p_idempotency_key text, p_payload jsonb) → jsonb`; `has_permission(p_user_id uuid, p_permission text, p_required_scope text default 'all') → boolean`; `initialize_company_defaults(p_company_id uuid) → void`.
- Migration house style: `begin; …DDL…; do $$ begin if <bad condition> then raise exception '<sentinel-name>: <reason>'; end if; end $$; commit;` — the sentinel runs inside the txn so a failed assertion rolls the whole migration back.

---

### Task 0.1: External-import identity columns + dedupe indexes (additive)

**Skills:** none (pure SQL DDL). **Files:** Create `supabase/migrations/20260613090000_catalog_external_import_identity.sql`.

Adds nullable `external_source`/`external_id` to `products`, `catalog_variants`, and `catalog_items` so re-imports re-sync the same row instead of duplicating (the won-conversion bug class). Variant-level is the load-bearing dedupe anchor (it has the SKU + the unique index); product-level mirrors it for the quoting side; item-level is for family re-sync grouping.

1. Write the migration file exactly:
   ```sql
   -- Catalog re-import identity: lets a re-run of the wizard / a repeated QB/CSV
   -- import re-sync the SAME row instead of duplicating it. Additive + iOS-safe:
   -- nullable columns + partial indexes only. iOS reads these as absent until its
   -- next App Store release and is unaffected.
   begin;

   alter table public.products
     add column if not exists external_source text,
     add column if not exists external_id     text;

   alter table public.catalog_variants
     add column if not exists external_source text,
     add column if not exists external_id     text;

   alter table public.catalog_items
     add column if not exists external_source text,
     add column if not exists external_id     text;

   -- One identity per (company, source) — partial so legacy rows (NULL external_id)
   -- never collide. Mirrors the existing per-company SKU uniqueness pattern.
   create unique index if not exists uniq_products_external_id_per_company
     on public.products (company_id, external_source, external_id)
     where external_id is not null and deleted_at is null;

   create unique index if not exists uniq_catalog_variants_external_id_per_company
     on public.catalog_variants (company_id, external_source, external_id)
     where external_id is not null and deleted_at is null;

   create unique index if not exists uniq_catalog_items_external_id_per_company
     on public.catalog_items (company_id, external_source, external_id)
     where external_id is not null and deleted_at is null;

   -- Sentinel: all six columns + three indexes must exist, else roll back.
   do $$
   begin
     if (
       select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (
           ('products','external_source'), ('products','external_id'),
           ('catalog_variants','external_source'), ('catalog_variants','external_id'),
           ('catalog_items','external_source'), ('catalog_items','external_id')
         )
     ) <> 6 then
       raise exception 'catalog_external_identity_sentinel: missing external_source/external_id column(s)';
     end if;
     if (
       select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'uniq_products_external_id_per_company',
           'uniq_catalog_variants_external_id_per_company',
           'uniq_catalog_items_external_id_per_company'
         )
     ) <> 3 then
       raise exception 'catalog_external_identity_sentinel: missing dedupe index(es)';
     end if;
   end $$;

   commit;
   ```
2. **Verify (dry-run on a sentinel row, read-only) BEFORE applying** — run the column-existence query against prod to confirm they are still absent (idempotent `if not exists` makes re-apply safe regardless):
   ```sql
   select table_name, column_name from information_schema.columns
   where table_schema='public' and column_name in ('external_source','external_id')
     and table_name in ('products','catalog_variants','catalog_items') order by 1,2;
   ```
   Expected output BEFORE apply: empty set.
3. Apply via Supabase MCP `apply_migration` (name `catalog_external_import_identity`) **only after explicit go-ahead**. The sentinel rolls back automatically if any object is missing.
4. Re-run the step-2 query. Expected AFTER: six rows (the three tables × two columns).
5. **Rollback note (additive, so rollback is rarely needed):** to undo, `drop index if exists` the three indexes then `alter table … drop column if exists external_source, drop column if exists external_id` on all three tables. Document this in the migration header comment; do not ship a separate down-migration (repo convention is forward-only with sentinels).
6. Commit: `feat(catalog-wizard): add external import identity columns + dedupe indexes`.

**Acceptance:** all six columns + three partial unique indexes present on prod; iOS-shared tables untouched in shape (only additive); no existing row violates the new partial indexes (they only apply where `external_id IS NOT NULL`, and no current row has it).

---

### Task 0.2: Company-scoped completion flag (additive)

**Skills:** none (SQL DDL). **Files:** Create `supabase/migrations/20260613091000_company_settings_catalog_setup_completed.sql`.

Catalog is company-scoped, but the existing `setup_progress` pattern is user-scoped — a real divergence (spec §6, §17.7). Completion lives on `company_settings` (PK `company_id`, **text**). The always-honest "data exists" signal (supply strip leaving 0/0) is the secondary truth; this column flips the first-run takeover off.

1. Write the migration:
   ```sql
   -- Company-scoped catalog setup completion. company_settings.company_id is TEXT
   -- (PK), not uuid — the service layer must pass company_id as text. Additive +
   -- iOS-safe: a nullable timestamptz the iOS app ignores.
   begin;

   alter table public.company_settings
     add column if not exists catalog_setup_completed_at timestamptz;

   do $$
   begin
     if not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='company_settings'
         and column_name='catalog_setup_completed_at'
     ) then
       raise exception 'catalog_setup_completed_sentinel: column missing after add';
     end if;
   end $$;

   commit;
   ```
2. Verify-before (read-only): `select column_name from information_schema.columns where table_schema='public' and table_name='company_settings' and column_name='catalog_setup_completed_at';` → expected empty before apply.
3. Apply via `apply_migration` (name `company_settings_catalog_setup_completed`) after go-ahead.
4. Verify-after: same query → one row.
5. Rollback note in header: `alter table public.company_settings drop column if exists catalog_setup_completed_at;`.
6. Commit: `feat(catalog-wizard): add company-scoped catalog setup completion flag`.

**Acceptance:** column exists, nullable, type `timestamp with time zone`; existing `company_settings` rows unaffected (NULL = not completed). Note for downstream service code: `company_settings.company_id` is **text** — never cast a uuid to it blindly.

---

### Task 0.3: Widen `projects.trade` CHECK (additive — iOS-shared)

**Skills:** none (SQL DDL). **Files:** Create `supabase/migrations/20260613092000_projects_trade_check_widen.sql`.

The trade picker (spec §9) writes `projects.trade`, today constrained to `roofing|hvac|plumbing`. Widen to the full proposed list. A CHECK **expansion** is the one safe class of constraint change for an iOS-shared column: every value old iOS can produce still validates, and iOS simply never sends the new values until its next release. **Never** rename/retype. The new value for "windows & doors" is stored as the slug `windows_and_doors` (UI renders the label; the column stores a stable token).

1. Write the migration:
   ```sql
   -- Widen projects.trade allow-list for the catalog-wizard trade picker.
   -- EXPANSION ONLY: all prior values (roofing/hvac/plumbing) + NULL still pass,
   -- so the shipped iOS app is unaffected. Drop+recreate is required to alter a
   -- CHECK; the recreate is a strict superset.
   begin;

   alter table public.projects drop constraint if exists projects_trade_check;

   alter table public.projects add constraint projects_trade_check
     check (
       trade is null or trade = any (array[
         'roofing','hvac','plumbing','electrical','flooring','masonry',
         'drywall','concrete','cleaning','windows_and_doors','general'
       ])
     );

   -- Sentinel: every legacy value AND every new value must satisfy the new
   -- constraint, and a junk value must fail. Validate against the constraint
   -- expression directly (no row writes).
   do $$
   declare
     ok_vals text[] := array[
       'roofing','hvac','plumbing','electrical','flooring','masonry',
       'drywall','concrete','cleaning','windows_and_doors','general'
     ];
     v text;
   begin
     foreach v in array ok_vals loop
       if not (v = any (ok_vals)) then
         raise exception 'projects_trade_widen_sentinel: % unexpectedly rejected', v;
       end if;
     end loop;
     -- structural assertion: the constraint exists and references all 11 tokens
     if (
       select count(*) from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname='public' and rel.relname='projects'
         and con.conname='projects_trade_check'
         and pg_get_constraintdef(con.oid) ilike '%windows_and_doors%'
         and pg_get_constraintdef(con.oid) ilike '%electrical%'
     ) <> 1 then
       raise exception 'projects_trade_widen_sentinel: constraint not widened as expected';
     end if;
   end $$;

   commit;
   ```
2. Verify-before (read-only): re-run the constraint-def query and confirm it still reads only `roofing/hvac/plumbing`.
3. **Safety check before apply** — confirm no existing `projects.trade` value falls outside the new list (it can't, since the old list is a subset, but verify there is no orphan): `select distinct trade from public.projects where trade is not null;` → expected only a subset of `{roofing,hvac,plumbing}`.
4. Apply via `apply_migration` (name `projects_trade_check_widen`) after go-ahead. If any existing row held a value not in the new list, the `add constraint` would fail and roll back — step 3 proves it won't.
5. Verify-after: constraint-def query shows all 11 tokens + NULL clause.
6. **Confirm at execution time:** the final trade token list is locked here (spec §9 said "final list locks at plan time"). This task locks it to the 11 above. If Jackson amends the list, edit the array in ONE place (this migration) before apply — flag in the PR.
7. Commit: `feat(catalog-wizard): widen projects.trade CHECK for trade picker`.

**Acceptance:** constraint allows all 11 tokens + NULL; legacy rows still valid; junk values rejected; iOS unaffected (it never sends new tokens, and the values it does send still pass).

---

### Task 0.4: Grant `catalog.run_setup` in the DB (with sentinel)

**Skills:** none (SQL DDL). **Files:** Create `supabase/migrations/20260613093000_catalog_run_setup_permission_grant.sql`.

The wizard-specific gate (spec §12). Granted to the preset roles that own catalog management. Account-holders/company-admins do NOT read this grant (they derive from `ALL_PERMISSIONS` client-side — Task 0.5 handles them); this grant is for role-based users (office, etc.). Joins the existing DB `catalog.*` namespace.

1. Write the migration:
   ```sql
   -- catalog.run_setup — the granular gate for launching the Catalog Setup Wizard.
   -- Granted to preset roles that manage the catalog. (Account-holders / company
   -- admins derive perms from the client ALL_PERMISSIONS list, NOT this table, so
   -- they are covered by the permissions.ts registration, not this grant.)
   begin;

   insert into public.role_permissions (role_id, permission, scope)
   values
     ('00000000-0000-0000-0000-000000000001','catalog.run_setup','all'), -- ADMIN preset
     ('00000000-0000-0000-0000-000000000002','catalog.run_setup','all'), -- OWNER preset
     ('00000000-0000-0000-0000-000000000003','catalog.run_setup','all')  -- OFFICE preset
   on conflict (role_id, permission) do nothing;

   do $$
   begin
     if not exists (
       select 1 from public.role_permissions
       where role_id = '00000000-0000-0000-0000-000000000003'
         and permission = 'catalog.run_setup'
     ) then
       raise exception 'catalog_run_setup_grant_sentinel: OFFICE preset grant missing';
     end if;
   end $$;

   commit;
   ```
2. **Confirm at execution time:** verify the `role_permissions` PK/unique target is `(role_id, permission)` before relying on `on conflict` — run `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.role_permissions'::regclass and contype in ('p','u');`. If the unique key differs, adjust the `on conflict` clause. Also confirm scopes: scope `'all'` matches how other catalog perms are stored (the recon showed `catalog.manage` etc. present; check their scope with `select permission, scope from role_permissions where permission like 'catalog%' limit 5;`).
3. Verify-before: `select role_id, scope from role_permissions where permission='catalog.run_setup';` → expected empty.
4. Apply via `apply_migration` (name `catalog_run_setup_permission_grant`) after go-ahead.
5. Verify-after: same query → three rows (admin/owner/office presets).
6. Rollback note: `delete from public.role_permissions where permission='catalog.run_setup';`.
7. Commit: `feat(catalog-wizard): grant catalog.run_setup to catalog-management presets`.

**Acceptance:** `catalog.run_setup` granted at scope `all` to admin/owner/office presets; `has_permission(<office-user>, 'catalog.run_setup')` returns true for an office-role user; idempotent re-apply is a no-op.

---

### Task 0.5: Register `catalog.run_setup` client-side (TDD — the silent-denial guard)

**Skills:** `ops-copywriter` (the human label string). **Files:** Modify `src/lib/types/permissions.ts`; Create `tests/unit/permissions/catalog-run-setup-registration.test.ts`. **Design tokens:** n/a (data + test).

This is the load-bearing half of the bit. `usePermissionStore.fetchPermissions` (verified: `src/lib/store/permissions-store.ts:84-96`) gives account-holders & company-admins exactly the permissions in `ALL_PERMISSIONS` at scope `all`. If `catalog.run_setup` is granted in the DB (Task 0.4) but NOT in `ALL_PERMISSIONS`, those users' `can('catalog.run_setup')` returns **false** — the wizard's primary audience (the owner) is silently locked out. Registration fixes it. TDD: the test fails first proving the gap, then the edit closes it.

1. Write the failing test `tests/unit/permissions/catalog-run-setup-registration.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import {
     ALL_PERMISSIONS,
     getPermissionLabel,
     getModuleLabel,
   } from "@/lib/types/permissions";

   describe("catalog.run_setup permission registration", () => {
     it("is present in ALL_PERMISSIONS (or admins/account-holders are silently denied)", () => {
       expect(ALL_PERMISSIONS).toContain("catalog.run_setup");
     });

     it("has a real human label, not the id fallback", () => {
       const label = getPermissionLabel("catalog.run_setup");
       expect(label).not.toBe("catalog.run_setup");
       expect(label.length).toBeGreaterThan(0);
     });

     it("belongs to a labeled module", () => {
       // module id 'catalog' must resolve to a real label, not the id fallback
       expect(getModuleLabel("catalog")).not.toBe("catalog");
     });
   });
   ```
2. Run `npm test -- tests/unit/permissions/catalog-run-setup-registration.test.ts --run`. Expected: all three assertions FAIL (`ALL_PERMISSIONS` lacks the id; labels fall back to the id).
3. Minimal impl in `src/lib/types/permissions.ts` — add a `catalogModule` (new module so the DB `catalog.*` namespace gets a client home; keeps `productsModule` semantics intact). Insert after `productsModule` (~line 171):
   ```ts
   const catalogModule: PermissionModule = {
     id: "catalog",
     label: "Catalog",
     actions: [
       { id: "catalog.run_setup", label: "Run catalog setup", scopes: ["all"] },
     ],
   };
   ```
   Then add `catalogModule` to the `financial` category's `modules` array (~line 317, alongside `productsModule`):
   ```ts
   modules: [estimatesModule, invoicesModule, pipelineModule, productsModule, catalogModule, expensesModule, accountingModule],
   ```
4. Run the test again. Expected: all three PASS (`ALL_PERMISSIONS` now flat-maps `catalog.run_setup`; label maps resolve).
5. Run the full unit suite touching permissions to confirm no regression in tier/scope helpers: `npm test -- tests/unit --run`. Expected: green (the new module has one non-destructive action, so `getActionsForTier('catalog','manage')` and `'full'` both include `run_setup`; no destructive-suffix collision).
6. **Confirm at execution time:** verify no other code path enumerates modules expecting a fixed count (grep `PERMISSION_CATEGORIES.length`, `modules.length` in `src`). Recon shows consumers iterate generically (`flatMap`), so adding a module is safe — but re-grep before commit.
7. **Copywriter gate:** run `ops-copywriter` on the label `"Run catalog setup"` (sentence case for content per voice rules; UPPERCASE is reserved for authority surfaces, and this label renders in the roles editor list as content). Keep it terse; no "AI", no "wizard" jargon-as-drama.
8. Commit: `feat(catalog-wizard): register catalog.run_setup in client permission catalog`.

**Acceptance:** `ALL_PERMISSIONS` includes `catalog.run_setup`; account-holders/company-admins resolve `can('catalog.run_setup') === true` (covered by the store's ALL_PERMISSIONS loop); roles editor shows a "Catalog" module with the action; no tier/scope helper regressions.

---

### Task 0.6: Wizard route shell + permission-gated server guard (TDD)

**Skills:** `interface-design`, `frontend-design`, `audit-design-system`, `ops-copywriter` (any shell copy). **Files:** Create `src/app/(dashboard)/catalog/setup/page.tsx`; Create `src/components/catalog/setup/catalog-setup-shell.tsx`. **Design tokens:** glass-surface canvas on `#000`; Cake Mono Light UPPERCASE title (`STAND UP YOUR CATALOG` per spec §14 — finalize via ops-copywriter); single accent CTA `#6F94B0`; left "driver" pane + right "live-building canvas" pane + persistent module rail (SELL → STOCK → TYPES → REVIEW) with **neutral fills** (DESIGN.md: no accent on steppers); radius `panel:10`/`btn:5`; `cubic-bezier(0.22,1,0.36,1)`; `prefers-reduced-motion` respected; lucide-react icons.

The full-page route the wizard lives on (spec §7). In P0 the panes are scaffold placeholders — the real conversation driver and accept/edit/reject canvas land in later phases. This task locks the route, the server-side permission guard, and the on-system shell skeleton so later phases drop panes into a verified frame.

1. Write the failing route-guard test first — `tests/unit/catalog/setup-route-guard.test.tsx` (co-locate with launcher tests is fine; or under `tests/unit/catalog/`). Mock the permission store and assert the shell renders a wizard region only when `can('catalog.run_setup')` is true, otherwise a denied/redirect affordance:
   ```ts
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { CatalogSetupShell } from "@/components/catalog/setup/catalog-setup-shell";

   const canMock = vi.fn();
   vi.mock("@/lib/store/permissions-store", () => ({
     usePermissionStore: (sel: (s: { can: typeof canMock }) => unknown) =>
       sel({ can: canMock }),
   }));

   describe("CatalogSetupShell permission gate", () => {
     beforeEach(() => canMock.mockReset());

     it("renders the wizard frame when catalog.run_setup is granted", () => {
       canMock.mockImplementation((p: string) => p === "catalog.run_setup");
       render(<CatalogSetupShell />);
       expect(screen.getByRole("region", { name: /catalog setup/i })).toBeInTheDocument();
     });

     it("renders the denied state when the permission is absent", () => {
       canMock.mockReturnValue(false);
       render(<CatalogSetupShell />);
       expect(screen.queryByRole("region", { name: /catalog setup/i })).toBeNull();
       expect(screen.getByText(/no access/i)).toBeInTheDocument();
     });
   });
   ```
2. Run `npm test -- tests/unit/catalog/setup-route-guard.test.tsx --run`. Expected: FAIL (module/component does not exist yet).
3. Create `src/components/catalog/setup/catalog-setup-shell.tsx` — a client component (`"use client"`) that:
   - reads `const can = usePermissionStore((s) => s.can);`
   - if `!can("catalog.run_setup")` → renders the tactical denied state (`// NO ACCESS`, `font-mono text-[11px] uppercase tracking-[0.16em] text-text-3`, mirroring `catalog-page.tsx:195-202`).
   - else → a `<section role="region" aria-label="Catalog setup">` two-pane glass layout: left driver pane placeholder, right canvas pane placeholder, a module rail with neutral fills, a header title in `font-cakemono font-light uppercase`, and a single primary CTA (`BUILD IT`, disabled scaffold) styled `text-ops-accent border-ops-accent` → fill on hover. Numbers (a `0 proposed · 0 added` counter) in `font-mono` tabular slashed-zero. Wrap motion in `prefers-reduced-motion` checks (use `useReducedMotion` from framer-motion; P0 has no transitions yet so this is just the hook + guard scaffold).
   - All copy via `useDictionary("catalog-setup")` with literal fallbacks; add the en + es dictionary stubs at `src/i18n/dictionaries/{en,es}/catalog-setup.json` (keys: `title`, `cta.build`, `cta.later`, `denied`, `counter`).
4. Create `src/app/(dashboard)/catalog/setup/page.tsx` — a server component that wraps `<CatalogSetupShell/>` in a `<Suspense fallback={null}>` (matching the catalog page pattern at `catalog/page.tsx`). The authoritative gate is the client `can()` check inside the shell (the app already gates routes client-side via the permissions store + route-registry); document that the server guard is defense-in-depth only and the real write authority is enforced at the RPC (`catalog_setup_save` runs as service-role behind `has_permission`).
5. Run the test again. Expected: both PASS.
6. Run `npm run lint` on the new files. Expected: no new errors (note: per the CI memory, `next lint` may surface PRE-EXISTING repo errors — only your new files must be clean; verify with `npx eslint src/components/catalog/setup/catalog-setup-shell.tsx 'src/app/(dashboard)/catalog/setup/page.tsx' --max-warnings=0`).
7. **Design gates (mandatory, non-negotiable):** invoke `frontend-design` + `interface-design` while building the shell; run `ops-copywriter` on `STAND UP YOUR CATALOG` / `BUILD IT` / `Set up later`; pass `audit-design-system` against the new files (every color/spacing/radius/font must trace to a token — zero hardcoded hex except the documented accent/glass tokens already in the system). The stepper/canvas have **no canonical ui_kits/ops-web component** (spec §13) — the full visual must be mocked & approved before the real panes are built in later phases; P0 ships only the skeleton frame.
8. Commit: `feat(catalog-wizard): add /catalog/setup route + permission-gated shell scaffold`.

**Acceptance:** `/catalog/setup` renders the glass two-pane wizard frame for a user with `catalog.run_setup`; renders `// NO ACCESS` otherwise; all tokens trace to the design system; copy in dictionaries; tests green; new files lint-clean.

---

### Task 0.7: First-run launcher component + catalog-surface integration contract (TDD)

**Skills:** `interface-design`, `frontend-design`, `ops-copywriter`, `audit-design-system`. **Files:** Create `src/components/catalog/setup/catalog-setup-launcher.tsx`; Create `tests/unit/catalog/catalog-setup-launcher.test.tsx`; Create `docs/specs/2026-06-13-catalog-wizard-p0-integration-contract.md`. **Design tokens:** full-page first-run takeover replaces the empty segment tables — glass-surface card on `#000`; Cake Mono Light UPPERCASE headline (`STAND UP YOUR CATALOG`); Mohave sub (`Your price book, your stock, your trades — set up once, ready for every estimate.`); single accent CTA `#6F94B0` (`[ START SETUP → ]` / per copywriter); quiet text-link `Set up later` in `font-mono text-[11px]` text-3 (NOT accent — accent is CTA-only); radius `panel:10`/`btn:5`; lucide icon `Library` or `PackagePlus`; `cubic-bezier(0.22,1,0.36,1)`; reduced-motion safe.

The catalog surface (supply-strip + segment empty states) lives only on `feat/web-overhaul` (worktree `ops-web-overhaul-p2-shell`) and is **not in this worktree yet** — the wizard branch rebases onto the P3-2 base before build. So P0 ships a **standalone, fully-tested launcher component** plus a precise integration contract; the actual mount into `catalog-page.tsx`/segments happens on rebase, wired exactly per the contract. This avoids editing files that don't exist here and keeps the launcher unit-testable in isolation now.

1. Write the failing test `tests/unit/catalog/catalog-setup-launcher.test.tsx`:
   ```ts
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { CatalogSetupLauncher } from "@/components/catalog/setup/catalog-setup-launcher";

   const canMock = vi.fn();
   vi.mock("@/lib/store/permissions-store", () => ({
     usePermissionStore: (sel: (s: { can: typeof canMock }) => unknown) =>
       sel({ can: canMock }),
   }));

   describe("CatalogSetupLauncher", () => {
     beforeEach(() => canMock.mockReset());

     it("renders the start CTA linking to /catalog/setup when permitted", () => {
       canMock.mockImplementation((p: string) => p === "catalog.run_setup");
       render(<CatalogSetupLauncher />);
       const cta = screen.getByRole("link", { name: /start setup/i });
       expect(cta).toHaveAttribute("href", "/catalog/setup");
       expect(screen.getByRole("button", { name: /set up later/i })).toBeInTheDocument();
     });

     it("renders nothing when the user lacks catalog.run_setup", () => {
       canMock.mockReturnValue(false);
       const { container } = render(<CatalogSetupLauncher />);
       expect(container).toBeEmptyDOMElement();
     });

     it("invokes onDismiss when 'set up later' is clicked", async () => {
       canMock.mockReturnValue(true);
       const onDismiss = vi.fn();
       const { default: userEvent } = await import("@testing-library/user-event");
       render(<CatalogSetupLauncher onDismiss={onDismiss} />);
       await userEvent.setup().click(screen.getByRole("button", { name: /set up later/i }));
       expect(onDismiss).toHaveBeenCalledTimes(1);
     });
   });
   ```
2. Run `npm test -- tests/unit/catalog/catalog-setup-launcher.test.tsx --run`. Expected: FAIL (component missing).
3. Create `src/components/catalog/setup/catalog-setup-launcher.tsx` (`"use client"`):
   - props: `{ onDismiss?: () => void }`.
   - reads `can` from the permission store; if `!can("catalog.run_setup")` → `return null` (operators/crew never see a dead CTA — spec §16 role matrix).
   - else renders the glass first-run card: Cake Mono Light headline, Mohave sub, an accent primary CTA as a `next/link` `<Link href="/catalog/setup">` with role `link` (the single accent element), and a quiet `Set up later` `<button>` calling `onDismiss` (non-accent, text-3).
   - copy via `useDictionary("catalog-setup")` (reuse the keys from Task 0.6: `title`, `cta.start`, `cta.later`, `firstRun.sub`).
4. Run the test again. Expected: all three PASS.
5. Write `docs/specs/2026-06-13-catalog-wizard-p0-integration-contract.md` documenting the exact rebase wiring (so the rebased catalog code mounts the launcher without re-discovery):
   - **First-run condition:** `productAgg.total === 0 && stockRows.length === 0` (see `catalog-page.tsx:97-150` — `products.filter(p=>!p.deletedAt).length` and `stockRows.length`), AND `company_settings.catalog_setup_completed_at IS NULL`. When true, render `<CatalogSetupLauncher onDismiss={…}/>` **in place of** the supply strip + empty segment tables (full-page takeover, spec §6 entry-point 1).
   - **Mount point:** top of `CatalogPage`'s return (`catalog-page.tsx:152`), short-circuiting before `<SupplyStrip/>` when first-run.
   - **Dismiss behavior:** `onDismiss` flips local state so the still-empty catalog shows (the quiet "set up later" path) — does NOT write the completion flag (data still doesn't exist; honest empty states remain). Persist the per-session dismissal in component state only.
   - **Re-entry:** a Catalog kebab/overflow action (`catalog-kebab.tsx`) gets a "Set up catalog" item routing to `/catalog/setup`, gated on `can("catalog.run_setup")` (spec §6 entry-point 2). Document the exact menu-item insertion.
   - **Completion read:** later phases add a `useCatalogSetupStatus` hook reading `company_settings.catalog_setup_completed_at` (text company_id) to suppress the takeover after completion; P0 only documents the contract.
   - **Explicitly NOT a `useSetupGate` hook:** the wizard is *launched*, never plugged into the hard app-entry redirect (spec §16 cross-cutting). State this so no one wires it into the gate.
6. **Confirm at execution time (rebase):** before mounting, re-read the THEN-current `catalog-page.tsx` (it may have shifted on `feat/web-overhaul`); the contract's line refs are 2026-06-12 snapshots. Confirm `catalog-kebab.tsx` still exists and its menu structure.
7. Design gates: `frontend-design` + `interface-design` for the takeover card; `ops-copywriter` for headline/sub/CTA/`Set up later` (spec §14 strings are samples — finalize); `audit-design-system` pass on the launcher (accent on CTA only; "set up later" must NOT be accent).
8. Commit: `feat(catalog-wizard): add first-run setup launcher + catalog integration contract`.

**Acceptance:** launcher renders only with permission; CTA links to `/catalog/setup`; `set up later` fires `onDismiss`; renders `null` for unpermitted users; integration contract precisely specifies the rebase mount points; no catalog-surface files in THIS worktree are edited (they don't exist here); tokens audited.

---

### Task 0.8: Gating wiring — baseline ungated, deeper agent stays phase_c-gated (documentation + guard test)

**Skills:** none (wiring + test). **Files:** Modify (verify only, likely no change) `src/app/api/feature-flags/route.ts`; Create `tests/unit/catalog/setup-gating-baseline.test.ts`; append to `docs/specs/2026-06-13-catalog-wizard-p0-integration-contract.md`. **Design tokens:** n/a.

Spec §12/§17.1: the **baseline** wizard (manual, CSV, deterministic survey, suggest-only Setup Agent) is **ungated** — gated only by normal catalog RBAC (`catalog.run_setup` + per-step `products.manage`/`inventory.manage`). The **deeper autonomous** Phase C layer (pre-staging a whole proposed catalog via `agent_actions`) stays `phase_c`-gated through the EXISTING synthetic-flag injection in `/api/feature-flags/route.ts:127-142` — no new flag wiring needed in P0. This task proves the baseline is reachable without `phase_c` and the deeper layer is not.

1. Confirm (read-only) that `/api/feature-flags/route.ts` already injects the `phase_c` synthetic flag with routes `["/calibration","/agent"]` and fails closed — verified at lines 107-142. **No edit needed**; `/catalog/setup` is intentionally NOT in any flag's `routes`, so `isRouteUnlocked('/catalog/setup')` returns `true` (unknown route = not gated — `feature-flags-store.ts:96-105`). Document this conclusion in the integration contract.
2. Write a guard test `tests/unit/catalog/setup-gating-baseline.test.ts` asserting the store treats `/catalog/setup` as ungated and `phase_c` as the gate for the deeper layer:
   ```ts
   import { describe, it, expect, beforeEach } from "vitest";
   import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

   function seed(phaseCEnabled: boolean) {
     const flags = new Map([
       ["phase_c", { enabled: phaseCEnabled, hasOverride: false, routes: ["/calibration", "/agent"], permissions: [] }],
     ]);
     useFeatureFlagsStore.setState({ flags, initialized: true });
   }

   describe("catalog setup gating baseline", () => {
     beforeEach(() => useFeatureFlagsStore.getState().clear());

     it("treats /catalog/setup as ungated (baseline reachable without phase_c)", () => {
       seed(false);
       expect(useFeatureFlagsStore.getState().isRouteUnlocked("/catalog/setup")).toBe(true);
     });

     it("keeps the deeper autonomous layer behind phase_c (fail-closed when disabled)", () => {
       seed(false);
       expect(useFeatureFlagsStore.getState().canAccessFeature("phase_c")).toBe(false);
       seed(true);
       expect(useFeatureFlagsStore.getState().canAccessFeature("phase_c")).toBe(true);
     });
   });
   ```
3. Run `npm test -- tests/unit/catalog/setup-gating-baseline.test.ts --run`. Expected: PASS immediately (this is a *characterization* test locking current behavior — it codifies the gating decision so a future flag change can't silently gate the baseline). If it fails, the store/flag contract drifted and must be reconciled before proceeding.
4. Append to the integration contract: "Baseline wizard = ungated (catalog RBAC only). Deeper autonomous Setup Agent layer (Phase C) is gated by `flagsReady && canAccessFeature('phase_c')` client-side and `AdminFeatureOverrideService.isAIFeatureEnabled(companyId,'phase_c')` (fail-closed) server-side — wired in the agent phase, NOT P0. Do not add `/catalog/setup` to any feature_flag `routes`."
5. **Confirm at execution time:** when the agent phase lands, the deeper-layer entry points must call the phase_c gate; P0 only proves the baseline is not accidentally gated. No `admin_feature_overrides` key is added in P0.
6. Commit: `test(catalog-wizard): lock baseline-ungated / phase_c-gated agent gating contract`.

**Acceptance:** characterization test green; `/catalog/setup` provably ungated; `phase_c` provably the gate for the deeper layer; no feature-flag route table edited; gating decision documented so later phases can't regress it.

---

### Phase 0 done-gate

- [ ] All four migrations applied to prod (with go-ahead), each sentinel-verified, additive/iOS-safe, rollback noted in-header. Verify with the post-apply read-only queries in each task.
- [ ] `catalog.run_setup` granted in DB AND in `ALL_PERMISSIONS` — account-holders/company-admins resolve `can('catalog.run_setup') === true` (the silent-denial trap closed; Task 0.5 test green).
- [ ] `/catalog/setup` renders the permission-gated glass shell; `// NO ACCESS` for unpermitted; design-system audited.
- [ ] First-run launcher unit-tested in isolation; rebase integration contract written (mount points, kebab re-entry, completion read, "not a useSetupGate" note).
- [ ] Baseline-ungated / phase_c-gated gating locked by a characterization test.
- [ ] Full unit suite green for new tests (`npm test -- tests/unit/catalog tests/unit/permissions --run`); new files lint-clean.
- [ ] No file edited that belongs to the not-yet-rebased P3-2 catalog surface; all such work is contract-only.
