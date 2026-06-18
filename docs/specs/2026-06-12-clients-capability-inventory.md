# Clients — Capability Inventory + Rebuild Architecture (WEB OVERHAUL P3.3)

**Verdict (master plan §4):** *Rebuild from scratch — adopt the floating-window interaction model.* §2 row 7: `/clients` rebuilt; click a client → client workspace window; `/clients/[id]` becomes a thin fallback. **Any control that still navigates to a dedicated detail page is a bug** (P4 sweeps for these).

**Sources read top-to-bottom:** old `(dashboard)/clients/{page,[id]/page,new/page}.tsx` (570 + 873 + 296), `create-client-modal.tsx`, `edit-client-modal.tsx`, `client-detail-popover.tsx` (+ store), the project-workspace system (`ProjectWorkspaceWindow` shell, `ProjectWorkspaceContainer`, `window-store`, the `FloatingWindows` mount + `?openProject=` deep-link handler), `client-service.ts`, the `Client`/`SubClient` types (`models.ts:409`), and the client-context hooks. Bible 03 §4–5 (Client/SubClient model).

---

## 0. Architecture decision — reuse the project workspace shell

`ProjectWorkspaceWindow` (`src/components/ops/projects/workspace/shell/project-workspace-window.tsx`) is a **generic, entity-agnostic window shell**: drag / resize / localStorage-persist / title-bar / mode-tabs / mode-footer / 8 resize handles, all driven by plain label props (`title`, `crumbLabel`, `projectIdLabel`, `statusLabel`, `tabs`, `footerConfig`, `rightRail`, `children`). Nothing is project-coupled. **The Clients window reuses this shell directly** — no shell rebuild.

Mirror the mediator: `ClientWorkspaceContainer` (new) ↔ `ProjectWorkspaceContainer` — reads window meta `{ clientId, mode }`, fetches the client, derives chrome, composes the shell with a viewing / editing / creating body + a right rail.

**Integration points:**
- `window-store.ts` — add `"client-workspace"` to `FloatingWindowType`, a `ClientWorkspaceWindowMeta { clientId: string | null; initialMode }`, an `openClientWindow({ clientId, mode, onClientCreated? })` (mirror `openProjectWindow`), a `client-workspace` entry in `SIZE_BY_TYPE` (≈ 1000×720), and a `client-workspace:{id}` id derivation + created-callback registry.
- `dashboard-layout.tsx` `FloatingWindows` — dispatch `w.type === "client-workspace"` → `<ClientWorkspaceContainer windowId={win.id} />`; add a `?openClient={id}&mode=` deep-link handler beside the project one.
- `/clients/[id]/page.tsx` → thin fallback: redirect to `/dashboard?openClient={id}` (param-preserving), matching how `/projects/[id]` is a thin deep-link fallback.

---

## 1. LIST page (`/clients`) — parity

| # | Capability | Notes |
|---|-----------|-------|
| L1 | Metrics header: total clients · total projects · total sub-clients | `useClientMetrics` |
| L2 | Card view + table view toggle | rebuild to the Books/Catalog sibling aesthetic (one canonical table; card view re-justified or dropped — see D1) |
| L3 | Search across name / company / email / phone / address / sub-client names | client-side |
| L4 | Filter modes: ALL · WITH PROJECTS · NEW (created ≤30d) | |
| L5 | Per-row: avatar (mono initials), name, company, email, phone, address, project count, sub-client count badge | |
| L6 | Sub-client inline expand (name/title/phone/email) | card view today |
| L7 | **Row click → client workspace WINDOW** (was `router.push('/clients/{id}')` — the P4 violation, lines 509/545) | the rebuild's headline fix |
| L8 | + NEW CLIENT → opens the window in `creating` mode (was FAB `create-client` legacy window + `/clients/new` page) | unify on the workspace window |
| L9 | Scope-aware gate: `clients.view` scope `"all"` → all; otherwise restrict to clients on the user's accessible projects (`page.tsx:358-375`) | preserve exactly |
| L10 | Loading / empty / filtered-empty states | |
| L11 | Analytics: `trackScreenView("clients")` | |

## 2. CLIENT WORKSPACE WINDOW — viewing body (dossier; superset of old detail page + popover tabs)

