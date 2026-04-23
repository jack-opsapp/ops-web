# Duplicate Detection System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily 5am cron job that detects duplicate Clients, Opportunities, Projects, and Tasks across each company, stores results in a `duplicate_reviews` table, notifies admin/owner/office users, and lets them resolve via a sheet UI with smart merge or permanent dismiss.

**Architecture:** Vercel cron → service-role Supabase scan per active-subscription company → algorithmic detection using shared normalization utils (fuzzy name, exact email/phone, normalized address) → results stored in `duplicate_reviews` table → notification sent → sheet UI opened from notification click → smart merge (backfill fields + reassign relationships + soft-delete loser) or permanent dismiss.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), TanStack Query, Zustand, Radix Sheet, Vercel Cron, vitest

**Spec:** `docs/superpowers/specs/2026-03-30-duplicate-detection-system-design.md`

---

## File Inventory

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/047_duplicate_reviews.sql` | Create | Table + indexes |
| `src/lib/utils/name-normalization.ts` | Create | Shared normalization: names, phones, addresses, titles |
| `tests/unit/name-normalization.test.ts` | Create | Unit tests for all normalization functions |
| `src/lib/api/services/duplicate-detection-service.ts` | Create | Core scan, merge, dismiss logic |
| `tests/unit/duplicate-detection.test.ts` | Create | Unit tests for detection + merge logic |
| `src/app/api/cron/duplicate-scan/route.ts` | Create | Cron endpoint |
| `src/app/api/duplicates/route.ts` | Create | GET pending reviews |
| `src/app/api/duplicates/[id]/merge/route.ts` | Create | POST merge action |
| `src/app/api/duplicates/[id]/dismiss/route.ts` | Create | POST dismiss action |
| `src/lib/api/services/notification-service.ts` | Modify | Add `duplicates_found` to NotificationType |
| `src/lib/hooks/use-duplicate-reviews.ts` | Create | TanStack Query hook |
| `src/lib/hooks/index.ts` | Modify | Export new hook |
| `src/lib/api/query-client.ts` | Modify | Add `duplicateReviews` query keys |
| `src/stores/duplicate-review-store.ts` | Create | Zustand store for sheet state |
| `src/components/layouts/notification-mini-card.tsx` | Modify | Open sheet for `duplicates_found` type |
| `src/components/ops/duplicate-pair-card.tsx` | Create | Side-by-side comparison card |
| `src/components/ops/duplicate-review-sheet.tsx` | Create | Full review sheet with entity tabs |
| `src/app/(dashboard)/layout.tsx` | Modify | Mount sheet at layout level |
| `src/i18n/dictionaries/en/duplicates.json` | Create | English strings |
| `src/i18n/dictionaries/es/duplicates.json` | Create | Spanish strings |
| `src/components/settings/wizard-steps/consolidation-utils.ts` | Modify | Import from shared normalization |
| `vercel.json` | Modify | Add cron entry |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/047_duplicate_reviews.sql`

- [ ] **Step 1: Write migration**

```sql
-- 047_duplicate_reviews.sql
-- Stores detected duplicate pairs for user review.
-- entity_a_id < entity_b_id (lexicographic) to prevent storing same pair twice.

create table duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'opportunity', 'project', 'task')),
  entity_a_id uuid not null,
  entity_b_id uuid not null,
  confidence text not null check (confidence in ('high', 'medium')),
  signals jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'merged', 'dismissed')),
  winner_id uuid,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint duplicate_reviews_ordered_pair check (entity_a_id < entity_b_id),
  constraint duplicate_reviews_unique_pair unique (company_id, entity_type, entity_a_id, entity_b_id)
);

-- Pending reviews per company (cron notification check)
create index idx_duplicate_reviews_pending
  on duplicate_reviews (company_id, status) where status = 'pending';

-- Dismissed pairs lookup during scan (skip permanently dismissed)
create index idx_duplicate_reviews_dismissed
  on duplicate_reviews (company_id, entity_type, entity_a_id, entity_b_id, status)
  where status = 'dismissed';

-- RLS: users can only see reviews for their company
alter table duplicate_reviews enable row level security;

create policy "Users can view own company reviews"
  on duplicate_reviews for select
  using (company_id in (
    select company_id from users where id = auth.uid()
  ));

create policy "Users can update own company reviews"
  on duplicate_reviews for update
  using (company_id in (
    select company_id from users where id = auth.uid()
  ));

-- Service role can insert (cron runs as service role)
create policy "Service role can insert"
  on duplicate_reviews for insert
  with check (true);
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/047_duplicate_reviews.sql
git commit -m "feat: add duplicate_reviews table for daily duplicate detection"
```

---

### Task 2: Shared Normalization Utils

**Files:**
- Create: `src/lib/utils/name-normalization.ts`
- Create: `tests/unit/name-normalization.test.ts`
- Modify: `src/components/settings/wizard-steps/consolidation-utils.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/name-normalization.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  normalizePhone,
  normalizeAddress,
  normalizeTitle,
  BUSINESS_SUFFIXES,
} from "@/lib/utils/name-normalization";

describe("normalizeCompanyName", () => {
  it("strips business suffixes", () => {
    expect(normalizeCompanyName("Smith Roofing Inc.")).toBe("smith roofing");
    expect(normalizeCompanyName("WJ Construction Ltd")).toBe("wj");
    expect(normalizeCompanyName("PATH Developments Limited")).toBe("path");
  });

  it("lowercases and strips non-alphanumeric", () => {
    expect(normalizeCompanyName("O'Brien & Sons")).toBe("o brien sons");
  });

  it("collapses whitespace", () => {
    expect(normalizeCompanyName("  Smith   Roofing  ")).toBe("smith roofing");
  });

  it("handles empty and short strings", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("A")).toBe("a");
  });
});

describe("normalizePhone", () => {
  it("strips non-digits and returns last 10", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1-555-123-4567")).toBe("5551234567");
    expect(normalizePhone("555.123.4567")).toBe("5551234567");
  });

  it("handles short numbers", () => {
    expect(normalizePhone("1234567")).toBe("1234567");
  });

  it("handles empty/null-like input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("no phone")).toBe("");
  });
});

describe("normalizeAddress", () => {
  it("lowercases and normalizes whitespace", () => {
    expect(normalizeAddress("123 Main Street")).toBe("123 main street");
  });

  it("strips unit/suite/apt designators", () => {
    expect(normalizeAddress("123 Main St, Suite 200")).toBe("123 main st");
    expect(normalizeAddress("123 Main St Unit 4B")).toBe("123 main st");
    expect(normalizeAddress("123 Main St Apt. 5")).toBe("123 main st");
    expect(normalizeAddress("123 Main St #12")).toBe("123 main st");
  });

  it("normalizes common abbreviations", () => {
    expect(normalizeAddress("123 Main St.")).toBe("123 main st");
    expect(normalizeAddress("123 Main Street")).toBe("123 main street");
  });

  it("handles empty input", () => {
    expect(normalizeAddress("")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("strips email prefixes", () => {
    expect(normalizeTitle("RE: Deck Renovation")).toBe("deck renovation");
    expect(normalizeTitle("Fwd: RE: Roof Repair")).toBe("roof repair");
  });

  it("strips common trade filler words", () => {
    expect(normalizeTitle("New Project - Deck Build")).toBe("deck build");
    expect(normalizeTitle("Job: Kitchen Remodel")).toBe("kitchen remodel");
  });

  it("lowercases and trims", () => {
    expect(normalizeTitle("  Deck Renovation  ")).toBe("deck renovation");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx vitest run tests/unit/name-normalization.test.ts`
Expected: FAIL — module `@/lib/utils/name-normalization` not found.

- [ ] **Step 3: Implement normalization utils**

