import { NextResponse, type NextRequest } from "next/server";
import { withSpecOperatorApi } from "@/lib/admin/spec-api-auth";
import {
  buildSpecAnalyticsExport,
  type SpecExportMode,
} from "@/lib/admin/spec-analytics-export";

export const dynamic = "force-dynamic";

function readMode(value: string | null): SpecExportMode {
  return value === "sensitive" ? "sensitive" : "default";
}

export const GET = withSpecOperatorApi(async (req: NextRequest) => {
  const mode = readMode(req.nextUrl.searchParams.get("mode"));
  const result = await buildSpecAnalyticsExport({
    mode,
    from: req.nextUrl.searchParams.get("from"),
    to: req.nextUrl.searchParams.get("to"),
  });
  const body = result.bytes.buffer.slice(
    result.bytes.byteOffset,
    result.bytes.byteOffset + result.bytes.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Type": "application/zip",
    },
  });
});
