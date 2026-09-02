# Bug-report element picker — design

**Origin:** bug `1f2bf7e9` (Jackson, 2026-08-28): "Need to add point and click to optionally select elements to attach to a bug report for reference."
**Surface:** OPS-Web bug-report drawer (`src/components/ops/bug-report-drawer.tsx`) and the admin bug detail (`src/app/admin/feedback/_components/feedback-content.tsx`).
**Status:** approved by Jackson 2026-08-31 ("Yes please build it"); spec decisions delegated to the principal per standing contract.

## The human situation

An operator sees something wrong on screen. Today they describe it in words and a full-page screenshot rides along. Triage then guesses which control they meant ("the grey field in settings" → four candidate components). The picker lets them point at the thing once, so the report arrives carrying the element's identity and a crop of it — no guessing, no follow-up.

## Approaches considered

1. **Overlay + hit-test (chosen).** A capture overlay above everything; the element under the pointer is resolved with `document.elementsFromPoint`, highlighted, and selected on click. Zero listeners on page elements, works on any page, cannot interfere with the page's own handlers.
2. **Per-element listeners.** Attach hover/click handlers across the DOM while picking. Rejected: bubbling collisions with the page's own handlers, teardown risk, perf on large tables.
3. **Marked screenshot only.** Let the user click a point and burn a marker into the screenshot. Rejected: loses the structural identity (selector, role, classes, component) that makes triage precise; a marker on a 1440px capture is not a reference.

## Behavior

- In the drawer's auto-capture block, every user (minimal and power-user forms) gets a ghost action **`[ SELECT ELEMENT ]`**. Up to **3** elements per report; at the cap the action reads `[ MAX 3 ELEMENTS ]` and is disabled.
- Activating it enters **picking mode**: the drawer stays mounted (form state preserved) but is hidden and inert; a full-viewport overlay appears with a painted wash (no backdrop-filter — it flickers the dashboard), crosshair cursor, a hairline highlight following the hovered element with a small mono label (`role · name`), and a left-anchored hint `// CLICK AN ELEMENT · ESC CANCELS` + `[ TAB MOVES · ENTER SELECTS ]`.
- **Select** by click, tap, or Enter on the keyboard-focused element. The highlight flashes to the accent for one beat (focus semantics — the single accent element on screen), a **cropped screenshot** of the element (24px padding, clamped to the viewport) is captured, an **element reference** is built, picking exits, and the drawer returns showing a chip `ELEMENT :: {name}` with a 28px thumbnail and a remove control. One pick per activation.
- **Cancel** with Esc or a click on the hint's `[ CANCEL ]`. Focus returns to the SELECT ELEMENT action.
- The drawer's outside-click dismiss and Esc-to-close are suspended while picking (they would otherwise close the form under the overlay).
- Not pickable: the overlay, the drawer, the create cluster, anything under a `data-bug-report-ignore` ancestor, `html`/`body`, zero-size elements. SVG descendants resolve to their nearest HTML ancestor. Iframes are picked as the iframe element itself.

## Element reference (data)

Stored in `bug_reports.custom_metadata.elementReferences: ElementReference[]` — no migration; `custom_metadata` is `jsonb`.

```ts
interface ElementReference {
  id: string;                 // client uuid, stable within the report
  label: string;              // aria-label → visible text (≤60) → placeholder → alt → title → tag
  role: string;               // explicit role or implicit (button/link/textbox/checkbox/…)
  tag: string;                // lowercase tag name
  selector: string;           // bounded structural CSS path (≤6 levels): data-testid/id/aria-label/role + :nth-of-type — no utility classes
  classes: string;            // raw class attribute (greppable Tailwind strings)
  testId: string | null;
  text: string;               // innerText snippet ≤120
  rect: { x: number; y: number; width: number; height: number };   // viewport, at selection time
  page: { x: number; y: number };                                     // document coords (scroll-adjusted)
  viewport: { width: number; height: number };
  componentChain: string[];   // nearest ≤3 named React components via fiber — best effort, empty in production builds
  capturedAt: string;         // ISO
  attachmentIndex: number | null;  // index into bug_reports.additional_attachments for its crop
}
```

Crops are uploaded after the report row exists, through the existing screenshot route extended with `kind=element&index=n`, stored at `bug-reports/{companyId}/{reportId}/element-{n}.png`, and appended (`s3:` scheme, index order) to `bug_reports.additional_attachments` (`text[]`). A failed crop upload is logged and tolerated exactly like the main screenshot — the reference still lands.

## Admin

`BugReportDetail` gains an **ELEMENTS (n)** section under SCREENSHOT: per reference, the crop thumbnail (presigned through the existing admin screenshot route), `role · label`, the selector in mono with a copy action, classes, text snippet, rect, component chain, page. The raw METADATA dump remains as the audit trail. The nightly triage endpoint's per-bug payload must carry `custom_metadata` and `additional_attachments` so the triage agent sees references (verify; add if stripped).

## Design system

Tokens only (DESIGN.md is law): drawer chip language for the action and chips (`font-mono` micro uppercase, `rounded-chip`, hairline borders, `--text-mute`/`--text-2` ladder); overlay wash `rgba(0,0,0,0.35)` painted; highlight `outline 1px var(--text-2)` + `rgba(255,255,255,0.05)` fill, radius chip; label/hint pills dense glass + hairline, mono 10/11px, uppercase, left-aligned; accent only on the selection confirmation flash. Motion: one curve `cubic-bezier(0.22,1,0.36,1)`; overlay 150ms fade; highlight follows the pointer via rAF with 120ms transform/size transition; flash 150ms; `prefers-reduced-motion` → no transitions. New z-index layer **`picker: 8000`** (above modals 3000 and map controls 5000, below emergency 9000) — recorded in the bible §15 scale and the ops-web CLAUDE.md table.

## Copy (product register)

`SELECT ELEMENT` · `[ MAX 3 ELEMENTS ]` · `// CLICK AN ELEMENT · ESC CANCELS` · `[ TAB MOVES · ENTER SELECTS ]` · `[ CANCEL ]` · `[ CAPTURING ELEMENT… ]` · chip `ELEMENT :: {name}` · remove control aria `Remove element`. English + Spanish in `common.json` under `bugReport.picker.*`.

## Out of scope

iOS reporter (different widget); marking multiple points on one screenshot; editing a reference after selection (remove + re-pick instead).
