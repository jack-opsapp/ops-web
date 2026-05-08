# Project Workspace Modal — Manual Visual Ship Checklist

This is the human-driven verification pass before opening the PR. Walk through every item below in a real browser. Anything that doesn't match the spec is a blocker.

Companion files:
- Plan: `docs/plans/2026-05-06-project-workspace-modal-implementation.md`
- PR staging: `docs/plans/2026-05-08-workspace-pr-staging.md`
- Token spec: `.interface-design/system.md` § "Project Workspace Patterns"

## Setup

- [ ] Pull `feature/project-workspace-modal` and start the dev server (`npm run dev`)
- [ ] Confirm `NEXT_PUBLIC_MAPBOX_TOKEN` is present in `.env.local`
- [ ] Sign in as an account that has at least 5–10 existing projects, ideally with at least one active, one in `Quoting`, one `Completed`, and one with attached tasks
- [ ] Open the browser at default 1440×900; have a 1280×800 viewport ready as a secondary check

## 1. Open from spreadsheet (`viewing` mode)

- [ ] Click any project row in the projects table
- [ ] Workspace window mounts, mode pill shows `VIEWING` (quiet — no pulse)
- [ ] Map renders in compact (220px) state with status-colored pin glow
- [ ] Sidebar populates: Health · Client · Location · Team · Dates · Weather · Linked Records
- [ ] Activity timeline scrolls and shows both notes and system events (status_change rows visible if the project ever had its status changed)
- [ ] Schedule tab renders the project's tasks as a strip with the today-tick highlighted in the project's status hex

## 2. Switch to `editing` mode

- [ ] Click EDIT in the workspace footer
- [ ] Mode pill flips to `EDITING` (tan + 1.6s pulse — opacity 1 ↔ 0.45)
- [ ] Identity tab populates with project name, address (with autocomplete-ready field), trade, status, dates, client
- [ ] Schedule tab shows editable task list
- [ ] Footer changes to mode-aware: destructive (ARCHIVE), spacer, ghost (CANCEL), primary (SAVE)
- [ ] Edit a field, click SAVE; activity timeline gains an entry; the underlying spreadsheet row updates without a page refresh

## 3. Open `creating` mode (FAB)

- [ ] Click the FAB at bottom-right → Add Project
- [ ] Workspace opens in `creating` mode with empty form
- [ ] Mode pill shows `CREATING` (accent + pulse)
- [ ] Identity tab fields all blank
- [ ] Trade field is required-marked (legacy projects accept null but new ones do not — see `03_DATA_ARCHITECTURE.md` § projects.trade)
- [ ] Footer: spacer, ghost (CANCEL), primary (CREATE PROJECT)
- [ ] Fill in minimum required fields; save; window switches to `viewing` mode for the new project; sidebar populates; activity timeline shows `project_created` event
- [ ] Spreadsheet row appears

## 4. Window chrome

- [ ] Drag the header — window moves smoothly
- [ ] Resize from each of the 8 corners/edges — window resizes; min size 780×600 enforced
- [ ] Close (red traffic light) — window unmounts, state preserved if reopened
- [ ] Minimize (yellow traffic light) — window collapses to dock
- [ ] Reopen the same project — position + size restored from `localStorage` key `opsWin:project-{id}`

## 5. Reduced motion

- [ ] System Settings → Accessibility → Reduce Motion ON (macOS) or browser dev tools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce"
- [ ] Mode pill pulse stops; transitions are instant
- [ ] Window open/close has no animation
- [ ] Map animations honor reduced-motion

## 6. Smaller viewport (1280×800)

- [ ] Resize browser to 1280×800
- [ ] Open workspace — window default 1080×760 still fits inside the viewport
- [ ] Drag and resize still work; window cannot escape the viewport

## 7. Offline / no internet

- [ ] Browser dev tools → Network → Offline
- [ ] Open a project — Mapbox shows offline state (no map tiles, but pin position cached if previously loaded)
- [ ] Weather block falls back gracefully (`weather_forecasts` cache up to 12h old still rendered; otherwise clean empty state)
- [ ] No console errors

## 8. Deep link

- [ ] In a fresh tab, visit `/?openProject={known-project-id}&mode=view` (use any real project id from your account)
- [ ] Workspace opens automatically in `viewing` mode
- [ ] URL params strip from the browser address bar after open (no params remain — verifies P9.7 cleanup)

## 9. ARCHIVE flow

- [ ] In `editing` mode, click ARCHIVE
- [ ] `ConfirmModal` opens — destructive variant: glass-dense background, rose accent stripe, 12px modal radius, sanctioned `--shadow-window` elevation
- [ ] Cancel — modal closes, status unchanged
- [ ] Archive again, click confirm
- [ ] Status flips to Archived; activity timeline gains `project_archived` row
- [ ] Team members receive notification (check the rail in the topbar — see `dispatchProjectArchived` in `notification-dispatch.ts`)
- [ ] Spreadsheet excludes the project from the default view

## 10. Create-from-task-modal flow (P10-1 callback)

- [ ] Open Create Task form
- [ ] In the project picker, click "Create New Project"
- [ ] Project workspace opens on top in `creating` mode
- [ ] Save the new project; workspace closes
- [ ] Task modal's project picker auto-selects the new project (callback fires correctly)

## 11. Spanish translation

- [ ] Switch language to ES (header language toggle)
- [ ] Open workspace — every visible string is Spanish: tabs, footer buttons, mode pill labels, sidebar headers, ConfirmModal copy, empty states
- [ ] No raw dictionary keys (`projectWorkspace.tabs.activity`) leak through
- [ ] Language toggle back to EN; everything reverts

## 12. Edge cases

- [ ] Open a project with NO tasks — Schedule tab shows empty state (`—` not "N/A")
- [ ] Open a project with NO address — map shows "no location" empty state, sidebar Location card shows `—`
- [ ] Open a project where `latitude` / `longitude` are null but address is set — map should render after geocoding completes
- [ ] Try opening the same project twice — second open focuses the existing window rather than creating a duplicate

## After all green

Hand off to the reviewer to read `docs/plans/2026-05-08-workspace-pr-staging.md` and decide on the Stripe-flake / `server-only` sequencing before pushing the branch.
