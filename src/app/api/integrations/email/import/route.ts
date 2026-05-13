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
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
} from "@/lib/types/pipeline";
import { getAppUrl } from "@/lib/utils/app-url";
import type { ImportPayload, ImportResult } from "@/lib/types/email-import";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

// ─── Title derivation ──────────────────────────────────────────────────────
//
// opportunities.title is NOT NULL. The wizard payload's lead.title is only
// populated when the client has MORE than one lead in the same import
// (used as a distinguishing label) — otherwise it's null, and the previous
// write path satisfied the NOT NULL constraint with an empty string. That
// produced lead-card rows with no readable title (bug 36f8a964).
//
// The fallback chain, in priority order:
//   1. lead.title (operator-confirmed in the wizard) — explicit wins.
//   2. The email thread subject, stripped of "Re:" / "Fwd:" / "FW:" prefixes.
//      Looked up directly from the email_threads row by thread id.
//   3. The first sentence (up to 80 chars) of the AI-generated description.
//   4. A tactical fallback: `[OPPORTUNITY · {client} · {YYYY-MM-DD}]`.
//
// Steps 1 and 4 always work synchronously. Steps 2 and 3 are best-effort —
// failures fall through to the next tier. Result is always a non-empty
// trimmed string, which is what the NOT NULL constraint actually wants.
// (bug 36f8a964)

const SUBJECT_PREFIX_RE = /^\s*(re|fwd?|fw):\s*/i;

function stripSubjectPrefixes(subject: string): string {
  let s = subject;
  // Strip multiple stacked Re: Fwd: Re: prefixes — common on long threads.
  for (let i = 0; i < 5; i++) {
    const next = s.replace(SUBJECT_PREFIX_RE, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

function firstSentence(text: string, max: number): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Sentence delimiter or newline — whichever comes first.
  const match = trimmed.match(/^[^.!?\n]+/);
  const candidate = (match ? match[0] : trimmed).trim();
  if (!candidate) return null;
  if (candidate.length <= max) return candidate;
  return candidate.slice(0, max - 1).trimEnd() + "…";
}

function tacticalFallbackTitle(clientName: string | null | undefined): string {
  const safeName = (clientName ?? "").trim() || "UNKNOWN CLIENT";
  const today = new Date().toISOString().slice(0, 10);
  return `[OPPORTUNITY · ${safeName} · ${today}]`;
}

async function deriveOpportunityTitle(
  supabase: SupabaseClient,
  args: {
    explicitTitle: string | null;
    threadId: string | null | undefined;
    description: string | null | undefined;
    clientName: string | null | undefined;
  },
): Promise<string> {
  // Tier 1 — explicit title from the wizard payload.
  const explicit = (args.explicitTitle ?? "").trim();
  if (explicit) return explicit;

  // Tier 2 — email thread subject. Best-effort: a missing row or a
  // permission failure falls through silently.
  if (args.threadId) {
    try {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("subject")
        .eq("id", args.threadId)
        .maybeSingle();
      const subject = ((thread?.subject as string) ?? "").trim();
      const cleaned = stripSubjectPrefixes(subject);
      if (cleaned) return cleaned;
    } catch (err) {
      console.error(
        `[email-import] Title derivation: thread lookup failed for ${args.threadId}:`,
        err,
      );
    }
  }

  // Tier 3 — first sentence of the AI description.
  if (args.description) {
    const sentence = firstSentence(args.description, 80);
    if (sentence) return sentence;
  }

  // Tier 4 — deterministic fallback in OPS tactical voice.
  return tacticalFallbackTitle(args.clientName);
}

// ─── Client contact backfill ───────────────────────────────────────────────
//
// clients.phone_number / clients.address are NULL for many clients even when
// the matching opportunity row carries the contact info (the quote-form
// submissions populate opportunities.contact_phone / opportunities.address
// from the form payload, but the previous write path skipped updating the
// already-existing client row). Operators saw blank contact details on the
// client surface even though the lead they were looking at had a phone
// number. (bug f64aa932)
//
// On every confirmed lead, we now check whether the linked client row is
// missing phone or address and the lead payload carries those values — if
// so we update the client row in place. This is fill-blanks only; we never
// overwrite an existing client phone/address with import payload values
// (the merge flow above is the canonical "overwrite" path).
async function backfillClientContact(
  supabase: SupabaseClient,
  args: {
    clientId: string;
    leadPhone: string | null;
    leadAddress: string | null;
  },
): Promise<void> {
  if (!args.leadPhone && !args.leadAddress) return;
  try {
    const { data: row } = await supabase
      .from("clients")
      .select("phone_number, address")
      .eq("id", args.clientId)
      .maybeSingle();
    if (!row) return;

    const update: Record<string, string> = {};
    const currentPhone = ((row.phone_number as string | null) ?? "").trim();
    const currentAddress = ((row.address as string | null) ?? "").trim();

    if (!currentPhone && args.leadPhone && args.leadPhone.trim()) {
      update.phone_number = args.leadPhone.trim();
    }
    if (!currentAddress && args.leadAddress && args.leadAddress.trim()) {
      update.address = args.leadAddress.trim();
    }
    if (Object.keys(update).length === 0) return;

    const { error } = await supabase
      .from("clients")
      .update(update)
      .eq("id", args.clientId);
    if (error) {
      console.error(
        `[email-import] Client contact backfill failed for ${args.clientId}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[email-import] Client contact backfill threw for ${args.clientId}:`,
      err,
    );
  }
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

      // Backfill clients.phone_number / clients.address from the lead
      // payload when the client row is empty. Covers every branch above
      // (merge, link, create_subclient, mergeWithLeadId, create_new)
      // because they all converge on a single clientId at this point.
      // Fill-blanks only — never overwrites an existing client value.
      // (bug f64aa932)
      await backfillClientContact(supabase, {
        clientId,
        leadPhone: lead.clientPhone,
        leadAddress: lead.clientAddress,
      });

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

      // Check for an existing opportunity for this client that we should
      // attach the incoming thread to instead of creating a new row.
      //
      // Bug ffa94025: the previous dedup window only matched the open
      // pipeline stages — new_lead through negotiation — and excluded the
      // terminal `won` stage. The result was that every fresh inbound email
      // for a client whose last lead was already marked won spawned a brand
      // new won opportunity (the wizard auto-classifies long-running
      // threads as won). Same client, same job, four rows.
      //
      // The dedup window now includes `won` so a subsequent inbound on a
      // client who already has a won opportunity falls onto the existing
      // row. `lost` and `discarded` are intentionally excluded — those are
      // dead-end terminal states where a new inbound legitimately
      // represents a new opportunity. We also filter out archived rows so
      // the archive flow stays opt-in.
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
          "won",
        ])
        .is("deleted_at", null)
        .is("archived_at", null)
        .limit(1);

      let opportunityId: string;

      if (existingOpps && existingOpps.length > 0) {
        opportunityId = existingOpps[0].id;
      } else {
        const inboundCount = Math.max(0, (lead.correspondenceCount || 0) - (lead.outboundCount || 0));
        const lastMessageDate = lead.lastMessageDate ? new Date(lead.lastMessageDate) : null;
        const isOutbound = (lead.outboundCount || 0) > 0 && inboundCount === 0;

        const derivedTitle = await deriveOpportunityTitle(supabase, {
          explicitTitle: lead.title,
          threadId: lead.threadId,
          description: lead.description,
          clientName: lead.clientName,
        });

        const opp = await OpportunityService.createOpportunity({
          companyId,
          clientId,
          title: derivedTitle,
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
      : [lead.threadId];

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
