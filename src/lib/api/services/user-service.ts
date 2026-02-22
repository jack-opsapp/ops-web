/**
 * OPS Web - User Service
 *
 * Data CRUD → Supabase `users` table.
 * Auth workflows → Next.js API routes (/api/auth/*).
 *
 * Role detection: company.admin_ids FIRST, then role column, then default Field Crew.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { Company, User, UserRole } from "../../types/models";
import { UserRole as UserRoleEnum } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): User {
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
  // AUTH WORKFLOWS (via Next.js API routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sync user after Firebase authentication.
   * Calls POST /api/auth/sync-user to upsert user record in Supabase.
   */
  async syncUser(
    idToken: string,
    email: string,
    displayName?: string,
    firstName?: string,
    lastName?: string,
    photoURL?: string
  ): Promise<{ user: User; company: Company | null }> {
    const response = await fetch("/api/auth/sync-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        email,
        displayName,
        firstName,
        lastName,
        photoURL,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Sync failed" }));
      throw new Error(error.error || "Failed to sync user");
    }

    return response.json();
  },

  /**
   * Join a company via company code.
   */
  async joinCompany(
    idToken: string,
    companyCode: string
  ): Promise<{ user: User; company: Company }> {
    const response = await fetch("/api/auth/join-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, companyCode }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Join failed" }));
      throw new Error(error.error || "Failed to join company");
    }

    return response.json();
  },

  /**
   * Send team invites.
   */
  async sendInvite(
    idToken: string,
    emails: string[],
    companyId: string
  ): Promise<{ success: boolean; invitesSent?: number; errorMessage?: string }> {
    const response = await fetch("/api/auth/send-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, emails, companyId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Send failed" }));
      throw new Error(error.error || "Failed to send invites");
    }

    return response.json();
  },
};

export default UserService;
