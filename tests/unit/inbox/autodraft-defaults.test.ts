import { describe, it, expect } from "vitest";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";

describe("defaultAutoSendSettings", () => {
  it("enables auto_draft_enabled", () => {
    expect(defaultAutoSendSettings().auto_draft_enabled).toBe(true);
  });

  it("keeps auto_send_enabled false — never auto-sends", () => {
    expect(defaultAutoSendSettings().auto_send_enabled).toBe(false);
  });

  it("seeds only the canonical CUSTOMER primary category", () => {
    expect(
      defaultAutoSendSettings().category_autonomy["primary:CUSTOMER"]
    ).toBe("auto_draft");
  });

  it("does not seed legacy relationship-level controls", () => {
    const { category_autonomy } = defaultAutoSendSettings();
    expect(category_autonomy.general).toBeUndefined();
    expect(category_autonomy.client_quoting).toBeUndefined();
    expect(category_autonomy.client_followup).toBeUndefined();
    expect(category_autonomy.warranty_claim).toBeUndefined();
    expect(category_autonomy.vendor_ordering).toBeUndefined();
    expect(category_autonomy.subtrade_coordination).toBeUndefined();
  });

  it("no category maps to auto_send", () => {
    const { category_autonomy } = defaultAutoSendSettings();
    for (const value of Object.values(category_autonomy)) {
      expect(value).not.toBe("auto_send");
    }
  });
});
