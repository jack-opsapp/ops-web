# OPS Capability Registry and Phase C Safety

## Outcome

Phase C can discuss only released OPS behavior and can propose only settings that
Guided Catalog Setup can validate, persist, and read back. Deck Designer is a
known OPS tool, but Phase C cannot present its calculations or inventory behavior
as configurable until an executable bridge exists.

## Architecture

- Add a code-owned OPS capability registry that records lifecycle, runtime
  evidence, operator-facing abilities, and Phase C access for every known tool.
- Project a bounded model view from that registry. Released tools may be known;
  only capabilities with `configure` access may own question intents or actions.
- Keep the current Guided Catalog compatibility API while making it a projection
  of the shared registry.
- Validate every action payload against a strict action-specific contract before
  semantic review. Unknown fields fail closed.
- Preserve the pinned registry revision on Guided Setup sessions so a review made
  against old capabilities cannot commit.

## Guided Setup corrections

- Pricing questions name only the missing facts instead of repeating price,
  unit, and minimum after some are confirmed.
- Per-product quote unit visibility is removed from available Phase C questions;
  OPS currently controls it at the document-template level.
- Product tax asks only whether the product is taxable and states that OPS uses
  the company default tax rate. Phase C does not promise a per-product GST/PST
  association it cannot save.
- Removing the newest queued answer restores the active question's helper and
  quick answers even though the session version advanced.

## Verification

- Observe each new regression test fail before implementation.
- Run focused capability, question-policy, semantic-validator, conversation, and
  Guided Catalog component tests.
- Run the complete catalog suite, type-check, lint, and production build.
- Update the OPS Software Bible from an isolated clean worktree so unrelated
  documentation changes remain untouched.
