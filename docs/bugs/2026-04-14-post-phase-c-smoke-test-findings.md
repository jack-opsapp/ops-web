# Post–Phase C Deploy Smoke Test — Non-Phase-C Findings

**Date:** 2026-04-14
**Deploy:** `dpl_8jBzPhfepkdH2D8USKDS4t23RTuu` (commit `26d65dd`) — `READY`
**Scope:** Pre-existing / adjacent bugs observed while smoke-testing Phase C in the live production browser (Canpro Deck and Rail, `app.opsapp.co`). All Phase C features themselves passed. Items below are **not Phase C regressions** — they were either already broken, or were masked by a now-fixed bug and have become visible as a result.

---

## 1. Unrounded completion percentage on `/projects` page header

**Severity:** minor visual — ships a float with 13 decimal places to users
**First observed:** Canpro projects page header
**Example displayed:** `90.5511811023622 COMPLETION`

### Repro
1. Log in as an admin with historical project data
2. Navigate to `/projects`
3. Look at the stats strip in the page header

### Root cause
`fetchProjectsMetrics` in `src/lib/api/services/metrics-service.ts` (around line 267) computes:

```ts
const completionRate = completionDenominator.length > 0
  ? Math.min(100, (completed.length / completionDenominator.length) * 100)
  : 0;
// ...
{ label: "Completion", value: completionRate, ... }
```

Returned as a raw float. The projects-page metrics strip widget renders it verbatim. Needs `Math.round(completionRate)` at either the service layer (cleanest) or the widget.

### Why it's visible now
Hidden before Phase C: the metrics service used to filter completed tasks with `t.status === "Completed"` (Title Case), which never matched the lowercase DB values, so `completed.length` was always 0, so `completionRate` was always 0, which rendered as a clean `0`. After the lowercase status fix (commit `26d65dd`), real non-zero values flow through and expose the pre-existing lack of rounding.

### Proposed fix
`metrics-service.ts` ~L267, change the returned value to:

```ts
{ label: "Completion", value: Math.round(completionRate), unit: "%", ... }
```

Also audit other places in `metrics-service.ts` that build `InlineMetricConfig` — any float returned without rounding will have this issue.

---

## 2. Supabase 406 on `expense_settings` query — fires on every page load

**Severity:** moderate noise / console error on every authenticated page
**First observed:** dashboard, projects, settings, agent queue, map — basically every authenticated page

### Repro
1. Open DevTools Network tab
2. Log in and load any authenticated page
3. Observe: `GET https://ijeekuhbatykdomumfjx.supabase.co/rest/v1/expense_settings?on_conflict=company_id&select=* → 406`

### Root cause
PostgREST query uses `on_conflict=company_id&select=*`. The `on_conflict` parameter is only valid on `INSERT`/`UPSERT` requests — using it with a plain `GET` select is a misuse that PostgREST can either ignore or reject. Combined with `select=*` asking for rows, it returns **406 Not Acceptable** when the response shape doesn't match what the client expects (likely a `.single()` call on a table with 0 or 2+ matching rows).

### Where to look
Grep for `expense_settings` in `src/lib/api/services/` and `src/lib/hooks/`:

```
src/lib/api/services/expense-settings-service.ts   (or similar)
```

Likely a `.single()` / `.maybeSingle()` / upsert pattern that got refactored wrong.

### Why it's not Phase C
`expense_settings` is an unrelated pre-existing table. Zero Phase C files touch it. This error appears on deploys going back at least 24 hours (saw it logged on `dpl_DxxKDJNoZRKeBHiVvokbukPtud3Q`).

---

## 3. Firebase Auth COOP warnings (6× per dashboard load)

**Severity:** benign console noise; may affect popup auth flows
**First observed:** dashboard first load

### Symptoms
Console emits 6 errors per dashboard load:

```
[ERROR] Cross-Origin-Opener-Policy policy would block the window.closed call.
  @ https://app.opsapp.co/_next/static/chunks/ae6eea6a-6eb5b3b94e9cb56c.js:0
[ERROR] Cross-Origin-Opener-Policy policy would block the window.closed call.  (×3)
[ERROR] Cross-Origin-Opener-Policy policy would block the window.close call.   (×2)
```

### Root cause
Firebase Auth uses `window.closed` / `window.close` to poll the popup state during OAuth flows. The site sends a `Cross-Origin-Opener-Policy` header that blocks these calls. This is a well-known Firebase + Next.js interaction.

