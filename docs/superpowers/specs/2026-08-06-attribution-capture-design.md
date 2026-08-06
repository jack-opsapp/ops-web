# Unified Attribution — Phase 2: Attribution Capture Foundation

**Date:** 2026-08-06
**Status:** Approved (Jackson, 2026-08-06)
**Initiative:** Unified Attribution (P1 App Store Connect ✅ · **P2 capture ← this** · P3a Google Ads ✅ LIVE · P3b–e pending · P4 unified screen)
**Surfaces:** `ops-web`, `ops-site`, `ops-ios`, Supabase (`ops-app` `ijeekuhbatykdomumfjx`)

---

## 1. Problem

Spend-side data flows (Google Ads pipe LIVE since 2026-08-05; App Store Connect built). Nothing ties spend to a paying customer, because **the capture side was never wired**. `trial_attributions` has existed since migration `20260421120000_pmf_tracking.sql` and holds **0 rows** — its only writer is a manual admin backfill route.

Every downstream attribution question ("which channel produced paying customers?") is unanswerable until signups start recording where they came from.

---

## 2. Verified ground truth (re-verified 2026-08-06 against prod + code)

Recon was run before design. Two brief assumptions were **wrong** and are corrected here.

### 2.1 Confirmed as briefed

| Claim | Verified |
|---|---|
| `trial_attributions` exists, 0 rows | ✅ 0 rows. `UNIQUE (company_id)`, FK → `companies(id)`, RLS `trial_attributions_admin_all` on role `public` via `pmf_is_admin(auth.jwt()->>'email')` |
| Columns | ✅ `utm_{source,medium,campaign,content,term}`, `gclid`, `fbclid`, `landing_url`, `trial_started_at NOT NULL`, `first_paid_at`, `attributed_channel NOT NULL DEFAULT 'unknown'`, `created_at`, `updated_at` |
| `deriveAttributionChannel()` exists | ✅ `ops-web/src/lib/pmf/attribution.ts` |
| `__ops_first_touch` cookie + `readCookieFirstTouch()` exist | ✅ `ops-web/src/lib/pmf/utm-capture.ts` — **browser-only** (reads `document.cookie`), written host-only (no `Domain`) |
| Only writer is the admin backfill | ✅ `ops-web/src/app/api/admin/pmf/attributions/seed/route.ts` |
| Live signup paths never write attribution | ✅ Company birth on web = `POST /api/setup/progress` step `company` → `create_company_for_owner` RPC |
| ops-site middleware never WRITES the first-touch cookie | ✅ `ops-site/src/middleware.ts` is locale-routing only |

### 2.2 CORRECTION 1 — `first_paid_at` is already wired

The brief states the Stripe webhook never stamps `first_paid_at`. The **route** doesn't, but the **database does**:

```
TRIGGER billing_events_first_paid AFTER INSERT ON public.billing_events
  FOR EACH ROW EXECUTE FUNCTION pmf_update_first_paid_at()
```

```sql
-- pmf_update_first_paid_at()
if new.event_type = 'invoice.paid' and new.company_id is not null then
  update public.trial_attributions
     set first_paid_at = new.occurred_at, updated_at = now()
   where company_id = new.company_id and first_paid_at is null;
end if;
```

The Stripe webhook already inserts `invoice.paid` into `billing_events` with `company_id` resolved from `companies.stripe_customer_id` (`ops-web/src/app/api/webhooks/stripe/route.ts`, `PMF_TRACKED_EVENTS`). Prod holds **9 real `invoice.paid` rows, all with `company_id` non-null**.

**⇒ No webhook code is written in P2.** The mechanism is correct and lights up automatically once attribution rows exist. Two things are still required and are in scope:
1. A **backfill** for companies that already paid *before* their attribution row existed — the trigger only fires on new inserts, so those rows would sit `first_paid_at IS NULL` forever.
2. **Live proof** the trigger fires end-to-end (§7), not an assumption that it does.

### 2.3 CORRECTION 2 — the funnel does not go where the brief assumes

Every primary CTA on `ops-site` points at the **App Store**, not web signup (`APP_STORE_URL` in `home/Hero.tsx`, `home/FinalCTA.tsx`, `platform/page.tsx`, `plans/page.tsx`, `resources/page.tsx`). `app.opsapp.co` appears only in the Footer "Web App" link and one `/company` button. `platform/page.tsx:12` states it outright: *"no web signup exists"* as a marketing destination.

Measured against prod (companies since 2026-03-01, excluding the 44-company Feb Bubble import):

