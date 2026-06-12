# WEB OVERHAUL P2 — Shell Rebuild Design

**Status:** BUILT — approved 2026-06-11 (all §6 recommendations), implemented on this branch, verified in the running app. See §8 for build addenda.
**Parent spec:** `docs/specs/2026-06-11-web-overhaul-master-plan.md` §5
**Branch:** `feat/web-overhaul-p2-shell` (worktree off main `46fde6c5`)
**Session:** WEB OVERHAUL - P2-1

---

## 1. Feature-parity inventory (read top-to-bottom, 2026-06-11)

Per master plan §4, every capability of the current shell. **K** = keep (redesigned), **C** = cut (with reason), **M** = move.

### sidebar.tsx (456 lines)

| Capability | Verdict |
|---|---|
| 16-item nav built from `buildNavItems(t)`, i18n labels | K — replaced by shared route registry |
| Dividers between groups | K — registry `group` field renders hairlines |
| RBAC hide: `can(permission)` false → item hidden | K |
| Flag gate: `isPermissionUnlocked` false → item dimmed ("In development"), opens `FeatureAccessModal`, "Access requested" state via `useFeatureAccessRequests` + `getSlugForPermission` | K — same flow, tooltips i18n'd (currently hardcoded English) |
| Inbox unread badge (`useInboxUnreadCount`) | **C** — Inbox removed from nav (§3 master plan); hook no longer imported by shell |
| Agent Queue pending badge (`useApprovalQueuePendingCount`) | K — renders only under `phase_c` flag |
| Agent Queue `permission: "admin"` | **C** — dead check ("admin" is a category id, not a permission; `can("admin")` is false for everyone — the item is invisible today). Replaced by `flag: "phase_c"` visibility |
| Hover-expand 72→256px overlay, mouseenter/leave | K — refined (intent delay, see §4.1) |
| Mobile drawer <768px + backdrop + aria-hidden | K |
| Company header: logo (`logoURL`) or `Building2` fallback + name | K |
| OPS mark + `VERSION 02/16/2026` (hardcoded, stale) | K — wired to `package.json` version, not a hand-edited date |
| Avatar + name button → dropdown (Settings / OPS Website / Courses / Download iOS App `#` / Sign Out) | K — full redesign (§4.3); dead `#` link resolved |
| Sign out via `useSignOutStore.begin(first, last)` | K |
| Active route: `pathname.startsWith(href)`, dashboard exact | K — registry `isActive`, longest-prefix |
| 2px text-2 active bar, no accent on nav | K — spec-conform already |
| z-index 45 (old scale) | M — nav band 500 per CLAUDE.md scale |

### top-bar.tsx (291 lines)

| Capability | Verdict |
|---|---|
| `routeTitles` hardcoded English map | **C** — root cause of Calendar/Schedule drift; replaced by registry + i18n |
| Title: exact match → first-segment fallback | K — registry longest-prefix |
| Breadcrumbs: `useBreadcrumbStore` (`entityName`, `parentCrumbs`), nested = parent / entity | K |
| Search button → synthetic ⌘K event → `CommandPalette` | K — same contract |
| `showShortcutHints` preference gates kbd chips | K |
| Undo: stack store, ⌘Z handler (input-guarded), spinner, hover tooltip `UNDO "{label}"` | K |
| Sync indicator: connectivity + `useIsFetching`/`useIsMutating` → synced/syncing/pending/offline, hover-reveal label | K |
| Mobile hamburger → `openMobile` | K |
| h-56, glass strip rendered by dashboard-layout | K |

### dashboard-layout.tsx (311 lines)

| Capability | Verdict |
|---|---|
| `FULL_HEIGHT_ROUTES` padded/bleed map | M — registry `fullHeight` field (one more parallel route table killed) |
| Onboarding gate (`useSetupGate` → redirects) | K |
| `UnassignedRoleBanner`, map background + filter rail, global providers, command palette, keyboard shortcuts, floating windows, deep-link handler, popovers, window dock, duplicate review sheet | K — untouched, re-mounted identically |
| Bottom gradient fade (non-full-height) | K |
| TopBar glass overlay `md:left-[72px]` z-10 | K — z 500 |

