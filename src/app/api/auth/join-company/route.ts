/**
 * POST /api/auth/join-company
 *
 * Associates a Firebase-authenticated user with a company via company code.
 * - Verifies the Firebase ID token
 * - Looks up the company by external_id first, then by UUID
 * - Identifies the user by auth_id or email
 * - Updates the user's company_id
 * - Returns the updated user and company
 *
 * Body: { idToken, companyCode }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
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

interface JoinCompanyBody {
  idToken: string;
  companyCode: string;
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
    role: (row.role as UserRole) ?? UserRoleEnum.Unassigned,
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
    onboardingCompleted: (row.onboarding_completed as User["onboardingCompleted"]) ?? {},
    hasCompletedAppTutorial: (row.has_completed_tutorial as boolean) ?? false,
    isCompanyAdmin: (row.is_company_admin as boolean) ?? false,
    inventoryAccess: (row.inventory_access as boolean) ?? false,
    specialPermissions: (row.special_permissions as string[]) ?? [],
    setupProgress: (row.setup_progress as User["setupProgress"]) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    deviceToken: (row.device_token as string) ?? null,
    emergencyContactName: (row.emergency_contact_name as string) ?? null,
    emergencyContactPhone: (row.emergency_contact_phone as string) ?? null,
    emergencyContactRelationship: (row.emergency_contact_relationship as string) ?? null,
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
    companyCode: (row.company_code as string) ?? null,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findCompanyByCode(
  companyCode: string
): Promise<Record<string, unknown> | null> {
  const db = getServiceRoleClient();

  // Try company_code first (the shareable company code)
  const { data: byCode } = await db
    .from("companies")
    .select("*")
    .ilike("company_code", companyCode)
    .is("deleted_at", null)
    .maybeSingle();

  if (byCode) return byCode;

  // Fall back to UUID lookup if the code looks like a UUID
  if (UUID_RE.test(companyCode)) {
    const { data: byId } = await db
      .from("companies")
      .select("*")
      .eq("id", companyCode)
      .is("deleted_at", null)
      .maybeSingle();

    if (byId) return byId;
  }

  return null;
}

async function findUserByFirebaseUid(
  uid: string,
  email?: string
): Promise<Record<string, unknown> | null> {
  const db = getServiceRoleClient();

  const { data: byAuthId } = await db
    .from("users")
    .select("*")
    .eq("auth_id", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byAuthId) return byAuthId;

  const { data: byFirebaseUid } = await db
    .from("users")
    .select("*")
    .eq("firebase_uid", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (byFirebaseUid) return byFirebaseUid;

  if (email) {
    const { data: byEmail } = await db
      .from("users")
      .select("*")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (byEmail) return byEmail;
  }

  return null;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as JoinCompanyBody;
    const { idToken, companyCode } = body;

    if (!idToken || !companyCode) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, companyCode" },
        { status: 400 }
      );
    }

    // Verify auth token (Supabase or Firebase)
    const firebaseUser = await verifyAuthToken(idToken);

    // Find the company
    const companyRow = await findCompanyByCode(companyCode);
    if (!companyRow) {
      return NextResponse.json(
        { error: "Company not found. Please check the company code and try again." },
        { status: 404 }
      );
    }

    // Find the user
    const userRow = await findUserByFirebaseUid(firebaseUser.uid, firebaseUser.email);
    if (!userRow) {
      return NextResponse.json(
        { error: "User not found. Please sign up first." },
        { status: 404 }
      );
    }

    // Join the user to the company via the database function.
    // This atomically handles: company_id assignment, invitation lookup,
    // role assignment (from invite or default to unassigned), users.role sync,
    // and seat assignment. Shared across all platforms (web, iOS, Android).
    const db = getServiceRoleClient();
    const companyId = companyRow.id as string;
    const userId = userRow.id as string;

    const { data: joinResult, error: joinError } = await db.rpc(
      "join_user_to_company",
      { p_user_id: userId, p_company_id: companyId }
    );

    if (joinError) {
      return NextResponse.json(
        { error: `Failed to join company: ${joinError.message}` },
        { status: 500 }
      );
    }

    if (joinResult?.error) {
      return NextResponse.json(
        { error: joinResult.error },
        { status: 400 }
      );
    }

    console.log("[api/auth/join-company] join_user_to_company result:", joinResult);

    // Re-fetch user and company to return fresh data
    const { data: freshUser } = await db
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    const { data: freshCompany } = await db
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    const user = mapUserFromDb(freshUser ?? { ...userRow, company_id: companyId, role: joinResult?.role_name ?? "unassigned" });
    const company = mapCompanyFromDb(freshCompany ?? companyRow);

    return NextResponse.json({ user, company });
  } catch (error) {
    console.error("[api/auth/join-company] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
