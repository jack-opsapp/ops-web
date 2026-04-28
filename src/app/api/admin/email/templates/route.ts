import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { listTemplates } from "@/lib/admin/email-template-queries";

export const runtime = "nodejs";

export const GET = withAdmin(async () => {
  const templates = await listTemplates();
  return NextResponse.json({ ok: true, templates });
});
