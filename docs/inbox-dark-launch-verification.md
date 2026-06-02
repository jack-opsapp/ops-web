# Inbox Dark-Launch — Verification & Launch Runbook (T13)

- **Date:** 2026-06-02
- **Branch:** `feat/inbox-dark-launch-iso` (worktree `ops-web-inbox-dark-launch`)
- **Spec:** `docs/specs/2026-06-01-inbox-dark-launch-design.md` · **Plan:** `docs/plans/2026-06-01-inbox-dark-launch.md`

## Automated verification (done)

- **Full vitest suite:** 2940 passed, 5 skipped, **14 failed**. **TypeScript: 0 errors** (`tsc --noEmit`).
- **All 14 failures are pre-existing and unrelated to this branch** — every one is in a file this branch never touched (verified via `git diff --name-only fedc55cc..HEAD` ∩ failing files = ∅): `uploads-presign` (8), `company-service-images` (2), `project-workspace-editing` (1), `calendar/map-task-to-event` (1), `use-table-keyboard-nav` (1), `api-client` Bubble rate-limit (1, timing-flaky), `visual/project-workspace.spec` (needs a browser). CI is already red on `main` (lint gate + these), per project history.
- **Every inbox test added by this initiative passes**, run together: idempotency helper, inbox_ui service, feature-flags route, auto-draft mailbox push, draft reconciliation (unit + integration), notification gating, pipeline draft-to-mailbox, admin toggle, route gate + feature-flag-definitions, auto-send kill switch, autodraft defaults.
- **Settings footprint preserved:** `src/components/settings/**` and `src/app/(dashboard)/calibration/**` contain **no** `inbox_ui` reference — mailbox connect/reconnect, sync controls, and the lead-import wizard stay available regardless of the inbox flag. Engine endpoints (`/api/cron/*`, lead creation in sync) are not gated by `inbox_ui`.
- **Live-schema CHECK verified (caught a prod-breaking bug):** vitest runs against a mocked DB and does NOT enforce Postgres CHECK constraints. Direct prod inspection found `ai_draft_history_status_check` rejected the reconciliation's `sent_from_mailbox` / `discarded_in_mailbox` writes — fixed by migration `20260602010000` (CHECK expanded to allow them; applied to prod, verified). Lesson: verify new status/enum values against the live constraint, never just the mocked tests.

## What each guarantee rests on

| Guarantee | Verified by |
|---|---|
| `/inbox` redirects to `/pipeline` when `inbox_ui` off | `tests/unit/inbox/inbox-ui-gate.test.ts` + `feature-flag-definitions.test.ts`; live: `tests/e2e/inbox-gating.spec.ts` (skips without creds) |
| Sidebar hides Inbox + widget repoints when off | `tests/integration/inbox/feature-flags-route.test.ts` (route); UI render = manual/e2e |
| Auto-draft lands in real mailbox, idempotent, never auto-sends | `auto-draft-mailbox.test.ts` + `auto-send-killswitch.test.ts` |
| Learning re-wired via sync (used → learn; from-scratch → no edit-learn) | `draft-reconciliation.test.ts` (unit + integration) |
| Auto lead import still runs (NOT gated) | guardrail in spec §4a; sync-engine lead creation untouched |

## Deferred to a live environment / launch (needs running app + real mailboxes)

Run these before flipping anything on for real users:

1. **Connect smoke:** From Settings → Integrations → Email, connect a **Gmail** mailbox and an **Outlook** mailbox; run "Import Your Pipeline". Confirm leads import and ongoing sync creates leads.
2. **Gate smoke (`inbox_ui` off, the default):** `/inbox` redirects to `/pipeline`; Inbox sidebar item hidden; inbox-leads widget CTA goes to `/pipeline`.
3. **Team on:** enable `inbox_ui` for your company (`/admin/system`); `/inbox` loads; nav item returns.
4. **Auto-draft round-trip (`phase_c` company):** enable `phase_c`; send a client email into a connected, opportunity-linked thread; confirm OPS drops a **threaded** reply draft into the real Gmail/Outlook Drafts folder; edit + send from the mail client; confirm the next sync reconciles it (`status → sent_from_mailbox`) and Phase C learns. Test both providers.
5. **Pipeline draft:** click **Draft** on a Pipeline lead → confirm the reply is saved to the mailbox (works without `phase_c`).
6. **Notifications:** with `inbox_ui` off, confirm no per-draft "Draft ready" ping; the one-time "Replies, pre-drafted" explainer fires once; sync-complete points to `/pipeline`.
7. **M365 reconnect (pre-existing bug, found in T4 review):** `src/app/api/integrations/microsoft365/callback/route.ts` uses a raw INSERT that 409s on reconnect. Verify M365 reconnect, or fix by mirroring the Gmail callback's existence-check. (Not introduced by this initiative.)
8. **Deferred backfill (live-data write — needs explicit go-ahead):** existing connected mailboxes were NOT backfilled with auto-draft defaults (new connections are seeded automatically). At launch, decide whether to backfill `email_connections.auto_send_settings` for existing `phase_c` companies and run it via MCP with go-ahead. Idempotent SQL is in spec §6.1.
9. **Cost review:** after week 1, read actual drafting spend on `OPENAI_API_KEY_DRAFTING` (spec §8).

## Known follow-ups (minor, non-blocking)

- `listDrafts()` is not paginated; a mailbox with >100 drafts could mis-correlate reconciliation by one cycle (worst case: a one-sync delay, never data loss). Flagged in `draft-reconciliation.ts`.
- Explainer/Pipeline-button copy is operator-acceptable but should get a final `ops-copywriter` pass before broad rollout.
- `DraftGenerator` (`src/lib/api/services/draft-generator.ts`) is now dead code (the draft route uses `AIDraftService.generateDraft`); safe to remove in a cleanup.
- **Bible debt:** `ops-software-bible/03_DATA_ARCHITECTURE.md` `ai_draft_history` schema block still needs `mailbox_draft_id` + the expanded `status` CHECK added — deferred because that file held another session's uncommitted WIP at write time. `04_API_AND_INTEGRATION.md` (Inbox Dark-Launch §) + the two mirrored migrations already document the feature; add the 03 block once that file is free.
