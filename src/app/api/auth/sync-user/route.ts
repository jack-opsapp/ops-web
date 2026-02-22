/**
 * POST /api/auth/sync-user
 *
 * Syncs a Firebase-authenticated user with the Supabase `users` table.
 * - Verifies the Firebase ID token via jose JWKS verification
 * - Looks up the user by auth_id (Firebase UID) or email
 * - Creates a new user record if none exists
 * - Updates last-login timestamp on existing users
 * - Returns the user and their associated company (if any)
 *
 * Body: { idToken, email, displayName?, firstName?, lastName?, photoURL? }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate } from "@/lib/supabase/helpers";
import type {
  User,
  UserRole,
  Company,
  SubscriptionStatus,
  SubscriptionPlan,
  PaymentSchedule,
} from "@/lib/types/models";
import { UserRole as UserRoleEnum } from "@/lib/types/models";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SyncUserBody {
  idToken: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string;
}

// ─── DB Row Mappers ──────────────────────────────────────────────────────────

function mapUserFromDb(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    profileImageURL: (row.profile_image_url as string) ?? null,
    role: (row.role as UserRole) ?? UserRoleEnum.FieldCrew,
    companyId: (row.company_id as string) ?? null,
    userType: (row.user_type as User["userType"]) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    locationName: (row.location_name as string) ?? null,
    homeAddress: (row.home_address as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    isActive: (row.is_active as boolean) ?? true,
    userColor: (row.user_color as string) ?? null,
    devPermission: (row.dev_permission as boolean) ?? false,
    hasCompletedAppOnboarding: (row.has_completed_onboarding as boolean) ?? false,
    hasCompletedAppTutorial: (row.has_completed_tutorial as boolean) ?? false,
    isCompanyAdmin: (row.is_company_admin as boolean) ?? false,
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    deviceToken: (row.device_token as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapCompanyFromDb(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    name: row.name as string,
    logoURL: (row.logo_url as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    companyDescription: (row.description as string) ?? null,
    address: (row.address as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website: (row.website as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    openHour: (row.open_hour as string) ?? null,
    closeHour: (row.close_hour as string) ?? null,
    industries: (row.industries as string[]) ?? [],
    companySize: (row.company_size as string) ?? null,
    companyAge: (row.company_age as string) ?? null,
    referralMethod: (row.referral_method as string) ?? null,
    projectIds: [],
    teamIds: [],
    adminIds: (row.admin_ids as string[]) ?? [],
    accountHolderId: (row.account_holder_id as string) ?? null,
    defaultProjectColor: (row.default_project_color as string) ?? "#9CA3AF",
    teamMembersSynced: true,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionEnd: parseDate(row.subscription_end),
    subscriptionPeriod: (row.subscription_period as PaymentSchedule) ?? null,
    maxSeats: (row.max_seats as number) ?? 10,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    seatGraceStartDate: parseDate(row.seat_grace_start_date),
    trialStartDate: parseDate(row.trial_start_date),
    trialEndDate: parseDate(row.trial_end_date),
    hasPrioritySupport: (row.has_priority_support as boolean) ?? false,
    dataSetupPurchased: (row.data_setup_purchased as boolean) ?? false,
    dataSetupCompleted: (row.data_setup_completed as boolean) ?? false,
    dataSetupScheduledDate: parseDate(row.data_setup_scheduled),
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCompanyById(companyId: string): Promise<Company | null> {
  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .is("deleted_at", null)
    .single();

  if (error || !data) return null;
  return mapCompanyFromDb(data);
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SyncUserBody;
    const { idToken, email, displayName, firstName, lastName, photoURL } = body;

    if (!idToken || !email) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, email" },
        { status: 400 }
      );
    }

    // Verify Firebase ID token (signature + expiry + audience)
    const firebaseUser = await verifyFirebaseToken(idToken);
    const firebaseUid = firebaseUser.uid;

    const db = getServiceRoleClient();

    // Look up existing user by auth_id first, then by email
    const { data: byAuthId } = await db
      .from("users")
      .select("*")
      .eq("auth_id", firebaseUid)
      .is("deleted_at", null)
      .maybeSingle();

    let existingRow = byAuthId;

    if (!existingRow) {
      const { data: byEmail } = await db
        .from("users")
        .select("*")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle();

      existingRow = byEmail;
    }

    // ── Existing user: update last login and auth_id ──
    if (existingRow) {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      // Ensure auth_id is set (may be missing on legacy records matched by email)
      if (!existingRow.auth_id) {
        updates.auth_id = firebaseUid;
      }

      // Update profile fields if provided and currently empty
      if (photoURL && !existingRow.profile_image_url) {
        updates.profile_image_url = photoURL;
      }
      if (firstName && !existingRow.first_name) {
        updates.first_name = firstName;
      }
      if (lastName && !existingRow.last_name) {
        updates.last_name = lastName;
      }

      await db.from("users").update(updates).eq("id", existingRow.id);

      const user = mapUserFromDb({ ...existingRow, ...updates });
      const company = user.companyId ? await fetchCompanyById(user.companyId) : null;

      return NextResponse.json({ user, company });
    }

    // ── New user: create record ──
    const derivedFirst = firstName || displayName?.split(" ")[0] || "";
    const derivedLast = lastName || displayName?.split(" ").slice(1).join(" ") || "";

    const newRow = {
      auth_id: firebaseUid,
      email,
      first_name: derivedFirst,
      last_name: derivedLast,
      profile_image_url: photoURL ?? null,
      role: UserRoleEnum.FieldCrew,
      is_active: true,
      is_company_admin: false,
      has_completed_onboarding: false,
      has_completed_tutorial: false,
      dev_permission: false,
    };

    const { data: inserted, error: insertError } = await db
      .from("users")
      .insert(newRow)
      .select("*")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Failed to create user: ${insertError?.message ?? "Unknown error"}` },
        { status: 500 }
      );
    }

    const user = mapUserFromDb(inserted);
    return NextResponse.json({ user, company: null });
  } catch (error) {
    console.error("[api/auth/sync-user] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
