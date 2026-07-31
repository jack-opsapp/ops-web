# Public External API Reference

**Date:** 2026-07-30  
**Status:** Product and engineering confirmed for implementation  
**Surface:** OPS Web  
**Public route:** `/developers/api`

## Intent

Publish one canonical, platform-agnostic reference that a developer can use to connect any custom website to the OPS External Lead API.

The page must explain how to:

- create the original customer and lead record;
- attach photos and files without exposing an OPS credential to the browser;
- poll attachment-processing status;
- synchronize every lead with source characteristics;
- populate a website analytics dashboard from versioned metrics.

The website sends the original submission only. Later email messages and attachments remain the responsibility of the OPS email engine.

## Product decisions

- The reference is public and requires no OPS login.
- It never names or visually references Norcut or any other integration client.
- It is an OPS API reference, not a marketing page.
- It provides copyable examples but no live request console.
- It never accepts, stores, echoes, or validates a developer credential.
- It exposes the generated OpenAPI 3.1 document as a machine-readable download.
- Human guidance is curated; endpoint paths, methods, scopes, summaries, schemas, and examples come from the canonical generated contract.

## Audience and job

The reader is a developer building a lead form or analytics dashboard for a custom website. They need to understand the integration sequence, copy a safe server-side pattern, and diagnose failures without reading OPS source code.

The page should feel like a field manual: exact, calm, and operational. It should make the safe path obvious and remove internal implementation details.

## Reference benchmark

The information design follows the established patterns used by professional API references:

- QuickBooks API Explorer: resource description, complete sample object, then operation-by-operation request and return detail;
- Stripe API Reference: base URL and language-specific copyable request examples kept beside the reference;
- GitHub REST documentation: stable left navigation, deep-linked sections, explicit headers and parameter types, example requests, example responses, and separate operational guidance.

OPS adopts those documentation patterns without copying another company's visual identity or adding a live console.

## Information architecture

The page uses a persistent section index on desktop and a compact in-page index on mobile.

1. **Overview**
   - API purpose
   - production base URL
   - original-submission boundary
   - six-operation summary
2. **Authentication**
   - bearer credentials are server-only
   - intake and analytics credentials remain separate
   - required scopes
3. **Quick start**
   - read intake configuration
   - reserve uploads when needed
   - upload directly with the returned capability
   - create the original submission
   - poll only until attachment processing is terminal
4. **Lead intake**
   - `GET /v1/intake/config`
   - `POST /v1/intake/uploads`
   - `POST /v1/intake/submissions`
   - `GET /v1/intake/submissions/{publicSubmissionId}`
5. **Lead analytics**
   - full and incremental lead synchronization
   - `GET /v1/analytics/leads`
   - `GET /v1/analytics/metrics`
   - financial scope boundary
6. **Errors and retries**
   - safe error envelope
   - request IDs
   - idempotency behavior
   - `Retry-After`, bounded backoff, and conflict handling
7. **Limits and security**
   - published quota windows
   - body, answer, file, and batch limits from the contract
   - credential rotation and revocation
8. **Resources**
   - OpenAPI 3.1 download
   - JavaScript, TypeScript, PHP, and HTTP examples

## Reference shell

Desktop uses a professional three-column documentation shell:

1. **Reference navigation** — stable groups for Start here, Lead intake, Lead analytics, Errors, Limits, and Resources.
2. **Contract detail** — the readable operation description, field definitions, constraints, and guidance.
3. **Request and response examples** — a sticky code surface aligned with the operation being read.

At narrower widths, the example surface moves directly below the relevant contract detail. Mobile uses one reading column and a compact native section index. The page never relies on a generic grid of dashboard cards.

The compact global header contains:

- OPS lockup;
- `DEVELOPERS`;
- `REST API · V1`;
- production base URL;
- OpenAPI download action.

The six-operation scope does not justify global search. Browser find, stable headings, deep links, and the section index cover discovery without adding a nonfunctional documentation search system.

## Endpoint presentation

Each operation follows one consistent reference sequence:

