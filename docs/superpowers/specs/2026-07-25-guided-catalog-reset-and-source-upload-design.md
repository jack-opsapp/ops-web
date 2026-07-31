# Guided Catalog Reset and Source Upload — Design

**Date:** 2026-07-25
**Status:** Founder-approved
**Surface:** OPS Web `/catalog/setup`

## Outcome

Guided Catalog Setup starts from an honest, clean state, uses the shared tokenized form controls, accepts an optional CSV or Excel price sheet as Phase C evidence, and lets an authorized operator abandon a draft and start again without mutating the live catalog.

## Root causes

1. The progress label counts every structured fact, including `live_ops` observations that the operator never confirmed.
2. The guided text answer hand-rolls a textarea with the nonexistent `bg-glass-fill` class, allowing the browser's native white textarea background through.
3. The first-question help mentions an optional price sheet, but the only uploader lives behind the separate deterministic setup method and does not feed the Phase C interview.
4. An active guided session always resumes and has no visible abandon/restart action.

## Interaction

- The progress label counts confirmed facts whose source is `operator` or `upload`. Live snapshot observations remain available to Phase C but do not appear as operator-confirmed decisions.
- Text answers render through the shared `Textarea`; numeric answers render through the shared `Input`. Both inherit the OPS input surface, border, focus, placeholder, error, and disabled tokens.
- A neutral `UPLOAD PRICE SHEET` control is available during the interview. It accepts one `.csv`, `.xls`, or `.xlsx` file, reads the first worksheet, and submits structured headers and rows to the current Phase C turn.
- The upload is evidence, not a gate. The operator can continue typing instead.
- Upload validation is explicit: unsupported format, over 5 MB, empty sheet, or content beyond the guided-turn payload ceiling gets a direct corrective message and makes no server request.
- `START OVER` opens a destructive confirmation. Confirmation marks the active session `abandoned`, creates a new session from a fresh live snapshot, and returns to the first question. No catalog, task, tax, option, material, or inventory rows are deleted.

## Server contracts

- Add an authorized session-abandon route using the existing `catalog.view` and `catalog.run_setup` gates.
- Abandon uses an optimistic version match and accepts only active pre-completion states.
- The turn route accepts a validated `catalog_source_document` answer within its existing bounded JSON request. The agent prompt treats document rows as operator-provided evidence and cites upload provenance on extracted facts.
- Raw source rows remain in the session source journal for reviewability. No opening inventory quantities are inferred from a catalog price sheet.

## Verification

- Component tests prove the shared controls, truthful fact count, upload payload/error states, and confirmed restart flow.
- Service and route tests prove company scoping, optimistic versioning, abandonment, and no catalog writes.
- Agent/turn tests prove spreadsheet evidence reaches Phase C and stays optional.
- Focused Catalog tests, i18n parity, type-check, production build, visual browser verification, production deployment, and live Canpro readback complete the release.
