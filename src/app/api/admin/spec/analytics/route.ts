import { NextResponse, type NextRequest } from "next/server";
import { withSpecOperatorApi } from "@/lib/admin/spec-api-auth";
import { getSpecAnalyticsPayload } from "@/lib/admin/spec-analytics-queries";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function readDate(searchParams: URLSearchParams, key: "from" | "to", fallback: string) {
  const value = searchParams.get(key);
  return value && DATE_RE.test(value) ? value : fallback;
}

export const GET = withSpecOperatorApi(async (req: NextRequest) => {
  const defaults = defaultDateRange();
  const from = readDate(req.nextUrl.searchParams, "from", defaults.from);
  const to = readDate(req.nextUrl.searchParams, "to", defaults.to);
  const payload = await getSpecAnalyticsPayload(from, to);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
});
