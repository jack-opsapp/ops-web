/**
 * PATCH  /api/admin/email/suppressions/templates/[id]
 * DELETE /api/admin/email/suppressions/templates/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

type RouteContext = { params: Promise<{ id: string }> };

const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  filter: z.unknown().optional(),
});

export const PATCH = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("email_audience_templates")
    .update(parsed.data)
    .eq("id", id)
    .select(
      "id, name, description, filter, last_used_count, last_resolved_at, created_at, updated_at"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
});

export const DELETE = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getServiceRoleClient();
  const { error } = await db
    .from("email_audience_templates")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
