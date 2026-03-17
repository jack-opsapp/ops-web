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

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    await updateProgress(i, `Importing lead ${i + 1} of ${leads.length}...`);

    try {
      let clientId: string;

      // Handle merge: if this lead merges with another, use that client
      if (lead.mergeWithLeadId && mergeMap.has(lead.mergeWithLeadId)) {
        clientId = mergeMap.get(lead.mergeWithLeadId)!;
      } else if (lead.action === "link" && lead.existingClientId) {
        clientId = lead.existingClientId;
      } else if (
        lead.action === "create_subclient" &&
        lead.existingClientId
      ) {
        clientId = lead.existingClientId;
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
      };
      const stage = stageMap[lead.stage] || OpportunityStage.NewLead;

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
        const opp = await OpportunityService.createOpportunity({
          companyId,
          clientId,
          title: lead.description || `Email inquiry from ${lead.clientName}`,
          stage,
          source: OpportunitySource.Email,
          contactName: lead.clientName,
          contactEmail: lead.clientEmail,
          contactPhone: lead.clientPhone,
          description: lead.description,
          assignedTo: null,
          priority: null,
          estimatedValue: lead.estimatedValue,
          actualValue: null,
          winProbability: stage === "new_lead" ? 20 : stage === "quoted" ? 50 : 30,
          expectedCloseDate: null,
          actualCloseDate: null,
          projectId: null,
          lostReason: null,
          lostNotes: null,
          quoteDeliveryMethod: null,
          address: null,
          tags: ["email-import", "pipeline-wizard"],
        });
        opportunityId = opp.id;
        result.leadsCreated++;
      }

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
    .select("sync_filters")
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
}
