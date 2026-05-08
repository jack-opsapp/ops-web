# Lockout View Redesign

**Date:** 2026-05-07
**Status:** Approved — ready for implementation plan
**Surfaces:** `/locked` page + in-app `LockoutOverlay` modal
**Author:** Claude (brainstorming session 2026-05-07)

**Verification trail:**
- Read `ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md` (lockout precedence, schema, status enums, lifecycle)
- Read `ops-software-bible/07_SPECIALIZED_FEATURES.md § 14` (notification table, persistent/action_url/action_label columns confirmed)
- Read `ops-software-bible/05_DESIGN_SYSTEM.md § Z-index scale` (`.z-emergency` utility class = 9000)
- Read `ops-design-system/project/SKILL.md`, `README.md`, `colors_and_type.css` (canonical visual spec v2)
- Verified `Company` interface fields, `SubscriptionStatus` / `SubscriptionPlan` enums in `src/lib/types/models.ts`
- Verified `useAuthStore` shape, `selectIsAdminOrOwner` selector in `src/lib/store/auth-store.ts`
- Verified existing motion variants in `src/lib/utils/motion.ts`
- Verified `useDictionary` client hook lacks built-in interpolation (`src/i18n/client.tsx:67-71`); server side has it (`src/i18n/server-render.ts:74`)
- Verified `NotificationType` includes `'role_needed'` and `AppNotification` interface in `src/lib/api/services/notification-service.ts`
- Verified Tailwind config (`tailwind.config.ts`) — confirmed `text-text`/`text-text-2`/`text-text-3`/`text-text-mute`, `bg-glass*`, `font-cakemono`, `text-ops-accent` map; confirmed earth-tone soft/line tokens are NOT in Tailwind (CSS vars only)
- Verified `Button` component variants in `src/components/ui/button.tsx` (drift from canonical: `variant="primary"` is filled steel, not outlined-at-rest)
- Verified existing `.glass-surface` / `.glass-dense` utilities in `src/styles/globals.css` (drift: 10/12 radius, canonical says 5)

---

## Goal

Replace the current OPS-Web lockout surfaces with a single, spec-aligned, role-aware design that:

1. Eliminates design-system violations (amber tier highlight, "Most Popular" ribbon, checkmark feature lists, decorative `ShieldOff` icon, Mohave display headlines, decorative atmosphere on `/locked`).
2. Consolidates the page and overlay onto one shared shell + four state modules — eliminates ~120 LOC of duplicated `PricingCard` / `CompactPricingCard` markup that drifts independently.
3. Renders the right content for each `(reason, role)` combination on both surfaces. Today the `/locked` page only handles admin-expired; an unseated member landing on `/locked` directly sees an unactionable pricing pitch.
4. Tightens copy to the OPS tactical voice — terse, blame-free, on-brand. Sentence case for content, UPPERCASE for authority.

## Non-goals

- DB schema changes — none.
- Migrating the global `Button` component to outlined-at-rest primary (canonical spec v2). Out of scope; flagged as a follow-up.
- Migrating global `.glass-surface` / `.glass-dense` border-radius from 10/12 → 5 (canonical spec v2). Out of scope; flagged as a follow-up.
- Removing the global `Button variant="accent"` (amber). Out of scope; the lockout simply stops using it.
- Spanish translations of new dictionary keys. Keys ship now; ES strings get a follow-up translation pass.

---

## Architecture

### File map

```
src/components/lockout/
├── lockout-shell.tsx          # visual frame: top rail / hero / divider / state slot / footer
├── lockout-resolver.tsx       # picks state module from (reason, role); shared by page + overlay
├── pricing-row.tsx            # spec-compliant 3-tier presentation (replaces both PricingCard variants)
├── pricing-card.tsx           # single-tier card used inside pricing-row
├── request-button.tsx         # extracted shared action: insert notifications + cooldown
├── request-sent-row.tsx       # tactical "✓ REQUEST SENT · 14:23 PT" confirmation row (olive success)
├── admin-tag.tsx              # "// ADMIN :: NAME (+N OTHERS)" tactical label
├── states/
│   ├── expired-admin.tsx      # pricing row + reactivate
│   ├── expired-member.tsx     # admin tag + request reactivation
│   ├── unseated-admin.tsx     # → /team CTA
│   └── unseated-member.tsx    # admin tag + request access
└── hooks/
    ├── use-admin-names.ts     # extracted from lockout-overlay; fetches names for admin_ids
    ├── use-realtime-company.ts # extracted from lockout-overlay; subscribes to companies row updates
    ├── use-request-cooldown.ts # extracted localStorage cooldown logic
    └── use-lockout-date.ts    # resolves the right "expired on" date — see Date resolution below
```

**Plus one shared helper added at `src/lib/i18n/interpolate.ts`:**

