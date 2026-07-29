/**
 * POST /api/clients/[id]/provenance
 *
 * Records a manual client edit as operator-sourced field provenance.
 *
 * Client rows are edited straight from the browser against Supabase, so the
 * write itself never passes through a server route. Provenance can't ride
 * along with it: lead_field_provenance is company-scoped and its RLS insert
 * policy targets authenticated Postgres roles, so the browser cannot be
 * trusted to stamp it. This route does it with the service role after the
 * edit lands.
 *
 * Without these rows the enrichment guards cannot tell an operator-typed name
 * from a machine-minted one, and the email pipeline is free to overwrite it.
 *
 * Body: { fields: { name?, email?, phone_number?, address? } }
 * Auth: `clients.edit`, and the client must belong to the caller's company.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { buildOperatorClientProvenanceUpdates } from "@/lib/clients/operator-provenance";
import { writeFieldProvenance } from "@/lib/email/lead-enrichment";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;

  const auth = await verifyAdminAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserByAuth(auth.uid, auth.email);
  const userId = typeof user?.id === "string" ? user.id : "";
  const companyId = typeof user?.company_id === "string" ? user.company_id : "";
  if (!userId || !companyId || user?.is_active !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await checkPermissionById(userId, "clients.edit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const fields =
    body && typeof body === "object" && "fields" in body
      ? (body as { fields?: unknown }).fields
      : null;
  if (!fields || typeof fields !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const clientUpdates = buildOperatorClientProvenanceUpdates(
    fields as Record<string, unknown>
  );
  if (Object.keys(clientUpdates).length === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  const supabase = getServiceRoleClient();

  // Tenancy: never stamp provenance onto another company's client, and never
  // let a client id from the request body widen the caller's scope.
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (clientError) {
    return NextResponse.json(
      { error: `Client lookup failed: ${clientError.message}` },
      { status: 500 }
    );
  }
  if (!clientRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await writeFieldProvenance({
      supabase,
      companyId,
      opportunityId: null,
      clientId,
      opportunityUpdates: {},
      clientUpdates,
      facts: {
        contactName: clientUpdates.name ?? null,
        companyName: null,
        contactEmail: clientUpdates.email ?? null,
        contactPhone: clientUpdates.phone_number ?? null,
        address: clientUpdates.address ?? null,
        estimatedValue: null,
        description: null,
        source: "other",
        sourcePlatform: null,
        providerThreadId: null,
        providerMessageId: null,
        extractionSource: "import_payload",
      },
      actorUserId: userId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Provenance write failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ recorded: Object.keys(clientUpdates).length });
}
