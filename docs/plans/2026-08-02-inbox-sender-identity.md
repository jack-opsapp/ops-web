# Inbox Sender Identity & Outreach Settings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Outbound AI drafts always carry the operator's real identity — enforced signature, configured subject, real voice — and new-lead outreach is held until the operator has confirmed identity settings once.

**Architecture:** Two workstreams. **A (engine, server-only):** fix the AIDraftService prompt (operator identity + no-model-signoff), strip forwarder wrappers from prompt input, fix the writing-profile blend so a 10-email snapshot can't shadow the 1,973-email general profile, read the new `email_connections.outreach_subject` column, and gate contact-form outreach on a confirmed signature. **B (product surface):** structured signature builder (fields → one OPS HTML template, optional company logo), subject setting, confirm flow (`email_signatures.confirmed_at`), post-connect confirmation step, and the persistent rail notification deep link.

**Tech Stack:** Next.js 15 (ops-web), Supabase (project `ijeekuhbatykdomumfjx`), OpenAI via `inboxModel()`, vitest + MSW, Tailwind with OPS design tokens.

**Design System:** `../ops-design-system/project/DESIGN.md` (read before any UI task) + existing token classes in `src/components/settings/email-signature-settings.tsx`. Zero hardcoded color/spacing/radius/font values — run `custom-skills:audit-design-system` before calling UI done.

**Required Skills:** Workstream A: none beyond TDD discipline. Workstream B: `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter` (ALL user-facing strings), `custom-skills:audit-design-system` (final gate).

---

## Context you must not re-litigate (verified 2026-08-02 against origin/main 353e6278 + prod DB)

**The incident.** The contact-form outreach path (`email-assignment-contact-form-draft-worker.ts`, live since the Aug 1 release) placed 4 Gmail drafts signed **"Jared Jerome / 778-268-3324"** — the *forwarder's* iPhone signature, lifted from the forwarded Wix notification because the prompt never states who the AI writes as. Subject was the hardcoded `ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT = "Thanks for reaching out"`. Body was boilerplate because `WritingProfileService.getProfile("client_new_inquiry")` returns a stale 10-email profile instead of the 1,973-email general one, and the new-thread instruction is literally "Write a professional business email."

**Key repo facts (all on origin/main):**
- `src/lib/api/services/ai-draft-service.ts` — system prompt ~line 1513 (12-dimension voice, RULES block), user prompt build below it (`sourceBoundNewThread` branch → "Draft a new email… Write a professional business email."), subject derivation ~1690–1735 (`chooseNewThreadSubject`), model = `inboxModel("draft")` = `gpt-5.4`.
- `src/lib/email/email-subject-policy.ts` — `chooseNewThreadSubject` priority: operator > configured > learned > generated > fallback. Correct once "configured" is the operator's own setting.
- `src/lib/api/services/conversation-state/source-bound-autonomous-routing.ts` — `ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT`.
- `src/lib/api/services/email-assignment-contact-form-draft-worker.ts` — worker; `generateDraft` dependency called ~line 498; subject fallback at 329/555; signature resolved AFTER generation at ~562 via `resolveSignature` → `renderMailboxDraftWithSignature`.
- `src/lib/api/services/email-assignment-contact-form-draft-runtime.ts` — wires `generateDraft` → `AIDraftService.generateDraft({ configuredSubject: CONTACT_FORM_OUTREACH_SUBJECT, sourceBoundAutonomousRouting: "assigned_contact_form_review" })`.
- `src/lib/api/services/writing-profile-service.ts` — `getProfile` ~line 809: type-specific profile used **as-is when `emails_analyzed >= 10`**; `blendProfiles` weight = `emailsAnalyzed/10`. Both wrong at n=10.
- `src/lib/api/services/email-signature-service.ts` — `resolveEffective` (operator > mailbox > provider scopes), `sanitizeEmailSignatureHtml` (line ~625; **already allows `<img>` with http/https src, alt, width, height**), `renderEmailBodyWithSignature` (hash-marked wrapper `data-ops-signature-hash`).
- `src/lib/email/email-signature-runtime.ts` — `renderMailboxDraftWithSignature(body, signature)`; **null signature → body passes through untouched**; `resolveEmailSignatureForMessage` auto-imports the Gmail signature when none stored.
- `src/components/settings/email-signature-settings.tsx` — current card (bare `<Textarea>`, `opsText` save, Gmail import action), mounted in `src/components/settings/profile-tab.tsx:290`. Uses token classes (`font-mohave`, `text-body-sm`, `text-text-2`, `text-rose`) — follow the same system.
- `src/app/api/integrations/email/signature/route.ts` — GET/save/import route for the card.
- Tests: vitest, `tests/` + colocated `__tests__`; MSW starts in shared `tests/setup.ts` (no live network). Targeted runs: `npx vitest run <path>`. Full: `npx vitest run`. Types: `npx tsc --noEmit`. Lint exists but main carries pre-existing debt — introduce ZERO new errors (run `npm run lint` scoped to touched files if the full run is noisy).

