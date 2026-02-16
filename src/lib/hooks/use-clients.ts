/**
 * OPS Web - Client Hooks
 *
 * TanStack Query hooks for client and sub-client data.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ClientService, type FetchClientsOptions } from "../api/services";
import type { Client, SubClient } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all clients for the current company.
 */
export function useClients(
  options?: FetchClientsOptions,
  queryOptions?: Partial<UseQueryOptions<{ clients: Client[]; remaining: number; count: number }>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.clients.list(companyId, options as Record<string, unknown>),
    queryFn: () => ClientService.fetchClients(companyId, options),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single client by ID.
 */
export function useClient(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<Client>>
) {
  return useQuery({
    queryKey: queryKeys.clients.detail(id ?? ""),
    queryFn: () => ClientService.fetchClient(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * Fetch sub-clients for a specific client.
 */
export function useSubClients(
  clientId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<SubClient[]>>
) {
  return useQuery({
    queryKey: queryKeys.clients.subClients(clientId ?? ""),
    queryFn: () => ClientService.fetchSubClients(clientId!),
    enabled: !!clientId,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new client.
 */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<Client> & { name: string }) =>
      ClientService.createClient(data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.lists(),
      });
    },
  });
}

/**
 * Update a client with optimistic update.
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Client>;
    }) => ClientService.updateClient(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.clients.detail(id),
      });

      const previousClient = queryClient.getQueryData<Client>(
        queryKeys.clients.detail(id)
      );

      if (previousClient) {
        queryClient.setQueryData(queryKeys.clients.detail(id), {
          ...previousClient,
          ...data,
        });
      }

      return { previousClient };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousClient) {
        queryClient.setQueryData(
          queryKeys.clients.detail(id),
          context.previousClient
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.lists(),
      });
    },
  });
}

/**
 * Soft delete a client.
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ClientService.deleteClient(id),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.all,
      });
    },
  });
}

// ─── Sub-Client Mutations ─────────────────────────────────────────────────────

/**
 * Create a new sub-client.
 */
export function useCreateSubClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Partial<SubClient> & { name: string; clientId: string }
    ) => ClientService.createSubClient(data),

    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.subClients(variables.clientId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.detail(variables.clientId),
      });
    },
  });
}

/**
 * Update a sub-client.
 */
export function useUpdateSubClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
      clientId: _clientId,
    }: {
      id: string;
      data: Partial<SubClient>;
      clientId: string;
    }) => ClientService.updateSubClient(id, data),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.subClients(variables.clientId),
      });
    },
  });
}

/**
 * Soft delete a sub-client.
 */
export function useDeleteSubClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      clientId: _clientId,
    }: {
      id: string;
      clientId: string;
    }) => ClientService.deleteSubClient(id),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.subClients(variables.clientId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.clients.detail(variables.clientId),
      });
    },
  });
}
