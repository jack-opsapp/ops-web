/**
 * GET    /api/admin/email/suppressions          — list (filter, paginate)
 * POST   /api/admin/email/suppressions          — add (one or many)
 *
 * All routes are admin-only via withAdmin + requireAdmin (existing pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import {
  addSuppression,
  listSuppressions,
  type SuppressionReason,
} from "@/lib/email/suppressions";

const VALID_REASONS: SuppressionReason[] = [
  "hard_bounce",
  "soft_bounce",
  "spam_report",
  "unsubscribe",
  "group_unsubscribe",
  "manual",
  "invalid_address",
];

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));
  const list = searchParams.get("list") ?? undefined;
  const reasonRaw = searchParams.get("reason");
  const reason = reasonRaw && VALID_REASONS.includes(reasonRaw as SuppressionReason)
    ? (reasonRaw as SuppressionReason)
    : undefined;
  const emailLike =
    searchParams.get("emailLike") ?? searchParams.get("email") ?? undefined;

  const { rows, total } = await listSuppressions({ list, reason, emailLike, limit, offset });
  return NextResponse.json({ rows, total, limit, offset });
});

interface AddBody {
  email?: string;
  emails?: string[];
  list?: string;
  reason?: SuppressionReason;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

export const POST = withAdmin(async (req: NextRequest) => {
  const adminUser = await requireAdmin(req);

  let body: AddBody;
  try {
    body = (await req.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason = body.reason ?? "manual";
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: `Invalid reason: ${reason}` }, { status: 400 });
  }

  const targets = body.emails ?? (body.email ? [body.email] : []);
  if (targets.length === 0) {
    return NextResponse.json({ error: "Provide `email` or `emails`" }, { status: 400 });
  }
  if (targets.length > 1000) {
    return NextResponse.json({ error: "Too many emails (max 1000)" }, { status: 413 });
  }

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  const added: string[] = [];
  const errors: Array<{ email: string; error: string }> = [];

  for (const email of targets) {
    try {
      await addSuppression({
        email,
        list: body.list ?? "global",
        reason,
        source: "manual",
        metadata: { ...(body.metadata ?? {}), addedBy: adminUser.email },
        expiresAt,
      });
      added.push(email.toLowerCase());
    } catch (e) {
      errors.push({ email, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ added: added.length, addedEmails: added, errors });
});