**Prod DB facts:**
- `email_signatures` columns: `id, company_id, connection_id, scope_user_id, source, content_html, content_text, content_hash, provider_identity, active, fetched_at, confirmed_at, created_by, updated_by, created_at, updated_at`. **Zero rows for Canpro** — `confirmed_at` exists but nothing wires it.
- `email_connections.outreach_subject` (text, nullable) — **already added to prod** (migration `add_email_connections_outreach_subject`, 2026-08-02). Do NOT re-apply. Hand-add this one field to `database.types.ts` (`email_connections` Row/Insert/Update — `outreach_subject: string | null`); do NOT regenerate the whole types file (it churns unrelated tables and trips the manifest guard tests).
- `companies.logo_url` exists; Canpro has one (S3 PNG, public). `companies` identity fields: `name, description, address, phone, email, website` (Canpro phone = `(250) 538-8994`).
- `users` has `first_name`, `last_name` (Canpro operator: Jackson Sweet, user `283d49df-90a1-4abb-b94c-3e9f17f02c0d`).
- `email_signature_notification_lifecycle_outbox` table + `sync_email_signature_notification_as_system` RPC exist (called in `resolveEmailSignatureForMessage`) — **investigate and reuse this before inventing any new notification plumbing** (Task A7).
- Canpro references for fixtures only (never hardcode into product code): company `a612edc0-5c18-4c4d-af97-55b9410dd077`, connection `5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3`.

**Real forwarded-email wrapper (test fixture — this exact shape caused the impersonation):**

```
Thanks,Jared Jerome 
778-268-3324
Canpro Deck and Rail

Sent from my iPhone

Begin forwarded message:

From: Canpro Deck and Rail <notifications@wix-forms.com>
Date: August 2, 2026 at 11:41:10 MDT
To: jared@canprodeckandrail.com
Subject: Free Quote form got a new submission
Reply-To: "molsonc2020@gmail.com" <molsonc2020@gmail.com>

A site visitor just submitted your form Free Quote form on canpro-deck-and-rail
Submission summary:
Name:
Carolyn Molson 
Phone Number:
7809825181 
Email Address:
molsonc2020@gmail.com 
Location:
Esquimalt 
How Can We Help?:
Hello,
I would like a quote for a front deck. I have a picture for a starting point...
```

