import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteConnectionMock } = vi.hoisted(() => ({
  deleteConnectionMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-connection-service", () => ({
  EmailConnectionService: { deleteConnection: deleteConnectionMock },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

import { PersonalEmailConnectionLifecycleService } from "@/lib/api/services/personal-email-connection-lifecycle-service";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const COMPANY_ID = "00000000-0000-4000-8000-000000000003";
const REQUESTED_AT = "2026-07-16T12:00:00.000Z";

function connection() {
  return {
    id: CONNECTION_ID,
    companyId: COMPANY_ID,
    type: "individual" as const,
    userId: ACTOR_ID,
    email: "operator@example.com",
  };
}

function lifecycleClient(options: { signatureError?: boolean } = {}) {
  const signatureRows = [
    {
      actor_user_id: ACTOR_ID,
      connection_id: CONNECTION_ID,
      company_id: COMPANY_ID,
      requested_at: REQUESTED_AT,
    },
  ];
  const rpc = vi.fn(async (name: string) => {
    if (name === "process_personal_mailbox_lifecycle_event") {
      return {
        data: [
          {
            affected_conversation_count: 1,
            notified_user_count: 1,
            resolved_notification_count: 0,
          },
        ],
        error: null,
      };
    }
    if (name === "process_email_signature_notification_lifecycle") {
      return options.signatureError
        ? { data: null, error: { message: "notification unavailable" } }
        : { data: true, error: null };
    }
    if (name === "fail_email_signature_notification_lifecycle") {
      return { data: true, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });

  const from = vi.fn((table: string) => {
    if (table !== "email_signature_notification_lifecycle_outbox") {
      throw new Error(`unexpected table ${table}`);
    }
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      lte: () => query,
      order: () => query,
      limit: async () => ({ data: signatureRows, error: null }),
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: null;
              error: null;
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ) {
        return Promise.resolve({ data: null, error: null }).then(
          onfulfilled,
          onrejected
        );
      },
    };
    return query;
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
  };
}

describe("personal mailbox signature notification lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteConnectionMock.mockResolvedValue(undefined);
  });

  it("reconciles exact actor/connection signature prompts after disable", async () => {
    const { client, rpc } = lifecycleClient();

    await expect(
      PersonalEmailConnectionLifecycleService.disconnect(connection(), client)
    ).resolves.toMatchObject({ state: "processed" });

    expect(deleteConnectionMock).toHaveBeenCalledWith(CONNECTION_ID);
    expect(rpc).toHaveBeenCalledWith(
      "process_email_signature_notification_lifecycle",
      {
        p_actor_user_id: ACTOR_ID,
        p_connection_id: CONNECTION_ID,
        p_company_id: COMPANY_ID,
      }
    );
  });

  it("does not let signature notification failure block mailbox disable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, rpc } = lifecycleClient({
      signatureError: true,
    });

    await expect(
      PersonalEmailConnectionLifecycleService.disconnect(connection(), client)
    ).resolves.toMatchObject({ state: "processed" });

    expect(rpc).toHaveBeenCalledWith(
      "process_email_signature_notification_lifecycle",
      expect.any(Object)
    );
    expect(rpc).toHaveBeenCalledWith(
      "fail_email_signature_notification_lifecycle",
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_connection_id: CONNECTION_ID,
        p_company_id: COMPANY_ID,
        p_expected_requested_at: REQUESTED_AT,
        p_error: expect.stringContaining("notification unavailable"),
      })
    );
  });

  it("drains signature-only events and continues after one event fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secondActorId = "00000000-0000-4000-8000-000000000004";
    const signatureRows = [
      {
        actor_user_id: ACTOR_ID,
        connection_id: CONNECTION_ID,
        company_id: COMPANY_ID,
        requested_at: REQUESTED_AT,
      },
      {
        actor_user_id: secondActorId,
        connection_id: CONNECTION_ID,
        company_id: COMPANY_ID,
        requested_at: "2026-07-16T12:01:00.000Z",
      },
    ];
    const rpc = vi.fn(async (name: string, params: Record<string, string>) => {
      if (name === "fail_email_signature_notification_lifecycle") {
        return { data: true, error: null };
      }
      if (name !== "process_email_signature_notification_lifecycle") {
        throw new Error(`unexpected RPC ${name}`);
      }
      return params.p_actor_user_id === ACTOR_ID
        ? { data: null, error: { message: "first event failed" } }
        : { data: true, error: null };
    });
    const from = vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        lte: () => query,
        order: () => query,
        limit: async () => ({
          data:
            table === "email_connection_lifecycle_outbox" ? [] : signatureRows,
          error: null,
        }),
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: {
                data: null;
                error: null;
              }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) {
          return Promise.resolve({ data: null, error: null }).then(
            onfulfilled,
            onrejected
          );
        },
      };
      return query;
    });
    const client = { from, rpc } as unknown as SupabaseClient;

    await expect(
      PersonalEmailConnectionLifecycleService.drainPending(25, client)
    ).resolves.toEqual({ selected: 0, processed: 0, failed: 0 });

    expect(rpc.mock.calls).toEqual([
      [
        "process_email_signature_notification_lifecycle",
        {
          p_actor_user_id: ACTOR_ID,
          p_connection_id: CONNECTION_ID,
          p_company_id: COMPANY_ID,
        },
      ],
      [
        "fail_email_signature_notification_lifecycle",
        {
          p_actor_user_id: ACTOR_ID,
          p_connection_id: CONNECTION_ID,
          p_company_id: COMPANY_ID,
          p_expected_requested_at: REQUESTED_AT,
          p_error:
            "Failed to process signature notification lifecycle: first event failed",
        },
      ],
      [
        "process_email_signature_notification_lifecycle",
        {
          p_actor_user_id: secondActorId,
          p_connection_id: CONNECTION_ID,
          p_company_id: COMPANY_ID,
        },
      ],
    ]);
  });
});
