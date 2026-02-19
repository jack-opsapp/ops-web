/**
 * OPS Web - User Service (Hybrid: Supabase + Bubble)
 *
 * Data CRUD → Supabase `users` table.
 * Auth workflows (login, signup, password reset) → Bubble /wf/ endpoints
 *   (until auth is migrated to Supabase Auth).
 *
 * Role detection: company.admin_ids FIRST, then role column, then default Field Crew.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
} from "../../constants/bubble-fields";
import {
  type UserDTO,
  type BubbleObjectResponse,
  userDtoToModel,
  companyDtoToModel,
} from "../../types/dto";
import type { User, UserRole } from "../../types/models";
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
  // AUTH WORKFLOWS (Bubble — until migrated to Supabase Auth)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Login with Google via Bubble workflow.
   * Returns user + company objects by merging workflow + Data API data.
   */
  async loginWithGoogle(
    idToken: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string
  ): Promise<{ user: User; company: import("../../types/models").Company | null }> {
    const client = getBubbleClient();

    // Step 1: Authenticate via Bubble workflow
    const wfResponse = await client.post<Record<string, unknown>>("/wf/login_google", {
      id_token: idToken,
      email,
      name,
      given_name: givenName,
      family_name: familyName,
    });

    const resp = (wfResponse as Record<string, unknown>).response as Record<string, unknown> | undefined;
    if (!resp) throw new Error("No response object from login workflow");

    const wfUser = resp.user as Record<string, unknown> | undefined;
    const userId = (wfUser?._id as string) || (resp.user_id as string) || null;
    if (!userId) throw new Error("No user ID returned from login workflow");

    const wfCompany = resp.company as Record<string, unknown> | undefined;
    const wfCompanyId = wfCompany?._id as string | undefined;

    // Step 2: Build admin IDs from workflow company
    let adminIds: string[] = [];
    if (wfCompany) {
      const wfAdmin = wfCompany.admin ?? wfCompany.adminIds ?? wfCompany.admin_ids;
      if (Array.isArray(wfAdmin)) {
        adminIds = wfAdmin
          .map((ref: unknown) => {
            if (typeof ref === "string") return ref;
            if (ref && typeof ref === "object") {
              const obj = ref as Record<string, unknown>;
              return (obj.unique_id as string) || (obj._id as string) || null;
            }
            return null;
          })
          .filter(Boolean) as string[];
      }
    }

    // Step 3: Fetch company from Data API
    let company: import("../../types/models").Company | null = null;
    if (wfCompanyId) {
      try {
        const companyResponse = await client.get<BubbleObjectResponse<import("../../types/dto").CompanyDTO>>(
          `/obj/${BubbleTypes.company.toLowerCase()}/${wfCompanyId}`
        );
        company = companyDtoToModel(companyResponse.response);
        if (adminIds.length === 0 && (company.adminIds?.length ?? 0) > 0) {
          adminIds = company.adminIds ?? [];
        }
      } catch {
        company = companyDtoToModel(wfCompany as unknown as import("../../types/dto").CompanyDTO);
      }
    }

    // Step 4: Fetch user from Data API and merge with workflow data
    let userDto: UserDTO;
    try {
      const userResponse = await client.get<BubbleObjectResponse<UserDTO>>(
        `/obj/${BubbleTypes.user.toLowerCase()}/${userId}`
      );
      userDto = userResponse.response;
    } catch {
      userDto = { _id: userId } as UserDTO;
    }

    // Merge: workflow data takes priority for fields hidden by privacy rules
    if (!userDto.company && wfCompanyId) userDto.company = wfCompanyId;
    if (!userDto.nameFirst)
      userDto.nameFirst = (wfUser?.nameFirst ?? wfUser?.name_first ?? givenName) as string;
    if (!userDto.nameLast)
      userDto.nameLast = (wfUser?.nameLast ?? wfUser?.name_last ?? familyName) as string;
    if (!userDto.email) userDto.email = (wfUser?.email as string) || email;
    if (!userDto.employeeType) {
      const wfEmployeeType = (
        wfUser?.employeeType ?? wfUser?.employee_type ?? wfUser?.employeetype ??
        wfUser?.type ?? resp.employee_type ?? resp.employeeType
      ) as string | undefined;
      if (wfEmployeeType) userDto.employeeType = wfEmployeeType;
    }
    if (!userDto.avatar && wfUser?.avatar) userDto.avatar = wfUser.avatar as string;

    const user = userDtoToModel(userDto, adminIds);

    if (user.role === UserRoleEnum.FieldCrew && adminIds.length === 0 && !userDto.employeeType) {
      console.warn(
        "[loginWithGoogle] Role detection defaulted to FieldCrew.",
        "adminIds: [], employeeType:", userDto.employeeType ?? "null",
        "userId:", userId
      );
    }

    return { user, company };
  },

  /**
   * Login with email/password via Bubble workflow.
   */
  async loginWithToken(
    email: string,
    password: string
  ): Promise<{ token: string; userId: string; user: User; company: import("../../types/models").Company | null }> {
    const client = getBubbleClient();

    const tokenResponse = await client.post<{
      status: string;
      response: { token: string; user_id: string; expires: number };
    }>("/wf/generate-api-token", { email, password });

    const { token, user_id } = tokenResponse.response;

    const userResponse = await client.get<BubbleObjectResponse<UserDTO>>(
      `/obj/${BubbleTypes.user.toLowerCase()}/${user_id}`
    );
    const userDto = userResponse.response;

    let company: import("../../types/models").Company | null = null;
    let adminIds: string[] = [];
    if (userDto.company) {
      try {
        const companyResponse = await client.get<BubbleObjectResponse<import("../../types/dto").CompanyDTO>>(
          `/obj/${BubbleTypes.company.toLowerCase()}/${userDto.company}`
        );
        company = companyDtoToModel(companyResponse.response);
        adminIds = company.adminIds ?? [];
      } catch {
        // Company fetch failed — continue with user only
      }
    }

    const user = userDtoToModel(userDto, adminIds);
    return { token, userId: user_id, user, company };
  },

  /**
   * Legacy login via Bubble workflow API.
   */
  async login(
    email: string,
    password: string
  ): Promise<{ token: string; userId: string; user: User }> {
    const client = getBubbleClient();
    const response = await client.post<{
      response: { token: string; user_id: string; user: UserDTO };
    }>("/wf/login", { email, password });

    const user = userDtoToModel(response.response.user);
    return {
      token: response.response.token,
      userId: response.response.user_id,
      user,
    };
  },

  /**
   * Signup via Bubble workflow API.
   */
  async signup(
    email: string,
    password: string,
    userType: string = "Employee"
  ): Promise<{ userId: string }> {
    const client = getBubbleClient();
    const response = await client.post<{
      response: { user_id: string };
    }>("/wf/signup", { email, password, userType });
    return { userId: response.response.user_id };
  },

  /**
   * Reset password via Bubble workflow API.
   */
  async resetPassword(email: string): Promise<void> {
    const client = getBubbleClient();
    await client.post("/wf/reset_pw", { email });
  },

  /**
   * Join a company via company code (Bubble workflow API).
   */
  async joinCompany(userId: string, companyCode: string): Promise<void> {
    const client = getBubbleClient();
    await client.post("/wf/join_company", {
      user_id: userId,
      company_code: companyCode,
    });
  },

  /**
   * Send team invites via Bubble workflow.
   */
  async sendInvite(
    emails: string[],
    companyId: string
  ): Promise<{ success: boolean; invitesSent?: number; errorMessage?: string }> {
    const client = getBubbleClient();
    const response = await client.post<{
      response?: { success?: boolean; invites_sent?: number; error_message?: string };
      success?: boolean;
      invites_sent?: number;
      error_message?: string;
    }>("/wf/send_invite", { emails, company: companyId });

    const data = response.response ?? response;
    return {
      success: data.success ?? true,
      invitesSent: data.invites_sent,
      errorMessage: data.error_message,
    };
  },
};

export default UserService;
