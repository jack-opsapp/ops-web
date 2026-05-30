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
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { ClientService } from "@/lib/api/services/client-service";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { OpportunityLifecycleService } from "@/lib/api/services/opportunity-lifecycle-service";
import { buildEmailOpportunityTitle } from "@/lib/email/opportunity-title";
import {
  applyCanonicalLeadEnrichment,
  leadEnrichmentFactsFromImport,
} from "@/lib/email/lead-enrichment";
import { findOpportunityRelationshipMatch } from "@/lib/email/opportunity-relationship-matching";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
} from "@/lib/types/pipeline";
import { getAppUrl } from "@/lib/utils/app-url";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

function buildImportedLeadOpportunityTitle(
  lead: ImportPayload["leads"][number],
  syncProfile: Partial<ImportPayload["syncProfile"]> | undefined
): string {
  return buildEmailOpportunityTitle({
    kind: "estimate",
    candidates: [
      {
        source: "contact",
        name: lead.clientName,
        email: lead.clientEmail,
      },
    ],
    unsafe: {
      emails: syncProfile?.userEmailAddresses,
      domains: syncProfile?.companyDomains,
      platformEmails: syncProfile?.knownPlatformSenders,
    },
  });
}

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

  // Validate connection exists. Runs inside the supabase context so any
  // nested services that call requireSupabase() land on the service-role
  // client, isolated from concurrent requests via AsyncLocalStorage.
  const connection = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );

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
  // runWithSupabase pins the service-role client to this async chain so that
  // every requireSupabase() call inside the 90s+ loop resolves to the right
  // client — even while concurrent requests finish their own overrides.
  after(async () => {
    const bgSupabase = getServiceRoleClient();
    await runWithSupabase(bgSupabase, async () => {
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
      }
    });
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
  // Track lead.id → normalized provider thread id. Import activities are
  // synthetic, but thread/link/image extraction still require real thread ids.
  const threadIdMap = new Map<string, string>();

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

      const providerIds = validateProviderEmailIds({
        boundary: "import_synthetic_activity",
        providerThreadId: lead.threadId,
        providerMessageId: null,
        requireMessageId: false,
      });

      if (!providerIds.ok) {
        logInvalidProviderEmailIds(providerIds, {
          companyId,
          connectionId,
          leadId: lead.id,
          clientEmail: lead.clientEmail,
        });
        result.errors.push(
          `Skipped ${lead.clientEmail}: blank provider thread id`
        );
        continue;
      }

      const providerThreadId = providerIds.providerThreadId;
      threadIdMap.set(lead.id, providerThreadId);
      const enrichmentFacts = leadEnrichmentFactsFromImport({
        contactName: lead.clientName,
        contactEmail: lead.clientEmail,
        contactPhone: lead.clientPhone,
        address: lead.clientAddress,
        estimatedValue: lead.estimatedValue,
        description: lead.description,
        providerThreadId,
        providerMessageId: null,
        extractionSource: "import_payload",
      });

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
            if (lead.clientAddress) updates.address = lead.clientAddress;
          } else {
            // fill_blanks (default)
            if (!existingClient.name && lead.clientName) updates.name = lead.clientName;
            if (!existingClient.email && lead.clientEmail) updates.email = lead.clientEmail;
            if (!existingClient.phone_number && lead.clientPhone) updates.phone_number = lead.clientPhone;
            if (!existingClient.address && lead.clientAddress) updates.address = lead.clientAddress;
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
            address: lead.clientAddress || null,
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

      const relationshipDecision = await findOpportunityRelationshipMatch({
        supabase,
        companyId,
        connectionId,
        providerThreadId,
        clientId,
        facts: {
          contactName: enrichmentFacts.contactName,
          contactEmail: enrichmentFacts.contactEmail,
          contactPhone: enrichmentFacts.contactPhone,
          address: enrichmentFacts.address,
          description: enrichmentFacts.description,
          subject: lead.title ?? lead.description ?? null,
          providerThreadId,
          sourcePlatform: enrichmentFacts.sourcePlatform,
          phaseCEnabled: false,
        },
      });
      const relationshipDecisionRequiresNewOpportunity =
        relationshipDecision.action === "create_new";

      let existingOpps: Array<{ id: string }> | null = null;
      if (
        relationshipDecision.action !== "link" &&
        !relationshipDecisionRequiresNewOpportunity
      ) {
        // Check for existing open opportunity for this client only when P3 has
        // not explicitly rejected client-level reuse for this provider thread.
        const { data } = await supabase
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
        existingOpps = (data ?? null) as Array<{ id: string }> | null;
      }

      let opportunityId: string;

      if (relationshipDecision.action === "link") {
        opportunityId = relationshipDecision.opportunityId;
        await applyCanonicalLeadEnrichment({
          supabase,
          opportunityId,
          clientId: relationshipDecision.clientId ?? clientId,
          facts: enrichmentFacts,
        });
        // Stamp provenance on the reused opportunity. The create branch sets
        // source_email_id, but link / existing-open-opp do not — so a re-used
        // opp dropped its email provenance. Fill-blank only: never overwrite an
        // existing source_email_id with this import's thread id.
        await supabase
          .from("opportunities")
          .update({ source_email_id: providerThreadId })
          .eq("id", opportunityId)
          .is("source_email_id", null);
      } else if (existingOpps && existingOpps.length > 0) {
        opportunityId = existingOpps[0].id;
        await applyCanonicalLeadEnrichment({
          supabase,
          opportunityId,
          clientId,
          facts: enrichmentFacts,
        });
        await supabase
          .from("opportunities")
          .update({ source_email_id: providerThreadId })
          .eq("id", opportunityId)
          .is("source_email_id", null);
      } else {
        const inboundCount = Math.max(0, (lead.correspondenceCount || 0) - (lead.outboundCount || 0));
        const lastMessageDate = lead.lastMessageDate ? new Date(lead.lastMessageDate) : null;
        const isOutbound = (lead.outboundCount || 0) > 0 && inboundCount === 0;

        const opp = await OpportunityService.createOpportunity({
          companyId,
          clientId,
          title: buildImportedLeadOpportunityTitle(lead, payload.syncProfile),
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
          sourceEmailId: providerThreadId,
          quoteDeliveryMethod: null,
          address: lead.clientAddress || null,
          latitude: null,
          longitude: null,
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

        // Patch fields that CreateOpportunity omits
        const patches: Record<string, unknown> = {};
        // stage_entered_at → real timeline, not import date
        if (lastMessageDate) patches.stage_entered_at = lastMessageDate.toISOString();
        // ai_summary → the AI-generated description from the classifier
        if (lead.description) patches.ai_summary = lead.description;
        if (lead.estimatedValue) patches.detected_value = lead.estimatedValue;

        if (Object.keys(patches).length > 0) {
          await supabase
            .from("opportunities")
            .update(patches)
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
          thread_id: providerThreadId,
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
        .eq("email_thread_id", providerThreadId)
        .eq("type", "email")
        .limit(1);

      if (!existingActivity || existingActivity.length === 0) {
        // Mint a deterministic synthetic provider message id for the import
        // shell instead of NULL. The wizard import has no real Gmail message id,
        // but a NULL message id is invisible to steady-sync's dedupe (which keys
        // on `email_message_id`), so a later re-sync of the same thread would
        // re-create the imported correspondence as duplicate activities. The
        // synthetic form `import:<threadId>:<seq>` gives each shell a stable,
        // dedupe-able identity. `activities_email_message_id_unique` is a global
        // partial unique index over non-null values, so the id MUST be unique
        // per activity — the per-thread sequence count is the discriminator,
        // and counting existing email activities on the thread keeps a second
        // wizard run idempotent against the first.
        const { data: priorThreadActivities } = await supabase
          .from("activities")
          .select("id")
          .eq("company_id", companyId)
          .eq("email_thread_id", providerThreadId)
          .eq("type", "email");
        const syntheticSeq = (priorThreadActivities ?? []).length;
        const syntheticMessageId = `import:${providerThreadId}:${syntheticSeq}`;

        const activity = await OpportunityService.createActivity({
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
          emailThreadId: providerThreadId,
          emailMessageId: syntheticMessageId,
          isRead: true,
          fromEmail: lead.clientEmail,
          createdBy: null,
        });
        await OpportunityLifecycleService.recordCorrespondenceEvent({
          supabase,
          companyId,
          opportunityId,
          activityId: activity.id,
          connectionId,
          providerThreadId,
          providerMessageId: syntheticMessageId,
          requireProviderMessageId: false,
          direction: "inbound",
          occurredAt: lead.lastMessageDate
            ? new Date(lead.lastMessageDate)
            : new Date(),
          source: "email_import",
          fromEmail: lead.clientEmail,
          fromName: lead.clientName,
          toEmails: [connection.email],
          ccEmails: [],
          subject: lead.description || "Imported from email pipeline",
          bodyText: lead.description ?? null,
          connectionEmail: connection.email,
          companyDomains: payload.syncProfile?.companyDomains ?? [],
          userEmailAddresses: payload.syncProfile?.userEmailAddresses ?? [],
          knownPlatformSenders: payload.syncProfile?.knownPlatformSenders ?? [],
          contactEmail: lead.clientEmail,
        });
        result.activitiesLogged++;
      }

      // Apply label to thread
      if (labelId) {
        try {
          await provider.applyLabel(providerThreadId, labelId);
          result.labelsApplied++;
        } catch (labelErr) {
          // Non-fatal
          console.error(
            `[email-import] Failed to apply label to thread ${providerThreadId}:`,
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

  // ─── Serialize image-extraction payload ────────────────────────────────────
  // Image extraction is moved to a separate route (/api/integrations/email/
  // extract-images) because the fetch+upload cycle for many attachments can
  // easily exceed this route's 300s maxDuration, leaving jobs stuck in
  // 'importing' forever. We build the opportunity → {threadIds, allowedSenders}
  // map here, serialize it, mark the job complete, then dispatch the
  // extraction in a background after() callback.
  const oppThreadMap = new Map<string, {
    opportunityId: string;
    threadIds: string[];
    allowedSenders: Set<string>;
  }>();
  for (const lead of leads) {
    const oppId = oppMap.get(lead.id);
    if (!oppId) continue;
    const existing = oppThreadMap.get(oppId);
    const threadIds = lead.mergeWithLeadId
      ? lead.mergeWithLeadId.split(",").filter(Boolean)
      : [threadIdMap.get(lead.id) ?? lead.threadId];

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

  const oppThreadPayload = Array.from(oppThreadMap.values()).map((v) => ({
    opportunityId: v.opportunityId,
    threadIds: v.threadIds,
    allowedSenders: Array.from(v.allowedSenders),
  }));

  // ─── Mark job complete BEFORE image extraction dispatches ──────────────────
  // The wizard polls analyze-status and advances past step 4 once status flips
  // to import_complete. Writing the completion here (rather than after image
  // extraction) ensures the wizard never stalls waiting for attachment work.
  // imagesExtracted starts at 0 and grows as the background route finishes.
  await supabase
    .from("gmail_scan_jobs")
    .update({
      status: "import_complete",
      progress: {
        stage: "import_complete",
        percent: 100,
        message: oppThreadPayload.length > 0
          ? "Import complete! Extracting images in background..."
          : "Import complete!",
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

  // ─── Dispatch image extraction as a separate background route ─────────────
  // This runs AFTER the job is marked import_complete so the wizard advances
  // past step 4 regardless of how long extraction takes. The extract-images
  // route has its own 800s budget (Pro plan max) for the fetch+upload cycle
  // and writes imagesExtracted back to result on completion.
  if (oppThreadPayload.length > 0) {
    after(async () => {
      try {
        const res = await fetch(`${getAppUrl()}/api/integrations/email/extract-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            connectionId,
            companyId,
            oppThreadPayload,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(
            `[email-import] extract-images dispatch failed (${res.status}): ${errBody}`
          );
        }
      } catch (err) {
        console.error("[email-import] Failed to dispatch image extraction:", err);
      }
    });
  }
}
