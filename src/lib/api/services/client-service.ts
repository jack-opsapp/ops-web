/**
 * OPS Web - Client Service
 *
 * Complete CRUD operations for Clients and Sub-Clients.
 * All queries filter out soft-deleted items.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleClientFields,
  BubbleSubClientFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type ClientDTO,
  type SubClientDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  clientDtoToModel,
  clientModelToDto,
  subClientDtoToModel,
  subClientModelToDto,
} from "../../types/dto";
import type { Client, SubClient } from "../../types/models";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchClientsOptions {
  /** Search by name */
  searchName?: string;
  /** Filter by status */
  status?: string;
  /** Sort field */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit */
  limit?: number;
  /** Pagination cursor */
  cursor?: number;
}

// ─── Client Service ───────────────────────────────────────────────────────────

export const ClientService = {
  /**
   * Fetch all clients for a company.
   */
  async fetchClients(
    companyId: string,
    options: FetchClientsOptions = {}
  ): Promise<{ clients: Client[]; remaining: number; count: number }> {
    const apiClient = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleClientFields.parentCompany,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleClientFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.searchName) {
      constraints.push({
        key: BubbleClientFields.name,
        constraint_type: BubbleConstraintType.textContains,
        value: options.searchName,
      });
    }

    if (options.status) {
      constraints.push({
        key: BubbleClientFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
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

    const response = await apiClient.get<BubbleListResponse<ClientDTO>>(
      `/obj/${BubbleTypes.client.toLowerCase()}`,
      { params }
    );

    const clients = response.response.results.map(clientDtoToModel);

    return {
      clients,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch a single client by ID.
   */
  async fetchClient(id: string): Promise<Client> {
    const apiClient = getBubbleClient();

    const response = await apiClient.get<BubbleObjectResponse<ClientDTO>>(
      `/obj/${BubbleTypes.client.toLowerCase()}/${id}`
    );

    return clientDtoToModel(response.response);
  },

  /**
   * Create a new client.
   */
  async createClient(
    data: Partial<Client> & { name: string }
  ): Promise<string> {
    const apiClient = getBubbleClient();

    const dto = clientModelToDto(data);

    const response = await apiClient.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.client.toLowerCase()}`,
      dto
    );

    return response.id;
  },

  /**
   * Update an existing client.
   */
  async updateClient(id: string, data: Partial<Client>): Promise<void> {
    const apiClient = getBubbleClient();

    const dto = clientModelToDto(data);

    await apiClient.patch(
      `/obj/${BubbleTypes.client.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Soft delete a client.
   */
  async deleteClient(id: string): Promise<void> {
    const apiClient = getBubbleClient();

    await apiClient.patch(
      `/obj/${BubbleTypes.client.toLowerCase()}/${id}`,
      { [BubbleClientFields.deletedAt]: new Date().toISOString() }
    );
  },

  /**
   * Fetch all clients with auto-pagination.
   */
  async fetchAllClients(
    companyId: string,
    options: Omit<FetchClientsOptions, "limit" | "cursor"> = {}
  ): Promise<Client[]> {
    const allClients: Client[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await ClientService.fetchClients(companyId, {
        ...options,
        limit: 100,
        cursor,
      });

      allClients.push(...result.clients);
      remaining = result.remaining;
      cursor += result.clients.length;
    }

    return allClients;
  },

  // ─── Sub-Client Operations ────────────────────────────────────────────────

  /**
   * Fetch all sub-clients for a specific client (auto-paginates past 100).
   */
  async fetchSubClients(clientId: string): Promise<SubClient[]> {
    const apiClient = getBubbleClient();
    const allSubClients: SubClient[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const constraints: BubbleConstraint[] = [
        {
          key: BubbleSubClientFields.parentClient,
          constraint_type: BubbleConstraintType.equals,
          value: clientId,
        },
        {
          key: BubbleSubClientFields.deletedAt,
          constraint_type: BubbleConstraintType.isEmpty,
        },
      ];

      const params = {
        constraints: JSON.stringify(constraints),
        limit: 100,
        cursor,
      };

      // Note: Bubble uses "Sub Client" with a space, but the API endpoint is lowercase
      const response = await apiClient.get<BubbleListResponse<SubClientDTO>>(
        `/obj/subclient`,
        { params }
      );

      const subClients = response.response.results.map(subClientDtoToModel);
      allSubClients.push(...subClients);
      remaining = response.response.remaining;
      cursor += subClients.length;
    }

    return allSubClients;
  },

  /**
   * Fetch a single sub-client by ID.
   */
  async fetchSubClient(id: string): Promise<SubClient> {
    const apiClient = getBubbleClient();

    const response = await apiClient.get<BubbleObjectResponse<SubClientDTO>>(
      `/obj/subclient/${id}`
    );

    return subClientDtoToModel(response.response);
  },

  /**
   * Create a new sub-client.
   */
  async createSubClient(
    data: Partial<SubClient> & { name: string; clientId: string }
  ): Promise<string> {
    const apiClient = getBubbleClient();

    const dto = subClientModelToDto(data);

    const response = await apiClient.post<BubbleCreationResponse>(
      `/obj/subclient`,
      dto
    );

    return response.id;
  },

  /**
   * Update an existing sub-client.
   */
  async updateSubClient(
    id: string,
    data: Partial<SubClient>
  ): Promise<void> {
    const apiClient = getBubbleClient();

    const dto = subClientModelToDto(data);

    await apiClient.patch(`/obj/subclient/${id}`, dto);
  },

  /**
   * Soft delete a sub-client.
   */
  async deleteSubClient(id: string): Promise<void> {
    const apiClient = getBubbleClient();

    await apiClient.patch(`/obj/subclient/${id}`, {
      [BubbleSubClientFields.deletedAt]: new Date().toISOString(),
    });
  },
};

export default ClientService;
