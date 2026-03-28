import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getNewsletters, upsertNewsletter } from "@/lib/admin/email-queries";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const newsletters = await getNewsletters();
    return NextResponse.json(newsletters);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch newsletters" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body.month || !body.year) {
      return NextResponse.json(
        { error: "month and year are required" },
        { status: 400 }
      );
    }
    const newsletter = await upsertNewsletter(body);
    return NextResponse.json(newsletter, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create newsletter" },
      { status: 500 }
    );
  }
}
