# OPS-Web Overhaul — Master Plan

**Status:** Active — P1 (decisions) complete · P2 (shell) shipped · P3.1 (Books) shipped
**Decision authority:** Jackson, 2026-06-11
**Document role:** Program-level spec for the full production-polish overhaul of OPS-Web. Every phase session works from this document. Each phase runs its own spec → plan → build → verify cycle; this document defines the destination, the verdicts, and the rules. It does not duplicate per-surface design detail — that is produced inside each phase.

---

## 1. Mission

OPS-Web must look and feel like a product people confidently pay for: uniform, consistent, polished, production-ready on every surface. The bar is the design system's own reference points — xAI, SpaceX mission control, Apple Pro apps. Anything that reads as a loose interpretation, a tech demo, or an old aesthetic fails.

**Definition of done:** every surface in the final IA conforms to `ops-design-system/project/DESIGN.md`, passes the P4 cross-cutting checklist, and survives the P5 full walkthrough with a punch list at zero.

---

## 2. Final information architecture — 8-item nav

The sidebar goes from 16 items to 8. No dividers-as-apology: the list is short enough to need no grouping debate.

| # | Label | Route | Absorbs | Redirects (must preserve query params) |
|---|-------|-------|---------|----------------------------------------|
| 1 | DASHBOARD | `/dashboard` | — | — |
| 2 | PROJECTS | `/projects` | Map (becomes third view mode: canvas / table / map) | `/map` → `/projects?view=map` |
| 3 | SCHEDULE | `/schedule` | — (rename of Calendar) | `/calendar` → `/schedule` |
| 4 | PIPELINE | `/pipeline` | — | — |
| 5 | BOOKS | `/books` | Estimates, Invoices, Accounting (A/R), Expenses (currently orphaned components, no route), Cashflow placeholder | `/estimates` → `/books?segment=estimates` · `/invoices` → `/books?segment=invoices` · `/accounting` → `/books?segment=invoices&view=aging` (exact mapping decided in-phase) · `/money/cashflow` → `/books` |
| 6 | CATALOG | `/catalog` | Products, Inventory (segments: PRODUCTS / STOCK, matching iOS Catalog tab) | `/products` → `/catalog?segment=products` · `/inventory` → `/catalog?segment=stock` · `/products/[id]/options` → equivalent catalog path |
| 7 | CLIENTS | `/clients` | — (rebuilt from scratch) | — |
| 8 | SETTINGS | `/settings` | Team (members, invites, roles, permissions become a Settings section) | `/team` → `/settings?section=team` (exact param decided in-phase) |

**Removed from the default nav** (invisible to all non-flagged companies):

- **Inbox** — shelved (see §3). Route stays flag-gated for Canpro.
- **Calibration** — Phase C surface; flag-gated, reachable for Canpro only.
- **Agent Queue** — Phase C surface; appears in the nav (bottom group, near Settings) **only** for companies with the Phase C flag. Everyone else never sees it.
- **Testing Grounds** — dev-only; must not ship in the production build/nav.
- **Cash Forecast placeholder** (`/money/cashflow`) — absorbed by Books.

**Redirect rule:** every retired route redirects to its absorbing surface. Notification `action_url`s stored in the database (e.g. `/invoices`, `/calendar`) must keep resolving. P4 verifies this end-to-end.

**Schedule rename scope:** route, sidebar label, top-bar title, en + es dictionaries, FAB actions, and all internal links say "Schedule." The current state — sidebar "Calendar," top bar "Schedule" — is exactly the class of drift this overhaul exists to kill.

---

## 3. Inbox / Phase C posture (decided 2026-06-11)