### Proposed fix
Set `Cross-Origin-Opener-Policy: same-origin-allow-popups` on the auth routes (or globally) in `next.config.ts`:

```ts
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      ],
    },
  ];
}
```

### Why it's not Phase C
Firebase Auth and COOP headers are infrastructure that existed long before Phase C.

---

## 4. Google Analytics GA4 `collect` POST `ERR_ABORTED`

**Severity:** none (analytics is enhancement only)
**First observed:** agent/queue page

### Symptoms
```
[POST] https://www.google-analytics.com/g/collect?v=2&tid=G-QVBYF95GYL... → FAILED net::ERR_ABORTED
```

### Root cause
Browser tracking prevention, ad blocker, or policy-level network block. Nothing in the application can control this.

### Action
No action required. Could add a `.catch(() => {})` on the GA4 init code to prevent these from showing in the network tab, but it's cosmetic.

---

## 5. Phone number displayed unformatted on Settings → Account

**Severity:** minor UX polish
**First observed:** Settings → Account → Profile tab, PHONE field

### Repro
1. Navigate to `/settings`
2. Observe PHONE field shows: `2505388994`
3. Expected: `(250) 538-8994`, `250-538-8994`, or `+1 250 538 8994`

### Root cause
Form field renders the raw DB value. No phone formatter applied on read.

### Proposed fix
Apply a locale-aware phone formatter (e.g., `libphonenumber-js` is already a dep in many Next apps; if not, a simple regex split works for NA numbers). Use the company's new `locale` column (from Phase C migration 062) to pick the right format.

### Why it's not Phase C
Profile tab is pre-existing. Phase C added `companies.locale` which could be leveraged here as a bonus, but the underlying display bug existed already.

---

## Summary table

| # | Area | Severity | Status | Hidden by Phase C bug? |
|---|---|---|---|---|
| 1 | `/projects` header completion % unrounded | Minor visual | Not filed | **Yes** — was 0 before lowercase status fix |
| 2 | `expense_settings` 406 on every page | Moderate noise | Not filed | No |
| 3 | Firebase COOP popup warnings | Benign console noise | Not filed | No |
| 4 | GA4 `collect` ERR_ABORTED | None | Not filed | No |
| 5 | Unformatted phone on Settings | Minor UX | Not filed | No |

---

## Phase C smoke test results (for context — all passed)

| Test | Result |
|---|---|
| Vercel deploy `dpl_8jBzPhfepkdH2D8USKDS4t23RTuu` | **READY** ✅ |
| `tsc --noEmit` | 0 errors ✅ |
| `/api/agent/queue?countOnly=true` (dashboard sidebar) | 200 ✅ |
| `/api/agent/queue?statsOnly=true` (agent queue page) | 200 ✅ |
| `/api/agent/queue?status=pending` (agent queue list) | 200 ✅ |
| `/api/agent/phase-c-status` (agent queue header) | 200 ✅ |
| `/api/agent/comms-wizard/gating` (wizard gate) | correctly redirected (no writing profile yet) ✅ |
| DB-level round-trip of `agent_actions` (insert → approve → execute → dedup → cleanup) | ✅ |
| CHECK constraints (`agent_actions.status`, `companies.locale`, `ai_draft_history.status`) | all reject invalid values ✅ |
| Lowercase status contract — 8 service paths side-by-side vs title-case | Every fixed path returns real data where old version returned 0 ✅ |
| Canpro-specific map page shows **134 mapped / 18 missing / 6 active sites** | Before fix: 0 active sites. After: 6. ✅ |
| Canpro-specific projects page shows **27 active / 6 overdue / 90.55% completion** | Before fix: 0 active, 0% completion. After: real data. ✅ |
| i18n server-emails dictionary (en + es) round-trip via `interpolate()` | 55 keys each, diacritics correct, zero missing ✅ |
| Supabase security advisor deltas | 28→25 ERRORs, 75→74 WARNs, **zero** lints on Phase C tables ✅ |
| Supabase performance advisor `auth_rls_initplan` on Phase C policies | All 7 optimized to `(SELECT auth.jwt())` ✅ |

**Conclusion:** Phase C is production-healthy. The 5 items above are pre-existing or ambient issues unrelated to Phase C scope.
