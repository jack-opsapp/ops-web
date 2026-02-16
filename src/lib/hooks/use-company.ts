/**
 * OPS Web - Company Hooks
 *
 * TanStack Query hooks for company data and subscription management.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { CompanyService } from "../api/services";
import type { Company } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch the current company's data.
 */
export function useCompany(
  queryOptions?: Partial<UseQueryOptions<Company>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id;

  return useQuery({
    queryKey: queryKeys.company.detail(companyId ?? ""),
    queryFn: () => CompanyService.fetchCompany(companyId!),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a specific company by ID.
 */
export function useCompanyById(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<Company>>
) {
  return useQuery({
    queryKey: queryKeys.company.detail(id ?? ""),
    queryFn: () => CompanyService.fetchCompany(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * Fetch subscription info for the current company.
 */
export function useSubscriptionInfo(
  queryOptions?: Partial<UseQueryOptions<Record<string, unknown>>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id;

  return useQuery({
    queryKey: queryKeys.company.subscription(companyId ?? ""),
    queryFn: () => CompanyService.fetchSubscriptionInfo(companyId!),
    enabled: !!companyId,
    // Subscription info should be fresh - shorter stale time
    staleTime: 30 * 1000, // 30 seconds
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Update company details.
 */
export function useUpdateCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Company>;
    }) => CompanyService.updateCompany(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.company.detail(id),
      });

      const previousCompany = queryClient.getQueryData<Company>(
        queryKeys.company.detail(id)
      );

      if (previousCompany) {
        queryClient.setQueryData(queryKeys.company.detail(id), {
          ...previousCompany,
          ...data,
        });
      }

      return { previousCompany };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousCompany) {
        queryClient.setQueryData(
          queryKeys.company.detail(id),
          context.previousCompany
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.company.detail(id),
      });
    },
  });
}

/**
 * Update default project color for the company.
 */
export function useUpdateDefaultProjectColor() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (color: string) =>
      CompanyService.updateDefaultProjectColor(company!.id, color),

    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.detail(company.id),
        });
      }
    },
  });
}

// ─── Subscription Mutations ───────────────────────────────────────────────────

/**
 * Complete a subscription purchase.
 */
export function useCompleteSubscription() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (data: {
      planId: string;
      period: "Monthly" | "Annual";
      paymentMethodId?: string;
    }) =>
      CompanyService.completeSubscription({
        companyId: company!.id,
        userId: useAuthStore.getState().currentUser!.id,
        ...data,
      }),

    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.detail(company.id),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.subscription(company.id),
        });
      }
    },
  });
}

/**
 * Cancel subscription.
 */
export function useCancelSubscription() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: () =>
      CompanyService.cancelSubscription(company!.id),

    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.detail(company.id),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.subscription(company.id),
        });
      }
    },
  });
}

// ─── Seat Management Mutations ────────────────────────────────────────────────

/**
 * Add a user to seated employees.
 */
export function useAddSeatedEmployee() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (userId: string) =>
      CompanyService.addSeatedEmployee(company!.id, userId),

    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.detail(company.id),
        });
      }
    },
  });
}

/**
 * Remove a user from seated employees.
 */
export function useRemoveSeatedEmployee() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (userId: string) =>
      CompanyService.removeSeatedEmployee(company!.id, userId),

    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.company.detail(company.id),
        });
      }
    },
  });
}
