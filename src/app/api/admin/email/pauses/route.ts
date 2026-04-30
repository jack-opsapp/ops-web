/**
 * GET /api/admin/email/pauses
 *
 * Returns all currently active pauses. Pass `?audit=1` to additionally
 * include the most recent 100 audit-log rows (pause/resume/auto_resume).
 *
 * Admin-only via withAdmin + requireAdmin.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getActivePauses, listAuditLog } from "@/lib/email/pause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const includeAudit = url.searchParams.get("audit") === "1";
  const [active, audit] = await Promise.all([
    getActivePauses(),
    includeAudit ? listAuditLog({ limit: 100 }) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, active, audit });
});
