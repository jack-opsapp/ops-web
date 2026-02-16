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
   * Login with Google via Bubble workflow (matches iOS AuthManager.swift).
   * POST /wf/login_google with Firebase ID token + profile info.
   * Returns user + company directly from Bubble.
   */
  async loginWithGoogle(
    idToken: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string
  ): Promise<{ user: User; company: import("../../types/models").Company | null }> {
    const client = getBubbleClient();

    const response = await client.post<{
      status: string;
      response: {
        user: UserDTO;
        company?: import("../../types/dto").CompanyDTO;
      };
    }>("/wf/login_google", {
      id_token: idToken,
      email,
      name,
      given_name: givenName,
      family_name: familyName,
    });

    const adminIds = response.response.company
      ? (companyDtoToModel(response.response.company).adminIds ?? [])
      : [];
    const user = userDtoToModel(response.response.user, adminIds);
    const company = response.response.company
      ? companyDtoToModel(response.response.company)
      : null;

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
};

export default UserService;
