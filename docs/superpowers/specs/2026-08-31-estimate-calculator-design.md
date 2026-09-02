# Estimate calculator — design

**Origin:** feature request `be25c30e` (Jackson, 2026-05-01, from the Estimates screen): "Add a calculator tool in the estimate window."
**Surface:** the shared line-item editor (`src/components/ops/line-item-editor.tsx`) — which serves both estimate windows (Books → Estimates dialog; FAB/pipeline floating window) *and* the invoice modal. Building it there once serves all three.
**Recon:** `/Users/jacksonsweet/Projects/OPS/docs/artifacts/estimate-calculator/recon.md` (read-only map, 2026-08-31).

## The human situation

Mid-quote, the owner needs a number that isn't in front of them — a deck is 12 by 16 so how many square feet, three runs of railing at 14, 9 and 22, a price in feet when the supplier quotes in metres. Today that means the phone calculator and retyping. The tool lives inside the estimate, does the math trades actually do, and puts the answer straight into the field being edited.

## Approaches considered

1. **A calculator popover anchored to the editor's action row, inserting into the last-focused numeric field (chosen).** One stable anchor (never clipped by the scrolling window), one insertion rule, works identically in all three windows.
2. **Inline calculator per row** (a glyph beside each quantity/price input). Rejected: row-anchored panels are clipped by the window's `overflow-hidden` shell and scroll away; three glyphs per row is noise.
3. **Expression-aware inputs** (type `12*16` into Quantity and it evaluates on blur). Tempting and partially worth keeping — but the inputs commit on every keystroke through `parseFloat || 0`, so partial expressions would snap to 0/1 mid-typing; and it gives no home for area/linear/convert. Rejected as the primary mechanism.

## Behavior

- A ghost chip **`[ CALC ]`** sits in the editor's action row beside "Add Line Item" (text label, no glyph — the lucide calculator glyph already means *estimate* in this app). It opens a popover (Radix, portaled, `contentClassName="z-modal"` per the entity-picker precedent, so it renders above both the floating window and the dialog).
- **Insertion target = the last numeric field focused** (quantity or unit price of a specific line). The editor records it on focus. The popover's primary action reads **`INSERT → QTY · LINE 3`** / **`INSERT → PRICE · LINE 3`**; with no target yet it is disabled and reads `[ FOCUS A QTY OR PRICE FIELD ]`. Insert writes one finished number (2-decimal rounding, half-up) through the editor's `updateItem` — never a DOM write, never a partial value — closes the popover, and returns focus to that field.
- **Four modes** as chips across the top: **CALC** · **AREA** · **LINEAR** · **CONVERT**.
  - **CALC** — an expression field (type `12*4.5+120`, thousands separators tolerated) with a live result and a compact keypad for touch. `+ − × ÷ ( ) %`, decimals, unary minus. Evaluated by a safe parser — no `eval`, ever. Division by zero and malformed input show an inline error state and disable insert.
  - **AREA** — length × width with a unit (ft, in, m, cm), optional count of identical areas, optional waste %. Result in sq ft (toggle m²).
  - **LINEAR** — a list of lengths (add / remove rows), same units, optional waste %. Result in linear ft (toggle m).
  - **CONVERT** — from/to within one dimension: length (in, ft, yd, cm, m), area (sq ft, sq yd, sq m), volume (cu ft, cu yd, m³).
- **Shown work.** For AREA and LINEAR results, a toggle **`[ ADD MATH TO DESCRIPTION ]`** (default on) appends the working to the line item's description on insert — e.g. `12 ft × 16 ft = 192 sq ft` / `14 + 9 + 22 ft = 45 lin ft (+10% waste = 49.5)` — so the customer sees the dimensions and the crew sees the count. Only if the line-item model exposes a description/notes field in the editor; the builder verifies (the row model has more fields than the visible two) — if none is exposed, the toggle is omitted and noted.
- The calculator writes only what the editor shows. It does **not** set a line's unit (`unit`/`unitId` have no UI in the editor today); that is a separate editor change and is out of scope here.
- Keyboard: type straight into the expression field; **Enter** evaluates; **⌘/Ctrl+Enter** inserts; **Esc** closes. Mode chips are radios (arrow keys). Everything labelled for screen readers.
- Permissions: inherits the editor's — the chip appears wherever the editor appears; the estimate/invoice surfaces are already gated behind the `accounting` feature.

## Design system

Tokens only (DESIGN.md). Popover panel: dense glass, hairline border, radius modal (12), width 296px, left-aligned everything. Mode chips and the CALC chip: the editor's existing mono-micro chip language (`rounded-chip`, hairline border, `--text-mute` → `--text` active). Result: JetBrains Mono, tabular, slashed zero, 20px, formatted (`192`, `1,240.50`); errors in `--rose`. Keypad keys: 36px (`h-9` — note the project's spacing scale is doubled: `h-8` is **64px**), radius 5 (`rounded`), mono labels. Primary INSERT action: outlined accent at rest → filled on hover (the design system's primary-button rule; the one accent element in the popover). Motion: the Popover primitive's existing enter/exit (150ms, one curve), reduced-motion respected. No box-shadows.

## Copy (product register)

`CALC` · modes `CALC / AREA / LINEAR / CONVERT` · `INSERT → QTY · LINE {n}` · `INSERT → PRICE · LINE {n}` · `[ FOCUS A QTY OR PRICE FIELD ]` · `[ ADD MATH TO DESCRIPTION ]` · `WASTE %` · `COUNT` · `LENGTH` · `WIDTH` · error `[ CHECK THE EXPRESSION ]` / `[ CANNOT DIVIDE BY ZERO ]`. English + Spanish in a new `estimate-calculator` dictionary namespace. (The editor itself is un-internationalised today — out of scope; noted as a follow-up.)

## Out of scope

Retro-fitting i18n to the rest of the line-item editor; a unit control on line items; expression-aware inputs; persisting calculator history.
