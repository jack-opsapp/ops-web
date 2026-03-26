/**
 * OPS Web - Email Import Endpoint
 *
 * POST /api/integrations/email/import
 * Imports confirmed leads from the wizard Step 4.
 * Creates clients, opportunities, activity records, and thread links.
 * Applies "OPS Pipeline" label to imported threads.
 *
 * Runs as a background job via after() — returns a jobId immediately
 * and continues processing server-side. Survives browser close.
 * Progress is tracked in gmail_scan_jobs and polled via analyze-status.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { ClientService } from "@/lib/api/services/client-service";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
} from "@/lib/types/pipeline";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const payload: ImportPayload = await request.json();
  const { connectionId, companyId, leads } = payload;

  if (!connectionId || !companyId || !leads?.length) {
    return NextResponse.json(
      { error: "connectionId, companyId, and leads required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  // Validate connection exists
  setSupabaseOverride(supabase);
  let connection;
  try {
    connection = await EmailService.getConnection(connectionId);
  } finally {
    setSupabaseOverride(null);
  }

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  // ─── Create import job ──────────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from("gmail_scan_jobs")
    .insert({
      connection_id: connectionId,
      company_id: companyId,
      status: "importing",
      progress: {
        stage: "importing",
        percent: 0,
        message: `Starting import of ${leads.length} leads...`,
        totalLeads: leads.length,
        processedLeads: 0,
        clientsCreated: 0,
        leadsCreated: 0,
        labelsApplied: 0,
      },
    })
    .select()
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: "Failed to create import job" },
      { status: 500 }
    );
  }

  // Save import job ID to connection for wizard state restoration
  const existingFilters = (connection.syncFilters || {}) as Record<string, unknown>;
  await supabase
    .from("email_connections")
    .update({
      sync_filters: {
        ...existingFilters,
        lastImportJobId: job.id,
        wizardStep: 4,
      },
    })
    .eq("id", connectionId);

  // ─── Run import in background ─────────────────────────────────────────────
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    setSupabaseOverride(bgSupabase);
    try {
      await runImport(job.id, payload, connection, bgSupabase);
    } catch (err) {
      console.error("[email-import] Import failed:", err);
      await bgSupabase
        .from("gmail_scan_jobs")
        .update({
          status: "import_error",
          error_message: (err as Error).message,
        })
        .eq("id", job.id);
    } finally {
      setSupabaseOverride(null);
    }
  });

  return NextResponse.json({ jobId: job.id });
}

// ─── Background import logic ──────────────────────────────────────────────────

async function runImport(
  jobId: string,
  payload: ImportPayload,
  connection: Awaited<ReturnType<typeof EmailService.getConnection>>,
  supabase: SupabaseClient
) {
  const { connectionId, companyId, leads } = payload;

  if (!connection) throw new Error("Connection not found");

  const provider = EmailService.getProvider(connection);

  // Get or create the OPS Pipeline label
  let labelId = connection.opsLabelId || "";
  if (!labelId) {
    try {
      const existingLabels = await provider.listLabels();
      const existing = existingLabels.find((l) => l.name === "OPS Pipeline");
      labelId = existing?.id || (await provider.createLabel("OPS Pipeline"));
    } catch (err) {
      console.error("[email-import] Failed to create/find label:", err);
    }
  }

  const result: ImportResult = {
    clientsCreated: 0,
    leadsCreated: 0,
    activitiesLogged: 0,
    labelsApplied: 0,
    imagesExtracted: 0,
    errors: [],
  };

  const updateProgress = async (processedLeads: number, message: string) => {
    const percent = Math.round((processedLeads / leads.length) * 95); // Cap at 95% until fully done
    await supabase
      .from("gmail_scan_jobs")
      .update({
        progress: {
          stage: "importing",
          percent,
          message,
          totalLeads: leads.length,
          processedLeads,
          clientsCreated: result.clientsCreated,
          leadsCreated: result.leadsCreated,
          labelsApplied: result.labelsApplied,
        },
      })
      .eq("id", jobId);
  };

  // Track merge groups: mergeWithLeadId → primary lead's clientId
  const mergeMap = new Map<string, string>();
  // Track lead.id → opportunityId for post-import image extraction
  const oppMap = new Map<string, string>();

  // Sort leads so merge targets (primary leads) appear before dependents.
  // Leads without mergeWithLeadId come first, followed by leads that merge into others.
  const sortedLeads = [...leads].sort((a, b) => {
    const aIsMerge = a.mergeWithLeadId ? 1 : 0;
    const bIsMerge = b.mergeWithLeadId ? 1 : 0;
    return aIsMerge - bIsMerge;
  });

  for (let i = 0; i < sortedLeads.length; i++) {
    const lead = sortedLeads[i];
    await updateProgress(i, `Importing lead ${i + 1} of ${leads.length}...`);

    try {
      // ── Handle discard — skip this lead entirely ──────────────────────
      if (lead.action === "discard") {
        console.log(`[email-import] DISCARD: Skipping lead "${lead.clientName}" (${lead.clientEmail})`);
        continue;
      }

      // Use local variables to avoid mutating the payload object
      let effectiveAction = lead.action;
      let effectiveExistingClientId = lead.existingClientId;

      // ── Handle discard_existing — soft-delete existing, create new ────
      if (effectiveAction === "discard_existing" && effectiveExistingClientId) {
        console.log(`[email-import] DISCARD_EXISTING: Soft-deleting client ${effectiveExistingClientId}, creating new for "${lead.clientName}"`);
        await ClientService.softDeleteClient(effectiveExistingClientId);
        effectiveAction = "create_new";
        effectiveExistingClientId = null;
      }

      let clientId: string;

      // ── Handle merge — update existing client with imported data ───────
      if (effectiveAction === "merge") {
        if (!effectiveExistingClientId) {
          const msg = `Merge failed for "${lead.clientName}": no existing client ID`;
          console.error(`[email-import] ${msg}`);
          result.errors.push(msg);
          continue;
        }
        console.log(`[email-import] MERGE (${lead.mergeMode || "fill_blanks"}): "${lead.clientName}" → existing client ${effectiveExistingClientId}`);

        const { data: existingClient } = await supabase
          .from("clients")
          .select("*")
          .eq("id", effectiveExistingClientId)
          .single();

        if (existingClient) {
          const updates: Record<string, unknown> = {};

          if (lead.mergeMode === "overwrite") {
            if (lead.clientName) updates.name = lead.clientName;
            if (lead.clientEmail) updates.email = lead.clientEmail;
            if (lead.clientPhone) updates.phone_number = lead.clientPhone;
          } else {
            // fill_blanks (default)
            if (!existingClient.name && lead.clientName) updates.name = lead.clientName;
            if (!existingClient.email && lead.clientEmail) updates.email = lead.clientEmail;
            if (!existingClient.phone_number && lead.clientPhone) updates.phone_number = lead.clientPhone;
          }

          if (Object.keys(updates).length > 0) {
            const { error: updateErr } = await supabase
              .from("clients")
              .update(updates)
              .eq("id", effectiveExistingClientId);

            if (updateErr) {
              console.error(`[email-import] Failed to merge client: ${updateErr.message}`);
            }
          }
        }

        clientId = effectiveExistingClientId;
      } else if (lead.mergeWithLeadId && mergeMap.has(lead.mergeWithLeadId)) {
        // Handle dedup merge: if this lead merges with another, use that client
        clientId = mergeMap.get(lead.mergeWithLeadId)!;
      } else if (effectiveAction === "link" && effectiveExistingClientId) {
        clientId = effectiveExistingClientId;
      } else if (
        effectiveAction === "create_subclient" &&
        effectiveExistingClientId
      ) {
        clientId = effectiveExistingClientId;
        try {
          const { data: existingSub } = await supabase
            .from("sub_clients")
            .select("id")
            .eq("client_id", clientId)
            .ilike("email", lead.clientEmail.toLowerCase())
            .is("deleted_at", null)
            .limit(1);

          if (!existingSub || existingSub.length === 0) {
            await ClientService.createSubClient(
              {
                name: lead.clientName,
                clientId,
                email: lead.clientEmail.toLowerCase(),
              },
              companyId
            );
          }
        } catch (subErr) {
          console.error(
            `[email-import] Failed to create sub-client for ${lead.clientEmail}:`,
            subErr
          );
        }
      } else {
        // Create new client — check for existing first to avoid duplicates
        const { data: existingClients } = await supabase
          .from("clients")
          .select("id")
          .eq("company_id", companyId)
          .ilike("email", lead.clientEmail.toLowerCase())
          .is("deleted_at", null)
          .limit(1);

        if (existingClients && existingClients.length > 0) {
          clientId = existingClients[0].id;
        } else {
          const newClient = await ClientService.createClient({
            name: lead.clientName,
            companyId,
            email: lead.clientEmail.toLowerCase(),
            phoneNumber: lead.clientPhone || null,
          });
          clientId = newClient.id;
          result.clientsCreated++;
        }
      }

      // Track for merge
      mergeMap.set(lead.id, clientId);

      // Map stage string to OpportunityStage enum value
      const stageMap: Record<string, OpportunityStage> = {
        new_lead: OpportunityStage.NewLead,
        qualifying: OpportunityStage.Qualifying,
        quoting: OpportunityStage.Quoting,
        quoted: OpportunityStage.Quoted,
        follow_up: OpportunityStage.FollowUp,
        negotiation: OpportunityStage.Negotiation,
        won: OpportunityStage.Won,
        lost: OpportunityStage.Lost,
        discarded: OpportunityStage.Discarded,
      };
      const stage = stageMap[lead.stage] || OpportunityStage.NewLead;
      const isTerminal = stage === OpportunityStage.Won || stage === OpportunityStage.Lost || stage === OpportunityStage.Discarded;

      // Check for existing open opportunity for this client
      const { data: existingOpps } = await supabase
        .from("opportunities")
        .select("id")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .in("stage", [
          "new_lead",
          "qualifying",
          "quoting",
          "quoted",
          "follow_up",
          "negotiation",
        ])
        .is("deleted_at", null)
        .limit(1);

      let opportunityId: string;

      if (existingOpps && existingOpps.length > 0) {
        opportunityId = existingOpps[0].id;
      } else {
        const inboundCount = Math.max(0, (lead.correspondenceCount || 0) - (lead.outboundCount || 0));
        const lastMessageDate = lead.lastMessageDate ? new Date(lead.lastMessageDate) : null;
        const isOutbound = (lead.outboundCount || 0) > 0 && inboundCount === 0;

        const opp = await OpportunityService.createOpportunity({
          companyId,
          clientId,
          title: lead.title || lead.description || `Email inquiry from ${lead.clientName}`,
          stage,
          source: OpportunitySource.Email,
          contactName: lead.clientName,
          contactEmail: lead.clientEmail,
          contactPhone: lead.clientPhone,
          description: lead.description,
          assignedTo: null,
          priority: null,
          estimatedValue: lead.estimatedValue,
          actualValue: stage === OpportunityStage.Won ? lead.estimatedValue : null,
          winProbability: isTerminal
            ? (stage === OpportunityStage.Won ? 100 : 0)
            : stage === OpportunityStage.Quoted ? 50 : stage === OpportunityStage.NewLead ? 20 : 30,
          expectedCloseDate: null,
          actualCloseDate: isTerminal ? (lead.actualCloseDate ? new Date(lead.actualCloseDate) : new Date()) : null,
          projectId: null,
          lostReason: null,
          lostNotes: null,
          quoteDeliveryMethod: null,
          address: lead.clientAddress || null,
          correspondenceCount: lead.correspondenceCount || 0,
          outboundCount: lead.outboundCount || 0,
          inboundCount,
          lastInboundAt: !isOutbound && lastMessageDate ? lastMessageDate : null,
          lastOutboundAt: isOutbound && lastMessageDate ? lastMessageDate : null,
          lastMessageDirection: isOutbound ? "out" : "in",
          tags: ["email-import", "pipeline-wizard"],
        });
        opportunityId = opp.id;
        result.leadsCreated++;

        // Set stage_entered_at to last correspondence date so "days in stage"
        // reflects real timeline, not import date. CreateOpportunity omits this
        // field (defaults to now()), so we patch it directly.
        if (lastMessageDate) {
          await supabase
            .from("opportunities")
            .update({ stage_entered_at: lastMessageDate.toISOString() })
            .eq("id", opportunityId);
        }
      }

      // Track opportunity for post-import image extraction
      if (opportunityId) oppMap.set(lead.id, opportunityId);

      // Create sub-clients from detected sub-contacts (spouse, PM, site super, etc.)
      if (lead.subContacts?.length) {
        for (const sc of lead.subContacts) {
          try {
            const { data: existingSub } = await supabase
              .from("sub_clients")
              .select("id")
              .eq("client_id", clientId)
              .ilike("email", sc.email.toLowerCase())
              .is("deleted_at", null)
              .limit(1);

            if (!existingSub || existingSub.length === 0) {
              await ClientService.createSubClient(
                {
                  name: sc.name,
                  clientId,
                  email: sc.email.toLowerCase(),
                },
                companyId
              );
            }
          } catch (subErr) {
            console.error(`[email-import] Failed to create sub-contact ${sc.email}:`, subErr);
          }
        }
      }

      // Create opportunity_email_threads record — ON CONFLICT DO NOTHING
      // The UNIQUE(thread_id, connection_id) constraint prevents duplicates
      await supabase.from("opportunity_email_threads").upsert(
        {
          opportunity_id: opportunityId,
          thread_id: lead.threadId,
          connection_id: connectionId,
        },
        { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
      );

      // Check for existing activity before creating (idempotency)
      const { data: existingActivity } = await supabase
        .from("activities")
        .select("id")
        .eq("company_id", companyId)
        .eq("opportunity_id", opportunityId)
        .eq("email_thread_id", lead.threadId)
        .eq("type", "email")
        .limit(1);

      if (!existingActivity || existingActivity.length === 0) {
        await OpportunityService.createActivity({
          companyId,
          opportunityId,
          clientId,
          estimateId: null,
          invoiceId: null,
          type: ActivityType.Email,
          subject: lead.description || `Imported from email pipeline`,
          content: `Pipeline import: ${lead.clientName} — stage: ${lead.stage}`,
          outcome: null,
          direction: "inbound",
          durationMinutes: null,
          emailThreadId: lead.threadId,
          isRead: true,
          fromEmail: lead.clientEmail,
          createdBy: null,
        });
        result.activitiesLogged++;
      }

      // Apply label to thread
      if (labelId) {
        try {
          await provider.applyLabel(lead.threadId, labelId);
          result.labelsApplied++;
        } catch (labelErr) {
          // Non-fatal
          console.error(
            `[email-import] Failed to apply label to thread ${lead.threadId}:`,
            labelErr
          );
        }
      }
    } catch (err) {
      const msg = `Failed to import lead ${lead.clientName}: ${err instanceof Error ? err.message : "Unknown error"}`;
      console.error(`[email-import] ${msg}`);
      result.errors.push(msg);
    }
  }

  console.log(
    `[email-import] Complete: ${result.clientsCreated} clients, ${result.leadsCreated} leads, ${result.activitiesLogged} activities, ${result.labelsApplied} labels`
  );

  // ─── Extract images from email threads ──────────────────────────────────────
  // After all leads are created, scan their threads for image attachments,
  // download from Gmail, upload to Supabase Storage, and link to the opportunity.
  await updateProgress(leads.length, "Extracting images from emails...");

  // imagesExtracted tracked via result.imagesExtracted
  const MAX_IMAGES_PER_LEAD = 10;
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB (matches Supabase bucket limit)
  const IMAGE_CONCURRENCY = 3;

  // Collect all unique threadIds + allowed sender emails per opportunity
  const oppThreadMap = new Map<string, {
    opportunityId: string;
    threadIds: string[];
    allowedSenders: Set<string>; // Only grab images from client + sub-contact emails
  }>();
  for (const lead of leads) {
    const oppId = oppMap.get(lead.id);
    if (!oppId) continue;
    const existing = oppThreadMap.get(oppId);
    const threadIds = lead.mergeWithLeadId
      ? lead.mergeWithLeadId.split(",").filter(Boolean)
      : [lead.threadId];

    // Build allowlist: client email + all sub-contact emails
    const senderEmails = new Set<string>();
    if (lead.clientEmail) senderEmails.add(lead.clientEmail.toLowerCase().trim());
    if (lead.subContacts) {
      for (const sc of lead.subContacts) {
        if (sc.email) senderEmails.add(sc.email.toLowerCase().trim());
      }
    }

    if (existing) {
      for (const tid of threadIds) {
        if (!existing.threadIds.includes(tid)) existing.threadIds.push(tid);
      }
      for (const email of senderEmails) existing.allowedSenders.add(email);
    } else {
      oppThreadMap.set(oppId, { opportunityId: oppId, threadIds: [...threadIds], allowedSenders: senderEmails });
    }
  }

  for (const [, { opportunityId, threadIds, allowedSenders }] of oppThreadMap) {
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
          console.warn(`[email-import] Failed to scan thread ${tid} for images:`, err);
        }
      }

      // Only keep images sent BY the client or their sub-contacts — not our own outbound images
      const clientImages = allImageMeta.filter((img) => allowedSenders.has(img.fromEmail));

      if (clientImages.length === 0) continue;

      // Deduplicate by attachmentId and limit
      const seen = new Set<string>();
      const uniqueImages = clientImages.filter((img) => {
        if (seen.has(img.attachmentId)) return false;
        if (img.size > MAX_IMAGE_SIZE) return false;
        seen.add(img.attachmentId);
        return true;
      }).slice(0, MAX_IMAGES_PER_LEAD);

      console.log(`[email-import] Opportunity ${opportunityId}: found ${uniqueImages.length} images across ${threadIds.length} threads`);

      // Download and upload in batches
      const imageUrls: string[] = [];

      for (let i = 0; i < uniqueImages.length; i += IMAGE_CONCURRENCY) {
        const batch = uniqueImages.slice(i, i + IMAGE_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (img) => {
            const buffer = await provider.fetchAttachment(img.messageId, img.attachmentId);

            // Upload to Supabase Storage
            const ext = img.filename.split(".").pop()?.toLowerCase() || "jpg";
            const storagePath = `email-imports/${opportunityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
            result.imagesExtracted++;
          } else {
            console.warn(`[email-import] Image upload failed:`, r.reason);
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
      console.warn(`[email-import] Image extraction failed for opportunity ${opportunityId}:`, err);
    }
  }

  console.log(`[email-import] Image extraction complete: ${result.imagesExtracted} images uploaded`);

  // ─── Mark job complete ──────────────────────────────────────────────────────
  await supabase
    .from("gmail_scan_jobs")
    .update({
      status: "import_complete",
      progress: {
        stage: "import_complete",
        percent: 100,
        message: "Import complete!",
        totalLeads: leads.length,
        processedLeads: leads.length,
        clientsCreated: result.clientsCreated,
        leadsCreated: result.leadsCreated,
        labelsApplied: result.labelsApplied,
      },
      result,
    })
    .eq("id", jobId);

  // ─── Update connection state ──────────────────────────────────────────────
  const { data: currentConn } = await supabase
    .from("email_connections")
    .select("sync_filters, user_id, company_id")
    .eq("id", connectionId)
    .single();

  const existingFilters = (currentConn?.sync_filters as Record<string, unknown>) || {};

  await supabase
    .from("email_connections")
    .update({
      sync_filters: {
        ...existingFilters,
        lastImportJobId: jobId,
        wizardStep: 5,
        importComplete: true,
      },
    })
    .eq("id", connectionId);

  // ─── Create notification for background completion ────────────────────────
  if (currentConn?.user_id) {
    await supabase.from("notifications").insert({
      user_id: currentConn.user_id,
      company_id: currentConn.company_id || companyId,
      type: "mention",
      title: "Pipeline import complete",
      body: `Created ${result.clientsCreated} client${result.clientsCreated !== 1 ? "s" : ""} and ${result.leadsCreated} lead${result.leadsCreated !== 1 ? "s" : ""}`,
      is_read: false,
      persistent: true,
      action_url: "/settings?tab=integrations",
      action_label: "Activate Sync",
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error("[email-import] Failed to create notification:", notifErr.message);
    });
  }
}
