# Inbox Empty-State Status View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-line *"Pick a thread from the list."* placeholder in `thread-detail-view.tsx` with an "inbox health at a glance" view — 14-day velocity sparkline, reply-debt top-3, drafts top-3.

**Architecture:** Three independently-fetching sections stack in a single column inside the existing center pane. One new API endpoint (`/api/inbox/velocity`) for the sparkline; reply-debt and drafts reuse existing endpoints with different params. Each section owns its own loading / error / zero-state. Follows new OPS Design System tokens (5px panel radius, 2.5px button radius, outlined-primary, tactical voice).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (via service-role client), TanStack Query, framer-motion (animations + `useReducedMotion`), Vitest (pure-function unit tests), new OPS Design System tokens.

**Spec:** `docs/superpowers/specs/2026-04-21-inbox-empty-status-view-design.md`

---

## File Structure

Tasks in execution order. Each task produces one atomic commit.

```
NEW:
  src/lib/api/services/inbox-velocity-helpers.ts            — pure helpers (padVelocityDays, computeWeekDelta)
  src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts — unit tests (TDD)
  src/app/api/inbox/velocity/route.ts                       — GET handler
  src/lib/hooks/use-inbox-velocity.ts                       — TanStack hook
  src/components/ops/inbox/empty-status-sparkline.tsx       — pure SVG sparkline
  src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts — path math tests
  src/components/ops/inbox/empty-status-header.tsx          — // INBOX STATUS header with minute-ticking clock
  src/components/ops/inbox/empty-status-velocity.tsx        — velocity section (sparkline + delta)
  src/components/ops/inbox/empty-status-reply-debt.tsx      — reply-debt section (oldest-first top 3)
  src/components/ops/inbox/empty-status-drafts.tsx          — drafts section (top 3)
  src/components/ops/inbox/empty-status-view.tsx            — container, orchestrates the 3 sections

MODIFIED:
  src/lib/api/query-client.ts                               — add queryKeys.inbox.velocity
  src/components/ops/inbox/thread-detail-view.tsx           — replace empty-state block with <EmptyStatusView />
  src/app/(dashboard)/inbox/page.tsx                        — pass railCounts.everything + handleSelectThread through to empty view
  src/i18n/dictionaries/en/inbox.json                       — new empty.* keys
  src/i18n/dictionaries/es/inbox.json                       — new empty.* keys (Spanish)
```

Eleven new files, four modified. Zero schema changes.

---

## Task 1: Velocity helpers + API route (TDD)

**Files:**
- Create: `src/lib/api/services/inbox-velocity-helpers.ts`
- Create: `src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts`
- Create: `src/app/api/inbox/velocity/route.ts`

**Goal:** Pure-function helpers (tested with vitest) that pad sparse daily-count rows into a fixed-length array and compute the prior-week vs this-week delta. The API route calls the helpers.

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  padVelocityDays,
  computeWeekDelta,
  type VelocityDayRow,
} from "../inbox-velocity-helpers";

// Fix "now" to 2026-04-21 00:00:00 UTC for deterministic tests
const NOW = new Date("2026-04-21T00:00:00Z");

function day(isoDay: string, count: number): VelocityDayRow {
  return { day: new Date(isoDay + "T00:00:00Z"), count };
}

