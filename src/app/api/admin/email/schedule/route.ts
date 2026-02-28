import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getEmailScheduleData, getEmailsByDate } from "@/lib/admin/email-queries";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const params = req.nextUrl.searchParams;

  // Date mode: ?date=2026-02-27 → returns emails for that day
  const date = params.get("date");
  if (date) {
    const emails = await getEmailsByDate(date);
    return NextResponse.json({ emails });
  }

  // Month mode: ?month=3&year=2026 → returns schedule data for that month
  const month = parseInt(params.get("month") ?? "", 10);
  const year = parseInt(params.get("year") ?? "", 10);

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "Provide ?month=N&year=YYYY or ?date=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const days = await getEmailScheduleData(year, month);
  return NextResponse.json({ days });
});
