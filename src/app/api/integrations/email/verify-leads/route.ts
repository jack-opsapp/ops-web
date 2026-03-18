/**
 * POST /api/integrations/email/verify-leads
 *
 * Fresh database check for duplicate clients/opportunities before import.
 * Called when the user clicks "Confirm" in the review step — returns
 * per-lead match info and aggregate summary counts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface VerifyLead {
  id: string;
  clientEmail: string;
  clientName: string;
  stage: string;
  action: string;
  existingClientId: string | null;
  subContacts?: Array<{ name: string; email: string }>;
}

interface LeadMatch {
  existingClientId: string | null;
  existingClientName: string | null;
  existingClientEmail: string | null;
  hasOpenOpp: boolean;
  openOppStage: string | null;
  matchSource: "email" | "subclient" | "pre-matched" | null;
}

export async function POST(request: NextRequest) {
  const { companyId, leads } = (await request.json()) as {
    companyId: string;
    leads: VerifyLead[];
  };

  if (!companyId || !leads?.length) {
    return NextResponse.json(
      { error: "companyId and leads required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  // ─── 1. Batch fetch existing clients by email ────────────────────────────
  const leadEmails = leads.map((l) => l.clientEmail.toLowerCase());
  const uniqueEmails = [...new Set(leadEmails)];

  const { data: existingClients } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .in("email", uniqueEmails);

  // Build email → client map
  const emailToClient = new Map<string, { id: string; name: string; email: string }>();
  for (const c of existingClients || []) {
    if (c.email) emailToClient.set(c.email.toLowerCase(), c);
  }

  // ─── 2. Check sub_clients for additional email matches ───────────────────
  // Two-step: find sub_clients by email, then fetch their parent clients
  const { data: existingSubs } = await supabase
    .from("sub_clients")
    .select("id, email, client_id, name")
    .is("deleted_at", null)
    .in("email", uniqueEmails);

  const subEmailToClient = new Map<string, { id: string; name: string; email: string }>();

  if (existingSubs && existingSubs.length > 0) {
    const parentClientIds = [...new Set(existingSubs.map((sc) => sc.client_id).filter(Boolean))];

    const { data: parentClients } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", parentClientIds);

    const parentMap = new Map<string, { id: string; name: string; email: string }>();
    for (const c of parentClients || []) {
      parentMap.set(c.id, c);
    }

    for (const sc of existingSubs) {
      const parent = sc.client_id ? parentMap.get(sc.client_id) : null;
      if (sc.email && parent) {
        subEmailToClient.set(sc.email.toLowerCase(), parent);
      }
    }
  }

  // ─── 3. Get all matched client IDs and check for open opportunities ──────
  const matchedClientIds = new Set<string>();
  for (const lead of leads) {
    const email = lead.clientEmail.toLowerCase();
    const directMatch = emailToClient.get(email);
    const subMatch = subEmailToClient.get(email);
    if (directMatch) matchedClientIds.add(directMatch.id);
    if (subMatch) matchedClientIds.add(subMatch.id);
    if (lead.existingClientId) matchedClientIds.add(lead.existingClientId);
  }

  const clientIdsArr = [...matchedClientIds];
  const openOppMap = new Map<string, string>(); // clientId → stage

  if (clientIdsArr.length > 0) {
    const { data: openOpps } = await supabase
      .from("opportunities")
      .select("id, client_id, stage")
      .eq("company_id", companyId)
      .in("client_id", clientIdsArr)
      .in("stage", ["new_lead", "qualifying", "quoting", "quoted", "follow_up", "negotiation"])
      .is("deleted_at", null);

    for (const opp of openOpps || []) {
      if (opp.client_id) openOppMap.set(opp.client_id, opp.stage);
    }
  }

  // ─── 4. Build per-lead match results ─────────────────────────────────────
  const matches: Record<string, LeadMatch> = {};

  let newClients = 0;
  let existingLinks = 0;
  let newLeads = 0;
  let existingOpps = 0;
  let subContactsCount = 0;

  for (const lead of leads) {
    const email = lead.clientEmail.toLowerCase();
    const directMatch = emailToClient.get(email);
    const subMatch = subEmailToClient.get(email);

    let match: LeadMatch;

    if (directMatch) {
      const hasOpp = openOppMap.has(directMatch.id);
      match = {
        existingClientId: directMatch.id,
        existingClientName: directMatch.name,
        existingClientEmail: directMatch.email,
        hasOpenOpp: hasOpp,
        openOppStage: hasOpp ? openOppMap.get(directMatch.id)! : null,
        matchSource: "email",
      };
      existingLinks++;
      if (hasOpp) existingOpps++;
      else newLeads++;
    } else if (subMatch) {
      const hasOpp = openOppMap.has(subMatch.id);
      match = {
        existingClientId: subMatch.id,
        existingClientName: subMatch.name,
        existingClientEmail: subMatch.email,
        hasOpenOpp: hasOpp,
        openOppStage: hasOpp ? openOppMap.get(subMatch.id)! : null,
        matchSource: "subclient",
      };
      existingLinks++;
      if (hasOpp) existingOpps++;
      else newLeads++;
    } else if (lead.existingClientId) {
      // Pre-matched from analysis but no email match — trust the analysis match
      const hasOpp = openOppMap.has(lead.existingClientId);
      match = {
        existingClientId: lead.existingClientId,
        existingClientName: null, // We don't have the name; the client already knows from analysis
        existingClientEmail: null,
        hasOpenOpp: hasOpp,
        openOppStage: hasOpp ? openOppMap.get(lead.existingClientId)! : null,
        matchSource: "pre-matched",
      };
      existingLinks++;
      if (hasOpp) existingOpps++;
      else newLeads++;
    } else {
      match = {
        existingClientId: null,
        existingClientName: null,
        existingClientEmail: null,
        hasOpenOpp: false,
        openOppStage: null,
        matchSource: null,
      };
      newClients++;
      newLeads++;
    }

    matches[lead.id] = match;
    subContactsCount += lead.subContacts?.length || 0;
  }

  return NextResponse.json({
    matches,
    summary: {
      newClients,
      existingLinks,
      newLeads,
      existingOpps,
      subContacts: subContactsCount,
      total: leads.length,
    },
  });
}
