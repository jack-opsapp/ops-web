import { describe, expect, it, vi } from "vitest";

import { persistCapturedProviderDeliveryTurn } from "../persist-captured-provider-delivery-turn";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-error-contract";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const ACTIVITY_ID = "00000000-0000-4000-8000-000000000003";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000004";
const EVENT_ID = "00000000-0000-4000-8000-000000000005";
const CLIENT_ID = "00000000-0000-4000-8000-000000000006";
const MESSAGE_ID = "provider-message-1";

describe("captured provider delivery turn runtime seam", () => {
  it("preserves database pressure evidence from the durable source RPC", async () => {
    const error = {
      code: "",
      message: "Service unavailable",
      details: "",
      hint: "",
    };
    const rpc = vi.fn(async () => ({
      data: null,
      error,
      status: 503,
      statusText: "Service Unavailable",
    }));

    const failure = await persistCapturedProviderDeliveryTurn({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerMessageId: MESSAGE_ID,
      sourceActivityId: ACTIVITY_ID,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "CronDatabaseOperationError",
      message: "DELIVERED_TURN_SOURCE_READ_FAILED",
      cause: {
        error,
        status: 503,
        statusText: "Service Unavailable",
      },
    });
    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("re-reads the durable source and then ingests the exact job turn", async () => {
    const rpc = vi.fn(
      async (
        functionName: string,
        _args: Readonly<Record<string, unknown>>
      ) => {
        if (functionName === "read_agent_provider_delivery_source_as_system") {
          return {
            data: [
              {
                company_id: COMPANY_ID,
                source_activity_id: ACTIVITY_ID,
                activity_opportunity_id: OPPORTUNITY_ID,
                activity_project_id: null,
                connection_id: CONNECTION_ID,
                provider_message_id: MESSAGE_ID,
                direction: "inbound",
                delivered_at: "2026-08-07T18:00:00.000Z",
                subject: "Site visit details",
                content_media_type: "text/plain",
                content_value: "Please confirm Tuesday.",
                content_charset: "utf-8",
                content_source_kind: "gmail_mime_part",
                content_selection_revision:
                  "gmail.mime.text-plain-first.charset-decoded.v2",
                provider_part_id: "0.1",
                provider_body_attachment_id: null,
                sender_identity: "customer@example.com",
                recipient_identities: ["ops@example.com"],
                cc_recipient_identities: [],
                actor_user_id: null,
                source_correspondence_event: {
                  id: EVENT_ID,
                  opportunity_id: OPPORTUNITY_ID,
                  activity_id: ACTIVITY_ID,
                  connection_id: CONNECTION_ID,
                  provider_message_id: MESSAGE_ID,
                  direction: "inbound",
                  party_role: "customer",
                  from_email: "customer@example.com",
                },
                confirmed_customer_participants: [
                  { kind: "client", id: CLIENT_ID },
                ],
                attachment_enumeration_complete: true,
                attachment_evidence_ids: [],
              },
            ],
            error: null,
          };
        }
        if (functionName === "ingest_job_conversation_turn_as_system") {
          return {
            data: [
              {
                conversation_id: "00000000-0000-4000-8000-000000000007",
                turn_id: "00000000-0000-4000-8000-000000000008",
                inserted: true,
              },
            ],
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${functionName}`);
      }
    );

    const result = await persistCapturedProviderDeliveryTurn({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      providerMessageId: MESSAGE_ID,
      sourceActivityId: ACTIVITY_ID,
    });

    expect(rpc.mock.calls.map(([functionName]) => functionName)).toEqual([
      "read_agent_provider_delivery_source_as_system",
      "ingest_job_conversation_turn_as_system",
    ]);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_company_id: COMPANY_ID,
      p_connection_id: CONNECTION_ID,
      p_provider_message_id: MESSAGE_ID,
      p_source_activity_id: ACTIVITY_ID,
    });
    expect(rpc.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        p_company_id: COMPANY_ID,
        p_job_kind: "opportunity",
        p_job_id: OPPORTUNITY_ID,
        p_side: "user",
        p_participant_id: `client:${CLIENT_ID}`,
        p_source_activity_id: ACTIVITY_ID,
        p_source_correspondence_event_id: EVENT_ID,
      })
    );
    expect(result).toMatchObject({ inserted: true });
  });
});
