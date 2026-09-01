# Estimate Calculator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Before the UI tasks load `ops-design` (read `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` first), `frontend-design:frontend-design`, `custom-skills:interface-design`; before writing any string load `ops-copywriter:ops-copywriter`; run `custom-skills:audit-design-system` before declaring Tasks 4–6 done. Use `superpowers:test-driven-development` throughout. Motion is the Popover primitive's own — do not add animation.

**Goal:** A calculator inside the line-item editor (estimates and invoices) that does arithmetic, area, linear-length and unit conversion, and inserts the finished number into the quantity or unit-price field the operator last focused.

**Architecture:** Pure math modules (safe expression evaluator; measurement/conversion math) with exhaustive unit tests; a popover component anchored to the editor's action row (`contentClassName="z-modal"` so it clears floating windows and dialogs); the editor records the last-focused numeric field and exposes `updateItem` to the popover for insertion.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind (OPS tokens), Radix Popover via `src/components/ui/popover.tsx`, Vitest + Testing Library.

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`. Spec: `docs/superpowers/specs/2026-08-31-estimate-calculator-design.md`. Recon: `/Users/jacksonsweet/Projects/OPS/docs/artifacts/estimate-calculator/recon.md`.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`.

**Checkout:** `/Users/jacksonsweet/Projects/OPS/ops-web-estimate-calculator`, branch `feat/estimate-calculator` (cut from origin/main 7bafb2f9). Own `node_modules` (npm ci running at plan time — wait for `node_modules/.bin/vitest` to exist before the first test run). Single executor, tasks in order. Single-file `npx vitest run <file>` only; no builds, no dev servers (PM builds and verifies live).

---

## Ground truth (verified by the planner — read these files before Task 1)

- `src/components/ops/line-item-editor.tsx` (570 lines): `LineItemRow` interface at ~27; `LineItemEditor` at ~176; `updateItem(id, field, value)` at ~186 (`useCallback`); `addItem` at ~205; quantity input ~385-392 and unit-price input ~395-402 — both shared `Input type="number" min={0} step={0.01}` committing on every keystroke via `parseFloat(e.target.value) || 0` (so the calculator must write a finished number through `updateItem`, never a DOM write); expandable row details keyed by `expandedIds` at ~292 (check what fields the expanded panel exposes — description/notes?); "Add Line Item" button at ~531-539. Plain `useState` — no react-hook-form.
- `src/components/ui/popover.tsx` — the Radix Popover wrapper; `src/components/ui/entity-picker.tsx:66-78` documents the sanctioned `contentClassName="z-modal"` z-layer override for triggers inside floating windows (windows z 2000+, dialogs 3000, default popover `z-dropdown` 1000).
- Both estimate windows and the invoice modal render `LineItemEditor` (recon §1) — one integration point serves all three.
- Tailwind spacing scale is doubled in this project: `h-8` = **64px**. Use `h-9` (36px) for controls, `h-[28px]` for the compact tier. `Button size="sm"` is 64px tall — do not use it for keypad keys.
- lucide `Calculator` is the *estimate* icon in three places — the trigger is a text chip `CALC`, no glyph.
- i18n: one JSON per namespace in `src/i18n/dictionaries/{en,es}/`; access via `useDictionary("<namespace>")`. New namespace: `estimate-calculator`.
- No existing general geometry/measurement math in `src/` (the deck AR calculator is a different, version-pinned engine — do not touch it).

---

### Task 1: Safe expression evaluator (TDD)

**Files:**
- Create: `src/lib/utils/estimate-calc/expression.ts`
- Test: `src/lib/utils/estimate-calc/__tests__/expression.test.ts`

**Step 1: Failing tests** for `evaluateExpression(input: string): { ok: true; value: number } | { ok: false; error: "empty" | "malformed" | "divide_by_zero" }`:
- precedence: `"2+3*4"` → 14; `"(2+3)*4"` → 20; `"10/4"` → 2.5; `"2*3^2"` — no exponent support: `^` is malformed (keep the grammar to `+ - * / ( ) %`; accept `×` and `÷` glyphs as aliases, and `x` between digits as multiply)
- unary minus: `"-5+2"` → -3; `"3*-2"` → -6
- percent: `"200*10%"` → 20 (postfix `%` divides the preceding number by 100)
- thousands separators and spaces: `" 1,200 + 300 "` → 1500
- decimals and float hygiene: `"0.1+0.2"` → value that `formatResult` renders as `0.3` (evaluator returns raw; formatting rounds — test both)
- errors: `""` → empty; `"2+"`, `"(2+3"`, `"2++3"`, `"abc"` → malformed; `"5/0"` → divide_by_zero
- no `eval`/`Function` anywhere (test: `expect(expression.toString()).not.toMatch(/eval|new Function/)` on the module source read via `fs`).

