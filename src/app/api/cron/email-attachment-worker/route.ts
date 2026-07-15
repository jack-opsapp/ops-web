/**
 * GET /api/cron/email-attachment-worker
 *
 * Claims and processes the durable exact-message attachment queue. Provider
 * reads are bounded inside the worker; this route only authenticates Vercel,
 * installs the service-role Supabase context, and reports the batch outcome.
 */

import { NextRequest, NextResponse } from "next/server";

import { runSupabaseEmailAttachmentWorker } from "@/lib/api/services/email-attachments/attachment-runtime";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = getServiceRoleClient();

  try {
    const result = await runWithSupabase(supabase, () =>
      runSupabaseEmailAttachmentWorker(supabase, { leaseSeconds: 360 })
    );
    const ok = result.failed === 0;

    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown email attachment worker error";
    console.error("[cron/email-attachment-worker]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