- **The in-app Inbox UI is shelved.** It does not appear in the nav and gets no polish work until the initiative is explicitly resumed. Do not route new features through an in-app inbox surface.
- **The email engine continues headless.** It pipes data (drafts, extracted leads, learning) into and out of the user's connected Gmail / Outlook mailbox. The user's real inbox is the inbox.
- **Phase C (agent functionality) is Canpro-only** until it is 100% production ready. The app must work fully without Phase C; Phase C is a supercharger layered on top, never a dependency.
- **Calibration and Agent Queue** are Phase C operator surfaces: gated behind the existing per-company feature flag, visible/reachable only for flagged companies (today: Canpro). The P2 session must read the current flag mechanics (per-company `inbox_ui` flag, middleware redirects, `feature-flag-definitions.ts`) and extend them to cover nav visibility — verify in code, do not assume this document's naming is exact.

---

## 4. Surface verdicts

| Surface | Verdict | Notes |
|---------|---------|-------|
| Shell (sidebar, top bar, avatar menu, drawers, FAB) | **Rebuild from scratch** | Phase 2. See §5 |
| Books | **Build new** | Replaces three old single-file pages + orphaned expense components |
| Catalog | **Build new** | Inventory page is a 116-line stub; Products is mid-size and absorbed |
| Clients | **Rebuild from scratch** | Adopt the floating-window interaction model (see below) |
| Dashboard | Keep — light polish pass | User-approved baseline |
| Settings | Keep — renovate + absorb Team | Gains team/members/roles section |
| Pipeline | Keep — conformance audit only | Recent heavy build |
| Projects | Keep — absorb Map as view mode | Recent heavy build |
| Schedule (Calendar) | Keep — rename + conformance audit | Recent heavy build |
| Estimates / Invoices / Accounting / Team / Map / Cash-forecast placeholder | **Absorb & retire** | Old pages deleted once parity confirmed |
| Inbox / Calibration / Agent Queue | **Gate, don't touch** | §3 posture |
| Testing Grounds | **Remove from production** | Dev tooling only |

**Feature-parity rule (non-negotiable):** any session absorbing or rebuilding a surface must read the old surface's code top-to-bottom, produce a capability inventory, and reach 100% parity in the replacement — or list descoped items explicitly and get Jackson's sign-off. No silent feature loss. "The old page had it" is a launch blocker, not a footnote.

**Interaction model:** the floating workspace window is canonical for entity detail (already true for Projects — `/projects/[id]` survives only as a thin SEO/deep-link fallback). The Clients rebuild adopts the same model: click a client → client workspace window; `/clients/[id]` becomes a thin fallback. Any control anywhere in the app that still *navigates* to a dedicated detail page instead of opening the window is a bug (P4 sweeps for these).

---

## 5. Phase 2 — shell rebuild scope

Everything else lives inside the shell, so it goes first. One spawned session: **`WEB OVERHAUL - P2-1`**.

In scope, as one cohesive design (mockups before code):