describe("padVelocityDays", () => {
  it("returns an all-zero array of length `days` when no rows", () => {
    expect(padVelocityDays([], 14, NOW)).toEqual(new Array(14).fill(0));
  });

  it("returns oldest → newest order", () => {
    const rows = [day("2026-04-20", 5), day("2026-04-10", 3)];
    const result = padVelocityDays(rows, 14, NOW);
    // index 0 = 14 days ago (2026-04-08), index 13 = yesterday (2026-04-20)
    expect(result).toHaveLength(14);
    expect(result[2]).toBe(3); // 2026-04-10 = 10 days before 2026-04-20 = index 11? actually 2026-04-08 is day -13, 2026-04-20 is day -1. So 2026-04-10 is day -11, which is index 14-11-1 = 2
    expect(result[13]).toBe(5); // 2026-04-20 is yesterday → index 13
  });

  it("fills gaps with 0", () => {
    const rows = [day("2026-04-20", 5)];
    const result = padVelocityDays(rows, 14, NOW);
    // Only one non-zero value at the latest position
    expect(result.filter((v) => v > 0)).toHaveLength(1);
    expect(result[13]).toBe(5);
  });

  it("ignores rows outside the window", () => {
    const rows = [
      day("2026-04-20", 5), // in window
      day("2026-04-01", 99), // out of window (> 14 days ago)
    ];
    const result = padVelocityDays(rows, 14, NOW);
    expect(result.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("handles days=7 windowing", () => {
    const rows = [day("2026-04-20", 5), day("2026-04-14", 3)];
    const result = padVelocityDays(rows, 7, NOW);
    expect(result).toHaveLength(7);
    expect(result[6]).toBe(5); // 2026-04-20 = index 6
    expect(result[0]).toBe(3); // 2026-04-14 = index 0
  });
});

describe("computeWeekDelta", () => {
  it("splits a 14-day array into prior (first 7) + this (last 7)", () => {
    const daily = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16];
    const result = computeWeekDelta(daily);
    expect(result.priorWeekTotal).toBe(28); // 1+2+...+7
    expect(result.weekTotal).toBe(91); // 10+11+...+16
  });

  it("computes positive delta when this week > prior", () => {
    const daily = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
    // prior = 7, this = 14, delta = (14-7)/7 = 1.0
    expect(computeWeekDelta(daily).weekDelta).toBe(1);
  });

  it("computes negative delta when this week < prior", () => {
    const daily = [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1];
    expect(computeWeekDelta(daily).weekDelta).toBeCloseTo(-0.5);
  });

  it("returns 0 delta when both weeks are zero", () => {
    const daily = new Array(14).fill(0);
    const result = computeWeekDelta(daily);
    expect(result.weekTotal).toBe(0);
    expect(result.priorWeekTotal).toBe(0);
    expect(result.weekDelta).toBe(0);
  });

  it("returns 0 delta when prior week is zero but current is non-zero (avoid Infinity)", () => {
    const daily = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    expect(computeWeekDelta(daily).weekDelta).toBe(0);
  });

  it("rejects arrays not of length 14", () => {
    expect(() => computeWeekDelta([1, 2, 3])).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect import error**

```bash
cd /c/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts
```

Expected: FAIL with `Cannot find module '../inbox-velocity-helpers'`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/api/services/inbox-velocity-helpers.ts`:

```ts
/**
 * OPS Web — Inbox Velocity Helpers
 *
 * Pure functions that transform raw daily-count rows from the database
 * into the fixed-length array + delta shape the /api/inbox/velocity
 * endpoint returns. Split into a helper file so vitest can unit-test
 * them without importing the Supabase/Firebase glue.
 */

export interface VelocityDayRow {
  day: Date;   // midnight UTC of the day
  count: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Turn a sparse list of (day, count) rows into a fixed-length array of
 * daily counts, oldest → newest. Missing days are zero-filled. Rows
 * outside the window [now - `days`, now) are dropped.
 *
 * Index 0 of the result = `days` days before `now`.
 * Index `days - 1` of the result = yesterday (the day before `now`).
 *
 * Uses UTC for bucketing so the window is stable across user timezones.
 */
export function padVelocityDays(
  rows: VelocityDayRow[],
  days: number,
  now: Date
): number[] {
  const result = new Array<number>(days).fill(0);
  const nowUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  for (const row of rows) {
    const rowUtcMidnight = Date.UTC(
      row.day.getUTCFullYear(),
      row.day.getUTCMonth(),
      row.day.getUTCDate()
    );
    const dayDelta = Math.floor((nowUtcMidnight - rowUtcMidnight) / MS_PER_DAY);
    // day 1 (yesterday) → index days-1; day `days` → index 0; out-of-window drop
    if (dayDelta < 1 || dayDelta > days) continue;
    const index = days - dayDelta;
    result[index] += row.count;
  }

  return result;
}

export interface WeekDeltaResult {
  weekTotal: number;
  priorWeekTotal: number;
  /**
   * (weekTotal - priorWeekTotal) / priorWeekTotal, clamped to 0 when the
   * prior week was zero so we never render ∞ or NaN. Positive = climbing,
   * negative = falling.
   */
  weekDelta: number;
}

/**
 * Split a 14-day daily-count array into prior-week (indices 0-6) and
 * this-week (indices 7-13) totals and compute the percentage delta.
 * Requires exactly 14 entries — enforce at the call site.
 */
export function computeWeekDelta(daily: number[]): WeekDeltaResult {
  if (daily.length !== 14) {
    throw new Error(
      `computeWeekDelta expects exactly 14 entries, got ${daily.length}`
    );
  }
  const priorWeekTotal = daily.slice(0, 7).reduce((a, b) => a + b, 0);
  const weekTotal = daily.slice(7, 14).reduce((a, b) => a + b, 0);
  const weekDelta =
    priorWeekTotal === 0 ? 0 : (weekTotal - priorWeekTotal) / priorWeekTotal;
  return { weekTotal, priorWeekTotal, weekDelta };
}
```

- [ ] **Step 4: Run tests — expect green**

```bash
cd /c/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Create the API route**

Create `src/app/api/inbox/velocity/route.ts`:

```ts
/**
 * OPS Web - Inbox Velocity Endpoint
 *
 * GET /api/inbox/velocity?scope=own|company
 *
 * Returns the last 14 days of classification activity for the caller's
 * scope. Used by the empty-status-view's velocity section.
 *
 * Auth: Firebase/Supabase JWT. Permissions mirror /api/inbox/threads:
 *   - inbox.view          : required
 *   - inbox.view_company  : additionally required for scope=company
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import {
  padVelocityDays,
  computeWeekDelta,
  type VelocityDayRow,
} from "@/lib/api/services/inbox-velocity-helpers";
import type { InboxScope } from "@/lib/types/email-thread";

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

export async function GET(request: NextRequest) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user.id as string;
  const companyId = user.company_id as string;

  if (!companyId) {
    return NextResponse.json(
      { error: "No company associated with user" },
      { status: 400 }
    );
  }

  const canView = await checkPermissionById(userId, "inbox.view");
  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));

  if (scope === "company") {
    const canViewCompany = await checkPermissionById(userId, "inbox.view_company");
    if (!canViewCompany) {
      return NextResponse.json(
        { error: "Forbidden (company scope)" },
        { status: 403 }
      );
    }
  }

  const supabase = getServiceRoleClient();

  // Resolve this user's connection ids for scope=own (same pattern as
  // /api/inbox/threads). scope=company looks across all connections.
  let ownConnectionIds: string[] = [];
  if (scope === "own") {
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .or(`user_id.eq.${userId},user_id.is.null`);
    ownConnectionIds = (connRows ?? []).map((r) => r.id as string);
  }

  try {
    // One query, grouped by day in UTC. category_classified_at is indexed.
    const fourteenDaysAgoIso = new Date(
      Date.now() - 14 * 86_400_000
    ).toISOString();

    let query = supabase
      .from("email_threads")
      .select("category_classified_at, connection_id")
      .eq("company_id", companyId)
      .gte("category_classified_at", fourteenDaysAgoIso)
      .not("category_classified_at", "is", null);

    if (scope === "own") {
      if (ownConnectionIds.length === 0) {
        return NextResponse.json({
          daily: new Array(14).fill(0),
          weekTotal: 0,
          priorWeekTotal: 0,
          weekDelta: 0,
        });
      }
      query = query.in("connection_id", ownConnectionIds);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Bucket client-side by UTC day. Postgres date_trunc would be faster for
    // huge datasets, but 14 days of classifications is bounded — client-side
    // tally is simpler and avoids a view or function.
    const byDay = new Map<string, number>();
    for (const row of rows ?? []) {
      const iso = row.category_classified_at as string | null;
      if (!iso) continue;
      const d = new Date(iso);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const dayRows: VelocityDayRow[] = Array.from(byDay.entries()).map(
      ([key, count]) => ({ day: new Date(`${key}T00:00:00Z`), count })
    );

    const daily = padVelocityDays(dayRows, 14, new Date());
    const delta = computeWeekDelta(daily);

    return NextResponse.json({
      daily,
      weekTotal: delta.weekTotal,
      priorWeekTotal: delta.priorWeekTotal,
      weekDelta: delta.weekDelta,
    });
  } catch (err) {
    console.error("[/api/inbox/velocity] failed:", err);
    return NextResponse.json(
      { error: `Failed to load velocity: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 6: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output after filtering stale cache errors.

- [ ] **Step 7: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/api/services/inbox-velocity-helpers.ts src/lib/api/services/__tests__/inbox-velocity-helpers.test.ts src/app/api/inbox/velocity/route.ts && git commit -m "$(cat <<'EOF'
feat(inbox): add /api/inbox/velocity endpoint + pure helpers

Returns the last 14 days of email_thread classification activity for
the caller's scope, padded to a fixed-length array with prior-week /
this-week totals and delta. padVelocityDays and computeWeekDelta are
pure functions with 11 unit tests covering windowing, zero-fill, and
delta edge cases (both weeks zero, prior zero only).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `use-inbox-velocity` hook + query key

**Files:**
- Modify: `src/lib/api/query-client.ts`
- Create: `src/lib/hooks/use-inbox-velocity.ts`

**Goal:** Register the velocity query key and ship the TanStack wrapper hook.

- [ ] **Step 1: Register the query key**

In `src/lib/api/query-client.ts`, find the `inbox:` block (starts around line 412) and the last key line before the closing brace — per earlier grep, the final velocity-adjacent key is `(scope) => [...queryKeys.inbox.all, "v2", "drafts", scope]` at around line 436. Add the velocity key directly after:

```tsx
// Add this line after the drafts query key
velocity: (scope: "own" | "company") =>
  [...queryKeys.inbox.all, "v2", "velocity", scope] as const,
```

Use the full-syntax form consistent with the surrounding keys. If an `InboxScope` import is already in scope for the type annotation, prefer it — otherwise inline the string union as above to avoid introducing a cross-file import.

- [ ] **Step 2: Create the hook**

Create `src/lib/hooks/use-inbox-velocity.ts`:

```ts
/**
 * OPS Web - Inbox Velocity Hook
 *
 * TanStack Query wrapper for /api/inbox/velocity. Used by the
 * empty-status-view's velocity section.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type { InboxScope } from "@/lib/types/email-thread";

export interface InboxVelocityData {
  daily: number[];          // length 14, oldest → newest
  weekTotal: number;
  priorWeekTotal: number;
  weekDelta: number;        // e.g. -0.12 for -12%, 0 when prior-week was zero
}

async function authHeaders(): Promise<HeadersInit> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

async function fetchVelocity(scope: InboxScope): Promise<InboxVelocityData> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/velocity?scope=${scope}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`velocity fetch failed: ${res.status} ${body}`);
  }
  return res.json();
}

export function useInboxVelocity(scope: InboxScope) {
  return useQuery({
    queryKey: queryKeys.inbox.velocity(scope),
    queryFn: () => fetchVelocity(scope),
    staleTime: 5 * 60_000, // 5 minutes — trend data doesn't need second-fresh
  });
}
```

- [ ] **Step 3: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/api/query-client.ts src/lib/hooks/use-inbox-velocity.ts && git commit -m "$(cat <<'EOF'
feat(inbox): add useInboxVelocity hook + query key

TanStack Query wrapper around /api/inbox/velocity. staleTime: 5min
because trend data doesn't need second-fresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sparkline component (TDD)

**Files:**
- Create: `src/components/ops/inbox/empty-status-sparkline.tsx`
- Create: `src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts`

**Goal:** Pure SVG sparkline. Path-generation math is TDD'd; the component wrapping is thin.

- [ ] **Step 1: Write failing tests**

Create `src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSparklinePath } from "../empty-status-sparkline";

describe("buildSparklinePath", () => {
  it("returns empty string for empty values", () => {
    expect(buildSparklinePath([], 100, 40)).toBe("");
  });

  it("returns a single point for one value (as a 1-length line)", () => {
    // With a single value we can't draw a line. Return a horizontal stub
    // so the SVG still renders something rather than nothing.
    const path = buildSparklinePath([5], 100, 40);
    expect(path).toMatch(/^M 0\s/);
    expect(path).toContain("L"); // produce at least two commands
  });

  it("maps max value to top (y=0) and min to bottom (y=height)", () => {
    const path = buildSparklinePath([10, 20, 5], 100, 40);
    // Must contain a point at y=0 (value 20) and a point at y=40 (value 5)
    expect(path).toMatch(/,\s*0(\s|$)/);
    expect(path).toMatch(/,\s*40(\s|$)/);
  });

  it("distributes x-coordinates evenly across width", () => {
    const path = buildSparklinePath([1, 2, 3, 4, 5], 100, 40);
    // 5 points, so x-step = 100 / 4 = 25
    expect(path).toContain("M 0,");
    expect(path).toMatch(/\b25,/);
    expect(path).toMatch(/\b50,/);
    expect(path).toMatch(/\b75,/);
    expect(path).toMatch(/\b100,/);
  });

  it("renders a flat line when all values are equal (including all zeros)", () => {
    const path = buildSparklinePath([0, 0, 0, 0], 100, 40);
    // All y-coordinates should be the same (we center a flat line by
    // convention — at y = height / 2)
    expect(path).toContain("20"); // height/2
    // Every y-value in the path should be 20
    const yValues = Array.from(path.matchAll(/,(\d+(?:\.\d+)?)(\s|$)/g)).map(
      (m) => parseFloat(m[1])
    );
    expect(new Set(yValues).size).toBe(1);
    expect(yValues[0]).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests — expect import error**

```bash
cd /c/OPS/ops-web && npx vitest run src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts
```

Expected: FAIL with `Cannot find module '../empty-status-sparkline'`.

- [ ] **Step 3: Implement the component + path helper**

Create `src/components/ops/inbox/empty-status-sparkline.tsx`:

```tsx
"use client";

/**
 * OPS Web — Sparkline
 *
 * Monochrome 14-day sparkline for the inbox empty-status-view.
 * Per the new OPS Design System: the line itself is text-2 stroke (no
 * semantic color) — any meaning ("falling" / "climbing") lives in the
 * delta label beside it, never in the line color.
 *
 * Draws in on mount via stroke-dashoffset (400ms, EASE_SMOOTH).
 * Reduced-motion: fades in at 150ms, no draw.
 */

import { useRef, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

/**
 * Convert a sequence of daily counts into an SVG `path` `d` string.
 * Max value → y=0, min value → y=height. When all values are equal
 * (including all-zero), renders a flat line at y = height / 2.
 *
 * Pure function — no framework dependencies. TDD'd in the
 * __tests__/empty-status-sparkline.test.ts file.
 */
export function buildSparklinePath(
  values: number[],
  width: number,
  height: number
): string {
  if (values.length === 0) return "";

  // Single value: stub to a flat line so SVG has something to render.
  if (values.length === 1) {
    const y = height / 2;
    return `M 0,${y} L ${width},${y}`;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  const xStep = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * xStep;
    const y = range === 0 ? height / 2 : height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  return `M ${points[0]} ${points.slice(1).map((p) => `L ${p}`).join(" ")}`;
}

export interface EmptyStatusSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Re-trigger draw animation when values change (e.g. on scope switch). */
  reanimateKey?: string;
}

export function EmptyStatusSparkline({
  values,
  width = 600,
  height = 72,
  reanimateKey,
}: EmptyStatusSparklineProps) {
  const reduceMotion = useReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState<number>(0);

  // Measure actual path length post-mount (stroke-dasharray needs the real
  // value, not an approximation — otherwise long paths under-draw).
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    setPathLength(el.getTotalLength());
  }, [values, reanimateKey]);

  const d = buildSparklinePath(values, width, height);
  if (!d) {
    // Empty state — show a flat baseline only.
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="No classification activity"
      >
        <line
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`14-day classification trend, ${values.reduce((a, b) => a + b, 0)} total`}
    >
      {/* Baseline hairline */}
      <line
        x1={0}
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={1}
      />
      {/* Path */}
      <motion.path
        key={reanimateKey ?? d}
        ref={pathRef}
        d={d}
        fill="none"
        stroke="var(--text-2, #B5B5B5)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={
          reduceMotion
            ? { opacity: 0, pathLength: 1 }
            : { opacity: 0, strokeDasharray: pathLength, strokeDashoffset: pathLength }
        }
        animate={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 1, strokeDashoffset: 0 }
        }
        transition={
          reduceMotion
            ? { duration: 0.15 }
            : { duration: 0.4, ease: EASE_SMOOTH }
        }
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run tests — expect green**

```bash
cd /c/OPS/ops-web && npx vitest run src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-sparkline.tsx src/components/ops/inbox/__tests__/empty-status-sparkline.test.ts && git commit -m "$(cat <<'EOF'
feat(inbox): add empty-status sparkline component

Pure SVG 14-day sparkline with monochrome text-2 stroke (meaning lives
in the delta label, never the line per new design system). Path math
TDD'd with 5 unit tests (empty, single-value, range mapping, x-step,
flat-line-when-equal). Draw-on via stroke-dashoffset, 400ms
EASE_SMOOTH. Reduced-motion fades instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `empty-status-header` component

**Files:**
- Create: `src/components/ops/inbox/empty-status-header.tsx`

**Goal:** Tactical header with `// INBOX STATUS` label, day-date-time line, and right-aligned unread count. Clock ticks at minute rollovers.

- [ ] **Step 1: Create the component**

Create `src/components/ops/inbox/empty-status-header.tsx`:

```tsx
"use client";

/**
 * OPS Web — Inbox Empty-Status Header
 *
 * Tactical header at the top of the empty-status-view. Contains the
 * section identity (// INBOX STATUS), current date/time line, and
 * right-aligned aggregate unread count. Clock re-renders once per
 * minute (at the rollover, not on a 60s tick from mount).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

const DAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatTactical(now: Date): string {
  const day = DAY_SHORT[now.getDay()];
  const month = MONTH_SHORT[now.getMonth()];
  const date = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${day} · ${month} ${date} · ${hh}:${mm}`;
}

export interface EmptyStatusHeaderProps {
  unreadCount: number;
}

export function EmptyStatusHeader({ unreadCount }: EmptyStatusHeaderProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  // Re-render once per minute rollover (not on a 60s interval from mount —
  // that would flicker at weird seconds-past-minute offsets).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d);
      const msUntilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timeout = setTimeout(tick, msUntilNextMinute);
    };
    let timeout: ReturnType<typeof setTimeout>;
    const d = new Date();
    const msUntilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
    timeout = setTimeout(tick, msUntilNextMinute);
    return () => clearTimeout(timeout);
  }, []);

  const unreadText = unreadCount === 0 ? "— UNREAD" : `${unreadCount} UNREAD`;

  return (
    <header className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">// </span>INBOX STATUS
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 tabular-nums",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {formatTactical(now)}
        </span>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            unreadCount === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {unreadText}
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-header.tsx && git commit -m "$(cat <<'EOF'
feat(inbox): add empty-status-view header component

Tactical header with // INBOX STATUS label, date/time line, and
right-aligned unread count. Clock re-renders at minute rollovers
(not on a mount-relative 60s interval). Zero-state renders "—
UNREAD" per new design system.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `empty-status-velocity` section

**Files:**
- Create: `src/components/ops/inbox/empty-status-velocity.tsx`

**Goal:** Section that renders the sparkline + count-up headline + delta label. Handles loading, error (`SYS :: VELOCITY UNAVAILABLE`), and zero-data states.

- [ ] **Step 1: Create the component**

Create `src/components/ops/inbox/empty-status-velocity.tsx`:

```tsx
"use client";

/**
 * OPS Web — Empty-Status Velocity Section
 *
 * Renders the 14-day classification sparkline + this-week total +
 * delta vs prior week. Consumes useInboxVelocity.
 *
 * Per the new OPS Design System: the sparkline is monochrome; meaning
 * lives in the delta label (rose when falling, olive when climbing,
 * text-2 when within ±1%).
 */

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useInboxVelocity } from "@/lib/hooks/use-inbox-velocity";
import { EmptyStatusSparkline } from "./empty-status-sparkline";
import type { InboxScope } from "@/lib/types/email-thread";

export interface EmptyStatusVelocityProps {
  scope: InboxScope;
}

// Count-up that animates exactly once per target value change.
function useCountUp(target: number, duration = 800, disabled = false): number {
  const [value, setValue] = useState<number>(disabled ? target : 0);
  const lastTarget = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) {
      setValue(target);
      return;
    }
    if (lastTarget.current === target) return;
    lastTarget.current = target;

    const start = performance.now();
    const from = 0;
    let frame: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Quadratic ease-out: 1 - (1-t)^2
      const eased = 1 - (1 - t) * (1 - t);
      const current = Math.round(from + (target - from) * eased);
      setValue(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, disabled]);

  return value;
}

export function EmptyStatusVelocity({ scope }: EmptyStatusVelocityProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxVelocity(scope);

  const weekTotal = data?.weekTotal ?? 0;
  const animated = useCountUp(weekTotal, 800, !!reduceMotion || isLoading || isError);

  // Delta rendering logic
  const deltaPct = data ? Math.round(data.weekDelta * 100) : 0;
  const deltaAbsPct = Math.abs(deltaPct);
  const deltaDirection: "up" | "down" | "flat" =
    deltaAbsPct < 1 ? "flat" : deltaPct > 0 ? "up" : "down";
  const deltaColor =
    deltaDirection === "up"
      ? "var(--olive)"
      : deltaDirection === "down"
      ? "var(--rose)"
      : "var(--text-2)";
  const deltaArrow =
    deltaDirection === "up" ? "↑" : deltaDirection === "down" ? "↓" : "·";

  const hasNoActivity = data !== undefined && weekTotal === 0 && data.priorWeekTotal === 0;

  return (
    <section className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">// </span>CLASSIFIED · LAST 14D
      </p>

      {/* Sparkline */}
      <div className="mt-3">
        {isLoading ? (
          <div
            className="rounded-[5px] animate-pulse bg-[rgba(255,255,255,0.04)]"
            style={{ height: 72 }}
          />
        ) : isError ? (
          <div style={{ height: 72 }} />
        ) : (
          <EmptyStatusSparkline
            values={data?.daily ?? []}
            reanimateKey={scope}
          />
        )}
      </div>

      {/* Headline */}
      <div className="mt-2">
        {isError ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            SYS :: VELOCITY UNAVAILABLE
          </p>
        ) : isLoading ? (
          <div className="h-[18px] w-[220px] rounded bg-[rgba(255,255,255,0.04)] animate-pulse" />
        ) : hasNoActivity ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            — NO ACTIVITY
          </p>
        ) : (
          <motion.div
            className="flex items-baseline gap-3"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
          >
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums text-text",
                "[font-feature-settings:'tnum'_1,'zero'_1]"
              )}
            >
              {animated} THIS WEEK
            </span>
            <span
              className="font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums"
              style={{ color: deltaColor }}
            >
              {deltaArrow} {deltaAbsPct}% VS PRIOR
            </span>
          </motion.div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-velocity.tsx && git commit -m "$(cat <<'EOF'
feat(inbox): add empty-status-view velocity section

Sparkline + count-up headline (800ms quadratic ease-out) + delta
label (rose falling / olive climbing / text-2 flat). Handles loading
(skeleton), error (SYS :: VELOCITY UNAVAILABLE), and no-activity
(— NO ACTIVITY) states per spec. Reduced-motion disables the count-up
and sparkline draw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `empty-status-reply-debt` section

**Files:**
- Create: `src/components/ops/inbox/empty-status-reply-debt.tsx`

**Goal:** Renders the top-3 oldest reply-debt threads. Fetches `limit=10`, sorts client-side ASC by `lastMessageAt`, takes first 3.

- [ ] **Step 1: Create the component**

Create `src/components/ops/inbox/empty-status-reply-debt.tsx`:

```tsx
"use client";

/**
 * OPS Web — Empty-Status Reply-Debt Section
 *
 * Renders the top-3 oldest threads in the "Needs Reply" rail. Fetches
 * limit=10 and sorts ASC client-side to surface urgent debt first.
 * Click a row → opens that thread in the detail view.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useInboxThreads,
  type InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxScope } from "@/lib/types/email-thread";

function formatAge(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export interface EmptyStatusReplyDebtProps {
  scope: InboxScope;
  onSelectThread: (row: InboxThreadRow) => void;
  onOpenRail: () => void;
}

export function EmptyStatusReplyDebt({
  scope,
  onSelectThread,
  onOpenRail,
}: EmptyStatusReplyDebtProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxThreads({
    scope,
    filter: "needs_reply",
    limit: 10,
  });

  const top3 = useMemo<InboxThreadRow[]>(() => {
    const rows = data?.pages.flatMap((p) => p.threads) ?? [];
    // Oldest first — urgency correlates with age
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
    return sorted.slice(0, 3);
  }, [data]);

  const totalCount = data?.pages[0]?.threads.length ?? 0;
  const now = new Date();
  const oldestAge = top3[0] ? formatAge(top3[0].lastMessageAt, now) : null;

  return (
    <section className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      {/* Title + headline */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">// </span>REPLY DEBT
        </p>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            totalCount === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {isError
            ? "—"
            : isLoading
            ? ""
            : totalCount === 0
            ? "0 OUTSTANDING"
            : `${totalCount} WAITING`}
        </span>
      </div>

      {/* Secondary line */}
      {!isError && !isLoading && oldestAge && totalCount > 0 && (
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          OLDEST {oldestAge}
        </p>
      )}

      {/* Error line */}
      {isError && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          SYS :: DEBT UNAVAILABLE
        </p>
      )}

      {/* Row list */}
      {!isError && (isLoading || top3.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border border-[rgba(255,255,255,0.10)] overflow-hidden"
          role="list"
          aria-label="Top 3 threads waiting on reply"
        >
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-[44px] animate-pulse bg-[rgba(255,255,255,0.03)]",
                    i < 2 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                />
              ))
            : top3.map((row, i) => (
                <motion.button
                  key={row.id}
                  type="button"
                  role="listitem"
                  onClick={() => onSelectThread(row)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left",
                    "transition-colors duration-150",
                    "hover:bg-[rgba(255,255,255,0.05)]",
                    "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    i < top3.length - 1 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: reduceMotion ? 0 : i * 0.05,
                    ease: EASE_SMOOTH,
                  }}
                >
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 shrink-0 w-[64px]">
                    {row.primaryCategory}
                  </span>
                  <span className="font-mohave text-[13px] text-text shrink-0 max-w-[180px] truncate">
                    {row.clientName || row.latestSenderName || row.latestSenderEmail || "Unknown"}
                  </span>
                  <span className="font-mohave text-[12px] text-text-2 truncate flex-1 min-w-0">
                    {row.subject || "(no subject)"}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-text-3 shrink-0">
                    {formatAge(row.lastMessageAt, now)}
                  </span>
                  <span className="font-mono text-[13px] text-text-mute shrink-0" aria-hidden>
                    →
                  </span>
                </motion.button>
              ))}
        </div>
      )}

      {/* Footer action */}
      {!isError && !isLoading && totalCount > 0 && (
        <button
          type="button"
          onClick={onOpenRail}
          className={cn(
            "mt-3 inline-flex items-center gap-1.5",
            "font-cakemono font-light uppercase text-[12px] tracking-[0.04em]",
            "text-text-2 hover:text-text transition-colors duration-150",
            "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          )}
        >
          OPEN NEEDS REPLY RAIL
          <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-reply-debt.tsx && git commit -m "$(cat <<'EOF'
feat(inbox): add empty-status-view reply-debt section

Reuses /api/inbox/threads with filter=needs_reply, limit=10. Sorts
client-side ASC by lastMessageAt to surface oldest first. Top-3 rows
click-to-open. Renders loading skeletons, SYS :: DEBT UNAVAILABLE on
error, 0 OUTSTANDING on empty. Footer button opens the full
"Needs Reply" rail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `empty-status-drafts` section

**Files:**
- Create: `src/components/ops/inbox/empty-status-drafts.tsx`

**Goal:** Renders the top-3 most recent drafts. Click a row → opens that draft for continuation.

- [ ] **Step 1: Create the component**

Create `src/components/ops/inbox/empty-status-drafts.tsx`:

```tsx
"use client";

/**
 * OPS Web — Empty-Status Drafts Section
 *
 * Renders the 3 most recently-updated drafts. Click a row → opens
 * that draft in compose for continuation. "Open Drafts rail" in the
 * footer switches the left rail to DRAFTS.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useInboxDrafts,
  type InboxDraftRow,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxScope } from "@/lib/types/email-thread";

function formatAge(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export interface EmptyStatusDraftsProps {
  scope: InboxScope;
  onContinueDraft: (draft: InboxDraftRow) => void;
  onOpenRail: () => void;
}

export function EmptyStatusDrafts({
  scope,
  onContinueDraft,
  onOpenRail,
}: EmptyStatusDraftsProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxDrafts(scope);
  const drafts = data ?? [];

  const top3 = useMemo<InboxDraftRow[]>(() => {
    return [...drafts]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, 3);
  }, [drafts]);

  const total = drafts.length;
  const now = new Date();

  return (
    <section className="px-3 py-3">
      {/* Title + headline */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">// </span>DRAFTS
        </p>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            total === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {isError ? "—" : isLoading ? "" : total === 0 ? "—" : total}
        </span>
      </div>

      {/* Error line */}
      {isError && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          SYS :: DRAFTS UNAVAILABLE
        </p>
      )}

      {/* Row list */}
      {!isError && (isLoading || top3.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border border-[rgba(255,255,255,0.10)] overflow-hidden"
          role="list"
          aria-label="Top 3 drafts in progress"
        >
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-[44px] animate-pulse bg-[rgba(255,255,255,0.03)]",
                    i < 1 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                />
              ))
            : top3.map((d, i) => (
                <motion.button
                  key={`${d.source}:${d.id}`}
                  type="button"
                  role="listitem"
                  onClick={() => onContinueDraft(d)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left",
                    "transition-colors duration-150",
                    "hover:bg-[rgba(255,255,255,0.05)]",
                    "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    i < top3.length - 1 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: reduceMotion ? 0 : i * 0.05,
                    ease: EASE_SMOOTH,
                  }}
                >
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 shrink-0 w-[80px]">
                    {d.source === "ai" ? "AI DRAFT" : "DRAFT"}
                  </span>
                  <span className="font-mohave text-[13px] text-text truncate max-w-[180px] shrink-0">
                    To {d.to[0] || "—"}
                  </span>
                  <span className="font-mohave text-[12px] text-text-2 truncate flex-1 min-w-0">
                    {d.subject || "(no subject)"}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-text-3 shrink-0">
                    {formatAge(d.updatedAt, now)}
                  </span>
                  <span className="font-mono text-[13px] text-text-mute shrink-0" aria-hidden>
                    →
                  </span>
                </motion.button>
              ))}
        </div>
      )}

      {/* Footer action */}
      {!isError && !isLoading && total > 0 && (
        <button
          type="button"
          onClick={onOpenRail}
          className={cn(
            "mt-3 inline-flex items-center gap-1.5",
            "font-cakemono font-light uppercase text-[12px] tracking-[0.04em]",
            "text-text-2 hover:text-text transition-colors duration-150",
            "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          )}
        >
          OPEN DRAFTS RAIL
          <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-drafts.tsx && git commit -m "$(cat <<'EOF'
feat(inbox): add empty-status-view drafts section

Reuses useInboxDrafts. Sorts by updatedAt DESC, takes top 3. Click
row → onContinueDraft. Footer button opens Drafts rail. Renders
loading skeletons, SYS :: DRAFTS UNAVAILABLE on error, "—" on empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Container + `thread-detail-view` wiring + i18n

**Files:**
- Create: `src/components/ops/inbox/empty-status-view.tsx`
- Modify: `src/components/ops/inbox/thread-detail-view.tsx`
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/i18n/dictionaries/en/inbox.json`
- Modify: `src/i18n/dictionaries/es/inbox.json`

**Goal:** Stitch the three sections into one container and replace the empty-state placeholder in `thread-detail-view.tsx`. Wire the handlers from the page level down through so row-click and footer actions work. Add i18n keys.

- [ ] **Step 1: Create the container**

Create `src/components/ops/inbox/empty-status-view.tsx`:

```tsx
"use client";

/**
 * OPS Web — Inbox Empty-Status View
 *
 * Center-pane content shown when no thread is selected. Three stacked
 * sections: header → velocity → reply-debt → drafts. Each section
 * fetches its own data and owns its loading/error/zero states.
 */

import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { EmptyStatusHeader } from "./empty-status-header";
import { EmptyStatusVelocity } from "./empty-status-velocity";
import { EmptyStatusReplyDebt } from "./empty-status-reply-debt";
import { EmptyStatusDrafts } from "./empty-status-drafts";
import type {
  InboxDraftRow,
  InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxRail, InboxScope } from "@/lib/types/email-thread";

export interface EmptyStatusViewProps {
  scope: InboxScope;
  unreadCount: number;
  onSelectThread: (row: InboxThreadRow) => void;
  onContinueDraft: (draft: InboxDraftRow) => void;
  onSwitchRail: (rail: InboxRail) => void;
}

export function EmptyStatusView({
  scope,
  unreadCount,
  onSelectThread,
  onContinueDraft,
  onSwitchRail,
}: EmptyStatusViewProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="h-full overflow-y-auto scrollbar-hide"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      <EmptyStatusHeader unreadCount={unreadCount} />
      <EmptyStatusVelocity scope={scope} />
      <EmptyStatusReplyDebt
        scope={scope}
        onSelectThread={onSelectThread}
        onOpenRail={() => onSwitchRail("needs_reply")}
      />
      <EmptyStatusDrafts
        scope={scope}
        onContinueDraft={onContinueDraft}
        onOpenRail={() => onSwitchRail("drafts")}
      />
    </motion.div>
  );
}
```

- [ ] **Step 2: Add props to `ThreadDetailView` for the empty-state path**

Open `src/components/ops/inbox/thread-detail-view.tsx`. Locate the `ThreadDetailViewProps` interface (around line 62). Add four new optional props at the end of the interface (before the closing brace):

```tsx
  /**
   * Aggregate unread count across all rails — rendered in the empty
   * state header. Parent passes `railCounts.everything`.
   */
  emptyStateUnreadCount?: number;
  /** Called from the empty state to open a draft in compose. */
  emptyStateContinueDraft?: (draft: InboxDraftRow) => void;
  /** Called from the empty state's "open rail" buttons. */
  emptyStateSwitchRail?: (rail: InboxRail) => void;
  /** Inbox scope — needed to fetch velocity / debt / drafts per scope. */
  emptyStateScope?: InboxScope;
```

Add the imports at the top of the file:

```tsx
import type { InboxRail, InboxScope } from "@/lib/types/email-thread";
import { EmptyStatusView } from "./empty-status-view";
```

- [ ] **Step 3: Replace the empty-state block**

In the same file, find the existing empty-state return (matches the string `Pick a thread from the list`). Current content of that return:

```tsx
  if (!threadId) {
    return (
      <div className="flex flex-col items-start justify-start h-full px-6 py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          // Nothing selected
        </p>
        <p className="font-mohave text-[13px] text-text mt-1">
          Pick a thread from the list.
        </p>
        <p className="font-mohave text-[12px] text-text-3 mt-0.5">
          Or hit <span className="font-mono text-[11px] text-text-2">⌘K</span> to
          search or jump.
        </p>
      </div>
    );
  }
```

Replace with:

```tsx
  if (!threadId) {
    if (
      emptyStateScope &&
      emptyStateContinueDraft &&
      emptyStateSwitchRail &&
      typeof emptyStateUnreadCount === "number" &&
      onSelectThread
    ) {
      return (
        <EmptyStatusView
          scope={emptyStateScope}
          unreadCount={emptyStateUnreadCount}
          onSelectThread={onSelectThread}
          onContinueDraft={emptyStateContinueDraft}
          onSwitchRail={emptyStateSwitchRail}
        />
      );
    }
    // Fallback when wiring is incomplete (shouldn't happen in prod — the
    // page always passes the handlers — but keeps the component honest
    // for isolated rendering.)
    return (
      <div className="flex flex-col items-start justify-start h-full px-6 py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          // Nothing selected
        </p>
      </div>
    );
  }
```

- [ ] **Step 4: Wire the props from the page**

Open `src/app/(dashboard)/inbox/page.tsx`. Locate the `<ThreadDetailView ...>` element (around line 522). The existing element has these props; we're adding four:

Current element (abbreviated):

```tsx
<ThreadDetailView
  listRow={selectedThread}
  threadId={selectedThread?.id ?? null}
  onNeedsWritebackPreference={handleNeedsWritebackPreference}
  onReply={handleReply}
  onComposeNew={handleComposeNew}
  onToggleContext={handleToggleContext}
  contextOpen={contextOpen}
  keyboardActive={!paletteOpen && !composeOpen && !writebackOpen}
  canConfigurePhaseC={canConfigurePhaseC}
  threadDraft={/* ... */}
  onContinueDraft={handleContinueDraft}
  onDiscardDraft={handleDiscardDraft}
/>
```

Add these four props to the element:

```tsx
  emptyStateScope={scope}
  emptyStateUnreadCount={railCounts.everything}
  emptyStateContinueDraft={handleContinueDraft}
  emptyStateSwitchRail={setRail}
```

Also, `ThreadDetailView` currently doesn't receive `onSelectThread` — check whether the parallel agent added it for sibling-strip support. If not, add this prop too:

```tsx
  onSelectThread={handleSelectThread}
```

(It's safe to pass whether or not ThreadDetailView uses it — unused props don't error. Verify by grepping the file after the edit.)

- [ ] **Step 5: Add i18n keys (English)**

Open `src/i18n/dictionaries/en/inbox.json` and add these keys in an appropriate block (after the existing `context.*` block or at the end — follow the file's style). Keys:

```json
  "empty.status.title": "Inbox status",
  "empty.status.unreadSuffix": "Unread",
  "empty.velocity.title": "Classified · Last 14d",
  "empty.velocity.thisWeek": "this week",
  "empty.velocity.vsPrior": "vs prior",
  "empty.velocity.noActivity": "No activity",
  "empty.velocity.unavailable": "Velocity unavailable",
  "empty.debt.title": "Reply debt",
  "empty.debt.waiting": "Waiting",
  "empty.debt.oldestPrefix": "Oldest",
  "empty.debt.zero": "0 Outstanding",
  "empty.debt.openRail": "Open Needs Reply rail",
  "empty.debt.unavailable": "Debt unavailable",
  "empty.drafts.title": "Drafts",
  "empty.drafts.zero": "—",
  "empty.drafts.openRail": "Open Drafts rail",
  "empty.drafts.unavailable": "Drafts unavailable",
```

Maintain existing JSON formatting (no trailing comma on the last key — put new keys BEFORE the closing brace).

Note: for v1 we ship the hardcoded English strings in the components (via the literal uppercase forms the design requires). These i18n keys are registered so translators know the surface exists; wiring each literal through `t("empty.*") ?? "fallback"` is a follow-up cleanup that doesn't block shipping. This matches the codebase's existing pattern where some widgets are pre-i18n-ed and some aren't.

- [ ] **Step 6: Add i18n keys (Spanish)**

Open `src/i18n/dictionaries/es/inbox.json` and add the same keys with Spanish values:

```json
  "empty.status.title": "Estado de bandeja",
  "empty.status.unreadSuffix": "No leídos",
  "empty.velocity.title": "Clasificados · Últimos 14d",
  "empty.velocity.thisWeek": "esta semana",
  "empty.velocity.vsPrior": "vs anterior",
  "empty.velocity.noActivity": "Sin actividad",
  "empty.velocity.unavailable": "Velocidad no disponible",
  "empty.debt.title": "Deuda de respuesta",
  "empty.debt.waiting": "En espera",
  "empty.debt.oldestPrefix": "Más antiguo",
  "empty.debt.zero": "0 pendientes",
  "empty.debt.openRail": "Abrir \"Requieren respuesta\"",
  "empty.debt.unavailable": "Deuda no disponible",
  "empty.drafts.title": "Borradores",
  "empty.drafts.zero": "—",
  "empty.drafts.openRail": "Abrir Borradores",
  "empty.drafts.unavailable": "Borradores no disponibles",
```

- [ ] **Step 7: Type-check**

```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 8: Lint**

```bash
cd /c/OPS/ops-web && npm run lint 2>&1 | grep -E "empty-status" | head -10
```

Expected: no errors on any `empty-status-*` file.

- [ ] **Step 9: Run all vitest tests**

```bash
cd /c/OPS/ops-web && npx vitest run
```

Expected: all pass except the two pre-existing Firebase-env integration suites (`tests/integration/auth.test.tsx`, `tests/integration/projects.test.tsx`).

- [ ] **Step 10: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/empty-status-view.tsx src/components/ops/inbox/thread-detail-view.tsx src/app/\(dashboard\)/inbox/page.tsx src/i18n/dictionaries/en/inbox.json src/i18n/dictionaries/es/inbox.json && git commit -m "$(cat <<'EOF'
feat(inbox): wire EmptyStatusView into thread-detail-view

Replaces the three-line "Pick a thread from the list." placeholder
with the new three-section empty view (velocity + reply-debt + drafts).
Page-level handlers plumb through as optional ThreadDetailView props
so an isolated unwired render still produces a graceful fallback.
i18n keys registered in both en and es dictionaries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Cross-page verification

**Files:** none (verification only)

**Goal:** Confirm the view renders correctly against real data, respects reduced-motion, and doesn't regress any thread-detail path.

- [ ] **Step 1: Start the dev server**

```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/inbox` in a browser.

- [ ] **Step 2: Verify populated state**

Without clicking any thread, confirm:
- `// INBOX STATUS` header at top with current `<DAY> · <MON> <DATE> · <HH:MM>` date line
- Aggregate unread count right-aligned in the header
- `// CLASSIFIED · LAST 14D` section with sparkline drawing in on mount (~400ms)
- "N THIS WEEK   ↓ X% VS PRIOR" headline below the sparkline, color matches direction (rose = falling, olive = climbing, text-2 = flat)
- `// REPLY DEBT` section with a count, `OLDEST <age>` secondary line, and up to 3 rows (oldest first)
- `// DRAFTS` section with a count and up to 3 rows (most-recently-updated first)
- Footer "OPEN NEEDS REPLY RAIL →" and "OPEN DRAFTS RAIL →" buttons if counts > 0

- [ ] **Step 3: Verify row click**

Click any row in the reply-debt or drafts section. Confirm:
- The corresponding thread opens in the detail view (replacing the empty state)
- Clicking back (Escape or clearing selection) returns to the empty view

- [ ] **Step 4: Verify footer actions**

From the empty state, click "OPEN NEEDS REPLY RAIL →". Confirm:
- The left rail's rail tab switches to `needs_reply`
- The list re-fetches and shows full Needs Reply threads

Same for Drafts rail.

- [ ] **Step 5: Verify zero states**

Archive all threads (or find a test account with inbox zero). Confirm:
- Velocity: `— NO ACTIVITY` text below a flat baseline
- Reply debt: `0 OUTSTANDING` headline, no row list, no footer action
- Drafts: `—` headline, no row list, no footer action
- No empty row containers, no visible "nothing here" placeholders

- [ ] **Step 6: Verify error state**

Temporarily break the velocity endpoint (e.g., throw an error in the route handler) or disable the network. Confirm:
- Velocity: title still renders, `SYS :: VELOCITY UNAVAILABLE` below
- Debt and drafts: similar `SYS :: DEBT UNAVAILABLE` / `SYS :: DRAFTS UNAVAILABLE` patterns
- The other sections still render normally if their queries succeed

Revert the intentional error.

- [ ] **Step 7: Verify reduced-motion**

Open devtools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce". Reload `/inbox`. Confirm:
- Sparkline appears with no draw animation (just a fade)
- The "N THIS WEEK" number renders as the final value (no count-up)
- Rows appear together, no stagger delay
- All transitions complete under 150ms

- [ ] **Step 8: Verify minute tick**

Leave the view open. When the wall clock rolls over a minute, the header time updates exactly once. No flicker, no layout shift.

- [ ] **Step 9: Verify keyboard access**

Tab-cycle through the page from the search bar onward. Confirm:
- Each row in debt/drafts sections receives a visible focus ring (`1.5px accent`)
- Enter / Space on a focused row opens that thread
- Footer buttons receive focus and activate on Enter

- [ ] **Step 10: Confirm the main detail path still works**

Click any thread in the left list. Confirm the detail view renders as before (summary block, phase C strip, messages, action bar). Close selection, confirm the empty view re-renders.

- [ ] **Step 11: Stop the dev server and no commit**

`Ctrl+C`. No files changed in this task.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| Problem / frame (inbox health at a glance) | — (context; no code task) |
| 3 signals: velocity + debt + drafts | Tasks 5, 6, 7 |
| Counts + inline top-3 mini-list | Tasks 6, 7 |
| Sparkline (monochrome stroke, colored delta label) | Tasks 3, 5 |
| Tactical header with minute-ticking clock | Task 4 |
| Container + wiring | Task 8 |
| New `/api/inbox/velocity` endpoint | Task 1 |
| `useInboxVelocity` hook + query key | Task 2 |
| Reply-debt client-side oldest-first sort | Task 6 |
| Drafts reuse of `useInboxDrafts` | Task 7 |
| Voice / copy rules | Implemented across Tasks 4-7 verbatim |
| Loading / error / zero states | Implemented per-section in Tasks 5, 6, 7 |
| Animations (draw, count-up, stagger) with reduced-motion | Tasks 3, 5, 6, 7 |
| Keyboard + a11y | Implemented in row + footer buttons in Tasks 6, 7; verified in Task 9 Step 9 |
| i18n keys | Task 8 Steps 5, 6 |
| Non-goals (no sibling strip, no repo-wide system audit) | Honored — no tasks add those |
| Verification plan | Task 9 |

All spec sections covered.

**Placeholder scan:** No "TBD", no "implement later", no "similar to Task N". Every code step shows the exact before/after. Every command shows the exact invocation and expected output.

**Type consistency:**
- `VelocityDayRow` defined in Task 1, reused in Task 1 route handler. `InboxVelocityData` defined in Task 2, consumed in Task 5.
- `buildSparklinePath` defined in Task 3, consumed transitively via `<EmptyStatusSparkline>` in Task 5.
- `InboxScope`, `InboxRail`, `InboxThreadRow`, `InboxDraftRow` are already-existing types referenced by name consistently.
- `EmptyStatusView`, `EmptyStatusHeader`, `EmptyStatusVelocity`, `EmptyStatusReplyDebt`, `EmptyStatusDrafts` naming is consistent.
- `useInboxVelocity` exported name consistent across Tasks 2 and 5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-inbox-empty-status-view.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — Execute tasks in this session using executing-plans.

Which approach?