Also `formatResult(value: number, maxDecimals = 2): string` — half-up rounding, thousands grouping, never scientific notation, `-0` → `0`.

**Step 2: Run → FAIL** (`npx vitest run src/lib/utils/estimate-calc/__tests__/expression.test.ts`). **Step 3: Implement** — tokenizer + shunting-yard to RPN + fold; integers/decimals only; reject anything else. **Step 4: Run → PASS.**

**Step 5: Commit**
```bash
git add src/lib/utils/estimate-calc/expression.ts src/lib/utils/estimate-calc/__tests__/expression.test.ts
git commit -m "feat(estimates): safe arithmetic evaluator for the line-item calculator (be25c30e)"
```

---

### Task 2: Measurement + conversion math (TDD)

**Files:**
- Create: `src/lib/utils/estimate-calc/measure.ts`
- Test: `src/lib/utils/estimate-calc/__tests__/measure.test.ts`

**Step 1: Failing tests:**
- `computeArea({ length, width, unit, count = 1, wastePercent = 0, output: "sqft" | "sqm" })` → `{ value, working }`: 12 ft × 16 ft → 192 sq ft; 12 ft × 16 ft × 2 → 384; +10% waste → 211.2; 3 m × 4 m → 12 sq m, and → 129.17 sq ft; inches: 144 in × 24 in → 24 sq ft. `working` is the display string `12 ft × 16 ft = 192 sq ft` (with `× 2` and `(+10% waste = 211.2)` variants — exact strings asserted).
- `computeLinear({ lengths: number[], unit, wastePercent, output: "ft" | "m" })`: [14, 9, 22] ft → 45; +10% → 49.5; working `14 + 9 + 22 ft = 45 lin ft (+10% waste = 49.5)`; empty list → 0; negative or NaN entries ignored (test) — no, rejected: return `{ ok:false }`? Keep simple: entries are validated by the UI; the function throws on NaN (test it throws).
- `convert(value, from, to)` within dimension groups: length in/ft/yd/cm/m (`12 in → 1 ft`, `1 m → 3.28 ft`), area sqft/sqyd/sqm, volume cuft/cuyd/m3; cross-dimension → throws; identity → same.
- `UNIT_GROUPS` constant enumerates the three groups in display order.

**Step 2: Run → FAIL. Step 3: Implement (all conversion factors as named constants with the exact figures: 1 ft = 0.3048 m; 1 in = 0.0254 m; 1 yd = 0.9144 m; areas/volumes derived). Step 4: Run → PASS.**

**Step 5: Commit**
```bash
git add src/lib/utils/estimate-calc/measure.ts src/lib/utils/estimate-calc/__tests__/measure.test.ts
git commit -m "feat(estimates): area, linear and unit-conversion math for the calculator (be25c30e)"
```

---

### Task 3: Dictionary namespace

**Skills:** `ops-copywriter:ops-copywriter`.

**Files:**
- Create: `src/i18n/dictionaries/en/estimate-calculator.json`, `src/i18n/dictionaries/es/estimate-calculator.json`
- Check: how namespaces are registered (grep `useDictionary` loader / dictionary index — if there is a registry file, add the namespace there too).

Keys (flat or nested — match the convention of a recent small namespace such as `picker.json`): `trigger` ("CALC"), `mode.calc/area/linear/convert`, `insert.qty` ("INSERT → QTY · LINE {n}"), `insert.price`, `insert.noTarget` ("[ FOCUS A QTY OR PRICE FIELD ]"), `addMath` ("[ ADD MATH TO DESCRIPTION ]"), `field.length/width/count/waste/from/to/lengths/addLength/removeLength/expression`, `unit.*` (ft, in, m, cm, yd, sqft, sqyd, sqm, cuft, cuyd, m3 — display forms `ft`, `in`, `m`, `cm`, `yd`, `sq ft`, `sq yd`, `sq m`, `cu ft`, `cu yd`, `m³`), `result.label` ("// RESULT"), `error.malformed` ("[ CHECK THE EXPRESSION ]"), `error.divideByZero` ("[ CANNOT DIVIDE BY ZERO ]"), `error.empty`, `keypad.clear/backspace/equals`, `dialogLabel` ("Estimate calculator"). Spanish in the file's existing register (terse, sentence case content, uppercase authority).