**Locked product decisions (Jackson, 2026-08-02 — do not reopen):**
1. Signature is the ONLY identity: model never writes a name/contact block; renderer appends the confirmed signature.
2. Signature authoring = structured builder (name/title/company/phone/website + optional company-logo toggle) rendered through ONE OPS HTML template. No freeform rich-text editor. Gmail import stays (imports provider HTML, still requires explicit confirm).
3. Logo = hosted `companies.logo_url` `<img>` in the template (already sanitizer-legal). No new upload UI. Hidden toggle when the company has no logo. **Layout (Jackson, 2026-08-02): when the logo is ON, the builder offers exactly two arrangements — `logo-left` (logo in a left cell, hairline vertical divider, text block right; DEFAULT) and `stacked` (text block, logo beneath). Logo OFF → text block only, no layout control shown.**
4. Subject for new-thread lead outreach = per-mailbox setting `email_connections.outreach_subject`, editable next to the signature. Priority stays operator > configured > learned; the setting IS "configured". Null → existing constant fallback (harmless because of the gate).
5. Identity gate: contact-form outreach (new-thread) does NOT generate until an **operator- or mailbox-scope signature with `confirmed_at` set** exists for the connection. In-thread replies are NOT gated. Held queue rows retry non-terminally (mailbox-busy pattern) and a persistent rail notification prompts confirmation once.
6. Confirmation moments: saving the builder = confirming (sets `confirmed_at`). Post-connect flow shows the same confirmation step pre-filled. Provider-imported signatures show as "imported — confirm to use".
7. Voice: type-specific profiles need `emails_analyzed >= 50` to stand alone; below that, blend with weight `n/50` into general.
8. New-thread instruction must answer the customer's actual inquiry.

**Non-goals:** iOS surfaces; the subject-preference learner; rebuilding stale profile rows (blend fix neutralizes them); logo upload UI; freeform signature HTML editing.

**Commit discipline:** atomic conventional commits per task (`fix(email): …` / `feat(email): …` / `feat(settings): …`), no AI attribution, commit only files you created/edited.

---

## Workstream A — Engine correctness (server-only; no UI)

### Task A1: Types for `outreach_subject`

**Files:** Modify `src/lib/types/database.types.ts` (locate the `email_connections` table block).

1. Hand-add `outreach_subject: string | null` to Row and `outreach_subject?: string | null` to Insert/Update for `email_connections`. Nothing else.
2. `npx tsc --noEmit` → clean.
3. Commit: `chore(db): add email_connections.outreach_subject to generated types`.

### Task A2: Strip the forwarder wrapper from prompt input

**Files:** Create `src/lib/api/services/conversation-state/forward-wrapper.ts` + `src/lib/api/services/conversation-state/__tests__/forward-wrapper.test.ts`. Wire into the contact-form prompt input only (find where `authorizedSourceActivity`'s `body_text_clean ?? body_text` becomes `latestInboundText` in `ai-draft-service.ts`, and apply when `sourceBoundAutonomousRouting === "assigned_contact_form_review"`).

Behavior of `stripForwardWrapper(text: string): string`:
- Find the first forward marker: `/^Begin forwarded message:/m` or `/^-{4,}\s*Forwarded message\s*-{4,}/m`. No marker → return input unchanged.
- In the pre-marker text, locate the forwarder's signature block: a trailing run that ends with a device line (`/^Sent from my (iPhone|iPad|Galaxy|Android)/mi`) and starts at the nearest preceding closing line (`/^(Thanks|Thank you|Cheers|Regards|Best)[,!]?/mi`) or, if none, at the start of the run of short lines (< 60 chars) directly above the device line.
- Remove that signature block (through the device line). KEEP any pre-marker text before it (a real note from the forwarder, e.g. "give them 10% off"). Keep everything from the marker onward.

TDD with four cases: (1) the real fixture above → pre-marker wrapper fully removed, form content intact; (2) fixture with a leading note line "Quote this one high — busy month." → note preserved, signature block removed; (3) Gmail-web marker variant; (4) no marker → unchanged. Then wire-in + one integration-level test asserting the contact-form prompt path receives stripped text. Commit: `fix(email): strip forwarder wrapper from contact-form draft input`.

### Task A3: Operator identity in the draft prompt

**Files:** Modify `src/lib/api/services/ai-draft-service.ts` (system prompt build ~1513 and its context loading); test in the existing AIDraftService test module (locate `tests/unit/**` naming near existing draft tests).

1. Load the operator's name once alongside the existing context loads: `users.first_name/last_name` by `userId` (follow the service's existing supabase read pattern).
2. The generation call site already resolves nothing about signatures — DO NOT move signature resolution; instead pass a boolean into the prompt build: `signatureWillBeAppended` = true iff the caller will append a confirmed signature. For workstream A, compute it in the contact-form path (the gate in A7 guarantees it there = `true`); default `false` elsewhere.
3. Prepend to RULES an OPERATOR IDENTITY block:
   - `You are writing as {first} {last} of {company name}. Never sign as, or adopt contact details of, any other person appearing in the email — forwarded messages often carry someone else's signature.`
   - When `signatureWillBeAppended`: `End the email with your closing phrase only (e.g. "{closings[0]}"). Do NOT write a name, phone number, or contact block — the operator's signature is appended automatically.`
   - Otherwise: `Sign off with your closing phrase and first name only ("{first}"). Never invent a phone number or contact block.`
