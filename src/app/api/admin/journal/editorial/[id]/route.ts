import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import {
  actOnJournalAssignment,
  journalAdminActionSchema,
} from "@/lib/journal/editorial/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const POST = withAdmin(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const user = await requireAdmin(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return json({ code: "ASSIGNMENT_NOT_FOUND" }, 404);
    const parsed = journalAdminActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ code: "INVALID_ACTION" }, 400);
    const result = await actOnJournalAssignment(id, parsed.data.action, user.email!);
    return json(result.body, result.status);
  }
);
