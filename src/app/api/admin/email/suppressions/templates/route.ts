/**
 * GET  /api/admin/email/suppressions/templates  — list audience templates
 * POST /api/admin/email/suppressions/templates  — create a new template
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  filter: unknown;
  last_used_count: number;
  last_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCamel(r: TemplateRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    filter: r.filter,
    lastUsedCount: r.last_used_count,
    lastResolvedAt: r.last_resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("email_audience_templates")
    .select(
      "id, name, description, filter, last_used_count, last_resolved_at, created_at, updated_at"
    )
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    templates: (data as TemplateRow[] | null)?.map(rowToCamel) ?? [],
  });
});

const Body = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  filter: z.unknown(),
});

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("email_audience_templates")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      filter: parsed.data.filter,
      created_by_user_id: null,
    })
    .select(
      "id, name, description, filter, last_used_count, last_resolved_at, created_at, updated_at"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { template: rowToCamel(data as TemplateRow) },
    { status: 201 }
  );
});
