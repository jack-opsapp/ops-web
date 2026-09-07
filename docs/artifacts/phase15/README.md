# Phase 15 local verification — 2026-09-07

## Outcome

Private estimate/change-order preparation and exact OPS approval are implemented locally. No production migration, push/deployment, company pricing policy, OAuth client/grant, financial exposure activation or real-document canary was performed by this task. Active v20/v14/v9 remains unchanged.

- **368 application tests passed across 42 files**: final MCP transport/runtime/catalogue/consent, exact financial contracts/service/repository/approval, customer portal and Sage custody, and inert preview rendering. `vitest-final.log`.
- **78 PostgreSQL assertions passed**: 75 canonical/negative/inspection/RLS/rate-limit assertions in `runtime-tests.log`, plus three actual independent-session concurrent-save/replay/numbering assertions in `concurrency-*.log`. `sql-summary.log` combines them. Fictional data only; disposable PostgreSQL 17 on a private Unix socket.
- **Full TypeScript check passed** with `--noEmit --incremental false` and an 8GB Node heap. Empty `typecheck-final.log`, process exit 0. The first default-heap attempt ran out of memory; the bounded larger-heap check passed.
- **Next production build passed** compilation, type checking, static generation and tracing using inert `.invalid` Supabase placeholders, no production secrets. `production-build.log`. Existing warnings: twitter-image runtime re-export, libheif dynamic require, async_hooks client import warning and old Browserslist data. Build-time email database synchronization was not invoked; no email source changed.
- **Visual proof:** the real React financial preview was rendered with a typed fictional fixture, real Tailwind tokens and local OPS fonts. Desktop and 390px phone browser inspection confirmed full content and no horizontal overflow: viewport 390, document/content 384 (scrollbar excluded). Source content was inert text. The approval desk's existing save controls are reused. This is component proof, not signed-in production acceptance. `render-preview.cjs` and `preview-server.cjs` reproduce the harness; generated bundles/CSS/HTML are disposable.
- **Independent review** found and fixed subtotal tax rounding, ambiguous currencies, SQL null/type acceptance, complete persisted receipt parity, inspect source tombstones, browser permission loss and an ambiguous SQL identifier. Follow-up tests pass; no outstanding concrete issue remained in that bounded review.

## Database and authority boundaries

The fixture reproduces live financial columns/generated totals, accounting enqueue producer, canonical actor resolver, durable limiter hash/prune functions and audit identity schema. It omits unrelated foreign keys, audit/read-cache triggers and provider infrastructure; it is not a production clone or live provider test. Production effect policy conservatively fingerprints all public/private stored functions and application triggers, including transitive helpers, so definition changes fail closed until separately reviewed. Current NOWAIT table fences may return busy on unrelated concurrent writes. This is explicit fail-closed behavior, not a contention-free performance claim.

The new columns and functions must be migrated before release of the application queries. Migration is additive, creates no business policy or document, and has 3-second lock / 120-second statement timeouts. Its private tables have forced RLS and no direct browser/service-role table grants. Public entry points are service-only; named-actor browser visibility helpers are separately bounded. Newly created held headers and lines require the exact private approval transaction token. No hold-release capability is included.

Pending migration: `supabase/migrations/20260907062351_financial_document_private_drafts.sql`.
SHA-256: `17d5cc51d665548c652784e37dba3d9fe756672ea08d46fdc85612287e3519ee`.

Fresh production read-only preflight at 07:08 UTC found the six new columns absent, financial ledger absent, v17 client/grant counts zero and estimate/line RLS enabled. No production mutation was used as a test. Local database source hashing is pinned to UTC, including pooled-connection timezone differences. Financial consent v12 and company policy enrollment are absent. Real source currency/policy gaps block instead of assuming Canpro prices.

## Reproduce

Use bundled Node 24.19.0 and existing project node_modules; PostgreSQL 17 at `/opt/homebrew/opt/postgresql@17/bin`. `bash tests/sql/financial-document-run.sh` initializes/removes its own cluster and runs real concurrent sessions. It needs macOS shared-memory permission only. Run the paths listed in `vitest-final.log` with Vitest. Build uses `NEXT_PUBLIC_SUPABASE_URL=https://phase15-build.invalid`, inert anon/service key placeholders and `NODE_OPTIONS=--max-old-space-size=8192`.

No new paid service or subscription was added. A separately activated workflow would use existing database compute/storage for its bounded proposal/receipt records.