- method and path;
- plain-language purpose;
- required credential class and scopes;
- required headers;
- path, query, and body fields with name, type, required state, constraints, and description;
- complete sample request object when a body exists;
- language tabs for HTTP/cURL, JavaScript, TypeScript, and PHP;
- success statuses with response fields and complete JSON example;
- operation-specific safe errors and relevant retry behavior.

The reference reads from the generated OpenAPI document. The page may add guidance around an operation, but it must not re-declare contract facts in a second hand-maintained structure.

Code examples use obvious placeholders such as `OPS_API_TOKEN` and never resemble a real credential. Examples keep the credential on the website server and send only upload capabilities to browser code.

## Visual direction

The reference uses OPS brand discipline inside a purpose-built documentation shell.

- Pure-black canvas.
- One narrow public header and quiet hairline column boundaries.
- Cake Mono Light for uppercase authority headings.
- Mohave for sentence-case explanation.
- JetBrains Mono for methods, paths, headers, identifiers, and numbers.
- Flat reading surfaces for navigation and prose; dense glass is reserved for code and JSON examples.
- Steel blue appears once as the OpenAPI download action and as the keyboard focus ring only.
- Earth tones communicate HTTP method or status semantics; they are never decorative.
- No dashboard cards, oversized hero, gradients, shadows, emoji, centered text, or animated data.
- Motion is limited to the approved precise easing for hover, focus, copy confirmation, and section navigation, with reduced-motion support.

The distinctive element is a vertical request sequence that connects configuration, upload reservation, direct upload, submission, and status polling. It communicates the integration boundary more clearly than a generic card grid.

## Responsive and accessible behavior

- The desktop section index remains visible while reading.
- The desktop example surface remains aligned with the active operation without covering reference content.
- The mobile index collapses into a native, keyboard-operable section control.
- All content works at 375px, 768px, 1024px, and 1440px without horizontal page scrolling.
- Code blocks may scroll internally and retain visible focus.
- Copy buttons have accessible names and announce confirmation without moving focus.
- Headings form a valid hierarchy.
- Every operation and major guide section has a stable deep-link target.
- Field-definition tables have equivalent stacked semantics at mobile widths.
- Method and status meaning never rely on color alone.
- Text and controls meet WCAG AA contrast and target-size requirements.

## Data flow and drift control

1. Runtime schemas generate `docs/api/openapi-v1.json`.
2. The public page imports that checked artifact at build time.
3. A small server-only adapter selects the six published operations and validates the expected OpenAPI version and operation IDs.
4. Server Components render the reference. No browser request to OPS or Supabase is needed.
5. The raw contract is served from `/developers/api/openapi.json` with JSON content type and a safe download filename.
6. CI regenerates the contract and rejects byte drift, then verifies that the public page still covers all six operation IDs.

Curated guidance and translated interface labels live in the normal OPS dictionaries. API identifiers, schema property names, and code samples remain unchanged.

## Failure behavior

- A missing or malformed contract fails the build instead of publishing incomplete documentation.
- An unexpected operation addition or removal fails the coverage test.
- Copy-to-clipboard failure leaves the code visible and exposes a terse manual-copy instruction.
- The page never substitutes guessed contract details when a schema is absent.

## Verification

Implementation is complete only when:

- anonymous requests can load `/developers/api` and the OpenAPI download;
- authenticated and anonymous rendering are identical;
- all six operations appear exactly once;
- the original-submission and server-only credential boundaries are visible;
- upload examples never expose the bearer credential to browser code;
- analytics documents full sync, incremental sync, source characteristics, and financial scope;
- contract generation remains byte-stable;
- focused tests, lint, type/build checks, responsive browser checks, keyboard checks, and the OPS design-system audit pass.

## Non-goals

- Credential creation or management.
- A live API console.
- Documentation-wide search for the initial six-operation reference.
- Client-specific setup instructions.
- SDK generation.
- Plugin installation instructions.
- Internal database, queue, storage, malware-scanning, or email-engine implementation details.
- Production enablement or deployment as part of the documentation build.
