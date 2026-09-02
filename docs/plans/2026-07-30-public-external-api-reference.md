# Public External API Reference Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change, `ops-copywriter:ops-copywriter` for all public copy, and the required OPS web design skills for the interface.

**Goal:** Publish a public, platform-agnostic API reference at `/developers/api` that lets a developer implement lead intake, photo/file upload, lead synchronization, and analytics without reading OPS source code or exposing credentials.

**Architecture:** Render the reference as a public Next.js Server Component backed by the checked-in OpenAPI 3.1 artifact. A strict server-only adapter validates and selects the six published operations, while small client components own only copy-to-clipboard and language-tab interactions. Serve the same canonical document from `/developers/api/openapi.json`; fail tests when the generated contract and rendered operation coverage drift.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind tokens, Vitest, Testing Library, Playwright, generated OpenAPI 3.1 JSON.

**Design contract:** Follow `docs/superpowers/specs/2026-07-30-public-external-api-reference-design.md`. The reference uses a professional three-column documentation shell inspired by QuickBooks, Stripe, and GitHub information architecture while retaining the OPS design system. It is not a dashboard, marketing page, live console, or client-specific integration guide.

---

### Task 1: Lock the public contract adapter

**Files:**

- Create: `src/lib/external-api/docs/reference.ts`
- Test: `tests/unit/external-api/reference-docs.test.ts`
- Read: `docs/api/openapi-v1.json`
- Read: `scripts/generate-external-api-openapi.ts`

**Step 1: Write the failing adapter tests**

Cover:

- OpenAPI version is exactly `3.1.0`.
- Production server URL is present.
- Exactly the six expected operation IDs are selected once, in the intended navigation order.
- Every selected operation exposes method, path, summary, description, required scopes, parameters, request example when applicable, success statuses, success example, and schema references.
- Missing or malformed required contract data throws a build-stopping error.
- The adapter exposes no internal database, storage, queue, credential digest, customer contact, or client-specific identifiers.

**Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run tests/unit/external-api/reference-docs.test.ts`

Expected: FAIL because the reference adapter does not exist.

**Step 3: Implement the strict server-only adapter**

Import `docs/api/openapi-v1.json` at build time. Resolve local component schema references only as needed for field tables and examples. Keep contract facts sourced from OpenAPI; do not duplicate paths, methods, scopes, summaries, schemas, constraints, or examples in curated UI data.

**Step 4: Run the focused test and confirm it passes**

Run: `npx vitest run tests/unit/external-api/reference-docs.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/external-api/docs/reference.ts tests/unit/external-api/reference-docs.test.ts
git commit -m "feat(api-docs): add strict reference contract adapter"
```

### Task 2: Add safe, language-specific code examples

**Files:**

- Create: `src/lib/external-api/docs/code-examples.ts`
- Test: `tests/unit/external-api/reference-code-examples.test.ts`

**Step 1: Write the failing safety and completeness tests**

Cover:

- HTTP/cURL, JavaScript, TypeScript, and PHP examples exist for all six operations.
- Every example uses the canonical base URL, method, path, parameters, and checked OpenAPI example bodies.
- Credentials appear only as obvious environment placeholders such as `OPS_API_TOKEN`.
- Browser-side upload examples receive only the returned single-use upload capability, never the OPS bearer credential.
- `Idempotency-Key` appears for upload reservation and lead creation.
- Polling stops when attachment processing becomes terminal and honors `pollAfterSeconds`.
- Full lead sync precedes incremental sync.
- No example contains Norcut, real-looking secret material, internal storage keys, or customer contact data from analytics.

**Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run tests/unit/external-api/reference-code-examples.test.ts`

Expected: FAIL because the code example generator does not exist.

**Step 3: Implement deterministic example generation**

Generate snippets from the adapter’s operations and examples. Keep formatting deterministic so tests can compare exact safety-critical fragments. Do not add a new syntax-highlighting dependency; use semantic code markup and restrained token classes.

**Step 4: Run the focused test and confirm it passes**

Run: `npx vitest run tests/unit/external-api/reference-code-examples.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/external-api/docs/code-examples.ts tests/unit/external-api/reference-code-examples.test.ts
git commit -m "feat(api-docs): generate safe integration examples"
```

### Task 3: Build the public reference shell and curated guidance

**Required skills before implementation:**