### Edge rail (notifications-tab/-drawer/-row, quick-actions-tab/-drawer, edge-tab.tsx, edge-rail-layout.ts, bug-report-tab)

| Capability | Verdict |
|---|---|
| Shared `EdgeTab`: accent stripe (severity), count badge, vertical wordmark, tooltip + shortcut chip, glyph rotation, outside-dismiss, Escape | K |
| **Hover-grow** (rest→hoverHeight) + **sibling-push** choreography + geometry registry | **C** — the "clunky" elasticity. Tabs hold fixed height; hover = brighten + tooltip only. Geometry registry/push code deleted |
| Tint glazes (rose/accent wash on urgent) | K |
| N / Q / ` shortcuts (input-guarded) | K |
| Notifications: tone buckets (critical/attn/ambient), filter chips with counts, expandable rows, action → route + dismiss, `duplicates_found` → sheet, persistent rows non-dismissible, dismiss-all, EOF marker, last-sync stamp | K — recomposed (§4.4) |
| Mute-all button (disabled, "coming soon") | **C** — dead control; returns when snooze ships |
| Row snooze button (disabled, "coming soon") | **C** — same |
| Footer VIEW ALL (resets filter to ALL) | **C** — misleading label for a filter reset; segmented filter is one tap away |
| Arrow-key row navigation, role=list semantics | K |
| Quick actions: permission+flag+preference filtering (`useQuickActions`), setup-gate interception modal, content-driven panel height, CUSTOMIZE → settings, hide rules (/intel, customize mode, wizard, duplicate sheet) | K |
| Bug report tab (`` ` `` shortcut, ambient accent) | K — restyled to unified rail anatomy only; drawer internals out of scope |
| Drawer widths 360 / 308 / 360 | M — unified 360 |
| Rest heights 180 / 132 / 100, stack offsets −124 / +34 / +166 | M — unified rhythm (§4.4) |

### fab-actions.ts + use-quick-actions.ts

| Capability | Verdict |
|---|---|
| 9 actions, window vs route handlers, permission filter, flag filter via `getSlugForRoute`, user order (`currentUser.fabActions`), `DEFAULT_ACTION_IDS` | K |
| Hardcoded English labels | **C** — labels become dictionary keys (`quick-actions.json` `action.*`), en + es |
| Targets: `/accounting?tab=expenses`, `/invoices?action=new`, `/inventory?action=new`, `/settings?tab=company` | K for P2 (routes exist; transition rule). Registry documents the P3 retarget map (`/books?…`, `/catalog?…`) so each P3 wave swaps in its landing commit |
| `triggerAction` names for setup-gate analytics | K |

### Dictionaries

`sidebar.json`: `expandSidebar`/`collapseSidebar` (⌘B toggle removed long ago), `accountSettings`, `signOut` orphans — cleaned. `nav.bugReports` missing in es — moot (key retired). New shared `navigation.json` (en+es) owns route labels; `breadcrumbs.json` route.* duplicates retire onto it.

---

## 2. Verified flag mechanics (read 2026-06-11, code not memory)

- Client: `useFeatureFlagsStore` ← `GET /api/feature-flags` = global `feature_flags` rows + per-user `feature_flag_overrides`. `canAccessFeature(slug)` = `enabled || hasOverride`. Fail-closed fallback.
- `phase_c` slug gates route `/calibration` + permission `email.configure_ai`. `portal` slug gates `/inbox`.
- Per-company `admin_feature_overrides` (`feature_key`: `phase_c`, `ai_auto_send`, generic e.g. `inbox_ui`) is **server-side only** (service-role; crons + agent endpoints). The generic `isFeatureEnabled` helper currently has **zero consumers**. No middleware inbox gating exists; route access control lives in `(dashboard)/layout.tsx` (`isRouteUnlocked` + `ROUTE_PERMISSIONS` → in-place 404).
- **P2 nav-visibility mechanism:** registry entries `calibration` + `agent-queue` carry `flag: "phase_c"` → rendered only when `canAccessFeature("phase_c")` (no dimmed/request state — invisible, per §2 master plan). Inbox loses its nav entry entirely; the `portal`-flagged route + 404 gate keep it reachable for Canpro.
- **Noted for Jackson (not done in P2 without go-ahead):** `/agent` has no entry in `FEATURE_FLAG_ROUTES`/DB `feature_flags.routes`, so `/agent/queue` is URL-reachable for anyone with `pipeline.view`. Making it flag-reachable-only needs a `feature_flags.routes` DB update (prod write) + static map sync.

