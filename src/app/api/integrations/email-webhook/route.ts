/**
 * OPS Web - Inbound Email Webhook (RETIRED 2026-05-29)
 *
 * POST /api/integrations/email-webhook
 *
 * This endpoint formerly inserted an `opportunities` row directly from a raw
 * inbound email payload. It bypassed every lead-lifecycle guardrail: no
 * provider-id validation (`validateProviderEmailIds`), no create-or-link
 * client, no `activities` row, no `email_threads` / `opportunity_email_threads`
 * link, no `email_message_id` (so its writes could never be deduped), no
 * correspondence event, no `source_email_id`, and an identity filter that
 * omitted `platformEmails` — letting a platform sender be written as the lead
 * identity.
 *
 * Inbound email now flows exclusively through the Gmail sync engine
 * (`src/lib/api/services/sync-engine.ts`) and the historical / wizard import
 * routes, all of which route through those services. A repo-wide grep found
 * zero in-repo callers of this endpoint; the only references were this file
 * and its integration test.
 *
 * It is retired to HTTP 410 Gone rather than hard-deleted so any external
 * forwarder still POSTing to the `leads-{prefix}@inbound.opsapp.co` address
 * receives an explicit, monitorable signal (and surfaces in Vercel function
 * logs) instead of a silent 404. If logs confirm a live external forwarder,
 * rebuild per Deliverable 3.4 of the P1 code/schema plan rather than reviving
 * the original bypassing handler.
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint has been retired. Inbound email is handled by the Gmail sync engine and import routes.",
    },
    { status: 410 }
  );
}