- `ops-copywriter:ops-copywriter`
- `custom-skills:ops-design`
- `frontend-design:frontend-design`
- `custom-skills:interface-design`
- `custom-skills:ui-ux-pro-max`
- `animation-studio:animation-architect`
- `animation-studio:web-animations`

**Files:**

- Create: `src/app/developers/api/layout.tsx`
- Create: `src/app/developers/api/page.tsx`
- Create: `src/app/developers/api/_components/reference-header.tsx`
- Create: `src/app/developers/api/_components/reference-navigation.tsx`
- Create: `src/app/developers/api/_components/quick-start-sequence.tsx`
- Create: `src/app/developers/api/_components/operation-reference.tsx`
- Create: `src/app/developers/api/_components/schema-fields.tsx`
- Create: `src/app/developers/api/_components/code-example-tabs.tsx`
- Create: `src/app/developers/api/_components/copy-code-button.tsx`
- Create: `src/i18n/dictionaries/en/external-api-docs.json`
- Create: `src/i18n/dictionaries/es/external-api-docs.json`
- Test: `tests/unit/external-api/reference-page.test.tsx`
- Modify: `tests/unit/middleware.test.ts`

**Step 1: Write failing public-page tests**

Cover:

- Page metadata identifies an OPS API reference, not a client integration or marketing page.
- Anonymous middleware access to `/developers/api` is unchanged by dashboard cookies.
- The page renders all six operation IDs exactly once.
- Headings, deep-link IDs, navigation labels, method/path labels, scope labels, field definitions, examples, error guidance, rate/limit guidance, OpenAPI action, and original-submission boundary are present.
- The page contains no login prompt, console, credential input, Norcut reference, oversized marketing hero, or dashboard widget shell.
- Client interactions use semantic buttons/tabs, accessible names, keyboard focus, live copy confirmation, and failure guidance.

**Step 2: Run the focused tests and confirm they fail**

Run:

`npx vitest run tests/unit/external-api/reference-page.test.tsx tests/unit/middleware.test.ts`

Expected: FAIL because the public reference route and components do not exist.

**Step 3: Add curated copy through OPS dictionaries**

Write terse, professional guidance for overview, authentication, original-submission boundary, quick start, analytics sync, errors/retries, limits/security, and resources. Keep API identifiers and code unchanged. Spanish receives a complete equivalent dictionary, not partial placeholders.

**Step 4: Build the documentation shell**

Use:

- one compact public header with OPS lockup, `DEVELOPERS`, `REST API · V1`, production base URL, and OpenAPI action;
- stable desktop reference navigation;
- contract-detail reading column;
- sticky request/response example column;
- one-column mobile reading order with a native section index;
- flat navigation/prose surfaces with dense glass reserved for code and JSON;
- the vertical configuration → upload reservation → direct upload → submission → polling sequence;
- OPS fonts, colors, spacing, radii, icons, focus, and motion tokens only.

Do not use dashboard cards, gradients, shadows, decorative icons, centered presentation, animated metrics, a search shell, or a live request console.

**Step 5: Implement precise client interactions**

Use client code only for:

- accessible language tabs;
- copy-to-clipboard;
- terse copied/failure status announcement.

Use CSS/token transitions only, the OPS easing curve, and reduced-motion handling. No entry spectacle or scrolling choreography.

**Step 6: Run focused tests and confirm they pass**

Run:

`npx vitest run tests/unit/external-api/reference-page.test.tsx tests/unit/middleware.test.ts`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/app/developers/api src/i18n/dictionaries/en/external-api-docs.json src/i18n/dictionaries/es/external-api-docs.json tests/unit/external-api/reference-page.test.tsx tests/unit/middleware.test.ts
git commit -m "feat(api-docs): build public external API reference"
```

### Task 4: Serve the machine-readable OpenAPI document

**Files:**

- Create: `src/app/developers/api/openapi.json/route.ts`
- Test: `tests/integration/external-api-reference-openapi.test.ts`

**Step 1: Write the failing route tests**

Cover:

- Anonymous `GET` returns `200`.
- Body exactly matches the checked artifact.
- Content type is OpenAPI-compatible JSON.
- Content disposition uses a safe, stable filename.
- Route does not vary by OPS session cookies and does not accept credentials.

**Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run tests/integration/external-api-reference-openapi.test.ts`