---

## 3. Route registry — the single source of truth

`src/lib/navigation/route-registry.ts`. One typed table consumed by sidebar, top bar, mobile drawer, dashboard layout, and the auth gate. Kills four parallel tables (sidebar dict keys ad-hoc, top-bar hardcode, breadcrumbs route.*, layout `ROUTE_PERMISSIONS`) + `FULL_HEIGHT_ROUTES`.

```ts
interface RouteEntry {
  key: string;                  // "schedule"
  href: string;                 // "/schedule"
  icon: LucideIcon;             // CalendarDays
  labelKey: string;             // "nav.schedule" → navigation.json (en+es)
  nav: false | { order: number; group: "command" | "ops" };
  permission?: string;          // RBAC — hidden without it (sidebar) / 404 (gate)
  flag?: string;                // feature-flag slug — gated-dim (request-access) entries
  phaseCOnly?: boolean;         // visible ONLY when canAccessFeature("phase_c") — no dim state
  badge?: "agentQueuePending"; // data hook binding, declared not hardwired
  fullHeight?: "padded" | "bleed";
  absorbedBy?: { phase: string; target: string }; // P3 transition doc, e.g. {phase:"3.1", target:"/books?segment=estimates"}
}
```

**Ship-time nav (every route exists today — transition rule §6):**

| # | Label | Route | Notes |
|---|---|---|---|
| 1 | DASHBOARD | /dashboard | |
| 2 | PROJECTS | /projects | bleed |
| 3 | MAP | /map | bleed · transitional → P3.5 absorbs into Projects |
| 4 | SCHEDULE | /schedule | **rename rides P2**: dir move + /calendar 308 redirect (query-preserving) |
| 5 | PIPELINE | /pipeline | padded |
| 6 | ESTIMATES | /estimates | transitional → P3.1 Books |
| 7 | INVOICES | /invoices | transitional → P3.1 Books |
| 8 | ACCOUNTING | /accounting | transitional → P3.1 Books |
| 9 | PRODUCTS | /products | transitional → P3.2 Catalog |
| 10 | INVENTORY | /inventory | transitional → P3.2 Catalog |
| 11 | CLIENTS | /clients | |
| 12 | TEAM | /team | transitional → P3.4 Settings |
| — | CALIBRATION | /calibration | `phaseCOnly` — bottom group, invisible unless phase_c |
| — | AGENT QUEUE | /agent/queue | `phaseCOnly` + pending badge — bottom group |
| 13 | SETTINGS | /settings | bottom group |

Removed from nav: **Inbox** (shelved §3; route stays portal-flagged), **Testing Grounds** (was never in nav; route gets prod guard noted for P4), `/money/cashflow` (never in nav).

Each P3 wave updates this registry + adds §2 redirects in its landing commit. The nav never links to a 404.

---

## 4. The design

One system: **the shell is instrumentation, the canvas is the work.** Glass-dense chrome, hairlines, Cake Mono command voice, zero elasticity. Every motion 150–260ms on `cubic-bezier(0.22,1,0.36,1)`, reduced-motion = opacity swaps.

### 4.1 Sidebar — HUD rail, refined (RECOMMENDED — variant A)

Collapsed-at-rest **72px** icon rail → **240px** hover overlay. The decision and its reasons, explicitly (master plan asks):

