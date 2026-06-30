// src/lib/api/services/conversation-state/attachment-ingest.ts
//
// Phase 2 — the VISION enrichment step. This is SEPARATE from the deterministic
// clean-state layer (which uses no model): it is the only place a paid vision
// call happens, and it is strictly cost-once.
//
// Flow, once per inbound that lands on a thread with attachments:
//   1. Cheap gate: bail unless an inbound activity on the thread has attachments.
//   2. Pull provider attachment metadata for the whole thread (one API call) and
//      persist it to `email_attachments` (idempotent upsert) — this is what lets
//      us fetch a SPECIFIC attachment's bytes later (esp. PDFs).
//   3. Plan (PURE, cost-once): inspectable kind + customer-sent + not-yet-cached.
//   4. For each planned attachment: download bytes -> base64 -> OpenAI vision
//      (image natively / PDF natively) -> persist the verdict to
//      `attachment_inspections`.
//
// The deterministic `buildConversationState` then reads that cache (no vision),
// so an inspected signed estimate makes the accept-detector fire HIGH and the
// lead auto-advances to Won, and a photo carries a summary the drafter uses.
//
// Entirely NON-FATAL: any failure is logged and swallowed so a vision hiccup can
// never break the sync loop. Transient API errors are NOT cached (inspectX
// throws) so they retry on the next inbound instead of permanently sinking the
// signed-estimate path.

import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { SyncProfile } from "@/lib/types/email-connection";
import { EmailService } from "../email-service";
import { fetchOperatorIdentity } from "./operator-identity";
import {
  attachmentInspectionKey,
  inspectImageContent,
  inspectPdfContent,
  planAttachmentInspections,
  type ProviderAttachmentMeta,
} from "./attachment-inspector";

/** Most attachments we'll ever see on one thread — a hard cap so a pathological
 *  thread can never fan out an unbounded number of paid vision calls in one run. */
const MAX_INSPECTIONS_PER_RUN = 10;

/**
 * Ingest the thread's attachment metadata and inspect any new customer image/PDF
 * attachments exactly once. Safe to call on every inbound — the cheap gate and
 * the cost-once cache make repeated calls no-ops once a thread's attachments are
 * inspected. Resolves (never rejects) — failures are logged and swallowed.
 */
export async function ingestAndInspectThreadAttachments(args: {
  connection: EmailConnection;
  providerThreadId: string;
  companyId: string;
}): Promise<void> {
  const { connection, providerThreadId, companyId } = args;
  try {
    const supabase = requireSupabase();

    // 1. Cheap gate — skip the provider call entirely unless an inbound on this
    //    thread actually carries attachments.
    const { data: gateRows } = await supabase
      .from("activities")
      .select("id")
      .eq("company_id", companyId)
      .eq("type", "email")
      .eq("email_thread_id", providerThreadId)
      .eq("direction", "inbound")
      .eq("has_attachments", true)
      .limit(1);
    if (!gateRows || gateRows.length === 0) return;

    // 2. Provider attachment metadata for the whole thread (one call).
    const provider = EmailService.getProvider(connection);
    let metas: Awaited<ReturnType<typeof provider.getAttachmentsFromThread>>;
    try {
      metas = await provider.getAttachmentsFromThread(providerThreadId);
    } catch (err) {
      console.error("[attachment-ingest] getAttachmentsFromThread failed (non-fatal):", err);
      return;
    }
    if (!metas || metas.length === 0) return;

    // Persist metadata (idempotent on company_id, message_id, attachment_id).
    const metaRows = metas.map((m) => ({
      company_id: companyId,
      connection_id: connection.id,
      provider_thread_id: providerThreadId,
      message_id: m.messageId,
      attachment_id: m.attachmentId,
      filename: m.filename || null,
      mime_type: m.mimeType || null,
      size_bytes: typeof m.size === "number" ? m.size : null,
      from_email: (m.fromEmail || "").toLowerCase().trim() || null,
    }));
    const { error: metaErr } = await supabase
      .from("email_attachments")
      .upsert(metaRows, { onConflict: "company_id,message_id,attachment_id" });
    if (metaErr) {
      console.error("[attachment-ingest] email_attachments upsert failed (non-fatal):", metaErr.message);
    }

    // 3. Operator identity (exclude operator-sent attachments) + cached keys (cost-once).
    const operator = await fetchOperatorIdentity(companyId, {
      email: connection.email,
      syncFilters: (connection.syncFilters ?? {}) as SyncProfile,
    });

    const { data: cachedRows } = await supabase
      .from("attachment_inspections")
      .select("message_id, attachment_id")
      .eq("company_id", companyId)
      .eq("provider_thread_id", providerThreadId);
    const cachedKeys = new Set(
      ((cachedRows ?? []) as Array<{ message_id: string; attachment_id: string }>).map((r) =>
        attachmentInspectionKey(r.message_id, r.attachment_id)
      )
    );

    const attachments: ProviderAttachmentMeta[] = metas.map((m) => ({
      messageId: m.messageId,
      attachmentId: m.attachmentId,
      filename: m.filename || "",
      mimeType: m.mimeType || "",
      fromEmail: m.fromEmail || "",
    }));

    const plan = planAttachmentInspections({
      attachments,
      operatorEmails: operator.emails,
      operatorDomains: operator.domains,
      cachedKeys,
    }).slice(0, MAX_INSPECTIONS_PER_RUN);

    // 4. Inspect each planned attachment once, persisting the verdict.
    for (const item of plan) {
      try {
        const bytes = await provider.fetchAttachment(item.messageId, item.attachmentId);
        const base64 = bytes.toString("base64");
        const inspection =
          item.kind === "pdf"
            ? await inspectPdfContent(base64, item.filename)
            : await inspectImageContent(base64, item.mimeType, item.filename);

        // ignoreDuplicates: a concurrent sync may have just cached this — the
        // first writer wins, the cost-once contract holds either way.
        const { error: insErr } = await supabase.from("attachment_inspections").upsert(
          {
            company_id: companyId,
            provider_thread_id: providerThreadId,
            message_id: item.messageId,
            attachment_id: item.attachmentId,
            summary: inspection.summary || null,
            is_signed_estimate: inspection.isSignedEstimate,
            facts: inspection.facts,
            model: inspection.model,
          },
          { onConflict: "company_id,message_id,attachment_id", ignoreDuplicates: true }
        );
        if (insErr) {
          console.error("[attachment-ingest] inspection upsert failed (non-fatal):", insErr.message);
        }
        // A confirmed signed estimate is observable downstream: the cached row
        // (is_signed_estimate=true) drives the accept-detector, and the auto-Won
        // path logs `accept-auto-won` when the lead actually advances.
      } catch (err) {
        // Transient download/API error — NOT cached, so it retries next inbound.
        console.error("[attachment-ingest] inspect failed (non-fatal, will retry):", {
          messageId: item.messageId,
          attachmentId: item.attachmentId,
          err,
        });
      }
    }
  } catch (err) {
    console.error("[attachment-ingest] run failed (non-fatal):", err);
  }
}