Expected: FAIL because the route does not exist.

**Step 3: Implement the read-only route**

Return the checked artifact without mutation. Use explicit response headers and no authentication, database, Supabase, AWS, or external network call.

**Step 4: Run the focused test and confirm it passes**

Run: `npx vitest run tests/integration/external-api-reference-openapi.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/developers/api/openapi.json/route.ts tests/integration/external-api-reference-openapi.test.ts
git commit -m "feat(api-docs): publish OpenAPI reference download"
```

### Task 5: Add drift, responsive, and accessibility proof

**Required skills before verification:**

- `playwright`
- `custom-skills:audit-design-system`
- `superpowers:verification-before-completion`

**Files:**

- Modify: `tests/contract/external-api-openapi.test.ts`
- Create: `tests/e2e/external-api-reference.spec.ts`
- Create: `docs/artifacts/external-api-reference/` screenshots

**Step 1: Extend contract coverage**

Assert that:

- generated OpenAPI remains byte-for-byte stable;
- the public reference adapter covers every published operation exactly once;
- operation additions/removals fail the contract gate;
- machine-readable and rendered references use the same checked document.

**Step 2: Add browser-level scenarios**

Verify at 375px, 768px, 1024px, and 1440px:

- no horizontal page overflow;
- desktop and mobile navigation behavior;
- sticky navigation/example surfaces do not cover content;
- all deep links resolve to visible headings;
- language tabs work by mouse and keyboard;
- copy confirmation retains focus;
- code blocks scroll internally;
- anonymous page and OpenAPI download work;
- reduced-motion mode removes nonessential transitions.

**Step 3: Run focused automated proof**

Run:

- `npx vitest run tests/unit/external-api/reference-docs.test.ts tests/unit/external-api/reference-code-examples.test.ts tests/unit/external-api/reference-page.test.tsx tests/integration/external-api-reference-openapi.test.ts tests/contract/external-api-openapi.test.ts tests/unit/middleware.test.ts`
- `npx playwright test tests/e2e/external-api-reference.spec.ts`
- `npx eslint src/app/developers/api src/lib/external-api/docs tests/unit/external-api tests/integration/external-api-reference-openapi.test.ts tests/e2e/external-api-reference.spec.ts`
- `npm run type-check`
- `npm run build`

Expected: all focused gates pass. If the pre-existing full repository type/build gate remains long-running or fails outside this feature, isolate and report the exact unrelated blocker rather than claiming success.

**Step 4: Complete visual and design-system audit**

Inspect screenshots at all four target widths. Confirm:

- authentic reference hierarchy and density;
- OPS token compliance;
- zero hardcoded colors, spacing, radii, fonts, or motion values;
- no dashboard-card treatment;
- no inaccessible muted body copy;
- method/status semantics do not rely on color alone;
- content remains readable with code examples adjacent on desktop and inline on mobile.

**Step 5: Commit**

```bash
git add tests/contract/external-api-openapi.test.ts tests/e2e/external-api-reference.spec.ts docs/artifacts/external-api-reference
git commit -m "test(api-docs): verify public reference experience"
```

### Task 6: Update the OPS Software Bible and prepare a private preview

**Files:**

- Modify in the prepared Bible worktree: `04_API_AND_INTEGRATION.md`
- Modify in the prepared Bible worktree: relevant deployment/launch section

**Step 1: Document the public reference**

Record:

- `/developers/api` public behavior;
- `/developers/api/openapi.json` machine-readable behavior;
- OpenAPI-to-page drift gate;
- anonymous access boundary;
- no-console and no-credential-capture policy.

**Step 2: Verify the documentation change against implementation**

Check every documented route and boundary against the final code and tests. Do not describe the page as live.

**Step 3: Commit the Bible update atomically**

```bash
git add 04_API_AND_INTEGRATION.md <deployment-file>
git commit -m "docs(api): document public external API reference"
```

**Step 4: Create a private Vercel preview**

Build and inspect a private preview only. This introduces no new paid service or package; expected incremental infrastructure cost is `$0`. Do not deploy to production or push `main` without Jackson’s explicit approval.

**Step 5: Handoff**

Report:

- public route and OpenAPI route;
- visual/browser proof;
- focused test/build proof;
- exact remaining production action requiring approval.
