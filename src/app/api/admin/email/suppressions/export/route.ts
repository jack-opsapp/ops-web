/**
 * GET /api/admin/email/suppressions/export
 *
 * Streams the full suppression list as CSV in 5k-row pages so we never blow
 * past Supabase's 1MB result cap. Optional ?reason= filter narrows the export.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const PAGE_SIZE = 5000;

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const db = getServiceRoleClient();
  const reason = req.nextUrl.searchParams.get("reason") ?? undefined;

  const header = "email,list,reason,source,created_at,expires_at\n";
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(header));
      let offset = 0;
      while (true) {
        let q = db
          .from("email_suppressions")
          .select("email, list, reason, source, created_at, expires_at")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (reason) q = q.eq("reason", reason);
        const { data, error } = await q;
        if (error) {
          controller.enqueue(encoder.encode(`# error: ${error.message}\n`));
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) {
          const line =
            [
              JSON.stringify(row.email),
              JSON.stringify(row.list),
              JSON.stringify(row.reason),
              JSON.stringify(row.source),
              JSON.stringify(row.created_at),
              JSON.stringify(row.expires_at ?? ""),
            ].join(",") + "\n";
          controller.enqueue(encoder.encode(line));
        }
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      controller.close();
    },
  });

  const filename = `ops-suppressions-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(stream, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
