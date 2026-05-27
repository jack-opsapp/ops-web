import { describe, expect, it } from "vitest";
import {
  normalizeProviderEmailId,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";

describe("provider email id validation", () => {
  it("normalizes nonblank provider ids and rejects blank ids", () => {
    expect(normalizeProviderEmailId(" thread-1 ")).toBe("thread-1");
    expect(normalizeProviderEmailId("   ")).toBeNull();
    expect(normalizeProviderEmailId(null)).toBeNull();
  });

  it("requires provider thread and message ids for provider-backed sync writes", () => {
    expect(
      validateProviderEmailIds({
        boundary: "sync_activity",
        providerThreadId: "thread-1",
        providerMessageId: "msg-1",
        requireMessageId: true,
      })
    ).toMatchObject({
      ok: true,
      providerThreadId: "thread-1",
      providerMessageId: "msg-1",
    });

    expect(
      validateProviderEmailIds({
        boundary: "sync_activity",
        providerThreadId: "thread-1",
        providerMessageId: " ",
        requireMessageId: true,
      })
    ).toMatchObject({
      ok: false,
      reasons: ["blank_provider_message_id"],
    });
  });

  it("keeps synthetic import activity exceptions explicit", () => {
    expect(
      validateProviderEmailIds({
        boundary: "import_synthetic_activity",
        providerThreadId: "thread-import-1",
        providerMessageId: null,
        requireMessageId: false,
      })
    ).toMatchObject({
      ok: true,
      providerThreadId: "thread-import-1",
      providerMessageId: null,
    });
  });
});
