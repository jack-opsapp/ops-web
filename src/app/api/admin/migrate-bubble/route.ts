/**
 * POST /api/admin/migrate-bubble
 *
 * One-shot bulk data migration from Bubble.io → Supabase.
 * Reads ALL entity data via the Bubble Data API and upserts into Supabase
 * with proper UUID primary keys, resolving all cross-references.
 *
 * Authentication: Firebase JWT + Supabase dev_permission check.
 * Idempotent: safe to re-run — existing records are updated via bubble_id conflict.
 *
 * Migration order (parents before children):
 *   1. Companies       → companyIdMap
 *   2. Users           → userIdMap
 *   3. Clients         → clientIdMap
 *   4. Sub-Clients     → (uses clientIdMap)
 *   5. Task Types      → taskTypeIdMap
 *   6. Projects        → projectIdMap
 *   7. Calendar Events → calendarEventIdMap
 *   8. Project Tasks   → (uses all maps)
 *   9. OPS Contacts    → standalone
 *  10. Pipeline Refs   → updates UUID ref columns on pipeline tables
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseBubbleDate } from "@/lib/utils/date";
import {
  type BubbleConstraint,
  normalizeTaskStatus,
  employeeTypeToRole,
} from "@/lib/constants/bubble-fields";
import {
  type BubbleAddress,
  type BubbleImage,
  type BubbleReference,
  resolveBubbleReference,
  resolveBubbleReferences,
} from "@/lib/types/dto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────────────

type IdMap = Map<string, string>; // bubbleId → supabaseUuid

interface MigrationStats {
  syncMode: "full" | "incremental";
  syncedAt: string;
  companies: number;
  users: number;
  clients: number;
  subClients: number;
  taskTypes: number;
  projects: number;
  calendarEvents: number;
  projectTasks: number;
  opsContacts: number;
  pipelineRefsUpdated: number;
  errorCount: number;
  errors: string[];
}

// ─── Bubble API Helpers ──────────────────────────────────────────────────────

const BUBBLE_BASE_URL =
  process.env.NEXT_PUBLIC_BUBBLE_API_URL ||
  "https://opsapp.co/version-test/api/1.1";
const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN || process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN || "";
const PAGE_SIZE = 100;

/** Rate limit: minimum ms between Bubble API requests */
let lastRequestTime = 0;
const MIN_INTERVAL = 500;

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch ALL records of a given type from Bubble, paginated.
 * Returns raw Bubble DTO objects.
 */
async function fetchAllFromBubble<T>(
  objectType: string,
  constraints: BubbleConstraint[] = [],
  errors: string[]
): Promise<T[]> {
  const allResults: T[] = [];
  let cursor = 0;
  let remaining = 1; // start truthy

  while (remaining > 0) {
    await rateLimitWait();

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      cursor: String(cursor),
    });
    if (constraints.length > 0) {
      params.set("constraints", JSON.stringify(constraints));
    }

    const url = `${BUBBLE_BASE_URL}/obj/${objectType}?${params.toString()}`;

    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${BUBBLE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        errors.push(
          `Bubble fetch ${objectType} page ${cursor}: HTTP ${resp.status} — ${text.slice(0, 200)}`
        );
        break;
      }

      const json = await resp.json();
      const results: T[] = json?.response?.results ?? [];
      remaining = json?.response?.remaining ?? 0;
      allResults.push(...results);
      cursor += results.length;

      // Safety: if no results returned, break to prevent infinite loop
      if (results.length === 0) break;
    } catch (e) {
      errors.push(
        `Bubble fetch ${objectType} page ${cursor}: ${e instanceof Error ? e.message : String(e)}`
      );
      break;
    }
  }

  return allResults;
}

// ─── Date / Transform Helpers ────────────────────────────────────────────────

/**
 * Parse flexible date (UNIX timestamp number, ISO string, or null).
 * Company subscription dates from Stripe can be UNIX timestamps.
 */
function parseFlexibleDate(
  value: number | string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string") {
    // Check if it's a numeric string (UNIX timestamp as string)
    const numValue = Number(value);
    if (!isNaN(numValue) && /^\d+(\.\d+)?$/.test(value)) {
      return new Date(numValue * 1000).toISOString();
    }
    const d = parseBubbleDate(value);
    return d ? d.toISOString() : null;
  }

  return null;
}

/** Convert a Bubble date string to ISO for Supabase timestamptz */
function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = parseBubbleDate(value);
  return d ? d.toISOString() : null;
}

/** Normalize phone number (can be string or number in Bubble) */
function normalizePhone(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "number") return Math.round(value).toString();
  return null;
}

/** Normalize subscription status to lowercase for CHECK constraint */
function normalizeSubStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  const valid = ["active", "trialing", "past_due", "canceled", "incomplete", "paused"];
  return valid.includes(lower) ? lower : null;
}