```typescript
// src/lib/utils/name-normalization.ts

/**
 * Shared normalization utilities for duplicate detection and consolidation.
 * Used by both the import wizard (consolidation-utils.ts) and the
 * daily duplicate detection cron (duplicate-detection-service.ts).
 */

// Strips common business suffixes: Inc, Ltd, LLC, Corp, etc.
export const BUSINESS_SUFFIXES =
  /\b(inc\.?|ltd\.?|llc\.?|corp\.?|co\.?|limited|incorporated|corporation|enterprises?|services?|developments?|construction|contracting|group|solutions|holdings)\b/gi;

/**
 * Normalize a company/client name for fuzzy comparison.
 * Strips business suffixes, lowercases, removes non-alphanumeric, collapses whitespace.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(BUSINESS_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a phone number for exact comparison.
 * Strips all non-digit characters, returns last 10 digits (drops country code).
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Matches unit/suite/apt designators and everything after them
const UNIT_PATTERN =
  /[,\s]+(suite|ste|unit|apt|apartment|#)\s*\.?\s*\w+.*$/i;

/**
 * Normalize an address for comparison.
 * Lowercases, strips unit/suite/apt designators, normalizes whitespace.
 */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(UNIT_PATTERN, "")
    .replace(/\.(?=\s|$)/g, "") // strip trailing periods (St. → St)
    .replace(/\s+/g, " ")
    .trim();
}

// Strips email prefixes and common filler words from titles
const TITLE_PREFIXES = /^(re:\s*|fwd?:\s*|fw:\s*)*/gi;
const TITLE_FILLER =
  /\b(new\s+)?(project|job)\s*[-:]\s*/gi;

/**
 * Normalize a project/opportunity title for comparison.
 * Strips email prefixes (RE:, FW:), common filler ("New Project -"), lowercases.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(TITLE_PREFIXES, "")
    .replace(TITLE_FILLER, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx vitest run tests/unit/name-normalization.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Update consolidation-utils.ts to import from shared module**

In `src/components/settings/wizard-steps/consolidation-utils.ts`, replace the local `BUSINESS_SUFFIXES` constant and `normalizeCompanyName` function with imports:

Replace lines 1-17:
```typescript
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import { normalizeCompanyName } from "@/lib/utils/name-normalization";
import type { AnalyzedLead, ConsolidationGroup } from "@/lib/types/email-import";
```

Remove the local `BUSINESS_SUFFIXES` regex and `normalizeCompanyName` function (lines 8-17 of the original file). The rest of the file remains unchanged — it already calls `normalizeCompanyName()` by the same name.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/name-normalization.ts tests/unit/name-normalization.test.ts src/components/settings/wizard-steps/consolidation-utils.ts
git commit -m "feat: extract shared name-normalization utils with phone, address, title normalizers"
```

---

### Task 3: Duplicate Detection Service — Scanning Logic

**Files:**
- Create: `src/lib/api/services/duplicate-detection-service.ts`

This task builds the core scanning logic. The merge/dismiss methods are added in Task 5.

- [ ] **Step 1: Write the detection service with all four entity scanners**

```typescript
// src/lib/api/services/duplicate-detection-service.ts

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  normalizeCompanyName,
  normalizePhone,
  normalizeAddress,
  normalizeTitle,
} from "@/lib/utils/name-normalization";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DuplicateEntityType = "client" | "opportunity" | "project" | "task";
export type DuplicateConfidence = "high" | "medium";
export type DuplicateStatus = "pending" | "merged" | "dismissed";

export interface DuplicateSignal {
  type: string; // e.g. "same_email", "fuzzy_name", "same_phone"
  detail: string; // human-readable detail
}

export interface DuplicateReview {
  id: string;
  companyId: string;
  entityType: DuplicateEntityType;
  entityAId: string;
  entityBId: string;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
  status: DuplicateStatus;
  winnerId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

interface DetectedPair {
  entityAId: string;
  entityBId: string;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure a < b for the ordered pair constraint */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function mapReviewFromDb(row: Record<string, unknown>): DuplicateReview {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    entityType: row.entity_type as DuplicateEntityType,
    entityAId: row.entity_a_id as string,
    entityBId: row.entity_b_id as string,
    confidence: row.confidence as DuplicateConfidence,
    signals: (row.signals as DuplicateSignal[]) ?? [],
    status: row.status as DuplicateStatus,
    winnerId: (row.winner_id as string) ?? null,
    resolvedBy: (row.resolved_by as string) ?? null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

// ─── Client Scanning ─────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
}

function scanClients(clients: ClientRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];

  // Build indexes
  const emailIndex = new Map<string, ClientRow[]>();
  const phoneIndex = new Map<string, ClientRow[]>();
  const nameIndex = new Map<string, ClientRow[]>();
  const domainIndex = new Map<string, ClientRow[]>();

  for (const c of clients) {
    if (c.email) {
      const lower = c.email.toLowerCase();
      emailIndex.set(lower, [...(emailIndex.get(lower) ?? []), c]);
      const domain = lower.split("@")[1];
      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
        domainIndex.set(domain, [...(domainIndex.get(domain) ?? []), c]);
      }
    }
    if (c.phone_number) {
      const norm = normalizePhone(c.phone_number);
      if (norm.length >= 7) {
        phoneIndex.set(norm, [...(phoneIndex.get(norm) ?? []), c]);
      }
    }
    const normName = normalizeCompanyName(c.name);
    if (normName.length >= 2) {
      nameIndex.set(normName, [...(nameIndex.get(normName) ?? []), c]);
    }
  }

  const seen = new Set<string>();

  function addPair(a: ClientRow, b: ClientRow, confidence: DuplicateConfidence, signals: DuplicateSignal[]) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  // High confidence: same email
  for (const [email, group] of emailIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [{ type: "same_email", detail: email }]);
      }
    }
  }

  // High confidence: same phone
  for (const [phone, group] of phoneIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [
          { type: "same_phone", detail: phone },
        ]);
      }
    }
  }

  // Medium: fuzzy name match (only if not already caught by email/phone)
  for (const [normName, group] of nameIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, idB] = orderedPair(group[i].id, group[j].id);
        if (seen.has(`${idA}:${idB}`)) continue;

        // Fuzzy name alone = medium. Combine with domain or address for high.
        const signals: DuplicateSignal[] = [{ type: "fuzzy_name", detail: normName }];
        let confidence: DuplicateConfidence = "medium";

        // Check if they share a non-public domain
        if (group[i].email && group[j].email) {
          const domainA = group[i].email!.toLowerCase().split("@")[1];
          const domainB = group[j].email!.toLowerCase().split("@")[1];
          if (domainA && domainA === domainB && !PUBLIC_EMAIL_DOMAINS.has(domainA)) {
            signals.push({ type: "same_domain", detail: domainA });
            confidence = "high";
          }
        }

        // Check address match
        if (group[i].address && group[j].address) {
          const addrA = normalizeAddress(group[i].address!);
          const addrB = normalizeAddress(group[j].address!);
          if (addrA.length > 0 && addrA === addrB) {
            signals.push({ type: "same_address", detail: addrA });
            confidence = "high";
          }
        }

        addPair(group[i], group[j], confidence, signals);
      }
    }
  }

  return pairs;
}

// ─── Opportunity Scanning ────────────────────────────────────────────────────

interface OpportunityRow {
  id: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  title: string;
  address: string | null;
}

const ACTIVE_OPP_STAGES = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
];

function scanOpportunities(opps: OpportunityRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  function addPair(a: OpportunityRow, b: OpportunityRow, confidence: DuplicateConfidence, signals: DuplicateSignal[]) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  // Index by email
  const emailIndex = new Map<string, OpportunityRow[]>();
  for (const o of opps) {
    if (o.contact_email) {
      const lower = o.contact_email.toLowerCase();
      emailIndex.set(lower, [...(emailIndex.get(lower) ?? []), o]);
    }
  }

  // High: same contactEmail
  for (const [email, group] of emailIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], "high", [{ type: "same_email", detail: email }]);
      }
    }
  }

  // Medium: fuzzy name + similar title or same address
  const nameIndex = new Map<string, OpportunityRow[]>();
  for (const o of opps) {
    if (o.contact_name) {
      const norm = normalizeCompanyName(o.contact_name);
      if (norm.length >= 2) {
        nameIndex.set(norm, [...(nameIndex.get(norm) ?? []), o]);
      }
    }
  }

  for (const [normName, group] of nameIndex) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [idA, idB] = orderedPair(group[i].id, group[j].id);
        if (seen.has(`${idA}:${idB}`)) continue;

        const signals: DuplicateSignal[] = [{ type: "fuzzy_name", detail: normName }];

        // Check title similarity
        const titleA = normalizeTitle(group[i].title);
        const titleB = normalizeTitle(group[j].title);
        if (titleA.length > 0 && titleA === titleB) {
          signals.push({ type: "same_title", detail: titleA });
        }

        // Check address match
        if (group[i].address && group[j].address) {
          const addrA = normalizeAddress(group[i].address!);
          const addrB = normalizeAddress(group[j].address!);
          if (addrA.length > 0 && addrA === addrB) {
            signals.push({ type: "same_address", detail: addrA });
          }
        }

        // Need at least 2 signals for medium confidence
        if (signals.length >= 2) {
          addPair(group[i], group[j], "medium", signals);
        }
      }
    }
  }

  return pairs;
}

// ─── Project Scanning ────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  title: string;
  client_id: string | null;
  address: string | null;
}

const ACTIVE_PROJECT_STATUSES = ["rfq", "estimated", "accepted", "in_progress"];

function scanProjects(projects: ProjectRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  function addPair(a: ProjectRow, b: ProjectRow, confidence: DuplicateConfidence, signals: DuplicateSignal[]) {
    const [idA, idB] = orderedPair(a.id, b.id);
    const key = `${idA}:${idB}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ entityAId: idA, entityBId: idB, confidence, signals });
  }

  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      const signals: DuplicateSignal[] = [];

      const sameClient = a.client_id && b.client_id && a.client_id === b.client_id;
      const titleA = normalizeTitle(a.title);
      const titleB = normalizeTitle(b.title);
      const sameTitle = titleA.length > 0 && titleA === titleB;

      let addrA = "";
      let addrB = "";
      let sameAddress = false;
      if (a.address && b.address) {
        addrA = normalizeAddress(a.address);
        addrB = normalizeAddress(b.address);
        sameAddress = addrA.length > 0 && addrA === addrB;
      }

      // High: same client + fuzzy title
      if (sameClient && sameTitle) {
        signals.push({ type: "same_client", detail: a.client_id! });
        signals.push({ type: "same_title", detail: titleA });
        addPair(a, b, "high", signals);
        continue;
      }

      // High: same client + same address
      if (sameClient && sameAddress) {
        signals.push({ type: "same_client", detail: a.client_id! });
        signals.push({ type: "same_address", detail: addrA });
        addPair(a, b, "high", signals);
        continue;
      }

      // Medium: same address + fuzzy title (no client match)
      if (sameAddress && sameTitle) {
        signals.push({ type: "same_address", detail: addrA });
        signals.push({ type: "same_title", detail: titleA });
        addPair(a, b, "medium", signals);
      }
    }
  }

  return pairs;
}