| # | Section | Data source | Notes |
|---|---------|-------------|-------|
| V1 | Header chrome: avatar, name, "client since", project count → title-bar crumb + status chip | `useClient` | shell title bar |
| V2 | **Contact** — email (copy + mailto), phone (copy + tel), address (copy + maps) | `clients` row | |
| V3 | **Notes** | `clients.notes` | |
| V4 | **Sub-contacts** — list (avatar/name/title/phone/email), add, delete | `sub_clients` via `useSubClients` / `useCreateSubClient` / `useDeleteSubClient` | contact-cascade (bible §ClientContactCascading) |
| V5 | **Projects** — active + completed, status dot + title + crew + start; click → project window | `useClientProjects` | project click opens the PROJECT workspace window (not nav) |
| V6 | **Financial** — invoiced / paid / outstanding + invoice list (new tab the old page lacked; from the popover) | `useInvoices({clientId})` | |
| V7 | **Opportunities** — open + won | `useClientOpportunities` / `…Won` | |
| V8 | **Tasks** — open tasks across the client's projects | `useClientTasks` | |
| V9 | **Activity / comms** — email threads, files (photos + documents + attachments) | `useClientThreads`, `useClientFiles` | progressive — may land as a focused tab |
| V10 | Right rail (viewing): balance summary + recent projects + quick contact actions | mirrors `ProjectSidebar` | |

## 3. CLIENT WORKSPACE WINDOW — editing / creating body (form)

| # | Field / behavior | Notes |
|---|------------------|-------|
| E1 | name* (≤200), company, email, phone (auto-format `(555) 123-4567`), address (Mapbox autocomplete + geolocation pick), notes | Zod-validated, mirrors old create/edit |
| E2 | Create writes `clients` (company-scoped); edit updates; both optimistic | `useCreateClient` / `useUpdateClient` |
| E3 | Delete / archive (footer destructive, gated `clients.delete`) — confirm modal; soft-delete cascades sub-clients | reuse `ConfirmModal` |
| E4 | Mode footer: viewing → EDIT primary; editing → SAVE + DISCARD + DELETE; creating → CREATE + CANCEL | mirror `ProjectWorkspaceContainer` footer config |
| E5 | Created → viewing transition swaps window meta (`client-workspace:new` → real id) | mirror `handleSaved` |

## 4. Cross-surface obligations

| # | Item |
|---|------|
| R1 | `window-store` `openClientWindow` + `client-workspace` type + size + deep-link |
| R2 | `dashboard-layout` dispatch + `?openClient=` handler |
| R3 | `/clients/[id]` thin fallback → `/dashboard?openClient={id}` |
| R4 | FAB `create-client` action retargets to `openClientWindow({ mode: "creating" })` (was the legacy `create-client` window) |
| R5 | Projects table-v2 client cell (`editable-cell-client.tsx`) + any client-row click app-wide → `openClientWindow` (P4 rule). Cross-wave table cells that can't be cleanly swapped get flagged for P4. |
| R6 | i18n: extend the existing `clients` namespace (en + es) for all new window strings |
| R7 | Permissions: `clients.view` (scoped) / `clients.edit` / `clients.delete` via `has_permission` — never roles |
| R8 | Notifications: client create/update/delete dispatch to the rail with `action_url: /dashboard?openClient={id}` |

## 5. Retirements (after parity confirmed live)

- `(dashboard)/clients/page.tsx` (rebuilt), `(dashboard)/clients/new/page.tsx` (folded into the window's creating mode), `(dashboard)/clients/[id]/page.tsx` → thin fallback.
- `client-detail-popover.tsx` + `client-detail-popover-store.ts`: **retire only if every caller is retargeted** to `openClientWindow`. Current callers: projects table-v2 client cell (retarget in this wave) + verify the pipeline cells actually peek *clients* vs *members* (the assignee cell likely uses a member popover — leave non-client popovers alone). Any client-peek that must stay lightweight in a dense table is a documented exception flagged for P4, not a silent fork.

## 6. Descopes (require Jackson sign-off)

| # | Item | Rationale |
|---|------|-----------|
| D1 | Card view as a co-equal list mode | The Books/Catalog sibling is one canonical table; a card grid is a second presentation of the same rows. Proposed: drop the card/table toggle, ship one tactical table (client + contact + projects + balance), matching the surface family. Sub-client expand survives as a row affordance. (If you want cards kept, say so.) |
| D2 | `/clients/new` as a standalone page | Creating now lives in the workspace window (`creating` mode), consistent with Projects. The route 308-redirects to `/dashboard?openClient=new` or is removed. |

Everything else: 100% parity, plus the upgrade the old page lacked — the financial/opportunities/tasks/activity tabs and the unified floating-window model.
