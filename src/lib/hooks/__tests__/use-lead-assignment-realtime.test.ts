import { describe, expect, it, vi } from "vitest";

import {
  applyPermissionDeliveryOncePerRuntime,
  type PermissionChangeDeliveryRow,
} from "../use-lead-assignment-realtime";

function permissionDelivery(
  id: string,
  recipientUserId: string
): PermissionChangeDeliveryRow {
  return {
    id,
    company_id: "company-1",
    recipient_user_id: recipientUserId,
  };
}

describe("permission delivery replay", () => {
  it("does not replay the same delivery when the hook remounts during reconciliation", async () => {
    const recipientUserId = "user-remount";
    const row = permissionDelivery("delivery-1", recipientUserId);
    let finishReconciliation: ((handled: boolean) => void) | undefined;
    const reconcile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishReconciliation = resolve;
        })
    );

    const firstMount = applyPermissionDeliveryOncePerRuntime({
      row,
      recipientUserId,
      reconcile,
    });
    const secondMount = applyPermissionDeliveryOncePerRuntime({
      row,
      recipientUserId,
      reconcile,
    });

    expect(reconcile).toHaveBeenCalledTimes(1);

    finishReconciliation?.(true);
    await expect(firstMount).resolves.toBe(true);
    await expect(secondMount).resolves.toBe(true);
  });

  it("applies a new delivery ID for the same recipient", async () => {
    const recipientUserId = "user-new-delivery";
    const reconcile = vi.fn().mockResolvedValue(true);

    await applyPermissionDeliveryOncePerRuntime({
      row: permissionDelivery("delivery-1", recipientUserId),
      recipientUserId,
      reconcile,
    });
    await applyPermissionDeliveryOncePerRuntime({
      row: permissionDelivery("delivery-2", recipientUserId),
      recipientUserId,
      reconcile,
    });

    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("releases a rejected delivery so it can be retried", async () => {
    const recipientUserId = "user-rejected-delivery";
    const row = permissionDelivery("delivery-rejected", recipientUserId);
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      applyPermissionDeliveryOncePerRuntime({
        row,
        recipientUserId,
        reconcile,
      })
    ).resolves.toBe(false);
    await expect(
      applyPermissionDeliveryOncePerRuntime({
        row,
        recipientUserId,
        reconcile,
      })
    ).resolves.toBe(true);

    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
