# Guided Catalog remove + processing-state plan

## Outcome

Removing a queued answer ends its visible processing state immediately. Any obsolete Phase C request is ignored, and no empty follow-up turn is sent. While a real queued answer is being reviewed, the answer bubble itself carries a restrained agent-token scan with no visible loading copy.

## Implementation

1. Add a component regression that removes the only queued input while its turn is still active, then proves the stale turn cannot create an error or another request.
2. Treat the current queued input—not the generic busy flag—as the source of truth for the conversational processing signal.
3. Fence responses and failures from turns superseded by a newer session/input revision.
4. After input mutations, run Phase C only when at least one queued operator input remains.
5. Render a tokenized lavender analysis sweep inside the queued operator bubble; use transform/opacity only and a static tokenized state under reduced motion.

## Verification

- Guided Catalog Setup component tests.
- Complete catalog-related Vitest suite.
- Type-check and lint for the changed code path.
- Local browser readback of the loading treatment and remove state without changing live catalog data.
