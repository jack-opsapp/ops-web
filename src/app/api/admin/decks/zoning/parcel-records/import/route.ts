import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  importVerifiedParcelRecords,
  prepareVerifiedParcelRecordImport,
} from "@/lib/decks/zoning/parcel-record-import";

const importBodySchema = z
  .object({
    dry_run: z.boolean().optional().default(false),
    records: z.array(z.unknown()).min(1).max(500),
  })
  .strict();

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = importBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const prepared = prepareVerifiedParcelRecordImport(parsed.data.records);
  if (prepared.rejected.length > 0) {
    return NextResponse.json(
      {
        error: "Invalid zoning records",
        accepted: prepared.accepted.length,
        rejected: prepared.rejected,
      },
      { status: 400 }
    );
  }

  if (parsed.data.dry_run) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      accepted: prepared.accepted.length,
      rejected: [],
      records: prepared.accepted.map((record) => ({
        index: record.index,
        companyId: record.companyId,
        jurisdictionId: record.jurisdictionId,
        normalizedSiteAddress: record.normalizedSiteAddress,
        sourceStatus: record.sourceStatus,
      })),
    });
  }

  try {
    const result = await importVerifiedParcelRecords({
      db: getAdminSupabase(),
      records: prepared.accepted,
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      accepted: prepared.accepted.length,
      rejected: [],
      inserted: result.inserted,
      updated: result.updated,
    });
  } catch (error) {
    console.error("[admin/decks/zoning/parcel-records/import] failed", error);
    return NextResponse.json(
      { error: "Zoning parcel record import failed" },
      { status: 500 }
    );
  }
});