**Commit**
```bash
git add src/i18n/dictionaries/en/estimate-calculator.json src/i18n/dictionaries/es/estimate-calculator.json <registry file if any>
git commit -m "feat(estimates): calculator copy in english and spanish (be25c30e)"
```

---

### Task 4: The popover component (TDD)

**Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`.

**Files:**
- Create: `src/components/ops/estimate-calculator/estimate-calculator-popover.tsx` (+ small internal pieces in the same folder if the file passes ~350 lines: `mode-calc.tsx`, `mode-area.tsx`, `mode-linear.tsx`, `mode-convert.tsx`, `keypad.tsx`)
- Test: `src/components/ops/estimate-calculator/__tests__/estimate-calculator-popover.test.tsx`

**Design tokens:** panel `bg-glass-dense border border-line rounded-modal` (12px) width 296px, padding 12; mode chips = the editor's chip idiom (`rounded-chip border font-mono text-[10px] uppercase tracking-wider`, active `text-text border-line-hi bg-surface-hover`, inactive `text-text-mute`); inputs = the shared `Input` (`h-9`, right-aligned numerics, `font-mono` for numeric fields); keypad keys `h-9 rounded font-mono text-body-sm bg-surface-input border border-line hover:bg-surface-hover` in a 4-column grid; result `font-mono text-[20px] tabular-nums` (slashed-zero via the project's numeric class — find the existing utility, e.g. `tnum`/`font-feature` class used by metrics) with the `// RESULT` label above in `text-micro text-text-mute`; error text `text-rose`; INSERT = primary button rule (outlined accent at rest → filled on hover; disabled = `text-text-mute border-line`), full width, `h-9`. Left-aligned text throughout. No shadows. No new colors — every value a token; if you need `rgba(255,255,255,0.05)` use `bg-surface-hover`.

**Props:**
```ts
interface EstimateCalculatorPopoverProps {
  target: { lineItemId: string; field: "quantity" | "unitPrice"; lineNumber: number } | null;
  descriptionSupported: boolean;             // editor exposes a description/notes field
  onInsert(result: { value: number; working: string | null; addToDescription: boolean }): void;
  trigger: React.ReactNode;                  // the CALC chip, rendered as PopoverTrigger asChild
}
```

**Step 1: Failing tests (Testing Library; Popover opened via the trigger):**
1. Opens on trigger click; panel has `role="dialog"` (Radix content) and the dialog label; the content element carries `z-modal`.
2. CALC mode: typing `12*16` shows result `192`; `Enter` evaluates; keypad button `7` appends; `⌫` deletes; `C` clears; malformed shows `[ CHECK THE EXPRESSION ]` and INSERT is disabled; `5/0` shows the divide-by-zero copy.
3. INSERT label reads `INSERT → QTY · LINE 3` for `target.field="quantity", lineNumber 3` and `INSERT → PRICE · LINE 3` for unitPrice; with `target: null` it is disabled and reads `[ FOCUS A QTY OR PRICE FIELD ]`.
4. Clicking INSERT calls `onInsert({ value: 192, working: null, addToDescription: false })` and closes the popover; `⌘+Enter` does the same.
5. AREA mode: length 12, width 16, ft → result `192` and working `12 ft × 16 ft = 192 sq ft`; toggling sq m updates; waste 10 → `211.2`; the add-math toggle defaults ON and is rendered only when `descriptionSupported`; INSERT passes `working` + `addToDescription: true`.
6. LINEAR mode: add three lengths 14/9/22 → `45`; remove one → recomputes; working string exact.
7. CONVERT mode: 1 m → ft shows `3.28`; the `to` select only lists units in the same dimension as `from`.
8. Esc closes; focus returns to the trigger (Radix default) — assert the trigger has focus after Esc.
9. Result formatting: `1200.5` renders `1,200.50`? No — spec says formatted: `1,240.50` for prices, but quantities like `192` stay `192`. Rule: `formatResult(value)` trims trailing zeros for the display, and INSERT passes the raw half-up-rounded 2-decimal number. Assert both.

**Step 2: Run → FAIL.** `npx vitest run src/components/ops/estimate-calculator/__tests__/estimate-calculator-popover.test.tsx`
**Step 3: Implement.** Modes as a radio group of chips (arrow keys move, Radix `RadioGroup` or a11y-correct buttons with `role="radio"`); state per mode kept while the popover is open, reset on close. Expression field is a plain `Input` (not `type="number"`) so operators are typeable. Insert = `formatResult`-consistent rounding: `Math.round((v + Number.EPSILON) * 100) / 100`.
**Step 4: Run → PASS.** **Step 5: `custom-skills:audit-design-system` on the folder.**

