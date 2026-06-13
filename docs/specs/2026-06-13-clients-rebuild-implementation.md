# Clients Rebuild — Implementation Spec (WEB OVERHAUL P3.3)

Canonical build spec. Companion to `2026-06-12-clients-capability-inventory.md` (parity + architecture) and the Direction-B mockup (`docs/design/2026-06-12-clients-mockups/direction-b-lean-tabbed.html`).

## Decisions (Jackson, 2026-06-12/13)

1. **Direction B** — lean list (slim A/R banner, no glance strip) + a **tabbed** floating client workspace window (CONTACT / PROJECTS / MONEY / ACTIVITY).
2. **List table foundation = `RegisterTable`** (`@/components/ui/register-table`) — the shared read-only register Books/Catalog just shipped, which is itself the *extracted presentational layer of table-v2* (per its own header / the P3-5 decision). This satisfies "use/adapt the table-v2 definition" without forking the heavy grid or adding DB work. Rows click → open the client workspace window. No saved views / density / inline-edit / bulk (the window owns editing).
3. **Descopes approved (implied by 1+2):** D1 one canonical table (no card/table toggle; sub-contact peek lives in the window, not a row expand); D2 create folds into the window's `creating` mode (`/clients/new` → redirect).
4. **Window reuses the project-workspace shell directly** (`ProjectWorkspaceWindow` is entity-agnostic). Clone only the container + viewing/edit bodies. Tabs use the body-internal `ViewingTabs` pattern (not the shell-slot tabs).
5. **Full UI/UX skill stack applied:** animation-architect (gateway) → reuse EASE_SMOOTH motion; frontend-design + interface-design (intent-first, borders-only depth, no defaults); ops-copywriter (all strings); ui-ux-pro-max (a11y/states — minus touch-targets, web is not a touch surface); `audit-design-system` as the done-gate.

## Design intent (interface-design mandate — every choice justified)

- **Human:** a trades business owner, mid-day, between jobs. Three jobs-to-be-done on this surface: **reach a client**, **chase what they owe**, **see their jobs**. Everything else is secondary.
- **Palette:** pure-black canvas; glass surfaces + hairlines (borders-only depth — DESIGN.md "zero shadows on dark"; the floating window shell shadow is the one sanctioned exception). Text ladder `#EDEDED/B5B5B5/8A8A8A/6A6A6A`. **Rose `#B58289` = money at risk** (outstanding/overdue) — the owner's pain, so it's the one earth tone that leads. **Olive `#9DB582` = settled/paid.** **Accent `#6F94B0` ONLY** on the single `+ NEW CLIENT` CTA + focus rings. Nowhere else (not rows, chips, tabs, links, tags).
- **Type:** Cake Mono Light uppercase = authority (page title, section `// HEADERS`, buttons, tabs). Mohave = content (names, notes, addresses). JetBrains Mono tabular slashed-zero = every number (outstanding, counts, dates, balances). 11px floor.
- **Signature:** the slim **A/R banner** — "{n} clients owe {amount} — oldest {d}d" — owns the top as the one actionable number that drives the chase flow; rose tone carries the semantics; clicking it filters the table to OWES. The OUTSTANDING column tone-codes per row (rose if owed, muted `—` if clear).
- **Motion:** window open = Entry beat (confident, no bounce); mode/tab swaps = Transition (EASE_SMOOTH `cubic-bezier(0.22,1,0.36,1)` crossfade; reduced-motion = opacity-only). All inherited from the reused shell + a cloned `ClientViewingTabs` with its own `layoutId`.
- **Empty `—` not N/A. No center-aligned numerics (right-align). Left alignment throughout.**

## Data layer (no DB migrations)

Reuse: `useClients`, `useClient`, `useSubClients`, `useCreate/Update/DeleteClient`, `useCreate/DeleteSubClient`, `useClientProjects`, `useClientOpportunities(+Won)`, `useInvoices({clientId})`, `useClientMetrics`, `useScopedProjects`.

New (all client-side aggregates over existing services; query keys added to `queryKeys.clients`):
- `useClientOutstandingMap()` → `Map<clientId,{outstanding:number; openCount:number; oldestDays:number|null}>` + company totals (banner). One `invoices` query: `select client_id,balance_due,status,due_date,deleted_at` (RLS auto-scopes company), reduce client-side; exclude `paid|void|draft|written_off` and `deleted_at`. Join on `client_id` (NOT `client_ref` — 100% null in prod).
- `useClientFinancials(clientId)` → invoiced/paid/outstanding/overdueCount/overdueBalance for the MONEY tab summary (derived from `useInvoices({clientId})`, gated on `invoices.view`).
- `useClientActivity(clientId)` → unified, sorted timeline composed from `useClientProjects` (created/status), `useInvoices({clientId})` (sent/paid/past-due), `useClientOpportunitiesWon` (won). Real composition, not a stub.

## File manifest

