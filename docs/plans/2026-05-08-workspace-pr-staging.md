# Project Workspace Modal — PR Staging

**Status:** Branch is feature-complete and test-gate-clean. Push and PR are intentionally **not** executed by the implementing agent — the reviewer + Jackson have a sequencing question to settle first (see "Sequencing notes" at the bottom).

## When ready, push:

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web/.claude/worktrees/p14-test-gate
git push -u origin feature/project-workspace-modal
```

## When ready, open PR:

```bash
gh pr create --title "feat: unified project workspace modal" --body "$(cat <<'EOF'
## Summary

Single mode-aware ProjectWorkspaceWindow replaces 5 legacy project surfaces (project-detail-modal, project-detail-sheet, create-project-modal, edit-project-modal, project-detail-popover). Net diff: ~2,000 LOC removed, ~10,000 LOC added; 590 workspace-targeted tests passing.

## What ships
- Modes: viewing (dossier with map + tabs + always-on sidebar) / editing (Identity + Schedule tabs) / creating (same tabs, no project yet)
- Real Mapbox GL JS map with compact (220px) + expanded (full-body) states
- Real lat/lng backfill across 211/214 existing projects via geocoding script (Phase 1)
- Unified \`project_notes\` timeline with \`event_kind\` discriminator (notes + system events: status_change, project_created, project_archived, photo_uploaded, etc.)
- Real accounting pipeline + ledger from estimates/invoices/payments/expenses
- Flat team display (PM concept removed; team computed from task assignments)
- Real Open-Meteo weather (12h cache via \`weather_forecasts\`)
- Notifications dispatched on every project action (status change, archive, assignment, mention)
- Photo upload via \`<NoteComposer>\` with cross-post to gallery; timeline row written; no notification (too noisy)
- Always-on sidebar: Health · Client · Location · Team · Dates · Weather · Linked Records
- Notification deep-linking via \`?openProject={id}&mode=view\`
- Spanish translations
- Workspace-scoped \`ConfirmModal\` (destructive variant) for archive flow

## Database changes
- \`project_notes.event_kind\` (nullable text) — Phase 1
- \`project_notes.content_metadata\` (nullable jsonb) — Phase 1
- \`projects.trade\` (nullable text + check constraint: roofing/hvac/plumbing) — P8.1-fix
- All additive per iOS sync constraint; iOS app at \`OPS/\` reads them as optional and ignores until next App Store release

## Cut from MVP scope (intentional)
See plan file §"Cut from MVP Scope" for full list. Highlights:
- Project Manager / subcontractor concepts (OPS team is flat)
- Per-project color picker (status hex drives chrome)
- Site metadata fields (gate code, parking, etc.) — descope
- ContextTab + PeopleTab + PersonPicker (computed from tasks)

## Architecture references
- \`OPS-Web/CLAUDE.md\` § "Project Workspace Window"
- \`ops-software-bible/05_DESIGN_SYSTEM.md\` § "Project Workspace Window"
- \`ops-software-bible/07_SPECIALIZED_FEATURES.md\` § "Project Workspace as a Reusable Pattern"
- Plan file: \`docs/plans/2026-05-06-project-workspace-modal-implementation.md\`

## Test plan
See \`docs/plans/2026-05-08-workspace-ship-checklist.md\` for the visual verification walkthrough.

- [x] All unit + integration tests green (590 workspace-targeted; full suite green except pre-existing \`server-only\` worktree-env failures + the 2 stripe flakes addressed on \`fix/stripe-webhook-flakes\`)
- [x] Type-check clean
- [x] Lint clean
- [x] Zero hex / rgba / @/components/ui literals in \`src/components/ops/projects/workspace/\`
- [x] All animations \`EASE_SMOOTH\` with \`useReducedMotion\` guards
- [ ] Manual visual verification (Jackson)
- [ ] E2E + visual regression specs un-skipped (env-dependent — separate session)

## Sequencing notes
- \`fix/stripe-webhook-flakes\` (commit f9ce5da1) is unmerged. Decide: merge that to main first so this PR's CI is green, OR merge after. Reviewer's lean: merge stripe first.
- The worktree \`server-only\` alias bug (15 unrelated tests) blocks any worktree-based test run. Pre-existing. Out of scope for this PR; worth a follow-up session.
EOF
)"
```

## Cleanup after merge
- Delete the p14-test-gate worktree: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git worktree remove .claude/worktrees/p14-test-gate`
- Plan file (`docs/plans/2026-05-06-project-workspace-modal-implementation.md`) stays as historical record