```ts
// Mirrors src/i18n/server-render.ts:74-83 for client use, since the
// useDictionary() hook (src/i18n/client.tsx:67-71) does NOT support
// {{var}} interpolation.
export function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(params[key] ?? `{{${key}}}`)
  );
}
```

This replaces the absent client-side interpolation. Lockout components import it and call `interpolate(t("lockout.expiredAdmin.bodyWithDate"), { date })`. The helper is general-purpose and lives outside the lockout folder so future surfaces can use it.

### Container wiring

- `src/app/(auth)/locked/page.tsx` becomes a thin client component:
  ```tsx
  "use client";
  export default function LockedPage() {
    return <LockoutResolver variant="page" />;
  }
  ```
- `src/components/ops/lockout-overlay.tsx` keeps its `pathname` exemption logic and `AnimatePresence` backdrop, but renders `<LockoutResolver variant="overlay" />` inside the animated card. Existing `useRealtimeCompanyUpdates`, `useAdminNames`, route-exemption rules, and `lockoutBackdropVariants` / `lockoutCardVariants` from `src/lib/utils/motion.ts` are preserved (extracted to shared hooks where useful).
- `src/app/(auth)/locked/layout.tsx` is stripped of decorative atmosphere (amber/error glow orbs, grid backdrop) and becomes a pure black canvas with centered card and brand lockup above.

### Resolver behavior

`LockoutResolver`:

1. Reads `useAuthStore` for `company` + `currentUser`.
2. Computes `lockoutReason = getLockoutReason(company, userId)` from `src/lib/subscription.ts` (existing).
3. Reads `selectIsAdminOrOwner` from auth store (existing selector).
4. Picks the matching state module:
   - `subscription_expired` × admin → `<ExpiredAdminState />`
   - `subscription_expired` × member → `<ExpiredMemberState />`
   - `unseated` × admin → `<UnseatedAdminState />`
   - `unseated` × member → `<UnseatedMemberState />`
5. Wraps the chosen module in `<LockoutShell variant={...}>` which renders top rail, heading, body, divider, the module slot, footer divider, footer links, fingerprint.
6. On `variant="overlay"`, the shell is wrapped in the existing `AnimatePresence` + backdrop + animated card (lives in `lockout-overlay.tsx`). On `variant="page"`, the shell stands alone with the brand lockup above.

`/locked` page now correctly handles all 4 states, not just admin-expired. The overlay continues to suppress on `/settings` for admins (subscription_expired) and `/team` for admins (unseated) — unchanged.

### Loading + null-state contract (page variant only)

The `(auth)/layout.tsx` `AuthRouteGate` registers `/locked` in both `authenticatedAllowedRoutes` and `authRequiredRoutes`. Behavior chain:

