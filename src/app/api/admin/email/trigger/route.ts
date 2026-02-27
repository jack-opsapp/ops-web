import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";

const ALLOWED_SLUGS = [
  "lifecycle-emails",
  "bubble-reauth-emails",
  "unverified-emails",
  "newsletter-emails",
  "verify-email-domains",
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { slug, test_email } = await req.json();

    if (!slug || !ALLOWED_SLUGS.includes(slug)) {
      return NextResponse.json(
        { error: `Invalid slug. Allowed: ${ALLOWED_SLUGS.join(", ")}` },
        { status: 400 }
      );
    }

    const body: Record<string, string> = { triggered_by: "admin_dashboard" };
    if (test_email) {
      body.test_email = test_email;
    }

    const edgeFnUrl = `${SUPABASE_URL}/functions/v1/${slug}`;
    const response = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "x-supabase-service-role": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({ status: response.status }));

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error ?? `Edge function returned ${response.status}`, details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to trigger edge function" },
      { status: 500 }
    );
  }
}
