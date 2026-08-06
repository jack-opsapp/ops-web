# Attribution Capture (P2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make every new OPS company record where it came from, so ad spend can be tied to paying customers.

**Architecture:** A database trigger on `companies` creates a `trial_attributions` row for every company on every platform (channel `unknown`). `ops-site` middleware writes a single first-touch cookie scoped to `.opsapp.co` so it survives the hop to `app.opsapp.co`; the web company-setup route reads that cookie server-side and upgrades the row with real UTM/click-id data. `first_paid_at` already stamps itself via the existing `billing_events_first_paid` trigger — no webhook code. An optional referral question on web + iOS captures the one signal that survives the App Store boundary.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Supabase Postgres + RLS · vitest (`ops-web`) · `tsx --test` / node test runner (`ops-site`) · SwiftUI + XCTest (`ops-ios`)

**Design System:** `ops-web-attribution-capture/.interface-design/system.md` + `ops-design-system/project/DESIGN.md`; iOS also `ops-design-system/project/mobile/MOBILE.md`

**Spec:** `docs/superpowers/specs/2026-08-06-attribution-capture-design.md`

**Required Skills:** `ops-design` (both UI tasks) · `custom-skills:audit-design-system` (before UI is called done) · `ops-copywriter` (copy already locked in the spec — do not re-invent) · `custom-skills:mobile-ux-design` (Task 8)