- **Unauthenticated visitor:** AuthRouteGate renders the "AUTHENTICATION REQUIRED" popup. `LockoutResolver` never renders.
- **Authenticated visitor, `isLoading=true`:** AuthRouteGate renders `<LogoLoader>`. `LockoutResolver` never renders.
- **Authenticated, loaded, `company` not yet hydrated:** `getLockoutReason(null, userId)` returns `null`. Resolver shows a brief `<LogoLoader>` (not a state module) while the auth-store-driven company query resolves. Avoids the current bug where the page renders admin-expired pricing regardless of actual state.
- **Authenticated, loaded, `lockoutReason === null`:** user has full access and should not be on `/locked`. Resolver calls `router.replace("/dashboard")` and renders nothing while redirect happens. (Today's page renders pricing cards regardless — fixed by this redesign.)
- **Authenticated, loaded, `lockoutReason !== null`:** render the matching state module.

For overlay variant, `lockoutReason === null` already unmounts the AnimatePresence — keep as-is.

### Dictionary consumer audit

`grep` of `t("locked.…"` and `t("lockout.…"` across `src/` returns matches **only** in `src/app/(auth)/locked/page.tsx` and `src/components/ops/lockout-overlay.tsx`. No other consumers. Safe to delete legacy keys after migration. ES dictionary at `src/i18n/dictionaries/es/auth.json` (120 lines) needs parallel updates with `[ES TODO]`-prefixed strings.

---

## Visual layout

### Shell anatomy (shared)

```
┌─ glass card ────────────────────────────────────────────┐
│  [tag-rose] SUB EXPIRED · 2026-04-30   → // CONTACT     │  top rail
│                                                          │
│  ACCESS HALTED                                           │  heading (Cake Mono Light 30px)
│  Your team's access expired on 2026-04-30.               │  body (Mohave 14px text-2)
│  Reactivate to restore the deck.                         │
│                                                          │
│  ──── // REACTIVATE ──────────────────────────────       │  section divider
│                                                          │
│  [ STATE MODULE SLOT ]                                   │
│                                                          │
│  ────────────────────────────────────────────────        │
│  → // CONTACT SUPPORT    → // SWITCH ACCOUNT             │  footer links
│                          SYS :: SUB-EXP · 2026-04-30     │  fingerprint (text-mute)
└──────────────────────────────────────────────────────────┘
```

### Container variants

| | `variant="page"` (`/locked`) | `variant="overlay"` (in-app) |
|---|---|---|
| Backdrop | none — pure `#000000` canvas | `bg-black/60` + `backdrop-blur-xl` (existing) |
| Brand lockup | `<OpsLockup orientation="vertical" h-16 />` centered above card | none |
| Card surface utility | `glass-surface` | `glass-dense` |
| Card radius (override) | `rounded-[5px]` | `rounded-[5px]` |
| Max-width | 720px | 520px |
| Card padding | `p-8` (32px) | `p-6` (24px) |
| Vertical position | `min-h-screen flex items-center justify-center py-12` | viewport-centered, `max-h-[90vh] overflow-y-auto` |
| z-index | base flow | `className="z-emergency"` — utility class defined at `src/styles/globals.css @layer components` per `ops-software-bible/05_DESIGN_SYSTEM.md § Z-index`. Resolves to `9000`. Replaces existing `z-[9000]` arbitrary value. |
| Layout decoration | **dropped** (no glow orbs, no grid) | unchanged |

### Tailwind class compositions (no `.t-*` CSS utility classes — those don't exist in OPS-Web globals.css)

| Slot | Tailwind composition |
|---|---|
| Heading (`.t-display` equivalent) | `font-cakemono font-light text-[30px] uppercase tracking-tight text-text leading-none` |
| Section label (Cake Mono 18px) | `font-cakemono font-light text-[18px] uppercase tracking-tight text-text` |
| Tactical micro-label (`.t-panel-title`) | `font-mono text-[11px] uppercase tracking-[0.16em] text-text-3` |
| Body | `font-mohave text-[14px] text-text-2 leading-[1.45]` |
| Body-3 (explainer/hint) | `font-mohave text-[13px] text-text-3 leading-[1.45]` |
| Number (price, timestamp) | `font-mono text-[28px] leading-none text-text [font-feature-settings:'tnum'_1,'zero'_1]` |
| Fingerprint | `font-mono text-[11px] tracking-[0.12em] text-text-mute` |
| Tag (rose / tan) | `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2.5px] border font-mono text-[11px] uppercase tracking-[0.12em]` + variant. **Token mapping decision:** the Tailwind config does not currently expose `rose-soft` / `rose-line` / `tan-soft` / `tan-line` as utilities — only base hexes via the `status` palette. Use Tailwind arbitrary-value syntax against the CSS variables defined in `globals.css`: `bg-[var(--rose-soft)] text-[var(--rose)] border-[var(--rose-line)]` / `bg-[var(--tan-soft)] text-[var(--tan)] border-[var(--tan-line)]`. (Alternative: extend Tailwind config to expose `rose`/`tan` color objects with `soft` and `line` keys — out of scope for this redesign; arbitrary values keep changes local to the lockout.) |

### Pricing row responsive behavior

- Container width ≥ 600px → 3 columns side-by-side (page 720, overlay 520)
- Container width < 600px → stacked, full-width tiers
- Default to 3-col on both surfaces. Phone-sized overlays trigger stack via Tailwind responsive classes.

---

## Motion

Single easing curve, no spring, no bounce. Honor `prefers-reduced-motion`.

### Existing variants (reuse from `src/lib/utils/motion.ts`)

- `lockoutBackdropVariants` — keep
- `lockoutBackdropVariantsReduced` — keep
- `lockoutCardVariants` — keep
- `lockoutCardVariantsReduced` — keep

### New variants to add to `motion.ts`

```ts
export const lockoutShellStaggerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const lockoutShellChildVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } },
};

export const lockoutShellChildVariantsReduced = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};
```

Stagger order: top rail → heading block → divider → state module → footer.

Hover/focus follow the global system (150ms, `var(--ease-smooth)`, focus ring `1.5px solid var(--ops-accent)` with 2px offset).

---

## Per-state content

### State 1 — `subscription_expired` × admin

- **Tag:** `[tag-rose] SUB EXPIRED · {{date}}` (when `trial_end_date` available); `[tag-rose] SUB EXPIRED` (no date fallback)
- **Heading:** `ACCESS HALTED`
- **Body (with date):** "Your team's access expired on {{date}}. Reactivate to restore the deck."
- **Body (no date):** "Your team's access expired. Reactivate to restore the deck."
- **Section label:** `// REACTIVATE`
- **Module:** `<PricingRow />`
- **Below module:** "30-day money-back · cancel any time" — `font-mohave text-[13px] text-text-3`
- **Fingerprint (with date):** `SYS :: SUB-EXP · {{date}}`
- **Fingerprint (no date):** `SYS :: SUB-EXP`

### Pricing row (real `TIER_CONFIG` values — `src/lib/subscription.ts`)

| Tier | Price | Seats | Summary | CTA variant |
|---|---|---|---|---|
| Starter | $90/mo | 3 | "Solo or small crew." | `<Button variant="default">` |
| Team | $140/mo | 5 | "Growing field operations." | `<Button variant="primary">` (single steel CTA on the screen) |
| Business | $190/mo | 10 | "Full field team." | `<Button variant="default">` |

> **Known drift, not fixed here:** `ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md § Status & Plan Enums` describes Business as "(unlimited tier)" but `subscription.ts` `TIER_CONFIG.business.maxSeats = 10` and the migration sets `companies.max_seats DEFAULT 10` with no plan-change override (bible flags this as a "**gap**"). The lockout copy reflects shipped enforcement (10 seats). When the Business-unlimited gap is closed in `subscription.ts`, this copy auto-updates because `seats` is interpolated from `TIER_CONFIG[tier].maxSeats`.

Above the team card only: `// RECOMMENDED` label in `font-cakemono font-light text-[11px] uppercase tracking-[0.08em] text-text-3`. Replaces the popular ribbon.

Tier card spec:

- `glass-surface` utility + `rounded-[5px]` override
- 16px padding
- Tier name top: `font-cakemono font-light text-[18px] uppercase tracking-tight text-text`
- Price row: `<span>$140</span><span class="font-mohave text-[13px] text-text-3">/mo</span>`
- Seats badge below price: `font-mono text-[11px] uppercase tracking-[0.12em] text-text-3` — `5 SEATS` (or `10 SEATS` for Business)
- Single-line summary: `font-mohave text-[14px] text-text-2`
- CTA: full-width `<Button>` with `pricing.subscribe` label
- **No `<Check>` bullets, no amber, no ring, no "Most Popular" ribbon, no `variant="accent"`**

### State 2 — `subscription_expired` × member

- **Tag:** `[tag-rose] SUB EXPIRED`
- **Heading:** `ACCESS HALTED`
- **Body:** "Your team's subscription expired. Only an admin can reactivate."
- **Section label:** `// REQUEST REACTIVATION`
- **Module:**
  - `<AdminTag admins={admins} />` — renders `// ADMIN :: NAME (+N OTHERS)` or null when empty
  - `<RequestButton reason="subscription_expired" />` — full-width `<Button variant="primary" size="sm">` with label `lockout.expiredMember.cta` ("Request reactivation"). On send, swaps to `<RequestSentRow />`. 24h cooldown via `useRequestCooldown` hook (extracted from current `lockout-overlay.tsx`).
  - Explainer below: `font-mohave text-[13px] text-text-3` — "Your admins will be notified. They can reactivate from the subscription panel."
- **Fingerprint:** `SYS :: SUB-EXP · {{date}}` (date from company.trialEndDate when available)

#### Sent state (replaces button when sent or within cooldown)

```
┌─ row, full-width, olive-soft surface, rounded-[2.5px] ─┐
│  ✓  REQUEST SENT · {{HH:MM TZ}}                         │
└─────────────────────────────────────────────────────────┘
```

The sent state confirms a successful action — olive (success semantic), not rose:

- Background `var(--olive-soft)`, border `var(--olive-line)`, padding 12px 14px, `rounded-[2.5px]`
- Icon: `<Check size={14} />` color `var(--olive)`
- Text: `font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--olive)]`
- Tailwind arbitrary-value implementation: `bg-[var(--olive-soft)] border border-[var(--olive-line)] text-[var(--olive)]` (same rationale as tag tokens — these tokens are CSS vars not yet exposed as Tailwind utilities)

#### No-admins edge (`adminIds.length === 0`)

- Hide `AdminTag` and `RequestButton`
- Show `SYS :: NO ADMINS REGISTERED` in `font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute`
- Show `<Button variant="primary">` with label "Contact support" → `mailto:support@opsapp.co`

### State 3 — `unseated` × admin

- **Tag:** `[tag-tan] NO SEAT ASSIGNED`
- **Heading:** `SEAT NOT CLAIMED`
- **Body:** "You haven't claimed a seat in this company. Self-assign from the team panel."
- **Section label:** `// TEAM`
- **Module:**
  - `<a href="/team"><Button variant="primary">` — full-width, label "Manage team"
  - Explainer: `font-mohave text-[13px] text-text-3` — "Owners and admins can self-assign seats from the team page."
- **Fingerprint:** `SYS :: SEAT-NULL`

### State 4 — `unseated` × member

- **Tag:** `[tag-tan] NO SEAT ASSIGNED`
- **Heading:** `SEAT NOT CLAIMED`
- **Body:** "Your admin needs to assign you a seat in OPS."
- **Section label:** `// REQUEST ACCESS`
- **Module:** identical structure to State 2 (admin tag + request button + explainer + sent state + no-admins edge)
- **Fingerprint:** `SYS :: SEAT-PEND`

---

## Copy spec

### Dictionary structure

`src/i18n/dictionaries/{en,es}/auth.json` — flat dotted-key style (matches existing convention):

```json
{
  "lockout.shared.contactSupport": "Contact support",
  "lockout.shared.switchAccount": "Switch account",
  "lockout.shared.requestSent": "Request sent",
  "lockout.shared.cooldownNote": "You can request again in 24 hours.",
  "lockout.shared.adminLabel": "ADMIN",
  "lockout.shared.adminOthers": "others",
  "lockout.shared.noAdmins": "No admins registered",
  "lockout.shared.noAdminsBody": "Contact OPS support to restore access.",
  "lockout.shared.noAdminsCta": "Contact support",

  "lockout.expiredAdmin.tag": "SUB EXPIRED",
  "lockout.expiredAdmin.tagWithDate": "SUB EXPIRED · {{date}}",
  "lockout.expiredAdmin.heading": "ACCESS HALTED",
  "lockout.expiredAdmin.body": "Your team's access expired. Reactivate to restore the deck.",
  "lockout.expiredAdmin.bodyWithDate": "Your team's access expired on {{date}}. Reactivate to restore the deck.",
  "lockout.expiredAdmin.sectionLabel": "REACTIVATE",
  "lockout.expiredAdmin.guarantee": "30-day money-back · cancel any time",
  "lockout.expiredAdmin.fingerprint": "SYS :: SUB-EXP",
  "lockout.expiredAdmin.fingerprintWithDate": "SYS :: SUB-EXP · {{date}}",

  "lockout.expiredMember.tag": "SUB EXPIRED",
  "lockout.expiredMember.heading": "ACCESS HALTED",
  "lockout.expiredMember.body": "Your team's subscription expired. Only an admin can reactivate.",
  "lockout.expiredMember.sectionLabel": "REQUEST REACTIVATION",
  "lockout.expiredMember.cta": "Request reactivation",
  "lockout.expiredMember.explainer": "Your admins will be notified. They can reactivate from the subscription panel.",
  "lockout.expiredMember.fingerprint": "SYS :: SUB-EXP",
  "lockout.expiredMember.fingerprintWithDate": "SYS :: SUB-EXP · {{date}}",

  "lockout.unseatedAdmin.tag": "NO SEAT ASSIGNED",
  "lockout.unseatedAdmin.heading": "SEAT NOT CLAIMED",
  "lockout.unseatedAdmin.body": "You haven't claimed a seat in this company. Self-assign from the team panel.",
  "lockout.unseatedAdmin.sectionLabel": "TEAM",
  "lockout.unseatedAdmin.cta": "Manage team",
  "lockout.unseatedAdmin.explainer": "Owners and admins can self-assign seats from the team page.",
  "lockout.unseatedAdmin.fingerprint": "SYS :: SEAT-NULL",

  "lockout.unseatedMember.tag": "NO SEAT ASSIGNED",
  "lockout.unseatedMember.heading": "SEAT NOT CLAIMED",
  "lockout.unseatedMember.body": "Your admin needs to assign you a seat in OPS.",
  "lockout.unseatedMember.sectionLabel": "REQUEST ACCESS",
  "lockout.unseatedMember.cta": "Request access",
  "lockout.unseatedMember.explainer": "Your admin will be notified to assign you a seat.",
  "lockout.unseatedMember.fingerprint": "SYS :: SEAT-PEND",

  "lockout.pricing.recommended": "RECOMMENDED",
  "lockout.pricing.perMonth": "/mo",
  "lockout.pricing.seatsLabel": "SEATS",
  "lockout.pricing.subscribe": "Subscribe",
  "lockout.pricing.starter.summary": "Solo or small crew.",
  "lockout.pricing.team.summary": "Growing field operations.",
  "lockout.pricing.business.summary": "Full field team.",
  "lockout.pricing.subscribeFailed.title": "Checkout unavailable",
  "lockout.pricing.subscribeFailed.noCompany": "No company found.",
  "lockout.pricing.subscribeFailed.generic": "Try again or contact support."
}
```

### Keys to delete (consolidated into `lockout.*`)

- `locked.title`
- `locked.description`
- `locked.selectPlan`
- `locked.seatsIncluded`
- `locked.mostPopular`
- `locked.subscribe`
- `locked.starter` / `locked.team` / `locked.business`
- `locked.guarantee`
- `locked.contactSupport`
- `locked.differentAccount`
- `locked.sysMessage`
- `locked.subscribeFailed.title` / `.generic` / `.noCompany`
- `lockout.expiredAdmin.title` / `.body` / `.selectPlan` / `.sysMessage`
- `lockout.expiredMember.title` / `.body` / `.requestReactivation` / `.requestSent` / `.sysMessage`
- `lockout.unseated.title` / `.body` / `.requestAccess` / `.requestSent` / `.sysMessage`
- `lockout.unseatedAdmin.title` / `.body` / `.manageTeam` / `.sysMessage`
- `lockout.adminLabel` / `lockout.adminOthers` / `lockout.contactSupport` / `lockout.differentAccount` / `lockout.guarantee`

### Date resolution logic (`use-lockout-date.ts`)

`{{date}}` placeholders appear in: `lockout.expiredAdmin.tagWithDate`, `lockout.expiredAdmin.bodyWithDate`, `lockout.expiredAdmin.fingerprintWithDate`, `lockout.expiredMember.fingerprintWithDate`.

The "expired on" date depends on which subscription path expired. Per `ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md` and `Company` interface in `src/lib/types/models.ts`:

| Field | Type | When set | Use for |
|---|---|---|---|
| `trial_end_date` (`trialEndDate`) | `Date \| null` | Trial creation; updated by Stripe `customer.subscription.updated` | Trial-path expiry display |
| `subscription_end` (`subscriptionEnd`) | `Date \| null` | Set by Stripe webhook on every renewal/expiry | Paid-path expiry display |

**Resolution rule:**

```ts
// src/components/lockout/hooks/use-lockout-date.ts
export function useLockoutDate(company: Pick<Company, "subscriptionPlan" | "trialEndDate" | "subscriptionEnd"> | null): Date | null {
  if (!company) return null;
  const tier = company.subscriptionPlan;
  const candidate =
    tier === SubscriptionPlan.Trial
      ? company.trialEndDate
      : company.subscriptionEnd ?? company.trialEndDate; // paid sub may still have trial_end_date as historical anchor
  if (!candidate) return null;
  const date = candidate instanceof Date ? candidate : new Date(candidate as unknown as string);
  return Number.isNaN(date.getTime()) ? null : date;
}
```

**Format separately:**

- Body / tag (display): `Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)` — EN reads `Apr 30, 2026`. Locale-aware so ES translation later renders `30 abr. 2026`.
- Fingerprint (machine-readable, locale-stable): `date.toISOString().slice(0, 10)` → `2026-04-30`.

If `useLockoutDate(company)` returns `null`, the renderer picks the dateless variant of every key (`tag`, `body`, `fingerprint`) and never calls `interpolate()`.

### Spanish dictionary

`src/i18n/dictionaries/es/auth.json` gets the same key set. Initial values copy EN strings verbatim, with the literal sentinel `[ES TODO]` prefixed to each new lockout string so a translation pass can grep them. Example: `"lockout.expiredAdmin.heading": "[ES TODO] ACCESS HALTED"`. The `[ES TODO]` prefix is visible in QA — that is intentional; it surfaces missed translations rather than silently shipping EN-as-ES. Once the translation pass runs, the prefix is removed.

### Voice rules applied

- Sentence case for content (body, explainer, summaries)
- UPPERCASE for authority (heading, tag, section label, button labels, fingerprint)
- `//` prefix for section labels and footer links (rendered visually, not in dict strings — the prefix is added at the component level)
- `[brackets]` are NOT used around full sentences — only around micro-labels if any (none in this design)
- `SYS ::` for fingerprint
- No emoji, no exclamation, no "Welcome back!" energy

---

## Component contracts (high-level)

```ts
// LockoutShell
type LockoutShellProps = {
  variant: "page" | "overlay";
  tag: { tone: "rose" | "tan"; label: string };
  heading: string;
  body: string;
  sectionLabel: string;       // rendered with `//` prefix at component level
  fingerprint: string;
  children: ReactNode;        // state module slot
  showSwitchAccount?: boolean; // default: true on page + member states; false on admin-overlay
};

