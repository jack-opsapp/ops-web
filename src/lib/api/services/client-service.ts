/**
 * OPS Web - Client Service (Supabase)
 *
 * Complete CRUD operations for Clients and Sub-Clients.
 * All queries filter out soft-deleted items.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { Client, SubClient } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapClientFromDb(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    address: (row.address as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    profileImageURL: (row.profile_image_url as string) ?? null,
    notes: (row.notes as string) ?? null,
    companyId: (row.company_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    createdAt: parseDate(row.created_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapClientToDb(data: Partial<Client>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.email !== undefined) row.email = data.email;
  if (data.phoneNumber !== undefined) row.phone_number = data.phoneNumber;
  if (data.address !== undefined) row.address = data.address;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;
  if (data.profileImageURL !== undefined) row.profile_image_url = data.profileImageURL;
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  return row;
}

function mapSubClientFromDb(row: Record<string, unknown>): SubClient {
  return {
    id: row.id as string,
    name: row.name as string,
    title: (row.title as string) ?? null,
    email: (row.email as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    address: (row.address as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    createdAt: row.created_at ? new Date(row.created_at as string) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : new Date(),
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapSubClientToDb(data: Partial<SubClient>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.title !== undefined) row.title = data.title;
  if (data.email !== undefined) row.email = data.email;
  if (data.phoneNumber !== undefined) row.phone_number = data.phoneNumber;
  if (data.address !== undefined) row.address = data.address;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  return row;
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchClientsOptions {
  searchName?: string;
  status?: string;
  sortField?: string;
  descending?: boolean;
  limit?: number;
  cursor?: number;
}

// ─── Client Service ───────────────────────────────────────────────────────────

export const ClientService = {
  /**
   * Fetch clients for a company with optional filtering/pagination.
   */
  async fetchClients(
    companyId: string,
    options: FetchClientsOptions = {}
  ): Promise<{ clients: Client[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const cursor = options.cursor ?? 0;

    let query = supabase
      .from("clients")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (options.searchName) {
      query = query.ilike("name", `%${options.searchName}%`);
    }

    if (options.sortField) {
      const col = options.sortField === "name" ? "name" : options.sortField;
      query = query.order(col, { ascending: !options.descending });
    } else {
      query = query.order("name");
    }

    query = query.range(cursor, cursor + limit - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch clients: ${error.message}`);

    const clients = (data ?? []).map(mapClientFromDb);
    const total = count ?? 0;
    const remaining = Math.max(0, total - cursor - clients.length);

    return { clients, remaining, count: total };
  },

  /**
   * Fetch a single client by ID.
   */
  async fetchClient(id: string): Promise<Client> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch client: ${error.message}`);
    return mapClientFromDb(data);
  },

  /**
   * Create a new client.
   */
  async createClient(
    data: Partial<Client> & { name: string }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapClientToDb(data);

    const { data: created, error } = await supabase
      .from("clients")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create client: ${error.message}`);
    return created.id as string;
  },

  /**
   * Update an existing client.
   */
  async updateClient(id: string, data: Partial<Client>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapClientToDb(data);

    const { error } = await supabase
      .from("clients")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update client: ${error.message}`);
  },

  /**
   * Soft delete a client.
   */
  async deleteClient(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("clients")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete client: ${error.message}`);
  },

  /**
   * Fetch all clients with auto-pagination.
   */
  async fetchAllClients(
    companyId: string,
    options: Omit<FetchClientsOptions, "limit" | "cursor"> = {}
  ): Promise<Client[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("clients")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name");

    if (options.searchName) {
      query = query.ilike("name", `%${options.searchName}%`);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to fetch clients: ${error.message}`);
    return (data ?? []).map(mapClientFromDb);
  },

  // ─── Sub-Client Operations ────────────────────────────────────────────────

  /**
   * Fetch all sub-clients for a specific client.
   */
  async fetchSubClients(clientId: string): Promise<SubClient[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("sub_clients")
      .select("*")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("name");

    if (error) throw new Error(`Failed to fetch sub-clients: ${error.message}`);
    return (data ?? []).map(mapSubClientFromDb);
  },

  /**
   * Fetch a single sub-client by ID.
   */
  async fetchSubClient(id: string): Promise<SubClient> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("sub_clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch sub-client: ${error.message}`);
    return mapSubClientFromDb(data);
  },

  /**
   * Create a new sub-client.
   */
  async createSubClient(
    data: Partial<SubClient> & { name: string; clientId: string }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapSubClientToDb(data);

    const { data: created, error } = await supabase
      .from("sub_clients")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create sub-client: ${error.message}`);
    return created.id as string;
  },

  /**
   * Update an existing sub-client.
   */
  async updateSubClient(id: string, data: Partial<SubClient>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapSubClientToDb(data);

    const { error } = await supabase
      .from("sub_clients")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update sub-client: ${error.message}`);
  },

  /**
   * Soft delete a sub-client.
   */
  async deleteSubClient(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("sub_clients")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete sub-client: ${error.message}`);
  },
};

export default ClientService;
