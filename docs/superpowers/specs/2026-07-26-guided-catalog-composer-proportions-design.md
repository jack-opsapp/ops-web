# Guided Catalog Composer Proportions

## Outcome

Guided Catalog Setup uses the visual hierarchy of a conversation, not a standalone form. The transcript remains dominant. Composer actions are quiet utilities that support answering and attaching evidence without competing with the assistant question.

## Approved control treatment

- The answer field remains the primary composer surface.
- Continue becomes a square, icon-only send action inside the field. It retains the existing localized accessible name and keyboard behavior.
- Price-sheet upload becomes a ghost attachment action with a lightweight Lucide attachment glyph. It keeps its current localized label and file-input behavior.
- Both controls use existing OPS color, spacing, radius, type, focus, and motion tokens. No new visual tokens or copy are introduced.
- The upload action must not use a dense document/spreadsheet glyph or a full perimeter border.

## Enforced proportions

- The send control is square and no larger than the OPS desktop dense-control tier.
- The send control may not reserve more horizontal composer space than its square target plus the standard internal gap.
- The attachment glyph remains at the 16px icon tier.
- The first-turn browser test verifies computed bounding boxes, border treatment, and control-to-composer ratios at every required viewport.

## Permanent design-system contract

The active OPS Web interface system gains a Composer Actions pattern. Generic primary/default/secondary button patterns are forbidden inside chat composers. Composer actions must be ghost utilities, with one square icon-only send action and quiet attachment controls.

## Accessibility

- Icon-only send retains a localized `aria-label`.
- Focus remains visible with the OPS accent focus treatment.
- Disabled state remains perceivable and non-interactive.
- Enter submits and Shift+Enter inserts a newline.
- No new motion is introduced; reduced-motion behavior is unchanged.

## Scope

This changes only Guided Catalog Setup presentation, its regression coverage, and the active design guidance. Phase C prompts, session data, company knowledge, catalog generation, database behavior, and live data remain untouched.