4. Tests: system prompt contains the operator name; contains the no-contact-block rule when flag set; contains first-name rule otherwise. Use the exported prompt-build seam if one exists; if the prompt string is built inline, extract a pure `buildDraftSystemPrompt(input)` first (mechanical refactor, separate commit) so it's testable.
5. Commit(s): `refactor(email): extract draft system prompt builder` (if needed) + `fix(email): pin operator identity in draft prompts`.

### Task A4: New-thread instruction answers the inquiry

**Files:** `ai-draft-service.ts` user-prompt build (the `sourceBoundNewThread` else-branch).

Replace the `"Write a professional business email."` default purpose for the contact-form/new-thread case with: `Purpose: Respond to this new inquiry. Address exactly what the customer asked for or proposed (project type, details, any dates or appointment requests they offered) — never a generic acknowledgement. Propose the concrete next step.` Keep `effectiveUserInstruction` override behavior. Test asserts the contact-form path's user prompt contains the inquiry-answering instruction and not the generic sentence. Commit: `fix(email): make new-thread drafts answer the actual inquiry`.

### Task A5: Writing-profile blend fix

**Files:** `src/lib/api/services/writing-profile-service.ts` (`getProfile` ~809, `blendProfiles` weight); existing writing-profile tests.

1. Standalone threshold `>= 10` → `>= 50` (named const `TYPE_PROFILE_STANDALONE_MIN = 50`).
2. `blendProfiles` weight `emailsAnalyzed / 10` → `emailsAnalyzed / TYPE_PROFILE_STANDALONE_MIN` (clamped 0..1).
3. Tests: 10-email type profile + rich general → blended result dominated by general (assert a general-only marker field wins, e.g. closings from general at 80% weight); 50+ → standalone; no type profile → general (unchanged).
4. Commit: `fix(email): stop thin type profiles shadowing the general writing profile`.

### Task A6: Configured subject from the mailbox setting

**Files:** `email-assignment-contact-form-draft-runtime.ts` (generateDraft wiring), possibly the worker's connection load; tests near the worker/runtime tests (`tests/unit/inbox/` has contact-form tests).

1. Where the runtime builds the `AIDraftService.generateDraft` request, read the connection's `outreach_subject` (the worker already loads the connection via `EmailService.getConnection` — thread it through; extend the `EmailConnection` type mapping if the field isn't carried).
2. `configuredSubject: connection.outreachSubject?.trim() || CONTACT_FORM_OUTREACH_SUBJECT` (existing constant stays as fallback).
3. Also update the worker's literal `"Thanks for reaching out"` fallbacks (lines ~329/555) to use the same resolved value so `ai_draft_history.subject` and the placed draft agree.
4. Tests: with `outreach_subject = "Canpro Deck and Rail Estimate"` the generated request + placed subject use it (`subject_source` stays `"configured"`); null → constant.
5. Commit: `feat(email): per-mailbox outreach subject for new-thread lead drafts`.

### Task A7: Identity gate on contact-form outreach

**Files:** `email-assignment-contact-form-draft-worker.ts` (+ runtime dependency), `email-signature-service.ts` (small helper), tests with the existing worker test harness.

