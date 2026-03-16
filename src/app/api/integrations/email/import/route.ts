/**
 * OPS Web - Email Import Endpoint
 *
 * POST /api/integrations/email/import
 * Imports confirmed leads from the wizard Step 4.
 * Creates clients, opportunities, activity records, and thread links.
 * Applies "OPS Pipeline" label to imported threads.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { ClientService } from "@/lib/api/services/client-service";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { EmailMatchingServiceV2 } from "@/lib/api/services/email-matching-service-v2";
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
} from "@/lib/types/pipeline";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";

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
  setSupabaseOverride(supabase);

  try {
    const connection = await EmailService.getConnection(connectionId);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

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

    // Track merge groups: mergeWithLeadId → primary lead's clientId
    const mergeMap = new Map<string, string>();

    for (const lead of leads) {
      try {
        let clientId: string;

        // Handle merge: if this lead merges with another, use that client
        if (lead.mergeWithLeadId && mergeMap.has(lead.mergeWithLeadId)) {
          clientId = mergeMap.get(lead.mergeWithLeadId)!;
        } else if (lead.action === "link" && lead.existingClientId) {
          // Link to existing client
          clientId = lead.existingClientId;
        } else if (
          lead.action === "create_subclient" &&
          lead.existingClientId
        ) {
          // Create sub-client under existing client
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
          // Create new client
          // First check for existing client to avoid duplicates
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
          // Create opportunity with stage from AI analysis
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

        // Create opportunity_email_threads record
        await supabase.from("opportunity_email_threads").insert({
          opportunity_id: opportunityId,
          thread_id: lead.threadId,
          connection_id: connectionId,
        });

        // Create activity record
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

    return NextResponse.json(result);
  } catch (err) {
    console.error("[email-import]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