**Step 6: Commit**
```bash
git add src/components/ops/estimate-calculator/ src/components/ops/estimate-calculator/__tests__/estimate-calculator-popover.test.tsx
git commit -m "feat(estimates): calculator popover with arithmetic, area, linear and convert modes (be25c30e)"
```

---

### Task 5: Editor integration (TDD)

**Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:audit-design-system`.

**Files:**
- Modify: `src/components/ops/line-item-editor.tsx`
- Test: the editor's existing test file if one exists (grep `line-item-editor` under `tests/` and `src/**/__tests__`); else create `tests/unit/ops/line-item-editor-calculator.test.tsx`.

**Step 1: Failing tests:**
1. A `CALC` chip renders in the action row beside "Add Line Item" (same row, `rounded-chip` mono chip idiom, `h-[28px]` compact tier — not 64px).
2. Focusing line 2's quantity input then opening CALC → the popover's INSERT label reads `INSERT → QTY · LINE 2`; focusing line 1's unit price → `INSERT → PRICE · LINE 1`.
3. `onInsert({ value: 192, working: null, addToDescription: false })` → `updateItem(line2.id, "quantity", 192)` (assert via the editor's `onChange`/items prop output — read how the editor reports changes) and focus lands back on that input.
4. `onInsert({ value: 211.2, working: "12 ft × 16 ft = 192 sq ft (+10% waste = 211.2)", addToDescription: true })` → quantity updated AND, if the row model exposes a description/notes field in the expanded panel, that field gets the working appended (`existing + "\n" + working`, or just the working when empty); if the model has no such field, `descriptionSupported` is false and nothing else changes (assert whichever the code shows — record which in the report).
5. Removing the targeted line clears the target (INSERT falls back to the no-target state).

**Step 2: Run → FAIL. Step 3: Implement.** Add `calcTarget` state `{ lineItemId, field } | null`; `onFocus` on the two numeric inputs sets it; derive `lineNumber` from the item's index + 1; refs per numeric input (`Map<string, HTMLInputElement>`) to restore focus after insert. Render the popover with the `CALC` chip as trigger in the action row. Wrap the two numeric inputs' existing `onChange` untouched.
**Step 4: Run → PASS** + the editor's existing tests green + run one estimate-window test and one invoice-modal test that mount the editor (find them) to prove nothing regressed.
**Step 5: audit-design-system** on the diff.

**Step 6: Commit**
```bash
git add src/components/ops/line-item-editor.tsx <test file>
git commit -m "feat(estimates): open the calculator from the line-item editor and insert into the focused field (be25c30e)"
```

---

### Task 6: Bible + follow-up note

**Files (bible repo `/Users/jacksonsweet/Projects/OPS/ops-software-bible`, local main):**
- Modify: the estimates/books feature documentation (grep `LineItemEditor` / `Estimates` in `07_SPECIALIZED_FEATURES.md` or the books chapter — find where line items are documented) — add a dated paragraph: the calculator (modes, insertion rule, rounding, the add-math-to-description behavior, z-modal placement, i18n namespace), and the explicit non-goals (no unit writes; editor i18n retrofit pending).

**Commit (bible)**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-software-bible && git add <file> && git commit -m "docs(estimates): document the line-item calculator"
```

---

## PM verification (after the single build)

1. Build: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.
2. Live (preview + dev bypass) at 1300×900: Books → Estimates → new estimate: CALC chip renders in the action row; opens above the dialog; keypad + expression; focus line 2 qty → INSERT label names it → insert 192 → field shows 192 and total recomputes; AREA 12×16 with add-math → quantity 192 and description carries the working (if supported); pipeline floating window: same, above the window chrome; invoice modal: chip present. Esc/focus return. Mobile 390: keypad usable. Screenshots to `docs/artifacts/estimate-calculator/`.
3. Close `be25c30e` with evidence; chip a follow-up for the editor's i18n retrofit.

## Risks

- `parseFloat || 0` on the inputs: any DOM-level write would be re-parsed — insertion must go through `updateItem` only (tests pin it).
- Popover inside the Books dialog: Radix Dialog traps focus; a portaled Popover is inside the same React tree so focus management works — verify in the live pass; if the dialog's `onPointerDownOutside` closes the dialog when clicking the popover, stop the propagation the way entity-picker does inside dialogs (check its implementation).
- Doubled spacing scale: any `h-8`/`p-4`-style guess is wrong by 2× — use the tokens named above.
