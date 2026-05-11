# Lockout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OPS-Web `/locked` page and in-app `LockoutOverlay` with a single spec-compliant shell + four state modules that render the right content per `(reason, role)`, eliminate design-system violations, and consolidate ~120 LOC of duplicated pricing-card markup.

**Architecture:** One `LockoutShell` (top rail / heading / body / divider / state slot / footer) consumed by both surfaces. A `LockoutResolver` picks one of four state modules from `(getLockoutReason, selectIsAdminOrOwner)`. Page mode and overlay mode differ only in container chrome. Pricing replaces the legacy ribbon/checkmark cards with on-spec tier cards. Single steel CTA per screen invariant. All copy moves to `auth.lockout.*` keys with EN-only strings; ES gets `[ES TODO]`-prefixed placeholders.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Framer Motion · Zustand (auth-store) · Supabase Realtime · Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-05-07-lockout-redesign-design.md`

**Working dir:** `/Users/jacksonsweet/Projects/OPS/OPS-Web`

---

## File structure

**Created:**
- `src/lib/i18n/interpolate.ts` — client-side `{{var}}` interpolator (mirrors `server-render.ts`)
- `src/lib/i18n/__tests__/interpolate.test.ts`
- `src/components/lockout/lockout-shell.tsx`
- `src/components/lockout/lockout-resolver.tsx`
- `src/components/lockout/pricing-row.tsx`
- `src/components/lockout/pricing-card.tsx`
- `src/components/lockout/admin-tag.tsx`
- `src/components/lockout/request-button.tsx`
- `src/components/lockout/request-sent-row.tsx`
- `src/components/lockout/states/expired-admin.tsx`
- `src/components/lockout/states/expired-member.tsx`
- `src/components/lockout/states/unseated-admin.tsx`
- `src/components/lockout/states/unseated-member.tsx`
- `src/components/lockout/hooks/use-admin-names.ts`
- `src/components/lockout/hooks/use-realtime-company.ts`
- `src/components/lockout/hooks/use-request-cooldown.ts`
- `src/components/lockout/hooks/use-lockout-date.ts`
- `src/components/lockout/hooks/__tests__/use-lockout-date.test.ts`
- `src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts`

**Modified:**
- `src/i18n/dictionaries/en/auth.json` — add new keys, delete legacy
- `src/i18n/dictionaries/es/auth.json` — add `[ES TODO]`-prefixed keys, delete legacy
- `src/lib/utils/motion.ts` — add three new variants
- `src/app/(auth)/locked/page.tsx` — replace body with `<LockoutResolver variant="page" />`
- `src/app/(auth)/locked/layout.tsx` — strip decorative atmosphere
- `src/components/ops/lockout-overlay.tsx` — replace state branches with `<LockoutResolver variant="overlay" />`
- `ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md` — update Readers section
- `ops-software-bible/07_SPECIALIZED_FEATURES.md` — note request flow refactor

**Deleted (after migration verified):**
- Legacy dictionary keys (see Task 24)
- Inline `PricingCard`, `CompactPricingCard`, `RequestButton`, `AdminDisplay`, `FooterLinks` blocks in old files

---

## Task 1 — i18n interpolate helper

**Files:**
- Create: `src/lib/i18n/interpolate.ts`
- Test: `src/lib/i18n/__tests__/interpolate.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/i18n/__tests__/interpolate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { interpolate } from "../interpolate";

