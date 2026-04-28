import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { renderTemplate } from "@/lib/email/template-registry";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ templateId: string }> };

export const POST = withAdmin(async (req: NextRequest, ctx: RouteContext) => {
  const { templateId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const props = body?.props ?? {};
  const result = await renderTemplate(templateId, props);
  if (!result) {
    return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, html: result.html });
});
