/**
 * OPS Web - Email Import Endpoint
 *
 * POST /api/integrations/email/import
 * Imports confirmed leads from the wizard Step 4.
 * Creates clients, opportunities, activity records, and thread links.
 * Queues a durable "OPS Pipeline" label operation for imported threads.
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
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
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
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import {
  approveEmailImportPayload,
  EmailImportApprovalError,
  fingerprintEmailImportPayload,
} from "@/lib/email/email-import-approval";
import {
  completeEmailImportJob,
  createOrResumeEmailImportJob,
  EmailImportJobAccessError,
  loadAuthorizedEmailImportJob,
  loadEmailImportSourceForActor,
} from "@/lib/email/email-import-job-access";
import { assignPersonalMailboxLead } from "@/lib/email/personal-mailbox-lead-assignment";

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

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const directCode = (error as { code?: unknown }).code;
  if (typeof directCode === "string") return directCode;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const causeCode = (cause as { code?: unknown }).code;
  return typeof causeCode === "string" ? causeCode : null;
}

function importDate(
  value: string | null | undefined,
  field: string
): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} timestamp`);
  }
  return date;
}

function buildImportSourceKey({
  provider,
  connectionId,
  logicalThreadKey,
  providerThreadId,
  isMessageScopedForm,
}: {
  provider: string;
  connectionId: string;
  logicalThreadKey: string;
  providerThreadId: string;
  isMessageScopedForm: boolean;
}): string {
  const contactFormPrefix = "contact-form-message:";
  const providerMessageId = logicalThreadKey.startsWith(contactFormPrefix)
    ? logicalThreadKey.slice(contactFormPrefix.length)
    : "";
  if (isMessageScopedForm && !providerMessageId) {
    throw new Error("Message-scoped import is missing its provider message ID");
  }
  const kind = isMessageScopedForm ? "message" : "thread";
  const providerIdentity = isMessageScopedForm
    ? providerMessageId
    : providerThreadId;
  return `email:${provider.trim().toLowerCase()}:${connectionId}:${kind}:${providerIdentity}`;
}

interface ExactImportMessage {
  providerMessageId: string;
  providerThreadId: string;
  fromEmail: string;
  subject: string;
  occurredAt: Date;
  direction: "inbound" | "outbound";
}

function exactImportMessages({
  lead,
  companyId,
  connectionId,
}: {
  lead: ImportPayload["leads"][number];
  companyId: string;
  connectionId: string;
}): ExactImportMessage[] {
  if (!Array.isArray(lead.emails) || lead.emails.length === 0) return [];

  const messages: ExactImportMessage[] = [];
  const seenProviderMessageIds = new Set<string>();

  for (const [index, message] of lead.emails.entries()) {
    const providerIds = validateProviderEmailIds({
      boundary: "import_provider_activity",
      providerThreadId: message?.providerThreadId,
      providerMessageId: message?.id,
      requireMessageId: true,
    });
    if (!providerIds.ok) {
      logInvalidProviderEmailIds(providerIds, {
        companyId,
        connectionId,
        leadId: lead.id,
        messageIndex: index,
      });
      throw new Error(`Message ${index + 1} has no provider ID`);
    }

    const providerMessageId = providerIds.providerMessageId!;
    if (seenProviderMessageIds.has(providerMessageId)) continue;
    seenProviderMessageIds.add(providerMessageId);

    if (message.direction !== "inbound" && message.direction !== "outbound") {
      throw new Error(`Message ${index + 1} has no valid direction`);
    }

    const occurredAt = importDate(message.date, `message ${index + 1}`);
    if (!occurredAt) {
      throw new Error(`Message ${index + 1} has no date`);
    }

    messages.push({
      providerMessageId,
      providerThreadId: providerIds.providerThreadId,
      fromEmail: extractEmailAddress(message.from).trim().toLowerCase(),
      subject: message.subject?.trim() || "Imported email",
      occurredAt,
      direction: message.direction,
    });
  }

  return messages;
}

async function requireImportOpportunityEdit({
  supabase,
  actorUserId,
  opportunityId,
}: {
  supabase: SupabaseClient;
  actorUserId: string;
  opportunityId: string;
}) {
  const { data, error } = await supabase.rpc(
    "authorize_opportunity_action_as_system",
    {
      p_actor_user_id: actorUserId,
      p_opportunity_id: opportunityId,
      p_action: "edit",
    }
  );
  if (error || data !== true) {
    throw new Error(
      `Imported lead edit is no longer authorized: ${error?.message ?? "access denied"}`
    );
  }
}

export async function POST(request: NextRequest) {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid import request" },
      { status: 400 }
    );
  }
  const submittedRecord =
    submitted && typeof submitted === "object" && !Array.isArray(submitted)
      ? (submitted as Record<string, unknown>)
      : null;
  const connectionId =
    typeof submittedRecord?.connectionId === "string"
      ? submittedRecord.connectionId
      : "";
  const claimedCompanyId =
    typeof submittedRecord?.companyId === "string"
      ? submittedRecord.companyId
      : "";

  if (!connectionId || !claimedCompanyId) {
    return NextResponse.json(
      { error: "Mailbox and company are required" },
      { status: 400 }
    );
  }

  const actorResolution = await resolveEmailRouteActor(request, {
    claimedCompanyId,
  });
  if (!actorResolution.ok) return actorResolution.response;

  const supabase = getServiceRoleClient();
  let job: Awaited<ReturnType<typeof createOrResumeEmailImportJob>>;
  try {
    const source = await loadEmailImportSourceForActor({
      supabase,
      actorUserId: actorResolution.actor.userId,
      connectionId,
    });
    if (
      source.companyId !== actorResolution.actor.companyId ||
      source.companyId !== claimedCompanyId ||
      source.connectionId !== connectionId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const approvedPayload = approveEmailImportPayload({
      submitted,
      sourceResult: source.result,
      expectedCompanyId: source.companyId,
      expectedConnectionId: source.connectionId,
      expectedConnectionEmail: source.connectionEmail,
    });
    const approvalFingerprint = fingerprintEmailImportPayload(approvedPayload);
    job = await createOrResumeEmailImportJob({
      supabase,
      actorUserId: actorResolution.actor.userId,
      sourceScanJobId: source.sourceScanJobId,
      approvedPayload,
      approvalFingerprint,
    });
    if (job.shouldDispatch && !job.resumed) {
      const selectedClientIds = Array.from(
        new Set(
          approvedPayload.leads
            .map((lead) => lead.existingClientId)
            .filter((id): id is string => Boolean(id))
        )
      );
      if (selectedClientIds.length > 0) {
        const { data: selectedClients, error: selectedClientsError } =
          await supabase
            .from("clients")
            .select("id")
            .eq("company_id", source.companyId)
            .in("id", selectedClientIds)
            .is("deleted_at", null);
        if (selectedClientsError) {
          return NextResponse.json(
            { error: "Selected customers could not be verified" },
            { status: 500 }
          );
        }
        const verifiedIds = new Set(
          (selectedClients ?? []).map((client) => client.id)
        );
        if (selectedClientIds.some((id) => !verifiedIds.has(id))) {
          return NextResponse.json(
            { error: "One or more selected customers are unavailable" },
            { status: 400 }
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof EmailImportApprovalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof EmailImportJobAccessError) {
      console.error("[email-import] Approval authorization failed", {
        reason: error.reason,
        databaseCode: error.databaseCode,
        message: error.message,
      });
      const invalidSelection =
        error.databaseCode === "23503" || error.databaseCode === "22023";
      const accessDenied = error.databaseCode === "42501";
      const noLongerAvailable = ["P0002", "23505", "40001", "55000"].includes(
        error.databaseCode ?? ""
      );
      return NextResponse.json(
        {
          error: invalidSelection
            ? "One or more selected customers are unavailable"
            : "Import approval is no longer available",
        },
        {
          status: invalidSelection
            ? 400
            : accessDenied
              ? 403
              : noLongerAvailable || error.reason !== "rpc_failed"
                ? 409
                : 500,
        }
      );
    }
    throw error;
  }

  // ─── Run import in background ─────────────────────────────────────────────
  // runWithSupabase pins the service-role client to this async chain so that
  // every requireSupabase() call inside the 90s+ loop resolves to the right
  // client — even while concurrent requests finish their own overrides.
  if (job.shouldDispatch) {
    after(async () => {
      const bgSupabase = getServiceRoleClient();
      await runWithSupabase(bgSupabase, async () => {
        try {
          await runImport(job.jobId, bgSupabase);
        } catch (err) {
          console.error("[email-import] Import failed:", err);
          await bgSupabase
            .from("gmail_scan_jobs")
            .update({
              status: "import_error",
              error_message:
                err instanceof Error ? err.message : "Import failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.jobId)
            .eq("status", "importing");
        }
      });
    });
  }

  return NextResponse.json({ jobId: job.jobId });
}

// ─── Background import logic ──────────────────────────────────────────────────

async function runImport(jobId: string, supabase: SupabaseClient) {
  const authorizedJob = await loadAuthorizedEmailImportJob({ supabase, jobId });
  const payload = authorizedJob.approvedPayload;
  const { connectionId, companyId, leads } = payload;
  const connection = await EmailService.getConnection(connectionId);

  if (
    !connection ||
    connection.id !== connectionId ||
    connection.companyId !== companyId ||
    connection.type !== authorizedJob.connectionType ||
    (connection.type === "individual"
      ? connection.userId !== authorizedJob.connectionOwnerUserId
      : authorizedJob.connectionOwnerUserId !== null) ||
    !connection.syncEnabled ||
    connection.status !== "active"
  ) {
    throw new Error("Import mailbox authorization changed");
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
        updated_at: new Date().toISOString(),
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
      const currentAuthorization = await loadAuthorizedEmailImportJob({
        supabase,
        jobId,
      });
      if (
        currentAuthorization.actorUserId !== authorizedJob.actorUserId ||
        currentAuthorization.companyId !== companyId ||
        currentAuthorization.connectionId !== connectionId ||
        currentAuthorization.approvalFingerprint !==
          authorizedJob.approvalFingerprint
      ) {
        throw new Error("Import authorization changed");
      }

      // ── Handle discard — skip this lead entirely ──────────────────────
      if (lead.action === "discard") {
        console.log(
          `[email-import] DISCARD: Skipping lead "${lead.clientName}" (${lead.clientEmail})`
        );
        continue;
      }

      const providerIds = validateProviderEmailIds({
        boundary: "import_synthetic_activity",
        providerThreadId: lead.providerThreadId ?? lead.threadId,
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
      let providerMessages = exactImportMessages({
        lead,
        companyId,
        connectionId,
      });
      const logicalThreadKey = lead.threadId;
      const isMessageScopedForm = logicalThreadKey !== providerThreadId;
      if (providerMessages.length === 0 && !isMessageScopedForm) {
        throw new Error("Reanalyze the mailbox, then import again");
      }
      if (
        providerMessages.length > 0 &&
        providerMessages.length !== (lead.correspondenceCount || 0)
      ) {
        throw new Error("Email history changed. Reanalyze the mailbox");
      }
      if (
        providerMessages.length === 0 &&
        isMessageScopedForm &&
        lead.correspondenceCount !== 1
      ) {
        throw new Error("Email history changed. Reanalyze the mailbox");
      }
      const sourceThreadKey = buildImportSourceKey({
        provider: connection.provider,
        connectionId,
        logicalThreadKey,
        providerThreadId,
        isMessageScopedForm,
      });
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
      const pendingDiscardClientId =
        effectiveAction === "discard_existing" && effectiveExistingClientId
          ? effectiveExistingClientId
          : null;

      // The selected client is discarded only after every lead, thread, and
      // message write succeeds. A mid-import error must never destroy the old
      // customer record before its replacement is durable.
      if (pendingDiscardClientId) {
        console.log(
          `[email-import] DISCARD_EXISTING: preparing replacement for client ${pendingDiscardClientId}`
        );
        effectiveAction = "create_new";
        effectiveExistingClientId = null;
      }

      let clientId: string;
      let createdClientId: string | null = null;

      // ── Handle merge — update existing client with imported data ───────
      if (effectiveAction === "merge") {
        if (!effectiveExistingClientId) {
          const msg = `Merge failed for "${lead.clientName}": no existing client ID`;
          console.error(`[email-import] ${msg}`);
          result.errors.push(msg);
          continue;
        }
        console.log(
          `[email-import] MERGE (${lead.mergeMode || "fill_blanks"}): "${lead.clientName}" → existing client ${effectiveExistingClientId}`
        );

        const { data: existingClient } = await supabase
          .from("clients")
          .select("*")
          .eq("id", effectiveExistingClientId)
          .eq("company_id", companyId)
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
            if (!existingClient.name && lead.clientName)
              updates.name = lead.clientName;
            if (!existingClient.email && lead.clientEmail)
              updates.email = lead.clientEmail;
            if (!existingClient.phone_number && lead.clientPhone)
              updates.phone_number = lead.clientPhone;
            if (!existingClient.address && lead.clientAddress)
              updates.address = lead.clientAddress;
          }

          if (Object.keys(updates).length > 0) {
            const { error: updateErr } = await supabase
              .from("clients")
              .update(updates)
              .eq("id", effectiveExistingClientId)
              .eq("company_id", companyId);

            if (updateErr) {
              console.error(
                `[email-import] Failed to merge client: ${updateErr.message}`
              );
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
            .eq("company_id", companyId)
            .eq("client_id", clientId)
            .ilike("email", escapeIlikeLiteral(lead.clientEmail.toLowerCase()))
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
          .ilike("email", escapeIlikeLiteral(lead.clientEmail.toLowerCase()))
          .is("deleted_at", null)
          .limit(pendingDiscardClientId ? 20 : 1);

        const reusableClient = (existingClients ?? []).find(
          (candidate) => candidate.id !== pendingDiscardClientId
        );
        if (reusableClient) {
          clientId = reusableClient.id;
        } else {
          const newClient = await ClientService.createClient({
            name: lead.clientName,
            companyId,
            email: lead.clientEmail.toLowerCase(),
            phoneNumber: lead.clientPhone || null,
            address: lead.clientAddress || null,
          });
          clientId = newClient.id;
          createdClientId = newClient.id;
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
      const isTerminal =
        stage === OpportunityStage.Won ||
        stage === OpportunityStage.Lost ||
        stage === OpportunityStage.Discarded;
      const inboundCount = Math.max(
        0,
        (lead.correspondenceCount || 0) - (lead.outboundCount || 0)
      );
      const lastMessageDate = importDate(lead.lastMessageDate, "last message");
      const suppliedLastInboundAt = importDate(
        lead.lastInboundAt,
        "last inbound"
      );
      const suppliedLastOutboundAt = importDate(
        lead.lastOutboundAt,
        "last outbound"
      );
      const timestampDirection =
        suppliedLastInboundAt && suppliedLastOutboundAt
          ? suppliedLastOutboundAt.getTime() > suppliedLastInboundAt.getTime()
            ? "outbound"
            : suppliedLastInboundAt.getTime() > suppliedLastOutboundAt.getTime()
              ? "inbound"
              : null
          : suppliedLastOutboundAt
            ? "outbound"
            : suppliedLastInboundAt
              ? "inbound"
              : null;
      const activityDirection: "inbound" | "outbound" =
        timestampDirection ??
        lead.lastMessageDirection ??
        ((lead.outboundCount || 0) > 0 && inboundCount === 0
          ? "outbound"
          : "inbound");
      const isOutbound = activityDirection === "outbound";
      const lastInboundAt =
        suppliedLastInboundAt ??
        (inboundCount > 0 && !isOutbound ? lastMessageDate : null);
      const lastOutboundAt =
        suppliedLastOutboundAt ??
        ((lead.outboundCount || 0) > 0 && isOutbound ? lastMessageDate : null);

      if (providerMessages.length === 0) {
        const messageId = logicalThreadKey.slice(
          "contact-form-message:".length
        );
        const formProviderIds = validateProviderEmailIds({
          boundary: "import_message_scoped_form",
          providerThreadId,
          providerMessageId: messageId,
          requireMessageId: true,
        });
        if (!formProviderIds.ok || !lastMessageDate) {
          if (!formProviderIds.ok) {
            logInvalidProviderEmailIds(formProviderIds, {
              companyId,
              connectionId,
              leadId: lead.id,
            });
          }
          throw new Error("Reanalyze the mailbox, then import again");
        }
        providerMessages = [
          {
            providerMessageId: formProviderIds.providerMessageId!,
            providerThreadId: formProviderIds.providerThreadId,
            fromEmail: isOutbound ? connection.email : lead.clientEmail,
            subject: lead.description || "Imported email",
            occurredAt: lastMessageDate,
            direction: activityDirection,
          },
        ];
      }
      const importedProviderThreadIds = Array.from(
        new Set([
          providerThreadId,
          ...providerMessages.map((message) => message.providerThreadId),
        ])
      );

      const relationshipDecision = await findOpportunityRelationshipMatch({
        supabase,
        companyId,
        connectionId,
        providerThreadId: isMessageScopedForm ? null : providerThreadId,
        clientId,
        facts: {
          contactName: enrichmentFacts.contactName,
          contactEmail: enrichmentFacts.contactEmail,
          contactPhone: enrichmentFacts.contactPhone,
          address: enrichmentFacts.address,
          description: enrichmentFacts.description,
          subject: lead.title ?? lead.description ?? null,
          providerThreadId: isMessageScopedForm ? null : providerThreadId,
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
      let opportunityAggregatesSeededByImport = false;
      let opportunityCreatedForImport = false;

      if (relationshipDecision.action === "link") {
        opportunityId = relationshipDecision.opportunityId;
        clientId = relationshipDecision.clientId ?? clientId;
        mergeMap.set(lead.id, clientId);
        await requireImportOpportunityEdit({
          supabase,
          actorUserId: authorizedJob.actorUserId,
          opportunityId,
        });
        await applyCanonicalLeadEnrichment({
          supabase,
          opportunityId,
          clientId,
          facts: enrichmentFacts,
          companyId,
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
        await requireImportOpportunityEdit({
          supabase,
          actorUserId: authorizedJob.actorUserId,
          opportunityId,
        });
        await applyCanonicalLeadEnrichment({
          supabase,
          opportunityId,
          clientId,
          facts: enrichmentFacts,
          companyId,
        });
        await supabase
          .from("opportunities")
          .update({ source_email_id: providerThreadId })
          .eq("id", opportunityId)
          .is("source_email_id", null);
      } else {
        let createdOpportunity = false;
        try {
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
            priority: null,
            estimatedValue: lead.estimatedValue,
            actualValue:
              stage === OpportunityStage.Won ? lead.estimatedValue : null,
            winProbability: isTerminal
              ? stage === OpportunityStage.Won
                ? 100
                : 0
              : stage === OpportunityStage.Quoted
                ? 50
                : stage === OpportunityStage.NewLead
                  ? 20
                  : 30,
            expectedCloseDate: null,
            actualCloseDate: isTerminal
              ? lead.actualCloseDate
                ? new Date(lead.actualCloseDate)
                : new Date()
              : null,
            projectId: null,
            lostReason: null,
            lostNotes: null,
            sourceEmailId: providerThreadId,
            sourceThreadKey,
            quoteDeliveryMethod: null,
            address: lead.clientAddress || null,
            latitude: null,
            longitude: null,
            correspondenceCount: lead.correspondenceCount || 0,
            outboundCount: lead.outboundCount || 0,
            inboundCount,
            lastInboundAt,
            lastOutboundAt,
            lastMessageDirection: isOutbound ? "out" : "in",
            tags: ["email-import", "pipeline-wizard"],
          });
          opportunityId = opp.id;
          createdOpportunity = true;
          opportunityCreatedForImport = true;
          opportunityAggregatesSeededByImport = true;
        } catch (createError) {
          if (databaseErrorCode(createError) !== "23505") {
            throw createError;
          }

          const { data: winner, error: winnerError } = await supabase
            .from("opportunities")
            .select("id, client_id")
            .eq("company_id", companyId)
            .eq("source_thread_key", sourceThreadKey)
            .maybeSingle();
          if (winnerError) {
            throw new Error(
              `Failed to recover concurrent opportunity: ${winnerError.message}`
            );
          }
          if (!winner?.id) {
            throw new Error(
              "Opportunity source-key conflict has no same-company winner"
            );
          }
          if (!winner.client_id) {
            throw new Error(
              "Concurrent opportunity winner has no canonical client"
            );
          }
          opportunityId = winner.id as string;
          opportunityCreatedForImport = true;
          // The source-key winner came from the same import path and therefore
          // already seeded its aggregate correspondence counts.
          opportunityAggregatesSeededByImport = true;
          const winnerClientId = winner.client_id as string;

          // Both concurrent imports can miss the pre-create client lookup. If
          // this attempt created the losing client, use the existing guarded
          // merge RPC to re-point every relationship and preserve an audit
          // pointer. Never soft-delete by assumption or touch a client that
          // this request did not create.
          if (createdClientId && createdClientId !== winnerClientId) {
            const { data: mergeResult, error: mergeError } = await supabase.rpc(
              "execute_client_merge_guarded",
              {
                p_company_id: companyId,
                p_winner_id: winnerClientId,
                p_loser_id: createdClientId,
                p_merge_key: `email-import-client-race:${companyId}:${sourceThreadKey}:${createdClientId}`,
                p_field_fill: {},
                p_confirmed_overrides: {},
                p_run_id: jobId,
              }
            );
            const mergeOutcome = mergeResult as {
              applied?: boolean;
              guard_reason?: string;
              error_code?: string;
            } | null;
            const mergeAccepted =
              mergeOutcome?.applied === true ||
              mergeOutcome?.guard_reason === "duplicate_applied_merge";
            if (mergeError || !mergeAccepted) {
              throw new Error(
                `Failed to reconcile concurrent client: ${
                  mergeError?.message ??
                  mergeOutcome?.error_code ??
                  mergeOutcome?.guard_reason ??
                  "guarded merge was not applied"
                }`
              );
            }
            result.clientsCreated = Math.max(0, result.clientsCreated - 1);
          }
          clientId = winnerClientId;
          mergeMap.set(lead.id, clientId);
          console.warn("[email-import] lead-dedupe-hit", {
            companyId,
            sourceThreadKey,
            opportunityId,
            clientId,
          });
        }
        if (createdOpportunity) result.leadsCreated++;

        if (
          opportunityCreatedForImport &&
          authorizedJob.connectionType === "individual"
        ) {
          const { data: assignmentSnapshot, error: assignmentSnapshotError } =
            await supabase
              .from("opportunities")
              .select("assigned_to, assignment_version")
              .eq("id", opportunityId)
              .eq("company_id", companyId)
              .maybeSingle();
          if (assignmentSnapshotError || !assignmentSnapshot) {
            throw new Error(
              `Failed to load imported lead assignment: ${assignmentSnapshotError?.message ?? "lead not found"}`
            );
          }
          const assignmentVersion = Number(
            assignmentSnapshot.assignment_version ?? 0
          );
          if (!Number.isInteger(assignmentVersion) || assignmentVersion < 0) {
            throw new Error("Imported lead assignment version is invalid");
          }
          await assignPersonalMailboxLead(
            {
              connectionType: authorizedJob.connectionType,
              connectionId,
              connectionOwnerId: authorizedJob.connectionOwnerUserId,
              opportunityId,
              expectedAssignmentVersion: assignmentVersion,
              expectedAssignedTo:
                typeof assignmentSnapshot.assigned_to === "string"
                  ? assignmentSnapshot.assigned_to
                  : null,
              providerThreadId,
              ingestionSource: "email_import",
            },
            supabase
          );
        }

        await requireImportOpportunityEdit({
          supabase,
          actorUserId: authorizedJob.actorUserId,
          opportunityId,
        });

        // Patch fields that CreateOpportunity omits
        const patches: Record<string, unknown> = {};
        // stage_entered_at → real timeline, not import date
        if (lastMessageDate)
          patches.stage_entered_at = lastMessageDate.toISOString();
        // ai_summary → the AI-generated description from the classifier
        if (lead.description) {
          patches.ai_summary = lead.description;
          patches.ai_summary_updated_at = new Date().toISOString();
        }
        if (lead.estimatedValue) patches.detected_value = lead.estimatedValue;
        if (Object.keys(patches).length > 0) {
          const { error: patchError } = await supabase
            .from("opportunities")
            .update(patches)
            .eq("id", opportunityId)
            .eq("company_id", companyId);
          if (patchError) {
            throw new Error(
              `Failed to persist imported opportunity metadata: ${patchError.message}`
            );
          }
        }
      }

      // Preserve the logical ingestion identity independently of the raw
      // provider thread. Fill only so later correspondence cannot replace the
      // opportunity's original source key.
      const { error: sourceKeyError } = await supabase
        .from("opportunities")
        .update({ source_thread_key: sourceThreadKey })
        .eq("id", opportunityId)
        .eq("company_id", companyId)
        .is("source_thread_key", null);
      if (sourceKeyError) {
        throw new Error(
          `Failed to persist logical email source key: ${sourceKeyError.message}`
        );
      }

      // Create sub-clients from detected sub-contacts (spouse, PM, site super, etc.)
      if (lead.subContacts?.length) {
        for (const sc of lead.subContacts) {
          try {
            const { data: existingSub } = await supabase
              .from("sub_clients")
              .select("id")
              .eq("company_id", companyId)
              .eq("client_id", clientId)
              .ilike("email", escapeIlikeLiteral(sc.email.toLowerCase()))
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
            console.error(
              `[email-import] Failed to create sub-contact ${sc.email}:`,
              subErr
            );
          }
        }
      }

      // Ordinary replies inherit their provider-thread relationship. Contact
      // form submissions deliberately do not: one Gmail thread can contain
      // unrelated customers, while the logical source key remains message-
      // scoped on the opportunity.
      if (!isMessageScopedForm) {
        for (const importedProviderThreadId of importedProviderThreadIds) {
          const { error: threadLinkError } = await supabase
            .from("opportunity_email_threads")
            .upsert(
              {
                opportunity_id: opportunityId,
                thread_id: importedProviderThreadId,
                connection_id: connectionId,
              },
              { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
            );
          if (threadLinkError) {
            throw new Error(
              `Failed to persist provider thread relationship: ${threadLinkError.message}`
            );
          }
          const { data: canonicalThreadLink, error: canonicalThreadLinkError } =
            await supabase
              .from("opportunity_email_threads")
              .select("opportunity_id")
              .eq("thread_id", importedProviderThreadId)
              .eq("connection_id", connectionId)
              .limit(1)
              .maybeSingle();
          if (
            canonicalThreadLinkError ||
            canonicalThreadLink?.opportunity_id !== opportunityId
          ) {
            throw new Error(
              `Provider thread already belongs to another opportunity: ${canonicalThreadLinkError?.message ?? canonicalThreadLink?.opportunity_id ?? "missing owner"}`
            );
          }
        }
      }

      if (providerMessages.length > 0) {
        // New wizard imports preserve every provider message identity from the
        // analysis scan. Dedupe each message independently so importing an old
        // message can never suppress a newer message from the same thread.
        for (const message of providerMessages) {
          const { data: existingActivities, error: existingActivityError } =
            await supabase
              .from("activities")
              .select("id, opportunity_id, client_id, is_read")
              .eq("company_id", companyId)
              .eq("email_connection_id", connectionId)
              .eq("email_message_id", message.providerMessageId)
              .eq("type", "email")
              .limit(1);
          if (existingActivityError) {
            throw new Error(
              `Failed to check imported message: ${existingActivityError.message}`
            );
          }

          let existingActivity = (existingActivities ?? [])[0] as
            | {
                id: string;
                opportunity_id: string | null;
                client_id: string | null;
                is_read: boolean | null;
              }
            | undefined;

          if (
            existingActivity?.client_id &&
            existingActivity.client_id !== clientId
          ) {
            throw new Error(
              `Message ${message.providerMessageId} is linked to another client`
            );
          }

          if (existingActivity && !existingActivity.opportunity_id) {
            // A prior sync can persist an exact provider activity before lead
            // matching finishes. Adopt that row with a compare-and-set so a
            // concurrent matcher cannot silently move it between leads.
            let adoptionQuery = supabase
              .from("activities")
              .update({
                opportunity_id: opportunityId,
                client_id: clientId,
              })
              .eq("id", existingActivity.id)
              .eq("company_id", companyId)
              .eq("email_connection_id", connectionId)
              .is("opportunity_id", null);
            adoptionQuery = existingActivity.client_id
              ? adoptionQuery.eq("client_id", clientId)
              : adoptionQuery.is("client_id", null);
            const { data: adoptedActivity, error: adoptionError } =
              await adoptionQuery
                .select("id, opportunity_id, client_id, is_read")
                .maybeSingle();
            if (adoptionError) {
              throw new Error(
                `Failed to attach imported message: ${adoptionError.message}`
              );
            }

            if (adoptedActivity) {
              existingActivity = adoptedActivity as {
                id: string;
                opportunity_id: string | null;
                client_id: string | null;
                is_read: boolean | null;
              };
            } else {
              const { data: racedActivity, error: racedActivityError } =
                await supabase
                  .from("activities")
                  .select("id, opportunity_id, client_id, is_read")
                  .eq("id", existingActivity.id)
                  .eq("company_id", companyId)
                  .eq("email_connection_id", connectionId)
                  .maybeSingle();
              if (racedActivityError || !racedActivity) {
                throw new Error(
                  `Failed to confirm imported message ownership: ${racedActivityError?.message ?? "message not found"}`
                );
              }
              existingActivity = racedActivity as {
                id: string;
                opportunity_id: string | null;
                client_id: string | null;
                is_read: boolean | null;
              };
            }
          }

          if (
            existingActivity?.opportunity_id === opportunityId &&
            !existingActivity.client_id
          ) {
            const { data: adoptedClient, error: adoptedClientError } =
              await supabase
                .from("activities")
                .update({ client_id: clientId })
                .eq("id", existingActivity.id)
                .eq("company_id", companyId)
                .eq("email_connection_id", connectionId)
                .eq("opportunity_id", opportunityId)
                .is("client_id", null)
                .select("id, opportunity_id, client_id, is_read")
                .maybeSingle();
            if (adoptedClientError) {
              throw new Error(
                `Failed to attach imported message client: ${adoptedClientError.message}`
              );
            }
            if (adoptedClient) {
              existingActivity = adoptedClient as {
                id: string;
                opportunity_id: string | null;
                client_id: string | null;
                is_read: boolean | null;
              };
            } else {
              const { data: racedClient, error: racedClientError } =
                await supabase
                  .from("activities")
                  .select("id, opportunity_id, client_id, is_read")
                  .eq("id", existingActivity.id)
                  .eq("company_id", companyId)
                  .eq("email_connection_id", connectionId)
                  .maybeSingle();
              if (racedClientError || !racedClient) {
                throw new Error(
                  `Failed to confirm imported message client: ${racedClientError?.message ?? "message not found"}`
                );
              }
              existingActivity = racedClient as {
                id: string;
                opportunity_id: string | null;
                client_id: string | null;
                is_read: boolean | null;
              };
            }
          }

          if (
            existingActivity &&
            (existingActivity.opportunity_id !== opportunityId ||
              existingActivity.client_id !== clientId)
          ) {
            throw new Error(
              `Message ${message.providerMessageId} is linked to another lead`
            );
          }

          const fromEmail =
            message.fromEmail ||
            (message.direction === "outbound"
              ? connection.email
              : lead.clientEmail);
          const toEmails =
            message.direction === "outbound"
              ? [lead.clientEmail]
              : [connection.email];
          let activityId = existingActivity?.id ?? null;
          let activityIsRead = existingActivity?.is_read === true;

          if (!activityId) {
            const activity = await OpportunityService.createActivity({
              companyId,
              opportunityId,
              clientId,
              estimateId: null,
              invoiceId: null,
              type: ActivityType.Email,
              subject: message.subject,
              content: null,
              outcome: null,
              direction: message.direction,
              durationMinutes: null,
              emailThreadId: message.providerThreadId,
              emailMessageId: message.providerMessageId,
              emailConnectionId: connectionId,
              isRead: true,
              fromEmail,
              toEmails,
              occurredAt: message.occurredAt,
              createdBy: null,
            });
            activityId = activity.id;
            activityIsRead = true;
            result.activitiesLogged++;
          }

          // The database trigger owns normal attachment enqueueing. This
          // conflict-safe insert also covers imports running during a rolling
          // deploy without resetting a completed or in-flight scan.
          const { error: attachmentScanError } = await supabase
            .from("email_attachment_scans")
            .upsert(
              {
                company_id: companyId,
                connection_id: connectionId,
                activity_id: activityId,
                provider_thread_id: message.providerThreadId,
                message_id: message.providerMessageId,
                status: "pending",
              },
              {
                onConflict: "activity_id",
                ignoreDuplicates: true,
              }
            );
          if (attachmentScanError) {
            throw new Error(
              `Failed to queue imported message attachments: ${attachmentScanError.message}`
            );
          }

          await OpportunityLifecycleService.recordCorrespondenceEvent({
            supabase,
            companyId,
            opportunityId,
            activityId,
            connectionId,
            providerThreadId: message.providerThreadId,
            providerMessageId: message.providerMessageId,
            requireProviderMessageId: true,
            direction: message.direction,
            occurredAt: message.occurredAt,
            source: "email_import",
            applyOpportunityProjection: !opportunityAggregatesSeededByImport,
            fromEmail,
            fromName:
              message.direction === "inbound" &&
              fromEmail.toLowerCase() === lead.clientEmail.toLowerCase()
                ? lead.clientName
                : null,
            toEmails,
            ccEmails: [],
            subject: message.subject,
            bodyText: null,
            connectionEmail: connection.email,
            companyDomains: payload.syncProfile?.companyDomains ?? [],
            userEmailAddresses: payload.syncProfile?.userEmailAddresses ?? [],
            knownPlatformSenders:
              payload.syncProfile?.knownPlatformSenders ?? [],
            contactEmail: lead.clientEmail,
          });

          if (!opportunityAggregatesSeededByImport) {
            const { data: projectionRows, error: projectionError } =
              await supabase.rpc("apply_opportunity_correspondence_event", {
                p_company_id: companyId,
                p_opportunity_id: opportunityId,
                p_connection_id: connectionId,
                p_provider_message_id: message.providerMessageId,
              });
            if (projectionError || !projectionRows) {
              throw new Error(
                `Failed to update lead correspondence: ${projectionError?.message ?? "no result"}`
              );
            }
          }

          await EmailThreadService.upsertFromEmail({
            companyId,
            connectionId,
            providerThreadId: message.providerThreadId,
            email: {
              id: message.providerMessageId,
              threadId: message.providerThreadId,
              from: fromEmail,
              fromName:
                message.direction === "inbound" &&
                fromEmail.toLowerCase() === lead.clientEmail.toLowerCase()
                  ? lead.clientName
                  : "",
              to: toEmails,
              cc: [],
              subject: message.subject,
              snippet: "",
              bodyText: "",
              date: message.occurredAt,
              labelIds: [],
              isRead: activityIsRead,
              hasAttachments: false,
              sizeEstimate: 0,
            },
            direction: message.direction,
            opportunityId,
            clientId,
            markClassificationDirty: true,
          });
        }
      }

      // Provider mutations run only from the durable operation worker after
      // the import job commits. The import request/background callback never
      // holds provider state or performs a label write directly.
      for (const importedProviderThreadId of importedProviderThreadIds) {
        const { data: labelIntentQueued, error: labelIntentError } =
          await supabase.rpc(
            "enqueue_email_import_provider_operation_as_system",
            {
              p_job_id: jobId,
              p_provider_thread_id: importedProviderThreadId,
            }
          );
        if (labelIntentError || labelIntentQueued !== true) {
          throw new Error(
            `Failed to queue mailbox label: ${labelIntentError?.message ?? "operation rejected"}`
          );
        }
      }

      if (pendingDiscardClientId) {
        if (clientId === pendingDiscardClientId) {
          throw new Error("Replacement client was not created");
        }
        const { error: discardError } = await supabase
          .from("clients")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", pendingDiscardClientId)
          .eq("company_id", companyId);
        if (discardError) {
          throw new Error(
            `Failed to discard selected client: ${discardError.message}`
          );
        }
      }
    } catch (err) {
      const msg = `Failed to import lead ${lead.clientName}: ${err instanceof Error ? err.message : "Unknown error"}`;
      console.error(`[email-import] ${msg}`);
      result.errors.push(msg);
    }
  }

  if (result.errors.length > 0) {
    const failedLeads = result.errors.length;
    const processedLeads = Math.max(0, leads.length - failedLeads);
    const { error: jobError } = await supabase
      .from("gmail_scan_jobs")
      .update({
        status: "import_error",
        error_message: result.errors.join("\n"),
        updated_at: new Date().toISOString(),
        progress: {
          stage: "import_error",
          percent: Math.round((processedLeads / leads.length) * 100),
          message: `Import stopped. Review the failed ${failedLeads === 1 ? "lead" : "leads"} and retry.`,
          totalLeads: leads.length,
          processedLeads,
          clientsCreated: result.clientsCreated,
          leadsCreated: result.leadsCreated,
          labelsApplied: result.labelsApplied,
        },
        result,
      })
      .eq("id", jobId);
    if (jobError) {
      throw new Error(
        `Failed to persist incomplete import state: ${jobError.message}`
      );
    }
    console.error(
      `[email-import] Incomplete: ${failedLeads} of ${leads.length} leads failed`
    );
    return;
  }

  console.log(
    `[email-import] Complete: ${result.clientsCreated} clients, ${result.leadsCreated} leads, ${result.activitiesLogged} activities, ${result.labelsApplied} labels`
  );

  // ─── Mark job complete ─────────────────────────────────────────────────────
  // The wizard polls analyze-status and advances past step 4 once status flips
  // to import_complete. Attachment scans were queued at each exact activity
  // boundary and continue independently through the durable worker.
  const completionAuthorization = await loadAuthorizedEmailImportJob({
    supabase,
    jobId,
  });
  if (
    completionAuthorization.actorUserId !== authorizedJob.actorUserId ||
    completionAuthorization.approvalFingerprint !==
      authorizedJob.approvalFingerprint
  ) {
    throw new Error("Import authorization changed before completion");
  }
  const completionProgress = {
    stage: "import_complete",
    percent: 100,
    message: "Import complete",
    totalLeads: leads.length,
    processedLeads: leads.length,
    clientsCreated: result.clientsCreated,
    leadsCreated: result.leadsCreated,
    labelsApplied: result.labelsApplied,
  };
  await completeEmailImportJob({
    supabase,
    jobId,
    result: result as unknown as Record<string, unknown>,
    progress: completionProgress,
  });

  // ─── Create notification for background completion ────────────────────────
  await supabase
    .from("notifications")
    .insert({
      user_id: authorizedJob.actorUserId,
      company_id: companyId,
      type: "mention",
      title: "Pipeline import complete",
      body: `Created ${result.clientsCreated} client${result.clientsCreated !== 1 ? "s" : ""} and ${result.leadsCreated} lead${result.leadsCreated !== 1 ? "s" : ""}`,
      is_read: false,
      persistent: true,
      action_url: "/settings?tab=integrations",
      action_label: "Activate Sync",
    })
    .then(({ error: notifErr }) => {
      if (notifErr)
        console.error(
          "[email-import] Failed to create notification:",
          notifErr.message
        );
    });
}
