/**
 * OPS Web - User Service (Firebase + Supabase)
 *
 * Data CRUD → Supabase `users` table.
 * Auth workflows (login, signup, password reset) → Firebase Auth + Supabase.
 *
 * Role detection: company.admin_ids FIRST, then role column, then default Field Crew.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import {
  signInWithEmail,
  signUpWithEmail,
  sendPasswordResetEmail as firebaseResetPassword,
} from "@/lib/firebase/auth";
import type { User, UserRole } from "../../types/models";
import { UserRole as UserRoleEnum } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    firstName: (row.first_name as string) ?? "",
    lastName: (row.last_name as string) ?? "",
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

function mapToDb(data: Partial<User>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.firstName !== undefined) row.first_name = data.firstName;
  if (data.lastName !== undefined) row.last_name = data.lastName;
  if (data.email !== undefined) row.email = data.email;
  if (data.phone !== undefined) row.phone = data.phone;
  if (data.profileImageURL !== undefined) row.profile_image_url = data.profileImageURL;
  if (data.role !== undefined) row.role = data.role;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.userType !== undefined) row.user_type = data.userType;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;
  if (data.locationName !== undefined) row.location_name = data.locationName;
  if (data.homeAddress !== undefined) row.home_address = data.homeAddress;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  if (data.userColor !== undefined) row.user_color = data.userColor;
  if (data.devPermission !== undefined) row.dev_permission = data.devPermission;
  if (data.hasCompletedAppOnboarding !== undefined)
    row.has_completed_onboarding = data.hasCompletedAppOnboarding;
  if (data.hasCompletedAppTutorial !== undefined)
    row.has_completed_tutorial = data.hasCompletedAppTutorial;
  if (data.isCompanyAdmin !== undefined) row.is_company_admin = data.isCompanyAdmin;
  if (data.stripeCustomerId !== undefined) row.stripe_customer_id = data.stripeCustomerId;
  if (data.deviceToken !== undefined) row.device_token = data.deviceToken;
  return row;
}

function mapCompanyFromDb(row: Record<string, unknown>): import("../../types/models").Company {
  return {
    id: row.id as string,
    bubbleId: (row.bubble_id as string) ?? undefined,
    name: (row.name as string) ?? "",
    logoURL: (row.logo_url as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    companyDescription: (row.company_description as string) ?? null,
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
    projectIds: (row.project_ids as string[]) ?? [],
    teamIds: (row.team_ids as string[]) ?? [],
    adminIds: (row.admin_ids as string[]) ?? [],
    accountHolderId: (row.account_holder_id as string) ?? null,
    defaultProjectColor: (row.default_project_color as string) ?? "#59779F",
    teamMembersSynced: (row.team_members_synced as boolean) ?? false,
    subscriptionStatus: (row.subscription_status as import("../../types/models").SubscriptionStatus) ?? null,
    subscriptionPlan: (row.subscription_plan as import("../../types/models").SubscriptionPlan) ?? null,
    subscriptionEnd: row.subscription_end ? new Date(row.subscription_end as string) : null,
    subscriptionPeriod: (row.subscription_period as import("../../types/models").PaymentSchedule) ?? null,
    maxSeats: (row.max_seats as number) ?? 10,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    seatGraceStartDate: row.seat_grace_start_date ? new Date(row.seat_grace_start_date as string) : null,
    trialStartDate: row.trial_start_date ? new Date(row.trial_start_date as string) : null,
    trialEndDate: row.trial_end_date ? new Date(row.trial_end_date as string) : null,
    hasPrioritySupport: (row.has_priority_support as boolean) ?? false,
    dataSetupPurchased: (row.data_setup_purchased as boolean) ?? false,
    dataSetupCompleted: (row.data_setup_completed as boolean) ?? false,
    dataSetupScheduledDate: row.data_setup_scheduled_date ? new Date(row.data_setup_scheduled_date as string) : null,
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : null,
  };
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchUsersOptions {
  /** Filter by role */
  role?: string;
  /** Search by name (case-insensitive) */
  searchName?: string;
  /** Sort field (snake_case column name) */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit (max 100) */
  limit?: number;
  /** Pagination offset */
  cursor?: number;
}

// ─── User Service ─────────────────────────────────────────────────────────────