1. First READ `email_signature_notification_lifecycle_outbox` usage + `sync_email_signature_notification_as_system` (git grep both) to understand the existing signature-notification lifecycle. Reuse it if it can deliver "confirm your signature" to the rail; only if it demonstrably cannot, create the notification through the standard notification-service path (persistent, `actionUrl` = the settings Profile tab route — verify the real route in `src/app/`, `actionLabel` copy via ops-copywriter, dedup: one unresolved notification per connection).
2. Add `EmailSignatureService.hasConfirmedIdentity(scope): Promise<boolean>` — true iff an active operator- or mailbox-scope signature row with `confirmed_at IS NOT NULL` exists for the connection (provider-scope alone does NOT satisfy).
3. In the worker, BEFORE `generateDraft`: if not confirmed → trigger the notification (deduped) and throw the existing non-terminal `EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_TEMPORARILY_UNAVAILABLE` path with reason `awaiting_identity_confirmation` so the queue row retries later (mailbox-busy backoff pattern, commit 92344a64 precedent). Assert: queue row stays pending, `attempts` increments, `result_reason`/`last_error` carries the reason string.
4. With confirmed identity → proceeds; pass `signatureWillBeAppended: true` into generation (A3 seam).
5. Tests: unconfirmed → no OpenAI call, queue retried, notification created once across two passes; confirmed → draft generated + signature appended (existing render path).
6. Commit: `feat(email): hold new-lead outreach until sender identity is confirmed`.

### Task A8: Workstream A sweep

`npx vitest run` (full), `npx tsc --noEmit`, lint on touched files. Fix regressions you caused; do NOT chase pre-existing failures (record them in the final report instead). Final commit if stragglers.

---

## Workstream B — Product surface (after A lands on the branch)

> **Skills (mandatory before B1):** load `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`. Read `../ops-design-system/project/DESIGN.md` §voice, §components. Every string through ops-copywriter; every style through tokens.

### Task B1: Signature template module (pure, shared)

**Files:** Create `src/lib/email/signature-template.ts` + `src/lib/email/__tests__/signature-template.test.ts`.

`renderSignatureTemplate(fields: { name: string; title?: string; companyName: string; phone?: string; website?: string; logoUrl?: string | null; layout?: "logo-left" | "stacked" }): { html: string; text: string }`

**Design intent (Jackson): "like a digital business card."** Crisp, restrained, card-like — name prominent, secondary lines muted, tight vertical rhythm. Monochrome only: near-black text + one muted gray for secondary lines and the divider. No colors, no icons, no taglines.

- **Email-client reality:** this is EMAIL HTML — layout must be table-based (Outlook ignores flex/grid), all styling inline via `style` attributes, system font stack, no external CSS. Design-system tokens do not apply inside email HTML.
- **`stacked` layout** (and the only layout when `logoUrl` is absent): name (strong) → title · company line → phone · website line → logo `<img src width="120" alt="{companyName}">` beneath (when present).
- **`logo-left` layout** (DEFAULT when `logoUrl` present): one `<table>` with two cells — left cell: logo `<img width="96">`, `vertical-align: middle`, `border-right: 1px solid` the muted gray, right padding; right cell: left padding + the text block. The divider is the left cell's border — that renders everywhere.
- `text` mirror is layout-independent: name / title, company / phone / website lines.
- **Sanitizer extension (same file as the sanitizer, its own test):** current `sanitizeEmailSignatureHtml` config only extends `img` — verify what the installed `sanitize-html` defaults allow and extend the config minimally so the template survives: table/tbody/tr/td tags (in defaults, verify), `style` attribute on td/div/span/p/strong/img via `allowedStyles` with a TIGHT property allowlist (color, font-family, font-size, line-height, padding*, border*, vertical-align, width, max-width) — regex-constrained values, nothing else (no url(), no position). NOTE: this sanitizer also processes provider-imported Gmail signatures — the extension IMPROVES their fidelity (tables/styles currently get stripped); keep the allowlist minimal all the same.
- Output must survive `sanitizeEmailSignatureHtml` unchanged — assert exact-equality round-trip in tests for BOTH layouts.
- TDD: logo-left full fields; stacked full fields; minimal fields (name+company only); logo null → stacked forced + no img + no layout artifacts; round-trip equality ×2. Commit: `feat(email): OPS signature template renderer`.

