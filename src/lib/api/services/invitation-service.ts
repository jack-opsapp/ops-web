/**
 * OPS Web - Team Invitations Service
 *
 * CRUD operations for pending team invitations.
 * Uses Supabase as the data layer.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PendingInvitation {
  id: string;
  email: string | null;
  phone: string | null;
  roleId: string | null;
  roleName: string | null;
  invitedByName: string;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const InvitationService = {
  /**
   * Fetch all pending invitations for a company.
   */
  async fetchPendingInvitations(companyId: string): Promise<PendingInvitation[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("team_invitations")
      .select("id, email, phone, role_id, invited_by, invite_code, expires_at, created_at")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch invitations: ${error.message}`);
    if (!data || data.length === 0) return [];

    // Collect unique role_ids and invited_by user ids for batch lookups
    const roleIds = [...new Set(
      (data as Record<string, unknown>[])
        .map((r) => r.role_id as string | null)
        .filter(Boolean)
    )] as string[];

    const inviterIds = [...new Set(
      (data as Record<string, unknown>[]).map((r) => r.invited_by as string)
    )];

    // Batch fetch role names
    const roleMap = new Map<string, string>();
    if (roleIds.length > 0) {
      const { data: roles } = await supabase
        .from("roles")
        .select("id, name")
        .in("id", roleIds);
      for (const r of roles ?? []) {
        roleMap.set(r.id as string, r.name as string);
      }
    }

    // Batch fetch inviter names
    const inviterMap = new Map<string, string>();
    if (inviterIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", inviterIds);
      for (const u of users ?? []) {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Unknown";
        inviterMap.set(u.id as string, name);
      }
    }

    return (data as Record<string, unknown>[]).map((row) => {
      const roleId = row.role_id as string | null;
      const rawName = roleId ? (roleMap.get(roleId) ?? null) : null;
      // Suppress "Unassigned" so UI can show its own placeholder
      const roleName = rawName?.toLowerCase() === "unassigned" ? null : rawName;

      return {
        id: row.id as string,
        email: (row.email as string) ?? null,
        phone: (row.phone as string) ?? null,
        roleId,
        roleName,
        invitedByName: inviterMap.get(row.invited_by as string) ?? "Unknown",
        inviteCode: row.invite_code as string,
        expiresAt: row.expires_at as string,
        createdAt: row.created_at as string,
      };
    });
  },

  /**
   * Update the role assigned to a pending invitation.
   */
  async updateInvitationRole(invitationId: string, roleId: string | null): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("team_invitations")
      .update({
        role_id: roleId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitationId)
      .eq("status", "pending");

    if (error) throw new Error(`Failed to update invitation: ${error.message}`);
  },

  /**
   * Revoke (delete) a pending invitation.
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("team_invitations")
      .delete()
      .eq("id", invitationId)
      .eq("status", "pending");

    if (error) throw new Error(`Failed to revoke invitation: ${error.message}`);
  },
};