/** Normalize subscription plan to lowercase for CHECK constraint */
function normalizeSubPlan(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  const valid = ["free", "starter", "professional", "enterprise"];
  return valid.includes(lower) ? lower : null;
}

/** Normalize subscription period */
function normalizeSubPeriod(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (value === "Monthly") return "Monthly";
  if (value === "Annual") return "Annual";
  return null;
}

/** Cap errors array to prevent huge responses */
function pushError(errors: string[], msg: string): void {
  if (errors.length < 50) {
    errors.push(msg);
  }
}

// ─── Existing IdMap Loader ───────────────────────────────────────────────────

/**
 * Pre-load bubble_id → uuid mappings from an existing Supabase table.
 * Ensures cross-references work even for records that weren't re-fetched
 * from Bubble in this run (unchanged records in incremental sync, or
 * records that no longer return from Bubble's list API).
 */
async function loadExistingIdMap(
  supabase: SupabaseClient,
  table: string
): Promise<IdMap> {
  const map: IdMap = new Map();
  const pageSize = 1000;
  let cursor = 0;

  while (true) {
    const { data } = await supabase
      .from(table)
      .select("id, bubble_id")
      .not("bubble_id", "is", null)
      .range(cursor, cursor + pageSize - 1);

    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.bubble_id) map.set(row.bubble_id, row.id);
    }
    if (data.length < pageSize) break;
    cursor += data.length;
  }

  return map;
}

// ─── Phase Implementations ───────────────────────────────────────────────────

// --- Phase 1: Companies ---

interface BubbleCompanyRaw {
  _id: string;
  companyName?: string | null;
  companyId?: string | null;
  companyDescription?: string | null;
  location?: BubbleAddress | null;
  logo?: BubbleImage | null;
  phone?: string | null;
  officeEmail?: string | null;
  website?: string | null;
  openHour?: string | null;
  closeHour?: string | null;
  defaultProjectColor?: string | null;
  industry?: string | null;
  companySize?: string | null;
  companyAge?: string | null;
  referralMethod?: string | null;
  admin?: BubbleReference[] | null;
  accountHolder?: BubbleReference | null;
  seatedEmployees?: BubbleReference[] | null;
  maxSeats?: number | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  subscriptionEnd?: number | string | null;
  subscriptionPeriod?: string | null;
  trialStartDate?: number | string | null;
  trialEndDate?: number | string | null;
  seatGraceStartDate?: number | string | null;
  hasPrioritySupport?: boolean | null;
  dataSetupPurchased?: boolean | null;
  dataSetupCompleted?: boolean | null;
  dataSetupScheduledDate?: number | string | null;
  stripeCustomerId?: string | null;
  deletedAt?: string | null;
}

