import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { getTemplateEntry } from "@/lib/email/template-registry";
import { listTemplateVersions } from "@/lib/admin/email-template-queries";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ templateId: string }> };

export const GET = withAdmin(async (_req: NextRequest, ctx: RouteContext) => {
  const { templateId } = await ctx.params;
  const entry = getTemplateEntry(templateId);
  if (!entry) {
    return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
  }
  const versions = await listTemplateVersions(entry.templateId);
  return NextResponse.json({
    ok: true,
    template: {
      templateId: entry.templateId,
      displayName: entry.displayName,
      defaultSubject: entry.defaultSubject,
      previewProps: entry.previewProps,
      sourcePath: entry.sourcePath,
    },
    versions,
  });
});
