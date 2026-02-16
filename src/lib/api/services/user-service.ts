/**
 * OPS Web - User Service
 *
 * Complete CRUD operations for Users including role management.
 * Role detection: company.adminIds FIRST, then employeeType, then default fieldCrew.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleUserFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type UserDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  userDtoToModel,
  userModelToDto,
  companyDtoToModel,
} from "../../types/dto";
import type { User, UserRole } from "../../types/models";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchUsersOptions {
  /** Filter by role (employee type) */
  role?: string;
  /** Search by name */
  searchName?: string;
  /** Sort field */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit */
  limit?: number;
  /** Pagination cursor */
  cursor?: number;
}

// ─── User Service ─────────────────────────────────────────────────────────────

export const UserService = {
  /**
   * Fetch all users (team members) for a company.
   * Uses company admin IDs list for proper role detection.
   */
  async fetchUsers(
    companyId: string,
    companyAdminIds: string[] = [],
    options: FetchUsersOptions = {}
  ): Promise<{ users: User[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleUserFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleUserFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.role) {
      constraints.push({
        key: BubbleUserFields.employeeType,
        constraint_type: BubbleConstraintType.equals,
        value: options.role,
      });
    }

    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
    };

    if (options.sortField) {
      params.sort_field = options.sortField;
      params.descending = options.descending ? "true" : "false";
    }

    const response = await client.get<BubbleListResponse<UserDTO>>(
      `/obj/${BubbleTypes.user.toLowerCase()}`,
      { params }
    );

    const users = response.response.results.map((dto) =>
      userDtoToModel(dto, companyAdminIds)
    );

    return {
      users,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch a single user by ID.
   */
  async fetchUser(
    id: string,
    companyAdminIds: string[] = []
  ): Promise<User> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<UserDTO>>(
      `/obj/${BubbleTypes.user.toLowerCase()}/${id}`
    );

    return userDtoToModel(response.response, companyAdminIds);
  },

  /**
   * Update a user's profile information.
   */
  async updateUser(id: string, data: Partial<User>): Promise<void> {
    const client = getBubbleClient();

    const dto = userModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.user.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Update a user's employee type (role).
   */
  async updateUserRole(id: string, role: UserRole): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.user.toLowerCase()}/${id}`,
      { [BubbleUserFields.employeeType]: role }
    );
  },

  /**
   * Update a user's device token for push notifications.
   */
  async updateDeviceToken(
    id: string,
    deviceToken: string
  ): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.user.toLowerCase()}/${id}`,
      { [BubbleUserFields.deviceToken]: deviceToken }
    );
  },

  /**
   * Mark user's app tutorial as completed.
   */
  async markTutorialCompleted(id: string): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.user.toLowerCase()}/${id}`,
      { [BubbleUserFields.hasCompletedAppTutorial]: true }
    );
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
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await UserService.fetchUsers(
        companyId,
        companyAdminIds,
        {
          ...options,
          limit: 100,
          cursor,
        }
      );

      allUsers.push(...result.users);
      remaining = result.remaining;
      cursor += result.users.length;
    }

    return allUsers;
  },

  // ─── Auth Workflows ─────────────────────────────────────────────────────

  /**
   * Login with Google via Bubble workflow (matches iOS AuthManager + DataController flow).
   * 1. POST /wf/login_google → authenticate and get user ID
   * 2. GET /obj/user/{id} → fetch full user (reliable Data API format)
   * 3. GET /obj/company/{id} → fetch company with adminIds for role detection
   */
  async loginWithGoogle(
    idToken: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string
  ): Promise<{ user: User; company: import("../../types/models").Company | null }> {
    const client = getBubbleClient();

    // Step 1: Call Bubble workflow to authenticate
    console.log("[loginWithGoogle] Step 1: POST /wf/login_google", { email, name, givenName, familyName });
    const wfResponse = await client.post<Record<string, unknown>>("/wf/login_google", {
      id_token: idToken,
      email,
      name,
      given_name: givenName,
      family_name: familyName,
    });
    console.log("[loginWithGoogle] Step 1 RESPONSE (full JSON):", JSON.stringify(wfResponse, null, 2));

    // Step 2: Extract user ID from workflow response (handle multiple formats)
    let userId: string | null = null;
    const resp = (wfResponse as Record<string, unknown>).response as Record<string, unknown> | undefined;
    console.log("[loginWithGoogle] Step 2: Extracting userId. resp =", JSON.stringify(resp, null, 2));
    console.log("[loginWithGoogle] Step 2: wfResponse keys =", Object.keys(wfResponse || {}));
    if (resp) console.log("[loginWithGoogle] Step 2: resp keys =", Object.keys(resp));

    // Try: { response: { user: { _id } } }
    if (resp?.user && typeof resp.user === "object") {
      const wfUser = resp.user as Record<string, unknown>;
      console.log("[loginWithGoogle] Step 2: Found resp.user, keys =", Object.keys(wfUser));
      userId = (wfUser._id as string) || (wfUser.id as string) || null;
    }
    // Try: { response: { user_id } }
    if (!userId && resp?.user_id) {
      console.log("[loginWithGoogle] Step 2: Found resp.user_id =", resp.user_id);
      userId = resp.user_id as string;
    }
    // Try: { response: { _id } } (user at root of response)
    if (!userId && resp?._id) {
      console.log("[loginWithGoogle] Step 2: Found resp._id =", resp._id);
      userId = resp._id as string;
    }

    console.log("[loginWithGoogle] Step 2 RESULT: userId =", userId);

    if (!userId) {
      console.error("[loginWithGoogle] FAILED: No user ID found in response. Full response:", JSON.stringify(wfResponse, null, 2));
      throw new Error("No user ID returned from login workflow");
    }

    // Step 3: Fetch full user from Data API (reliable format, matches iOS fetchUserFromAPI)
    const userUrl = `/obj/${BubbleTypes.user.toLowerCase()}/${userId}`;
    console.log("[loginWithGoogle] Step 3: GET", userUrl);
    const userResponse = await client.get<BubbleObjectResponse<UserDTO>>(userUrl);
    console.log("[loginWithGoogle] Step 3 RESPONSE (full JSON):", JSON.stringify(userResponse, null, 2));
    const userDto = userResponse.response;
    console.log("[loginWithGoogle] Step 3: userDto.company =", userDto.company, "userDto.employeeType =", userDto.employeeType);

    // Step 4: Fetch company from Data API if user has one (matches iOS fetchCompanyData)
    let company: import("../../types/models").Company | null = null;
    let adminIds: string[] = [];

    if (userDto.company) {
      const companyUrl = `/obj/${BubbleTypes.company.toLowerCase()}/${userDto.company}`;
      console.log("[loginWithGoogle] Step 4: GET", companyUrl);
      try {
        const companyResponse = await client.get<BubbleObjectResponse<import("../../types/dto").CompanyDTO>>(companyUrl);
        console.log("[loginWithGoogle] Step 4 RESPONSE (full JSON):", JSON.stringify(companyResponse, null, 2));
        company = companyDtoToModel(companyResponse.response);
        adminIds = company.adminIds ?? [];
        console.log("[loginWithGoogle] Step 4: company.name =", company.name, "adminIds =", adminIds);
      } catch (err) {
        console.error("[loginWithGoogle] Step 4 FAILED: Company fetch error:", err);
      }
    } else {
      console.warn("[loginWithGoogle] Step 4: SKIPPED - userDto.company is empty/null");
    }

    // Step 5: Convert user with correct admin IDs for role detection
    const user = userDtoToModel(userDto, adminIds);
    console.log("[loginWithGoogle] Step 5 FINAL: user.id =", user.id, "user.role =", user.role, "user.companyId =", user.companyId, "company =", company?.name ?? "null");

    return { user, company };
  },

  /**
   * Login with email/password via Bubble workflow (matches iOS generate-api-token).
   * POST /wf/generate-api-token with email + password.
   * Returns token + user_id, then fetches user + company objects.
   */
  async loginWithToken(
    email: string,
    password: string
  ): Promise<{ token: string; userId: string; user: User; company: import("../../types/models").Company | null }> {
    const client = getBubbleClient();

    const tokenResponse = await client.post<{
      status: string;
      response: {
        token: string;
        user_id: string;
        expires: number;
      };
    }>("/wf/generate-api-token", { email, password });

    const { token, user_id } = tokenResponse.response;

    // Fetch the user object
    const userResponse = await client.get<BubbleObjectResponse<UserDTO>>(
      `/obj/${BubbleTypes.user.toLowerCase()}/${user_id}`
    );
    const userDto = userResponse.response;

    // Fetch the company if user has one
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
        // Company fetch failed - continue with user only
      }
    }

    const user = userDtoToModel(userDto, adminIds);

    return { token, userId: user_id, user, company };
  },

  /**
   * Legacy login via workflow API.
   */
  async login(
    email: string,
    password: string
  ): Promise<{ token: string; userId: string; user: User }> {
    const client = getBubbleClient();

    const response = await client.post<{
      response: {
        token: string;
        user_id: string;
        user: UserDTO;
      };
    }>("/wf/login", { email, password });

    const user = userDtoToModel(response.response.user);

    return {
      token: response.response.token,
      userId: response.response.user_id,
      user,
    };
  },

  /**
   * Signup via workflow API.
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
   * Reset password via workflow API.
   */
  async resetPassword(email: string): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/reset_pw", { email });
  },

  /**
   * Join a company via company code (workflow API).
   */
  async joinCompany(
    userId: string,
    companyCode: string
  ): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/join_company", {
      user_id: userId,
      company_code: companyCode,
    });
  },

  /**
   * Send team invites via Bubble workflow (matches iOS OnboardingService.sendInvites).
   * POST /wf/send_invite with emails array + company ID.
   */
  async sendInvite(
    emails: string[],
    companyId: string
  ): Promise<{ success: boolean; invitesSent?: number; errorMessage?: string }> {
    const client = getBubbleClient();

    const response = await client.post<{
      response?: {
        success?: boolean;
        invites_sent?: number;
        error_message?: string;
      };
      success?: boolean;
      invites_sent?: number;
      error_message?: string;
    }>("/wf/send_invite", {
      emails,
      company: companyId,
    });

    const data = response.response ?? response;

    return {
      success: data.success ?? true,
      invitesSent: data.invites_sent,
      errorMessage: data.error_message,
    };
  },
};

export default UserService;
