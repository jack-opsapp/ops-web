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
import { type User, type UserRole, UserRole as UserRoleEnum } from "../../types/models";

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
   *
   * Strategy: The workflow response bypasses Bubble privacy rules and returns
   * full user/company objects. The Data API may hide fields (admin, employeeType).
   * We use both sources and merge, preferring workflow data for restricted fields.
   *
   * 1. POST /wf/login_google → authenticate, get user + company (full data)
   * 2. GET /obj/company/{id} → try Data API for additional company fields
   * 3. GET /obj/user/{id} → try Data API for additional user fields
   * 4. Merge workflow + Data API data, with workflow taking priority for restricted fields
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
    console.log("[loginWithGoogle] Step 1: POST /wf/login_google", { email, name });
    const wfResponse = await client.post<Record<string, unknown>>("/wf/login_google", {
      id_token: idToken,
      email,
      name,
      given_name: givenName,
      family_name: familyName,
    });
    console.log("[loginWithGoogle] Step 1 RESPONSE:", JSON.stringify(wfResponse, null, 2));

    // Step 2: Extract user + company from workflow response
    const resp = (wfResponse as Record<string, unknown>).response as Record<string, unknown> | undefined;
    if (!resp) {
      throw new Error("No response object from login workflow");
    }
    console.log("[loginWithGoogle] Step 2: Top-level response keys:", Object.keys(resp));

    // Extract workflow user object
    const wfUser = resp.user as Record<string, unknown> | undefined;
    const userId = (wfUser?._id as string) || (resp.user_id as string) || null;
    if (!userId) {
      throw new Error("No user ID returned from login workflow");
    }
    if (wfUser) {
      console.log("[loginWithGoogle] Step 2: wfUser ALL KEYS:", Object.keys(wfUser));
      console.log("[loginWithGoogle] Step 2: wfUser FULL:", JSON.stringify(wfUser, null, 2));
    }

    // Extract workflow company object
    const wfCompany = resp.company as Record<string, unknown> | undefined;
    const wfCompanyId = wfCompany?._id as string | undefined;
    if (wfCompany) {
      console.log("[loginWithGoogle] Step 2: wfCompany ALL KEYS:", Object.keys(wfCompany));
      console.log("[loginWithGoogle] Step 2: wfCompany FULL:", JSON.stringify(wfCompany, null, 2));
    }

    // Step 3: Build admin IDs list from ALL available sources
    let adminIds: string[] = [];

    // Source A: Workflow company "admin" field (bypasses privacy rules)
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
        console.log("[loginWithGoogle] Step 3: adminIds from WORKFLOW company:", adminIds);
      }
    }

    // Source B: Data API company (may have admin field if privacy allows)
    let company: import("../../types/models").Company | null = null;
    if (wfCompanyId) {
      const companyUrl = `/obj/${BubbleTypes.company.toLowerCase()}/${wfCompanyId}`;
      console.log("[loginWithGoogle] Step 3: GET", companyUrl);
      try {
        const companyResponse = await client.get<BubbleObjectResponse<import("../../types/dto").CompanyDTO>>(companyUrl);
        console.log("[loginWithGoogle] Step 3: Data API company keys:", Object.keys(companyResponse.response));
        console.log("[loginWithGoogle] Step 3: Data API company FULL:", JSON.stringify(companyResponse.response, null, 2));
        company = companyDtoToModel(companyResponse.response);
        if (adminIds.length === 0 && (company.adminIds?.length ?? 0) > 0) {
          adminIds = company.adminIds ?? [];
          console.log("[loginWithGoogle] Step 3: adminIds from DATA API:", adminIds);
        }
      } catch (err) {
        console.warn("[loginWithGoogle] Step 3: Data API company fetch failed:", err);
        company = companyDtoToModel(wfCompany as unknown as import("../../types/dto").CompanyDTO);
      }
    }
    console.log("[loginWithGoogle] Step 3 FINAL: company =", company?.name ?? "null", "adminIds =", adminIds);

    // Step 4: Build user DTO by merging Data API + workflow data
    let userDto: UserDTO;
    try {
      const userUrl = `/obj/${BubbleTypes.user.toLowerCase()}/${userId}`;
      console.log("[loginWithGoogle] Step 4: GET", userUrl);
      const userResponse = await client.get<BubbleObjectResponse<UserDTO>>(userUrl);
      userDto = userResponse.response;
      console.log("[loginWithGoogle] Step 4: Data API user keys:", Object.keys(userDto));
      console.log("[loginWithGoogle] Step 4: Data API user FULL:", JSON.stringify(userDto, null, 2));
    } catch {
      userDto = { _id: userId } as UserDTO;
      console.warn("[loginWithGoogle] Step 4: Data API user fetch failed, using workflow data only");
    }

    // Merge: workflow data takes priority for fields hidden by privacy rules
    if (!userDto.company && wfCompanyId) {
      userDto.company = wfCompanyId;
    }
    if (!userDto.nameFirst) {
      userDto.nameFirst = (wfUser?.nameFirst ?? wfUser?.name_first ?? givenName) as string;
    }
    if (!userDto.nameLast) {
      userDto.nameLast = (wfUser?.nameLast ?? wfUser?.name_last ?? familyName) as string;
    }
    if (!userDto.email) {
      userDto.email = (wfUser?.email as string) || email;
    }
    // Merge employeeType from workflow (try multiple field name conventions)
    if (!userDto.employeeType) {
      const wfEmployeeType = (
        wfUser?.employeeType ??
        wfUser?.employee_type ??
        wfUser?.employeetype ??
        wfUser?.type ??
        resp.employee_type ??
        resp.employeeType
      ) as string | undefined;
      if (wfEmployeeType) {
        userDto.employeeType = wfEmployeeType;
        console.log("[loginWithGoogle] Step 4: Merged employeeType from workflow:", wfEmployeeType);
      }
    }
    // Merge avatar from workflow
    if (!userDto.avatar && wfUser?.avatar) {
      userDto.avatar = wfUser.avatar as string;
    }
    console.log("[loginWithGoogle] Step 4 MERGED: company =", userDto.company, "employeeType =", userDto.employeeType, "email =", userDto.email);

    // Step 5: Convert user with role detection
    const user = userDtoToModel(userDto, adminIds);

    // Diagnostic: if role is still FieldCrew and we have no role data, log clearly
    if (user.role === UserRoleEnum.FieldCrew && adminIds.length === 0 && !userDto.employeeType) {
      console.warn(
        "[loginWithGoogle] ⚠️ ROLE DETECTION FAILED - defaulted to fieldCrew.",
        "\n  adminIds: [] (admin field missing from both workflow and Data API)",
        "\n  employeeType:", userDto.employeeType ?? "null",
        "\n  userId:", userId,
        "\n  Fix: In Bubble editor, ensure the /wf/login_google workflow returns",
        "the company's 'admin' list OR the user's 'employeeType' field.",
        "\n  Or update Bubble Data API privacy rules to expose these fields."
      );
    }

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
