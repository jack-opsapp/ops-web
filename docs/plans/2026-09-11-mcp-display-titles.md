# MCP Display Titles Implementation Plan

> **Execution:** Use `custom-skills:executing-plans`, as required by OPS. User already authorized delegated bug repairs and continuation.

**Goal:** Replace raw MCP display identifiers with readable action titles for report d1ed9ed1-35bb-42f9-91d3-7457d9a3d21b.

**Architecture:** Keep invocation IDs, schemas, grant exposure, safety hints, descriptions and handlers unchanged. Resolve display titles from the English dictionary and publish them in both protocol title locations. Future trusted IDs receive a readable fallback; catalog coverage tests require explicit copy for current tools.

**Tech Stack:** TypeScript, MCP SDK2, Vitest.

**Design System:** No visual changes. Sentence-case product copy follows OPS DESIGN.md voice; MCP has no negotiated locale and existing descriptions are English.

**Required Skills:** systematic-debugging, ops-copywriter, custom-skills:writing-plans, custom-skills:executing-plans, verification-before-completion.

## Task1: Establish the discovery regression

- Create `src/lib/agent-control-plane/mcp/__tests__/tool-display-metadata.test.ts` using real transport and server creation for every grant exposure.
- Run it with one Vitest worker. Verify raw titles cause failure. Completed:18 failures at baseline.
- Assert readable top-level and annotation titles, stable tool IDs, input schemas, descriptions and safety hints. Assert discovery never invokes business, audit or rate-limit operations.

## Task2: Implement display copy

Skills: ops-copywriter. No layout, colors, spacing or animation changes.

- Create `src/i18n/dictionaries/en/mcp-tools.json` with explicit action labels for current registry tools.
- Create `src/lib/agent-control-plane/mcp/tool-display-metadata.ts` with dictionary lookup and trusted-name fallback.
- In `server-factory.ts`, compute title once and use only for top-level title and annotations.title.
- Preserve P19 and deck-geometry description overrides. Do not integrate shared main until parent clears that seam.

## Task3: Verify and record

- Run display metadata, grant-pinned exposure, transport, catalog candidate and deck geometry protocol tests with one worker.
- Run focused formatting and diff checks; inspect the exact final diff and obtain independent code review.
- Commit only named task files. After P19 clears integration, apply the exact commit to local main and verify ancestry and focused checks.
- Update the Software Bible's MCP discovery contract, and record guarded report proof notes with independent readback and zero-row replay.
- Report local proof separately from deployment and Claude rendering; no push or deployment is authorized.
