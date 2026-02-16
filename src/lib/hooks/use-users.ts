/**
 * OPS Web - User/Team Hooks
 *
 * TanStack Query hooks for user and team member data.
 * Role detection uses company.adminIds FIRST, then employeeType, then default.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { UserService, type FetchUsersOptions } from "../api/services";
import type { User, UserRole } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all team members for the current company.
 * Automatically applies admin role detection using company.adminIds.
 */
export function useTeamMembers(
  options?: FetchUsersOptions,
  queryOptions?: Partial<UseQueryOptions<{ users: User[]; remaining: number; count: number }>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const adminIds = company?.adminIds ?? [];

  return useQuery({
    queryKey: queryKeys.users.list(companyId, options as Record<string, unknown>),
    queryFn: () => UserService.fetchUsers(companyId, adminIds, options),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single user by ID.
 */
export function useUser(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<User>>
) {
  const { company } = useAuthStore();
  const adminIds = company?.adminIds ?? [];

  return useQuery({
    queryKey: queryKeys.users.detail(id ?? ""),
    queryFn: () => UserService.fetchUser(id!, adminIds),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * Fetch the current authenticated user.
 */
export function useCurrentUser(
  queryOptions?: Partial<UseQueryOptions<User>>
) {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id;
  const adminIds = company?.adminIds ?? [];

  return useQuery({
    queryKey: queryKeys.users.current(),
    queryFn: () => UserService.fetchUser(userId!, adminIds),
    enabled: !!userId,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Update a user's profile.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<User>;
    }) => UserService.updateUser(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.users.detail(id),
      });

      const previousUser = queryClient.getQueryData<User>(
        queryKeys.users.detail(id)
      );

      if (previousUser) {
        queryClient.setQueryData(queryKeys.users.detail(id), {
          ...previousUser,
          ...data,
        });
      }

      return { previousUser };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(
          queryKeys.users.detail(id),
          context.previousUser
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.current(),
      });
    },
  });
}

/**
 * Update a user's role (employee type).
 */
export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      role,
    }: {
      id: string;
      role: UserRole;
    }) => UserService.updateUserRole(id, role),

    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.lists(),
      });
    },
  });
}

/**
 * Mark tutorial as completed for a user.
 */
export function useMarkTutorialCompleted() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => UserService.markTutorialCompleted(id),

    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.current(),
      });
    },
  });
}

// ─── Auth Mutations ───────────────────────────────────────────────────────────

/**
 * Login mutation.
 */
export function useLogin() {
  const { login: setAuth } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => UserService.login(email, password),

    onSuccess: (result) => {
      setAuth(result.user, result.token);
      // Clear all cached data for the new user session
      queryClient.clear();
    },
  });
}

/**
 * Signup mutation.
 */
export function useSignup() {
  return useMutation({
    mutationFn: ({
      email,
      password,
      userType,
    }: {
      email: string;
      password: string;
      userType?: string;
    }) => UserService.signup(email, password, userType),
  });
}

/**
 * Reset password mutation.
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: (email: string) => UserService.resetPassword(email),
  });
}

/**
 * Join company mutation.
 */
export function useJoinCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      companyCode,
    }: {
      userId: string;
      companyCode: string;
    }) => UserService.joinCompany(userId, companyCode),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.current(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.company.all,
      });
    },
  });
}