// ─── Task Scanning ───────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  project_id: string;
  task_type_id: string;
  custom_title: string | null;
  start_date: string | null;
  end_date: string | null;
}

function datesOverlap(
  startA: string | null,
  endA: string | null,
  startB: string | null,
  endB: string | null
): boolean {
  if (!startA || !startB) return false;
  const sA = new Date(startA).getTime();
  const eA = endA ? new Date(endA).getTime() : sA;
  const sB = new Date(startB).getTime();
  const eB = endB ? new Date(endB).getTime() : sB;
  return sA <= eB && sB <= eA;
}

function scanTasks(tasks: TaskRow[]): DetectedPair[] {
  const pairs: DetectedPair[] = [];
  const seen = new Set<string>();

  // Group by project first — only compare within same project
  const byProject = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    byProject.set(t.project_id, [...(byProject.get(t.project_id) ?? []), t]);
  }

  for (const [, projectTasks] of byProject) {
    for (let i = 0; i < projectTasks.length; i++) {
      for (let j = i + 1; j < projectTasks.length; j++) {
        const a = projectTasks[i];
        const b = projectTasks[j];
        const signals: DuplicateSignal[] = [];

        const overlap = datesOverlap(a.start_date, a.end_date, b.start_date, b.end_date);
        if (!overlap) continue;

        // Same taskType + overlapping dates
        if (a.task_type_id === b.task_type_id) {
          signals.push({ type: "same_task_type", detail: a.task_type_id });
          signals.push({ type: "overlapping_dates", detail: `${a.start_date} - ${a.end_date}` });
          const [idA, idB] = orderedPair(a.id, b.id);
          const key = `${idA}:${idB}`;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push({ entityAId: idA, entityBId: idB, confidence: "high", signals });
          }
          continue;
        }

        // Same custom title + overlapping dates
        if (a.custom_title && b.custom_title) {
          const titleA = normalizeTitle(a.custom_title);
          const titleB = normalizeTitle(b.custom_title);
          if (titleA.length > 0 && titleA === titleB) {
            signals.push({ type: "same_title", detail: titleA });
            signals.push({ type: "overlapping_dates", detail: `${a.start_date} - ${a.end_date}` });
            const [idA, idB] = orderedPair(a.id, b.id);
            const key = `${idA}:${idB}`;
            if (!seen.has(key)) {
              seen.add(key);
              pairs.push({ entityAId: idA, entityBId: idB, confidence: "high", signals });
            }
          }
        }
      }
    }
  }

  return pairs;
}

// ─── Main Scan Orchestrator ──────────────────────────────────────────────────

async function scanCompany(companyId: string): Promise<number> {
  const supabase = requireSupabase();
  let newCount = 0;

  // Load existing dismissed/pending pairs to skip
  const { data: existingReviews } = await supabase
    .from("duplicate_reviews")
    .select("entity_type, entity_a_id, entity_b_id, status")
    .eq("company_id", companyId)
    .in("status", ["pending", "dismissed"]);

  const existingKeys = new Set(
    (existingReviews ?? []).map(
      (r) => `${r.entity_type}:${r.entity_a_id}:${r.entity_b_id}`
    )
  );

  async function insertNewPairs(
    entityType: DuplicateEntityType,
    pairs: DetectedPair[]
  ): Promise<number> {
    const newPairs = pairs.filter((p) => {
      const key = `${entityType}:${p.entityAId}:${p.entityBId}`;
      return !existingKeys.has(key);
    });

    if (newPairs.length === 0) return 0;

    const rows = newPairs.map((p) => ({
      company_id: companyId,
      entity_type: entityType,
      entity_a_id: p.entityAId,
      entity_b_id: p.entityBId,
      confidence: p.confidence,
      signals: p.signals,
      status: "pending",
    }));

    const { error } = await supabase
      .from("duplicate_reviews")
      .insert(rows);

    if (error) {
      console.error(`[DuplicateDetection] Failed to insert ${entityType} pairs:`, error.message);
      return 0;
    }
    return newPairs.length;
  }

  // ── 1. Clients ──
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, phone_number, address")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (clients && clients.length > 1) {
    const clientPairs = scanClients(clients as ClientRow[]);
    newCount += await insertNewPairs("client", clientPairs);
  }

  // ── 2. Opportunities ──
  const { data: opps } = await supabase
    .from("opportunities")
    .select("id, contact_name, contact_email, contact_phone, title, address")
    .eq("company_id", companyId)
    .in("stage", ACTIVE_OPP_STAGES)
    .is("deleted_at", null);

  if (opps && opps.length > 1) {
    const oppPairs = scanOpportunities(opps as OpportunityRow[]);
    newCount += await insertNewPairs("opportunity", oppPairs);
  }

  // ── 3. Projects ──
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, client_id, address")
    .eq("company_id", companyId)
    .in("status", ACTIVE_PROJECT_STATUSES)
    .is("deleted_at", null);

  if (projects && projects.length > 1) {
    const projectPairs = scanProjects(projects as ProjectRow[]);
    newCount += await insertNewPairs("project", projectPairs);
  }

  // ── 4. Tasks ──
  const { data: tasks } = await supabase
    .from("project_tasks")
    .select("id, project_id, task_type_id, custom_title, start_date, end_date")
    .eq("company_id", companyId)
    .not("status", "in", '("completed","cancelled")')
    .is("deleted_at", null);

  if (tasks && tasks.length > 1) {
    const taskPairs = scanTasks(tasks as TaskRow[]);
    newCount += await insertNewPairs("task", taskPairs);
  }

  return newCount;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const DuplicateDetectionService = {
  scanCompany,

  // Exposed for unit testing
  _scanClients: scanClients,
  _scanOpportunities: scanOpportunities,
  _scanProjects: scanProjects,
  _scanTasks: scanTasks,
  _datesOverlap: datesOverlap,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api/services/duplicate-detection-service.ts
git commit -m "feat: duplicate detection service — scan logic for clients, opportunities, projects, tasks"
```

---

### Task 4: Detection Service Unit Tests

**Files:**
- Create: `tests/unit/duplicate-detection.test.ts`

- [ ] **Step 1: Write unit tests for all four scanners**

```typescript
// tests/unit/duplicate-detection.test.ts
import { describe, it, expect } from "vitest";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

const { _scanClients, _scanOpportunities, _scanProjects, _scanTasks, _datesOverlap } =
  DuplicateDetectionService;

describe("scanClients", () => {
  it("detects same email as high confidence", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "john@smith.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Inc", email: "john@smith.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals[0].type).toBe("same_email");
  });

  it("detects same phone as high confidence", () => {
    const clients = [
      { id: "aaa", name: "A Corp", email: null, phone_number: "(555) 123-4567", address: null },
      { id: "bbb", name: "B Corp", email: null, phone_number: "555-123-4567", address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals[0].type).toBe("same_phone");
  });

  it("detects fuzzy name match as medium confidence", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "a@gmail.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Ltd", email: "b@gmail.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("medium");
    expect(pairs[0].signals[0].type).toBe("fuzzy_name");
  });

  it("upgrades to high when fuzzy name + same domain", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "john@smithroof.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Ltd", email: "jane@smithroof.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "fuzzy_name" }),
        expect.objectContaining({ type: "same_domain" }),
      ])
    );
  });

  it("does not flag unrelated clients", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "smith@gmail.com", phone_number: "555-111-1111", address: null },
      { id: "bbb", name: "Jones Plumbing", email: "jones@gmail.com", phone_number: "555-222-2222", address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(0);
  });

  it("enforces ordered pair (a < b)", () => {
    const clients = [
      { id: "zzz", name: "Test", email: "same@test.com", phone_number: null, address: null },
      { id: "aaa", name: "Test 2", email: "same@test.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs[0].entityAId).toBe("aaa");
    expect(pairs[0].entityBId).toBe("zzz");
  });
});

