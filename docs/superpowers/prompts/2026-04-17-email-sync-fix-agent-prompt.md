# Fix-Agent Prompt — Email Sync 7-Bug Critical Batch

Copy-paste the block below into a new Claude Code / Cursor / agent session from the `OPS-Web` directory.

---

You're picking up a critical fix batch on the OPS email-sync pipeline. A previous session discovered 7 bugs during end-to-end testing of Canpro's Phase C activation. The plan is fully written — you execute it.

**Repo:** `/Users/jacksonsweet/Projects/OPS/OPS-Web`
**Branch:** `feat/visual-system-foundation` (already has the foundation fixes; ~23 commits ahead of main — do NOT rebase or force-push)
**Plan:** `docs/superpowers/plans/2026-04-17-email-sync-critical-fix-batch.md`

## Your task

Execute the plan verbatim. It contains:
- Priority-ordered fix list (bugs #23, #19, #20, #21, #22, #18, #17)
- Exact file paths and line numbers for each broken code section
- Complete replacement code (not prose — actual paste-ready TypeScript)
- Verification SQL queries after each fix
- Commit-message templates

Work in the order the plan specifies. Commit after each bug is fixed and verified. Use Conventional Commits format matching the repo's style (see `git log --oneline` for examples).

## Non-negotiable constraints

1. **Read the plan's §0 context section before touching anything.** It points you at required reading (4 files) and the recent AsyncLocalStorage migration that you MUST respect.

2. **Use `runWithSupabase`, never `setSupabaseOverride`, inside any `after(...)` callback.** The AsyncLocalStorage pattern was introduced in commit `5718ed0d` specifically to fix a RLS race. Re-introducing `setSupabaseOverride` in background code re-opens the race. See `src/lib/supabase/helpers.ts` for the correct pattern.

3. **`helpers.ts` stays client-safe.** Don't add Node-only imports without the lazy `getStorage()` guard pattern already in place.

4. **Do NOT delete or soft-delete** Canpro production data (25 clients, 71 opportunities, 72 activities, 94 thread links). The plan's DB backfill (§2 Part B) is the ONLY DB write you need to do for bug #23.

5. **Run verification** — the plan has SQL queries and browser steps after each fix. Actually run them. Don't claim done until you've confirmed. Paste the query output into your commit body or PR description when a result is meaningful.

6. **Follow OPS brand + code standards:**
   - Root `CLAUDE.md` and `OPS-Web/CLAUDE.md` — read both.
   - Interface design spec: `.interface-design/system.md`. Any UI touch (bugs #19, #22 need tiny UI changes) must use design tokens; no hardcoded colors, no non-system fonts.
   - User-facing copy: invoke the `ops-copywriter` skill for every new string (notifications, callouts, button labels, error messages). Don't improvise.
   - Z-index: follow the scale in `OPS-Web/CLAUDE.md`'s z-index table.

7. **Test in a browser before claiming done on UI-touching fixes** (#19, #22). `npx next build --experimental-build-mode=compile` passing is necessary but not sufficient.

## Deployment flow

The repo deploys to Vercel on push. Workflow:

1. Work on `feat/visual-system-foundation`.
2. Commit each fix with its own commit (seven commits total, roughly).
3. `git push origin feat/visual-system-foundation` — triggers a Vercel preview build.
4. `vercel ls` to find the preview URL. Wait for Ready.
5. `vercel promote <preview-url> --yes` promotes to production (triggers a fresh prod build). Wait for Ready.
6. Test the fix against `https://app.opsapp.co`.

Don't merge to main. Jackson will do that himself once he's reviewed the whole batch.

## Scope discipline

This plan covers EXACTLY 7 bugs. Do NOT:
- Refactor adjacent code that looks ugly.
- Add telemetry / logging beyond what the plan specifies.
- Fix other bugs you notice (e.g., tasks #10, #11, #12, #13 in Jackson's backlog — not in scope).
- Write migration scripts beyond the one Canpro backfill `UPDATE` in §2 Part B.
- Create documentation beyond what the plan asks for.

If you find a new critical bug mid-execution, stop and report it — do not fix it out of scope.

## Success criteria

- All 7 bug fixes committed to `feat/visual-system-foundation` in priority order.
- Preview deploy Ready, promoted to production, verified against prod.
- Canpro backfill executed (the one SQL `UPDATE`) and Phase C retriggered.
- Phase C tables populated: `agent_memories`, `agent_writing_profiles`, `agent_knowledge_graph` — all with row counts > 0 for Canpro (`company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'`).
- Shared verification checklist in plan §9 all green.
- Summary comment to Jackson in chat with:
  - 7 commit SHAs
  - Prod deploy URL (final)
  - Verification query outputs
  - Anything you flagged as new/unexpected

If any fix fails verification and you cannot resolve in-session, stop and report — do not ship a partial batch.

---

Begin by reading `docs/superpowers/plans/2026-04-17-email-sync-critical-fix-batch.md` in full.