- The dashboard is a full-bleed map HUD; Projects/Pipeline/Schedule are density-critical. A permanent 184–256px panel pays rent on every screen for labels you read twice a day.
- 8-item end state makes the icon rail legible; the overlay delivers labels in 200ms when needed.
- It preserves the approved "HUD mode" decision (collapse chevron was deliberately removed) — but **refined to kill the twitch**:
  - **120ms hover-intent delay** before expansion (mouse passing through to content no longer flares the rail); collapse on leave after 80ms grace.
  - Overlay is `glass-dense` (0.78) — content beneath stays legible, no double-glass mush.
  - Labels fade+4px-slide as one block (no stagger, no elastic width spring); `width 200ms ease-smooth`.
  - Keyboard/focus parity: focus into the rail expands it (focus-visible ring per spec).
- Alternative variants (B fixed 184px, C pinnable, D top-strip) wireframed in §5 — B is mocked for comparison.

**Anatomy (top → bottom):**
- **Company header** (56px, border-b hairline): logo chip 28px (logoURL or `Building2`) — expanded adds company name, Cake Mono 300 14 uppercase, truncate.
- **`// COMMAND`** section mark (mono 10, text-mute, 0.16em) — expanded only. Main nav items below.
- **Nav item** (36px, radius 6): icon 20 centered (rest) / icon + Cake Mono 300 13 uppercase label (expanded). Rest: text-3 → hover text-2 + `rgba(255,255,255,0.04)`. Active: text + 2px text-2 left bar (no accent — DESIGN.md law). Gated (flag): text-mute 50%, request-access modal flow as today, tooltips i18n.
- **`// OPS`** bottom group: Calibration + Agent Queue (phase_c only, pending-count badge mono), Settings.
- **Footer** (border-t hairline): OPS mark 16 (text-mute 40%) + `V{pkg.version}` mono 10 — expanded only.
- **User section** (44px): avatar 32 (image or initial) + name Mohave 14 + role mono 10 text-3 uppercase (from `usePermissionStore.roleName`) → opens operator menu (§4.3). Rest state: avatar only.
- **Mobile <768:** drawer 280px, always-expanded anatomy, black/50 backdrop, slide 250ms, Escape + backdrop dismiss, focus-trapped. Hamburger stays in top bar.
- z: topbar 500 · scrim 502 · sidebar 505 (nav band; documented in registry file).

### 4.2 Top bar — registry-fed, one composition

56px, glass strip from 72px (sidebar edge) to right viewport edge.