- **Sidebar** — 8-item nav per §2; revisit the hover-expand rail behavior (currently collapsed-at-rest 72px → 256px overlay on hover) as an explicit design decision; mobile drawer; company header; user section.
- **Avatar menu** — full redesign. The current generic dropdown (Settings / OPS Website / Courses / Download iOS App / Sign Out) is off-brand; note the "Download iOS App" item currently links to `"#"` — dead link, fix or cut.
- **Top bar** — page titles must come from a single i18n-compliant route registry shared with the sidebar (today `top-bar.tsx` hardcodes English titles in a local map — this is the Calendar/Schedule drift's root cause); breadcrumbs, search affordance, sync indicator, undo button all re-examined as one composition.
- **Notifications drawer + quick-actions edge tabs** — redesign for cohesion with the new shell; the user has flagged the drawer as clunky.
- **FAB** — audit every action against the new IA (`fab-actions.ts` route handlers point at `/expenses`, `/inventory`, etc. — retarget to absorbing surfaces).
- **Sidebar data hooks** — inbox unread badge is removed with the Inbox nav item; agent-queue badge renders only under the Phase C flag.

Constraints: DESIGN.md §9 components (no accent on nav, 2px text-2 active bar, 6px sidebar radius), z-index scale from `OPS-Web/CLAUDE.md`, work in a git worktree (never branch-switch the primary checkout).

---

## 6. Phase plan

| Phase | Content | Session(s) |
|-------|---------|-----------|
| **P1** | Decision record — this document | done (2026-06-11) |
| **P2** | Shell rebuild (§5) | `WEB OVERHAUL - P2-1` |
| **P3** | Surface waves, priority order: **3.1 Books** (kills 4 nav items) → **3.2 Catalog** → **3.3 Clients** → **3.4 Settings + Team absorption** → **3.5 Projects map-view absorption** → **3.6 Schedule rename** → **3.7 Dashboard + Pipeline + Schedule conformance/polish passes** | `WEB OVERHAUL - P3-1` … `P3-n` |
| **P4** | Cross-cutting consistency sweep (§7) | `WEB OVERHAUL - P4-1` |
| **P5** | Final walkthrough: run the app, every surface, multiple viewports, screenshot gallery, punch list to zero | `WEB OVERHAUL - P5-1` |

**Sequencing rules:** P2 lands before any P3 wave starts (pages land inside the corrected frame). P4 starts only when all P3 waves have landed. Spawn titles follow the convention exactly; ordinals continue across sessions (next spawn in a phase = highest existing ordinal + 1).

**Branch & publication rule (Jackson, 2026-06-11):** the entire overhaul builds on the **single local feature branch `feat/web-overhaul`**, checked out in the `ops-web-overhaul-p2-shell` worktree (directory name is historical — don't rename it, the branch inside is what matters). No per-task, per-phase, or per-surface branches. **Nothing is pushed to GitHub until Jackson explicitly authorizes publication.** Consequence: overhaul waves land **sequentially** on the branch — one overhaul session works it at a time; confirm no sibling overhaul session is mid-wave before starting. Commits stay atomic per the standard rules; this changes where work lands, not how it's committed.

**Transition rule (no broken nav, ever):** P2 ships the rebuilt shell on a **data-driven nav registry** designed for the end-state 8-item IA, but populated only with routes that exist at ship time — Estimates / Invoices / Accounting / Products / Inventory entries remain (inside the new shell design) until their absorbing surface lands. The Schedule rename may ride P2, since `/calendar` already exists. Each P3 wave's landing commit updates the registry — swapping the absorbed entries for the new surface and adding the §2 redirects in the same commit. At no point does the nav link to a route that 404s, and at no point does a surface lose its nav entry before its replacement is live.

**Per-session protocol (every phase session, mandatory):**

1. Read this document, `ops-design-system/project/SKILL.md`, `README.md`, and `DESIGN.md` (+ `colors_and_type.css` tokens), and relevant `ops-software-bible` sections.
2. Read the old surface's code top-to-bottom for the parity inventory (§4).
3. Run its own brainstorm/spec → plan → build cycle; mockups/wireframes before code for any new layout.
4. Verify in the running app with screenshots before claiming done.
5. Commit atomically (stage by name, no AI attribution), respect parallel-session WIP, update the relevant bible section in the same session.

---

## 7. P4 cross-cutting sweep checklist

Run as systematic greps + a full visual walkthrough. Every item is pass/fail per surface:

- [ ] Every project click opens the workspace window — zero navigations to `/projects/[id]` from interactive controls (thin fallback route excepted)
- [ ] Every client click opens the client window (post P3.3)
- [ ] Copy voice (ops-copywriter pass): UPPERCASE authority, `//` panel prefixes, `[brackets]` micro-text, no exclamation points, no emoji, no "Welcome back!"-class copy
- [ ] Numbers: always JetBrains Mono, tabular-lining, slashed zero, formatted (`$12,480`, `87%`), `—` for empty — never `N/A`, never raw floats
- [ ] Empty / loading / error states present and on-spec for every surface
- [ ] i18n: zero hardcoded user-facing strings (top-bar route titles are a known offender); en + es dictionaries complete
- [ ] Icons: `lucide-react` only (no `@carbon/icons-react` imports), sizes 16/20/24/32, `currentColor`, monochrome
- [ ] Accent `#6F94B0` only on primary CTAs + focus rings — never nav, links, toggles, tags, icons
- [ ] Radius / spacing / color trace to tokens (run `custom-skills:audit-design-system`)
- [ ] Motion: single easing `cubic-bezier(0.22, 1, 0.36, 1)`, no spring/bounce, `prefers-reduced-motion` fallbacks everywhere
- [ ] Z-index: touched components migrated to the new scale
- [ ] All §2 redirects work; old notification `action_url`s resolve; no orphaned routes or dead dictionary keys
- [ ] Permissions: granular `has_permission` checks only — zero role-name filtering
- [ ] No box-shadows on dark surfaces; glass tiers used correctly; no triple-stacked glass

---

## 8. Inherited non-negotiables

`DESIGN.md` is law for every visual decision. Root `CLAUDE.md` + `OPS-Web/CLAUDE.md` rules apply in full (perfection standard, no deferral, commit discipline, bible updates). Where this document and the design system conflict, the design system wins and this document gets corrected.

---

## 9. Decision log

| Date | Decision | By |
|------|----------|----|
| 2026-06-11 | 8-item nav approved (Dashboard, Projects, Schedule, Pipeline, Books, Catalog, Clients, Settings) | Jackson |
| 2026-06-11 | Calendar renamed Schedule (route + labels) | Jackson |
| 2026-06-11 | Rebuild from scratch: shell, Books, Catalog, Clients | Jackson |
| 2026-06-11 | Inbox UI shelved; email engine runs headless through the user's connected Gmail/Outlook | Jackson |
| 2026-06-11 | Phase C (agent, Calibration, Agent Queue) Canpro-only until 100% production ready; app never depends on it | Jackson |
| 2026-06-11 | Map absorbed into Projects as view mode; Team absorbed into Settings | Jackson |
| 2026-06-11 | P2 sidebar: hover-to-expand rejected on live review (jarring); fixed 72px instrument rail with right-flyout tooltip labels approved and shipped (cc4f78a6, shell spec §9 revision) | Jackson |
| 2026-06-11 | Single local branch `feat/web-overhaul` for the entire program; no per-task branches; no GitHub pushes until explicitly authorized; waves land sequentially | Jackson |
| 2026-06-11 | **P3.1 Books direction A ("Instrument Strip") approved** — Jackson delegated the pick ("whatever you think is the best UX") across three live-reviewed mockups; A chosen for iOS-pattern fidelity, table width, and clean permission degradation. Mockups + capability inventory + plan: `docs/{design/2026-06-11-books-mockups, specs/2026-06-11-books-capability-inventory.md, plans/2026-06-11-books-surface.md}` | Jackson (delegated) |
| 2026-06-11 | **P3.1 Books shipped** — `/books` with ledger strip (NET/CASH FLOW/A-R/JOBS) + 4 segments (INVOICES · ESTIMATES · EXPENSES · SYNC); zero descopes against the capability inventory. §2 row-5 mapping confirmed: `/accounting` → `/books?segment=invoices&view=aging` (tab-aware: expenses→expenses, integrations→sync, import→sync+import); `/books/cashflow` (iOS forecast_dip action_url) added to the redirect map. Registry gained `anyOfPermissions` (route gate = invoices.view ∨ estimates.view ∨ expenses.approve ∨ accounting.view; `.approve` because the web expenses segment is the review hub); `/books` joined the `accounting` feature-flag route list. Old pages deleted after live verification (gallery in `docs/design/2026-06-11-books-mockups/verification/`). Known pre-existing red: `tests/unit/inbox/ai-draft-provenance.test.ts` (lifecycle-learning flag drift, unrelated to this wave) | Session P3.1 |
| 2026-06-11 | Market-intel research (`WEB OVERHAUL - P3-1-1`) folded into Books: A/R-at-a-glance + per-job profit are the trades-loved surfaces; nothing auto-sends in the operator's voice; plain-language labels over accountant-speak | Session P3.1 |
