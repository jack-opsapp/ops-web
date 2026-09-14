# Weekly journal: local end-to-end rehearsal (2026-09-10)

Plan Task 11. The whole weekly path ran against a disposable PostgreSQL 17 database with the real migrations: claim, OPS-owned source fetch, draft, independent editor, preview with hero plate, READY rail item, PUBLISH NOW, `blog_posts` row, LIVE rail item, Instagram discovery, and the stalled-writer alarm firing and clearing. Production was not touched.

## Stack

`stack/stack.mjs up <worktree> <fixtures.json>` builds database `ops_journal_e2e` with the cron-lease, social, Instagram and journal migrations, the production shapes of `blog_posts` / `blog_categories` / `blog_topics`, PostgREST on 3313, and a storage shim on 3312 that answers HEAD. It seeds the 10 live weekly posts and the backlog topics from production metadata. The worktree ran `npm run dev:webpack` on 3130 with only the rehearsal env (`stack/.state/env.local`, git-ignored). `stack/admin-act.ts` drives the Blog hub actions through `src/lib/journal/editorial/admin.ts`.

Rehearsal-only settings: `mode = 'prepare'`, and `draft_open_hours = 120` so Monday's slot opened on a Thursday.

## What happened (times Vancouver)

| Step | Evidence | Result |
|---|---|---|
| Hourly tick discovers the slot | `evidence/01-tick-discover.json` | `weekly:2026-09-14` created, queued |
| Unauthenticated claim | (curl) | 401, `cache-control: no-store` |
| Claim with the bearer token, 10:07 | `evidence/02-claim-response.json` | Brief, Parr guide and product facts bundled in the response; backlog and recent posts in context |
| OPS fetches six pages, 10:08 | `evidence/02b-sources-fetched-by-ops.json` | FTC home-improvement guide (redirect followed to its final URL), FTC Cooling-Off Rule and consumer page, 15 U.S.C. § 7001 (Cornell LII), California CSLB, Virginia DPOR. Each 200 in 3–6 s |
| Writer draft, pass 1 | `evidence/03a-candidate-pass1.json` | 1,318 words, 30 verbatim quotes |
| Independent editor, pass 1 | `evidence/04a-editor-pass1-rejected.json` | **Rejected, `unsupported_claim`**: the email and FAQ 6 said regulators treat a handshake as a warning sign, and the sources do not say that |
| Writer revision | `evidence/03b-candidate-final.json` | Claim rewritten to what the FTC and Virginia DPOR actually say |
| Fresh editor, pass 2 | `evidence/04b-editor-pass2-approved.json` | Approved; every quote and number checked against the OPS snapshots |
| Draft returned to OPS, 12:01 | `evidence/05-draft-response.json` | 200 `{"state":"drafted"}`; the deterministic policy passed with no 422 |
| Tick promotes | `evidence/06-tick-promote.json`, `evidence/12-hero-plate-2026-09-14.jpg` | Hero plate "SHAKE ON IT. THEN SIGN IT." rendered, stored at `blog/journal/2026-09-14-5b43083dbbad4aad.jpg`, public HEAD confirmed, scheduled for Mon Sep 14 06:00. Rail: **JOURNAL POST READY**, "A HANDSHAKE IS NOT A CONTRACT is ready. It waits for your go." (persistent, PREVIEW → `/admin/blog?journal=<id>`) |
| Blog hub data | `evidence/07-blog-hub-panel-data.json` | What the WEEKLY POST panel reads: scheduled, preview image, launch time |
| PUBLISH NOW, 12:03 | `evidence/08-publish-now.json` | 200 `{"state":"published","blog_id":"80398164-…"}`. Pressed again: same `blog_id`, no second post |
| `blog_posts` row | `evidence/11-published-article.html` | `is_live = true`, `source = 'weekly'`, author `OPS Team`, 1,326 words, 8 FAQs, email version, thumbnail = the plate. HTML uses only the allowlisted tags; 10 internal links to live posts and industry pages; OPS-rendered Sources section with 5 cited pages; closing blockquote. The backlog topic is marked used |
| Next tick | `evidence/09-tick-live-rail.json` | Rail: **JOURNAL POST LIVE**; the READY item resolved |
| Instagram editorial cron, 12:03 | `evidence/10-instagram-discovery.json` | `blog:80398164-1d0e-4f50-beb6-cf9a4adb666a` queued. The plate URL is under `blog/journal/`, so Instagram adapts it as imageless |
| Stalled-writer alarm, 12:05 | (psql, below) | See the next section |

### Stalled-writer alarm

The slot was moved to Friday 00:00 so a writerless slot sat inside the 12-hour window. Then:

1. The tick created `weekly:2026-09-11` and raised **JOURNAL WRITER STALLED**, "Monday's post has no draft yet. Check the OPS Journal routine at claude.ai." The item is persistent, keyed `journal:writer-stalled:2026-09-10`.
2. A second tick added nothing (once per day).
3. STOP (`admin-act.ts stop`) cancelled the slot as `admin:rehearsal-operator@opsapp.co`.
4. The next tick resolved the alarm (`is_read`, `resolved_at`). A cancelled slot adds no rail item of its own.

Settings were then restored to Monday 06:00.

## Deviations from the cloud run, and why

- **Local writer instead of the cloud routine.** A Claude Code subagent followed the routine prompt (`docs/journal/cloud-authoring-routine.md` v1) with local overrides: base URL `http://127.0.0.1:3130`, the rehearsal token, a scratch run directory, and no WebFetch. The cloud run is proven separately at release step 6.
- **Lease extended by 120 minutes.** The first local writer froze in a model stream after fetching its sources. OPS itself answered every call. The claim lease was extended in the disposable database so a continuation could finish on the same claim. Production never does this; an expired lease there returns the slot to the queue with the attempt spent.
- **Second editor pass and the draft POST ran from the orchestrating session.** The continuation writer's editor subagent froze the same way after its last tool call. A fresh editor subagent got the routine's exact step-6 instruction and inputs (it was told not to read pass 1). The draft was POSTed with the routine's exact step-8 body.
- **PUBLISH NOW without Firebase.** The admin routes verify a Firebase ID token. The disposable stack holds no production credentials by design, so `admin-act.ts` called `actOnJournalAssignment` directly. The route's gate is covered by `tests/unit/journal/editorial/admin-routes.test.ts`, and the Blog hub panel is covered by `weekly-post-panel.test.tsx`. A screenshot of the live panel belongs to the production proof.
- **Editor note left unaddressed.** Pass 2 approved, and suggested adding the Cooling-Off Rule's repair-visit exclusion. That is an omission, not an unsupported claim, and this article never reaches production.

## Gates run alongside

- Unit: `tests/unit/journal/editorial/` 9 files, 115 tests pass. Full vitest: every failing file also fails on a clean `origin/main` worktree; the branch adds none.
- SQL contract harness `tests/sql/journal-editorial-runtime.mjs`: PASS.
- `npm run type-check`: only the 3 pre-existing MCP catalog test errors on main.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run build`: exit 0. The four `/api/internal/journal/editorial/*` route traces carry `ops-journal-brief.md`, `blog-voice-sam-parr.md` and `ops-product-facts.md`; `/api/cron/journal-editorial` carries CakeMono-Light, Mohave-Regular and JetBrainsMono-Regular.
