# MCP Developer Guide Implementation Plan

**Goal:** Publish a public, source-backed `/developers/mcp` guide that accurately explains the active OPS remote MCP server, its read-only capability set, connection paths, security boundary, tested prompts, and tool-request channel.

**Architecture:** A server-only reference adapter derives every live fact from the active MCP exposure, capability manifest, OAuth configuration, and consent catalog. The page receives only an explicitly whitelisted public view model. A shared developer header links the REST API and MCP references without merging their distinct authentication models.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, Tailwind design tokens, JSON dictionaries, Vitest, Testing Library, Playwright.

**Required skills:** `superpowers:test-driven-development`, `custom-skills:executing-plans`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:wireframe`, `custom-skills:audit-design-system`, `animation-studio:animation-architect`, `animation-studio:web-animations`, `superpowers:verification-before-completion`.

---

## Task 1: Lock the public MCP documentation contract

**Files:**

- Create: `tests/unit/mcp/guide-reference.test.ts`
- Create: `src/lib/agent-control-plane/mcp/docs/reference.ts`

1. Write failing tests proving the public reference resolves exactly the active exposure, exactly 34 available read tools, exactly 20 read scopes, the canonical endpoint, complete one-time grouping, and no internal policy or rollout fields.
2. Run the focused test and observe the expected module-not-found failure.
3. Implement the smallest server-only adapter that satisfies the contract and fails closed on unknown, duplicate, unavailable, non-read, unlabeled, or ungrouped entries.
4. Re-run the focused test.

## Task 2: Lock page content and public-route behavior

**Files:**

- Create: `tests/unit/mcp/guide-page.test.tsx`
- Modify: `tests/unit/middleware.test.ts`
- Create: `src/lib/agent-control-plane/mcp/docs/copy.ts`
- Create: `src/i18n/dictionaries/en/mcp-docs.json`
- Create: `src/i18n/dictionaries/es/mcp-docs.json`

1. Write failing tests for the guide's capability counts, deck-design example, host connection instructions, honest compatibility wording, read-only boundary, OAuth/security copy, support-email tool request, and public middleware access.
2. Run the focused tests and observe the expected failures.
3. Add typed English and Spanish copy plus middleware coverage.

## Task 3: Build the guide and shared developer navigation

**Files:**

- Create: `src/app/developers/_components/developers-header.tsx`
- Move/refactor: `src/app/developers/api/_components/reference-header.tsx`
- Move/refactor: `src/app/developers/api/_components/copy-code-button.tsx`
- Modify: `src/app/developers/api/_components/api-reference-page.tsx`
- Create: `src/app/developers/mcp/layout.tsx`
- Create: `src/app/developers/mcp/page.tsx`
- Create: `src/app/developers/mcp/_components/mcp-guide-page.tsx`
- Create: `src/app/developers/mcp/_components/mcp-guide-navigation.tsx`

1. Build the shared REST/MCP header with route state, canonical endpoint context, and existing OpenAPI action intact.
2. Build the responsive MCP guide using semantic sections, token-only styling, source-derived counts/tool names/descriptions/scopes, accessible code blocks, and reduced-motion-safe interaction feedback.
3. Add a `REQUEST A TOOL` section that opens a prefilled email to the canonical public support address and warns against sending credentials or customer records. Do not create an anonymous submission API.
4. Make the new unit tests pass without regressing the REST reference tests.

## Task 4: Add browser acceptance coverage

**Files:**

- Create: `tests/e2e/mcp-guide.spec.ts`

1. Cover 375, 768, 1024, and 1440 widths with zero horizontal overflow.
2. Cover desktop/mobile navigation, REST/MCP cross-links, deep links, copy confirmation, request-tool mail link, and reduced motion.
3. Store screenshots only under `docs/artifacts/mcp-guide/` while verifying, then keep only deliberate proof artifacts.

## Task 5: Verify the complete vertical

1. Run focused MCP guide, middleware, active-exposure, and REST reference tests.
2. Run exact-path ESLint and TypeScript type checking.
3. Run the production build.
4. Run Playwright acceptance against a local production-like server and inspect screenshots at all four viewports.
5. Audit changed UI files for design-system violations: no hardcoded color, spacing, radius, font, shadow, or unsupported motion values.
6. Review the diff for public-data leaks and confirm only whitelisted MCP metadata reaches the page.
7. Commit the isolated change atomically. Do not push or deploy without Jackson's explicit approval.