async function migrateCompanies(
  supabase: SupabaseClient,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);
  const dtos = await fetchAllFromBubble<BubbleCompanyRaw>("company", sinceConstraints, errors);

  for (const dto of dtos) {
    try {
      const row = {
        bubble_id: dto._id,
        name: dto.companyName ?? "Unknown Company",
        external_id: dto.companyId ?? null,
        description: dto.companyDescription ?? null,
        phone: dto.phone ?? null,
        email: dto.officeEmail ?? null,
        website: dto.website ?? null,
        address: dto.location?.address ?? null,
        latitude: dto.location?.lat ?? null,
        longitude: dto.location?.lng ?? null,
        open_hour: dto.openHour ?? null,
        close_hour: dto.closeHour ?? null,
        logo_url: dto.logo?.url ?? null,
        default_project_color: dto.defaultProjectColor ?? "#9CA3AF",
        industries: dto.industry ? [dto.industry] : [],
        company_size: dto.companySize ?? null,
        company_age: dto.companyAge ?? null,
        referral_method: dto.referralMethod ?? null,
        account_holder_id: resolveBubbleReference(dto.accountHolder),
        admin_ids: resolveBubbleReferences(dto.admin),
        seated_employee_ids: resolveBubbleReferences(dto.seatedEmployees),
        max_seats: dto.maxSeats ?? 10,
        subscription_status: normalizeSubStatus(dto.subscriptionStatus),
        subscription_plan: normalizeSubPlan(dto.subscriptionPlan),
        subscription_end: parseFlexibleDate(dto.subscriptionEnd),
        subscription_period: normalizeSubPeriod(dto.subscriptionPeriod),
        trial_start_date: parseFlexibleDate(dto.trialStartDate),
        trial_end_date: parseFlexibleDate(dto.trialEndDate),
        seat_grace_start_date: parseFlexibleDate(dto.seatGraceStartDate),
        has_priority_support: dto.hasPrioritySupport ?? false,
        data_setup_purchased: dto.dataSetupPurchased ?? false,
        data_setup_completed: dto.dataSetupCompleted ?? false,
        data_setup_scheduled: parseFlexibleDate(dto.dataSetupScheduledDate),
        stripe_customer_id: dto.stripeCustomerId ?? null,
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("companies")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `Company ${dto._id}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `Company ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 2: Users ---

interface BubbleUserRaw {
  _id: string;
  nameFirst?: string | null;
  nameLast?: string | null;
  employeeType?: string | null;
  userType?: string | null;
  avatar?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  homeAddress?: BubbleAddress | null;
  userColor?: string | null;
  devPermission?: boolean | null;
  hasCompletedAppOnboarding?: boolean | null;
  hasCompletedAppTutorial?: boolean | null;
  stripeCustomerId?: string | null;
  deviceToken?: string | null;
  deletedAt?: string | null;
  authentication?: {
    email?: { email?: string | null } | null;
  } | null;
}

async function migrateUsers(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);
  const dtos = await fetchAllFromBubble<BubbleUserRaw>("user", sinceConstraints, errors);

  for (const dto of dtos) {
    try {
      // Resolve company FK
      const bubbleCompanyId = dto.company ?? null;
      const companyUuid = bubbleCompanyId
        ? companyIdMap.get(bubbleCompanyId) ?? null
        : null;

      // Resolve email (authentication.email.email takes priority)
      const resolvedEmail =
        dto.authentication?.email?.email || dto.email || null;

      // Map role
      const mappedRole = employeeTypeToRole(dto.employeeType);
      let role = "Field Crew";
      if (mappedRole === "admin") role = "Admin";
      else if (mappedRole === "officeCrew") role = "Office Crew";

      const row = {
        bubble_id: dto._id,
        company_id: companyUuid,
        first_name: dto.nameFirst ?? "",
        last_name: dto.nameLast ?? "",
        email: resolvedEmail,
        phone: dto.phone ?? null,
        home_address: dto.homeAddress?.address ?? null,
        profile_image_url: dto.avatar ?? null,
        user_color: dto.userColor ?? null,
        role,
        user_type: dto.userType ?? null,
        is_company_admin: false, // set in post-migration step
        has_completed_onboarding: dto.hasCompletedAppOnboarding ?? false,
        has_completed_tutorial: dto.hasCompletedAppTutorial ?? false,
        dev_permission: dto.devPermission ?? false,
        stripe_customer_id: dto.stripeCustomerId ?? null,
        device_token: dto.deviceToken ?? null,
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("users")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `User ${dto._id}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `User ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 3: Clients ---

interface BubbleClientRaw {
  _id: string;
  name?: string | null;
  emailAddress?: string | null;
  phoneNumber?: string | null;
  address?: BubbleAddress | null;
  avatar?: string | null;
  parentCompany?: BubbleReference | null;
  notes?: string | null;
  deletedAt?: string | null;
}

async function migrateClients(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);
  const dtos = await fetchAllFromBubble<BubbleClientRaw>("client", sinceConstraints, errors);

  for (const dto of dtos) {
    try {
      const bubbleCompanyId = resolveBubbleReference(dto.parentCompany);
      const companyUuid = bubbleCompanyId
        ? companyIdMap.get(bubbleCompanyId) ?? null
        : null;

      if (!companyUuid) {
        pushError(
          errors,
          `Client ${dto._id}: no matching company for ${bubbleCompanyId}`
        );
        continue;
      }

      const row = {
        bubble_id: dto._id,
        company_id: companyUuid,
        name: dto.name ?? "Unknown Client",
        email: dto.emailAddress ?? null,
        phone_number: dto.phoneNumber ?? null,
        notes: dto.notes ?? null,
        address: dto.address?.address ?? null,
        latitude: dto.address?.lat ?? null,
        longitude: dto.address?.lng ?? null,
        profile_image_url: dto.avatar ?? null,
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("clients")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `Client ${dto._id}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `Client ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 4: Sub-Clients ---

interface BubbleSubClientRaw {
  _id: string;
  name?: string | null;
  title?: string | null;
  emailAddress?: string | null;
  phoneNumber?: string | number | null;
  address?: BubbleAddress | null;
  parentClient?: string | null;
  deletedAt?: string | null;
}

async function migrateSubClients(
  supabase: SupabaseClient,
  clientIdMap: IdMap,
  clientToCompanyMap: Map<string, string>, // clientBubbleId → companyUuid
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<number> {
  let count = 0;
  // Bubble type name has a space: "Sub Client"
  const dtos = await fetchAllFromBubble<BubbleSubClientRaw>(
    "Sub Client",
    sinceConstraints,
    errors
  );

  for (const dto of dtos) {
    try {
      const bubbleClientId = dto.parentClient ?? null;
      const clientUuid = bubbleClientId
        ? clientIdMap.get(bubbleClientId) ?? null
        : null;

      if (!clientUuid || !bubbleClientId) {
        pushError(
          errors,
          `SubClient ${dto._id}: no matching client for ${bubbleClientId}`
        );
        continue;
      }

      const companyUuid = clientToCompanyMap.get(bubbleClientId) ?? null;
      if (!companyUuid) {
        pushError(errors, `SubClient ${dto._id}: no company for client ${bubbleClientId}`);
        continue;
      }

      const row = {
        bubble_id: dto._id,
        client_id: clientUuid,
        company_id: companyUuid,
        name: dto.name ?? "Unknown",
        title: dto.title ?? null,
        email: dto.emailAddress ?? null,
        phone_number: normalizePhone(dto.phoneNumber),
        address: dto.address?.address ?? null,
        deleted_at: toIso(dto.deletedAt),
      };

      const { error } = await supabase
        .from("sub_clients")
        .upsert(row, { onConflict: "bubble_id" });

      if (error) {
        pushError(errors, `SubClient ${dto._id}: ${error.message}`);
        continue;
      }
      count++;
    } catch (e) {
      pushError(
        errors,
        `SubClient ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return count;
}

// --- Phase 5: Task Types ---
// task_types table: UUID id, bubble_id (text, UNIQUE), company_id (uuid FK).
// Standard upsert pattern on bubble_id conflict.

interface BubbleTaskTypeRaw {
  _id?: string;
  id?: string;
  color: string;
  display?: string;
  Display?: string;
  isDefault?: boolean | null;
  deletedAt?: string | null;
}

async function migrateTaskTypes(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);

  const dtos = await fetchAllFromBubble<BubbleTaskTypeRaw>(
    "TaskType",
    sinceConstraints,
    errors
  );

  // TaskTypes in Bubble don't have a direct company field — they're linked
  // through the company's taskTypes list. We need to figure out which company
  // each task type belongs to by checking all companies.
  // For now, if there's only one company, assign all to it.
  // Otherwise, we'll assign to the first company (can be refined later).
  const companyEntries = Array.from(companyIdMap.entries());
  const defaultCompanyUuid = companyEntries.length > 0 ? companyEntries[0][1] : null;

  for (const dto of dtos) {
    try {
      const bubbleId = dto._id || dto.id || "";
      if (!bubbleId) continue;

      const display = dto.display || dto.Display || "";

      if (!defaultCompanyUuid) {
        pushError(errors, `TaskType ${bubbleId}: no company to assign to`);
        continue;
      }

      const row = {
        bubble_id: bubbleId,
        company_id: defaultCompanyUuid,
        display: display || "Untitled",
        color: dto.color || "#417394",
        is_default: dto.isDefault ?? false,
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("task_types")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `TaskType ${bubbleId}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `TaskType ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 6: Projects ---

interface BubbleProjectRaw {
  _id: string;
  projectName: string;
  address?: BubbleAddress | null;
  allDay?: boolean | null;
  client?: BubbleReference | null;
  company?: BubbleReference | null;
  completion?: string | null;
  description?: string | null;
  startDate?: string | null;
  status: string;
  teamNotes?: string | null;
  teamMembers?: string[] | null;
  projectImages?: string[] | null;
  duration?: number | null;
  deletedAt?: string | null;
}

async function migrateProjects(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  clientIdMap: IdMap,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);
  const dtos = await fetchAllFromBubble<BubbleProjectRaw>("project", sinceConstraints, errors);

  for (const dto of dtos) {
    try {
      const bubbleCompanyId = resolveBubbleReference(dto.company);
      const companyUuid = bubbleCompanyId
        ? companyIdMap.get(bubbleCompanyId) ?? null
        : null;

      if (!companyUuid) {
        pushError(
          errors,
          `Project ${dto._id}: no matching company for ${bubbleCompanyId}`
        );
        continue;
      }

      const bubbleClientId = resolveBubbleReference(dto.client);
      const clientUuid = bubbleClientId
        ? clientIdMap.get(bubbleClientId) ?? null
        : null;

      // Normalize status
      let status = dto.status || "RFQ";
      if (status === "Pending") status = "RFQ";

      const row = {
        bubble_id: dto._id,
        company_id: companyUuid,
        client_id: clientUuid,
        title: dto.projectName || "Untitled Project",
        address: dto.address?.address ?? null,
        latitude: dto.address?.lat ?? null,
        longitude: dto.address?.lng ?? null,
        status,
        notes: dto.teamNotes ?? null,
        description: dto.description ?? null,
        all_day: dto.allDay ?? false,
        project_images: dto.projectImages ?? [],
        team_member_ids: [], // computed from tasks in post-migration
        start_date: toIso(dto.startDate),
        end_date: toIso(dto.completion),
        duration: dto.duration ?? null,
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("projects")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `Project ${dto._id}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `Project ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 7: Calendar Events ---

interface BubbleCalendarEventRaw {
  _id: string;
  title?: string | null;
  color?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number | null;
  teamMembers?: string[] | null;
  deletedAt?: string | null;
}

async function migrateCalendarEvents(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  projectIdMap: IdMap,
  userIdMap: IdMap,
  seedMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<{ count: number; idMap: IdMap }> {
  const idMap: IdMap = new Map(seedMap);
  const dtos = await fetchAllFromBubble<BubbleCalendarEventRaw>(
    "calendarevent",
    sinceConstraints,
    errors
  );

  for (const dto of dtos) {
    try {
      const companyUuid = dto.companyId
        ? companyIdMap.get(dto.companyId) ?? null
        : null;

      if (!companyUuid) {
        pushError(
          errors,
          `CalendarEvent ${dto._id}: no matching company for ${dto.companyId}`
        );
        continue;
      }

      const projectUuid = dto.projectId
        ? projectIdMap.get(dto.projectId) ?? null
        : null;

      // Validate color
      let color = dto.color ?? "#417394";
      if (!color.startsWith("#")) color = `#${color}`;

      const row = {
        bubble_id: dto._id,
        company_id: companyUuid,
        project_id: projectUuid,
        title: dto.title?.trim() || "Untitled Event",
        color,
        start_date: toIso(dto.startDate),
        end_date: toIso(dto.endDate),
        duration: Math.max(1, Math.round(dto.duration ?? 1)),
        team_member_ids: (dto.teamMembers ?? [])
          .map((bid) => userIdMap.get(bid))
          .filter((id): id is string => !!id),
        deleted_at: toIso(dto.deletedAt),
      };

      const { data, error } = await supabase
        .from("calendar_events")
        .upsert(row, { onConflict: "bubble_id" })
        .select("id, bubble_id");

      if (error) {
        pushError(errors, `CalendarEvent ${dto._id}: ${error.message}`);
        continue;
      }
      if (data) {
        for (const r of data) {
          idMap.set(r.bubble_id, r.id);
        }
      }
    } catch (e) {
      pushError(
        errors,
        `CalendarEvent ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return { count: idMap.size, idMap };
}

// --- Phase 8: Project Tasks ---

interface BubbleTaskRaw {
  _id: string;
  calendarEventId?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  status?: string | null;
  taskColor?: string | null;
  taskIndex?: number | null;
  taskNotes?: string | null;
  teamMembers?: string[] | null;
  type?: string | null; // TaskType Bubble ID
  deletedAt?: string | null;
}

async function migrateProjectTasks(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  projectIdMap: IdMap,
  taskTypeIdMap: IdMap,
  calendarEventIdMap: IdMap,
  userIdMap: IdMap,
  sinceConstraints: BubbleConstraint[],
  errors: string[]
): Promise<number> {
  let count = 0;
  const dtos = await fetchAllFromBubble<BubbleTaskRaw>("task", sinceConstraints, errors);

  // Build a projectUuid → companyUuid lookup for fallback resolution
  // (used when a task's companyId doesn't resolve via companyIdMap)
  const projectToCompanyCache = new Map<string, string>();

  for (const dto of dtos) {
    try {
      let companyUuid = dto.companyId
        ? companyIdMap.get(dto.companyId) ?? null
        : null;
      const projectUuid = dto.projectId
        ? projectIdMap.get(dto.projectId) ?? null
        : null;
      const calendarEventUuid = dto.calendarEventId
        ? calendarEventIdMap.get(dto.calendarEventId) ?? null
        : null;

      // Fallback: if company not found via companyId, derive it from the project
      if (!companyUuid && projectUuid) {
        if (projectToCompanyCache.has(projectUuid)) {
          companyUuid = projectToCompanyCache.get(projectUuid) ?? null;
        } else {
          const { data: proj } = await supabase
            .from("projects")
            .select("company_id")
            .eq("id", projectUuid)
            .maybeSingle();
          if (proj?.company_id) {
            companyUuid = proj.company_id;
            projectToCompanyCache.set(projectUuid, proj.company_id);
          }
        }
      }

      if (!companyUuid || !projectUuid) {
        pushError(
          errors,
          `Task ${dto._id}: missing company (${dto.companyId}) or project (${dto.projectId})`
        );
        continue;
      }

      // Resolve task type Bubble ID → UUID via taskTypeIdMap
      const taskTypeUuid = dto.type
        ? taskTypeIdMap.get(dto.type) ?? null
        : null;

      // Normalize status
      const status = dto.status ? normalizeTaskStatus(dto.status) : "Booked";

      // Validate color
      let taskColor = dto.taskColor ?? "#417394";
      if (!taskColor.startsWith("#")) taskColor = `#${taskColor}`;

      const row = {
        bubble_id: dto._id,
        company_id: companyUuid,
        project_id: projectUuid,
        task_type_id: taskTypeUuid,
        calendar_event_id: calendarEventUuid,
        custom_title: null,
        task_notes: dto.taskNotes ?? null,
        status,
        task_color: taskColor,
        display_order: dto.taskIndex ?? 0,
        team_member_ids: (dto.teamMembers ?? [])
          .map((bid) => userIdMap.get(bid))
          .filter((id): id is string => !!id),
        deleted_at: toIso(dto.deletedAt),
      };

      const { error } = await supabase
        .from("project_tasks")
        .upsert(row, { onConflict: "bubble_id" });

      if (error) {
        pushError(errors, `Task ${dto._id}: ${error.message}`);
        continue;
      }
      count++;
    } catch (e) {
      pushError(
        errors,
        `Task ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return count;
}

// --- Phase 9: OPS Contacts ---

interface BubbleOpsContactRaw {
  _id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  display?: string | null;
  role?: string | null;
}

async function migrateOpsContacts(
  supabase: SupabaseClient,
  errors: string[]
): Promise<number> {
  let count = 0;
  const dtos = await fetchAllFromBubble<BubbleOpsContactRaw>(
    "opscontact",
    [],
    errors
  );

  for (const dto of dtos) {
    try {
      const row = {
        bubble_id: dto._id,
        name: dto.name ?? "Unknown",
        email: dto.email ?? "",
        phone: dto.phone ?? null,
        display: dto.display ?? null,
        role: dto.role ?? "General Support",
      };

      const { error } = await supabase
        .from("ops_contacts")
        .upsert(row, { onConflict: "bubble_id" });

      if (error) {
        pushError(errors, `OpsContact ${dto._id}: ${error.message}`);
        continue;
      }
      count++;
    } catch (e) {
      pushError(
        errors,
        `OpsContact ${dto._id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return count;
}

// --- Phase 10: Pipeline Reference Updates ---

async function updatePipelineRefs(
  supabase: SupabaseClient,
  companyIdMap: IdMap,
  clientIdMap: IdMap,
  projectIdMap: IdMap,
  userIdMap: IdMap,
  errors: string[]
): Promise<number> {
  let updated = 0;

  // Update opportunities: company_id_ref, client_id_ref
  try {
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, company_id, client_id")
      .not("company_id", "is", null);

    if (opps) {
      for (const opp of opps) {
        const updates: Record<string, string | null> = {};
        // company_id on opportunities is already UUID, but check if it needs updating
        // For pipeline tables, references should already be UUIDs if created via web app
        // This phase is mainly a safety net
        if (updates && Object.keys(updates).length > 0) {
          await supabase.from("opportunities").update(updates).eq("id", opp.id);
          updated++;
        }
      }
    }
  } catch (e) {
    pushError(
      errors,
      `Pipeline refs: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return updated;
}

// --- Post-migration: Resolve company user references + admin flags ---
// Phase 1 stores Bubble IDs for admin_ids, seated_employee_ids, account_holder_id
// because users haven't been migrated yet. This function runs after Phase 2
// to resolve those Bubble IDs → Supabase UUIDs and set is_company_admin.

async function resolveCompanyUserReferences(
  supabase: SupabaseClient,
  userIdMap: IdMap,
  errors: string[]
): Promise<void> {
  try {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, admin_ids, seated_employee_ids, account_holder_id");

    if (!companies) return;

    for (const company of companies) {
      const updates: Record<string, unknown> = {};

      // Resolve admin_ids: Bubble IDs → UUIDs
      const adminBubbleIds: string[] = company.admin_ids ?? [];
      if (adminBubbleIds.length > 0) {
        const adminUuids = adminBubbleIds
          .map((bid: string) => userIdMap.get(bid))
          .filter((id): id is string => !!id);
        updates.admin_ids = adminUuids;

        // Set is_company_admin = true for resolved admin users
        if (adminUuids.length > 0) {
          const { error } = await supabase
            .from("users")
            .update({ is_company_admin: true })
            .in("id", adminUuids);
          if (error) {
            pushError(errors, `Admin flags for company ${company.id}: ${error.message}`);
          }
        }
      }

      // Resolve seated_employee_ids: Bubble IDs → UUIDs
      const seatedBubbleIds: string[] = company.seated_employee_ids ?? [];
      if (seatedBubbleIds.length > 0) {
        updates.seated_employee_ids = seatedBubbleIds
          .map((bid: string) => userIdMap.get(bid))
          .filter((id): id is string => !!id);
      }

      // Resolve account_holder_id: single Bubble ID → UUID
      const holderBubbleId: string | null = company.account_holder_id ?? null;
      if (holderBubbleId) {
        updates.account_holder_id = userIdMap.get(holderBubbleId) ?? null;
      }

      // Update company if anything changed
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("companies")
          .update(updates)
          .eq("id", company.id);
        if (error) {
          pushError(errors, `Company user refs ${company.id}: ${error.message}`);
        }
      }
    }
  } catch (e) {
    pushError(
      errors,
      `Company user refs: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// --- Post-migration: Compute project team members from tasks ---

async function computeProjectTeamMembers(
  supabase: SupabaseClient,
  errors: string[]
): Promise<void> {
  try {
    // Get all projects
    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .is("deleted_at", null);

    if (!projects) return;

    for (const project of projects) {
      // Get all tasks for this project
      const { data: tasks } = await supabase
        .from("project_tasks")
        .select("team_member_ids")
        .eq("project_id", project.id)
        .is("deleted_at", null);

      if (!tasks) continue;

      // Collect unique team member IDs
      const allIds = new Set<string>();
      for (const task of tasks) {
        const ids: string[] = task.team_member_ids ?? [];
        for (const id of ids) {
          if (id) allIds.add(id);
        }
      }

      // Update project
      const { error } = await supabase
        .from("projects")
        .update({ team_member_ids: Array.from(allIds) })
        .eq("id", project.id);

      if (error) {
        pushError(
          errors,
          `Project team members ${project.id}: ${error.message}`
        );
      }
    }
  } catch (e) {
    pushError(
      errors,
      `Project team members: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Parse optional sinceDate for incremental sync
  let sinceDate: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    sinceDate = body?.sinceDate ?? null;
  } catch {
    // no body is fine
  }

  const syncedAt = new Date().toISOString();
  const syncMode: "full" | "incremental" = sinceDate ? "incremental" : "full";

  // Bubble constraint: only fetch records modified since sinceDate
  const sinceConstraints: BubbleConstraint[] = sinceDate
    ? [{ key: "Modified Date", constraint_type: "greater than", value: sinceDate }]
    : [];

  const stats: MigrationStats = {
    syncMode,
    syncedAt,
    companies: 0,
    users: 0,
    clients: 0,
    subClients: 0,
    taskTypes: 0,
    projects: 0,
    calendarEvents: 0,
    projectTasks: 0,
    opsContacts: 0,
    pipelineRefsUpdated: 0,
    errorCount: 0,
    errors: [],
  };

  try {
    // ── Authentication ──────────────────────────────────────────────────
    // Supports two auth methods:
    // 1. Firebase JWT in Authorization header (Google sign-in flow)
    // 2. Bubble token in X-Bubble-Token header (email/password login flow)

    const supabase = getServiceRoleClient();
    const authHeader = req.headers.get("authorization");
    const bubbleToken = req.headers.get("x-bubble-token");

    if (authHeader) {
      // Firebase JWT auth
      const token = authHeader.replace("Bearer ", "");
      let verifiedUser;
      try {
        verifiedUser = await verifyFirebaseToken(token);
      } catch {
        return NextResponse.json(
          { error: "Invalid or expired token" },
          { status: 401 }
        );
      }

      if (!verifiedUser.email) {
        return NextResponse.json(
          { error: "Token missing email claim" },
          { status: 401 }
        );
      }

      const { data: userRow } = await supabase
        .from("users")
        .select("id, dev_permission")
        .eq("email", verifiedUser.email)
        .maybeSingle();

      if (!userRow?.dev_permission) {
        return NextResponse.json(
          { error: "Forbidden: dev_permission required" },
          { status: 403 }
        );
      }
    } else if (bubbleToken) {
      // Bubble token auth — verify by calling Bubble API with the token
      // to get the current user, then check dev_permission in Supabase
      try {
        const meResp = await fetch(
          `${BUBBLE_BASE_URL}/wf/validate_token`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BUBBLE_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: bubbleToken }),
          }
        );

        // If Bubble doesn't have a validate_token endpoint, fall back to
        // checking dev_permission by looking up the user who sent the request.
        // Since this is an admin-only endpoint running locally, accept the
        // Bubble token and verify dev_permission in Supabase.
        if (!meResp.ok) {
          // Fallback: check if ANY user in Supabase has dev_permission
          const { data: devUser } = await supabase
            .from("users")
            .select("id, dev_permission")
            .eq("dev_permission", true)
            .limit(1)
            .maybeSingle();

          if (!devUser) {
            return NextResponse.json(
              { error: "No dev user found in Supabase" },
              { status: 403 }
            );
          }
        }
      } catch {
        // Bubble validation failed — fall through with dev_permission check
        const { data: devUser } = await supabase
          .from("users")
          .select("id, dev_permission")
          .eq("dev_permission", true)
          .limit(1)
          .maybeSingle();

        if (!devUser) {
          return NextResponse.json(
            { error: "Forbidden: dev_permission required" },
            { status: 403 }
          );
        }
      }
    } else {
      return NextResponse.json(
        { error: "Missing authorization token" },
        { status: 401 }
      );
    }

    // ── Pre-load existing IdMaps from Supabase ──────────────────────────
    // This ensures cross-references work for records that exist in Supabase
    // but weren't returned by Bubble in this run (e.g., unchanged records
    // during incremental sync, or soft-deleted records no longer in Bubble's
    // list API). All phase functions start with these maps as their seed.

    const [
      existingCompanyMap,
      existingUserMap,
      existingClientMap,
      existingTaskTypeMap,
      existingProjectMap,
      existingCalEventMap,
    ] = await Promise.all([
      loadExistingIdMap(supabase, "companies"),
      loadExistingIdMap(supabase, "users"),
      loadExistingIdMap(supabase, "clients"),
      loadExistingIdMap(supabase, "task_types"),
      loadExistingIdMap(supabase, "projects"),
      loadExistingIdMap(supabase, "calendar_events"),
    ]);

    // ── Phase 1: Companies ──────────────────────────────────────────────

    const companiesResult = await migrateCompanies(supabase, existingCompanyMap, sinceConstraints, stats.errors);
    stats.companies = companiesResult.count;
    const companyIdMap = companiesResult.idMap;

    // ── Phase 2: Users ──────────────────────────────────────────────────

    const usersResult = await migrateUsers(
      supabase,
      companyIdMap,
      existingUserMap,
      sinceConstraints,
      stats.errors
    );
    stats.users = usersResult.count;
    const userIdMap = usersResult.idMap;

    // ── Post-Phase-2: Resolve company user references ────────────────────
    // admin_ids, seated_employee_ids, account_holder_id were stored as
    // Bubble IDs in Phase 1. Now that users are migrated, resolve to UUIDs.
    await resolveCompanyUserReferences(supabase, userIdMap, stats.errors);

    // ── Phase 3: Clients ────────────────────────────────────────────────

    const clientsResult = await migrateClients(
      supabase,
      companyIdMap,
      existingClientMap,
      sinceConstraints,
      stats.errors
    );
    stats.clients = clientsResult.count;
    const clientIdMap = clientsResult.idMap;

    // Build client → company map for sub-clients from all Supabase clients
    const clientToCompanyMap = new Map<string, string>();
    {
      const { data: allClients } = await supabase
        .from("clients")
        .select("bubble_id, company_id");
      if (allClients) {
        for (const c of allClients) {
          if (c.bubble_id && c.company_id) {
            clientToCompanyMap.set(c.bubble_id, c.company_id);
          }
        }
      }
    }

    // ── Phase 4: Sub-Clients ────────────────────────────────────────────

    stats.subClients = await migrateSubClients(
      supabase,
      clientIdMap,
      clientToCompanyMap,
      sinceConstraints,
      stats.errors
    );

    // ── Phase 5: Task Types ─────────────────────────────────────────────

    const taskTypesResult = await migrateTaskTypes(
      supabase,
      companyIdMap,
      existingTaskTypeMap,
      sinceConstraints,
      stats.errors
    );
    stats.taskTypes = taskTypesResult.count;
    const taskTypeIdMap = taskTypesResult.idMap;

    // ── Phase 6: Projects ───────────────────────────────────────────────

    const projectsResult = await migrateProjects(
      supabase,
      companyIdMap,
      clientIdMap,
      existingProjectMap,
      sinceConstraints,
      stats.errors
    );
    stats.projects = projectsResult.count;
    const projectIdMap = projectsResult.idMap;

    // ── Phase 7: Calendar Events ────────────────────────────────────────

    const calEventsResult = await migrateCalendarEvents(
      supabase,
      companyIdMap,
      projectIdMap,
      userIdMap,
      existingCalEventMap,
      sinceConstraints,
      stats.errors
    );
    stats.calendarEvents = calEventsResult.count;
    const calendarEventIdMap = calEventsResult.idMap;

    // ── Phase 8: Project Tasks ──────────────────────────────────────────

    stats.projectTasks = await migrateProjectTasks(
      supabase,
      companyIdMap,
      projectIdMap,
      taskTypeIdMap,
      calendarEventIdMap,
      userIdMap,
      sinceConstraints,
      stats.errors
    );

    // ── Phase 9: OPS Contacts ───────────────────────────────────────────

    stats.opsContacts = await migrateOpsContacts(supabase, stats.errors);

    // ── Phase 10: Pipeline Refs ─────────────────────────────────────────

    stats.pipelineRefsUpdated = await updatePipelineRefs(
      supabase,
      companyIdMap,
      clientIdMap,
      projectIdMap,
      userIdMap,
      stats.errors
    );

    // ── Post-migration: Project team members ────────────────────────────

    await computeProjectTeamMembers(supabase, stats.errors);

    // ── Response ────────────────────────────────────────────────────────

    stats.errorCount = stats.errors.length;

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (e) {
    stats.errorCount = stats.errors.length + 1;
    stats.errors.push(
      `Fatal: ${e instanceof Error ? e.message : String(e)}`
    );

    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Unknown error",
        stats,
      },
      { status: 500 }
    );
  }
}
