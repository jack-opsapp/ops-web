/**
 * OPS Admin - AI Memory management for a company
 *
 * GET    /api/admin/ai-features/[companyId]/memory → view memory facts + graph
 * DELETE /api/admin/ai-features/[companyId]/memory → reset all memory
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { MemoryService } from "@/lib/api/services/memory-service";

export const maxDuration = 300;

export const GET = withAdmin(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ companyId: string }> }
  ) => {
    await requireAdmin(req);
    const { companyId } = await params;

    const db = getServiceRoleClient();

    // Fetch facts
    const { data: facts } = await db
      .from("agent_memories")
      .select("id, memory_type, category, content, confidence, source, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100);

    // Fetch graph edges
    const { data: edges } = await db
      .from("agent_knowledge_graph")
      .select("id, subject_type, subject_id, predicate, object_type, object_id, properties, created_at")
      .eq("company_id", companyId)
      .is("valid_to", null)
      .order("created_at", { ascending: false })
      .limit(100);

    return NextResponse.json({
      facts: facts ?? [],
      edges: edges ?? [],
    });
  }
);

export const DELETE = withAdmin(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ companyId: string }> }
  ) => {
    await requireAdmin(req);
    const { companyId } = await params;

    const supabase = getServiceRoleClient();
    setSupabaseOverride(supabase);

    try {
      await MemoryService.resetMemory(companyId);
      return NextResponse.json({ ok: true, message: "Memory reset complete" });
    } finally {
      setSupabaseOverride(null);
    }
  }
);
