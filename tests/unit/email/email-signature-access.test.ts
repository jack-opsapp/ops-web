import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { filterAuthorizedEmailSignatureConnections } from "@/lib/email/email-signature-access";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: "connection-company",
    companyId: "company-1",
    provider: "gmail" as const,
    type: "company" as const,
    userId: "legacy-connector-user",
    email: "office@example.com",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2026-07-16T00:00:00.000Z"),
    historyId: null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 5,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: true,
    aiMemoryEnabled: true,
    status: "active",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

type AccessDecision =
  | boolean
  | { data?: boolean | null; error?: { message: string } | null }
  | Error;

function supabaseWithSignatureAccess(
  decisions: Record<string, AccessDecision>
): { supabase: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(
    async (
      name: string,
      payload: { p_actor_user_id: string; p_connection_id: string }
    ) => {
      expect(name).toBe("authorize_email_signature_access_as_system");
      const decision = decisions[payload.p_connection_id] ?? false;
      if (decision instanceof Error) throw decision;
      if (typeof decision === "boolean") {
        return { data: decision, error: null };
      }
      return {
        data: decision.data ?? null,
        error: decision.error ?? null,
      };
    }
  );

  return {
    supabase: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

const actor = { userId: "user-1", companyId: "company-1" };

describe("email signature connection authorization", () => {
  it("returns only individual mailboxes authorized by the canonical service bridge", async () => {
    const own = connection({
      id: "connection-own",
      type: "individual",
      userId: actor.userId,
      email: "personal@example.com",
    });
    const foreign = connection({
      id: "connection-foreign",
      type: "individual",
      userId: "user-2",
      email: "user-1@example.com",
    });
    const { supabase, rpc } = supabaseWithSignatureAccess({
      [own.id]: true,
      [foreign.id]: false,
    });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [own, foreign],
      supabase,
    });

    expect(result.map((item) => item.id)).toEqual([own.id]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("never treats a company mailbox legacy user_id as actor authority", async () => {
    const shared = connection({ userId: actor.userId });
    const { supabase, rpc } = supabaseWithSignatureAccess({
      [shared.id]: false,
    });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [shared],
      supabase,
    });

    expect(result).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_email_signature_access_as_system",
      {
        p_actor_user_id: actor.userId,
        p_connection_id: shared.id,
      }
    );
  });

  it("preserves the canonical lead plus inbox send intersection", async () => {
    const shared = connection();
    const { supabase } = supabaseWithSignatureAccess({ [shared.id]: true });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [shared],
      supabase,
    });

    expect(result.map((item) => item.id)).toEqual([shared.id]);
  });

  it("preserves service-authorized integration administrators", async () => {
    const shared = connection();
    const { supabase } = supabaseWithSignatureAccess({ [shared.id]: true });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [shared],
      supabase,
    });

    expect(result.map((item) => item.id)).toEqual([shared.id]);
  });

  it("keeps canonically authorized all-scope users eligible without a personal assignment", async () => {
    const shared = connection();
    const { supabase, rpc } = supabaseWithSignatureAccess({
      [shared.id]: true,
    });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [shared],
      supabase,
    });

    expect(result.map((item) => item.id)).toEqual([shared.id]);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_email_signature_access_as_system",
      {
        p_actor_user_id: actor.userId,
        p_connection_id: shared.id,
      }
    );
  });

  it("honors an explicit granular revoke returned by the canonical bridge", async () => {
    const shared = connection();
    const { supabase } = supabaseWithSignatureAccess({ [shared.id]: false });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [shared],
      supabase,
    });

    expect(result).toEqual([]);
  });

  it("fails closed when the canonical service bridge errors or throws", async () => {
    const errored = connection({ id: "errored" });
    const thrown = connection({ id: "thrown" });
    const { supabase } = supabaseWithSignatureAccess({
      [errored.id]: { error: { message: "lookup failed" } },
      [thrown.id]: new Error("bridge unavailable"),
    });

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [errored, thrown],
      supabase,
    });

    expect(result).toEqual([]);
  });

  it("drops inactive, foreign-company, and malformed connections before authorization", async () => {
    const { supabase, rpc } = supabaseWithSignatureAccess({});

    const result = await filterAuthorizedEmailSignatureConnections({
      actor,
      connections: [
        connection({ id: "inactive", status: "paused" }),
        connection({ id: "foreign", companyId: "company-2" }),
        {
          ...connection(),
          id: "bad-type",
          type: "shared",
        } as unknown as EmailConnection,
      ],
      supabase,
    });

    expect(result).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