- **Left:** [mobile hamburger] · **H1 Cake Mono 300 22** uppercase from registry `labelKey` (longest-prefix match) — nested routes swap to breadcrumb: parent (mono 11 uppercase text-3, clickable) `/` entity (Mohave, text, truncate) via existing breadcrumb store.
- **Center:** undo chip (appears when stack non-empty; spinner while undoing; ⌘Z) + search field (visual input, 200→260px, `Search…` text-3, ⌘K kbd chip when hints on) → dispatches command palette.
- **Right:** sync indicator (hover-reveal label; offline = rose) + **clock** `14:32` mono 11 text-3 tabular (mission-deck cue from the UI kit's operator strip; minute-tick, no seconds).
- All four states of sync keep current data sources. Every string via `navigation.json`/`topbar.json` en+es.

### 4.3 Operator menu (avatar) — full redesign

Anchored to the user section, opens upward, 248px, `glass-dense` radius 12, dropdown z 1000.

```
┌──────────────────────────────┐
│ // OPERATOR :: JACKSON       │  mono 11, text-mute slashes
│ jackson@canpro.ca            │  Mohave 12, text-3
│ [ADMIN]                      │  role tag, mono 10, neutral chip
├──────────────────────────────┤
│ ⚙ SETTINGS                   │  Cake 300 13 uppercase, 36px rows
├──────────────────────────────┤
│ ⌐ OPS WEBSITE             ↗  │
│ ⌐ COURSES                 ↗  │
│ ⌐ GET THE IOS APP         ↗  │  ← fix-or-cut decision (§6 Q3)
├──────────────────────────────┤
│ ⏻ SIGN OUT                   │  rose text, rose-soft hover
└──────────────────────────────┘
```

External links get a 12px `↗` (arrow-up-right) suffix, text-mute. No accent anywhere. Icons 16, text-3.

### 4.4 Edge rail — unified instrument cluster

Three tabs, one system. **All elasticity removed** (no hover-grow, no sibling-push — that code is deleted, geometry registry and all).

- **Tabs:** 28px wide, radius 6 outer corners, glass-dense, 2px accent stripe (severity for notifications: rose/tan/steel; steel for QA; text-mute for bug report), glyph 14 upright (no rotated bell), vertical wordmark Cake 300 11, count in vertical mono. Fixed heights — notifications 164 / quick actions 140 / report 96 — stacked gap 8, group centered on the rail. Hover: background brighten 150ms + tooltip (title + shortcut chip). That is all hover does.
- **Open:** tab translates left with its drawer (260ms), glyph swaps/rotates as today. **All drawers 360px**, glass-dense, left corners radius 10, identical header/footer anatomy:
  - Header: `// TITLE` (Cake 300 13) + count (mono 11 text-2) + right-side controls.
  - Footer: `SYS :: SYNC {hh:mm}` stamp left (mono 10 text-mute), one action right.
- **Notifications drawer:** filter row as a single segmented strip (ALL n · CRIT n · ATTN n · INFO n — mono 10, earth-tone active states, no wrap). Rows: tone bar (2px persistent / 1px standard), icon chip 20, title Mohave 13.5, rel-time mono. **Hover reveals the action button inline** (one step, no expand needed); click still expands body text. Dismiss `×` on hover for non-persistent. Footer: `SYS :: SYNC 14:32` + `CLEAR ALL`. Dead controls (mute-all, snooze) cut. Empty: `[ ALL CLEAR ]`.
- **Quick actions drawer:** rows icon 14 + label Mohave 13 (i18n) + hint code mono 9. Footer: `CUSTOMIZE` →. Setup-gate interception unchanged.
- Keyboard: N / Q / ` toggles, Escape closes, outside-click dismiss (unchanged); arrow-key list nav kept.

### 4.5 FAB / quick-actions audit vs the new IA

All 9 actions keep working targets at ship time (transition rule). Registry-documented retargets for P3 landing commits:

| Action | P2 target (exists) | P3 retarget |
|---|---|---|
| Add Expense | `/accounting?tab=expenses` | `/books?segment=expenses` (3.1) |
| New Invoice | `/invoices?action=new` | `/books?segment=invoices&action=new` (3.1) |
| New Item | `/inventory?action=new` | `/catalog?segment=stock&action=new` (3.2) |
| New Task Type | `/settings?tab=company` | unchanged |
| window-handler actions (lead/estimate/client/project/task) | unchanged | unchanged |

Labels move to `quick-actions.json` (`action.expense` …) en + es.

### 4.6 Schedule rename (rides P2, per §2/§6)

- `src/app/(dashboard)/calendar/` → `src/app/(dashboard)/schedule/`; `/calendar` → 308 redirect `/schedule` (query-preserving, middleware).
- Registry entry `schedule`; `navigation.json` en "Schedule" / es "Agenda"; internal `router.push("/calendar")` references re-pointed (grep sweep at build).
- Old notification `action_url: /calendar...` resolves via the redirect. `calendar.json` dictionary namespace untouched (content strings, not the route).

---

## 5. Wireframe variants (structure exploration)

**A — HUD RAIL (recommended).** Collapsed 72px instrument rail; labels on intent. Max canvas; preserves the HUD identity; refinements kill the twitch.

```
┌──┬─────────────────────────────────────────────┬─┐
│▌ │ DASHBOARD          [↶][ Search… ⌘K]  ✓ 14:32│▐│ ← topbar 56
│⌗ │                                             │N│
│▤ │              FULL-BLEED CANVAS              │ │ ← notif tab
│⌖ │              (map / table / kanban)         │▐│
│⌗ │                                             │+│ ← QA tab
│… │                                             │ │
│⚙ │                                             │▐│ ← report
│◉ │                                             │ │
└──┴─────────────────────────────────────────────┴─┘
 72px → hover 240px overlay (glass-dense, 200ms)
```

**B — FIXED COMMAND SIDEBAR.** Always-on 184px, Cake labels visible, `// COMMAND` header. Zero hover choreography; calmer; costs 112px of permanent canvas; 13 transitional items always legible.

```
┌────────┬───────────────────────────────────┬─┐
│ ▣ CANPRO│ DASHBOARD    [↶][Search ⌘K] ✓ 14:32│▐│
│ //COMMAND                                  │ │
│ ▌DASHBOARD                                 │N│
│  PROJECTS│            CANVAS               │ │
│  SCHEDULE│      (inset 184px left)         │+│
│  …      │                                  │ │
│ //OPS   │                                  │▐│
│  SETTINGS                                  │ │
│ ◉ JACKSON                                  │ │
└────────┴───────────────────────────────────┴─┘
```

**C — PINNABLE HYBRID.** A + a pin (⌘B) persisting the expanded state. Power-user control; contradicts the earlier deliberate chevron removal; one more state to maintain. Not recommended now — registry makes it a cheap later add if asked for.

**D — TOP COMMAND STRIP.** No left rail; nav as a horizontal strip under the top bar; right rail unchanged. Full-width canvas; breaks down at 13 transitional items + breadcrumbs/search competing for the strip; mobile needs a drawer anyway. Rejected.

**Recommendation: A.** It is the only structure that serves the end-state product (canvas-first command deck), and the refinements address every observed clunk. B is the safe runner-up — mocked for comparison so the call is made on pixels, not prose.

---

## 6. Decisions for Jackson (approval gate)

1. **Sidebar model:** A (refined HUD rail — recommended) or B (fixed 184px)?
2. **Edge tabs:** approve removal of hover-grow + sibling-push (fixed-height tabs, hover = brighten + tooltip only)?
3. **Operator menu iOS item:** GET THE IOS APP → `https://opsapp.co` (site download CTA) — or cut the item until a verified App Store URL exists?
4. **Phase C surfaces in nav:** Calibration + Agent Queue both render (bottom `// OPS` group) for phase_c companies — Canpro keeps one-click access; everyone else never sees them. Confirm Calibration inclusion (master plan §2 lists only Agent Queue explicitly; "reachable for Canpro" is the stated posture).
5. **Clock in top bar** (mono HH:MM, right of sync): keep or cut?

---

## 7. Build plan (post-approval)

1. `route-registry.ts` + `navigation.json` en/es + registry-derived gates (auth gate, full-height, titles).
2. Sidebar rebuild (desktop rail + overlay, mobile drawer, company header, footer, user section).
3. Operator menu.
4. Top bar rebuild (titles from registry, breadcrumbs, search, undo, sync, clock).
5. Edge rail: EdgeTab simplification (delete grow/push), unified geometry; notifications drawer recompose; QA drawer restyle; bug-report tab restyle.
6. FAB i18n + registry retarget map.
7. Schedule rename: dir move, middleware redirect, internal-link sweep, dictionaries.
8. Z-index migration (nav band 500s), dead-code removal (`useInboxUnreadCount` from shell, sidebar legacy store fields), dictionary cleanup.
9. Verify in running app (desktop + 390px), screenshot gallery, bible update, atomic commits throughout.

---

## 8. Build addenda (2026-06-11, post-approval)

**Approved decisions (§6):** A — refined HUD rail · edge-tab hover-grow/sibling-push removed · iOS item FIXED with the live App Store URL (`apps.apple.com/us/app/ops-job-crew-management/id6746662078`, same one ops-site ships) · Calibration + Agent Queue both in the `// OPS` group for phase_c companies · clock kept.

**phase_c gating — the §2 note became a build item.** Live verification exposed that prod has **no global `phase_c` row** in `feature_flags`; unknown slugs default to accessible, so `canAccessFeature("phase_c")` returned true for every company (a non-flagged test company rendered the Phase C nav). Fixed by extending the existing synthetic per-company mechanism in `/api/feature-flags` (the `inbox_ui` pattern): `phase_c` is now appended from `admin_feature_overrides` per company, carrying routes `/calibration` + `/agent` so reachability is company-gated too (in-place 404). No prod DB write was needed. Today exactly one company carries the override: Canpro Deck and Rail. Note the side effect (intended, per master plan §3 posture): other `canAccessFeature("phase_c")` consumers (integrations tab, confirm-schedule button) now read the company truth instead of failing open.

**Parallel-session WIP discovery.** The primary OPS-Web checkout carries a sibling session's **uncommitted** edge-tab refactor (notifications/quick-actions/bug-report tabs + edge-tab.tsx/.types + an untracked `edge-rail-layout.ts` + tests — hover-height clamps, geometry-registry push fixes for bugs dd5659ed/85da1e52/edfdd057). That work implements the hover-grow/sibling-push choreography this P2 **deletes by approved decision** — it is superseded. Do not land that WIP after P2 merges; the viewport-clamp + content-driven-height behaviors it was fixing are carried forward in the rebuilt system (`getEdgeRailDrawerWidthStyle`, `computeQuickActionsPanelHeight`).

**Dictionary deltas vs §4.4:** notification filter chips ship the approved compact codes (ALL/CRIT/ATTN/INFO) — the full words overflowed the 360px drawer with live data. `navigation.json` (en+es) is the new shared label namespace; `sidebar.json`'s nav keys remain for nothing and can be retired with the namespace cleanup in P4.

**Verification (dev server, auth bypass, Maverick test company):** `/calendar?date=…&task=…` → 308 `/schedule` query-preserved · registry titles in top bar + browser tab · rail rest/hover/intent-delay · operator menu · Phase C entries absent for non-flagged company · notifications drawer with live rows + hover actions + CLEAR ALL · quick-actions drawer (Q) with i18n labels · 390px drawer + clamped tabs · 42 registry invariant tests + 52 shell component tests + 19 flags-API tests green; full unit suite green except one pre-existing main failure (`tests/unit/inbox/ai-draft-provenance.test.ts`, untouched by this branch).

---

## 9. Revision — fixed instrument rail (2026-06-11, post-review)

**Jackson rejected the shipped §8 rail on live review:** the hover-to-expand overlay read as jarring every time the cursor grazed the rail, and the result looked too close to the pre-P2 sidebar. Decision (made on inline mockups, option B): **the rail never expands.**

**Shipped revision (`cc4f78a6`):**

- Fixed 72px icon rail — no width animation, no overlay, nothing reflows. The hover-intent/grace timers and `isHoverExpanded` store state are deleted; `Cmd+B` (which toggled expansion) is retired.
- Labels surface as a **portalled glass tooltip** anchored to the rail's right edge (90ms dwell, `role="tooltip"`, keyboard-focus parity, reduced-motion safe, suppressed on mobile where labels are inline). Replaces the native `title` tooltips.
- Active row: centered 40px fill tile + the 2px `text-2` edge marker. Group boundaries render as short centered hairlines at rest (labels only in the mobile drawer).
- Operator menu flies out `side="right"` from the avatar (was `side="top"`), since the rail has no expanded state to align with.
- Mobile drawer unchanged: full labelled anatomy, `// group` marks, scrim + Escape.

**Note for §8's "Sidebar model: A" record:** decision A is superseded by this revision — the approval-gate choice was re-opened after Jackson saw A in the running app. The mockup comparison file for this round lives in the session transcript (inline visualization), not `docs/mockups/`.

**Worktree dev note (`cb80f3e5`):** Turbopack panics on the worktree's symlinked `node_modules` ("points out of the filesystem root"); `npm run dev:webpack` (plain `next dev`) added for worktree preview servers. Verified via the dev auth bypass on the overhaul worktree (port 3017): rail fixed at 72px, tooltip text/position correct, operator menu right-flyout, 390px drawer clean, `tsc` exit 0.
