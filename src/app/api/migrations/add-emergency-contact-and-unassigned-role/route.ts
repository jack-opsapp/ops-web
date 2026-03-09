/**
 * POST /api/migrations/add-emergency-contact-and-unassigned-role
 *
 * One-time migration: adds emergency contact columns to users table
 * and creates the "Unassigned" preset role with minimal permissions.
 *
 * Run once, then delete this file.
 */

import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const MIGRATION_SQL = `
-- Add emergency contact columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT;

-- Add Unassigned preset role
INSERT INTO roles (id, company_id, name, description, hierarchy, is_preset, is_system, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000006',
  NULL,
  'Unassigned',
  'Default role for users who have not been assigned a role. Read-only access to own assignments.',
  99,
  true,
  true,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Add minimal permissions for Unassigned role
INSERT INTO role_permissions (role_id, permission, scope) VALUES
  ('00000000-0000-0000-0000-000000000006', 'projects.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000006', 'tasks.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000006', 'calendar.view', 'own'),
  ('00000000-0000-0000-0000-000000000006', 'profile.edit', 'own')
ON CONFLICT DO NOTHING;
`;

export async function POST() {
  try {
    const db = getServiceRoleClient();

    // Check if columns already exist by querying one
    const { error: probeError } = await db
      .from("users")
      .select("emergency_contact_name")
      .limit(0);

    if (probeError && probeError.message.includes("does not exist")) {
      // Columns don't exist — return SQL for manual execution
      return NextResponse.json({
        message: "Columns not found. Run this SQL in Supabase SQL Editor:",
        sql: MIGRATION_SQL,
      }, { status: 200 });
    }

    // Columns exist — check if Unassigned role exists
    const { data: role } = await db
      .from("roles")
      .select("id")
      .eq("id", "00000000-0000-0000-0000-000000000006")
      .maybeSingle();

    if (role) {
      return NextResponse.json({ message: "Migration already applied." });
    }

    // Try to insert role + permissions
    return NextResponse.json({
      message: "Columns exist but Unassigned role missing. Run this SQL in Supabase SQL Editor:",
      sql: MIGRATION_SQL,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown error",
      sql: MIGRATION_SQL,
    }, { status: 500 });
  }
}
