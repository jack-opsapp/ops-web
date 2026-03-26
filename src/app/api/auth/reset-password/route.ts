import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin-sdk";
import { sendPasswordReset } from "@/lib/email/sendgrid";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = body?.email?.trim()?.toLowerCase();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    try {
      const auth = getAdminAuth();
      const resetLink = await auth.generatePasswordResetLink(email, {
        url: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
      });

      await sendPasswordReset({ email, resetLink });
    } catch (error) {
      // Log but don't reveal whether the email exists (prevents enumeration)
      console.error("[reset-password] Error generating/sending reset:", error);
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[reset-password] Request error:", error);
    return NextResponse.json({ ok: true });
  }
}