export const UserService = {
  // ═══════════════════════════════════════════════════════════════════════════
  // DATA CRUD (Supabase)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch all users (team members) for a company.
   * companyAdminIds is kept in the signature for backward compatibility
   * but is no longer needed — the DB stores is_company_admin directly.
   */
  async fetchUsers(
    companyId: string,
    _companyAdminIds: string[] = [],
    options: FetchUsersOptions = {}
  ): Promise<{ users: User[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("users")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (options.role) {
      query = query.eq("role", options.role);
    }

    if (options.searchName) {
      // Search across first_name and last_name
      query = query.or(
        `first_name.ilike.%${options.searchName}%,last_name.ilike.%${options.searchName}%`
      );
    }

    if (options.sortField) {
      query = query.order(options.sortField, { ascending: !options.descending });
    } else {
      query = query.order("first_name");
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch users: ${error.message}`);

    const total = count ?? 0;
    const users = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - users.length);

    return { users, remaining, count: total };
  },

  /**
   * Fetch a single user by ID.
   * companyAdminIds is kept for backward compatibility but unused.
   */
  async fetchUser(id: string, _companyAdminIds: string[] = []): Promise<User> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch user: ${error.message}`);
    return mapFromDb(data);
  },

  /**
   * Update a user's profile information.
   */
  async updateUser(id: string, data: Partial<User>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("users")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update user: ${error.message}`);
  },

  /**
   * Update a user's role.
   */
  async updateUserRole(id: string, role: UserRole): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", id);

    if (error) throw new Error(`Failed to update user role: ${error.message}`);
  },

  /**
   * Update a user's device token for push notifications.
   */
  async updateDeviceToken(id: string, deviceToken: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("users")
      .update({ device_token: deviceToken })
      .eq("id", id);

    if (error) throw new Error(`Failed to update device token: ${error.message}`);
  },

  /**
   * Mark user's app tutorial as completed.
   */
  async markTutorialCompleted(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("users")
      .update({ has_completed_tutorial: true })
      .eq("id", id);

    if (error) throw new Error(`Failed to mark tutorial completed: ${error.message}`);
  },

  /**
   * Fetch all users with auto-pagination.
   */
  async fetchAllUsers(
    companyId: string,
    companyAdminIds: string[] = [],
    options: Omit<FetchUsersOptions, "limit" | "cursor"> = {}
  ): Promise<User[]> {
    const allUsers: User[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await UserService.fetchUsers(companyId, companyAdminIds, {
        ...options,
        limit: 100,
        cursor: offset,
      });

      allUsers.push(...result.users);
      hasMore = result.remaining > 0;
      offset += result.users.length;
    }

    return allUsers;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH WORKFLOWS (Firebase + Supabase)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Login with Google via Firebase + Supabase lookup.
   * Firebase already verified the idToken client-side.
   * Looks up user by email in Supabase, auto-provisions on first sign-in.
   */
  async loginWithGoogle(
    idToken: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string
  ): Promise<{ user: User; company: import("../../types/models").Company | null }> {
    // Firebase already verified the idToken client-side.
    // Look up user by email in Supabase.
    const supabase = requireSupabase();

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (userError || !userRow) {
      // First sign-in: auto-provision user row
      const nameParts = name.split(" ");
      const firstName = givenName || nameParts[0] || "";
      const lastName = familyName || nameParts.slice(1).join(" ") || "";

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email,
          first_name: firstName,
          last_name: lastName,
          role: "Field Crew",
          user_type: "Employee",
          is_active: true,
        })
        .select("*")
        .single();

      if (insertError || !newUser) {
        throw new Error(`Failed to provision user: ${insertError?.message}`);
      }

      return { user: mapFromDb(newUser), company: null };
    }

    const user = mapFromDb(userRow);

    // Fetch company if user has one
    let company: import("../../types/models").Company | null = null;
    if (userRow.company_id) {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("*")
        .eq("id", userRow.company_id)
        .single();

      if (companyRow) {
        company = mapCompanyFromDb(companyRow);
      }
    }

    return { user, company };
  },

  /**
   * Login with email/password via Firebase then Supabase user lookup.
   * Firebase handles credential validation.
   */
  async loginWithEmailPassword(
    email: string,
    password: string
  ): Promise<{ user: User; company: import("../../types/models").Company | null }> {
    // Firebase handles credential validation
    await signInWithEmail(email, password);

    const supabase = requireSupabase();
    const { data: userRow, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !userRow) {
      throw new Error("Account not found. Please check your email.");
    }

    const user = mapFromDb(userRow);
    let company: import("../../types/models").Company | null = null;

    if (userRow.company_id) {
      const { data: companyRow } = await supabase
        .from("companies")
        .select("*")
        .eq("id", userRow.company_id)
        .single();
      if (companyRow) company = mapCompanyFromDb(companyRow);
    }

    return { user, company };
  },

  /**
   * Signup: create Firebase account then insert Supabase user row.
   */
  async signup(
    email: string,
    password: string,
    userType: string = "Employee"
  ): Promise<{ userId: string }> {
    // Create Firebase account
    const firebaseUser = await signUpWithEmail(email, password);

    // Insert Supabase user row
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("users")
      .insert({
        email,
        firebase_uid: firebaseUser.uid,
        role: "Field Crew",
        user_type: userType,
        is_active: true,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create user record: ${error?.message}`);
    }

    return { userId: data.id };
  },

  /**
   * Reset password via Firebase.
   */
  async resetPassword(email: string): Promise<void> {
    await firebaseResetPassword(email);
  },

  /**
   * Join a company via company code (Supabase lookup by external_id).
   */
  async joinCompany(userId: string, companyCode: string): Promise<void> {
    // company_code is stored in companies.external_id (the join code field)
    const supabase = requireSupabase();

    const { data: company, error } = await supabase
      .from("companies")
      .select("id")
      .eq("external_id", companyCode)
      .single();

    if (error || !company) {
      throw new Error("Invalid company code. Please check and try again.");
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ company_id: company.id })
      .eq("id", userId);

    if (updateError) {
      throw new Error(`Failed to join company: ${updateError.message}`);
    }
  },

  /**
   * Send team invites via server-side API route (SendGrid).
   * Replaces the Bubble /wf/send_invite workflow.
   */
  async sendInvite(
    emails: string[],
    companyId: string
  ): Promise<{ success: boolean; invitesSent?: number; errorMessage?: string }> {
    // Delegate to server-side API route (needs SendGrid)
    const response = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails, companyId }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, errorMessage: data.error ?? "Failed to send invites" };
    }

    const data = await response.json();
    return { success: true, invitesSent: data.invitesSent };
  },
};

export default UserService;
