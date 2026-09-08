# Local rehearsal — subscription-funded Instagram authoring (2026-09-07)

Everything here ran on the Mac against a **disposable** stack, never against production: a throwaway PostgreSQL 17 database with the real migrations (`cron_workload_controls`, `create_social_publishing`, `create_instagram_connection`, `create_social_editorial`, `create_social_editorial_assignments`) behind PostgREST and a storage shim (`stack/`), the worktree dev server on port 3120, four real public articles as `blog_posts` fixtures, and the exact routine prompt from `docs/social/cloud-authoring-routine.md` driven by a local Claude session with an independent editor subagent. No model API key was involved anywhere; the session drew the operator's subscription. Nothing was published; the rehearsal database has no Instagram connection.

## What was proven

| Step | Evidence | Result |
|---|---|---|
| Discovery under the durable lease | cron tick response `{"state":"discovered","discovered":4}` | four `blog:` assignments, one per fixture article, zero duplicates on repeat |
| Routine claim → write → independent edit → hand back | `fable/claim-response.json` (guide SHA-256 `33eb69c7…`, source, brief, limits), `fable/candidate.json`, `fable/editor.json` (approved, all eight checks true), `fable/draft-response.json` | `AUTHORED blog:e0d5ff01…` in 3 HTTP calls, no rendering or queue activity from the draft endpoint |
| Held preview (prepare mode) | `fable/slide-01.jpg … slide-07.jpg` (+`@390` phone-size copies) rendered by the cron tick through the storage shim; `INSTAGRAM DRAFT READY` notification | cover = image + hook + article title + date; slides 2–6 = `TAKEAWAY 01…05` with bodies; slide 7 = `KEEP READING` + `opsapp.co/journal/claude-fable-5-1-first-test-gpt-5-7-astra` |
| Publish mode handoff | `fable/publish-mode-proof.json` | assignment `submitted`; one `social_posts` row in `review`, key `cloud-editorial-v2:blog:…`, `editorial_cover`, 7 rendered assets, `publish_after` = now + 11 min inside the Vancouver window; database guard allowed the v2 key; notification `INSTAGRAM POST QUEUED · BFBF37E7 — Publishes Sep 06 · 19:36 unless stopped.` |
| Re-notification safety | second tick after re-preparing the same draft | `200`, one acknowledgement, no duplicate alert (this exposed a real bug during the rehearsal; fixed in `5bb9b9268`) |
| Treatment selection | first pass rendered `split_signal` because the 54-character title exceeded a stale cap and the cover never named the article | fixed in `0af4a17ed`: blog packages always take `editorial_cover`; re-rendered slides in this folder are from the fixed code |
| Recurring source exclusion | first protocol claim returned `NO_FRESH_SOURCE` because blocked blog assignments still burned their articles | fixed in `4a2e059d6`: only non-blocked assignments exclude a source |

## The Fable draft (what the routine wrote)

Title: *Claude Fable 5.1 still only sees the job file you keep*. Hook: *Most expensive mistakes start when two ordinary facts never meet.* Five takeaways: the win is the connection; more context is not more proof; the price did not drop, the reread did; it only sees the file you keep; a person owns the approval. Twelve verbatim evidence quotes, every claim verified independently by the editor subagent. Compare with the confusing 2026-09-05 draft in `../manual-run-2026-09-05/`: that one stripped the model context and rendered five identical covers; this one names the subject on the cover and explains each takeaway on its own slide.

## Reproduce

```bash
LC_ALL=C /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/ops-editorial-pg/data -l /private/tmp/ops-editorial-pg/server.log -o "-p 55439 -k /private/tmp/ops-editorial-pg/socket -c listen_addresses=''" start
node stack/fetch-fixtures.mjs stack/blog-fixtures.json          # public articles only; reads the primary checkout's env, prints no secrets
node stack/stack.mjs up <worktree> <worktree>/supabase/migrations
# copy .state/env.local to <worktree>/.env.local, then: npm run dev -- -p 3120
```

`brew install postgrest` is required once. `stack.mjs down` drops the database and stops both processes.

## Not proven here

The Anthropic agent-proxy credential injection (needs the real cloud environment), the production S3 or Supabase upload from Vercel, the Meta publish call, and the scheduled routine firing without the Mac. Those are the production proofs listed in `docs/social/cloud-editorial-operations.md`.

## The protocol draft (second rehearsal)

`protocol/`: the Tuesday `protocol:2026-09-08` assignment. OPS chose the freshest unused article (the Cape Breton flood emergency dispatch, published 2026-09-06). The routine's first draft was **rejected by the editor subagent** (`editor-v1.json`, reason `off_subject`: the slides never named the news event), the routine revised once (`candidate.json`), the second editor pass approved, and the draft was handed back in two HTTP calls. The cron tick rendered it as a five-step `signal_grid` protocol (`slide-01.jpg … slide-05.jpg`, phone-size copies for slides 1, 3, 5). This is the writer → independent editor → revise → accept loop working end to end on subscription usage.
