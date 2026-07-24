# External API Post-Merge Test Baseline

**Recorded:** 2026-07-24
**Branch:** `feat/lead-intake-api`
**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/lead-intake-api`
**Accepted baseline commit:** `b4fe78042e629b461c5d8d38f6f82083c1101b23`
**Merged `origin/main`:** `998211dfa910a2ff7a16462b68fd191f8974b4a2`
**Status:** accepted known-red comparison baseline for Tasks 1–19

## Merge evidence

The prepared worktree was clean at the recorded planning base
`5f066c5aff0d8c5960f8418213756037e963d731`. `origin/main` was fetched and
merged without a conflict. The merge commit has parents
`5f066c5aff0d8c5960f8418213756037e963d731` and
`998211dfa910a2ff7a16462b68fd191f8974b4a2`. The committed design
(`92775580`) and plan remain in history.

The four merged upstream commits are:

1. `998211df fix(build): isolate unchanged email template sync`
2. `fd6de6a1 chore(deploy): retry lifecycle release after provider recovery`
3. `5b4868d7 fix(email): refresh trusted lead summaries safely`
4. `cdb494f6 fix(email): harden commercial lifecycle evidence`

## Runtime and command

The required command was run twice, unchanged:

```bash
npm test -- --run
```

The bundled runtime was prepended to `PATH`:

```text
/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
```

That runtime is Node `v24.14.0`. The bundle does not include an `npm`
executable, so the official npm `11.6.2` CLI was downloaded into a temporary
directory under `/private/tmp` and invoked with the bundled Node binary. No
dependency or repository file changed.

The repository declares Node `22.x`; the connected Vercel project reports Node
`24.x`. Both satisfy Supabase's current Node 22-or-later requirement. The CI
workflow still selects Node 20, whose Supabase client support ended
2026-06-30. That is a separate implementation-readiness gap; Task 0 did not
change CI.

## Accepted full-suite result

The second unchanged full run is the comparison baseline:

```text
Test Files  4 failed | 951 passed | 1 skipped (956)
Tests       12 failed | 9068 passed | 5 skipped (9085)
Duration    82.42s
Exit code   1
```

This is the same four-file, 12-test known-red shape recorded before the merge.
The passing-test count increased from 8,680 to 9,068 because the merged upstream
history added tests; it did not introduce a deterministic new failure.

## Exact accepted failures

### `tests/integration/uploads-presign.test.ts` — eight failures

All eight requests returned `403` before the asserted content-type or extension
result:

| Test | Error |
|---|---|
| `content-type validation > allows image/jpeg for an arbitrary image folder` | `AssertionError: expected 403 to be 200` |
| `content-type validation > allows application/json for the training_data/ folder prefix` | `AssertionError: expected 403 to be 200` |
| `content-type validation > rejects application/json when folder is NOT training_data/` | `AssertionError: expected 403 to be 400` |
| `content-type validation > rejects image/gif everywhere (not on the allowlist)` | `AssertionError: expected 403 to be 400` |
| `content-type validation > rejects application/javascript even when path is training_data/` | `AssertionError: expected 403 to be 400` |
| `file extension inference > preserves the original extension when present` | `AssertionError: expected 403 to be 200` |
| `file extension inference > falls back to .json when filename has no extension and type is JSON` | `AssertionError: expected 403 to be 200` |
| `file extension inference > falls back to .jpg when filename has no extension and type is image` | `AssertionError: expected 403 to be 200` |

### `tests/unit/email/email-opportunity-title-live-pattern.test.ts` — one failure

Test:

```text
SyncEngine live email opportunity title pattern
> labels sent-folder safety-net leads from the external recipient when the
  operator uses a Gmail mailbox
```

Error:

```text
AssertionError: expected [ Array(1) ] to deeply equal []
Received:
["[sync-engine] atomic company mailbox opportunity returned no result"]
```

### `tests/unit/email/sync-engine-ai-provider-isolation.test.ts` — one failure

Test:

```text
sync-engine AI-provider isolation — Step 5
> defers durably on a provider outage and counts the deferral
```

Error:

```text
AssertionError: expected the source slice to contain
"markUnmatchedThreadsPendingLeadScan(unmatchedContexts, connection);"
```

The call exists, but current formatting spans multiple lines. This is a brittle
source-text assertion, not absent runtime behavior.

### `tests/unit/i18n/inbox-parity.test.ts` — two failures

| Test | Error |
|---|---|
| `es mirrors en exactly — no missing or extra keys` | Spanish is missing `toast.archivePartialTactic` and `toast.restorePartialTactic`. |
| `interpolation tokens are identical between en and es for every key` | `TypeError: Cannot read properties of undefined (reading 'match')`, downstream of the missing Spanish keys. |

## Transient first-run investigation

The first full run ended after `384.60s` with six failed files, 949 passed files,
one skipped file, 13 failed tests, 9,059 passed tests, and five skipped tests.
It contained the accepted failures above plus two timeout-shaped failures:

- `src/lib/inbox/__tests__/opp-display.test.ts` failed before collecting a test:
  `Error: [vitest-worker]: Timeout calling "fetch" with
  "["/tests/mocks/data.ts","web"]"`.
- `tests/unit/hooks/use-client-projects.test.tsx > useClientProjects > returns
  the project list when the query resolves` failed with
  `Error: Test timed out in 5000ms`.

A focused unchanged rerun passed both files:

```text
Test Files  2 passed (2)
Tests       11 passed (11)
Duration    709ms
```

The second full run then returned exactly to the historical four-file,
12-test known-red set. The two timeout failures are therefore recorded as
full-suite worker/resource flakes, not accepted product failures.

## Comparison rule

Every later task must compare its full-suite result to commit
`b4fe78042e629b461c5d8d38f6f82083c1101b23` and the exact accepted result above.

- A new failed file or test is a regression until proved otherwise.
- A change in any accepted failure's error shape requires investigation.
- A worker timeout must pass in a focused unchanged rerun and disappear in a
  second full run before it can be classified as transient.
- The older pre-plan 8,680-pass count and four-file list are historical context
  only and must not be used as the implementation baseline.