**Worktrees (already created — do NOT touch primary checkouts, they hold sibling sessions' WIP):**
| Repo | Path | Branch |
|---|---|---|
| ops-web | `/Users/jacksonsweet/Projects/OPS/ops-web-attribution-capture` | `feat/attribution-capture` |
| ops-site | `/Users/jacksonsweet/Projects/OPS/ops-site-attribution-capture` | `feat/attribution-first-touch` |
| ops-ios | `/Users/jacksonsweet/Projects/OPS/ops-ios` | `main` (clean, work directly) |

**Prod Supabase:** `ops-app` / `ijeekuhbatykdomumfjx`

---

## Task 1: Database trigger + backfill

**Files:**
- Create: `supabase/migrations/20260806120000_attribution_capture_trigger.sql` (ops-web worktree)
- Apply via: Supabase MCP `apply_migration`, name `attribution_capture_trigger`

**Step 1: Capture the "before" counts**

```sql
select (select count(*) from trial_attributions) as attr_rows,
       (select count(*) from companies where deleted_at is null) as companies,
       (select count(*) from trial_attributions where first_paid_at is not null) as paid_stamped;
```
Expected before: `attr_rows = 0`, `companies = 63`, `paid_stamped = 0`.

**Step 2: Write the migration**

```sql
-- Attribution capture (Unified Attribution P2).
--
-- Every company — web, iOS, or any future path — gets a trial_attributions row
-- at birth so the attribution denominator is whole and so the existing
-- billing_events_first_paid trigger has a row to stamp. Web later upgrades the
-- row with real UTM/click-id data read from the first-touch cookie.
--
-- The insert is deliberately non-fatal: company creation must NEVER fail
-- because an analytics side-effect failed.

create or replace function public.seed_trial_attribution_for_company()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  begin
    insert into public.trial_attributions (company_id, trial_started_at, attributed_channel)
    values (
      new.id,
      coalesce(new.trial_start_date, new.created_at, now()),
      'unknown'
    )
    on conflict (company_id) do nothing;
  exception when others then
    -- Telemetry must never abort company creation.
    raise warning 'seed_trial_attribution_for_company failed for company %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- AFTER INSERT: initialize_company_trial_trigger is BEFORE INSERT, so
-- new.trial_start_date is already populated by the time this runs.
drop trigger if exists companies_seed_trial_attribution on public.companies;
create trigger companies_seed_trial_attribution
  after insert on public.companies
  for each row execute function public.seed_trial_attribution_for_company();

-- ── Backfill 1: a row for every existing live company ──
insert into public.trial_attributions (company_id, trial_started_at, attributed_channel)
select c.id,
       coalesce(c.trial_start_date, c.created_at, now()),
       'unknown'
from public.companies c
where c.deleted_at is null
on conflict (company_id) do nothing;

-- ── Backfill 2: stamp first_paid_at from invoices that predate the row ──
-- billing_events_first_paid only fires on NEW inserts, so companies that
-- already paid would sit NULL forever.
update public.trial_attributions ta
   set first_paid_at = f.first_paid,
       updated_at    = now()
from (
  select company_id, min(occurred_at) as first_paid
  from public.billing_events
  where event_type = 'invoice.paid' and company_id is not null
  group by company_id
) f
where ta.company_id = f.company_id
  and ta.first_paid_at is null;
```

**Step 3: Apply to prod**

Use Supabase MCP `apply_migration` (project `ijeekuhbatykdomumfjx`, name `attribution_capture_trigger`).

**Step 4: Verify the counts moved**

Re-run the Step 1 query. Expected: `attr_rows = 63`, `paid_stamped` > 0 and equal to the number of distinct companies with an `invoice.paid` event.

Cross-check:
```sql
select count(distinct company_id) from billing_events
where event_type='invoice.paid' and company_id is not null;
```
Must equal `paid_stamped`.

**Step 5: Prove the trigger fires (live, then clean up)**

```sql
insert into companies (name) values ('__attr_trigger_probe__') returning id;
-- then
select company_id, attributed_channel, trial_started_at
from trial_attributions where company_id = '<returned id>';
-- must return exactly one row, channel 'unknown'
delete from trial_attributions where company_id = '<returned id>';
delete from companies where id = '<returned id>';
```
Confirm the probe rows are gone afterwards.

**Step 6: Commit**

```bash
git add supabase/migrations/20260806120000_attribution_capture_trigger.sql
git commit -m "feat(attribution): seed a trial_attributions row for every company

An AFTER INSERT trigger on companies covers web, iOS and any future creation
path, so the attribution denominator is whole and billing_events_first_paid
has a row to stamp. The insert is non-fatal by design — analytics must never
block company creation. Backfills all existing companies and stamps
first_paid_at from invoices that predate the row."
```

---

## Task 2: Shared cookie parse + server-side reader (ops-web)

The existing `readCookieFirstTouch()` reads `document.cookie` and is unusable in a route handler. Extract the sanitize logic and add a server reader that takes a plain cookie string.

**Files:**
- Modify: `src/lib/pmf/utm-capture.ts`
- Test: `tests/unit/pmf/utm-capture.test.ts` (exists — extend it)

**Step 1: Write the failing tests**

Append to `tests/unit/pmf/utm-capture.test.ts`:

```ts
describe("parseFirstTouchValue", () => {
  it("parses a valid encoded payload", () => {
    const raw = encodeURIComponent(JSON.stringify({
      utm_source: "google", gclid: "abc123", captured_at: "2026-08-06T00:00:00.000Z",
    }));
    const parsed = parseFirstTouchValue(raw);
    expect(parsed?.utm_source).toBe("google");
    expect(parsed?.gclid).toBe("abc123");
  });

  it("returns null for malformed JSON", () => {
    expect(parseFirstTouchValue("%7Bnot-json")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseFirstTouchValue(encodeURIComponent(JSON.stringify([1, 2])))).toBeNull();
  });

  it("coerces non-string fields to undefined", () => {
    const raw = encodeURIComponent(JSON.stringify({ utm_source: 123, utm_medium: "cpc" }));
    const parsed = parseFirstTouchValue(raw);
    expect(parsed?.utm_source).toBeUndefined();
    expect(parsed?.utm_medium).toBe("cpc");
  });

  it("truncates oversized values rather than storing unbounded text", () => {
    const raw = encodeURIComponent(JSON.stringify({ utm_campaign: "x".repeat(1000) }));
    expect(parseFirstTouchValue(raw)?.utm_campaign?.length).toBe(512);
  });
});

describe("readServerFirstTouch", () => {
  it("reads the cookie from a request-style cookie store", () => {
    const value = encodeURIComponent(JSON.stringify({ utm_source: "meta" }));
    const store = { get: (n: string) => (n === "__ops_first_touch" ? { value } : undefined) };
    expect(readServerFirstTouch(store)?.utm_source).toBe("meta");
  });

  it("returns null when the cookie is absent", () => {
    expect(readServerFirstTouch({ get: () => undefined })).toBeNull();
  });
});
```

Add `parseFirstTouchValue, readServerFirstTouch` to the file's import from `@/lib/pmf/utm-capture`.

**Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/pmf/utm-capture.test.ts
```
Expected: FAIL — `parseFirstTouchValue is not a function`.

**Step 3: Implement**

In `src/lib/pmf/utm-capture.ts`, add `MAX_FIELD_LEN = 512`, export `parseFirstTouchValue(raw: string): FirstTouch | null` holding the sanitize logic currently inline in `readCookieFirstTouch` (plus truncation), then rewrite `readCookieFirstTouch` to delegate to it. Add:

```ts
/** Minimal shape of both `NextRequest.cookies` and Next's `cookies()` store. */
export interface ServerCookieStore {
  get(name: string): { value: string } | undefined;
}

/**
 * Server-side twin of readCookieFirstTouch — the browser reader is
 * document.cookie-only and unusable inside a route handler.
 */
export function readServerFirstTouch(cookies: ServerCookieStore): FirstTouch | null {
  const raw = cookies.get(COOKIE)?.value;
  return raw ? parseFirstTouchValue(raw) : null;
}
```

Export `COOKIE` as `FIRST_TOUCH_COOKIE` so other modules stop hardcoding the name.

**Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/pmf/utm-capture.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/pmf/utm-capture.ts tests/unit/pmf/utm-capture.test.ts
git commit -m "feat(attribution): add a server-side first-touch cookie reader

The existing reader is document.cookie-only, so route handlers had no way to
read first-touch. Extracts the sanitize/parse step into one shared function
(now length-bounded) used by both readers."
```

---

## Task 3: ~~Scope the ops-web cookie to `.opsapp.co`~~ — SUPERSEDED (done differently in Task 2)

**Status: resolved during execution. No separate work item.**

The plan called for `ops-web`'s client-side `writeCookieFirstTouch` to emit `Domain=.opsapp.co`. Executing it surfaced two problems:

1. **It breaks the existing tests for the wrong reason.** The vitest jsdom origin is `http://localhost/` (set deliberately in `vitest.config.ts` so `localStorage` works). The existing round-trip tests override `window.location` to `app.opsapp.co`, but jsdom's cookie jar is keyed on the real document origin — so a `Domain=.opsapp.co` cookie is rejected and `readCookieFirstTouch()` returns null.
2. **The narrower scope is actually correct.** `ops-web`'s client writer is documented as defensive-only ("most users land on the marketing site; this catches the rare case where a UTM-tagged URL hits app.opsapp.co directly"). Its cookie only ever needs to be read back by `ops-web` itself. The cross-domain handoff is entirely the **ops-site writer's** job (Task 5), which does set `Domain=.opsapp.co`. Broadening a cookie's scope without need is the wrong default.

**What the real risk was, and how it is handled:** a host-only cookie and a `.opsapp.co` cookie *can* coexist under the same name (user lands on `app.opsapp.co` first, later visits `opsapp.co`). A parsed cookie store surfaces only one of them, chosen by browser ordering. That is fixed properly in Task 2: `readServerFirstTouch` takes the **raw `Cookie` header**, parses every occurrence, and returns the one with the earliest `captured_at` — so first-touch is deterministic rather than ordering-dependent. Covered by the `picks the EARLIEST captured_at` and `skips malformed duplicates` tests.

---

## Task 4: Write attribution at web company creation

**Files:**
- Create: `src/lib/pmf/record-trial-attribution.ts`
- Modify: `src/app/api/setup/progress/route.ts`
- Test: `tests/integration/setup-progress-attribution.test.ts`

**Step 1: Write the failing tests**

Cover: (a) cookie present → row updated with utm values + derived channel; (b) no cookie → row untouched, stays `unknown`; (c) row already attributed → NOT overwritten (first-touch); (d) a throwing Supabase client does NOT fail the request (still 200).

**Step 2: Run — expect failure.**

**Step 3: Implement the helper**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAttributionChannel } from "./attribution";
import type { FirstTouch } from "./utm-capture";

