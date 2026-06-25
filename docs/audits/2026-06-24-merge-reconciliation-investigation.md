# Merge Reconciliation Investigation — `feat/web-overhaul` ⟵ `origin/main`

**Date:** 2026-06-24  ·  **Author session:** `WEB OVERHAUL - P6-1` (investigation only — no merge, no push, no source changes)
**Branches:** `feat/web-overhaul` tip `bb6488f6` · `origin/main` tip `699125c6` · merge-base `97ee9ea2`
**Counts:** overhaul is **185 commits ahead** of the merge-base; main is **19 commits ahead** (PRs #85–#99 + the P2-shell merge).
**Merge surfaces:** `303 files auto-merge clean` + **`70 conflicts` (32 UU content · 34 AA add/add · 4 DU delete/modify)**.

> Method: a throwaway **detached scratch worktree** at `/tmp/ops-web-recon` materialized `git merge origin/main` to surface the 70 conflicts. Every conflicted file got a 3-way analysis (merge-base vs `origin/main` vs `feat/web-overhaul`) across six parallel read-only surface audits. The real branches were never touched. Permission state was verified against **prod `role_permissions`** (project `ijeekuhbatykdomumfjx`).

---

## 1. Executive answer

**This is a real reconciliation, not a fast-forward — but it is overwhelmingly *additive* and highly tractable. Estimate: one focused session (≈ half-day to one day), dominated by two seams, not by conflict volume.**

The root cause makes the 70 conflicts look scarier than they are. PR **#91 "Catalog Setup Wizard" (`bfe64259`) was rebased onto an *earlier* `feat/web-overhaul` and squash-merged**, so that single commit dragged an **older snapshot of the overhaul's own work** (books, shell, catalog, widgets, UI primitives, the master-plan doc) onto `main`. Two weeks of further overhaul work (P3–P5) then advanced those same files. The net effect: **for ~52 of the 70 conflicts, `main` is holding an *older copy of the overhaul's own code*** — the overhaul's newer version simply wins. These are mechanical "take overhaul."

The genuine reconciliation work concentrates in a small, well-bounded set:

| Real work item | Files | Nature |
|---|---|---|
| **Catalog ⇄ Wizard re-graft** | `catalog-page.tsx`, `catalog-kebab.tsx`, route-registry entry, 4 i18n keys | Adopt overhaul's newer catalog, **re-attach #91's wizard** (it is orphaned otherwise) |
| **Permission namespace codemod** | 7 overhaul catalog files (~26 `can()` call-sites) | Convert overhaul's `inventory.*`/`products.*` → `catalog.*` — **forced by prod DB** |
| **EntityPicker #97 adoption** | `cell-team.tsx`, `editable-cell-client.tsx` | Take main's standardized picker; one genuine Jackson UX call |
| **Pipeline #98 lead-detail** | `pipeline-focused-detail-window.tsx` + en/es `pipeline.json` | Take **main** (compile dependency + live i18n keys) |
| **Wiring merge** | `route-registry.ts`(+test), `middleware.ts`, `fab-actions.ts`, `feature-flag-definitions.ts` | Overhaul base + re-add main-only routes/keys |

**Single biggest risk — two *silent* runtime failures that pass a green build:**
1. **Catalog-wizard orphaning.** Adopting the overhaul's `catalog-page.tsx`/`catalog-kebab.tsx` wholesale leaves the entire (clean-merged, live) #91 wizard reachable **only by typing the URL** — both of its mount points (the first-run takeover and the kebab item) live in those two files and the overhaul predates them.
2. **Permission silent denial.** The overhaul checks `inventory.view`/`inventory.import`, which have **zero grant rows in prod `role_permissions`**. Merge naively → crew/PM roles silently lose catalog access while admins (who derive perms from the client catalog) keep it, so it passes every test run by an admin.

Both are invisible to `tsc`/lint/an admin walkthrough. They are the reason this needs a careful pass, not a blind `--theirs`.

---

## 2. Per-surface classification table

Classification legend: **(a)** trivial-adopt-overhaul · **(b)** auto-mergeable · **(c)** NEEDS-DECISION (careful hand-merge / Jackson call) · **(d)** main-only-must-keep.

### Catalog (10 AA + service + 2 i18n)
| File | Type | Class | Resolution |
|---|---|---|---|
| `components/catalog/catalog-page.tsx` | AA | **(c)** | Take overhaul base; **re-graft #91 first-run wizard block**; perms → `catalog.*` |
| `components/catalog/catalog-kebab.tsx` | AA | **(c)** | Take overhaul base; **re-graft "Set up catalog" kebab item**; perms → `catalog.*` |
| `components/catalog/product-editor.tsx` | AA | **(a)** | Take overhaul (perm rename + `t()` strings) → then namespace codemod |
| `components/catalog/cells.tsx` | AA | **(a)** | Take overhaul (radius codemod only) |
| `components/catalog/segments/products-segment.tsx` | AA | **(a)** | Take overhaul → namespace codemod |
| `components/catalog/segments/stock-segment.tsx` | AA | **(a)** | Take overhaul → namespace codemod |
| `components/catalog/stock-drawer.tsx` | AA | **(a)** | Take overhaul (radius only) |
| `components/catalog/supply-strip.tsx` | AA | **(a)** | Take overhaul (radius only) |
| `components/catalog/snapshots-view.tsx` | AA | **(a)** | Take overhaul → namespace codemod |
| `components/catalog/modals/manage-modal.tsx` | AA | **(a)** | Take overhaul (radius only) |
| `lib/api/services/catalog-meta-service.ts` | AA | **(a)** | Take overhaul (net delta = 1 doc-comment line) |
| `i18n/dictionaries/en/catalog.json` | AA | **(c-sm)** | Take overhaul + re-add `kebab.setup` |
| `i18n/dictionaries/es/catalog.json` | AA | **(c-sm)** | Take overhaul + re-add `kebab.setup` |

### Books (9 components + test + 2 i18n) — **all (a)**, zero QBO risk
| File | Type | Class | Resolution |
|---|---|---|---|
| `books/ledger-strip.tsx`, `books/period-pill.tsx`, `books/segments/ar-aging-view.tsx`, `books/segments/estimates-segment.tsx`, `books/segments/invoices-segment.tsx`, `books/modals/{estimate,invoice,record-payment}-*-modal.tsx` | AA | **(a)** | Take overhaul (token codemod only; main = #91 snapshot) |
| `books/segments/sync-segment.tsx` | AA | **(a)** | Take overhaul. The big diff (+224/−306) is the **one-CONNECT redesign** replacing the old side-by-side QB+Sage cards (the documented anti-pattern). **No QBO hardening lives here** — #95/#88/#87 touch only services/routes/migrations, which auto-merge clean. |
| `tests/unit/components/books-sync-segment.test.tsx` | AA | **(a)** | Take overhaul (main's test asserts the removed UI and would fail) |
| `i18n/dictionaries/{en,es}/books.json` | AA | **(a)** | Take overhaul (overhaul is a superset of main's `sync.*` keys) |

### Shell / layouts (5 UU) + deletions (4 DU)
| File | Type | Class | Resolution |
|---|---|---|---|
| `layouts/sidebar.tsx`, `layouts/operator-menu.tsx`, `layouts/notifications-row.tsx`, `layouts/notifications-drawer.tsx` | UU | **(a)** | Take overhaul (P5 no-card redesign + radius codemod; main = older P2 copy) |
| `layouts/top-bar.tsx` | UU | **(a)** | Take overhaul. +162/−94 = P5 relocation of the **notifications bell** into the top bar + `titleReady` cold-load guard + calmer sync dot. Main has nothing unique. |
| `layouts/notifications-tab.tsx` | DU | **(a) keep-deleted** | Replaced by top-bar bell + kept `notifications-drawer.tsx`. Main only re-tinted the dead edge-tab. |
| `layouts/quick-actions-tab.tsx` | DU | **(a) keep-deleted** | Replaced by P5 `create-cluster.tsx`. Main only re-tinted. |
| `layouts/quick-actions-drawer.tsx` | DU | **(a) keep-deleted** | Replaced by `create-cluster.tsx`, which **already carries** main's only real addition (`openClientWindow` dispatch). |
| `inventory/snapshots-tab.tsx` | DU | **(a) keep-deleted** | Superseded by `catalog/snapshots-view.tsx` (`RegisterEmpty`). The old empty-state primitive it depended on no longer exists on the overhaul. |

### UI primitives (4 UU + 4 AA) — **all (a)**
| File | Type | Class | Resolution |
|---|---|---|---|
| `ui/button.tsx`, `ui/dialog.tsx`, `ui/search-input.tsx`, `ui/textarea.tsx` | UU | **(a)** | Take overhaul (radius/font token codemod) |
| `ui/filter-chip.tsx`, `ui/instrument-strip/instrument-strip.tsx`, `ui/tag.tsx` | AA | **(a)** | Take overhaul (radius codemod) |
| `ui/segment-control.tsx` | AA | **(a)** | Take overhaul (**superset**: adds a `disabled` prop with a11y/pointer-lock) |

### Pickers (2 UU) + Pipeline (1 UU) + Settings (1 UU)
| File | Type | Class | Resolution |
|---|---|---|---|
| `projects/.../cells/cell-team.tsx` | UU | **(c)** | **Adopt main's #97 EntityPicker**, re-run radius codemod (see §3) |
| `projects/.../cells/editable-cell-client.tsx` | UU | **(c)** | **Adopt main's #97 EntityPicker** (see §3) |
| `pipeline/_components/pipeline-focused-detail-window.tsx` | UU | **(d)** | **Take main.** Overhaul == merge-base; main's #98 refactor is required to compile against the auto-merged `pipeline-detail-panel.tsx` (now needs `canManage`, dropped `headerSlot`) |
| `settings/page.tsx` | UU | **(a)** | Take overhaul (P3-6 `SettingsShell` rebuild; main untouched == merge-base) |

### Dashboard widgets (9 UU) + Clients (4 AA) — **all (a)**
| File | Type | Class | Resolution |
|---|---|---|---|
| all 9 `dashboard/widgets/*-widget.tsx` | UU | **(a)** | Take overhaul (DS refactor: `WidgetTitle` extract + token swaps; **no bug-sweep fix** lives here — every widget's only main commit is the #91 snapshot). Requires the clean add `widgets/shared/widget-title.tsx`. |
| `clients/_components/clients-ar-banner.tsx`, `ops/clients/workspace/{edit-create/client-edit-create-body,viewing/contact-tab,viewing/money-tab}.tsx` | AA | **(a)** | Take overhaul (1–2 line radius codemod each) |

### Wiring + i18n + doc
| File | Type | Class | Resolution |
|---|---|---|---|
| `lib/navigation/route-registry.ts` | UU | **(c)** | Overhaul base + re-add `catalog-setup` entry; keep map/team absorptions (see §5) |
| `tests/unit/navigation/route-registry.test.ts` | UU | **(c)** | Union both contracts (map/team-unregistered + catalog-setup/catalog any-of) |
| `src/middleware.ts` | UU | **(a)** | Take overhaul — **confirmed strict superset** (both hunks are HEAD-only adds; main side empty) |
| `lib/feature-flags/feature-flag-definitions.ts` | UU | **(c-sm)** | Comment-only; align comment to chosen namespace |
| `lib/constants/fab-actions.ts` | UU | **(c)** | Keep overhaul's new `hotkey` field; set `inventory-item` perm per namespace verdict |
| `i18n/dictionaries/{en,es}/navigation.json` | UU | **(d)** | Keep main's `nav.catalogSetup` key (wizard route title) |
| `i18n/dictionaries/es/quick-actions.json` | UU | **(a)** | Take overhaul (HEAD-only Create-cluster keys) |
| `i18n/dictionaries/{en,es}/pipeline.json` | UU | **(d)** | Keep main's #98 `band.*`/`overview.*`/`detail.scope*` block (overhaul side empty) |
| `docs/specs/2026-06-11-web-overhaul-master-plan.md` | AA | **(a)** | Take overhaul (28 commits vs main's 1; superset doc) |
| `lib/types/permissions.ts` | *auto-merged (no marker)* | **(c)** | Auto-landed on main's `catalogModule` — **correct per DB**, but a trap if the catalog code isn't converted in lockstep (§3) |

**Tally:** ~52 **(a)** · 0 pure **(b)** · ~12 **(c)** · 6 **(d)** (in-conflict) — plus the large clean-merged **(d)** feature trees (§4).

---

## 3. The (c) NEEDS-DECISION list — calls for Jackson, each with a recommendation

Most "(c)" items are careful *hand-merges* with a clear technical answer. Only **one** is a genuine product/taste call. They are ordered by how much judgment they actually require.

1. **EntityPicker #97 — team-cell assignment granularity. ← the one genuine taste call.**
   Main's #97 replaced the bespoke client/team cells with a standardized `EntityPicker` (portaled focus/dismiss, search, avatars, RLS-42501 read-only mode, schedule-conflict advisories). The overhaul *never designed a picker* — it inherited the old hand-rolled cells and only ran the radius codemod over them. Main's is better on every structural axis. **The single delta:** the overhaul's old team cell does *granular per-task* assignment (pick member → pick specific tasks); #97 assigns to all active tasks at once.
   **Recommendation:** Adopt #97 for both cells. Port per-task granularity onto EntityPicker (it supports multi-select + footer actions) **only if Jackson confirms granular assignment is a real requirement.** Default to #97's behavior.

2. **Catalog wizard stays reachable?**
   Re-grafting #91's two entry points onto the overhaul's catalog (§5) is real work. It is only worth it if the wizard is meant to ship.
   **Recommendation:** Yes — keep it. It is a recent, fully-built, tested, actively-maintained initiative with live prod migrations and grants (`catalog.run_setup` has 3 prod grant rows). Re-graft both entry points.

3. **Permission namespace — `catalog.*` vs `inventory.*`/`products.*`.** *(Resolved by data; listed for awareness, not a free choice.)*
   Prod `role_permissions` carries the **complete `catalog.*` set** (`catalog.view` ×5, `catalog.products.view` ×4, `catalog.manage`, `catalog.import`, `catalog.run_setup`, `catalog.stock.adjust`, `catalog.orders.*`). The overhaul's `inventory.view` and `inventory.import` have **0 grant rows in prod**. Therefore the merged code **must standardize on `catalog.*`** or crew/PM roles silently lose catalog access.
   **Recommendation:** Standardize on `catalog.*` (= main's #96). Keep the auto-merged `permissions.ts` (`catalogModule`). Run the bounded codemod over the 7 overhaul catalog files (§4). *The only thing for Jackson to confirm is the business intent that catalog access should follow the `catalog.*` grants already in prod — the technical answer is fixed.*

4. **Wiring hand-merges (route-registry, route-registry.test, fab-actions, feature-flags).** No taste call — mechanical once #1–#3 are set. See §5/§6.

---

## 4. Must-keep `main` fixes (d) — cannot be lost

All of these **auto-merge clean** (they are not in the conflict set) *except where noted* — but the reconciliation must verify they land and, for the wizard, must actively re-attach it.

- **CRIT-3 / auth Firebase-safe fixes — #88 `e7b8abc7`, #87 `7ded99b2`.** RLS actor resolution on 6 policies + `create_progress_invoice` caller. **Verified auto-merge clean** (services + SQL migrations + tests; none conflicted). Load-bearing for iOS + web estimate acceptance.
- **QBO sandbox CRUD hardening — #95 `98a84de4`.** `quickbooks-{import,write,webhook-apply}-service.ts`, sync-mode/enabled routes, child-echo-suppression migration. **Verified auto-merge clean.** *Not* in `books/sync-segment.tsx` (that's UI).
- **CI-green-on-main — #89 `506b6585`.** Lint/test fixes. Auto-merge clean; re-run the gate post-merge anyway.
- **Catalog Setup Wizard tree — #91 (the non-snapshot parts).** `app/(dashboard)/catalog/setup/page.tsx`, `components/catalog/setup/**`, `lib/catalog-setup/**`, `app/api/catalog/setup/{agent,commit,import/quickbooks}/**`, the `catalog-setup.json` dicts, wizard hooks/store/tests (~50+ files). **Land as clean adds, but are functionally orphaned until §5's re-graft.** Plus `nav.catalogSetup` (en+es, in-conflict (d)) and the `catalog-setup` route entry.
- **Lead-detail window — #98 `babf0d9f`.** `lead-field-editors.tsx`, `lead-map-band.tsx`, `pipeline-detail-overview-tab.tsx`, `use-opportunity-field-edit.ts` (clean adds) + `pipeline-focused-detail-window.tsx` (in-conflict (d), take main) + en/es `pipeline.json` blocks (in-conflict (d)).
- **EntityPicker system — #97 `195cee3a`.** `ui/entity-picker.tsx` + `ui/picker/picker.tsx` (clean adds) + the 2 cells (in-conflict (c), take main).
- **App Store Connect analytics — #99 `699125c6`.** Confirmed **pure-additive** (did not touch route-registry or middleware). Auto-merge clean.
- **Catalog `catalog.*` permission alignment — #96 `0bdce012`.** `permissions.ts` (`catalogModule`) is the DB-correct registry; keep it, and converge the overhaul's catalog code onto it.

---

## 5. The catalog-wizard interaction verdict (highest-risk seam)

**Verdict: the overhaul's newer catalog does NOT break the wizard's internals — but adopting it wholesale silently *orphans* the wizard. Re-graft is mandatory; it is bounded and mechanical.**

- **The wizard is self-contained.** Every wizard file was grepped for imports of the conflicted catalog components (`catalog-page`, `product-editor`, `cells`, `segments/*`, `stock-drawer`, `supply-strip`, `snapshots-view`, `catalog-kebab`, `modals/*`) → **zero hits.** It draws only on `lib/catalog-setup/*`, its own store/hooks, and shared infra that exists on the overhaul (`permissions-store`, `auth-store`, `motion.ts`, `productMargin`). The overhaul's catalog changes cannot break the setup route.
- **The danger is two deleted mount points.** Main wired the wizard in via (1) a **first-run takeover** in `catalog-page.tsx` (a 0/0 catalog renders `<CatalogSetupLauncher>` instead of empty tables) and (2) a persistent **"Set up catalog" kebab item** in `catalog-kebab.tsx`. The overhaul predates both, so taking its versions deletes both — the wizard survives as URL-only dead code.

**Exact re-graft (onto the overhaul's versions):**
1. `catalog-page.tsx` — re-add imports `useCatalogSetupStatus` + `CatalogSetupLauncher`; re-add `const { data: setupStatus } = useCatalogSetupStatus()` and `const [setupDismissed, setSetupDismissed] = useState(false)` (overhaul already imports `useState`); re-add the `showFirstRun` early-return block immediately before the existing `return (` (right after the `segmentCounts` memo). Restore a settled-empty signal (re-add `productsLoading` from `useProducts`, or gate on lengths). Gate stays `can("catalog.run_setup")`.
2. `catalog-kebab.tsx` — re-add `const canSetup = can("catalog.run_setup")` and the `{canSetup && (…DropdownMenuItem → router.push("/catalog/setup")…)}` block + separator at the top of the menu.
3. `route-registry.ts` — re-add the `catalog-setup` entry (`href:"/catalog/setup"`, `labelKey:"nav.catalogSetup"`, `permission:"catalog.run_setup"`, `nav:false`, `fullHeight:"bleed"`). **Required** or the route renders ungated/title-less.
4. i18n — re-add `kebab.setup` ("Set up catalog" / "Configurar catálogo") to en+es `catalog.json`; keep main's `nav.catalogSetup` in en+es `navigation.json`.
5. **Permissions** — keep all wizard/catalog gates on `catalog.*` (DB-backed). The launcher self-gates on `can("catalog.run_setup")`.

---

## 6. Recommended reconciliation strategy + merge order

Do this in a **dedicated worktree off `feat/web-overhaul`** (never the shared primary checkout). Resolve in dependency order so the wiring decisions are settled before the catalog seam.

1. **Branch & merge.** `git worktree add` a fresh dir at `feat/web-overhaul`; `git merge origin/main` (produces the 70 conflicts).
2. **Bulk-adopt the (a) set (~52 files).** Take the overhaul side: for each (a) file `git checkout bb6488f6 -- <file>` (≡ `--ours`, since HEAD = overhaul). Include the clean add `widgets/shared/widget-title.tsx`.
3. **Confirm the 4 DU deletions.** `git rm` `notifications-tab.tsx`, `quick-actions-tab.tsx`, `quick-actions-drawer.tsx`, `inventory/snapshots-tab.tsx`. Replacements verified mounted (top-bar bell, `create-cluster.tsx`, `catalog/snapshots-view.tsx`).
4. **Take the (d) main files.** `git checkout origin/main -- pipeline-focused-detail-window.tsx`. Hand-merge the 4 i18n must-keep blocks (en/es `pipeline.json`, en/es `navigation.json`) — keep main's additive block, keep overhaul's surrounding keys.
5. **Adopt #97 EntityPicker.** Take main's `cell-team.tsx` + `editable-cell-client.tsx`; re-run the radius codemod (`rounded-[5px]`→`rounded`). (Pending Jackson's granularity call in §3.1.)
6. **Hand-merge wiring.** `middleware.ts` → take overhaul (superset). `route-registry.ts` → overhaul base + re-add `catalog-setup` + keep map/team absorptions; mirror in `route-registry.test.ts` (union both contracts). `fab-actions.ts` → keep overhaul's `hotkey` field, set catalog perms to `catalog.*`. `feature-flag-definitions.ts` → align the comment.
7. **Permission namespace codemod.** In the 7 overhaul catalog files (`catalog-page`, `catalog-kebab`, `product-editor`, `products-segment`, `stock-segment`, `snapshots-view`, `inventory/items-tab`) map `can()` keys: `inventory.view→catalog.view`, `inventory.manage→catalog.manage`, `inventory.import→catalog.import`, `products.view→catalog.products.view`, `products.manage→catalog.products.manage`. Keep `permissions.ts` as the auto-merged `catalogModule`.
8. **Catalog-wizard re-graft.** Apply §5 steps 1–4 onto the catalog files taken in step 2.
9. **Verify the clean-merge must-keeps landed** (#87/#88/#95/#89/#96/#98/#99) — spot-check the QBO services, CRIT-3 migrations, EntityPicker/lead-detail/app-store adds.
10. **Build gate + targeted walkthrough.** `tsc --noEmit`, `next lint`, `vitest`. Then walk: (a) catalog first-run wizard as an owner **and** crew role (proves the re-graft + permission codemod); (b) catalog products/stock CRUD as crew; (c) pipeline lead-detail window; (d) books QBO sync (one-CONNECT); (e) shell create-cluster + top-bar notifications.
11. **Then Jackson re-authorizes the push.** (Per the standing rule, merging/pushing `main` now auto-deploys prod.)

---

## 7. Effort estimate

**One focused session: ≈ half-day to one day**, at OPS velocity. Cost is in the seams and verification, not the conflict count.

| Phase | Effort |
|---|---|
| Bulk-adopt 52 (a) files + 4 DU deletions (scripted) | ~15–30 min |
| Take (d) main files + 4 i18n must-keep blocks | ~30 min |
| EntityPicker adoption (2 cells + codemod) | ~30 min |
| Wiring hand-merge (route-registry + test + fab-actions + middleware + flags) | ~1–1.5 h |
| Permission namespace codemod (7 files, verify vs DB grants) | ~1 h |
| Catalog-wizard re-graft (2 entry points + route entry + i18n) | ~1–2 h |
| Build gate (tsc/lint/vitest) + targeted role-aware walkthrough | ~1–2 h |

**Risk-adjusted:** budget a full day. The two silent-failure seams (wizard orphaning, permission denial) demand the role-aware walkthrough in step 10 — an admin-only smoke test will *not* catch them. Conflict *volume* is not the constraint; the two seams are.

---

### Appendix — provenance one-liners
- `bfe64259` (#91) is a **squash** (single parent `aad8d8f3`) carrying an older overhaul snapshot → explains why books/shell/catalog/widgets conflict yet diff to a handful of lines.
- `src/components/catalog/` and `src/app/(dashboard)/catalog/` were **empty at the merge-base** → catalog is a parallel net-new build on both sides (main's via #91, overhaul's via P3.2/P4-2).
- `320e8849` (P2-shell merge on main) is **not** an ancestor of the overhaul tip — the overhaul advanced past it independently.
- Prod `role_permissions` (verified): `catalog.*` set fully present; `inventory.view`/`inventory.import` **absent** (0 grants).