describe("scanOpportunities", () => {
  it("detects same contactEmail as high confidence", () => {
    const opps = [
      { id: "aaa", contact_name: "John", contact_email: "john@test.com", contact_phone: null, title: "Deck", address: null },
      { id: "bbb", contact_name: "Johnny", contact_email: "john@test.com", contact_phone: null, title: "Roof", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("detects fuzzy name + same title as medium", () => {
    const opps = [
      { id: "aaa", contact_name: "Smith Construction", contact_email: null, contact_phone: null, title: "Deck Renovation", address: null },
      { id: "bbb", contact_name: "Smith Construction Inc", contact_email: null, contact_phone: null, title: "Deck Renovation", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("medium");
  });

  it("requires 2+ signals for name-based matches", () => {
    const opps = [
      { id: "aaa", contact_name: "Smith", contact_email: null, contact_phone: null, title: "Deck", address: null },
      { id: "bbb", contact_name: "Smith Inc", contact_email: null, contact_phone: null, title: "Roof", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(0); // Only fuzzy_name, not enough
  });
});

describe("scanProjects", () => {
  it("detects same client + fuzzy title as high", () => {
    const projects = [
      { id: "aaa", title: "Deck Renovation", client_id: "client1", address: null },
      { id: "bbb", title: "Deck Renovation", client_id: "client1", address: null },
    ];
    const pairs = _scanProjects(projects);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("detects same client + same address as high", () => {
    const projects = [
      { id: "aaa", title: "Phase 1", client_id: "client1", address: "123 Main St" },
      { id: "bbb", title: "Phase 2", client_id: "client1", address: "123 Main Street" },
    ];
    // Titles differ, so this won't match on title. But same client + same address = high.
    // Wait — normalizeAddress doesn't equate "St" and "Street". These are different.
    // Let's use identical addresses:
    const projects2 = [
      { id: "aaa", title: "Phase 1", client_id: "client1", address: "123 Main St" },
      { id: "bbb", title: "Phase 2", client_id: "client1", address: "123 Main St." },
    ];
    const pairs = _scanProjects(projects2);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "same_client" }),
        expect.objectContaining({ type: "same_address" }),
      ])
    );
  });
});

describe("scanTasks", () => {
  it("detects same taskType + overlapping dates as high", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
      { id: "bbb", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-02", end_date: "2026-04-04" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("does not flag tasks on different projects", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
      { id: "bbb", project_id: "p2", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(0);
  });

  it("does not flag non-overlapping dates", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-02" },
      { id: "bbb", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-03", end_date: "2026-04-04" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(0);
  });
});

describe("datesOverlap", () => {
  it("returns true for overlapping ranges", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-05", "2026-04-03", "2026-04-07")).toBe(true);
  });
  it("returns true for contained ranges", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-10", "2026-04-03", "2026-04-05")).toBe(true);
  });
  it("returns true for same-day overlap", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-01", "2026-04-01", "2026-04-01")).toBe(true);
  });
  it("returns false for non-overlapping", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04")).toBe(false);
  });
  it("returns false when start is null", () => {
    expect(_datesOverlap(null, "2026-04-02", "2026-04-01", "2026-04-04")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx vitest run tests/unit/duplicate-detection.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/duplicate-detection.test.ts
git commit -m "test: unit tests for duplicate detection scanners — clients, opportunities, projects, tasks"
```

---

### Task 5: Merge & Dismiss Logic

**Files:**
- Modify: `src/lib/api/services/duplicate-detection-service.ts`

- [ ] **Step 1: Add merge and dismiss methods to the service**

Append to the `DuplicateDetectionService` export object (before the closing `};`), and add the necessary helper functions above it:

```typescript
// ─── Smart Merge ─────────────────────────────────────────────────────────────

/** Backfill null fields on winner from loser. Returns the fields that were backfilled. */
function backfillFields(
  winner: Record<string, unknown>,
  loser: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of fields) {
    if (
      (winner[field] === null || winner[field] === undefined || winner[field] === "") &&
      loser[field] !== null &&
      loser[field] !== undefined &&
      loser[field] !== ""
    ) {
      updates[field] = loser[field];
    }
  }
  return updates;
}

const MERGE_FIELDS: Record<DuplicateEntityType, string[]> = {
  client: ["email", "phone_number", "address", "latitude", "longitude", "profile_image_url", "notes"],
  opportunity: ["contact_email", "contact_phone", "description", "estimated_value", "address"],
  project: ["address", "latitude", "longitude", "notes", "description"],
  task: ["task_notes", "custom_title"],
};

const ENTITY_TABLES: Record<DuplicateEntityType, string> = {
  client: "clients",
  opportunity: "opportunities",
  project: "projects",
  task: "project_tasks",
};

// Maps entity type → array of { table, fkColumn } for relationship reassignment
const RELATIONSHIP_MAP: Record<DuplicateEntityType, { table: string; fkColumn: string }[]> = {
  client: [
    { table: "projects", fkColumn: "client_id" },
    { table: "sub_clients", fkColumn: "client_id" },
    { table: "opportunities", fkColumn: "client_id" },
    { table: "estimates", fkColumn: "client_id" },
    { table: "invoices", fkColumn: "client_id" },
  ],
  opportunity: [
    { table: "activities", fkColumn: "opportunity_id" },
    { table: "follow_ups", fkColumn: "opportunity_id" },
    { table: "stage_transitions", fkColumn: "opportunity_id" },
    { table: "estimates", fkColumn: "opportunity_id" },
    { table: "opportunity_email_threads", fkColumn: "opportunity_id" },
  ],
  project: [
    { table: "project_tasks", fkColumn: "project_id" },
    { table: "estimates", fkColumn: "project_id" },
    { table: "invoices", fkColumn: "project_id" },
    { table: "project_notes", fkColumn: "project_id" },
    { table: "site_visits", fkColumn: "project_id" },
  ],
  task: [], // Tasks are leaf entities — no child relationships
};

async function mergeEntities(
  reviewId: string,
  winnerId: string,
  resolvedBy: string
): Promise<void> {
  const supabase = requireSupabase();

  // 1. Fetch the review record
  const { data: review, error: fetchErr } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (fetchErr || !review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const entityType = review.entity_type as DuplicateEntityType;
  const loserId = winnerId === review.entity_a_id ? review.entity_b_id : review.entity_a_id;
  const table = ENTITY_TABLES[entityType];

  // 2. Fetch both entities
  const { data: winnerRow } = await supabase.from(table).select("*").eq("id", winnerId).single();
  const { data: loserRow } = await supabase.from(table).select("*").eq("id", loserId).single();

  if (!winnerRow || !loserRow) {
    throw new Error(`Could not fetch entities for merge: winner=${winnerId}, loser=${loserId}`);
  }

  // 3. Backfill missing fields on winner
  const updates = backfillFields(winnerRow, loserRow, MERGE_FIELDS[entityType]);
  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase.from(table).update(updates).eq("id", winnerId);
    if (updateErr) {
      console.error(`[DuplicateDetection] Failed to backfill fields:`, updateErr.message);
    }
  }

  // 4. Reassign relationships
  for (const rel of RELATIONSHIP_MAP[entityType]) {
    const { error: relErr } = await supabase
      .from(rel.table)
      .update({ [rel.fkColumn]: winnerId })
      .eq(rel.fkColumn, loserId);
    if (relErr) {
      console.error(`[DuplicateDetection] Failed to reassign ${rel.table}.${rel.fkColumn}:`, relErr.message);
    }
  }

  // 5. Soft-delete loser
  const { error: deleteErr } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", loserId);
  if (deleteErr) {
    console.error(`[DuplicateDetection] Failed to soft-delete loser:`, deleteErr.message);
  }

  // 6. Update review record
  const { error: reviewErr } = await supabase
    .from("duplicate_reviews")
    .update({
      status: "merged",
      winner_id: winnerId,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (reviewErr) {
    console.error(`[DuplicateDetection] Failed to update review:`, reviewErr.message);
  }

  // 7. Cascade: replace loser in other pending reviews
  // Any pending review that references the loser should either:
  // - Replace loser with winner (if the other side isn't already the winner)
  // - Be deleted (if it would become a self-reference)
  const { data: affectedReviews } = await supabase
    .from("duplicate_reviews")
    .select("id, entity_a_id, entity_b_id")
    .eq("company_id", review.company_id)
    .eq("entity_type", entityType)
    .eq("status", "pending")
    .neq("id", reviewId)
    .or(`entity_a_id.eq.${loserId},entity_b_id.eq.${loserId}`);

  for (const affected of affectedReviews ?? []) {
    const otherSide =
      affected.entity_a_id === loserId ? affected.entity_b_id : affected.entity_a_id;

    if (otherSide === winnerId) {
      // Would become self-reference — delete
      await supabase.from("duplicate_reviews").delete().eq("id", affected.id);
    } else {
      // Replace loser with winner, maintaining ordered pair
      const [newA, newB] = orderedPair(winnerId, otherSide);
      await supabase
        .from("duplicate_reviews")
        .update({ entity_a_id: newA, entity_b_id: newB })
        .eq("id", affected.id);
    }
  }
}

async function dismissPair(reviewId: string, resolvedBy: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from("duplicate_reviews")
    .update({
      status: "dismissed",
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (error) {
    throw new Error(`Failed to dismiss review ${reviewId}: ${error.message}`);
  }
}

async function getPendingReviews(companyId: string): Promise<DuplicateReview[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapReviewFromDb);
}
```

Then update the export object to include all methods:

```typescript
export const DuplicateDetectionService = {
  scanCompany,
  getPendingReviews,
  mergeEntities,
  dismissPair,

  // Exposed for unit testing
  _scanClients: scanClients,
  _scanOpportunities: scanOpportunities,
  _scanProjects: scanProjects,
  _scanTasks: scanTasks,
  _datesOverlap: datesOverlap,
  _backfillFields: backfillFields,
};
```

- [ ] **Step 2: Add backfill unit test**

Append to `tests/unit/duplicate-detection.test.ts`:

```typescript
describe("backfillFields", () => {
  const { _backfillFields } = DuplicateDetectionService;

  it("copies non-null loser fields into null winner fields", () => {
    const winner = { email: null, phone_number: "555-1234", notes: null };
    const loser = { email: "john@test.com", phone_number: "555-5678", notes: "Good client" };
    const result = _backfillFields(winner, loser, ["email", "phone_number", "notes"]);
    expect(result).toEqual({ email: "john@test.com", notes: "Good client" });
    // phone_number not included because winner already has it
  });

  it("does not overwrite existing winner fields", () => {
    const winner = { email: "existing@test.com" };
    const loser = { email: "other@test.com" };
    const result = _backfillFields(winner, loser, ["email"]);
    expect(result).toEqual({});
  });

  it("treats empty string as null for backfill", () => {
    const winner = { notes: "" };
    const loser = { notes: "Some notes" };
    const result = _backfillFields(winner, loser, ["notes"]);
    expect(result).toEqual({ notes: "Some notes" });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx vitest run tests/unit/duplicate-detection.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/services/duplicate-detection-service.ts tests/unit/duplicate-detection.test.ts
git commit -m "feat: add merge, dismiss, and getPendingReviews to duplicate detection service"
```

---

### Task 6: Notification Type + Query Keys

**Files:**
- Modify: `src/lib/api/services/notification-service.ts`
- Modify: `src/lib/api/query-client.ts`

- [ ] **Step 1: Add `duplicates_found` to NotificationType**

In `src/lib/api/services/notification-service.ts`, add `"duplicates_found"` to the union:

```typescript
export type NotificationType =
  | "mention"
  | "role_needed"
  | "pipeline_complete"
  | "gmail_sync"
  | "intel_available"
  | "setup_prompt"
  | "leads_waiting"
  | "system"
  | "project_assigned"
  | "task_assigned"
  | "task_completed"
  | "schedule_change"
  | "expense_submitted"
  | "expense_approved"
  | "duplicates_found";
```

- [ ] **Step 2: Add duplicateReviews query keys**

In `src/lib/api/query-client.ts`, add to the `queryKeys` object:

```typescript
duplicateReviews: {
  all: (companyId: string) => ["duplicateReviews", companyId] as const,
  pending: (companyId: string) => ["duplicateReviews", "pending", companyId] as const,
},
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/notification-service.ts src/lib/api/query-client.ts
git commit -m "feat: add duplicates_found notification type and duplicateReviews query keys"
```

---

### Task 7: Cron Endpoint

**Files:**
- Create: `src/app/api/cron/duplicate-scan/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

```typescript
// src/app/api/cron/duplicate-scan/route.ts

/**
 * POST /api/cron/duplicate-scan
 * Vercel cron: runs daily at 5am UTC.
 * Scans all active-subscription companies for duplicate entities.
 * Creates notifications for admin/owner/office users when duplicates are found.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { getSubscriptionInfo } from "@/lib/subscription";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import type { Company } from "@/lib/types/models";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // Fetch all companies with subscription info
    const { data: companies, error: companyErr } = await supabase
      .from("companies")
      .select(
        "id, subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
      );

    if (companyErr) {
      throw new Error(`Failed to fetch companies: ${companyErr.message}`);
    }

    const results: Array<{
      companyId: string;
      newDuplicates: number;
      error?: string;
    }> = [];

    let skippedInactive = 0;

    for (const row of companies ?? []) {
      // Map snake_case to camelCase for getSubscriptionInfo
      const companyInfo = {
        subscriptionPlan: row.subscription_plan,
        subscriptionStatus: row.subscription_status,
        trialEndDate: row.trial_end_date ? new Date(row.trial_end_date) : undefined,
        seatedEmployeeIds: row.seated_employee_ids ?? [],
        adminIds: row.admin_ids ?? [],
        maxSeats: row.max_seats ?? 0,
      };

      const subInfo = getSubscriptionInfo(companyInfo as Pick<Company, "subscriptionPlan" | "subscriptionStatus" | "trialEndDate" | "seatedEmployeeIds" | "adminIds" | "maxSeats">);
      if (!subInfo.isActive) {
        skippedInactive++;
        continue;
      }

      try {
        const newDuplicates = await DuplicateDetectionService.scanCompany(row.id);
        results.push({ companyId: row.id, newDuplicates });

        // Send notifications if new duplicates found
        if (newDuplicates > 0) {
          // Fetch admin/owner/office users for this company
          const { data: users } = await supabase
            .from("users")
            .select("id")
            .eq("company_id", row.id)
            .in("role", ["admin", "owner", "office"])
            .is("deleted_at", null);

          for (const user of users ?? []) {
            await NotificationService.create({
              userId: user.id,
              companyId: row.id,
              type: "duplicates_found",
              title: "Potential duplicates found",
              body: `${newDuplicates} potential duplicate record${newDuplicates === 1 ? "" : "s"} detected`,
              persistent: false,
              actionLabel: "Review",
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[DuplicateScan] Company ${row.id} failed:`, message);
        results.push({ companyId: row.id, newDuplicates: 0, error: message });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: results.length,
      skippedInactive,
      totalNewDuplicates: results.reduce((sum, r) => sum + r.newDuplicates, 0),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateScan] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
```

- [ ] **Step 2: Add cron entry to vercel.json**

Add to the `crons` array in `vercel.json`:

```json
{
  "path": "/api/cron/duplicate-scan",
  "schedule": "0 5 * * *"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/duplicate-scan/route.ts vercel.json
git commit -m "feat: add daily duplicate scan cron at 5am UTC with subscription gating"
```

---

### Task 8: API Routes (GET, Merge, Dismiss)

**Files:**
- Create: `src/app/api/duplicates/route.ts`
- Create: `src/app/api/duplicates/[id]/merge/route.ts`
- Create: `src/app/api/duplicates/[id]/dismiss/route.ts`

- [ ] **Step 1: GET pending reviews route**

```typescript
// src/app/api/duplicates/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server-client-rsc";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

export async function GET() {
  const supabase = await createClient();
  setSupabaseOverride(supabase);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user's company
    const { data: userData } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!userData?.company_id) {
      return NextResponse.json({ error: "No company" }, { status: 400 });
    }

    const reviews = await DuplicateDetectionService.getPendingReviews(userData.company_id);

    // Fetch entity data for both sides of each review
    const enriched = await enrichReviews(reviews, supabase);

    return NextResponse.json({ reviews: enriched });
  } finally {
    setSupabaseOverride(null);
  }
}

/** Fetch the actual entity rows for both sides of each review pair */
async function enrichReviews(
  reviews: Awaited<ReturnType<typeof DuplicateDetectionService.getPendingReviews>>,
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>
) {
  // Group entity IDs by type for batch fetching
  const idsByType: Record<string, Set<string>> = {};
  for (const r of reviews) {
    if (!idsByType[r.entityType]) idsByType[r.entityType] = new Set();
    idsByType[r.entityType].add(r.entityAId);
    idsByType[r.entityType].add(r.entityBId);
  }

  const TABLE_MAP: Record<string, string> = {
    client: "clients",
    opportunity: "opportunities",
    project: "projects",
    task: "project_tasks",
  };

  // Batch fetch entities
  const entityCache: Record<string, Record<string, unknown>> = {};
  for (const [type, ids] of Object.entries(idsByType)) {
    const table = TABLE_MAP[type];
    const { data } = await supabase
      .from(table)
      .select("*")
      .in("id", Array.from(ids));
    for (const row of data ?? []) {
      entityCache[row.id as string] = row;
    }
  }

  return reviews.map((r) => ({
    ...r,
    entityA: entityCache[r.entityAId] ?? null,
    entityB: entityCache[r.entityBId] ?? null,
  }));
}
```

- [ ] **Step 2: POST merge route**

```typescript
// src/app/api/duplicates/[id]/merge/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server-client-rsc";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;
  const supabase = await createClient();
  setSupabaseOverride(supabase);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { winnerId } = body;

    if (!winnerId || typeof winnerId !== "string") {
      return NextResponse.json(
        { error: "winnerId is required" },
        { status: 400 }
      );
    }

    await DuplicateDetectionService.mergeEntities(reviewId, winnerId, user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateMerge] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
```

- [ ] **Step 3: POST dismiss route**

```typescript
// src/app/api/duplicates/[id]/dismiss/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server-client-rsc";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;
  const supabase = await createClient();
  setSupabaseOverride(supabase);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await DuplicateDetectionService.dismissPair(reviewId, user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DuplicateDismiss] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    setSupabaseOverride(null);
  }
}
```

- [ ] **Step 4: Verify server-client-rsc exists**

Run: `ls /Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/supabase/`

If `server-client-rsc.ts` doesn't exist, check what the authenticated server-side client pattern is and update the imports accordingly. The cron route uses `getServiceRoleClient()` (no auth, bypasses RLS). The user-facing API routes need the authenticated client.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/duplicates/route.ts src/app/api/duplicates/\[id\]/merge/route.ts src/app/api/duplicates/\[id\]/dismiss/route.ts
git commit -m "feat: add API routes for duplicate reviews — GET pending, POST merge, POST dismiss"
```

---

### Task 9: i18n Dictionaries

**Files:**
- Create: `src/i18n/dictionaries/en/duplicates.json`
- Create: `src/i18n/dictionaries/es/duplicates.json`

- [ ] **Step 1: Create English dictionary**

```json
{
  "title": "Potential Duplicates",
  "empty": "No duplicates found. Your data is clean.",
  "tabs.clients": "Clients",
  "tabs.opportunities": "Opportunities",
  "tabs.projects": "Projects",
  "tabs.tasks": "Tasks",
  "card.mergeLeft": "Keep Left",
  "card.mergeRight": "Keep Right",
  "card.dismiss": "Not a Match",
  "card.confidence.high": "High",
  "card.confidence.medium": "Medium",
  "card.matchSignals": "Match Signals",
  "signals.same_email": "Same email",
  "signals.same_phone": "Same phone",
  "signals.same_address": "Same address",
  "signals.same_domain": "Same email domain",
  "signals.fuzzy_name": "Similar name",
  "signals.same_title": "Same title",
  "signals.same_client": "Same client",
  "signals.same_task_type": "Same task type",
  "signals.overlapping_dates": "Overlapping dates",
  "fields.name": "Name",
  "fields.email": "Email",
  "fields.phone": "Phone",
  "fields.address": "Address",
  "fields.projects": "Projects",
  "fields.created": "Created",
  "fields.title": "Title",
  "fields.contact": "Contact",
  "fields.stage": "Stage",
  "fields.value": "Value",
  "fields.status": "Status",
  "fields.client": "Client",
  "fields.tasks": "Tasks",
  "fields.taskType": "Task Type",
  "fields.dates": "Dates",
  "fields.project": "Project",
  "fields.crew": "Crew",
  "merging": "Merging...",
  "merged": "Merged successfully",
  "dismissed": "Dismissed"
}
```

- [ ] **Step 2: Create Spanish dictionary**

```json
{
  "title": "Posibles Duplicados",
  "empty": "No se encontraron duplicados. Tus datos están limpios.",
  "tabs.clients": "Clientes",
  "tabs.opportunities": "Oportunidades",
  "tabs.projects": "Proyectos",
  "tabs.tasks": "Tareas",
  "card.mergeLeft": "Mantener Izquierda",
  "card.mergeRight": "Mantener Derecha",
  "card.dismiss": "No es Duplicado",
  "card.confidence.high": "Alta",
  "card.confidence.medium": "Media",
  "card.matchSignals": "Señales de Coincidencia",
  "signals.same_email": "Mismo correo",
  "signals.same_phone": "Mismo teléfono",
  "signals.same_address": "Misma dirección",
  "signals.same_domain": "Mismo dominio de correo",
  "signals.fuzzy_name": "Nombre similar",
  "signals.same_title": "Mismo título",
  "signals.same_client": "Mismo cliente",
  "signals.same_task_type": "Mismo tipo de tarea",
  "signals.overlapping_dates": "Fechas superpuestas",
  "fields.name": "Nombre",
  "fields.email": "Correo",
  "fields.phone": "Teléfono",
  "fields.address": "Dirección",
  "fields.projects": "Proyectos",
  "fields.created": "Creado",
  "fields.title": "Título",
  "fields.contact": "Contacto",
  "fields.stage": "Etapa",
  "fields.value": "Valor",
  "fields.status": "Estado",
  "fields.client": "Cliente",
  "fields.tasks": "Tareas",
  "fields.taskType": "Tipo de Tarea",
  "fields.dates": "Fechas",
  "fields.project": "Proyecto",
  "fields.crew": "Equipo",
  "merging": "Fusionando...",
  "merged": "Fusionado exitosamente",
  "dismissed": "Descartado"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/duplicates.json src/i18n/dictionaries/es/duplicates.json
git commit -m "feat: add i18n dictionaries for duplicate review UI (en + es)"
```

---

### Task 10: Zustand Store + TanStack Query Hook

**Files:**
- Create: `src/stores/duplicate-review-store.ts`
- Create: `src/lib/hooks/use-duplicate-reviews.ts`
- Modify: `src/lib/hooks/index.ts`

- [ ] **Step 1: Create Zustand store**

```typescript
// src/stores/duplicate-review-store.ts
"use client";

import { create } from "zustand";

interface DuplicateReviewState {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useDuplicateReviewStore = create<DuplicateReviewState>()(
  (set) => ({
    open: false,
    openSheet: () => set({ open: true }),
    closeSheet: () => set({ open: false }),
  })
);
```

- [ ] **Step 2: Create TanStack Query hook**

```typescript
// src/lib/hooks/use-duplicate-reviews.ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";
import type {
  DuplicateReview,
  DuplicateEntityType,
} from "@/lib/api/services/duplicate-detection-service";

interface EnrichedDuplicateReview extends DuplicateReview {
  entityA: Record<string, unknown> | null;
  entityB: Record<string, unknown> | null;
}

interface GroupedReviews {
  client: EnrichedDuplicateReview[];
  opportunity: EnrichedDuplicateReview[];
  project: EnrichedDuplicateReview[];
  task: EnrichedDuplicateReview[];
  total: number;
}

export function useDuplicateReviews() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery<GroupedReviews>({
    queryKey: queryKeys.duplicateReviews.pending(companyId),
    queryFn: async () => {
      const res = await fetch("/api/duplicates");
      if (!res.ok) throw new Error("Failed to fetch duplicate reviews");
      const { reviews } = (await res.json()) as {
        reviews: EnrichedDuplicateReview[];
      };

      const grouped: GroupedReviews = {
        client: [],
        opportunity: [],
        project: [],
        task: [],
        total: reviews.length,
      };

      for (const r of reviews) {
        grouped[r.entityType].push(r);
      }

      return grouped;
    },
    enabled: !!companyId,
  });
}

export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      reviewId,
      winnerId,
    }: {
      reviewId: string;
      winnerId: string;
    }) => {
      const res = await fetch(`/api/duplicates/${reviewId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Merge failed");
      }
    },
    onSuccess: () => {
      // Invalidate reviews and entity lists
      queryClient.invalidateQueries({
        queryKey: queryKeys.duplicateReviews.pending(company?.id ?? ""),
      });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({ reviewId }: { reviewId: string }) => {
      const res = await fetch(`/api/duplicates/${reviewId}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Dismiss failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.duplicateReviews.pending(company?.id ?? ""),
      });
    },
  });
}
```

- [ ] **Step 3: Export from hooks index**

Add to `src/lib/hooks/index.ts`:

```typescript
// Duplicate Reviews
export { useDuplicateReviews, useMergeDuplicate, useDismissDuplicate } from "./use-duplicate-reviews";
```

- [ ] **Step 4: Commit**

```bash
git add src/stores/duplicate-review-store.ts src/lib/hooks/use-duplicate-reviews.ts src/lib/hooks/index.ts
git commit -m "feat: add duplicate review Zustand store and TanStack Query hooks"
```

---

### Task 11: Notification Click Handler Modification

**Files:**
- Modify: `src/components/layouts/notification-mini-card.tsx`

- [ ] **Step 1: Add sheet-open behavior for duplicates_found notifications**

In `src/components/layouts/notification-mini-card.tsx`, import the store and modify the click handler:

Add import at top:
```typescript
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
```

Inside the component, add:
```typescript
const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);
```

Modify `handleCardClick` — add this check before the existing `if (notification.actionUrl)` block:

```typescript
if (notification.type === "duplicates_found") {
  if (!notification.persistent) {
    onDismiss(notification.id);
  }
  collapse();
  openDuplicateSheet();
  return;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layouts/notification-mini-card.tsx
git commit -m "feat: open duplicate review sheet from duplicates_found notification click"
```

---

### Task 12: Duplicate Pair Card Component

**Files:**
- Create: `src/components/ops/duplicate-pair-card.tsx`

- [ ] **Step 1: Build the comparison card**

```typescript
// src/components/ops/duplicate-pair-card.tsx
"use client";

import { useDictionary } from "@/i18n/use-dictionary";
import type { DuplicateEntityType, DuplicateConfidence, DuplicateSignal } from "@/lib/api/services/duplicate-detection-service";
import { format } from "date-fns";

interface DuplicatePairCardProps {
  reviewId: string;
  entityType: DuplicateEntityType;
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
  entityA: Record<string, unknown> | null;
  entityB: Record<string, unknown> | null;
  onMerge: (reviewId: string, winnerId: string) => void;
  onDismiss: (reviewId: string) => void;
  isMerging: boolean;
}

export function DuplicatePairCard({
  reviewId,
  entityType,
  confidence,
  signals,
  entityA,
  entityB,
  onMerge,
  onDismiss,
  isMerging,
}: DuplicatePairCardProps) {
  const t = useDictionary("duplicates");

  if (!entityA || !entityB) return null;

  const idA = entityA.id as string;
  const idB = entityB.id as string;

  return (
    <div className="rounded-sm border border-white/8 bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] p-4">
      {/* Header: confidence + signals */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`rounded-sm px-2 py-0.5 font-kosugi text-[10px] uppercase tracking-wider ${
            confidence === "high"
              ? "bg-red-500/20 text-red-400"
              : "bg-amber-500/20 text-amber-400"
          }`}
        >
          {t(`card.confidence.${confidence}`)}
        </span>
        {signals.map((s, i) => (
          <span
            key={i}
            className="rounded-sm bg-white/5 px-2 py-0.5 font-kosugi text-[10px] text-white/50"
          >
            {t(`signals.${s.type}`) || s.type}
          </span>
        ))}
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-4">
        <EntitySummary entityType={entityType} entity={entityA} t={t} />
        <EntitySummary entityType={entityType} entity={entityB} t={t} />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onMerge(reviewId, idA)}
          disabled={isMerging}
          className="flex-1 rounded-sm border border-white/8 bg-white/5 px-3 py-2 font-mohave text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          ← {t("card.mergeLeft")}
        </button>
        <button
          onClick={() => onMerge(reviewId, idB)}
          disabled={isMerging}
          className="flex-1 rounded-sm border border-white/8 bg-white/5 px-3 py-2 font-mohave text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          {t("card.mergeRight")} →
        </button>
        <button
          onClick={() => onDismiss(reviewId)}
          disabled={isMerging}
          className="rounded-sm border border-white/8 bg-white/5 px-3 py-2 font-mohave text-sm text-white/40 transition-colors hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
        >
          {t("card.dismiss")}
        </button>
      </div>
    </div>
  );
}

// ─── Entity Summary (per-type field display) ─────────────────────────────────

function EntitySummary({
  entityType,
  entity,
  t,
}: {
  entityType: DuplicateEntityType;
  entity: Record<string, unknown>;
  t: (key: string) => string;
}) {
  switch (entityType) {
    case "client":
      return <ClientSummary entity={entity} t={t} />;
    case "opportunity":
      return <OpportunitySummary entity={entity} t={t} />;
    case "project":
      return <ProjectSummary entity={entity} t={t} />;
    case "task":
      return <TaskSummary entity={entity} t={t} />;
  }
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-kosugi text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </span>
      <span className={`font-mohave text-sm ${value ? "text-white/80" : "text-white/20"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

function ClientSummary({ entity, t }: { entity: Record<string, unknown>; t: (k: string) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.name")} value={entity.name as string} />
      <FieldRow label={t("fields.email")} value={entity.email as string | null} />
      <FieldRow label={t("fields.phone")} value={entity.phone_number as string | null} />
      <FieldRow label={t("fields.address")} value={entity.address as string | null} />
      <FieldRow
        label={t("fields.created")}
        value={entity.created_at ? format(new Date(entity.created_at as string), "MMM d, yyyy") : null}
      />
    </div>
  );
}

function OpportunitySummary({ entity, t }: { entity: Record<string, unknown>; t: (k: string) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.title")} value={entity.title as string} />
      <FieldRow label={t("fields.contact")} value={entity.contact_name as string | null} />
      <FieldRow label={t("fields.email")} value={entity.contact_email as string | null} />
      <FieldRow label={t("fields.stage")} value={entity.stage as string | null} />
      <FieldRow
        label={t("fields.value")}
        value={entity.estimated_value ? `$${Number(entity.estimated_value).toLocaleString()}` : null}
      />
    </div>
  );
}

function ProjectSummary({ entity, t }: { entity: Record<string, unknown>; t: (k: string) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.title")} value={entity.title as string} />
      <FieldRow label={t("fields.status")} value={entity.status as string | null} />
      <FieldRow label={t("fields.address")} value={entity.address as string | null} />
      <FieldRow
        label={t("fields.created")}
        value={entity.created_at ? format(new Date(entity.created_at as string), "MMM d, yyyy") : null}
      />
    </div>
  );
}

function TaskSummary({ entity, t }: { entity: Record<string, unknown>; t: (k: string) => string }) {
  const startDate = entity.start_date
    ? format(new Date(entity.start_date as string), "MMM d")
    : null;
  const endDate = entity.end_date
    ? format(new Date(entity.end_date as string), "MMM d")
    : null;
  const dateRange = startDate && endDate ? `${startDate} – ${endDate}` : startDate;

  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t("fields.title")} value={(entity.custom_title as string | null) || (entity.task_type_id as string)} />
      <FieldRow label={t("fields.dates")} value={dateRange} />
      <FieldRow label={t("fields.status")} value={entity.status as string | null} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/duplicate-pair-card.tsx
git commit -m "feat: add DuplicatePairCard component — side-by-side comparison with merge/dismiss actions"
```

---

### Task 13: Duplicate Review Sheet Component

**Files:**
- Create: `src/components/ops/duplicate-review-sheet.tsx`

- [ ] **Step 1: Build the sheet**

```typescript
// src/components/ops/duplicate-review-sheet.tsx
"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import { useDuplicateReviews, useMergeDuplicate, useDismissDuplicate } from "@/lib/hooks";
import { useDictionary } from "@/i18n/use-dictionary";
import { DuplicatePairCard } from "./duplicate-pair-card";
import { useState } from "react";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";

const ENTITY_TABS: DuplicateEntityType[] = ["client", "opportunity", "project", "task"];
const TAB_KEYS: Record<DuplicateEntityType, string> = {
  client: "tabs.clients",
  opportunity: "tabs.opportunities",
  project: "tabs.projects",
  task: "tabs.tasks",
};

export function DuplicateReviewSheet() {
  const { open, closeSheet } = useDuplicateReviewStore();
  const { data, isLoading } = useDuplicateReviews();
  const mergeMutation = useMergeDuplicate();
  const dismissMutation = useDismissDuplicate();
  const t = useDictionary("duplicates");
  const [activeTab, setActiveTab] = useState<DuplicateEntityType>("client");

  const handleMerge = (reviewId: string, winnerId: string) => {
    mergeMutation.mutate({ reviewId, winnerId });
  };

  const handleDismiss = (reviewId: string) => {
    dismissMutation.mutate({ reviewId });
  };

  // Find first tab with items
  const firstNonEmptyTab =
    data && ENTITY_TABS.find((tab) => (data[tab]?.length ?? 0) > 0);

  // Auto-select first tab with items on open
  const effectiveTab =
    data && data[activeTab]?.length === 0 && firstNonEmptyTab
      ? firstNonEmptyTab
      : activeTab;

  const reviews = data?.[effectiveTab] ?? [];

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && closeSheet()}>
      <SheetContent side="right" className="w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mohave text-lg text-white/90">
            {t("title")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Review and resolve duplicate records
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-white/8 pb-2">
            {ENTITY_TABS.map((tab) => {
              const count = data?.[tab]?.length ?? 0;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-sm px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-wider transition-colors ${
                    effectiveTab === tab
                      ? "bg-white/10 text-white/90"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {t(TAB_KEYS[tab])}
                  {count > 0 && (
                    <span className="ml-1.5 text-[#6F94B0]">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="font-mohave text-sm text-white/40">Loading...</span>
            </div>
          ) : reviews.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="font-mohave text-sm text-white/40">
                {t("empty")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((review) => (
                <DuplicatePairCard
                  key={review.id}
                  reviewId={review.id}
                  entityType={review.entityType}
                  confidence={review.confidence}
                  signals={review.signals}
                  entityA={review.entityA}
                  entityB={review.entityB}
                  onMerge={handleMerge}
                  onDismiss={handleDismiss}
                  isMerging={mergeMutation.isPending || dismissMutation.isPending}
                />
              ))}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/duplicate-review-sheet.tsx
git commit -m "feat: add DuplicateReviewSheet — tabbed review UI with merge/dismiss actions"
```

---

### Task 14: Mount Sheet at Layout Level

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Read the current dashboard layout**

Read `src/app/(dashboard)/layout.tsx` to find where other portaled components (modals, sheets, FAB) are mounted. Look for the pattern — likely near the end of the layout JSX, alongside other global components.

- [ ] **Step 2: Add the DuplicateReviewSheet import and mount**

Add import at top:
```typescript
import { DuplicateReviewSheet } from "@/components/ops/duplicate-review-sheet";
```

Add `<DuplicateReviewSheet />` alongside other global components (FAB, command palette, etc.) inside the layout return. Place it after other sheet/modal components:

```typescript
<DuplicateReviewSheet />
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/layout.tsx
git commit -m "feat: mount DuplicateReviewSheet at dashboard layout level"
```

---

### Task 15: Final Integration — vercel.json Already Done, Run Type Check

**Files:** None new

- [ ] **Step 1: Run type check**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit`
Expected: No type errors. If there are errors, fix them — likely around:
- `createClient` import path (verify the exact export from supabase helpers for authenticated server routes)
- `queryKeys.duplicateReviews` shape if the query-client export pattern differs
- `useDictionary` import path

- [ ] **Step 2: Run all unit tests**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx vitest run tests/unit/`
Expected: All tests PASS.

- [ ] **Step 3: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Manual verification**

1. Start dev server: `npm run dev`
2. Verify `/api/duplicates` returns `{ reviews: [] }` when no duplicates exist
3. Verify the notification rail still renders correctly
4. Manually insert a test duplicate review row in Supabase, then verify the sheet opens when clicking the notification

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve type check and build issues for duplicate detection system"
```

---

## Summary

| Task | What It Builds | Files |
|------|---------------|-------|
| 1 | Database table + indexes + RLS | 1 migration |
| 2 | Shared normalization utils + tests | 2 new + 1 modified |
| 3 | Detection service — scan logic | 1 new |
| 4 | Detection unit tests | 1 new |
| 5 | Merge + dismiss + getPendingReviews | 1 modified + 1 test updated |
| 6 | NotificationType + query keys | 2 modified |
| 7 | Cron endpoint + vercel.json | 1 new + 1 modified |
| 8 | API routes (GET, merge, dismiss) | 3 new |
| 9 | i18n dictionaries (en + es) | 2 new |
| 10 | Zustand store + TanStack hook + exports | 3 new + 1 modified |
| 11 | Notification click handler | 1 modified |
| 12 | DuplicatePairCard component | 1 new |
| 13 | DuplicateReviewSheet component | 1 new |
| 14 | Mount sheet at layout level | 1 modified |
| 15 | Type check, tests, build verification | 0 new |

**Total: 16 new files, 7 modified files, 15 tasks**