| Month | Companies | Web setup (`users.setup_progress` non-empty) | Not web |
|---|---|---|---|
| 2026-08 | 1 | 1 | 0 |
| 2026-06 | 7 | 0 | 7 |
| 2026-05 | 4 | 2 | 2 |
| 2026-04 | 2 | 0 | 2 |
| 2026-03 | 5 | 2 | 3 |
| **Total** | **19** | **5 (26%)** | **14 (74%)** |

**⇒ Web-cookie capture alone reaches ~26% of new companies.** This does not make the work wrong — it is the only *deterministic* slice available (no click ID survives the App Store boundary; see `reference_attribution_data_state`). It does mean the architecture must not assume web is the only company-creation path, and it raises the value of the self-reported signal (§4.5).

### 2.4 Additional findings

- **`companies.referral_method` is captured by NO UI on any platform.** iOS has `Company.referralMethod: String?` as a data-model field only; web writes it only via the generic `company-service` mapper. The 7 populated values (`Instagram` ×2, `Other` ×2, `Word of Mouth (Onsite)` ×2, `Internet Advertisement` ×1) are all Bubble-era imports from the Feb 2026 batch — **zero** come from a live question.
- **`ops-site` has a second, silently-broken attribution path.** `ops-site/src/lib/spec/attribution.ts` defines an `ops_attribution` cookie read by `/api/spec/create-checkout-session` and `/spec/checkout/[token]`. **Nothing has ever written it** — so SPEC purchase attribution, Stripe metadata attribution, and `spec_projects.attribution` have all been silently empty. Same root cause as the main bug.
- **Cookie-domain hazard.** `ops-site` serves `opsapp.co`; `ops-web` serves `app.opsapp.co`. A cookie written host-only on `opsapp.co` is **never sent** to `app.opsapp.co`. Any first-touch handoff must set `Domain=.opsapp.co`.
- **The live iOS onboarding flow is `OnboardingGateway`** (rendered from `ContentView.swift:460`), not `OnboardingContainer` (debug-preview only). Owner path: `welcome → rolePick → createAccount → companyName → crewCode → completionGate`. Company creation commits in `CompanyNameStepView`, which already renders **optional single-select chips that explicitly never gate the CTA** (`// PRIMARY TRADE — OPTIONAL`).
- **`ProfileCompanyScreen`, `CompanySetupScreen`, `CompanyDetailsScreen` are dead** in the live flow (self-preview / debug container only). Do not modify them.

---

## 3. Design principles applied

- **Denominator integrity over coverage theatre.** A row for *every* company — including "unknown" — or every downstream rate is silently wrong.
- **Never put analytics on the critical path.** Company creation must never fail because attribution failed.
- **Don't touch the shared RPC.** `create_company_for_owner` is the highest-risk code in the product (both platforms, atomic owner setup). A trigger achieves identical coverage with none of that exposure.
- **Invisible helpfulness.** The referral question rides a step the user is already completing. No new screen, no toggle, no gate.
- **Fix the adjacent instance of the same bug.** Writing the cookie while leaving SPEC reading a name nothing writes would ship a known-broken path next to new code.

---

## 4. Architecture

```
                    ┌──────────────────── ops-site (opsapp.co) ────────────────────┐
  visitor ─────────▶│ middleware: write __ops_first_touch, Domain=.opsapp.co       │
   (utm/gclid)      │            first-touch only — never overwritten              │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │ cookie visible to ALL *.opsapp.co
                    ┌──────────────────────────┴──────────────────────────────────┐
                    ▼                                                              ▼
        ops-web (app.opsapp.co)                                        ops-site /spec checkout
        POST /api/setup/progress                                       reads same cookie
        step=company → company created                                 (compat shim → OpsAttribution)
                    │
                    │  ┌─────────────────────────────────────────────────────────┐
                    ├─▶│ TRIGGER companies_seed_trial_attribution (AFTER INSERT)  │
                    │  │ → trial_attributions row, channel='unknown'              │  ← ALL platforms
                    │  └─────────────────────────────────────────────────────────┘
                    │
                    └─▶ route reads cookie server-side → UPDATE row with
                        utm_*/gclid/fbclid/landing_url + deriveAttributionChannel()

        Stripe invoice.paid → billing_events INSERT
                    └─▶ TRIGGER billing_events_first_paid → stamps first_paid_at   [ALREADY LIVE]
```

### 4.1 Row creation — database trigger, not application code

**Decision:** `AFTER INSERT ON companies` trigger inserts the `trial_attributions` row.

**Rejected alternatives:**
- *Write from the web API route only* — covers 26% of companies (§2.3). iOS-born companies get no row, so `billing_events_first_paid` can never stamp them, so iOS payers are invisible to revenue attribution forever.
- *Add params to `create_company_for_owner`* — would cover both platforms atomically, but requires surgery on the single shared code path that both apps depend on for owner setup. A defect there breaks all signups everywhere. Rejected on risk; the trigger gets the same coverage.

