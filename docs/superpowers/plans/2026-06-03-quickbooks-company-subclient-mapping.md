# QuickBooks Company → Client + Contact → Sub-Client Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spawned tasks must follow the naming convention `QB CUSTOMER MAPPING - P1-<n>`.

**Goal:** When a pulled QuickBooks Customer has a `CompanyName`, import it as a parent `clients` row (the billing entity) **plus** a `sub_clients` contact row for the person; individuals with no `CompanyName` stay flat (unchanged). Idempotent on re-import, forward-compatible with QB Jobs/sub-customers, and includes two small review-UI bug fixes that live in the touched files.

**Architecture (three locked decisions — bug d6951b82):**
1. **Invoices/payments attach to the parent client only.** The `sub_client` is contact metadata; there is no `sub_client_id` on `invoices`/`payments` and we add none. Resolution stays `CustomerRef → clients` exactly as today.
2. **QB Customer = parent client (qb_id on `clients`, 1:1).** When `CompanyName` is present, also upsert one `sub_clients` contact under that client (keyed by a new additive `sub_clients.qb_id` = the QB Customer Id, so re-import is idempotent). Customer matching uses `CompanyName` as the match name when present, falling back to `DisplayName`. Individuals are unchanged.
3. **Record but don't act on QB Jobs/sub-customers.** Capture `ParentRef`/`Job` in dedicated additive staging columns (not buried in `raw`) for a future project-linking pass, and surface a non-blocking review flag. No project creation this phase. CanPro does not use Jobs; other companies might.

**Field mapping (verified against live schema):**

| QB Customer field | Goes to | Notes |
|---|---|---|
| `Id` | `clients.qb_id` (and `sub_clients.qb_id` when a contact is created) | 1:1 link / idempotency key |
| `CompanyName` | `clients.name` (when present) | drives "company-type" branch + match name |
| `GivenName` + `FamilyName` (fallback `DisplayName` if ≠ CompanyName) | `sub_clients.name` | the contact person |
| `Title` (salutation only) | — | **deliberately NOT imported**: QB's only title field is a salutation (Mr./Mrs.), not a job role; `sub_clients.title` stays null to avoid polluting the role field |
| `PrimaryEmailAddr.Address` | `sub_clients.email` (or `clients.email` for individuals / contact-less companies) | |
| `PrimaryPhone.FreeFormNumber` | `sub_clients.phone_number` (or `clients.phone_number`) | |
| `BillAddr` | `clients.address` (billing entity) **and** `sub_clients.address` | billing address legitimately belongs to both |
| `ParentRef.value` | `qbo_staging_customers.parent_qb_id` | recorded, not acted on |
| `Job` | `qbo_staging_customers.is_job` | recorded, not acted on |

**Three name-branch rules (encoded in `normalizeCustomer`):**
- `CompanyName` present **and** a contact name exists → client `name=CompanyName`, `email/phone=null` (they live on the contact), `address=BillAddr`; **plus** a sub_client with the contact details.
- `CompanyName` present, **no** contact name (company with no person) → client `name=CompanyName`, `email/phone=PrimaryEmail/Phone`, `address=BillAddr`; **no** sub_client.
- No `CompanyName` (individual) → client `name=DisplayName`, `email/phone/address` as today; **no** sub_client. (Current behavior — unchanged.)

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Supabase (Postgres + RLS, service-role apply), vitest. Apply path is service-role (`getServiceRoleClient()`), so `sub_clients` writes bypass RLS; the existing `public`-role `company_isolation` policy on `sub_clients` covers anon reads.