### Foundations (contracts — build first)
- `src/stores/window-store.ts` — add `"client-workspace"` type; `ClientWorkspaceMode`; `ClientWorkspaceWindowMeta {clientId:string|null; initialMode}`; widen `FloatingWindowState.meta` + `updateWindowMeta` to the union; `clientCreatedCallbacks` map + `consumeClientCreatedCallback`; `deriveClientWindowId`; `SIZE_BY_TYPE["client-workspace"] = {width:880,height:620}` (≥ shell min 780×600); `openClientWindow({clientId,mode,onClientCreated?})`; delete callback in `closeWindow`.
- `src/lib/api/query-client.ts` — extend `queryKeys.clients` with `projects/opportunities/tasks/financials/activity/outstanding(companyId)`.
- `src/lib/api/services/client-service.ts` — `fetchClientOutstanding(companyId)` (single invoices query → rows for client-side reduce).
- `src/lib/hooks/use-clients.ts` (or a new `use-client-financials.ts`) — `useClientOutstandingMap`, `useClientFinancials`, `useClientActivity`.
- `src/i18n/dictionaries/{en,es}/clients.json` — extend (banner, columns, owes filter, window tabs/sections/actions, money, activity, footer, confirm, notifications).

### List
- `src/app/(dashboard)/clients/page.tsx` — rebuild: A/R banner → workbar (`SearchInput` + one accent `+ NEW CLIENT`) → filter chips (ALL/WITH PROJECTS/OWES/NEW) + count → `RegisterTable`. Preserve the scope-aware `clients.view` gate verbatim. Row click → `openClientWindow`. Loading (6× `glass-surface h-[48px]`) / empty / filtered-empty per Books family. `trackScreenView("clients")`.
- `src/app/(dashboard)/clients/_components/clients-ar-banner.tsx`, `clients-table.tsx` (RegisterTable column config), `clients-filter-bar.tsx` (chips+search+CTA) — if cleanly separable; else inline.

### Window
- `src/components/ops/clients/workspace/client-workspace-container.tsx` — mirror `ProjectWorkspaceContainer`; reads `{clientId,mode}`; `useClient`; derives chrome (statusLabel = balance tag rose / `—` neutral); footer per mode (viewing→EDIT; editing→SAVE+DISCARD+CANCEL+DELETE gated `clients.delete`; creating→CREATE+CANCEL); created→viewing meta swap.
- `src/components/ops/clients/workspace/viewing/client-viewing-body.tsx` — owns active tab; renders `ClientViewingTabs` + tab bodies.
- `.../viewing/client-viewing-tabs.tsx` — clone of project-viewing-tabs; `ClientViewingTabId = "contact"|"projects"|"money"|"activity"`; **unique `layoutId="client-viewing-tabs-underline"`**.
- `.../viewing/contact-tab.tsx` (contact rows + sub-contacts + notes), `projects-tab.tsx` (active+done; row→`openProjectWindow`), `money-tab.tsx` (summary + invoice list; gated `invoices.view`), `activity-tab.tsx` (timeline).
- `.../edit-create/client-edit-create-body.tsx` — RHF+zod form (name*/company?/email/phone auto-format/address+use-my-location/notes) + sub-contacts add/delete; `form={formId}` submit; mirrors create/edit modal logic.

### Wiring (shared files — sequential, careful)
- `src/components/layouts/dashboard-layout.tsx` — dispatch `client-workspace` → `<ClientWorkspaceContainer>`; exclude it from `legacyWindows`; add `<ClientWorkspaceDeepLinkHandler>` (`?openClient=&mode=`); remove `<ClientDetailPopover>` mount (after caller retarget).
- `src/lib/constants/fab-actions.ts` — client action `target:"client-workspace"`, `meta:{initialMode:"creating"}`.
- `src/components/layouts/quick-actions-drawer.tsx` — `handleAction` branch for `client-workspace` → `openClientWindow({clientId:null, mode})`.
- Caller retargets → `openClientWindow`: `src/components/dashboard/widgets/shared/use-widget-entity-open.ts` (sole popover caller), `command-palette.tsx`, `pipeline/page.tsx` (EmailReviewPanel `onViewClient`), `inbox/inbox-route.tsx` (`onOpenClient`), `clients/new/page.tsx` post-create. **Leave alone:** `editable-cell-client.tsx` (reassign editor), pipeline `cell-assignee` (member), creation paths (`keyboard-shortcuts`, command-palette "New Client", widget "+").
- **Flag for P4 (not retarget):** `action-card.tsx:141` notification `action_url` string (needs `?openClient=` — now satisfied by the new deep-link handler, so set it to `/dashboard?openClient={id}`); pipeline `cell-relation` client column (inert text — P4 adds an open affordance).

### Retirements (after parity verified live)
- `client-detail-popover.tsx` + `client-detail-popover-store.ts` + mount — DELETE (sole caller retargeted).
- `clients/[id]/page.tsx` → thin `redirect('/dashboard?openClient={id}')` fallback (param-preserving).
- `clients/new/page.tsx` → redirect to `/dashboard?openClient=new` (D2).
- `create-client-modal.tsx` `CreateClientForm` — keep (reused by the window editing/creating body or as its basis) OR supersede with the new edit-create body; remove the legacy `create-client` window branch in dashboard-layout once FAB is retargeted.

## Verification
- Live on port 3017 (`preview_start("overhaul-shell")`, dev bypass = pete/Maverick owner). Warm routes with curl (307=compiled). Verify: list renders + A/R banner + chips + search + scope gate; row→window; viewing tabs; editing+creating; `/clients/[id]` redirect; `/clients/new` redirect; `?openClient=` deep-link; FAB create.
- `audit-design-system` done-gate; adversarial review workflow.
- en+es i18n parity (no missing keys); `next lint` clean on touched files (CI lint gates tests — verify locally, red PR ≠ your change).

## Notifications
Client create/update/delete dispatch to the rail with `action_url:/dashboard?openClient={id}` (now a live deep-link).
