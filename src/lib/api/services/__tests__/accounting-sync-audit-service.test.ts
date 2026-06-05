import { describe, expect, it, vi } from "vitest";
import { AccountingSyncAuditService } from "../accounting-sync-audit-service";

describe("AccountingSyncAuditService", () => {
  it("inserts a record-level audit event without raw token fields", async () => {
    type InsertPayload = Record<string, unknown>;
    let insertedPayload: Record<string, unknown> | undefined;
    const insert = vi.fn((payload: InsertPayload) => {
      insertedPayload = payload;
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: "evt-1" }, error: null }),
        }),
      };
    });
    const from = vi.fn(() => ({ insert }));
    const service = new AccountingSyncAuditService({ from } as never);

    const id = await service.record({
      queueId: "q-1",
      companyId: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
      connectionId: "91d98e28-36ec-4060-b047-3cb5cc342a12",
      provider: "quickbooks",
      direction: "ops_to_qb",
      entityType: "invoice",
      entityId: "inv-1",
      externalId: "123",
      operation: "update",
      status: "succeeded",
      source: "worker",
      decision: "ops_won",
      beforeSnapshot: {
        total: 10,
        SyncToken: "7",
        sync_token: "8",
        access_token: "raw-access",
        accessToken: "raw-camel-access",
        clientSecret: "raw-client-secret",
        webhookVerifierToken: "raw-verifier",
        webhook_verifier_token: "raw-snake-verifier",
        nested: { refresh_token: "raw-refresh", safeTokenizedLabel: "kept-label" },
      },
      afterSnapshot: {
        total: 12,
        realm_id: "realm-1",
        safeTokenizedLabel: "kept because tokenized is not a credential key",
        headers: {
          authorization: "Bearer raw-token",
          idToken: "raw-id-token",
          password: "raw-password",
          apiPassphrase: "raw-passphrase",
          sharedSecret: "raw-secret",
          displayName: "kept",
        },
      },
    });

    expect(id).toBe("evt-1");
    expect(from).toHaveBeenCalledWith("accounting_sync_events");
    expect(insertedPayload).toEqual(
      expect.objectContaining({
        queue_id: "q-1",
        company_id: "7a88c7d6-d4e3-49be-9d21-0a989e0f3222",
        connection_id: "91d98e28-36ec-4060-b047-3cb5cc342a12",
        provider: "quickbooks",
        direction: "ops_to_qb",
        entity_type: "invoice",
        entity_id: "inv-1",
        external_id: "123",
        operation: "update",
        status: "succeeded",
        source: "worker",
        decision: "ops_won",
        before_snapshot: {
          total: 10,
          SyncToken: "7",
          sync_token: "8",
          nested: { safeTokenizedLabel: "kept-label" },
        },
        after_snapshot: {
          total: 12,
          realm_id: "realm-1",
          safeTokenizedLabel: "kept because tokenized is not a credential key",
          headers: { displayName: "kept" },
        },
      })
    );
    expect(JSON.stringify(insertedPayload)).not.toMatch(
      /raw-access|raw-camel-access|raw-client-secret|raw-verifier|raw-snake-verifier|raw-refresh|raw-id-token|raw-password|raw-passphrase|raw-secret|Bearer raw-token/i
    );
  });
});
