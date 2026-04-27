import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { addSuppression } from "@/lib/email/suppressions";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readToken(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("t");
  if (fromQuery) return fromQuery;

  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    try {
      const body = (await req.json()) as { token?: unknown };
      return typeof body?.token === "string" ? body.token : null;
    } catch {
      return null;
    }
  }
  if (ctype.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return params.get("token") ?? params.get("t") ?? null;
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = await readToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, reason: "missing_token" }, { status: 400 });
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: 400 });
  }

  try {
    await addSuppression({
      email: verified.email,
      list: verified.list,
      reason: verified.list === "global" ? "unsubscribe" : "group_unsubscribe",
      source: "webhook",
      metadata: { via: "unsubscribe_link" },
    });

    // For newsletter list values, also flip the legacy `is_active` /
    // `unsubscribed_at` columns on `newsletter_subscribers` so existing
    // sender code that queries that table also stops sending.
    if (verified.list === "field_notes" || verified.list === "blog") {
      const supabase = getServiceRoleClient();
      await supabase
        .from("newsletter_subscribers")
        .update({
          unsubscribed_at: new Date().toISOString(),
          is_active: false,
        })
        .eq("email", verified.email);
    }
  } catch (err) {
    console.error("[unsubscribe] addSuppression failed", err);
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: verified.email, list: verified.list });
}
