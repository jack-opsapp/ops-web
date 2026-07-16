/**
 * GET /api/cron/email-attachment-worker
 *
 * Runs bounded durable email maintenance: exact-message attachment ingestion,
 * converted-project photo projection, and assignment-triggered review drafts
 * for contact-form leads. This route only authenticates Vercel, installs the
 * service-role Supabase context, and reports the combined batch outcome.
 */

import { NextRequest, NextResponse } from "next/server";

import { runSupabaseEmailAttachmentWorker } from "@/lib/api/services/email-attachments/attachment-runtime";
import { runSupabaseEmailAssignmentContactFormDraftWorker } from "@/lib/api/services/email-assignment-contact-form-draft-runtime";
import { runSupabaseEmailConversionPhotoWorker } from "@/lib/api/services/email-conversion-photo-runtime";
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
    const {
      attachmentIngestion,
      conversionPhotos,
      assignmentContactFormDrafts,
    } = await runWithSupabase(supabase, async () => {
      const attachmentIngestion = await runSupabaseEmailAttachmentWorker(
        supabase,
        {
          leaseSeconds: 360,
        }
      );
      const conversionPhotos = await runSupabaseEmailConversionPhotoWorker(
        supabase,
        {
          leaseSeconds: 360,
        }
      );
      const assignmentContactFormDrafts =
        await runSupabaseEmailAssignmentContactFormDraftWorker(supabase, {
          leaseSeconds: 360,
          limit: 3,
        });
      return {
        attachmentIngestion,
        conversionPhotos,
        assignmentContactFormDrafts,
      };
    });
    const ok =
      attachmentIngestion.failed === 0 &&
      attachmentIngestion.errors.length === 0 &&
      conversionPhotos.failed === 0 &&
      conversionPhotos.errors.length === 0 &&
      assignmentContactFormDrafts.failed === 0 &&
      assignmentContactFormDrafts.errors.length === 0;

    return NextResponse.json(
      {
        ok,
        ...attachmentIngestion,
        conversionPhotos,
        assignmentContactFormDrafts,
      },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown email attachment worker error";
    console.error("[cron/email-attachment-worker]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
