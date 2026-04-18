/**
 * OPS Web - Post-Import Image Extraction
 *
 * POST /api/integrations/email/extract-images
 * Body: {
 *   jobId: string,
 *   connectionId: string,
 *   companyId: string,
 *   oppThreadPayload: Array<{
 *     opportunityId: string,
 *     threadIds: string[],
 *     allowedSenders: string[],  // Only grab images from client + sub-contact emails
 *   }>,
 * }
 *
 * Runs in the background via after(); pulls image attachments from email
 * threads and uploads them to Supabase Storage. Split from the main import
 * route because the attachment fetch+upload cycle can easily exceed the
 * import route's 300s maxDuration budget, leaving import jobs stuck in
 * 'importing' status indefinitely. This route has its own 800s budget
 * (Vercel Pro max) and writes back to gmail_scan_jobs.result.imagesExtracted
 * when finished.
 *
 * Uses runWithSupabase (not setSupabaseOverride) so the service-role client
 * binding survives the entire async extraction chain without being clobbered
 * by concurrent request handlers.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 800; // Pro plan max

interface OppThreadEntry {
  opportunityId: string;
  threadIds: string[];
  allowedSenders: string[];
}

export async function POST(request: NextRequest) {
  const { jobId, connectionId, companyId, oppThreadPayload } =
    (await request.json()) as {
      jobId?: string;
      connectionId?: string;
      companyId?: string;
      oppThreadPayload?: OppThreadEntry[];
    };

  if (!jobId || !connectionId || !companyId || !Array.isArray(oppThreadPayload)) {
    return NextResponse.json(
      { error: "jobId, connectionId, companyId, oppThreadPayload required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const connection = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  // Fire-and-forget. The import route dispatches this route and returns;
  // extraction runs in the background with its own 800s budget and writes
  // imagesExtracted back to the existing gmail_scan_jobs row on completion.
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
      try {
        await runExtraction(jobId, connection, oppThreadPayload, bgSupabase);
      } catch (err) {
        console.error("[extract-images] Extraction failed:", err);
      }
    });
  });

  return NextResponse.json({ ok: true });
}

// ─── Background extraction logic ────────────────────────────────────────────

async function runExtraction(
  jobId: string,
  connection: NonNullable<Awaited<ReturnType<typeof EmailService.getConnection>>>,
  oppThreadPayload: OppThreadEntry[],
  supabase: SupabaseClient
) {
  const provider = EmailService.getProvider(connection);

  const MAX_IMAGES_PER_LEAD = 10;
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB (matches Supabase bucket limit)
  const IMAGE_CONCURRENCY = 3;

  let totalExtracted = 0;

  for (const entry of oppThreadPayload) {
    const { opportunityId, threadIds, allowedSenders } = entry;
    const allowedSenderSet = new Set(allowedSenders.map((s) => s.toLowerCase().trim()));

    try {
      // Collect image attachment metadata from all threads
      const allImageMeta: Array<{
        messageId: string;
        attachmentId: string;
        filename: string;
        mimeType: string;
        size: number;
        fromEmail: string;
      }> = [];

      for (const tid of threadIds) {
        try {
          const images = await provider.getImageAttachmentsFromThread(tid);
          allImageMeta.push(...images);
        } catch (err) {
          console.warn(`[extract-images] Failed to scan thread ${tid} for images:`, err);
        }
      }

      // Only keep images sent BY the client or their sub-contacts — not our own outbound
      const clientImages = allImageMeta.filter((img) =>
        allowedSenderSet.has((img.fromEmail || "").toLowerCase().trim())
      );

      if (clientImages.length === 0) continue;

      // Deduplicate by attachmentId and enforce per-lead cap + size limit
      const seen = new Set<string>();
      const uniqueImages = clientImages
        .filter((img) => {
          if (seen.has(img.attachmentId)) return false;
          if (img.size > MAX_IMAGE_SIZE) return false;
          seen.add(img.attachmentId);
          return true;
        })
        .slice(0, MAX_IMAGES_PER_LEAD);

      console.log(
        `[extract-images] Opportunity ${opportunityId}: found ${uniqueImages.length} images across ${threadIds.length} threads`
      );

      // Download + upload in batches
      const imageUrls: string[] = [];

      for (let i = 0; i < uniqueImages.length; i += IMAGE_CONCURRENCY) {
        const batch = uniqueImages.slice(i, i + IMAGE_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (img) => {
            const buffer = await provider.fetchAttachment(img.messageId, img.attachmentId);

            const ext = img.filename.split(".").pop()?.toLowerCase() || "jpg";
            const storagePath = `email-imports/${opportunityId}/${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}.${ext}`;

            const { error: uploadErr } = await supabase.storage
              .from("images")
              .upload(storagePath, buffer, {
                contentType: img.mimeType,
                upsert: false,
              });

            if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

            const { data: urlData } = supabase.storage
              .from("images")
              .getPublicUrl(storagePath);

            return urlData.publicUrl;
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled") {
            imageUrls.push(r.value);
            totalExtracted++;
          } else {
            console.warn(`[extract-images] Image upload failed:`, r.reason);
          }
        }
      }

      // Store image URLs on the opportunity
      if (imageUrls.length > 0) {
        await supabase
          .from("opportunities")
          .update({ images: imageUrls })
          .eq("id", opportunityId);
      }
    } catch (err) {
      console.warn(
        `[extract-images] Image extraction failed for opportunity ${opportunityId}:`,
        err
      );
    }
  }

  console.log(
    `[extract-images] Complete: ${totalExtracted} images uploaded across ${oppThreadPayload.length} opportunities`
  );

  // Merge imagesExtracted into the existing gmail_scan_jobs.result payload.
  // The import route already wrote import_complete earlier; this is an
  // incremental update to surface the final photo count.
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (job?.result) {
    const existingResult = job.result as Record<string, unknown>;
    await supabase
      .from("gmail_scan_jobs")
      .update({
        result: {
          ...existingResult,
          imagesExtracted: totalExtracted,
        },
      })
      .eq("id", jobId);
  }
}
