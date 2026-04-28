/**
 * POST /api/admin/email/resume
 *
 * Resume a previously paused scope. Optional reason for the audit trail.
 * Admin-only via withAdmin + requireAdmin.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { resume, type PauseScope } from "@/lib/email/pause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResumeBody {
  scope?: string;
  reason?: string;
}

const SCOPE_RE =
  /^(global|bucket:(dispatch|gate|field_notes|portal)|campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const POST = withAdmin(async (req: NextRequest) => {
  const admin = await requireAdmin(req);

  let body: ResumeBody | null = null;
  try {
    body = (await req.json()) as ResumeBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body.scope !== "string") {
    return NextResponse.json({ ok: false, error: "scope required" }, { status: 400 });
  }
  if (!SCOPE_RE.test(body.scope)) {
    return NextResponse.json(
      { ok: false, error: "scope must be 'global', 'bucket:<name>', or 'campaign:<uuid>'" },
      { status: 400 }
    );
  }

  if (!admin.email) {
    return NextResponse.json({ ok: false, error: "admin missing email claim" }, { status: 500 });
  }

  try {
    await resume({
      scope: body.scope as PauseScope,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      actorUserId: admin.uid,
      actorEmail: admin.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
