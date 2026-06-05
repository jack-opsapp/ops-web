import { describe, expect, it, vi } from "vitest";
import { AccountingSyncAuditService } from "../accounting-sync-audit-service";

describe("AccountingSyncAuditService", () => {
  it("inserts a record-level audit event without raw token fields", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "evt-1" }, error: null }),
      }),
    }));
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
        access_token: "raw-access",
        nested: { refresh_token: "raw-refresh" },
      },
      afterSnapshot: {
        total: 12,
        realm_id: "raw-realm",
        headers: { authorization: "Bearer raw-token" },
      },
    });

    expect(id).toBe("evt-1");
    expect(from).toHaveBeenCalledWith("accounting_sync_events");
    expect(insert).toHaveBeenCalledWith(
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
        before_snapshot: { total: 10, nested: {} },
        after_snapshot: { total: 12, headers: {} },
      })
    );
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toMatch(/access_token|refresh_token|realm_id|authorization|Bearer|raw-token/i);
  });
});
