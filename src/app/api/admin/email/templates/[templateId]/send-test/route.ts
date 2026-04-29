import { NextResponse, type NextRequest } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getTemplateEntry, renderTemplate } from "@/lib/email/template-registry";
import { sendTransactionalEmail } from "@/lib/email/sendgrid";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ templateId: string }> };

export const POST = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  const admin = await requireAdmin(req);
  const { templateId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const recipient = typeof body?.recipient === "string" ? body.recipient.trim().toLowerCase() : null;
  const props = body?.props ?? {};

  if (!recipient || !recipient.includes("@")) {
    return NextResponse.json({ ok: false, error: "valid recipient required" }, { status: 400 });
  }

  const entry = getTemplateEntry(templateId);
  if (!entry) {
    return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
  }

  const rendered = await renderTemplate(templateId, props);
  if (!rendered) {
    return NextResponse.json({ ok: false, error: "render failed" }, { status: 500 });
  }

  const subjectPrefix = "[OPS TEST] ";
  const subject = subjectPrefix + entry.defaultSubject;

  let sendError: string | null = null;
  try {
    await sendTransactionalEmail({
      to: recipient,
      subject,
      html: rendered.html,
    });
  } catch (err: any) {
    sendError = err?.message ?? String(err);
  }

  // Always log a test row, even if send failed, so the audit trail exists.
  const supabase = getServiceRoleClient();
  await supabase.from("email_log").insert({
    recipient_email: recipient,
    email_type: entry.templateId,
    subject,
    status: sendError ? "failed" : "sent",
    error_message: sendError,
    metadata: { is_test: true, via: "admin_test", actor_email: admin.email ?? null },
  });

  if (sendError) {
    return NextResponse.json({ ok: false, error: sendError }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