describe("interpolate", () => {
  it("substitutes a single placeholder", () => {
    expect(interpolate("Hello {{name}}", { name: "Jack" })).toBe("Hello Jack");
  });

  it("substitutes multiple placeholders", () => {
    expect(
      interpolate("{{a}} and {{b}}", { a: "one", b: "two" })
    ).toBe("one and two");
  });

  it("coerces numbers to strings", () => {
    expect(interpolate("Count: {{n}}", { n: 5 })).toBe("Count: 5");
  });

  it("leaves the placeholder literal when key is missing", () => {
    expect(interpolate("Hello {{name}}", {})).toBe("Hello {{name}}");
  });

  it("returns the template unchanged when there are no placeholders", () => {
    expect(interpolate("plain string", { x: "y" })).toBe("plain string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && pnpm vitest run src/lib/i18n/__tests__/interpolate.test.ts
```

Expected: FAIL — `Cannot find module '../interpolate'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/i18n/interpolate.ts`:

```ts
export function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{{${key}}}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/lib/i18n/__tests__/interpolate.test.ts
```

Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/interpolate.ts src/lib/i18n/__tests__/interpolate.test.ts
git commit -m "feat(i18n): add client-side interpolate helper for {{var}} substitution

Mirrors server-render.ts:74-83 so client components can substitute
dictionary placeholders. Used first by the lockout redesign.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Motion variants

**Files:**
- Modify: `src/lib/utils/motion.ts` (append new exports)

- [ ] **Step 1: Read existing motion variants for style reference**

```bash
sed -n '180,230p' /Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/utils/motion.ts
```

Note the `[0.22, 1, 0.36, 1]` ease tuple style and `Variants` type import.

- [ ] **Step 2: Append three new variants to `src/lib/utils/motion.ts`**

Add at end of file (before any default export, if any):

```ts
// ─── Lockout shell stagger (per spec 2026-05-07-lockout-redesign-design.md) ──

export const lockoutShellStaggerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const lockoutShellChildVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  },
};

export const lockoutShellChildVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/motion.ts
git commit -m "feat(motion): add lockout shell stagger variants

Adds container/child variants used by the LockoutShell entrance
animation. Both motion-on and reduced-motion variants ship together.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Dictionary keys (add new, keep legacy)

**Files:**
- Modify: `src/i18n/dictionaries/en/auth.json`
- Modify: `src/i18n/dictionaries/es/auth.json`

- [ ] **Step 1: Append new EN keys to `src/i18n/dictionaries/en/auth.json`**

Open the file and add the following keys before the closing `}`. Comma after the last existing key (`"joinTeam.cancel": "Cancel"`).

```json
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
```

Do **not** delete legacy `locked.*` / `lockout.*` keys yet — Task 24 cleans them up after the new components ship.

- [ ] **Step 2: Append matching `[ES TODO]`-prefixed keys to `src/i18n/dictionaries/es/auth.json`**

Same key structure, but every value prefixed with `[ES TODO] `. Example:

```json
  "lockout.shared.contactSupport": "[ES TODO] Contact support",
  "lockout.shared.switchAccount": "[ES TODO] Switch account",
  ...
  "lockout.pricing.subscribeFailed.generic": "[ES TODO] Try again or contact support."
```

Apply this prefix to every new key in the EN block above.

- [ ] **Step 3: Validate JSON syntax**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/dictionaries/en/auth.json', 'utf8'))" && \
  node -e "JSON.parse(require('fs').readFileSync('src/i18n/dictionaries/es/auth.json', 'utf8'))"
```

Expected: no output (success). If syntax error, fix the missing comma before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/dictionaries/en/auth.json src/i18n/dictionaries/es/auth.json
git commit -m "feat(i18n): add lockout.* dictionary keys for redesign

Adds the consolidated lockout namespace covering all 4 (reason, role)
states plus the pricing row. Legacy keys kept until consumers migrate.
ES strings ship as [ES TODO]-prefixed placeholders for follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `useRequestCooldown` hook

**Files:**
- Create: `src/components/lockout/hooks/use-request-cooldown.ts`
- Test: `src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRequestCooldown } from "../use-request-cooldown";

describe("useRequestCooldown", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("returns isActive=false when no record exists", () => {
    const { result } = renderHook(() => useRequestCooldown("user-1"));
    expect(result.current.isActive).toBe(false);
  });

  it("returns isActive=true after setCooldown for the same user", () => {
    const { result } = renderHook(() => useRequestCooldown("user-1"));
    act(() => result.current.setCooldown("subscription_expired"));
    expect(result.current.isActive).toBe(true);
  });

  it("does NOT trigger cooldown across different userIds", () => {
    const a = renderHook(() => useRequestCooldown("user-1"));
    act(() => a.result.current.setCooldown("subscription_expired"));
    const b = renderHook(() => useRequestCooldown("user-2"));
    expect(b.result.current.isActive).toBe(false);
  });

  it("uses the storage key shape ops-lockout-request-${userId}", () => {
    const { result } = renderHook(() => useRequestCooldown("user-99"));
    act(() => result.current.setCooldown("unseated"));
    expect(localStorage.getItem("ops-lockout-request-user-99")).not.toBeNull();
  });

  it("expires after 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T10:00:00Z"));
    const { result, rerender } = renderHook(() => useRequestCooldown("user-1"));
    act(() => result.current.setCooldown("subscription_expired"));
    expect(result.current.isActive).toBe(true);

    vi.setSystemTime(new Date("2026-05-08T10:00:01Z")); // 24h + 1s later
    rerender();
    expect(result.current.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/lockout/hooks/use-request-cooldown.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const KEY_PREFIX = "ops-lockout-request-";

type CooldownReason = "subscription_expired" | "unseated";

interface StoredRecord {
  timestamp: number;
  reason: CooldownReason;
}

function readRecord(userId: string): StoredRecord | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`${KEY_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isWithinWindow(record: StoredRecord, now: number): boolean {
  return now - record.timestamp < COOLDOWN_MS;
}

export function useRequestCooldown(userId: string) {
  const compute = useCallback(() => {
    const record = readRecord(userId);
    if (!record) return { isActive: false, sentAt: null as Date | null };
    const active = isWithinWindow(record, Date.now());
    return {
      isActive: active,
      sentAt: active ? new Date(record.timestamp) : null,
    };
  }, [userId]);

  const [state, setState] = useState(compute);

  useEffect(() => {
    setState(compute());
  }, [compute]);

  const setCooldown = useCallback(
    (reason: CooldownReason) => {
      if (typeof window === "undefined") return;
      const record: StoredRecord = { timestamp: Date.now(), reason };
      localStorage.setItem(`${KEY_PREFIX}${userId}`, JSON.stringify(record));
      setState({ isActive: true, sentAt: new Date(record.timestamp) });
    },
    [userId]
  );

  return { isActive: state.isActive, sentAt: state.sentAt, setCooldown };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts
```

Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/components/lockout/hooks/use-request-cooldown.ts src/components/lockout/hooks/__tests__/use-request-cooldown.test.ts
git commit -m "feat(lockout): extract useRequestCooldown hook

Pulls localStorage cooldown logic out of lockout-overlay.tsx into a
reusable hook. Storage key 'ops-lockout-request-\${userId}' preserved
exactly so users with active 24h cooldowns aren't reset on deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `useLockoutDate` hook

**Files:**
- Create: `src/components/lockout/hooks/use-lockout-date.ts`
- Test: `src/components/lockout/hooks/__tests__/use-lockout-date.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/components/lockout/hooks/__tests__/use-lockout-date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLockoutDate } from "../use-lockout-date";
import { SubscriptionPlan } from "@/lib/types/models";

describe("useLockoutDate", () => {
  it("returns null when company is null", () => {
    const { result } = renderHook(() => useLockoutDate(null));
    expect(result.current).toBeNull();
  });

  it("returns trialEndDate when plan is Trial", () => {
    const date = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: date,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe(date.toISOString());
  });

  it("returns subscriptionEnd when plan is paid (Team)", () => {
    const subEnd = new Date("2026-05-01T00:00:00Z");
    const trialEnd = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Team,
        trialEndDate: trialEnd,
        subscriptionEnd: subEnd,
      })
    );
    expect(result.current?.toISOString()).toBe(subEnd.toISOString());
  });

  it("falls back to trialEndDate on paid plan when subscriptionEnd is null", () => {
    const trialEnd = new Date("2026-04-30T00:00:00Z");
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Business,
        trialEndDate: trialEnd,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe(trialEnd.toISOString());
  });

  it("returns null when both dates are null", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Team,
        trialEndDate: null,
        subscriptionEnd: null,
      })
    );
    expect(result.current).toBeNull();
  });

  it("parses string dates that come from JSON deserialization", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: "2026-04-30T00:00:00.000Z" as unknown as Date,
        subscriptionEnd: null,
      })
    );
    expect(result.current?.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("returns null when date is invalid", () => {
    const { result } = renderHook(() =>
      useLockoutDate({
        subscriptionPlan: SubscriptionPlan.Trial,
        trialEndDate: "not-a-date" as unknown as Date,
        subscriptionEnd: null,
      })
    );
    expect(result.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/components/lockout/hooks/__tests__/use-lockout-date.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/lockout/hooks/use-lockout-date.ts`:

```ts
import { useMemo } from "react";
import { type Company, SubscriptionPlan } from "@/lib/types/models";

type CompanyDateInput = Pick<
  Company,
  "subscriptionPlan" | "trialEndDate" | "subscriptionEnd"
>;

/**
 * Resolves the "expired on" date for a lockout display.
 * - Trial path → trial_end_date
 * - Paid path → subscription_end, falling back to trial_end_date as historical anchor
 * - Invalid / missing → null (renderer picks the dateless copy variant)
 */
export function useLockoutDate(company: CompanyDateInput | null): Date | null {
  return useMemo(() => {
    if (!company) return null;

    const candidate =
      company.subscriptionPlan === SubscriptionPlan.Trial
        ? company.trialEndDate
        : company.subscriptionEnd ?? company.trialEndDate;

    if (!candidate) return null;

    const date =
      candidate instanceof Date
        ? candidate
        : new Date(candidate as unknown as string);

    return Number.isNaN(date.getTime()) ? null : date;
  }, [company]);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/components/lockout/hooks/__tests__/use-lockout-date.test.ts
```

Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add src/components/lockout/hooks/use-lockout-date.ts src/components/lockout/hooks/__tests__/use-lockout-date.test.ts
git commit -m "feat(lockout): add useLockoutDate hook

Resolves the right 'expired on' date for the lockout display:
trial_end_date for trial-path, subscription_end for paid-path
(per ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md schema).
Returns null on missing/invalid dates so renderer picks dateless copy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `useAdminNames` hook (extract)

**Files:**
- Create: `src/components/lockout/hooks/use-admin-names.ts`

- [ ] **Step 1: Read the existing inline implementation**

```bash
sed -n '53,87p' /Users/jacksonsweet/Projects/OPS/OPS-Web/src/components/ops/lockout-overlay.tsx
```

- [ ] **Step 2: Create extracted hook**

Create `src/components/lockout/hooks/use-admin-names.ts`:

```ts
import { useEffect, useState } from "react";
import { requireSupabase } from "@/lib/supabase/helpers";

export interface AdminEntry {
  id: string;
  name: string;
}

/**
 * Fetches display names for the given admin user IDs.
 * Silently swallows errors — admin names are cosmetic; missing names
 * fall back to "Admin" rather than blocking the lockout.
 */
export function useAdminNames(adminIds: string[] | undefined): AdminEntry[] {
  const [admins, setAdmins] = useState<AdminEntry[]>([]);

  useEffect(() => {
    if (!adminIds?.length) {
      setAdmins([]);
      return;
    }

    let cancelled = false;

    async function fetchNames() {
      try {
        const supabase = requireSupabase();
        const { data } = await supabase
          .from("users")
          .select("id, first_name, last_name")
          .in("id", adminIds!);

        if (cancelled || !data) return;

        setAdmins(
          data.map(
            (u: { id: string; first_name: string; last_name: string }) => ({
              id: u.id,
              name:
                [u.first_name, u.last_name].filter(Boolean).join(" ") ||
                "Admin",
            })
          )
        );
      } catch {
        // Silently fail — admin names are cosmetic
      }
    }

    fetchNames();
    return () => {
      cancelled = true;
    };
  }, [adminIds]);

  return admins;
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/lockout/hooks/use-admin-names.ts
git commit -m "feat(lockout): extract useAdminNames hook

Pulls admin-name fetching out of lockout-overlay.tsx so both the
overlay and the page surface can resolve admin display names.
Behavior identical: silent on errors, 'Admin' fallback on empty names.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — `useRealtimeCompany` hook (extract)

**Files:**
- Create: `src/components/lockout/hooks/use-realtime-company.ts`

- [ ] **Step 1: Read the existing inline implementation**

```bash
sed -n '91,145p' /Users/jacksonsweet/Projects/OPS/OPS-Web/src/components/ops/lockout-overlay.tsx
```

- [ ] **Step 2: Create extracted hook**

Create `src/components/lockout/hooks/use-realtime-company.ts`:

```ts
import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";

/**
 * Subscribes to UPDATE events on the user's company row and patches the
 * auth-store with the latest subscription/seat fields. Used by the
 * lockout surfaces to react to admin actions in another tab.
 */
export function useRealtimeCompany(companyId: string | undefined): void {
  const setCompany = useAuthStore((s) => s.setCompany);

  useEffect(() => {
    if (!companyId) return;

    let channel: ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null = null;

    try {
      const supabase = requireSupabase();
      channel = supabase
        .channel(`lockout-company-${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "companies",
            filter: `id=eq.${companyId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            const currentCompany = useAuthStore.getState().company;
            if (!currentCompany) return;

            setCompany({
              ...currentCompany,
              subscriptionStatus:
                (row.subscription_status as typeof currentCompany.subscriptionStatus) ??
                currentCompany.subscriptionStatus,
              subscriptionPlan:
                (row.subscription_plan as typeof currentCompany.subscriptionPlan) ??
                currentCompany.subscriptionPlan,
              subscriptionEnd: row.subscription_end
                ? new Date(row.subscription_end as string)
                : currentCompany.subscriptionEnd,
              trialEndDate: row.trial_end_date
                ? new Date(row.trial_end_date as string)
                : currentCompany.trialEndDate,
              maxSeats: (row.max_seats as number) ?? currentCompany.maxSeats,
              seatedEmployeeIds:
                (row.seated_employee_ids as string[]) ??
                currentCompany.seatedEmployeeIds,
              adminIds: (row.admin_ids as string[]) ?? currentCompany.adminIds,
            });
          }
        )
        .subscribe();
    } catch {
      // Silently fail — realtime is a nicety
    }

    return () => {
      if (channel) {
        try {
          const supabase = requireSupabase();
          supabase.removeChannel(channel);
        } catch {
          // cleanup silently
        }
      }
    };
  }, [companyId, setCompany]);
}
```

Note: this version adds `subscriptionEnd` to the patched fields — the original missed it, but the date-resolution logic relies on it.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/lockout/hooks/use-realtime-company.ts
git commit -m "feat(lockout): extract useRealtimeCompany hook

Pulls realtime company-row subscription out of lockout-overlay.tsx.
Adds subscriptionEnd to the patched fields so paid-path expiry dates
update in real time when Stripe webhooks fire.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — `AdminTag` component

**Files:**
- Create: `src/components/lockout/admin-tag.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/admin-tag.tsx`:

```tsx
import { useDictionary } from "@/i18n/client";
import type { AdminEntry } from "./hooks/use-admin-names";

export interface AdminTagProps {
  admins: AdminEntry[];
}

export function AdminTag({ admins }: AdminTagProps) {
  const { t } = useDictionary("auth");
  if (admins.length === 0) return null;

  const primary = admins[0];
  const others = admins.length - 1;

  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 mb-3">
      <span className="text-text-mute">// </span>
      {t("lockout.shared.adminLabel")}
      <span className="text-text-mute"> :: </span>
      <span className="text-text">{primary.name.toUpperCase()}</span>
      {others > 0 && (
        <span className="text-text-3"> (+{others} {t("lockout.shared.adminOthers").toUpperCase()})</span>
      )}
    </p>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/admin-tag.tsx
git commit -m "feat(lockout): add AdminTag tactical label component

Renders '// ADMIN :: NAME (+N OTHERS)' in mono uppercase per OPS voice.
Returns null on empty admin list. Used by the member states.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — `RequestSentRow` component

**Files:**
- Create: `src/components/lockout/request-sent-row.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/request-sent-row.tsx`:

```tsx
import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export interface RequestSentRowProps {
  timestamp: Date;
}

function formatTimestamp(date: Date): string {
  // HH:MM TZ in user's locale, e.g. "14:23 PT"
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const tz = new Intl.DateTimeFormat([], { timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return tz ? `${time} ${tz}` : time;
}

export function RequestSentRow({ timestamp }: RequestSentRowProps) {
  const { t } = useDictionary("auth");
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 w-full px-3 py-3 rounded-[2.5px] bg-[var(--olive-soft)] border border-[var(--olive-line)] text-[var(--olive)]"
    >
      <Check className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
        {t("lockout.shared.requestSent").toUpperCase()} · {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/request-sent-row.tsx
git commit -m "feat(lockout): add RequestSentRow confirmation component

Olive-semantic success row that replaces the request button after
a request lands or while within the 24h cooldown window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — `RequestButton` component

**Files:**
- Create: `src/components/lockout/request-button.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/request-button.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { requireSupabase } from "@/lib/supabase/helpers";
import {
  type NotificationType,
} from "@/lib/api/services/notification-service";
import { RequestSentRow } from "./request-sent-row";
import { useRequestCooldown } from "./hooks/use-request-cooldown";

export interface RequestButtonProps {
  reason: "subscription_expired" | "unseated";
  userId: string;
  companyId: string;
  userName: string;
  adminIds: string[];
  /** Dictionary key resolving to the button label (e.g. "lockout.expiredMember.cta"). */
  ctaKey: string;
}

export function RequestButton({
  reason,
  userId,
  companyId,
  userName,
  adminIds,
  ctaKey,
}: RequestButtonProps) {
  const { t } = useDictionary("auth");
  const cooldown = useRequestCooldown(userId);
  const [sending, setSending] = useState(false);

  const noAdmins = adminIds.length === 0;
  const isReactivation = reason === "subscription_expired";

  const handleClick = useCallback(async () => {
    if (sending || cooldown.isActive || noAdmins) return;
    setSending(true);

    try {
      const supabase = requireSupabase();
      const rows = adminIds.map((adminId) => ({
        user_id: adminId,
        company_id: companyId,
        type: "role_needed" as NotificationType,
        title: isReactivation ? "Reactivation Request" : "Access Request",
        body: isReactivation
          ? `${userName} is requesting subscription reactivation`
          : `${userName} is requesting seat restoration`,
        is_read: false,
        persistent: true,
        action_url: isReactivation ? "/settings?tab=subscription" : "/team",
        action_label: isReactivation ? "Manage Subscription" : "Manage Team",
      }));

      const { error } = await supabase.from("notifications").insert(rows);
      if (!error) cooldown.setCooldown(reason);
    } catch {
      // Silently fail — admin will see a different path eventually
    } finally {
      setSending(false);
    }
  }, [
    sending,
    cooldown,
    noAdmins,
    adminIds,
    companyId,
    userName,
    reason,
    isReactivation,
  ]);

  if (noAdmins) return null;

  if (cooldown.isActive && cooldown.sentAt) {
    return <RequestSentRow timestamp={cooldown.sentAt} />;
  }

  return (
    <Button
      variant="primary"
      size="sm"
      className="w-full"
      onClick={handleClick}
      disabled={sending}
      loading={sending}
    >
      {t(ctaKey)}
    </Button>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/request-button.tsx
git commit -m "feat(lockout): add shared RequestButton component

Inserts one notification row per admin (type=role_needed, persistent=true),
sets the 24h cooldown via useRequestCooldown, and swaps to RequestSentRow
once the request lands. Used by both expired-member and unseated-member
states. No-admins case returns null so the parent renders a fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — `PricingCard` component

**Files:**
- Create: `src/components/lockout/pricing-card.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/pricing-card.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import {
  TIER_CONFIG,
  type SubscriptionTier,
} from "@/lib/subscription";

export interface PricingCardProps {
  tier: Exclude<SubscriptionTier, "trial">;
  companyId: string | undefined;
  isRecommended: boolean;
}

export function PricingCard({ tier, companyId, isRecommended }: PricingCardProps) {
  const { t } = useDictionary("auth");
  const config = TIER_CONFIG[tier];
  const [loading, setLoading] = useState(false);

  const handleSubscribe = useCallback(async () => {
    if (loading) return;
    if (!companyId) {
      toast.error(t("lockout.pricing.subscribeFailed.title"), {
        description: t("lockout.pricing.subscribeFailed.noCompany"),
      });
      return;
    }
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ companyId, plan: tier, period: "Monthly" }),
      });
      const data = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        toast.error(t("lockout.pricing.subscribeFailed.title"), {
          description: data.message ?? t("lockout.pricing.subscribeFailed.generic"),
        });
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(t("lockout.pricing.subscribeFailed.title"), {
        description:
          err instanceof Error ? err.message : t("lockout.pricing.subscribeFailed.generic"),
      });
    } finally {
      setLoading(false);
    }
  }, [loading, companyId, tier, t]);

  const summaryKey = `lockout.pricing.${tier}.summary`;

  return (
    <div className="relative flex flex-col">
      {isRecommended && (
        <p className="font-cakemono font-light text-[11px] uppercase tracking-[0.08em] text-text-3 mb-1">
          // {t("lockout.pricing.recommended")}
        </p>
      )}
      <div className="glass-surface rounded-[5px] p-4 flex flex-col flex-1">
        <h3 className="font-cakemono font-light text-[18px] uppercase tracking-tight text-text mb-2">
          {config.name}
        </h3>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="font-mono text-[28px] leading-none text-text [font-feature-settings:'tnum'_1,'zero'_1]">
            ${config.price}
          </span>
          <span className="font-mohave text-[13px] text-text-3">
            {t("lockout.pricing.perMonth")}
          </span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 mb-2 [font-feature-settings:'tnum'_1,'zero'_1]">
          {config.maxSeats} {t("lockout.pricing.seatsLabel")}
        </p>
        <p className="font-mohave text-[14px] text-text-2 mb-3 flex-1">{t(summaryKey)}</p>
        <Button
          variant={isRecommended ? "primary" : "default"}
          className="w-full"
          onClick={handleSubscribe}
          disabled={loading}
          loading={loading}
        >
          {t("lockout.pricing.subscribe")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/pricing-card.tsx
git commit -m "feat(lockout): add spec-compliant PricingCard

Replaces both legacy PricingCard (page) and CompactPricingCard (overlay)
with a single component: 5px radius, no ribbon, no checkmarks, no amber.
Recommended tier gets // RECOMMENDED label + variant=primary CTA;
others get variant=default. Stripe checkout endpoint unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12 — `PricingRow` component

**Files:**
- Create: `src/components/lockout/pricing-row.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/pricing-row.tsx`:

```tsx
import { PricingCard } from "./pricing-card";
import type { SubscriptionTier } from "@/lib/subscription";

export interface PricingRowProps {
  companyId: string | undefined;
  recommendedTier?: Exclude<SubscriptionTier, "trial">;
}

const TIERS: ReadonlyArray<Exclude<SubscriptionTier, "trial">> = [
  "starter",
  "team",
  "business",
];

export function PricingRow({
  companyId,
  recommendedTier = "team",
}: PricingRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {TIERS.map((tier) => (
        <PricingCard
          key={tier}
          tier={tier}
          companyId={companyId}
          isRecommended={tier === recommendedTier}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/pricing-row.tsx
git commit -m "feat(lockout): add PricingRow

Three-tier pricing layout. Stacks on narrow viewports (mobile overlay),
3-column on >=md (page + desktop overlay). Marks one tier as
recommended (default: team) — that tier renders with primary CTA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13 — `LockoutShell` component

**Files:**
- Create: `src/components/lockout/lockout-shell.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/lockout-shell.tsx`:

```tsx
"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Headphones } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  lockoutShellChildVariants,
  lockoutShellChildVariantsReduced,
  lockoutShellStaggerVariants,
} from "@/lib/utils/motion";

export interface LockoutShellTagProps {
  tone: "rose" | "tan";
  label: string;
}

export interface LockoutShellProps {
  variant: "page" | "overlay";
  tag: LockoutShellTagProps;
  heading: string;
  body: string;
  sectionLabel: string;
  fingerprint: string;
  children: ReactNode;
  showSwitchAccount?: boolean;
}

const TONE_CLASSES: Record<LockoutShellTagProps["tone"], string> = {
  rose: "bg-[var(--rose-soft)] text-[var(--rose)] border-[var(--rose-line)]",
  tan: "bg-[var(--tan-soft)] text-[var(--tan)] border-[var(--tan-line)]",
};

export function LockoutShell({
  variant,
  tag,
  heading,
  body,
  sectionLabel,
  fingerprint,
  children,
  showSwitchAccount = true,
}: LockoutShellProps) {
  const { t } = useDictionary("auth");
  const prefersReducedMotion = useReducedMotion();
  const childVariants = useMemo(
    () =>
      prefersReducedMotion ? lockoutShellChildVariantsReduced : lockoutShellChildVariants,
    [prefersReducedMotion]
  );

  const isPage = variant === "page";

  return (
    <motion.div
      className={cn(
        isPage
          ? "glass-surface w-full max-w-[720px] mx-auto p-8"
          : "glass-dense w-full max-w-[520px] mx-auto p-6",
        "rounded-[5px] overflow-hidden"
      )}
      variants={lockoutShellStaggerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Top rail */}
      <motion.div
        variants={childVariants}
        className="flex items-center justify-between gap-3 mb-4"
      >
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2.5px] border font-mono text-[11px] uppercase tracking-[0.12em]",
            TONE_CLASSES[tag.tone]
          )}
        >
          {tag.label}
        </span>
        <a
          href="mailto:support@opsapp.co"
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
        >
          <span className="text-text-mute">// </span>
          {t("lockout.shared.contactSupport").toUpperCase()}
        </a>
      </motion.div>

      {/* Hero */}
      <motion.div variants={childVariants} className="mb-6">
        <h2
          id="lockout-heading"
          className="font-cakemono font-light text-[30px] uppercase tracking-tight text-text leading-none mb-3"
        >
          {heading}
        </h2>
        <p className="font-mohave text-[14px] text-text-2 leading-[1.45]">
          {body}
        </p>
      </motion.div>

      {/* Section divider */}
      <motion.div
        variants={childVariants}
        className="flex items-center gap-3 mb-5"
      >
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">// </span>
          {sectionLabel}
        </span>
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
      </motion.div>

      {/* State module slot */}
      <motion.div variants={childVariants} className="mb-6">
        {children}
      </motion.div>

      {/* Footer */}
      <motion.div variants={childVariants}>
        <div className="h-px bg-[var(--line,rgba(255,255,255,0.10))] mb-3" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <a
              href="mailto:support@opsapp.co"
              className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
            >
              <Headphones className="w-[12px] h-[12px]" aria-hidden="true" />
              {t("lockout.shared.contactSupport").toUpperCase()}
            </a>
            {showSwitchAccount && (
              <Link
                href="/login"
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
              >
                <span className="text-text-mute">// </span>
                {t("lockout.shared.switchAccount").toUpperCase()}
              </Link>
            )}
          </div>
          <span className="font-mono text-[11px] tracking-[0.12em] text-text-mute">
            {fingerprint}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/lockout-shell.tsx
git commit -m "feat(lockout): add LockoutShell — shared visual frame

Top rail (semantic tag + contact link) / hero / section divider /
state module slot / footer (links + fingerprint). page variant uses
glass-surface 720px max, overlay variant uses glass-dense 520px max.
Staggered entrance via new motion variants; reduced-motion safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14 — `ExpiredAdminState` module

**Files:**
- Create: `src/components/lockout/states/expired-admin.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/states/expired-admin.tsx`:

```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { interpolate } from "@/lib/i18n/interpolate";
import { LockoutShell } from "../lockout-shell";
import { PricingRow } from "../pricing-row";
import { useLockoutDate } from "../hooks/use-lockout-date";

export interface ExpiredAdminStateProps {
  variant: "page" | "overlay";
}

export function ExpiredAdminState({ variant }: ExpiredAdminStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const date = useLockoutDate(
    company
      ? {
          subscriptionPlan: company.subscriptionPlan,
          trialEndDate: company.trialEndDate,
          subscriptionEnd: company.subscriptionEnd,
        }
      : null
  );

  const displayDate = date
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date)
    : null;
  const isoDate = date ? date.toISOString().slice(0, 10) : null;

  const tagLabel = displayDate
    ? interpolate(t("lockout.expiredAdmin.tagWithDate"), { date: displayDate })
    : t("lockout.expiredAdmin.tag");
  const body = displayDate
    ? interpolate(t("lockout.expiredAdmin.bodyWithDate"), { date: displayDate })
    : t("lockout.expiredAdmin.body");
  const fingerprint = isoDate
    ? interpolate(t("lockout.expiredAdmin.fingerprintWithDate"), { date: isoDate })
    : t("lockout.expiredAdmin.fingerprint");

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "rose", label: tagLabel }}
      heading={t("lockout.expiredAdmin.heading")}
      body={body}
      sectionLabel={t("lockout.expiredAdmin.sectionLabel")}
      fingerprint={fingerprint}
      showSwitchAccount={false}
    >
      <PricingRow companyId={company?.id} />
      <p className="font-mohave text-[13px] text-text-3 mt-3">
        {t("lockout.expiredAdmin.guarantee")}
      </p>
    </LockoutShell>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/states/expired-admin.tsx
git commit -m "feat(lockout): add ExpiredAdminState

Renders pricing row + reactivate path for admins on expired subs.
Resolves the date via useLockoutDate (trial_end_date or subscription_end)
and picks the dateless or with-date copy variant accordingly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15 — `ExpiredMemberState` module

**Files:**
- Create: `src/components/lockout/states/expired-member.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/states/expired-member.tsx`:

```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { interpolate } from "@/lib/i18n/interpolate";
import { LockoutShell } from "../lockout-shell";
import { AdminTag } from "../admin-tag";
import { RequestButton } from "../request-button";
import { Button } from "@/components/ui/button";
import { useAdminNames } from "../hooks/use-admin-names";
import { useLockoutDate } from "../hooks/use-lockout-date";

export interface ExpiredMemberStateProps {
  variant: "page" | "overlay";
}

export function ExpiredMemberState({ variant }: ExpiredMemberStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const admins = useAdminNames(company?.adminIds);
  const date = useLockoutDate(
    company
      ? {
          subscriptionPlan: company.subscriptionPlan,
          trialEndDate: company.trialEndDate,
          subscriptionEnd: company.subscriptionEnd,
        }
      : null
  );
  const isoDate = date ? date.toISOString().slice(0, 10) : null;

  const fingerprint = isoDate
    ? interpolate(t("lockout.expiredMember.fingerprintWithDate"), { date: isoDate })
    : t("lockout.expiredMember.fingerprint");

  const userName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
      "A team member"
    : "A team member";

  const noAdmins = (company?.adminIds?.length ?? 0) === 0;

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "rose", label: t("lockout.expiredMember.tag") }}
      heading={t("lockout.expiredMember.heading")}
      body={t("lockout.expiredMember.body")}
      sectionLabel={t("lockout.expiredMember.sectionLabel")}
      fingerprint={fingerprint}
    >
      {noAdmins ? (
        <>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute mb-3">
            <span className="text-text-mute">SYS :: </span>
            {t("lockout.shared.noAdmins").toUpperCase()}
          </p>
          <a href="mailto:support@opsapp.co">
            <Button variant="primary" size="sm" className="w-full">
              {t("lockout.shared.noAdminsCta")}
            </Button>
          </a>
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            {t("lockout.shared.noAdminsBody")}
          </p>
        </>
      ) : (
        <>
          <AdminTag admins={admins} />
          <RequestButton
            reason="subscription_expired"
            userId={currentUser?.id ?? ""}
            companyId={company?.id ?? ""}
            userName={userName}
            adminIds={company?.adminIds ?? []}
            ctaKey="lockout.expiredMember.cta"
          />
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            {t("lockout.expiredMember.explainer")}
          </p>
        </>
      )}
    </LockoutShell>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/states/expired-member.tsx
git commit -m "feat(lockout): add ExpiredMemberState

Member-side expired path: admin tag + request reactivation button +
explainer. No-admins edge falls back to a Contact Support primary CTA
with a SYS :: NO ADMINS REGISTERED label.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16 — `UnseatedAdminState` module

**Files:**
- Create: `src/components/lockout/states/unseated-admin.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/states/unseated-admin.tsx`:

```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { LockoutShell } from "../lockout-shell";

export interface UnseatedAdminStateProps {
  variant: "page" | "overlay";
}

export function UnseatedAdminState({ variant }: UnseatedAdminStateProps) {
  const { t } = useDictionary("auth");
  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "tan", label: t("lockout.unseatedAdmin.tag") }}
      heading={t("lockout.unseatedAdmin.heading")}
      body={t("lockout.unseatedAdmin.body")}
      sectionLabel={t("lockout.unseatedAdmin.sectionLabel")}
      fingerprint={t("lockout.unseatedAdmin.fingerprint")}
      showSwitchAccount={false}
    >
      {/* Hard navigation — clicking should unmount the lockout overlay
          and let the (dashboard)/team page take over (where the overlay
          is exempted for admins). */}
      <a href="/team" className="block">
        <Button variant="primary" size="sm" className="w-full">
          {t("lockout.unseatedAdmin.cta")}
        </Button>
      </a>
      <p className="font-mohave text-[13px] text-text-3 mt-3">
        {t("lockout.unseatedAdmin.explainer")}
      </p>
    </LockoutShell>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/states/unseated-admin.tsx
git commit -m "feat(lockout): add UnseatedAdminState

Self-service path for admins missing a seat: single 'Manage team' CTA
linking to /team (where the overlay is exempted for admins so they
can self-assign).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17 — `UnseatedMemberState` module

**Files:**
- Create: `src/components/lockout/states/unseated-member.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/lockout/states/unseated-member.tsx`:

```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { LockoutShell } from "../lockout-shell";
import { AdminTag } from "../admin-tag";
import { RequestButton } from "../request-button";
import { useAdminNames } from "../hooks/use-admin-names";

export interface UnseatedMemberStateProps {
  variant: "page" | "overlay";
}

export function UnseatedMemberState({ variant }: UnseatedMemberStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const admins = useAdminNames(company?.adminIds);

  const userName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
      "A team member"
    : "A team member";

  const noAdmins = (company?.adminIds?.length ?? 0) === 0;

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "tan", label: t("lockout.unseatedMember.tag") }}
      heading={t("lockout.unseatedMember.heading")}
      body={t("lockout.unseatedMember.body")}
      sectionLabel={t("lockout.unseatedMember.sectionLabel")}
      fingerprint={t("lockout.unseatedMember.fingerprint")}
    >
      {noAdmins ? (
        <>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute mb-3">
            <span className="text-text-mute">SYS :: </span>
            {t("lockout.shared.noAdmins").toUpperCase()}
          </p>
          <a href="mailto:support@opsapp.co">
            <Button variant="primary" size="sm" className="w-full">
              {t("lockout.shared.noAdminsCta")}
            </Button>
          </a>
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            {t("lockout.shared.noAdminsBody")}
          </p>
        </>
      ) : (
        <>
          <AdminTag admins={admins} />
          <RequestButton
            reason="unseated"
            userId={currentUser?.id ?? ""}
            companyId={company?.id ?? ""}
            userName={userName}
            adminIds={company?.adminIds ?? []}
            ctaKey="lockout.unseatedMember.cta"
          />
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            {t("lockout.unseatedMember.explainer")}
          </p>
        </>
      )}
    </LockoutShell>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/states/unseated-member.tsx
git commit -m "feat(lockout): add UnseatedMemberState

Member needing a seat: admin tag + request access button + explainer.
No-admins edge falls back to Contact Support like the expired-member
state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18 — `LockoutResolver`

**Files:**
- Create: `src/components/lockout/lockout-resolver.tsx`

- [ ] **Step 1: Create the resolver**

Create `src/components/lockout/lockout-resolver.tsx`:

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogoLoader } from "@/components/brand";
import { useAuthStore, selectIsAdminOrOwner } from "@/lib/store/auth-store";
import { getLockoutReason } from "@/lib/subscription";
import { useRealtimeCompany } from "./hooks/use-realtime-company";
import { ExpiredAdminState } from "./states/expired-admin";
import { ExpiredMemberState } from "./states/expired-member";
import { UnseatedAdminState } from "./states/unseated-admin";
import { UnseatedMemberState } from "./states/unseated-member";

const LOCKOUT_EXEMPT_ROUTES = ["/settings"];

export interface LockoutResolverProps {
  variant: "page" | "overlay";
}

export function LockoutResolver({ variant }: LockoutResolverProps) {
  const router = useRouter();
  const pathname = usePathname();
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = useAuthStore(selectIsAdminOrOwner);

  useRealtimeCompany(company?.id);

  const userId = currentUser?.id ?? null;

  const rawReason = useMemo(
    () => getLockoutReason(company ?? null, userId),
    [company, userId]
  );

  // Route-based exemptions (overlay only — page is /locked itself).
  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isOnTeamPage = pathname === "/team" || pathname.startsWith("/team/");
  const reason = useMemo(() => {
    if (variant === "page") return rawReason;
    if (!rawReason) return null;
    if (isExemptRoute && isAdmin && rawReason === "subscription_expired") return null;
    if (isOnTeamPage && isAdmin && rawReason === "unseated") return null;
    return rawReason;
  }, [variant, rawReason, isExemptRoute, isOnTeamPage, isAdmin]);

  // Page-only: if user has full access, send them to the dashboard.
  useEffect(() => {
    if (variant !== "page") return;
    if (!company || !currentUser) return; // still loading
    if (reason === null) router.replace("/dashboard");
  }, [variant, company, currentUser, reason, router]);

  // Loading state on the page (overlay just doesn't render).
  if (variant === "page" && (!company || !currentUser)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LogoLoader size={120} />
      </div>
    );
  }

  if (!reason) return null;

  if (reason === "subscription_expired" && isAdmin) return <ExpiredAdminState variant={variant} />;
  if (reason === "subscription_expired") return <ExpiredMemberState variant={variant} />;
  if (reason === "unseated" && isAdmin) return <UnseatedAdminState variant={variant} />;
  return <UnseatedMemberState variant={variant} />;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/lockout/lockout-resolver.tsx
git commit -m "feat(lockout): add LockoutResolver

Picks one of four state modules from getLockoutReason() x admin role.
Page variant redirects to /dashboard when user has full access.
Overlay variant preserves /settings + /team route exemptions for admins.
Realtime company subscription via the shared hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19 — Strip `/locked` layout decoration

**Files:**
- Modify: `src/app/(auth)/locked/layout.tsx`

- [ ] **Step 1: Replace file contents**

Overwrite `src/app/(auth)/locked/layout.tsx` with:

```tsx
"use client";

/**
 * Layout override for the /locked route.
 *
 * Authenticated users with an inactive subscription land here. The
 * layout is intentionally bare — pure black canvas — so the centered
 * LockoutShell + brand lockup carry the surface alone, per
 * docs/superpowers/specs/2026-05-07-lockout-redesign-design.md.
 *
 * No ambient glow orbs, no grid backdrop — those were spec violations
 * (dropped 2026-05-07).
 */
import { OpsLockup } from "@/components/brand";

export default function LockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <OpsLockup
        orientation="vertical"
        className="h-16 w-auto mb-8"
        title=""
      />
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/(auth)/locked/layout.tsx
git commit -m "refactor(lockout): strip decorative atmosphere from /locked layout

Removes the amber + error blur orbs and the 24px grid backdrop. These
violated the design system rule against decorative gradients on dark
canvas. New layout is pure black + brand lockup + centered child.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20 — Replace `/locked` page body

**Files:**
- Modify: `src/app/(auth)/locked/page.tsx`

- [ ] **Step 1: Replace file contents**

Overwrite `src/app/(auth)/locked/page.tsx` with:

```tsx
"use client";

import { LockoutResolver } from "@/components/lockout/lockout-resolver";

export default function LockedPage() {
  return <LockoutResolver variant="page" />;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Verify dev server boots and route renders**

```bash
pnpm dev
```

In another terminal: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/locked` — expect `200` (or whatever auth gate returns; 200 if unauthenticated popup or authenticated lockout, 307 if redirected).

Stop the server (`Ctrl-C`).

- [ ] **Step 4: Commit**

```bash
git add src/app/(auth)/locked/page.tsx
git commit -m "refactor(lockout): /locked page becomes a thin LockoutResolver wrapper

Replaces the inline 250+ LOC pricing-card page with a single
<LockoutResolver variant=\"page\" />. The resolver picks the matching
state module so unseated members landing on /locked directly no longer
see a useless pricing pitch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21 — Replace overlay state branches

**Files:**
- Modify: `src/components/ops/lockout-overlay.tsx`

- [ ] **Step 1: Replace file contents**

Overwrite `src/components/ops/lockout-overlay.tsx` with:

```tsx
"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuthStore, selectIsAdminOrOwner } from "@/lib/store/auth-store";
import { getLockoutReason } from "@/lib/subscription";
import { LockoutResolver } from "@/components/lockout/lockout-resolver";
import { useRealtimeCompany } from "@/components/lockout/hooks/use-realtime-company";
import {
  lockoutBackdropVariants,
  lockoutBackdropVariantsReduced,
  lockoutCardVariants,
  lockoutCardVariantsReduced,
} from "@/lib/utils/motion";

const LOCKOUT_EXEMPT_ROUTES = ["/settings"];

export function LockoutOverlay() {
  const pathname = usePathname();
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = useAuthStore(selectIsAdminOrOwner);
  const prefersReducedMotion = useReducedMotion();

  useRealtimeCompany(company?.id);

  const rawReason = useMemo(
    () => getLockoutReason(company ?? null, currentUser?.id ?? null),
    [company, currentUser]
  );

  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isOnTeamPage = pathname === "/team" || pathname.startsWith("/team/");
  const reason = useMemo(() => {
    if (!rawReason) return null;
    if (isExemptRoute && isAdmin && rawReason === "subscription_expired") return null;
    if (isOnTeamPage && isAdmin && rawReason === "unseated") return null;
    return rawReason;
  }, [rawReason, isExemptRoute, isOnTeamPage, isAdmin]);

  const backdropVariants = prefersReducedMotion
    ? lockoutBackdropVariantsReduced
    : lockoutBackdropVariants;
  const cardVariants = prefersReducedMotion
    ? lockoutCardVariantsReduced
    : lockoutCardVariants;

  return (
    <AnimatePresence>
      {reason && (
        <motion.div
          key="lockout-backdrop"
          className="fixed inset-0 z-emergency flex items-center justify-center bg-black/60 backdrop-blur-xl backdrop-saturate-150"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="lockout-heading"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div
            key="lockout-card"
            className="mx-4 max-h-[90vh] overflow-y-auto"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <LockoutResolver variant="overlay" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Verify lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ops/lockout-overlay.tsx
git commit -m "refactor(lockout): overlay delegates content to LockoutResolver

The overlay keeps backdrop, AnimatePresence, route-exemption logic, and
realtime company hook — the four inline state branches (~400 LOC) move
behind <LockoutResolver variant=\"overlay\" />. z-index switches from
z-[9000] arbitrary value to the .z-emergency utility class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22 — Update OPS Software Bible

**Files:**
- Modify: `ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md`
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`

- [ ] **Step 1: Update `12_SUBSCRIPTION_MANAGEMENT.md § Readers — Gating, Lockout, Display`**

Find the section (search for `## Readers — Gating, Lockout, Display`) and replace the paragraph that begins with **Realtime gate** with:

```md
**Realtime gate**: `components/ops/lockout-overlay.tsx` keeps the backdrop, `AnimatePresence`, and `pathname`-based route exemptions, then delegates content to `components/lockout/lockout-resolver.tsx`. The resolver:

1. Reads `company` + `currentUser` from `useAuthStore`.
2. Computes `getLockoutReason(company, userId)` (this file unchanged).
3. Picks one of four state modules under `components/lockout/states/`:
   - `expired-admin.tsx` — pricing row + reactivation CTAs
   - `expired-member.tsx` — admin tag + request reactivation (24h cooldown via `useRequestCooldown`)
   - `unseated-admin.tsx` — `/team` self-service link
   - `unseated-member.tsx` — admin tag + request access
4. Wraps the chosen module in `LockoutShell` (top rail / heading / body / divider / state slot / footer + fingerprint).

The same resolver also drives the `/locked` standalone page — page mode redirects to `/dashboard` when `getLockoutReason` returns `null` (fixes a prior bug where the page rendered admin-expired pricing regardless of state). Realtime company-row subscription lives in `components/lockout/hooks/use-realtime-company.ts`.

Design rationale and visual contract: `OPS-Web/docs/superpowers/specs/2026-05-07-lockout-redesign-design.md`.
```

- [ ] **Step 2: Update `07_SPECIALIZED_FEATURES.md § 14`**

Find the notification system section and append (under existing web-notification subsection or before the next `##` heading) the following paragraph:

```md
**Lockout-driven request flow:** when a member triggers a "Request reactivation" or "Request access" CTA on the lockout surface, `components/lockout/request-button.tsx` inserts one row per admin into `notifications` with `type='role_needed'`, `persistent=true`, and `action_url='/settings?tab=subscription'` (reactivation) or `'/team'` (seat). The 24h cooldown lives in `localStorage` under `ops-lockout-request-${userId}` (preserved across the redesign). Schema unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add ops-software-bible/12_SUBSCRIPTION_MANAGEMENT.md ops-software-bible/07_SPECIALIZED_FEATURES.md
git commit -m "docs(bible): document lockout redesign architecture

Updates §12 Readers to describe LockoutResolver + state modules.
Adds §14 paragraph on the shared RequestButton notification flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23 — Manual QA pass

This task has no commits — it's verification before the cleanup task.

- [ ] **Step 1: Boot dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Verify subscription_expired × admin overlay**

In Supabase / dev DB, set the test admin company's `subscription_status='expired'`. Visit `/dashboard`. Confirm:
- Overlay renders with `glass-dense`, 5px radius
- Top rail shows `[rose] SUB EXPIRED` (with date if `subscription_end` set)
- Heading `ACCESS HALTED` in Cake Mono Light 30px
- Three pricing cards, no ribbon, no checkmarks, no amber
- Only the Team card has filled-steel CTA (`variant="primary"`); others have default outline
- `// RECOMMENDED` label above Team card only
- Guarantee text below cards
- Footer shows contact link + fingerprint `SYS :: SUB-EXP · YYYY-MM-DD`
- Visit `/settings` → overlay disappears (admin exempt)

- [ ] **Step 3: Verify subscription_expired × member overlay**

Sign in as a non-admin user under the same expired company. Confirm:
- Heading `ACCESS HALTED`, body "Your team's subscription expired. Only an admin can reactivate."
- `// ADMIN :: NAME (+N OTHERS)` line shows
- Single full-width steel "REQUEST REACTIVATION" CTA
- Click it → swaps to olive-tinted "✓ REQUEST SENT · HH:MM TZ" row
- Reload → still in sent state (24h cooldown)
- localStorage key is `ops-lockout-request-${userId}`

- [ ] **Step 4: Verify unseated × admin**

Remove the test admin from `admin_ids` (test against an owner with admin removed). Visit `/dashboard`. Confirm:
- Tag is `[tan] NO SEAT ASSIGNED`
- Heading `SEAT NOT CLAIMED`
- Single CTA "MANAGE TEAM" → clicking navigates to `/team` and overlay disappears (admin exempt on /team)

- [ ] **Step 5: Verify unseated × member**

As a non-admin removed from `seated_employee_ids`. Confirm:
- Same tag/heading
- Section label `// REQUEST ACCESS`
- Admin tag + REQUEST ACCESS CTA + sent flow

- [ ] **Step 6: Verify `/locked` page**

While in subscription_expired × admin state, visit `/locked` directly. Confirm:
- Pure black canvas (no glow orbs)
- Brand lockup centered above the card
- `glass-surface` card 720px max-width with all the same internal slots
- Same admin-expired state module renders

- [ ] **Step 7: Reactivate while overlay open**

In tab A, set `subscription_status='active'` in DB. In tab B (with the overlay open), confirm overlay unmounts within 1–2 seconds (Realtime).

- [ ] **Step 8: Reduced-motion check**

Toggle OS-level reduced motion (System Preferences on macOS). Reload. Confirm entrance animations collapse to opacity-only fades — no slide-up, no stagger.

- [ ] **Step 9: No `{{date}}` literal in DOM**

In the browser DevTools, search the lockout markup for `{{`. Expected: zero matches. (If any literal `{{date}}` shows up, the interpolate helper isn't being called for that key — fix before proceeding.)

- [ ] **Step 10: No-admins edge**

Temporarily clear `admin_ids` for a test company while a non-admin member is in the expired state. Confirm:
- Admin tag hidden
- `SYS :: NO ADMINS REGISTERED` label visible
- "Contact support" steel CTA links to `mailto:support@opsapp.co`

- [ ] **Step 11: Stop dev server**

```bash
# Ctrl-C in the terminal running pnpm dev
```

If any step above fails, fix the issue, recommit, and repeat — do not proceed to Task 24 until manual QA is clean.

---

## Task 24 — Delete legacy dictionary keys

**Files:**
- Modify: `src/i18n/dictionaries/en/auth.json`
- Modify: `src/i18n/dictionaries/es/auth.json`

- [ ] **Step 1: Verify no remaining consumers reference legacy keys**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
grep -rn 't("locked\.\|t("lockout\.expiredAdmin\.title\|t("lockout\.expiredAdmin\.body\|t("lockout\.expiredAdmin\.selectPlan\|t("lockout\.expiredAdmin\.sysMessage\|t("lockout\.expiredMember\.title\|t("lockout\.expiredMember\.body\|t("lockout\.expiredMember\.requestReactivation\|t("lockout\.expiredMember\.requestSent\|t("lockout\.expiredMember\.sysMessage\|t("lockout\.unseated\.\|t("lockout\.unseatedAdmin\.title\|t("lockout\.unseatedAdmin\.body\|t("lockout\.unseatedAdmin\.manageTeam\|t("lockout\.unseatedAdmin\.sysMessage\|t("lockout\.adminLabel\|t("lockout\.adminOthers\|t("lockout\.contactSupport\|t("lockout\.differentAccount\|t("lockout\.guarantee' src
```

Expected: zero matches. If any match, **stop** — investigate. The new components must not reference legacy keys; if grep finds something it means a state module is using a stale name. Fix that consumer first.

- [ ] **Step 2: Delete the keys from EN dictionary**

Open `src/i18n/dictionaries/en/auth.json` and remove the lines for these keys (they were the old surface):

```
locked.title
locked.description
locked.selectPlan
locked.seatsIncluded
locked.mostPopular
locked.subscribe
locked.starter
locked.team
locked.business
locked.guarantee
locked.contactSupport
locked.differentAccount
locked.sysMessage
locked.subscribeFailed.title
locked.subscribeFailed.generic
locked.subscribeFailed.noCompany
lockout.expiredAdmin.title
lockout.expiredAdmin.body
lockout.expiredAdmin.selectPlan
lockout.expiredAdmin.sysMessage
lockout.expiredMember.title
lockout.expiredMember.body
lockout.expiredMember.requestReactivation
lockout.expiredMember.requestSent
lockout.expiredMember.sysMessage
lockout.unseated.title
lockout.unseated.body
lockout.unseated.requestAccess
lockout.unseated.requestSent
lockout.unseated.sysMessage
lockout.unseatedAdmin.title
lockout.unseatedAdmin.body
lockout.unseatedAdmin.manageTeam
lockout.unseatedAdmin.sysMessage
lockout.adminLabel
lockout.adminOthers
lockout.contactSupport
lockout.differentAccount
lockout.guarantee
```

Watch for trailing commas — make sure the JSON is still valid after removal.

- [ ] **Step 3: Delete the same keys from ES dictionary**

Open `src/i18n/dictionaries/es/auth.json` and remove the same set of keys.

- [ ] **Step 4: Validate JSON syntax**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/dictionaries/en/auth.json', 'utf8'))" && \
  node -e "JSON.parse(require('fs').readFileSync('src/i18n/dictionaries/es/auth.json', 'utf8'))"
```

Expected: no output.

- [ ] **Step 5: Run typecheck + lint + tests**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/components/lockout src/lib/i18n
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/dictionaries/en/auth.json src/i18n/dictionaries/es/auth.json
git commit -m "chore(i18n): remove legacy locked.* and lockout.* dictionary keys

Removes the keys consumed by the previous /locked page and the inline
LockoutOverlay state branches. Verified zero remaining consumers via
grep before deletion. New consolidated namespace lives under
lockout.{shared,expiredAdmin,expiredMember,unseatedAdmin,unseatedMember,pricing}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25 — Final verification

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 2: Full lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Full unit-test suite for the lockout module**

```bash
pnpm vitest run src/components/lockout src/lib/i18n
```

Expected: all PASS.

- [ ] **Step 4: Full app build**

```bash
pnpm build
```

Expected: clean. Watch for any unused-export warnings on legacy code paths — those would indicate a stale import not yet cleaned up.

- [ ] **Step 5: Confirm no DOM regression on the dictionary deletion**

```bash
pnpm dev
```

Visit each surface one more time (admin-expired overlay, member-expired overlay, unseated admin overlay, unseated member overlay, /locked page). Confirm no string in the rendered output reads as a raw dictionary key (e.g., no `lockout.expiredAdmin.heading` literal). If any leak: a key was deleted but a consumer still references it — restore that key or fix the consumer.

Stop the dev server.

- [ ] **Step 6: Final commit (if any cleanups happened in step 5)**

If steps 1-5 surfaced issues you fixed, commit them as `fix(lockout): post-cleanup adjustments`. Otherwise no commit needed.

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| § Architecture / file map | Tasks 4–18 |
| § Container wiring | Tasks 19, 20, 21 |
| § Loading + null-state contract | Task 18 (resolver) |
| § Visual layout — shell anatomy | Task 13 |
| § Visual layout — Tailwind compositions | Tasks 8, 9, 11, 13 |
| § Visual layout — pricing row responsive | Task 12 |
| § Motion — new variants | Task 2 |
| § Motion — reduced-motion | Task 13 |
| § Per-state State 1 (admin expired) | Task 14 |
| § Per-state State 2 (member expired) | Task 15 |
| § Per-state State 3 (unseated admin) | Task 16 |
| § Per-state State 4 (unseated member) | Task 17 |
| § Pricing row — TIER_CONFIG values | Task 11 |
| § Sent state | Task 9 |
| § No-admins edge | Tasks 15, 17 |
| § Copy spec — dictionary structure | Tasks 3, 24 |
| § Date interpolation logic | Tasks 1, 5, 14, 15 |
| § Notification insertion contract | Task 10 |
| § Cooldown contract | Task 4 |
| § Bible updates | Task 22 |
| § Verification plan | Tasks 23, 25 |

If you cannot map a spec line to a task, add a task or extend an existing one — don't ship the implementation with uncovered scope.
