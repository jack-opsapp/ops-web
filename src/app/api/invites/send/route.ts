/**
 * POST /api/invites/send
 *
 * Sends team invite emails via SendGrid.
 * Replaces the Bubble /wf/send_invite workflow.
 *
 * Body: { emails: string[], companyId: string }
 * Auth: Firebase JWT in Authorization header
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import sgMail from "@sendgrid/mail";

function initSendGrid() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("Missing SENDGRID_API_KEY");
  sgMail.setApiKey(key);
}

export async function POST(req: NextRequest) {
  // Verify caller is authenticated
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await verifyFirebaseToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { emails, companyId } = await req.json() as {
    emails: string[];
    companyId: string;
  };

  if (!emails?.length || !companyId) {
    return NextResponse.json({ error: "Missing emails or companyId" }, { status: 400 });
  }

  // Fetch company name for the email
  const supabase = getServiceRoleClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .single();

  const companyName = company?.name ?? "Your company";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

  try {
    initSendGrid();
    const from = process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co";

    const messages = emails.map((email) => ({
      to: email,
      from: { email: from, name: companyName },
      subject: `You've been invited to join ${companyName} on OPS`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #417394;">Join ${companyName} on OPS</h2>
          <p>You've been invited to join the ${companyName} team on OPS — field service management built for trades.</p>
          <a href="${appUrl}/register"
             style="display:inline-block;padding:12px 24px;background:#417394;color:#fff;border-radius:4px;text-decoration:none;">
            Accept Invite &amp; Create Account
          </a>
          <p style="color:#777;font-size:12px;margin-top:24px;">
            If you weren't expecting this, you can ignore this email.
          </p>
        </div>
      `,
    }));

    await sgMail.send(messages);

    return NextResponse.json({ success: true, invitesSent: emails.length });
  } catch (err) {
    console.error("[invites/send] SendGrid error:", err);
    return NextResponse.json({ error: "Failed to send invites" }, { status: 502 });
  }
}