**Gotchas (carried from project memory):**
- Apply writes via **service role** — RLS is bypassed; do not add anon write policies.
- **Never** `as unknown as` cast snake_case DB rows to camelCase types — map explicitly (caused the blank-rows bug, PR #77).
- Build in an **isolated worktree off `origin/main`**; never branch-switch the shared `ops-web` checkout. Symlink `node_modules` + `.env.local`.
- Gate every change with `npx tsc --noEmit` + targeted `npx vitest run <substring>` before commit.
- Migration is **additive-only** (nullable columns + new index) → iOS-sync-safe. Direct prod apply is authorized (low-tenant), sentinel-guarded.
- Merging to `main` auto-builds Vercel but prod deploy is **manual** (auto-deploy off) — see `reference_ops_web_vercel_autodeploy_off`.

---

## File Structure

| File | New/Modified | Responsibility |
|---|---|---|
| `supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql` | **New** | Additive: 5 columns on `qbo_staging_customers`, `qb_id` on `sub_clients` + partial unique index; sentinel guard. |
| `src/lib/api/services/qbo-normalize.ts` | Modify | `normalizeCustomer` captures company/contact/job; **shared** `clientFieldsFromCustomer` + `subClientFieldsFromCustomer` helpers (single source of truth for both apply paths). |
| `src/lib/api/services/__tests__/qbo-normalize.test.ts` | Modify | Unit tests for the new mapping branches + the two shaping helpers. |
| `src/lib/types/qbo-import.ts` | Modify | Extend `QboStagedCustomer`, `QboApplyResult`, `QboStagedCounts`, `QboCustomerMatch` (required fields). |
| `tests/unit/lib/types/qbo-import.test.ts` | Modify | New type-shape test + **update 3 existing typed literals** to the new required fields. |
| `tests/unit/services/qbo-apply-types.test.ts` | Modify | **Update the existing `QboApplyResult` literal** (`subClientsCreated`). |
| `src/lib/api/services/quickbooks-import-service.ts` | Modify | Stage new columns; match by company name; apply parent + sub_client (via shared helpers); reconcile/review fields. |
| `src/lib/api/services/__tests__/quickbooks-import-service.test.ts` | Modify | Staging + match-by-company-name coverage (inline company customer). |
| `tests/unit/services/quickbooks-apply.test.ts` | Modify | Sub-client create/link/idempotency; **extend the in-memory double with `sub_clients` + staged fixtures**. |
| `src/lib/api/services/quickbooks-webhook-apply-service.ts` | Modify | **(Task 6B)** Route `applyCustomer` through the shared helpers so webhook ≡ batch (parity invariant). |
| `tests/unit/services/quickbooks-webhook-apply.test.ts` | Modify | Company-customer + individual webhook coverage; add `sub_clients` to its double. |
| `src/lib/api/services/qbo-reconcile.ts` | Modify | `buildStagedCounts` gains a `customerRows` arg → `subClientsToCreate` (excl. jobs) + `jobsDetected`. |
| `src/lib/api/services/__tests__/qbo-reconcile.test.ts` | Modify | Counts coverage + **update the existing `buildStagedCounts` call** (`customerRows: []`). |
| `src/components/accounting/qbo/customer-match-table.tsx` | Modify | Contact sub-line (raw child); remove `needs_review` from selectable actions. |
| `src/components/accounting/qbo/quickbooks-import-tab.tsx` | Modify | Jobs flag (non-blocking) in review header. |
| `tests/unit/components/qbo-customer-match-table.test.tsx` | Modify | New fixture + **update 2 existing `QboCustomerMatch` fixtures** (`companyName`/`contactName: null`). |
| `src/i18n/client.tsx` | Modify | **Fix `{token}` interpolation** in `t()` (the `{count}` bug). |
| `src/i18n/dictionaries/{en,es}/accounting.json` | Modify | `contactLabel` + jobs-flag strings. |
| `tests/unit/i18n/*` | New/Modify | Interpolation unit test + key-presence test. |

---

## Task 0: Create isolated worktree off origin/main

**Files:** none (environment setup)

- [ ] **Step 1: Fetch and create the worktree**

```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web
git fetch origin
git worktree add -b feat/qbo-company-subclient ../ops-web-qbo-subclient origin/main
```

- [ ] **Step 2: Symlink deps + env so the worktree builds/tests**

```bash
cd ../ops-web-qbo-subclient
ln -s ../ops-web/node_modules node_modules
ln -s ../ops-web/.env.local .env.local
```

- [ ] **Step 3: Verify clean baseline gate**

Run: `npx tsc --noEmit`
Expected: exits 0 (pre-existing lint errors in CI are unrelated — see `project_ops_web_ci_red_lint_gates_tests`; we gate on tsc + vitest, not `next lint`).

All subsequent paths are relative to `../ops-web-qbo-subclient`.

---

## Task 1: Additive migration — staging columns + sub_clients.qb_id

**Files:**
- Create: `supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql`
- Test: `tests/unit/supabase/qbo-company-subclient-migration.test.ts`

- [ ] **Step 1: Write the failing migration-shape test**

```ts
// tests/unit/supabase/qbo-company-subclient-migration.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql"),
  "utf8"
);

describe("qbo company/sub-client mapping migration", () => {
  it("wraps the whole body in a transaction", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("adds the five staging columns additively (IF NOT EXISTS, nullable)", () => {
    for (const col of ["company_name", "contact_name", "contact_title", "parent_qb_id", "is_job"]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\b`, "i"));
    }
    expect(sql).not.toMatch(/not null/i); // every added column is nullable
  });

  it("adds sub_clients.qb_id and a partial unique conflict target", () => {
    expect(sql).toMatch(/alter table public\.sub_clients\s+add column if not exists qb_id text/i);
    expect(sql).toMatch(/create unique index if not exists sub_clients_company_qb_id_uniq/i);
    expect(sql).toMatch(/on public\.sub_clients \(company_id, qb_id\)\s*where qb_id is not null/i);
  });

  it("ends with a sentinel guard that re-verifies the objects", () => {
    expect(sql).toMatch(/do \$\$/i);
    expect(sql).toMatch(/raise exception/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails (file missing)**

Run: `npx vitest run tests/unit/supabase/qbo-company-subclient-migration.test.ts`
Expected: FAIL — `ENOENT` (migration file does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql
begin;

-- ============================================================================
-- QuickBooks read-only sync — Company → client + Contact → sub_client mapping
--
-- Purely ADDITIVE (iOS-sync-safe): five nullable columns on
-- qbo_staging_customers to carry the QB CompanyName / contact / job-hierarchy
-- fields the normalizer now extracts, plus a nullable qb_id link column on
-- sub_clients with a PARTIAL unique index so the apply step can upsert one
-- canonical contact per (company, QuickBooks customer). Nothing is altered or
-- dropped; re-running is a no-op (IF NOT EXISTS everywhere). Direct prod apply
-- is authorized (low-tenant); a sentinel DO block re-verifies every object and
-- rolls the whole transaction back if any invariant is missing.
-- ============================================================================

-- ── staging: company / contact / job-hierarchy capture ──────────────────────
alter table public.qbo_staging_customers
  add column if not exists company_name  text,
  add column if not exists contact_name  text,
  add column if not exists contact_title text,
  add column if not exists parent_qb_id  text,
  add column if not exists is_job        boolean;

-- ── sub_clients: QB link column for idempotent contact upsert ────────────────
alter table public.sub_clients
  add column if not exists qb_id text;

-- Partial unique conflict target for .upsert(..., { onConflict: "company_id,qb_id" }).
-- Partial because the vast majority of sub_clients are non-QB (qb_id IS NULL)
-- and must be allowed to coexist; only QB-imported contacts are deduped.
create unique index if not exists sub_clients_company_qb_id_uniq
  on public.sub_clients (company_id, qb_id)
  where qb_id is not null;

-- ── sentinel rollback guard ──────────────────────────────────────────────────
do $$
declare
  v_col text;
begin
  foreach v_col in array array['company_name','contact_name','contact_title','parent_qb_id','is_job']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'qbo_staging_customers' and column_name = v_col
    ) then
      raise exception 'missing column qbo_staging_customers.%', v_col;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sub_clients' and column_name = 'qb_id'
  ) then
    raise exception 'missing column sub_clients.qb_id';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sub_clients_company_qb_id_uniq'
  ) then
    raise exception 'missing index sub_clients_company_qb_id_uniq';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/supabase/qbo-company-subclient-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Apply the migration to prod (additive, authorized, sentinel-guarded)**

Apply via the Supabase MCP `apply_migration` tool (project `ijeekuhbatykdomumfjx`, name `qbo_company_subclient_mapping`) with the SQL body above. Then verify:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='qbo_staging_customers'
  and column_name in ('company_name','contact_name','contact_title','parent_qb_id','is_job');
select indexname from pg_indexes where tablename='sub_clients' and indexname='sub_clients_company_qb_id_uniq';
```
Expected: 5 staging columns + the index present.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql tests/unit/supabase/qbo-company-subclient-migration.test.ts
git commit -m "feat(qbo): additive migration for company/sub-client mapping (staging cols + sub_clients.qb_id)"
```

---

## Task 2: Normalizer — capture company / contact / job fields

**Files:**
- Modify: `src/lib/api/services/qbo-normalize.ts` (`StagedCustomerRow`, `normalizeCustomer`)
- Test: `src/lib/api/services/__tests__/qbo-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// add to qbo-normalize.test.ts
import { normalizeCustomer } from "../qbo-normalize";

describe("normalizeCustomer — company + contact split", () => {
  it("splits a company customer with a person contact", () => {
    const row = normalizeCustomer({
      Id: "42",
      DisplayName: "Acme Corp",
      CompanyName: "Acme Corp",
      GivenName: "John",
      FamilyName: "Smith",
      Title: "Mr",
      PrimaryEmailAddr: { Address: "john@acme.com" },
      PrimaryPhone: { FreeFormNumber: "555-0100" },
      BillAddr: { Line1: "1 Main St", City: "Reno", CountrySubDivisionCode: "NV", PostalCode: "89501" },
    });
    expect(row.company_name).toBe("Acme Corp");
    expect(row.contact_name).toBe("John Smith");
    expect(row.contact_title).toBeNull(); // QB Title is a salutation; deliberately skipped
    expect(row.email).toBe("john@acme.com");
    expect(row.phone).toBe("555-0100");
    expect(row.address).toBe("1 Main St, Reno, NV 89501");
    expect(row.is_job).toBe(false);
    expect(row.parent_qb_id).toBeNull();
  });

  it("treats a CompanyName-only customer (no person) as having no contact", () => {
    const row = normalizeCustomer({ Id: "7", DisplayName: "Globex", CompanyName: "Globex" });
    expect(row.company_name).toBe("Globex");
    expect(row.contact_name).toBeNull(); // DisplayName === CompanyName → no person
  });

  it("keeps an individual flat (no company_name, no contact)", () => {
    const row = normalizeCustomer({ Id: "9", DisplayName: "Jane Doe", GivenName: "Jane", FamilyName: "Doe" });
    expect(row.company_name).toBeNull();
    expect(row.contact_name).toBe("Jane Doe");
    // For an individual the apply step ignores contact_name (no company_name) — kept for reference only.
  });

  it("captures QB job hierarchy without acting on it", () => {
    const row = normalizeCustomer({
      Id: "100", DisplayName: "Acme:Kitchen", CompanyName: "Acme", Job: true,
      ParentRef: { value: "42" }, GivenName: "", FamilyName: "",
    });
    expect(row.is_job).toBe(true);
    expect(row.parent_qb_id).toBe("42");
    // Decision 3: a Job is recorded, never acted on — no contact derived from
    // the "Parent:Child" DisplayName, so STEP 1b creates no junk sub_client.
    expect(row.contact_name).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/api/services/__tests__/qbo-normalize.test.ts -t "company + contact"`
Expected: FAIL — `row.company_name` is undefined (fields not produced yet).

- [ ] **Step 3: Extend the interface + function**

In `qbo-normalize.ts`, replace the `StagedCustomerRow` interface and `normalizeCustomer` function with:

```ts
export interface StagedCustomerRow {
  qb_id: string;
  display_name: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  parent_qb_id: string | null;
  is_job: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  raw: QbRecord;
}

export function normalizeCustomer(raw: QbRecord): StagedCustomerRow {
  const email = (raw.PrimaryEmailAddr as { Address?: string } | undefined)?.Address;
  const phone = (raw.PrimaryPhone as { FreeFormNumber?: string } | undefined)?.FreeFormNumber;
  const companyName = str(raw.CompanyName);
  const displayName = str(raw.DisplayName);
  const given = str(raw.GivenName);
  const family = str(raw.FamilyName);
  const personName = [given, family].filter((p): p is string => !!p).join(" ");
  // A QB Job/sub-customer carries the "Parent:Child" path in DisplayName (e.g.
  // "Acme:Kitchen") and is RECORDED but not acted on (Decision 3) — it must
  // never yield a contact. So: never use the DisplayName fallback for a Job, and
  // never when DisplayName looks like a job path (contains ':').
  const isJob = raw.Job === true;
  // Contact = the person. Fall back to DisplayName only when it carries a real
  // person (differs from the company name, not a job path), so a company with no
  // contact person — and every Job — yields null (no junk sub-client).
  const contactName =
    personName.length > 0
      ? personName
      : !isJob && displayName && displayName !== companyName && !displayName.includes(":")
        ? displayName
        : null;
  const parentRef = (raw.ParentRef as { value?: string } | undefined)?.value;
  return {
    qb_id: String(raw.Id),
    display_name: displayName,
    company_name: companyName,
    contact_name: contactName,
    // QB Customer has no contact job-title — `Title` is a salutation (Mr./Mrs.).
    // We deliberately do NOT import it into sub_clients.title (a job-role field).
    contact_title: null,
    parent_qb_id: str(parentRef),
    is_job: isJob,
    email: str(email),
    phone: str(phone),
    address: joinBillAddr(raw.BillAddr as QbBillAddr | undefined),
    active: raw.Active !== false,
    raw,
  };
}
```

- [ ] **Step 3b: Add the shared field-shaping helpers (single source of truth for BOTH apply paths)**

The batch `applyImport` (Task 6) AND the webhook `applyCustomer` (Task 6B) must shape the client + sub_client identically, or the same QB customer imports differently per entry path (the webhook service's own header calls this parity "load-bearing"). Encode that once, as pure helpers in `qbo-normalize.ts`, consumed by both. Add to `qbo-normalize.ts`:

```ts
/** Subset of a normalized/staged customer the apply helpers need. */
export interface CustomerShape {
  company_name: string | null;
  contact_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_job?: boolean | null;
}

/**
 * The `clients` row fields for a QB customer. Company-type → name = CompanyName,
 * and when a contact person exists the email/phone live on the sub_client (null
 * here); a contact-less company keeps them. Individuals are unchanged. BillAddr
 * stays on the billing entity either way.
 */
export function clientFieldsFromCustomer(c: CustomerShape): {
  name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
} {
  const isCompany = !!c.company_name;
  const hasContact = isCompany && !!c.contact_name && c.is_job !== true;
  return {
    name: isCompany ? (c.company_name as string) : (c.display_name ?? "QuickBooks customer"),
    email: hasContact ? null : (c.email ?? null),
    phone_number: hasContact ? null : (c.phone ?? null),
    address: c.address ?? null,
  };
}

/**
 * The `sub_clients` contact row for a QB customer, or null when none is created:
 * individuals (no CompanyName), contact-less companies, and QB Jobs (Decision 3).
 */
export function subClientFieldsFromCustomer(c: CustomerShape): {
  name: string;
  title: string | null;
  email: string | null;
  phone_number: string | null;
  address: string | null;
} | null {
  if (!c.company_name || !c.contact_name || c.is_job === true) return null;
  return {
    name: c.contact_name,
    title: null, // QB has no contact job-title (Title is a salutation) — deliberately null.
    email: c.email ?? null,
    phone_number: c.phone ?? null,
    address: c.address ?? null,
  };
}
```

Add unit tests in `qbo-normalize.test.ts` covering all branches:
```ts
import { clientFieldsFromCustomer, subClientFieldsFromCustomer } from "../qbo-normalize";

describe("clientFieldsFromCustomer / subClientFieldsFromCustomer", () => {
  const company = { company_name: "Acme", contact_name: "John Smith", display_name: "Acme", email: "j@acme.com", phone: "555", address: "1 St", is_job: false };
  it("company+contact → CompanyName client, contact holds email/phone", () => {
    expect(clientFieldsFromCustomer(company)).toEqual({ name: "Acme", email: null, phone_number: null, address: "1 St" });
    expect(subClientFieldsFromCustomer(company)).toEqual({ name: "John Smith", title: null, email: "j@acme.com", phone_number: "555", address: "1 St" });
  });
  it("contact-less company → email/phone stay on the client, no sub_client", () => {
    const c = { ...company, contact_name: null };
    expect(clientFieldsFromCustomer(c)).toEqual({ name: "Acme", email: "j@acme.com", phone_number: "555", address: "1 St" });
    expect(subClientFieldsFromCustomer(c)).toBeNull();
  });
  it("individual → DisplayName client, no sub_client", () => {
    const c = { company_name: null, contact_name: "Jane Doe", display_name: "Jane Doe", email: "jane@x.com", phone: "1", address: null, is_job: false };
    expect(clientFieldsFromCustomer(c).name).toBe("Jane Doe");
    expect(clientFieldsFromCustomer(c).email).toBe("jane@x.com");
    expect(subClientFieldsFromCustomer(c)).toBeNull();
  });
  it("QB Job → no sub_client even with company+contact", () => {
    expect(subClientFieldsFromCustomer({ ...company, is_job: true })).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/api/services/__tests__/qbo-normalize.test.ts`
Expected: PASS (all existing + the new normalizeCustomer + helper tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/services/qbo-normalize.ts src/lib/api/services/__tests__/qbo-normalize.test.ts
git commit -m "feat(qbo): normalizeCustomer captures CompanyName/contact/job + shared field-shaping helpers"
```

---

## Task 3: Types — staging, apply result, counts, match

> **Required-fields warning (verified):** the new fields are added as **required** (not optional). Four EXISTING typed object literals construct these shapes today and will fail `tsc --noEmit` the instant the fields land — they MUST be updated in this same task (Step 3b), or the Task 3 / Task 5 / Task 10 tsc gates break. The literals are: `tests/unit/lib/types/qbo-import.test.ts` (a typed `QboStagedCustomer`, a typed `QboCustomerMatch`, and the `stagedCounts` inside a typed `QboImportReview`) and `tests/unit/services/qbo-apply-types.test.ts` (a typed `QboApplyResult`). The untyped literal in `tests/unit/components/quickbooks-import-tab.test.tsx` is assigned to `unknown` and does NOT break tsc (handled for coverage in Task 8).

**Files:**
- Modify: `src/lib/types/qbo-import.ts`
- Test: `tests/unit/lib/types/qbo-import.test.ts` (new describe block + update the 3 existing typed literals)
- Test: `tests/unit/services/qbo-apply-types.test.ts` (update the existing `QboApplyResult` literal)

- [ ] **Step 1: Write the failing type-shape test**

```ts
// add to tests/unit/lib/types/qbo-import.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { QboStagedCustomer, QboApplyResult, QboStagedCounts, QboCustomerMatch } from "@/lib/types/qbo-import";

describe("qbo-import types — company/sub-client extensions", () => {
  it("QboStagedCustomer carries company/contact/job fields", () => {
    expectTypeOf<QboStagedCustomer>().toHaveProperty("companyName");
    expectTypeOf<QboStagedCustomer>().toHaveProperty("contactName");
    expectTypeOf<QboStagedCustomer>().toHaveProperty("contactTitle");
    expectTypeOf<QboStagedCustomer>().toHaveProperty("parentQbId");
    expectTypeOf<QboStagedCustomer>().toHaveProperty("isJob");
  });
  it("QboApplyResult counts sub-clients", () => {
    expectTypeOf<QboApplyResult>().toHaveProperty("subClientsCreated");
  });
  it("QboStagedCounts surfaces sub-clients + jobs", () => {
    expectTypeOf<QboStagedCounts>().toHaveProperty("subClientsToCreate");
    expectTypeOf<QboStagedCounts>().toHaveProperty("jobsDetected");
  });
  it("QboCustomerMatch carries companyName + contactName for the review label", () => {
    expectTypeOf<QboCustomerMatch>().toHaveProperty("companyName");
    expectTypeOf<QboCustomerMatch>().toHaveProperty("contactName");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/unit/lib/types/qbo-import.test.ts`
Expected: FAIL (type errors / missing properties).

- [ ] **Step 3: Edit the interfaces**

In `qbo-import.ts`:

Add to `QboStagedCustomer` (after `address: string | null;`):
```ts
  companyName: string | null;
  contactName: string | null;
  contactTitle: string | null;
  parentQbId: string | null;
  isJob: boolean | null;
```

Add to `QboApplyResult` (after `clientsSkipped: number;`):
```ts
  subClientsCreated: number;
```

Add to `QboStagedCounts` (after `skippedInvoices: number;`):
```ts
  /** Company-type staged customers that will produce a sub_client contact. */
  subClientsToCreate: number;
  /** Staged customers flagged as a QB Job/sub-customer (recorded, not acted on). */
  jobsDetected: number;
```

Add to `QboCustomerMatch` (after `displayName: string | null;`):
```ts
  /** QB CompanyName (when present) — preferred label + the name used for matching. */
  companyName: string | null;
  /** QB contact person name (when present) — shown as the sub-line in review. */
  contactName: string | null;
```

- [ ] **Step 3b: Update the 4 existing typed literals (REQUIRED — they break tsc otherwise)**

In `tests/unit/lib/types/qbo-import.test.ts`:
- The `const customer: QboStagedCustomer = { ... }` literal — add: `companyName: null, contactName: null, contactTitle: null, parentQbId: null, isJob: false,`
- The `const match: QboCustomerMatch = { ... }` literal — add: `companyName: null, contactName: null,`
- The `stagedCounts: { ... }` object inside the `const review: QboImportReview = { ... }` literal — add: `subClientsToCreate: 0, jobsDetected: 0,`

In `tests/unit/services/qbo-apply-types.test.ts`:
- The `const r: QboApplyResult = { ... }` literal — add: `subClientsCreated: 0,`

(These are the ONLY existing typed literals that construct these shapes — verified by `git grep`. The runtime producers — `applyImport`'s `result` initializer and `buildStagedCounts`'s return — are populated in Tasks 6/7; `mapCustomerMatch`'s `companyName`/`contactName` in Task 7.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/lib/types/qbo-import.test.ts tests/unit/services/qbo-apply-types.test.ts && npx tsc --noEmit`
Expected: type tests PASS. tsc now FAILS ONLY in the runtime producers `quickbooks-import-service.ts` (the `result` initializer + `getImportReview`/`mapCustomerMatch`) and `qbo-reconcile.ts` (`buildStagedCounts` return) — these are populated in Tasks 6–7, so the FINAL Task 10 tsc gate goes green. No test-literal errors remain after Step 3b. (This transient red is the only acceptable one — the end state must be 0 tsc errors.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/qbo-import.ts tests/unit/lib/types/qbo-import.test.ts tests/unit/services/qbo-apply-types.test.ts
git commit -m "feat(qbo): extend types for company/sub-client mapping + jobs counts"
```

---

## Task 4: Stage the new customer columns (pullAndStage)

**Files:**
- Modify: `src/lib/api/services/quickbooks-import-service.ts` (the `customerRows` builder inside `pullAndStage`)
- Test: `src/lib/api/services/__tests__/quickbooks-import-service.test.ts` (pullAndStage suite)

> **Fixture warning (verified):** the shared fixture `tests/fixtures/qbo/customer.json` holds only two records (Id 58 "Cool Cars", Id 12 "Diego Rodriguez") — NEITHER has `CompanyName`/`GivenName`/`FamilyName`/`Job`/`ParentRef`, and there is no `qb_id "42"`. The existing pullAndStage assertions are pinned to `length === 2`, so do NOT add a 3rd record to the shared JSON (it breaks those). Instead, override the pull double for THIS test only via `pullInstance.pullCustomers.mockResolvedValueOnce([...])` with an inline company customer, and read staged rows via the suite's accessor **`supabase._tables.qbo_staging_customers`** (the service is `svc`; there is no `db.tables` on this double).

- [ ] **Step 1: Write the failing test (inline company customer via the pull double)**

```ts
// In src/lib/api/services/__tests__/quickbooks-import-service.test.ts, pullAndStage suite.
// Verified harness identifiers: pull double = `pullInstance`, service = `svc`,
// store = `supabase._tables.<table>`.
it("stages CompanyName / contact / job fields onto qbo_staging_customers", async () => {
  // Override the pull double for this test only — do NOT touch the shared fixture.
  pullInstance.pullCustomers.mockResolvedValueOnce([
    {
      Id: "42",
      DisplayName: "Acme Corp",
      CompanyName: "Acme Corp",
      GivenName: "John",
      FamilyName: "Smith",
      PrimaryEmailAddr: { Address: "john@acme.com" },
      PrimaryPhone: { FreeFormNumber: "555-0100" },
      BillAddr: { Line1: "1 Main St", City: "Reno", CountrySubDivisionCode: "NV", PostalCode: "89501" },
      Active: true,
    },
  ]);
  const run = await svc.startImportRun(COMPANY_ID);
  await svc.pullAndStage(run.id);
  const row = supabase._tables.qbo_staging_customers.find((r: any) => r.qb_id === "42");
  expect(row.company_name).toBe("Acme Corp");
  expect(row.contact_name).toBe("John Smith");
  expect(row.parent_qb_id).toBeNull();
  expect(row.is_job).toBe(false);
});
```
(`pullInstance`, `svc`, `supabase._tables`, and `COMPANY_ID` are the file's existing identifiers — confirm by reading the pullAndStage suite, which already uses `pullInstance.pullItems.mockResolvedValueOnce(...)` and `supabase._tables.<table>`.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts -t "stages CompanyName"`
Expected: FAIL — `row.company_name` undefined.

- [ ] **Step 3: Extend the `customerRows` mapping**

In `pullAndStage`, replace the `customerRows` builder with:

```ts
      const customerRows = rawCustomers.map((c) => {
        const n = normalizeCustomer(c);
        return {
          run_id: runId,
          company_id: companyId,
          qb_id: n.qb_id,
          display_name: n.display_name,
          company_name: n.company_name,
          contact_name: n.contact_name,
          contact_title: n.contact_title,
          parent_qb_id: n.parent_qb_id,
          is_job: n.is_job,
          email: n.email,
          phone: n.phone,
          address: n.address,
          active: n.active,
          raw: n.raw,
        };
      });
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts -t "stages CompanyName"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/services/quickbooks-import-service.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
git commit -m "feat(qbo): stage CompanyName/contact/job columns during pull"
```

---

## Task 5: Match by company name when present

**Files:**
- Modify: `src/lib/api/services/quickbooks-import-service.ts` (`computeCustomerMatches`, ~line 431)
- Test: `src/lib/api/services/__tests__/quickbooks-import-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Harness identifiers (verified): service = `svc`, store = `supabase._tables.<table>`,
// pull double = `pullInstance`, company const = `COMPANY_ID`. Establish the run
// the file's real way (startImportRun → run.id; there is NO module-level `runId`),
// seed an existing "Acme Corp" client, and pull one company customer.
it("matches a company customer to an existing client by CompanyName, not DisplayName", async () => {
  // Existing OPS client named "Acme Corp" (computeCustomerMatches reads clients
  // filtered by company_id, !deleted_at, !merged_into_client_id).
  supabase._tables.clients.push({
    id: "acme", company_id: COMPANY_ID, name: "Acme Corp",
    email: null, phone_number: null, deleted_at: null, merged_into_client_id: null,
  });
  // One company customer whose DisplayName ("Acme Corp:HQ") differs from CompanyName
  // ("Acme Corp") → match must use CompanyName → propose link by name_exact.
  pullInstance.pullCustomers.mockResolvedValueOnce([
    { Id: "42", DisplayName: "Acme Corp:HQ", CompanyName: "Acme Corp" },
  ]);
  const run = await svc.startImportRun(COMPANY_ID);
  await svc.pullAndStage(run.id);
  await svc.computeCustomerMatches(run.id);
  const match = supabase._tables.qbo_customer_matches.find((m: any) => m.customer_qb_id === "42");
  expect(match.proposed_action).toBe("link");
  expect(match.match_basis).toBe("name_exact");
});
```
(`normalizeCompanyName("Acme Corp")` → "acme" for both the staged CompanyName and the existing client name → single name-exact hit → link/medium. The customer has no email, so the email branch is skipped.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts -t "by CompanyName"`
Expected: FAIL — match uses DisplayName ("Acme Corp:HQ") and proposes `create`.

- [ ] **Step 3: Use company_name as the match name**

In `computeCustomerMatches`, change the staged select and the per-row name resolution:

```ts
    const { data: staged } = await sb
      .from("qbo_staging_customers")
      .select("qb_id, display_name, company_name, email, phone")
      .eq("run_id", runId);
```

Inside the `for` loop, replace the `displayName` derivation and its uses with a `matchName`:

```ts
      const displayName = (row.display_name as string) ?? null;
      const companyName = (row.company_name as string) ?? null;
      // Match on the company name for company-type customers (so they attach to
      // existing company clients); fall back to the display name for individuals.
      const matchName = companyName ?? displayName;
      const email = (row.email as string) ?? null;

      const hasEmailHit =
        !!email &&
        activeClients.some((c) => (c.email ?? "").trim().toLowerCase() === email.trim().toLowerCase());
      let fuzzy: FuzzyCandidate[] = [];
      if (!hasEmailHit && matchName) {
        const { data: candidates } = await sb.rpc("qbo_match_customer_candidates", {
          p_company_id: companyId,
          p_name: matchName,
          p_threshold: FUZZY_THRESHOLD,
        });
        fuzzy = ((candidates as FuzzyCandidate[]) ?? []).map((c) => ({
          client_id: c.client_id,
          name: c.name,
          email: c.email ?? null,
          phone_number: c.phone_number ?? null,
          similarity: Number(c.similarity),
        }));
      }

      const result = resolveCustomerMatch(
        { qb_id: row.qb_id as string, display_name: matchName, email, phone: (row.phone as string) ?? null },
        activeClients,
        fuzzy
      );
```

(The resolver's `display_name` parameter is a generic "name" — passing `matchName` is correct and needs no resolver change.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts -t "by CompanyName"`
Expected: PASS. Also run the whole file to confirm no regression: `npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/services/quickbooks-import-service.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
git commit -m "feat(qbo): match company customers by CompanyName"
```

---

## Task 6: Apply — parent client naming + contact sub_client upsert

**Files:**
- Modify: `src/lib/api/services/quickbooks-import-service.ts` (`applyImport`: the `result` initializer, the STEP 1 create branch, and a new STEP 1b pass)
- Test: `tests/unit/services/quickbooks-apply.test.ts`

- [ ] **Step 1: Extend the in-memory Supabase double for `sub_clients` (REQUIRED — verified)**

The double's `.from(table).upsert/select` is generic in LOGIC, but the backing `db` map is a fixed literal with NO `sub_clients` key, so the first `.from("sub_clients")` call does `db["sub_clients"].find(...)` on `undefined` → `TypeError`. It does NOT "just work." Also note the double exposes rows as **`supabase.__db[table]`** (returned as `{ from, __db: db }`) — there is **no `db.tables`** property. Before writing tests:
1. Add `sub_clients: []` to the `db` initializer in `makeSupabase()`.
2. Add `"sub_clients"` to the `QB_CONFLICT_TABLES` set so the `(company_id, qb_id)` onConflict dedup is actually enforced (otherwise the idempotency test passes for the wrong reason).
3. Seed the staged-customer fixtures the new tests need — three QB customers carrying the new columns — into the run's `qbo_staging_customers` (and matching `qbo_customer_matches`/decisions where the suite requires them):
   - `qb_id "42"`: `company_name "Acme Corp"`, `contact_name "John Smith"`, `email "john@acme.com"`, `phone "555"`, `address "1 Main St, Reno, NV 89501"`, `is_job false`
   - `qb_id "9"`: `company_name null`, `contact_name "Jane Doe"`, `email "jane@doe.com"` (individual)
   - `qb_id "7"`: `company_name "Globex"`, `contact_name null`, `email "info@globex.com"` (company, no contact)
   Add an existing client `id "C1"` named "Acme Corp" for the link test.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/services/quickbooks-apply.test.ts — accessor is supabase.__db[table] (NOT db.tables).
// Staged customers 42/9/7 + client C1 are seeded in Step 1.
describe("applyImport — company → client + contact → sub_client", () => {
  it("creates a parent client (name=CompanyName) and one sub_client contact", async () => {
    const res = await svc.applyImport(RUN_ID, [{ customer_qb_id: "42", action: "create" }]);
    const client = supabase.__db.clients.find((c: any) => c.qb_id === "42");
    expect(client.name).toBe("Acme Corp");
    expect(client.email).toBeNull();          // contact email lives on the sub_client
    expect(client.phone_number).toBeNull();
    expect(client.address).toBe("1 Main St, Reno, NV 89501"); // billing entity keeps the address
    const sub = supabase.__db.sub_clients.find((s: any) => s.qb_id === "42");
    expect(sub.client_id).toBe(client.id);
    expect(sub.name).toBe("John Smith");
    expect(sub.email).toBe("john@acme.com");
    expect(sub.phone_number).toBe("555");
    expect(res.subClientsCreated).toBe(1);
  });

  it("creates a sub_client under a LINKED existing client", async () => {
    // existing client "Acme Corp" id=C1 (seeded); decision: link C1.
    await svc.applyImport(RUN_ID, [{ customer_qb_id: "42", action: "link", client_id: "C1" }]);
    const sub = supabase.__db.sub_clients.find((s: any) => s.qb_id === "42");
    expect(sub.client_id).toBe("C1");
    // link still never overwrites the existing client's own fields:
    const client = supabase.__db.clients.find((c: any) => c.id === "C1");
    expect(client.name).toBe("Acme Corp"); // unchanged by link
  });

  it("is idempotent — re-apply does not duplicate the sub_client", async () => {
    await svc.applyImport(RUN_ID, [{ customer_qb_id: "42", action: "create" }]);
    await svc.applyImport(RUN_ID, [{ customer_qb_id: "42", action: "create" }]);
    expect(supabase.__db.sub_clients.filter((s: any) => s.qb_id === "42").length).toBe(1);
  });

  it("does NOT create a sub_client for an individual (no CompanyName)", async () => {
    const res = await svc.applyImport(RUN_ID, [{ customer_qb_id: "9", action: "create" }]);
    expect(supabase.__db.sub_clients.some((s: any) => s.qb_id === "9")).toBe(false);
    const client = supabase.__db.clients.find((c: any) => c.qb_id === "9");
    expect(client.name).toBe("Jane Doe");
    expect(client.email).toBe("jane@doe.com"); // individual keeps email on the client
    expect(res.subClientsCreated).toBe(0);
  });

  it("does NOT create a sub_client for a company with no contact person", async () => {
    const res = await svc.applyImport(RUN_ID, [{ customer_qb_id: "7", action: "create" }]);
    expect(supabase.__db.sub_clients.some((s: any) => s.qb_id === "7")).toBe(false);
    const client = supabase.__db.clients.find((c: any) => c.qb_id === "7");
    expect(client.name).toBe("Globex");
    expect(client.email).toBe("info@globex.com"); // no contact → email stays on the company
    expect(res.subClientsCreated).toBe(0);
  });
});
```
(Verified harness: construct `svc = new QuickBooksImportService(supabase)` per the suite's pattern; `supabase` is the module-level double returned as `{ from, __db }`; `RUN_ID` is the fixture run id. Staged customers 42/9/7 + client C1 must be in `supabase.__db` before each call — seed via the fixture or in `beforeEach`.)

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/unit/services/quickbooks-apply.test.ts -t "company → client"`
Expected: FAIL — `sub_clients` empty / `subClientsCreated` undefined.

- [ ] **Step 4a: Initialize the new counter**

In `applyImport`, add `subClientsCreated: 0,` to the `result` initializer (alongside `clientsSkipped`).

First, add the import and a tiny local row→shape adapter at the top of `applyImport` (the staged rows are `Record<string, unknown>`; this is an explicit snake→snake map, NOT an `as unknown as` camel cast):
```ts
import {
  // ...existing imports...
  clientFieldsFromCustomer,
  subClientFieldsFromCustomer,
  type CustomerShape,
} from "./qbo-normalize";

// inside applyImport, before STEP 1:
const toShape = (cust: Record<string, unknown>): CustomerShape => ({
  company_name: (cust.company_name as string) ?? null,
  contact_name: (cust.contact_name as string) ?? null,
  display_name: (cust.display_name as string) ?? null,
  email: (cust.email as string) ?? null,
  phone: (cust.phone as string) ?? null,
  address: (cust.address as string) ?? null,
  is_job: (cust.is_job as boolean) ?? null,
});
```

- [ ] **Step 4b: Company-aware client create (via the shared helper)**

Replace the `action === "create"` insert block with:

```ts
      // action === "create" — idempotent on (company_id, qb_id)
      const { data: existing } = await sb
        .from("clients")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", cust.qb_id)
        .maybeSingle();

      if (existing?.id) {
        clientIdByCustomerQbId.set(cust.qb_id as string, existing.id as string);
        result.clientsCreated++;
        continue;
      }

      // Company-aware field shaping — SAME helper the webhook path uses (Task 6B).
      const newId = crypto.randomUUID();
      await sb.from("clients").upsert(
        {
          id: newId,
          company_id: companyId,
          qb_id: cust.qb_id,
          ...clientFieldsFromCustomer(toShape(cust)),
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: created } = await sb
        .from("clients").select("id")
        .eq("company_id", companyId).eq("qb_id", cust.qb_id).maybeSingle();
      clientIdByCustomerQbId.set(cust.qb_id as string, (created?.id as string) ?? newId);
      result.clientsCreated++;
```

- [ ] **Step 4c: Add STEP 1b — contact sub_clients (via the shared helper)**

Immediately after the STEP 1 customer loop closes (before the STEP 2 line-sum map), insert. `subClientFieldsFromCustomer` returns null for individuals, contact-less companies, AND QB Jobs (Decision 3), so the single null-check covers every "no sub_client" case:

```ts
    // ── STEP 1b: Contact sub-clients for company-type customers ────────────
    // One sub_client per QB customer with a CompanyName + a contact person.
    // Keyed (company_id, qb_id) so re-import upserts in place. Runs for both
    // linked and created parents; skipped/needs_review customers have a null
    // clientId and are ignored. subClientFieldsFromCustomer returns null for
    // individuals, contact-less companies, and QB Jobs (Decision 3).
    for (const cust of stagedCustomers ?? []) {
      const clientId = clientIdByCustomerQbId.get(cust.qb_id as string);
      const fields = subClientFieldsFromCustomer(toShape(cust));
      if (!clientId || !fields) continue;
      await sb.from("sub_clients").upsert(
        { company_id: companyId, client_id: clientId, qb_id: cust.qb_id, ...fields },
        { onConflict: "company_id,qb_id" }
      );
      result.subClientsCreated++;
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/services/quickbooks-apply.test.ts`
Expected: PASS (all existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/services/quickbooks-import-service.ts tests/unit/services/quickbooks-apply.test.ts
git commit -m "feat(qbo): apply company customers as client + contact sub_client (idempotent)"
```

---

## Task 6B: Webhook parity — same client+sub_client shaping on the inbound webhook

> **Why (verified, load-bearing):** `quickbooks-webhook-apply-service.ts` has its OWN `applyCustomer()` that creates a FLAT client (`name: n.display_name`, email/phone on the client, no sub_client). Its file header states field-mapping parity with `applyImport` is "deliberate and load-bearing… MUST NOT diverge." If only the batch path (Task 6) changes, the SAME QB company customer imports differently depending on whether it arrived via a pull vs an Intuit change webhook — a permanent split-brain. The shared helpers from Task 2 make both paths identical by construction.

**Files:**
- Modify: `src/lib/api/services/quickbooks-webhook-apply-service.ts` (`applyCustomer`)
- Test: `tests/unit/services/quickbooks-webhook-apply.test.ts`

- [ ] **Step 1: Write the failing webhook test**

> **Verified harness (different from the batch tests):** this suite's double is **capture-based** — `makeSupabase({})` returns `{ client, captured }` where `captured.upserts` is `Array<{ table, row, onConflict }>`. There is **no queryable store** (no `__db`/`_tables`) and **no db map to extend** — assert on `captured.upserts`. The double's post-upsert `maybeSingle` resolves a fresh `{ id }`, so `applyCustomer`'s client-id lookup before the sub_client upsert works. Service = `svc = new QuickBooksWebhookApplyService(client as never)` (per test); connection = `CONN`; fetch = `fetchEntityById.mockResolvedValue(...)`. The existing `SANDBOX_CUSTOMER` has no `CompanyName`, so it still maps flat — no regression.

```ts
// tests/unit/services/quickbooks-webhook-apply.test.ts — capture-based double.
const COMPANY_CUSTOMER = {
  Id: "42", DisplayName: "Acme Corp", CompanyName: "Acme Corp",
  GivenName: "John", FamilyName: "Smith",
  PrimaryEmailAddr: { Address: "john@acme.com" }, PrimaryPhone: { FreeFormNumber: "555" },
};

it("a company-customer webhook creates a CompanyName client + a contact sub_client", async () => {
  const { client, captured } = makeSupabase({});
  fetchEntityById.mockResolvedValue(COMPANY_CUSTOMER);
  const svc = new QuickBooksWebhookApplyService(client as never);
  const result = await svc.applyEntity(CONN, "Customer", "42", "Update");
  expect(result.status).toBe("success");

  const clientUpsert = captured.upserts.find((u) => u.table === "clients");
  expect(clientUpsert!.row).toMatchObject({ qb_id: "42", name: "Acme Corp", email: null, phone_number: null });

  const subUpsert = captured.upserts.find((u) => u.table === "sub_clients");
  expect(subUpsert).toBeDefined();
  expect(subUpsert!.onConflict).toBe("company_id,qb_id");
  expect(subUpsert!.row).toMatchObject({ qb_id: "42", name: "John Smith", email: "john@acme.com", phone_number: "555" });
});

it("an individual webhook stays flat (no sub_client)", async () => {
  const { client, captured } = makeSupabase({});
  fetchEntityById.mockResolvedValue({
    Id: "9", DisplayName: "Jane Doe", GivenName: "Jane", FamilyName: "Doe",
    PrimaryEmailAddr: { Address: "jane@doe.com" },
  });
  const svc = new QuickBooksWebhookApplyService(client as never);
  await svc.applyEntity(CONN, "Customer", "9", "Update");
  const clientUpsert = captured.upserts.find((u) => u.table === "clients");
  expect(clientUpsert!.row).toMatchObject({ qb_id: "9", name: "Jane Doe", email: "jane@doe.com" });
  expect(captured.upserts.some((u) => u.table === "sub_clients")).toBe(false);
});
```
(`makeSupabase`, `fetchEntityById`, `CONN`, `QuickBooksWebhookApplyService` are the file's existing identifiers — reuse them as the existing "Customer" describe block does.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/unit/services/quickbooks-webhook-apply.test.ts -t "company-customer webhook"`
Expected: FAIL — webhook creates a flat `display_name` client and no sub_client.

- [ ] **Step 3: Route `applyCustomer` through the shared helpers**

In `quickbooks-webhook-apply-service.ts`, add the imports and replace the `applyCustomer` body:

```ts
import {
  normalizeCustomer,
  clientFieldsFromCustomer,
  subClientFieldsFromCustomer,
  // ...existing imports (QbRecordLike, etc.)...
} from "./qbo-normalize";

  private async applyCustomer(
    connection: ConnectionRow,
    qbId: string,
    record: QbRecordLike
  ): Promise<ApplyEntityResult> {
    const n = normalizeCustomer(record);
    // SAME shaping as applyImport (Task 6) — single source of truth in qbo-normalize.
    const { error } = await this.supabase.from("clients").upsert(
      {
        company_id: connection.company_id,
        qb_id: n.qb_id,
        ...clientFieldsFromCustomer(n),
      },
      { onConflict: "company_id,qb_id" }
    );
    if (error) {
      return { status: "error", logEntityType: "client", qbId, detail: "client upsert failed" };
    }

    // Company-type customers also get a contact sub_client (parity with STEP 1b).
    // Returns null for individuals, contact-less companies, and QB Jobs.
    const subFields = subClientFieldsFromCustomer(n);
    if (subFields) {
      const { data: clientRow } = await this.supabase
        .from("clients").select("id")
        .eq("company_id", connection.company_id).eq("qb_id", n.qb_id).maybeSingle();
      if (clientRow?.id) {
        const { error: subErr } = await this.supabase.from("sub_clients").upsert(
          { company_id: connection.company_id, client_id: clientRow.id as string, qb_id: n.qb_id, ...subFields },
          { onConflict: "company_id,qb_id" }
        );
        if (subErr) {
          return { status: "error", logEntityType: "client", qbId, detail: "sub_client upsert failed" };
        }
      }
    }
    return { status: "success", logEntityType: "client", qbId, detail: null };
  }
```
(`ensureClientForCustomer` already calls `applyCustomer`, so Invoice/Estimate/Payment webhooks inherit the same shaping for free. `normalizeCustomer` returns a `StagedCustomerRow`, which is structurally assignable to `CustomerShape`, so no cast is needed.)

- [ ] **Step 4: Update the webhook file's parity-invariant comment**

The header comment that says the mapping "mirrors applyImport STEP 1 'create'" should be updated to note it now shares `clientFieldsFromCustomer`/`subClientFieldsFromCustomer` with `applyImport` (so a future editor keeps both on the helpers).

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/services/quickbooks-webhook-apply.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/services/quickbooks-webhook-apply-service.ts tests/unit/services/quickbooks-webhook-apply.test.ts
git commit -m "fix(qbo): webhook applyCustomer shares company/sub_client shaping with batch apply"
```

---

## Task 7: Reconcile counts + review label fields

**Files:**
- Modify: `src/lib/api/services/qbo-reconcile.ts` (`buildStagedCounts`)
- Modify: `src/lib/api/services/quickbooks-import-service.ts` (`getImportReview` select + `mapCustomerMatch`)
- Test: `src/lib/api/services/__tests__/qbo-reconcile.test.ts`

> **Real signatures (verified — the plan must match these, NOT a renamed shape):**
> - `buildStagedCounts(args: { customers: number; estimates: number; invoices: QboStagedInvoice[]; lineItems: number; payments: QboStagedPayment[] }): QboStagedCounts` — `customers/estimates/lineItems` are NUMBERS, `invoices/payments` are staged-row ARRAYS. There is no `customerRows`/`estimateRows`/`invoiceRows`/`lineRows`/`paymentRows`. We ADD one new key, `customerRows: Record<string, unknown>[]`, purely to count sub-clients/jobs — keeping all five existing keys.
> - `mapCustomerMatch(r: Record<string, unknown>, displayNameByQbId: Map<string, string | null>): QboCustomerMatch` — its 2nd param is a display-name STRING map, NOT staging rows; there is **no `stagingByQbId`** anywhere. We replace that param with a full-row map.
> - The EXISTING `qbo-reconcile.test.ts` call `buildStagedCounts({ customers: 5, estimates: 2, invoices, lineItems: 7, payments })` MUST be updated (add `customerRows: []`) or it breaks once the key is required.

- [ ] **Step 1: Write the failing reconcile test (real signature + new customerRows key)**

```ts
// qbo-reconcile.test.ts — extend the buildStagedCounts suite. Keep the existing
// 5 args; add customerRows. Jobs (is_job) are EXCLUDED from subClientsToCreate.
it("counts sub-clients to create (excluding jobs) and jobs detected", () => {
  const counts = buildStagedCounts({
    customers: 4,
    estimates: 0,
    invoices: [],
    lineItems: 0,
    payments: [],
    customerRows: [
      { qb_id: "42", company_name: "Acme", contact_name: "John Smith", is_job: false },
      { qb_id: "7", company_name: "Globex", contact_name: null, is_job: false },
      { qb_id: "9", company_name: null, contact_name: "Jane Doe", is_job: false },
      { qb_id: "100", company_name: "Acme", contact_name: "Bob", is_job: true },
    ],
  });
  expect(counts.subClientsToCreate).toBe(1); // only 42 (7 has no contact, 9 is individual, 100 is a Job)
  expect(counts.jobsDetected).toBe(1);       // 100
});
```

- [ ] **Step 2a: Update the EXISTING reconcile test call (or it stops compiling)**

In `qbo-reconcile.test.ts`, the existing `buildStagedCounts({ customers: 5, estimates: 2, invoices, lineItems: 7, payments })` call → add `customerRows: []`:
```ts
  const c = buildStagedCounts({ customers: 5, estimates: 2, invoices, lineItems: 7, payments, customerRows: [] });
```

- [ ] **Step 2b: Run to confirm failure**

Run: `npx vitest run src/lib/api/services/__tests__/qbo-reconcile.test.ts -t "sub-clients to create"`
Expected: FAIL — `subClientsToCreate`/`jobsDetected` undefined.

- [ ] **Step 3: Extend `buildStagedCounts` (add the `customerRows` arg + two counts; keep existing keys)**

In `qbo-reconcile.ts`, add `customerRows` to the args type and compute the counts; the existing return keys are unchanged:

```ts
export function buildStagedCounts(args: {
  customers: number;
  estimates: number;
  invoices: QboStagedInvoice[];
  lineItems: number;
  payments: QboStagedPayment[];
  customerRows: Record<string, unknown>[]; // NEW — raw staged customer rows for sub-client/job counts
}): QboStagedCounts {
  const invoiceRows = args.invoices as unknown as InvoiceRowView[];
  const paymentRows = args.payments as unknown as PaymentRowView[];
  // ... existing orphanPayments / skippedInvoices computation unchanged ...

  // Company-type customers with a contact, EXCLUDING Jobs (Decision 3).
  const subClientsToCreate = args.customerRows.filter(
    (c) => !!c.company_name && !!c.contact_name && c.is_job !== true
  ).length;
  const jobsDetected = args.customerRows.filter((c) => c.is_job === true).length;

  return {
    customers: args.customers,
    estimates: args.estimates,
    invoices: args.invoices.length,
    lineItems: args.lineItems,
    payments: args.payments.length,
    orphanPayments,
    skippedInvoices,
    subClientsToCreate,
    jobsDetected,
  };
}
```

- [ ] **Step 4: Thread `customerRows` at the call site + carry company/contact onto matches**

In `getImportReview` (`quickbooks-import-service.ts`):

(a) Broaden the staged-customers select — change:
```ts
      sb.from("qbo_staging_customers").select("qb_id, display_name").eq("run_id", runId),
```
to:
```ts
      sb.from("qbo_staging_customers")
        .select("qb_id, display_name, company_name, contact_name, is_job")
        .eq("run_id", runId),
```

(b) Pass `customerRows` into `buildStagedCounts` — the local `customerRows` (`Record<string,unknown>[]`) already exists in `getImportReview`; add it to the call:
```ts
    stagedCounts: buildStagedCounts({
      customers: customerCount,
      estimates: (estimateData ?? []).length,
      invoices,
      lineItems: (lineData ?? []).length,
      payments,
      customerRows, // NEW
    }),
```

(c) Replace the display-name map with a full-row map. Change the construction:
```ts
    const displayNameByQbId = new Map<string, string | null>(
      customerRows.map((c) => [c.qb_id as string, (c.display_name as string) ?? null])
    );
```
to:
```ts
    const stagingByQbId = new Map<string, Record<string, unknown>>(
      customerRows.map((c) => [c.qb_id as string, c])
    );
```
and update the call site `mapCustomerMatch(r, displayNameByQbId)` → `mapCustomerMatch(r, stagingByQbId)`.

(d) Update `mapCustomerMatch` (explicit snake→camel — **never** `as unknown as`-cast). Change its signature and the `displayName` line, and add the two new fields:
```ts
function mapCustomerMatch(
  r: Record<string, unknown>,
  stagingByQbId: Map<string, Record<string, unknown>>
): QboCustomerMatch {
  const staging = stagingByQbId.get(r.customer_qb_id as string);
  // ... existing field mappings unchanged ...
  return {
    // ... existing fields ...
    // Prefer the company name as the review label; fall back to display name.
    displayName:
      (staging?.company_name as string) ?? (staging?.display_name as string) ?? null,
    companyName: (staging?.company_name as string) ?? null,
    contactName: (staging?.contact_name as string) ?? null,
    // ... remaining existing fields ...
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/api/services/__tests__/qbo-reconcile.test.ts && npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/services/qbo-reconcile.ts src/lib/api/services/quickbooks-import-service.ts src/lib/api/services/__tests__/qbo-reconcile.test.ts
git commit -m "feat(qbo): review counts for sub-clients + jobs; carry company/contact onto matches"
```

---

## Task 8: Review UI — contact sub-line, jobs flag, fix needs_review dropdown

**Files:**
- Modify: `src/components/accounting/qbo/customer-match-table.tsx`
- Modify: `src/components/accounting/qbo/quickbooks-import-tab.tsx`
- Test: `tests/unit/components/qbo-customer-match-table.test.tsx`

> **Two verified test-harness facts to handle in this task:**
> 1. This test file **mocks** `@/i18n/client` as `t: (k) => k` — it returns the KEY and ignores params (and the real Task 9 fix can't help, since `client.tsx` is mocked out). The mock returns the *key*, not the dict value, so wrapping the contact name in `t("...contactLine", { name })` would never render the name. **Fix: render the contact name as a RAW JSX child** (Step 3b) — exactly how `companyName`/`displayName` already render — with only a static i18n label routed through `t()`. Then `getByText(/John Smith/)` matches under the existing mock, and production interpolation is irrelevant.
> 2. The two EXISTING `QboCustomerMatch` fixtures ("Sonnenschein Family Store", "Adwin Ko") in this file are typed `QboCustomerMatch[]` and will fail tsc once Task 3 adds the required `companyName`/`contactName` — add `companyName: null, contactName: null` to BOTH (Step 4). `isJob` is **NOT** a field on `QboCustomerMatch` (it lives on `QboStagedCustomer`/`QboStagedCounts`) — do not add it to any match fixture.

- [ ] **Step 1: Write the failing component tests**

```tsx
// qbo-customer-match-table.test.tsx — companyMatch is a QboCustomerMatch with
// companyName: "Acme Corp", contactName: "John Smith", proposedAction: "create"
// (proposedAction must NOT be "needs_review", or the disabled option appears).
it("does not offer needs_review as a selectable action", () => {
  render(<CustomerMatchTable matches={[companyMatch]} decisions={{}} onDecisionChange={() => {}} />);
  const select = screen.getByTestId(`match-action-${companyMatch.customerQbId}`);
  const values = Array.from(select.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
  expect(values).toEqual(["link", "create", "skip"]); // needs_review removed
});

it("shows the contact name as a sub-line for company customers", () => {
  render(<CustomerMatchTable matches={[companyMatch]} decisions={{}} onDecisionChange={() => {}} />);
  expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  expect(screen.getByText(/John Smith/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/unit/components/qbo-customer-match-table.test.tsx`
Expected: FAIL — `needs_review` still an option; contact name not rendered.

- [ ] **Step 3a: Split selectable vs displayable actions**

In `customer-match-table.tsx`, replace:
```ts
const ACTIONS: MatchAction[] = ["link", "create", "skip", "needs_review"];
```
with:
```ts
// needs_review is a SYSTEM-proposed state (ambiguous match), never a user choice —
// the operator must resolve it to link/create/skip. It is shown as the current
// value when proposed, but is not offered in the dropdown.
const SELECTABLE_ACTIONS: MatchAction[] = ["link", "create", "skip"];
```
In the action `<select>`, render `SELECTABLE_ACTIONS`, and when the current decision is still `needs_review`, render a leading disabled option so the unresolved state is visible:
```tsx
                  >
                    {decision.action === "needs_review" && (
                      <option value="needs_review" disabled>
                        {t("qbo.action.needs_review")}
                      </option>
                    )}
                    {SELECTABLE_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {t(`qbo.action.${a}`)}
                      </option>
                    ))}
                  </select>
```

- [ ] **Step 3b: Contact sub-line + jobs marker**

Replace the name cell (`resolveName`) with a stacked label: company on top, contact beneath. The contact NAME is a **raw JSX child** (so the test's key-returning i18n mock still surfaces it); only the static "Contact" label goes through `t()`:
```tsx
                <td className="px-1.5 py-1 max-w-[220px]">
                  <div className="font-mono text-caption text-text-2 truncate">
                    {m.companyName ?? m.displayName ?? m.customerQbId}
                  </div>
                  {m.companyName && m.contactName && (
                    <div className="font-mono text-caption-sm text-text-3 truncate">
                      <span className="text-text-mute">{t("qbo.customers.contactLabel")} </span>
                      {m.contactName}
                    </div>
                  )}
                </td>
```
(`resolveName` may be removed if now unused. The dict key is `qbo.customers.contactLabel` = "Contact:" — a static label, added in Task 9.)

- [ ] **Step 3c: Non-blocking jobs flag in the import tab**

In `quickbooks-import-tab.tsx`, in the review header near the reconciliation strip, render a non-blocking note when `stagedCounts.jobsDetected > 0`:
```tsx
            {stagedCounts.jobsDetected > 0 && (
              <p className="font-mono text-caption-sm text-text-3">
                {t("qbo.jobsDetected", { count: stagedCounts.jobsDetected })}
              </p>
            )}
```

- [ ] **Step 4: Update ALL match fixtures in this file, then run to verify pass**

- New `companyMatch` fixture: a full `QboCustomerMatch` with `companyName: "Acme Corp"`, `contactName: "John Smith"`, `proposedAction: "create"` (NOT `needs_review`). Do **not** add `isJob` — it is not a field on `QboCustomerMatch`.
- The two EXISTING fixtures ("Sonnenschein Family Store", "Adwin Ko") must each gain `companyName: null, contactName: null` (Task 3 made them required) or tsc fails.

Run: `npx vitest run tests/unit/components/qbo-customer-match-table.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/accounting/qbo/customer-match-table.tsx src/components/accounting/qbo/quickbooks-import-tab.tsx tests/unit/components/qbo-customer-match-table.test.tsx
git commit -m "fix(qbo): show contact sub-line + jobs flag; stop offering needs_review as an action"
```

---

## Task 9: Fix i18n interpolation (the `{count}` bug) + add strings

**Files:**
- Modify: `src/i18n/client.tsx` (`t` in `useDictionary`)
- Modify: `src/i18n/dictionaries/en/accounting.json`, `src/i18n/dictionaries/es/accounting.json`
- Test: `tests/unit/i18n/client-interpolation.test.tsx` (new), `tests/unit/i18n/accounting-qbo-keys.test.ts` (extend)

**Root cause:** the client-side `t()` returns the dictionary string verbatim and never substitutes `{token}` params, so `{count}`/`{customers}` render literally across the whole QBO tab (`qbo.needsReviewBlock`, `qbo.applyConfirm`, `qbo.applied`, `qbo.notify.body`, `qbo.writeCallsFail`). Fix `t()` to interpolate when a params object is passed.

- [ ] **Step 1: Write the failing interpolation test**

```tsx
// tests/unit/i18n/client-interpolation.test.tsx
import { render, screen } from "@testing-library/react";
import { LanguageProvider, useDictionary } from "@/i18n/client";

function Probe() {
  const { t } = useDictionary("accounting");
  return <span>{t("qbo.needsReviewBlock", { count: 3 })}</span>;
}

it("interpolates {token} params in the client t()", async () => {
  render(
    <LanguageProvider locale="en">
      <Probe />
    </LanguageProvider>
  );
  expect(await screen.findByText(/Resolve 3 flagged customers/)).toBeInTheDocument();
  expect(screen.queryByText(/\{count\}/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/unit/i18n/client-interpolation.test.tsx`
Expected: FAIL — text still contains literal `{count}`.

- [ ] **Step 3: Add interpolation to `t()`**

In `src/i18n/client.tsx`, replace the `t` callback body with:

```ts
  const t = useCallback(
    (key: string, fallbackOrParams?: string | Record<string, unknown>) => {
      const value = dict[key];
      if (typeof value === "string") {
        // When a params object is passed, substitute {token} placeholders.
        // Unknown tokens are left intact so unrelated braces never break.
        if (fallbackOrParams && typeof fallbackOrParams === "object") {
          return value.replace(/\{(\w+)\}/g, (m, token) =>
            token in fallbackOrParams ? String(fallbackOrParams[token as string]) : m
          );
        }
        return value;
      }
      // Missing key: a string second arg is an English fallback; otherwise the key.
      if (typeof fallbackOrParams === "string") return fallbackOrParams;
      return key;
    },
    [dict]
  );
```

**Blast radius note:** `t()` is app-wide. This change only affects calls that pass an *object* whose target string contains `{token}` matching a provided key — i.e. exactly the intended-but-broken interpolations. Calls passing a string fallback, or no second arg, are unchanged.

- [ ] **Step 4: Add the new dictionary strings**

`en/accounting.json` — add (`contactLabel` is a static prefix; the name renders raw beside it. `jobsDetected` uses `{count}`, interpolated by the fixed `t()`):
```json
  "qbo.customers.contactLabel": "Contact:",
  "qbo.jobsDetected": "{count} QuickBooks jobs imported as individual clients (project linking comes later)."
```
`es/accounting.json` — add:
```json
  "qbo.customers.contactLabel": "Contacto:",
  "qbo.jobsDetected": "{count} trabajos de QuickBooks importados como clientes individuales (la vinculación de proyectos llega después)."
```
(Run final copy through `ops-copywriter` before merge — see Task 10. The English above is the working draft.)

- [ ] **Step 5: Extend the key-presence test**

```ts
// tests/unit/i18n/accounting-qbo-keys.test.ts — add the new keys to the asserted set
for (const key of ["qbo.customers.contactLabel", "qbo.jobsDetected"]) {
  expect(en[key], `en missing ${key}`).toBeTypeOf("string");
  expect(es[key], `es missing ${key}`).toBeTypeOf("string");
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/i18n/client-interpolation.test.tsx tests/unit/i18n/accounting-qbo-keys.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/client.tsx src/i18n/dictionaries/en/accounting.json src/i18n/dictionaries/es/accounting.json tests/unit/i18n/client-interpolation.test.tsx tests/unit/i18n/accounting-qbo-keys.test.ts
git commit -m "fix(i18n): interpolate {token} params in client t() (fixes qbo {count} literals)"
```

---

## Task 10: Full gate, copy pass, and finish

**Files:** none new (verification + finishing)

- [ ] **Step 1: Run the OPS copywriter over the new strings**

Invoke the `ops-copywriter` skill on `qbo.customers.contactLabel` and `qbo.jobsDetected` (terse, tactical, sentence case for content). Apply any revisions to both `en`/`es` and re-run the key test.

- [ ] **Step 2: Full type gate**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Full targeted test gate**

Run:
```bash
npx vitest run qbo normalize accounting i18n quickbooks sub_client
```
Expected: all QBO/i18n/accounting suites PASS.

- [ ] **Step 4: Confirm read-only guarantee is intact**

Grep the diff to prove no QB write path was added and `qb_write_calls` logic is untouched:
```bash
git diff origin/main --stat
git grep -n "qb_write_calls" src/lib/api/services/quickbooks-import-service.ts
```
Expected: still asserts/records 0; no new `POST`/`create`/`update` calls to Intuit.

- [ ] **Step 5: Open the PR (squash to main; merge auto-builds Vercel, prod deploy is manual)**

```bash
git push -u origin feat/qbo-company-subclient
gh pr create --title "feat(qbo): company → client + contact → sub_client mapping (bug d6951b82)" \
  --body "Implements the locked customer-mapping design: QB CompanyName → parent clients row + sub_clients contact (qb_id-keyed, idempotent); individuals stay flat; QB Jobs recorded but not acted on. Also fixes the {count} i18n interpolation bug and removes needs_review from the selectable action dropdown. Additive migration 20260603100000 applied to prod (sentinel-guarded). Read-only guarantee unchanged (qb_write_calls=0)."
```
(Per project rules: pushing requires the user's go-ahead — confirm before Step 5. Merge via `gh pr merge --squash` after review.)

- [ ] **Step 6: Update the bible + memory**

- Update `ops-software-bible/07_SPECIALIZED_FEATURES.md` (QuickBooks sync section) to document the company→client + contact→sub_client mapping, the `sub_clients.qb_id` link, and the deferred-jobs behavior.
- Update memory `project_quickbooks_readonly_sync.md`: bug `d6951b82` implemented; note `sub_clients.qb_id` + 5 staging columns (migration `20260603100000`), match-by-CompanyName, and that the `{count}`/needs_review-dropdown small bugs are fixed.

---

## Self-Review

**Spec coverage (vs the bug d6951b82 brief + 3 decisions):**
- Company → parent client, person → sub_client → Tasks 2, 6 (via shared helpers). ✓
- Individuals stay flat → Task 2 branch + Task 6 individual test. ✓
- `sub_clients` fields (name/title/email/phone/address) → Task 6 (title deliberately null, documented). ✓
- Additive staging migration + `sub_clients.qb_id` → Task 1. ✓
- `applyImport` creates client + sub_client → Task 6. ✓
- **Webhook parity** → Task 6B (shared helpers; prevents batch-vs-webhook divergence). ✓
- Matching (company vs contact name) → Task 5 (decision 2: match by CompanyName). ✓
- Review UI → Tasks 7–8. ✓
- Decision 1 (invoices/payments → parent only): no `sub_client_id` added anywhere — confirmed by omission; resolution path untouched. ✓
- Decision 3 (jobs recorded, not acted on) → Task 1 columns + **Task 2 normalize suppresses job contacts** + Task 6 STEP 1b `!is_job` gate + Task 7 count excludes jobs + Task 8 flag. ✓
- Small bugs: `{count}` interpolation → Task 9; `needs_review` dropdown → Task 8. ✓

**Adversarial verification pass (2026-06-03):** a 7-dimension multi-agent verification ran each plan claim against `origin/main` + live Supabase, with independent skeptics confirming each finding. **All schema/migration/RLS/iOS-safety findings were refuted (architecture sound).** 17 confirmed defects were fixed inline:
- 🔴 **Webhook divergence** → new Task 6B + shared `clientFieldsFromCustomer`/`subClientFieldsFromCustomer` helpers (one source of truth).
- 🟠 **QB Jobs → junk sub_clients** (violated Decision 3) → normalize suppresses job-path/`is_job` contacts; STEP 1b + count exclude jobs; Job test asserts `contact_name === null`.
- **Required new type fields broke 4 existing typed literals** → Task 3 Step 3b updates all of them (qbo-import.test.ts ×3, qbo-apply-types.test.ts).
- **In-memory double had no `sub_clients`** (would `TypeError`) + wrong accessor (`db.tables`→`__db`) + missing staged fixtures → Task 6 Step 1 + corrected test snippets.
- **`buildStagedCounts` wrong arg shape** → Task 7 matches the real signature, ADDS `customerRows`, updates the existing call.
- **`mapCustomerMatch` `stagingByQbId` didn't exist** → Task 7 Step 4 replaces the display-name map with a full-row map + signature change.
- **Component test `t()` mock ignores params** → Task 8 renders the contact name as a raw JSX child (matches under the existing mock).
- **Task 4 "see fixture" pointed at a nonexistent record** → inline company customer via `mockResolvedValueOnce`.

**Placeholder scan:** No TBD/TODO. Remaining "reuse the suite's existing identifiers / read the file first" notes (Task 4/6/6B test harnesses) are genuine pre-reqs — the in-memory doubles' local variable names aren't in this plan's context — but every test/impl code block is complete and the required harness changes (add `sub_clients`, use `__db`) are stated explicitly.

**Type consistency:** `subClientsCreated` (QboApplyResult, Task 3 & 6), `subClientsToCreate`/`jobsDetected` (QboStagedCounts, Task 3 & 7), `companyName`/`contactName` (QboCustomerMatch, Task 3, 7, 8), the snake `company_name`/`contact_name`/`contact_title`/`parent_qb_id`/`is_job` columns (staged DB rows, Task 1/4) ↔ `CustomerShape` (the shared-helper input, Task 2) ↔ camel `QboStagedCustomer` (type test only). The shared helpers mean Task 6 and Task 6B emit identical `clients`/`sub_clients` shapes by construction. `qbo.customers.contactLabel` (static) is consistent between Task 8 render and Task 9 dict.