**Contract:**
- Fires `AFTER INSERT ON public.companies`, `FOR EACH ROW`.
- Inserts `(company_id, trial_started_at, attributed_channel='unknown')`.
- `trial_started_at` = `COALESCE(NEW.trial_start_date, NEW.created_at, now())`.
  > Ordering note: `initialize_company_trial_trigger` is a `BEFORE INSERT` trigger on `companies`, so `NEW.trial_start_date` is already populated when this `AFTER INSERT` trigger runs.
- `ON CONFLICT (company_id) DO NOTHING` — idempotent against the `UNIQUE (company_id)` constraint.
- `SECURITY DEFINER`, `SET search_path = public, pg_temp` (matches every existing trigger fn in this schema).
- **Wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING … ; RETURN NEW;`** — a telemetry side-effect must never abort company creation. This is a deliberate priority call, not a shortcut.
- Ignores soft-deleted rows? **No** — insert always; `deleted_at` is set later by other paths and the FK/analytics layer filters on it.

### 4.2 Backfill (same migration)

1. Insert a `trial_attributions` row for all **63** existing live companies missing one (channel `unknown`, `trial_started_at` from the company).
2. Stamp `first_paid_at` on those rows from the earliest existing `billing_events` row where `event_type='invoice.paid'` — closing the ordering gap in §2.2. Prod holds 9 such events.
3. Legacy `referral_method` values are **left untouched** (§4.5).

### 4.3 First-touch cookie — one name, one scope

**Canonical cookie: `__ops_first_touch`, `Domain=.opsapp.co`, `Path=/`, `SameSite=Lax`, `Secure` (prod), 30-day TTL, JSON payload, not `HttpOnly`.**

`__ops_first_touch` wins over `ops_attribution` because its payload is a strict superset (adds `referrer`, `utm_content`, `utm_term`) and it is the shape `ops-web` already parses.

| Repo | Change |
|---|---|
| `ops-site` | Middleware **writes** it on every page response when absent. |
| `ops-site` | `readAttributionCookie()` gains a fallback: if `ops_attribution` is absent, read `__ops_first_touch` and map `captured_at → first_touch_at`. Fixes SPEC checkout attribution (§2.4). |
| `ops-web` | `writeCookieFirstTouch()` sets `Domain=.opsapp.co` in production (host-only on `localhost`, where a dotted domain is invalid). Prevents two same-named cookies at different scopes shadowing each other. |
| `ops-web` | New **server-side** reader (`NextRequest.cookies`) — the existing reader is `document.cookie`-only and unusable in a route handler. Shares one parse/sanitize function with the browser reader. |

**First-touch semantics:** the cookie is written only when absent. A visitor who lands on `opsapp.co?gclid=…` then navigates to `app.opsapp.co` keeps the original credit — `ops-web`'s `captureOnLanding()` no-ops because the cookie already exists.

**CDN-cache safety.** `ops-site/src/middleware.ts` carries an explicit warning: *"do not set a response cookie here; public marketing pages must remain CDN-cacheable."* That warning is about the **locale** cookie, which makes responses vary by user state. The first-touch cookie does not alter rendered content, and Vercel executes middleware per-request (never served from the edge cache), so the `Set-Cookie` is generated fresh per visitor and cannot be cached across visitors. This must be **verified against a real response**, not assumed (§7).

### 4.4 Web capture point

`POST /api/setup/progress`, `step === "company"`, **after** `companyId` is resolved — covering *all three* branches (new company via RPC, `update_company_setup_for_member`, and the legacy service-role update path), so a resumed/partial signup still records.

- Cookie is read **server-side from the request** — no client change, no body field to spoof independently of the cookie.
- `deriveAttributionChannel()` computes `attributed_channel` (one source of truth, shared with the admin backfill route).
- Write is an **UPDATE** of the trigger-created row, guarded so it never overwrites an already-attributed row (first-touch), and never fails the request.
- Uses the service-role client (RLS on `trial_attributions` is admin-only).

### 4.5 Referral question — web + iOS, optional

**Label (both platforms):** `// HOW'D YOU FIND US — OPTIONAL`
Mirrors the established `// PRIMARY TRADE — OPTIONAL` pattern verbatim: JetBrains Mono 11pt metadata, `text3`, `tracking 1.4`.

**Option set** — stored as stable slugs, rendered from a shared constant per platform:

| Slug | Label |
|---|---|
| `instagram` | Instagram |
| `facebook` | Facebook |
| `youtube` | YouTube |
| `google` | Google |
| `app_store` | App Store |
| `word_of_mouth` | Someone told me |
| `other` | Other |

Slugs (not labels) are stored so user-facing copy can change without breaking historical aggregation.

**Legacy values are NOT rewritten.** The 7 Bubble-era rows keep their original strings; `Internet Advertisement` cannot be mapped to a new slug without guessing, and rewriting self-reported customer data on a guess is wrong. Normalization happens at read time when the P4 dashboard is built.

**Placement:**
- **iOS** — a second optional chip row in `CompanyNameStepView`, directly under the trade chips, using the same chip component and the same never-gates-the-CTA contract. Persisted through the existing company-creation path.
- **Web** — an optional single-select in the existing `company` step of the setup wizard (already collects name / industries / size / age / weather-dependent). Persisted by `/api/setup/progress` to `companies.referral_method`.

Not selecting is the skip. No skip button, no dismissal — nothing to interact with if the user doesn't care.

---

## 5. Out of scope (explicitly, with reasons)

- **`try-ops`** — not checked out locally (GitHub-only) and ads have been off since 2026-03-09. A `.opsapp.co` cookie written there *would* reach the app; worth a follow-up phase.
- **iOS AdServices / Apple Search Ads token capture** — P3c/P3d.
- **The unified attribution dashboard** — P4. P2 writes data; it does not render it.
- **Making web signup a real marketing CTA** — a product/marketing decision for Jackson, not an engineering change. Until it happens, most signups remain channel-attributable only via the self-reported answer.

---

## 6. Testing

| Layer | Coverage |
|---|---|
| Unit (`ops-web`) | server-side cookie parse: valid / absent / malformed JSON / non-string field coercion / oversized payload; `deriveAttributionChannel` mapping for gclid, fbclid, utm_source variants, empty → `direct` |
| Unit (`ops-web`) | `writeCookieFirstTouch` emits `Domain=.opsapp.co` in prod, omits it on localhost |
| Unit (`ops-site`) | middleware writes cookie when absent; does NOT overwrite when present; writes across all three routing branches (rewrite / redirect / next) |
| Unit (`ops-site`) | `readAttributionCookie` falls back to `__ops_first_touch` and maps `captured_at → first_touch_at`; prefers `ops_attribution` when both exist |
| Integration (`ops-web`) | `/api/setup/progress` step=company writes attribution from the request cookie; no cookie → row stays `unknown`; does not overwrite an already-attributed row; a failing attribution write does not fail the request |
| DB | trigger creates a row on company insert; is idempotent; does not abort company creation when the insert raises |
| iOS | `CompanyNameStepView` — referral chips never gate the CTA; selection persists; deselection clears |

---

## 7. Verification (evidence required before "done")

Claims are not accepted without observed output.

1. **Migration applied to prod** — re-query row counts: `trial_attributions` = 63 (was 0).
2. **Trigger proof** — create a throwaway company in prod, confirm a row appears with `attributed_channel='unknown'`, then delete it.
3. **`first_paid_at` proof** — confirm the backfill stamped the companies with existing `invoice.paid` events; confirm counts against `billing_events`.
4. **Cookie proof** — run `ops-site` locally, hit a page with `?utm_source=…&gclid=…`, capture the actual `Set-Cookie` response header showing `Domain=.opsapp.co`; confirm a second request does not overwrite it.
5. **CDN-safety proof** — confirm the marketing-page response carries no `Cache-Control: public` + `Set-Cookie` combination that could be shared across visitors.
6. **End-to-end proof** — with the cookie set, run web company setup against the local app and observe the `trial_attributions` row populated with the UTM values and a derived channel.
7. **iOS proof** — build; screenshot the referral chips on `CompanyNameStepView`; confirm the CTA is enabled with nothing selected.
8. Test suites green (`ops-web` vitest, `ops-site` vitest, iOS test target). **CI is not a gate** in this repo (lint has failed since ~2026-05-28) — run locally and report actual output.

---

## 8. Rollout

Commits land on `feat/attribution-capture` (`ops-web`), `feat/attribution-first-touch` (`ops-site`), and `main` (`ops-ios`, local). Migration applies directly to prod (low-tenant; per `project_ops_prod_low_tenant_direct_migrations`).

**Pushing `ops-web`/`ops-site` `main` auto-deploys to real customers and requires Jackson's explicit GO.** The iOS referral chips reach users only on the next App Store release.

Bible updates (same session): `04_API_AND_INTEGRATION.md` (attribution capture contract) and the PMF/attribution section documenting the trigger and cookie contract.
