# WEB POLISH BATCH — Shared Execution Rules (read first)

Eight plans in this directory (`2026-07-09-*.md`) implement Jackson's 2026-07-09 polish list. They execute **sequentially, in this order**, each by a dedicated agent:

1. `2026-07-09-toast-unification.md`
2. `2026-07-09-metrics-flip.md`
3. `2026-07-09-toolbar-cohesion.md`
4. `2026-07-09-catalog-fixes.md`
5. `2026-07-09-books-expenses-and-switching.md`
6. `2026-07-09-pipeline-polish.md`
7. `2026-07-09-clients-quick-actions.md`
8. `2026-07-09-projects-default-view.md`

## Workspace

- **Work ONLY in `/Users/jacksonsweet/Projects/OPS/ops-web-polish`** — a git worktree on branch `feat/web-polish-batch` (off `main` @ `1ed24422`). Never touch `/Users/jacksonsweet/Projects/OPS/ops-web` (another session owns it).
- `node_modules` is a symlink to the primary checkout. `.env.local` is a **real copy** — safe to edit, never commit.
- Earlier plans may have already landed commits on this branch. `git log --oneline -15` before starting; build on what's there.

## Mandatory skills (load before touching code)

- `ops-design` — then read `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` and `/Users/jacksonsweet/Projects/OPS/ops-web-polish/.interface-design/system.md` end-to-end.
- `frontend-design:frontend-design` for any component work.
- `animation-studio:animation-architect` + `animation-studio:web-animations` for any motion work.
- `ops-copywriter:ops-copywriter` for any user-facing string.
- `custom-skills:audit-design-system` before declaring done — zero hardcoded color/spacing/radius/font values in code you produce or touch.

## Hard design rules (non-negotiable)

- Tokens only. Text ladder `text-text/-2/-3/-mute`; earth tones semantic only; accent `ops-accent` = primary CTA + focus ring ONLY.
- Radius: `rounded` (5px buttons/inputs), `rounded-chip` (4px), `rounded-panel` (10px), `rounded-modal` (12px). **No `rounded-full` pills except avatars. `rounded-btn` is a 0px no-op — never use it.**
- Numbers: `font-mono` + `"tnum" 1, "zero" 1`, ≥11px, always formatted, `—` for empty.
- Motion: one curve `EASE_SMOOTH` (`cubic-bezier(0.22,1,0.36,1)` / `[0.22,1,0.36,1]`), reduced-motion fallback (opacity 150ms) on EVERY animation. Variants live in `src/lib/utils/motion.ts` — reuse before creating.
- Copy: terse tactical. UPPERCASE authority / sentence-case content. No emoji, no exclamation points. All user-facing strings through `useDictionary` — **update BOTH `src/i18n/dictionaries/en/*.json` AND `es/*.json`.**
- Compact workbar tier: 28px controls / 22–24px segment tabs & chips (sanctioned; do not "fix" to 36px).
- Icons: `lucide-react` only (never `@carbon/icons-react` — not installed).

## Verification (every plan, before its final commit)

1. `npx tsc --noEmit` — must pass clean for files you touched (pre-existing unrelated errors: note them, don't fix, don't hide).
2. Targeted vitest: `npx vitest run <paths>` for any test you add/modify + existing tests covering touched modules. (CI lint is known-red and NOT a gate; do not chase `next lint`.)
3. **Live preview proof** — the app must be seen working:
   - `.env.local` already has (or add) `DEV_BYPASS_AUTH=true` and `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`.
   - Add a config to `/Users/jacksonsweet/Projects/OPS/.claude/launch.json`: `{"name":"web-polish","runtimeExecutable":"sh","runtimeArgs":["-c","cd /Users/jacksonsweet/Projects/OPS/ops-web-polish && exec npm run dev:webpack -- -p 3210"],"port":3210}` (reuse if present; `lsof -i :3210` first — if taken, pick a free port and update the entry).
   - `preview_start` → `preview_resize` to 1440×900 (desktop) → navigate → verify with `preview_snapshot` / `preview_inspect` / `preview_console_logs` → capture `preview_screenshot` evidence.
   - Screenshots go to `docs/artifacts/web-polish-2026-07-09/<plan-slug>/` — never the repo root. Commit them with the work.
   - Mapbox is empty locally — map areas render blank; verify map-adjacent work by code review, not pixels.
   - Radix dropdowns need `pointerdown`+`pointerup` PointerEvents in `preview_eval`, not synthetic `click`.
4. `preview_stop` when done; leave the launch.json entry for the next plan's agent.

## Commits

- Atomic conventional commits (`fix(scope): …`, `feat(scope): …`, `refactor(scope): …`) as each task lands. **Stage by name** (`git add <file> <file>`), never `-A`/`.`.
- **No AI attribution of any kind** in commit messages.
- **NEVER push. NEVER merge to main.** The branch stays local; Jackson decides integration.

## Report format (your final message)

Plain-English summary of what changed and why + list of commits + evidence paths + anything you could NOT verify and why. No hedging: failed/skipped items stated plainly.