// LockoutResolver
type LockoutResolverProps = {
  variant: "page" | "overlay";
};

// PricingRow
type PricingRowProps = {
  companyId: string | undefined;
  recommendedTier?: SubscriptionTier; // default: "team"
  density?: "page" | "overlay";       // default: based on container; controls padding inside cards
};

// PricingCard
type PricingCardProps = {
  tier: Exclude<SubscriptionTier, "trial">;
  companyId: string | undefined;
  isRecommended: boolean;
  density: "page" | "overlay";
};

// AdminTag
type AdminTagProps = {
  admins: { id: string; name: string }[];
};

// RequestButton
type RequestButtonProps = {
  reason: "subscription_expired" | "unseated";
  userId: string;
  companyId: string;
  userName: string;
  adminIds: string[];
};

// RequestSentRow
type RequestSentRowProps = {
  timestamp: Date; // shown as HH:MM TZ
};
```

### Notification insertion contract (preserved from current `lockout-overlay.tsx`)

`RequestButton` writes to the `notifications` table via `requireSupabase()` (matches today's behavior). Type-safety: import the existing `NotificationType` from `src/lib/api/services/notification-service.ts` and pass `type: "role_needed" satisfies NotificationType`. Row shape:

```ts
{
  user_id: adminId,             // one row per admin
  company_id: companyId,
  type: "role_needed",
  title: isReactivation ? "Reactivation Request" : "Access Request",
  body: isReactivation
    ? `${userName} is requesting subscription reactivation`
    : `${userName} is requesting seat restoration`,
  is_read: false,
  persistent: true,             // long-running ops the admin must resolve
  action_url: isReactivation ? "/settings?tab=subscription" : "/team",
  action_label: isReactivation ? "Manage Subscription" : "Manage Team",
}
```

No schema changes. Bible § 7.14 confirms `persistent`, `action_url`, `action_label` columns exist on `notifications`. The drawer (`src/components/layouts/notifications-drawer.tsx`) picks these up automatically via `useNotifications()`.

### Cooldown contract (preserved exactly)

`useRequestCooldown(userId)` extracts the existing inline implementation from `lockout-overlay.tsx:28-49`. Storage key MUST stay `ops-lockout-request-${userId}` (not changed) so users with an active 24h cooldown from before the redesign are not reset. Stored value: `JSON.stringify({ timestamp: Date.now(), reason })`. Window: 24h (`COOLDOWN_MS = 24 * 60 * 60 * 1000`).

---

## Motion / accessibility / interaction contract

- **Reduced motion:** every animated element honors `useReducedMotion` and uses the `*VariantsReduced` set (existing pattern).
- **Focus management:** on overlay open, focus moves to the heading (`role="alertdialog"`, `aria-modal="true"`, `aria-labelledby="lockout-heading"`). Tab sequence: heading → state-module CTAs → footer links. On overlay close (subscription reactivated via realtime), focus returns to last-focused element prior to lockout.
- **Keyboard:** Esc does NOT dismiss the overlay (the user can't dismiss a lockout). Tab cycles within the card.
- **Single steel CTA invariant:** each rendered state has exactly one `<Button variant="primary">` (filled steel) on screen. State 1 places it on the recommended tier (Team). States 2/3/4 each have one full-width primary CTA. The "Subscribe" buttons on Starter/Business cards in State 1 use `variant="default"` (subtle white-fill outline).
- **Button `size` prop:** state-module standalone CTAs use `size="sm"` (renders at 44px height — touch-target compliant; despite the name, `sm` is the largest size in the `Button` component per `src/components/ui/button.tsx:50-55`). Pricing-card CTAs inside the row use the default size (`h-7` / 28px) so they fit alongside price + summary in compact cards.

---

## Risks & open questions

1. **`Button variant="primary"` is filled steel, not outlined.** Canonical spec v2 says outlined-at-rest, fills on hover. Migrating Button is out of scope; the lockout uses filled steel today. Visually still reads as "the one CTA" — single-per-screen invariant holds.
2. **`.glass-surface` / `.glass-dense` global radii are 10/12 in OPS-Web.** Spec v2 says 5. Lockout overrides locally with `rounded-[5px]`. Other surfaces remain on the older radius until that migration lands.
3. **Notification permissions / RLS** are unchanged — the existing `RequestButton` writes to `notifications` exactly as today. No schema or policy changes required.
4. **Realtime listener** continues to subscribe to `companies` row updates and re-evaluate `getLockoutReason`. When the subscription reactivates or the user is seated, the overlay unmounts. On the page, the resolver's `lockoutReason === null` branch issues a `router.replace("/dashboard")`, and the dashboard's own auth gate validates from there — no redirect loop because `/dashboard` is in the `(dashboard)` route group, not `(auth)`.
5. **`Button variant="primary" size="sm"` 44px touch target** is intentional but visually larger than the page-default 28px. If product wants a smaller filled CTA on the desktop-only `/locked`, the spec is forward-compatible — swap the size prop without touching the variant.

## Bible updates required (in the same implementation session)

Per root CLAUDE.md ("Keep the bible updated. When you implement a feature, add a migration, change a data model, or build a new system — update the relevant bible section in the same session.") — these bible edits ship with the implementation:

1. **`12_SUBSCRIPTION_MANAGEMENT.md § Readers — Gating, Lockout, Display`** — currently references inline state branches in `components/ops/lockout-overlay.tsx`. Update the prose to describe the new `LockoutResolver` + per-state modules + `LockoutShell` architecture, and point to this spec for design rationale.
2. **`07_SPECIALIZED_FEATURES.md § 14 Notification System`** — no schema change; add a one-line note that the lockout request flow continues to use `type: "role_needed"` with `persistent: true`, now resolved through the dedicated `RequestButton` shared component.
3. **`05_DESIGN_SYSTEM.md`** — no edits needed; the Z-index scale already covers the lockout layer.

## Out-of-scope follow-ups (separate sessions)

- **Migrate Button `variant="primary"` to outlined-at-rest** (canonical spec v2 alignment) — touches every CTA in the app.
- **Migrate `.glass-surface` / `.glass-dense` global radii** from 10/12 → 5/5 — visible everywhere.
- **Delete or refactor `Button variant="accent"`** (amber CTA) — used in places beyond the lockout; needs full audit.
- **ES translations** for the new `lockout.*` keys.
- **Add `.t-display`, `.t-section`, `.t-panel-title`, `.t-body` utility classes** to OPS-Web `globals.css` so future surfaces don't need to repeat Tailwind compositions.

---

## Verification plan (during implementation)

1. **Type check** — `pnpm typecheck` clean.
2. **Lint** — `pnpm lint` clean.
3. **All four states render** — manually trigger each `(reason, role)` combo:
   - subscription_expired × admin: paid sub → set `subscription_status = 'expired'` in dev DB
   - subscription_expired × member: same, but log in as non-admin user
   - unseated × admin: remove admin from `admin_ids` array (would need owner separately)
   - unseated × member: remove from `seated_employee_ids`
4. **Page surface** — visit `/locked` directly while in each state; correct module renders.
5. **Overlay surface** — visit dashboard while in each state; overlay renders correct module. Verify `/settings` and `/team` exemptions still work for admins.
6. **Realtime** — in two browser tabs, reactivate subscription in tab A; tab B's overlay unmounts within 1–2s.
7. **Cooldown** — click "Request reactivation"; reload; button stays in sent state for 24h. Confirm the localStorage key is `ops-lockout-request-${userId}` (unchanged from pre-redesign).
8. **No-admins edge** — temporarily clear `admin_ids` in dev DB; member states show "Contact support" CTA instead of request button.
9. **Reduced motion** — toggle OS-level reduced motion; entrance animations collapse to opacity-only fades.
10. **Visual diff against spec** — confirm no amber, no ribbon, no checkmark bullets, no `ShieldOff` icon, no `text-display` Mohave headlines, no decorative orbs on `/locked`.
11. **Date resolution** — set `subscription_status='expired'` with paid plan + `subscription_end='2026-04-30'` (no `trial_end_date`). Confirm body reads "Your team's access expired on Apr 30, 2026." and fingerprint reads `SYS :: SUB-EXP · 2026-04-30`. Then clear both date fields; confirm dateless variant of body/tag/fingerprint renders. **No `{{date}}` literal must appear in DOM.**
12. **Notification rows written** — click "Request reactivation"; query `notifications` table; confirm one row per admin with `type='role_needed'`, `persistent=true`, `action_url='/settings?tab=subscription'`, `action_label='Manage Subscription'`.
13. **Bible diff** — confirm `12_SUBSCRIPTION_MANAGEMENT.md § Readers` and `07_SPECIALIZED_FEATURES.md § 14` updated in the same commit as the code.

---

## Implementation order (preview — actual plan written separately by writing-plans skill)

1. Add `src/lib/i18n/interpolate.ts` shared helper.
2. Add new dictionary keys (EN + `[ES TODO]`-prefixed ES) to `auth.json` files. Don't yet delete old keys.
3. Add `lockoutShellStaggerVariants`, `lockoutShellChildVariants`, `lockoutShellChildVariantsReduced` to `src/lib/utils/motion.ts`.
4. Build hooks: `use-admin-names.ts`, `use-realtime-company.ts`, `use-request-cooldown.ts`, `use-lockout-date.ts` — extracting from current inline implementations where applicable.
5. Build presentation components: `lockout-shell.tsx`, `pricing-row.tsx`, `pricing-card.tsx`, `admin-tag.tsx`, `request-button.tsx`, `request-sent-row.tsx`, the four state modules, `lockout-resolver.tsx`.
6. Strip decorative atmosphere from `src/app/(auth)/locked/layout.tsx`.
7. Replace `src/app/(auth)/locked/page.tsx` body with `<LockoutResolver variant="page" />`.
8. Replace state branches in `src/components/ops/lockout-overlay.tsx` with `<LockoutResolver variant="overlay" />`; keep backdrop + `pathname` exemptions + `AnimatePresence` + realtime hook (now via the extracted shared hook).
9. Update bible: `12_SUBSCRIPTION_MANAGEMENT.md § Readers`, `07_SPECIALIZED_FEATURES.md § 14`.
10. Verify all four states on both surfaces per the verification plan.
11. Delete old dictionary keys (`locked.*`, `lockout.*` legacy) + the now-unused `PricingCard` / `CompactPricingCard` / inline `RequestButton` blocks in the old files. Confirm no other consumers reference deleted keys before deletion.
12. Run `pnpm typecheck` + `pnpm lint` + targeted manual QA.
