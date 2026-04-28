/**
 * POST /api/admin/email/pause
 *
 * Pause one of three scopes: global | bucket:<name> | campaign:<uuid>.
 * Reason is mandatory (>= 3 chars). Optional ISO `paused_until` for
 * auto-resume; null/missing = indefinite.
 *
 * Admin-only via withAdmin + requireAdmin.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { pause, type PauseScope } from "@/lib/email/pause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody {
  scope?: string;
  reason?: string;
  paused_until?: string | null;
}

const SCOPE_RE =
  /^(global|bucket:(dispatch|gate|field_notes|portal)|campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const POST = withAdmin(async (req: NextRequest) => {
  const admin = await requireAdmin(req);

  let body: PauseBody | null = null;
  try {
    body = (await req.json()) as PauseBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body.scope !== "string" || typeof body.reason !== "string") {
    return NextResponse.json({ ok: false, error: "scope and reason required" }, { status: 400 });
  }
  if (!SCOPE_RE.test(body.scope)) {
    return NextResponse.json(
      { ok: false, error: "scope must be 'global', 'bucket:<name>', or 'campaign:<uuid>'" },
      { status: 400 }
    );
  }
  if (body.reason.trim().length < 3) {
    return NextResponse.json(
      { ok: false, error: "reason must be >= 3 chars" },
      { status: 400 }
    );
  }

  const pausedUntil = body.paused_until ?? null;
  if (pausedUntil !== null && (typeof pausedUntil !== "string" || Number.isNaN(Date.parse(pausedUntil)))) {
    return NextResponse.json(
      { ok: false, error: "paused_until must be a valid ISO timestamp or null" },
      { status: 400 }
    );
  }

  if (!admin.email) {
    return NextResponse.json({ ok: false, error: "admin missing email claim" }, { status: 500 });
  }

  try {
    const result = await pause({
      scope: body.scope as PauseScope,
      reason: body.reason,
      pausedUntil,
      actorUserId: admin.uid,
      actorEmail: admin.email,
    });
    return NextResponse.json({ ok: true, paused: result.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
