# Canpro cloud OPS OAuth verification

Local tested package; not released. Exact callback and three-scope registration are described in `docs/plans/2026-09-10-canpro-cloud-ops-oauth.md`.

## Evidence

- `unit-tests-focused.log`: 18 files / 718 tests passed, including 31 callback/ceiling tests, 30 userinfo tests through the real bearer and authority resolvers, and the exact Canpro authorization-code/refresh cases.
- `sql-regression.log`, `sql-canpro.log`: PostgreSQL 17, 104 existing OAuth assertions and 52 Canpro assertions passed. Migration replay preserves stored clients. Expired consent/code fixtures reject; exact redirects and PKCE challenge are preserved; code and refresh replay revoke minted grants/token families. Setup uses captured OAuth schema/functions, active v14 source migration and the new callback migration. Identity rows are minimal synthetic fixtures. No credentials or live rows were imported. Existing app/private table access boundaries are preserved.
- `principal-baseline.log`: the existing principal-boundary source allowlist test fails on four unrelated pre-existing service files on untouched production commit c44cf655e. Same failure on this candidate; no listed service was changed. The other five checks in that file pass.
- `verification.json`: concise machine-readable outcomes and exact function fingerprints.
- `tsconfig.json`: bounded typecheck includes all changed TypeScript files and the actual transitive dependency graph. It passed with Node 22 and a 6 GiB heap cap. Full repository typecheck first exhausted the default 4 GiB heap; it did not complete and is not claimed green.
- Changed-file ESLint, Prettier and `git diff --check` passed. No Next production build or signed-in cloud canary is claimed; integration owner must run release validation on the final source tree.

## Reproduce

Run from this worktree using the existing Node 22 runtime and dependency tree:

```sh
node node_modules/vitest/vitest.mjs run tests/unit/mcp/oauth-userinfo.test.ts src/lib/agent-control-plane/mcp/oauth/__tests__ src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts tests/unit/mcp/oauth-routes.test.ts tests/unit/mcp/oauth-consent.test.ts tests/unit/mcp/oauth-consent-protocol.test.ts src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts --maxWorkers=2 --minWorkers=1
node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit -p docs/artifacts/canpro-oauth/tsconfig.json
bash tests/sql/canpro-cloud-oauth-run.sh
```

The SQL runner creates a fresh random local PostgreSQL 17 cluster, disables TCP listening, and cleans up only its own directory. macOS shared-memory access may require sandbox escalation. It never accepts a production database URL. Its dependencies and all fixtures are committed source.

## Release gates

Reconcile against current production source and verify the registration definition still has baseline MD5 `96075ae7e99497c1119d2cf2f7721ce9` and owner/service-role-only ACL. The prepared definition's MD5 is `4944c9d30c3a0b8d2d1cda6899b6bf2b`. Obtain exact owner approval for OPS migration + matching web deployment, then separate fresh cloud registration/consent. The cloud client must request exactly `ops.company.read ops.jobs.read ops.purchasing.read`, verify bearer identity, own state/PKCE/issuer validation and serialized token rotation, and prove post-expiry refresh and Mac-independent execution. Business effects and messages remain outside this package.