### Task B2: Identity settings API

**Files:** Modify `src/app/api/integrations/email/signature/route.ts` (+ its service calls in `email-signature-service.ts`), `src/lib/hooks/use-email-signature.ts`; route tests if the repo tests routes (mirror existing route-test pattern; otherwise service-level tests).

1. Extend the save action to accept `{ fields, includeLogo, layout }` (structured; layout validated to `"logo-left" | "stacked"`, defaulted server-side to `logo-left` when a logo is included) — server loads `companies` identity + `logo_url`, renders via B1 template, sanitizes, stores `content_html`/`content_text`, sets **`confirmed_at = now()`**, `source = 'operator'`. Keep legacy `opsText` accepted (renders text-only paragraph into the same shape) for backward compatibility.
2. Add a `confirm` action for provider-imported signatures. **RESOLVED CONTRADICTION (A7 finding — this supersedes any other reading of decisions #5/#6):** the identity gate only honors operator/mailbox-scope rows, so stamping `confirmed_at` on the provider-scope row would NOT open the gate. The confirm action must instead PROMOTE the imported content: write it as the operator-scope row (same content_html/content_text, the operator source value used by the existing save path, `confirmed_at = now()`), leaving the provider row as the import record. A7's tests lock the gate's scope behavior — do not weaken them; promotion is the fix.
3. Add GET/PUT of `outreach_subject` for the connection (same route module — one identity-settings surface; PUT trims, empty → null). Authorization must mirror the route's existing scope checks.
4. Include `confirmedAt` + `outreachSubject` + `companyLogoUrl` + prefill fields (user first/last name, company name/phone/website) in the GET response so the card renders with zero extra round-trips.
5. Tests: structured save renders template + sets confirmed_at; confirm action; subject PUT/GET round-trip; sanitizer applied. Commit: `feat(settings): email identity API — structured signature, confirm, outreach subject`.

### Task B3: Settings card → identity builder

**Files:** Rewrite `src/components/settings/email-signature-settings.tsx` (keep the component name/mount), update `use-email-signature.ts` mutations.

- Fields (pre-filled from GET): name, title (optional), company, phone, website; logo toggle with thumbnail **only when `companyLogoUrl` exists**; when the logo toggle is ON, a layout control appears with exactly two visual options — "Logo left" (default; business-card arrangement with divider) and "Logo below" — rendered as two small selectable previews, not a dropdown; live preview pane rendering B1 HTML (sandboxed `dangerouslySetInnerHTML` of the template output only — never user-pasted HTML); subject input ("the subject line on first replies to new leads", pre-filled from `outreachSubject`).
- States: unconfigured (prompt to confirm), imported-unconfirmed (show imported signature + CONFIRM + "build instead"), confirmed (compact preview + edit). Gmail import button stays.
- Save = confirm (one action). Show confirmed state change without reload (optimistic per existing hook patterns).
- Copy through ops-copywriter; tokens only (`font-mohave`, `text-body-sm`, `text-text-2`, `text-rose`, existing button/input components from the settings UI kit — reuse `@/components/ui/*`); numbers/`—` conventions; UPPERCASE only per voice spec.
- Component tests per existing settings-component test patterns (there are settings tests under `src/components/settings/__tests__` or `tests/` — mirror them; at minimum: renders prefill, logo toggle hidden without logo, save calls structured mutation, confirm action for imported).
- Commit: `feat(settings): signature builder with logo, confirm flow, outreach subject`.

### Task B4: Post-connect confirmation step

**Files:** Locate the Gmail connect completion surface (`git grep -rn "connect" src/app/**integrations**` / the integrations settings component that initiates OAuth; find where a successful connection lands the user). Add: when a connection completes and `hasConfirmedIdentity` is false, route the user to the identity card (Profile tab deep link with the card highlighted/expanded, or a modal hosting the same component — choose the lighter one that fits the existing flow; reuse the B3 component either way, no duplicate).

Test: after connect-success state with unconfirmed identity, the confirmation surface shows. Commit: `feat(settings): confirm sender identity right after mailbox connect`.

### Task B5: Rail notification deep link

**Files:** A7 landed the notification as type `email_identity_confirmation_required` via `createTrustedNotifications` (dedup key `email-identity-confirmation:{connectionId}:{userId}`, one unresolved per mailbox+operator via the partial unique index), with `actionUrl = /settings?section=profile&connection={id}` — `?section=profile` is already a live section id. Verify end-to-end: notification row → rail renders persistent entry → actionUrl opens the Profile tab; extend `profile-tab.tsx` to honor the `connection` param by scrolling to / highlighting the email-identity card. Test the param behavior. Also mark the notification resolved when identity gets confirmed (find the repo's resolution pattern for persistent notifications and wire it into the B2 confirm/save path). Commit: `feat(settings): deep-link the identity confirmation notification`.

**Handoff notes from Workstream A (verified, act on them):**
- `email-connection-browser-service.ts` does NOT yet map `outreach_subject` — B2/B3 need that mapping for the card's GET prefill.
- The manual draft route `src/app/api/integrations/email/draft/route.ts:388` still uses the hardcoded constant — OUT OF SCOPE for B (operator-initiated path); leave it.
- Worker/service seams available to B: `EmailSignatureService.hasConfirmedIdentity()`, `hasConfirmedEmailIdentity()` (pure), hold reason constant `AWAITING_IDENTITY_CONFIRMATION` exported from the worker module.

### Task B6: Surface sweep

1. Run `custom-skills:audit-design-system` over touched components — zero hardcoded values.
2. `npx vitest run` full, `npx tsc --noEmit`, lint on touched files.
3. Screenshot evidence: run the dev preview (worktree recipe: `npm run dev` variant per `reference_ops_web_worktree_preview` — symlinked env already present) and capture the card's three states + the connect step. Save to `docs/artifacts/` in the worktree.
4. Commit any fixes.

---

## Workstream C — Signature logo studio (2026-08-05, Jackson-requested; builds on the SHIPPED A+B waves)

> Branch `feat/signature-logo-studio` off origin/main (which now equals d648b043). **Skills (mandatory):** `custom-skills:executing-plans`, `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`; `custom-skills:audit-design-system` as the final gate.

**Locked decisions (Jackson):** (1) the builder accepts a CUSTOM signature logo, independent of `companies.logo_url`; (2) background removal is automatic and invisible — upload anything, a solid-color background comes out clean, no button; paid/ML cutout services are OUT (free client-side only). Original is recoverable via an undo affordance shown only when removal was applied.

**Verified facts:** `email_connections.signature_logo_url` (text, nullable) IS ALREADY APPLIED to prod (migration `add_email_connections_signature_logo_url`, 2026-08-05) — hand-add to `database.types.ts`, do NOT re-apply or regen. `renderSignatureTemplate` already takes `logoUrl` as a parameter — the template needs NO changes; only the logo SOURCE resolution changes (custom when set, else company). GOTCHA from lead-media work: this project's storage bucket CORS blocks direct browser PUTs — uploads must round-trip through an API route, never direct-to-storage from the browser.

### Task C1: Types
Hand-add `signature_logo_url` to the `email_connections` block of `src/lib/types/database.types.ts` (Row + Insert/Update optionals) and `signatureLogoUrl` to `src/lib/types/email-connection.ts` + its mapping in `email-connection-service.ts` (and the browser service if it now maps identity fields). `npx tsc --noEmit` clean. Commit: `chore(db): add email_connections.signature_logo_url to types`.

### Task C2: Solid-background removal module (pure core + thin canvas wrapper)
Create `src/lib/images/remove-solid-background.ts` + tests. Split for testability:
- `removeSolidBackgroundFromPixels(data: Uint8ClampedArray, width, height): { applied: boolean }` — PURE, operates in place. Detection: sample every border pixel; if ≥ 90% sit within ΔRGB ≤ 24 (per-channel) of the border's median color, the background is "solid". Removal: BFS flood fill seeded from every border pixel within ΔRGB ≤ 28 of that median, setting alpha 0; 1px feather on the fill boundary (alpha 128 for pixels adjacent to cleared ones that are within 1.5× tolerance). Non-solid border (gradient/photo) → `applied: false`, pixels untouched.
- `removeSolidBackground(file: File): Promise<{ blob: Blob; applied: boolean }>` — browser-only wrapper (createImageBitmap → canvas → pixels → PNG blob). Not unit-tested (jsdom has no canvas); keep it dumb.
TDD the pure core with synthetic fixtures: white field with a colored square (applied, square intact, corners transparent); enclosed white hole inside the logo NOT cleared (fill is edge-seeded — assert); gradient background (untouched, applied false); logo touching the border (its pixels outside tolerance survive). Commit: `feat(images): automatic solid-background removal core`.

### Task C3: Upload + storage route
FIRST investigate how the app already uploads/stores the COMPANY logo (find the writer of `companies.logo_url` in web settings; follow its storage mechanism + validation utilities) and mirror it. Add to the identity settings API surface: `POST` action `upload_signature_logo` (base64 payload ≤ 1 MB decoded, content-type allowlist png/jpeg/webp, decode-validate server-side, store via the existing image storage path pattern, save public URL to `email_connections.signature_logo_url`) and `clear_signature_logo` (null the column; do NOT delete the stored object — history is cheap, broken images in already-sent mail are not). GET response gains `signatureLogoUrl`. Authorization mirrors the route's existing scope checks. Tests per the route's existing test patterns. Commit: `feat(settings): custom signature logo upload`.

### Task C4: Builder integration
`email-signature-settings.tsx`: the logo control becomes source-aware — company-logo thumbnail (as today) plus an UPLOAD action; when a custom logo is set: its thumbnail, and a revert action back to the company logo. Client flow on upload: run `removeSolidBackground` BEFORE the POST; when `applied`, show a quiet inline undo affordance ([brackets] micro-copy, ops-copywriter) that re-uploads the original file on click. Save/confirm path passes the effective logo URL into the structured save so the server renders the template with it (extend `saveStructuredSignature`'s defaults resolution: custom > company). Preview + both layouts unchanged otherwise. Dictionaries en+es. Component tests: custom-logo state, revert, undo-after-removal, save uses custom URL. Commit: `feat(settings): custom logo in the signature builder`.

### Task C5: Sweep
`custom-skills:audit-design-system` (zero hardcoded values), full `npx vitest run`, `npx tsc --noEmit`, lint on touched files, screenshots to `docs/artifacts/sender-identity/` (upload state, custom logo in confirmed card, before/after of a white-background logo). Known pre-existing flakes: sendgrid-onboarding-jack timeouts, openai-quota-alert wall-clock. Commit fixes atomically.

## Verification phase (session owner, not executors)

1. Full suite + tsc green in the worktree; diff review of every commit.
2. Proof-draft harness: generate the four real leads' drafts through the fixed engine (real contexts, Jackson's draft signature + "Canpro Deck and Rail Estimate") — output for Jackson's approval alongside the signature text.
3. Bible update (`ops-software-bible` email/inbox chapter): signature identity system, confirm gate, outreach subject, template builder.
4. Remediation runbook (post-deploy, after Jackson approves signature): save signature via API as Jackson, set subject, supersede the 4 bad `ai_draft_history` rows, delete the 4 Gmail drafts, re-enqueue the 4 queue rows, verify fresh drafts.