/**
 * Upgrade a company's trial_attributions row with real first-touch data.
 *
 * The row itself is created by the companies_seed_trial_attribution trigger,
 * so this is always an UPDATE. Guarded to `attributed_channel = 'unknown'`
 * so a first touch is never overwritten by a later one.
 *
 * NEVER throws: attribution is a side-effect of signup, not a precondition.
 */
export async function recordTrialAttribution(
  db: SupabaseClient,
  companyId: string,
  touch: FirstTouch | null
): Promise<void> {
  if (!touch) return;
  try {
    const attributed_channel = deriveAttributionChannel({
      utm_source: touch.utm_source, utm_medium: touch.utm_medium,
      utm_campaign: touch.utm_campaign, gclid: touch.gclid,
      fbclid: touch.fbclid, landing_url: touch.landing_url,
      referrer: touch.referrer,
    });
    if (attributed_channel === "unknown") return; // nothing to upgrade to

    const { error } = await db
      .from("trial_attributions")
      .update({
        utm_source: touch.utm_source ?? null,
        utm_medium: touch.utm_medium ?? null,
        utm_campaign: touch.utm_campaign ?? null,
        utm_content: touch.utm_content ?? null,
        utm_term: touch.utm_term ?? null,
        gclid: touch.gclid ?? null,
        fbclid: touch.fbclid ?? null,
        landing_url: touch.landing_url ?? null,
        attributed_channel,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("attributed_channel", "unknown");
    if (error) console.error("[attribution] update failed:", error.message);
  } catch (e) {
    console.error("[attribution] unexpected failure:", e);
  }
}
```

**Step 4: Wire the route**

In `src/app/api/setup/progress/route.ts`, inside `if (step === "company" && data)`, immediately after the existing `if (!companyId) { return failClosed("company_id_missing", …) }` guard (so it covers all three creation/update branches):

```ts
// Attribution capture (P2). Read server-side from the request cookie — the
// row already exists (companies_seed_trial_attribution); this upgrades it.
await recordTrialAttribution(db, companyId, readServerFirstTouch(req.cookies));
```

**Step 5: Run — expect pass.**

```bash
npx vitest run tests/integration/setup-progress-attribution.test.ts
```

**Step 6: Commit**

```bash
git add src/lib/pmf/record-trial-attribution.ts src/app/api/setup/progress/route.ts tests/integration/setup-progress-attribution.test.ts
git commit -m "feat(attribution): record first-touch at web company creation

Reads the first-touch cookie server-side from the request and upgrades the
trigger-created trial_attributions row. Guarded to unknown-channel rows so a
first touch is never overwritten, and never throws — signup must not fail
because attribution did."
```

---

## Task 5: ops-site writes the first-touch cookie

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-site-attribution-capture`

**Files:**
- Create: `src/lib/attribution/first-touch.ts`
- Modify: `src/middleware.ts`
- Test: `src/lib/__tests__/first-touch.test.ts` (must live here — `package.json`'s `test` script globs `src/lib/__tests__/*.test.ts`)

**Step 1: Write the failing tests** (node test runner, `node:test` + `node:assert`)

Cover: builds a payload from UTM/gclid params; sets `Domain=.opsapp.co`, `Path=/`, `SameSite=Lax`, 30-day `Max-Age`; returns null when a cookie already exists (first-touch preserved); still captures `landing_url` + `captured_at` on an untagged first visit.

**Step 2: Run — expect failure**

```bash
npm test
```

**Step 3: Implement `src/lib/attribution/first-touch.ts`**

Mirror the `ops-web` `FirstTouch` shape exactly (`utm_source|medium|campaign|content|term`, `gclid`, `fbclid`, `landing_url`, `referrer`, `captured_at`). Export `FIRST_TOUCH_COOKIE = "__ops_first_touch"`, `buildFirstTouch(url, referrer)`, and `writeFirstTouchCookie(res, payload)` using `res.cookies.set({ name, value, domain: ".opsapp.co", path: "/", maxAge: 30*24*60*60, sameSite: "lax", httpOnly: false, secure: NODE_ENV === "production" })`.

> `httpOnly: false` is deliberate and matches ops-web — the browser reader needs access.
> `landing_url` stores the full absolute URL (ops-web's shape), not the path-only form the old `ops_attribution` helper used.

**Step 4: Wire the middleware**

`src/middleware.ts` returns from four branches. Refactor so every branch funnels through one helper before returning:

```ts
/** First-touch attribution (P2). Written on the FIRST page response only and
 *  scoped to .opsapp.co so app.opsapp.co can read it at signup. Does not vary
 *  page content, so it is safe alongside CDN caching. */
function withFirstTouch(res: NextResponse, request: NextRequest): NextResponse {
  if (request.cookies.get(FIRST_TOUCH_COOKIE)) return res;
  writeFirstTouchCookie(res, buildFirstTouch(request.nextUrl, request.headers.get("referer") ?? ""));
  return res;
}
```

Wrap all four returns: `return withFirstTouch(NextResponse.redirect(url, 308), request)` etc.

**Step 5: Run — expect pass** (`npm test`).

**Step 6: Commit**

```bash
git add src/lib/attribution/first-touch.ts src/lib/__tests__/first-touch.test.ts src/middleware.ts
git commit -m "feat(attribution): write the first-touch cookie at landing

The marketing site read attribution but never wrote it, so every downstream
consumer saw nothing. Writes once per visitor, scoped to .opsapp.co so the
app can read it at signup, across all four middleware routing branches."
```

---

## Task 6: Fix SPEC checkout's silently-empty attribution read

`ops_attribution` is read by SPEC checkout but has never been written by anything. Make the reader fall back to the cookie that now exists.

**Files:**
- Modify: `src/lib/spec/attribution.ts` (`readAttributionCookie`)
- Test: `src/lib/__tests__/first-touch.test.ts`

**Step 1: Write the failing tests**

Cover: falls back to `__ops_first_touch` when `ops_attribution` is absent, mapping `captured_at → first_touch_at`; prefers `ops_attribution` when both exist; returns `{}` when neither exists.

**Step 2: Run — expect failure.**

**Step 3: Implement** — in `readAttributionCookie`, when `ops_attribution` is missing, read `FIRST_TOUCH_COOKIE`, parse, and map `captured_at → first_touch_at` before `sanitize()`.

**Step 4: Run — expect pass.**

**Step 5: Commit**

```bash
git add src/lib/spec/attribution.ts src/lib/__tests__/first-touch.test.ts
git commit -m "fix(spec): read attribution from the cookie that is actually written

SPEC checkout read ops_attribution, which nothing has ever written — so Stripe
metadata and spec_projects.attribution were always empty. Falls back to the
canonical first-touch cookie."
```

---

## Task 7: Referral question on web

> **Skills:** `ops-design` for tokens; `custom-skills:audit-design-system` before calling it done. Copy is locked by the spec — do not re-word.

**Files:**
- Create: `src/lib/data/referral-sources.ts`
- Modify: `src/components/setup/SetupIdentityStep.tsx` (`IdentityStep2`)
- Modify: `src/stores/setup-store.ts` (add `referralMethod`)
- Modify: `src/app/(onboarding)/setup/page.tsx` (pass through + include in the `company` step payload)
- Modify: `src/app/api/setup/progress/route.ts` (persist to `companies.referral_method`)
- Test: `tests/unit/pmf/referral-sources.test.ts`

**Design tokens (match the sibling fields exactly — `TEAM SIZE` / `YEARS IN BUSINESS` / `WEATHER-DEPENDENT?`):**
- Group label: `font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block`
- Options: the existing `SelectorButton` component in the same file. No new component, no new tokens.

**Step 1: Create the shared option set**

```ts
/** Referral sources offered at signup. Slugs are stored (not labels) so copy
 *  can change without breaking historical aggregation. Legacy Bubble-era
 *  free-text values are intentionally left un-migrated. */
export const REFERRAL_SOURCES = [
  { slug: "instagram",     label: "Instagram" },
  { slug: "facebook",      label: "Facebook" },
  { slug: "youtube",       label: "YouTube" },
  { slug: "google",        label: "Google" },
  { slug: "app_store",     label: "App Store" },
  { slug: "word_of_mouth", label: "Someone told me" },
  { slug: "other",         label: "Other" },
] as const;

export type ReferralSourceSlug = (typeof REFERRAL_SOURCES)[number]["slug"];
export const REFERRAL_SOURCE_SLUGS: readonly string[] = REFERRAL_SOURCES.map((s) => s.slug);
export function isReferralSourceSlug(v: unknown): v is ReferralSourceSlug {
  return typeof v === "string" && REFERRAL_SOURCE_SLUGS.includes(v);
}
```

**Step 2: Test it** — slugs unique, labels non-empty, `isReferralSourceSlug` accepts every slug and rejects `"Instagram"` / `""` / `null`. Run `npx vitest run tests/unit/pmf/referral-sources.test.ts`.

**Step 3: Add the UI block** in `IdentityStep2`, after the weather-dependent group:

```tsx
<div role="group" aria-label="How you found us (optional)">
  <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em] mb-1 block">
    HOW&apos;D YOU FIND US? (OPTIONAL)
  </label>
  <div className="flex flex-wrap gap-1">
    {REFERRAL_SOURCES.map((src) => (
      <SelectorButton
        key={src.slug}
        label={src.label}
        selected={referralMethod === src.slug}
        onClick={() => onUpdate({ referralMethod: referralMethod === src.slug ? "" : src.slug })}
      />
    ))}
  </div>
</div>
```

Selecting the active chip clears it — deselection is the skip. Nothing gates Continue.

**Step 4: Thread the value** — add `referralMethod: string` to `SetupState` (default `""`) and to `setCompanyInfo`'s `Partial<Pick<…>>`; pass it into `IdentityStep2` and include it in the `data` payload sent for `step: "company"`.

**Step 5: Persist it** — in `route.ts`, extend `ProgressBody["data"]` with `referralMethod?: string`, and in the company branch write it to `companies.referral_method` **only when it passes `isReferralSourceSlug`** (never trust a raw client string). Apply it in all three branches alongside the existing `extraUpdates` / `companyUpdates` writes.

**Step 6: Run the full unit + integration suites; typecheck**

```bash
npx vitest run tests/unit tests/integration
npx tsc --noEmit
```

**Step 7: Audit + commit**

Run `custom-skills:audit-design-system` over the changed component — expect zero hardcoded colour/spacing/radius/font values.

```bash
git add src/lib/data/referral-sources.ts src/components/setup/SetupIdentityStep.tsx src/stores/setup-store.ts "src/app/(onboarding)/setup/page.tsx" src/app/api/setup/progress/route.ts tests/unit/pmf/referral-sources.test.ts
git commit -m "feat(attribution): ask how owners found us during web setup

The only acquisition signal that survives the App Store boundary was captured
by no screen on any platform. Rides the existing company step as an optional
single-select; stores a stable slug so copy can change without breaking
historical aggregation."
```

---

## Task 8: Referral question on iOS

> **Skills:** `ops-design` + `custom-skills:mobile-ux-design`. Read `ops-design-system/project/mobile/MOBILE.md`.
> **Repo:** `/Users/jacksonsweet/Projects/OPS/ops-ios` on `main`. Check `git status` is clean before starting and never stage files you did not change.

**Files:**
- Create: `OPS/Onboarding/Models/ReferralSource.swift`
- Modify: `OPS/Onboarding/Screens/CompanyNameStepView.swift`
- Modify: the company-creation boundary/manager path so the selection persists to `companies.referral_method`
- Test: the existing `CompanyNameStepView` test target

**Design tokens** — mirror the existing `tradeBlock` exactly:
- Label: `OPSStyle.Typography.metadata` (JetBrains Mono 11pt), `OPSStyle.Colors.text3`, `.tracking(1.4)`
- Chips: the same chip view the trade row uses (`chipRadius`, `surfaceInput`, hairline border, 36pt min height)
- Spacing: `OPSStyle.Layout.spacing2_5` inside the block, `spacing4` between blocks

**Step 1: Create the option set** — `ReferralSource` enum with the **same seven slugs and labels as web** (`instagram`/Instagram … `other`/Other). Slug is the stored raw value.

**Step 2: Write the failing tests** — CTA stays enabled with nothing selected; selecting sets the slug; re-tapping the selected chip clears it; the selection reaches the company-creation call.

**Step 3: Run — expect failure.**

**Step 4: Implement**

Add `@State private var selectedReferral: String?` and a `referralBlock` directly under `tradeBlock` in `scrollContent`:

```swift
Text("// HOW'D YOU FIND US — OPTIONAL")
    .font(OPSStyle.Typography.metadata)
    .foregroundColor(OPSStyle.Colors.text3)
    .tracking(1.4)
    .accessibilityLabel("How'd you find us, optional")
```

Extend `CompanyCreationBoundary.createCompany` with a `referralSource: String?` argument and carry it to `OnboardingManager.createCompanyViaRPC()`, which writes `companies.referral_method` after the RPC returns (the same place the existing web-only extras are persisted). Update the stub boundary and the debug preview call sites.

> Do **not** change `create_company_for_owner` itself — the referral write is a follow-up update, matching how web persists `company_size` / `company_age`.
> Do **not** touch `ProfileCompanyScreen`, `CompanySetupScreen`, or `CompanyDetailsScreen` — all dead in the live `OnboardingGateway` flow.

**Step 5: Run tests + build**

Check no sibling session is using DerivedData (`lsof` / running `xcodebuild`) before building. Use a session-local DerivedData path.

**Step 6: Screenshot proof** — capture `CompanyNameStepView` via the existing DEBUG snapshot harness (`snapshotBody`) showing both chip rows and an enabled CTA with nothing selected. Save to `docs/artifacts/`.

**Step 7: Commit**

```bash
git add OPS/Onboarding/Models/ReferralSource.swift OPS/Onboarding/Screens/CompanyNameStepView.swift <boundary/manager files> <test files>
git commit -m "feat(onboarding): ask how owners found us at company creation

iOS is ~74% of signups and captured no acquisition signal at all. Adds an
optional chip row under the trade chips using the same never-gates-the-CTA
contract, storing the same slugs as web so answers aggregate across platforms."
```

---

## Task 9: Update the bible

**Files:**
- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md` — attribution capture contract (cookie name/scope/shape, where it is written and read, the setup/progress capture point)
- Modify: the PMF/attribution section — document `companies_seed_trial_attribution`, the existing `billing_events_first_paid` trigger, the referral slug vocabulary, and that legacy `referral_method` values are un-migrated and need read-time normalization in P4

**Commit** separately (`docs(bible): …`) — atomic commits, one logical change each.

---

## Task 10: Verification pass (evidence, not claims)

Produce observed output for every item in spec §7. Nothing is reported as done without it.

1. Prod row counts before/after (Task 1 Steps 1 & 4).
2. Trigger probe output (Task 1 Step 5), with cleanup confirmed.
3. `first_paid_at` backfill count vs distinct paid companies.
4. Real `Set-Cookie` header from `ops-site` dev showing `Domain=.opsapp.co`, plus a second request proving no overwrite.
5. CDN-safety check on the marketing-page response headers.
6. End-to-end: cookie set → web company setup → `trial_attributions` row shows the UTM values and a derived channel.
7. iOS screenshot (Task 8 Step 6).
8. Test output: `npx vitest run` (ops-web), `npm test` (ops-site), iOS test target — actual pass/fail counts, not a summary. CI is red on lint independently of tests in this repo; run locally and report the real numbers.

Delete throwaway artifacts once the proof is delivered; keep only what is worth referencing.

**Do not push.** `ops-web` and `ops-site` `main` auto-deploy to real customers — pushing needs Jackson's explicit GO.
