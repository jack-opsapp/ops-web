import { describe, it, expect } from "vitest";
import { defaultAutoSendSettings } from "@/lib/api/services/mailbox-draft-helpers";

describe("defaultAutoSendSettings", () => {
  it("enables auto_draft_enabled", () => {
    expect(defaultAutoSendSettings().auto_draft_enabled).toBe(true);
  });

  it("keeps auto_send_enabled false — never auto-sends", () => {
    expect(defaultAutoSendSettings().auto_send_enabled).toBe(false);
  });

  it("maps general to auto_draft", () => {
    expect(defaultAutoSendSettings().category_autonomy.general).toBe("auto_draft");
  });

  it("maps client_quoting to auto_draft", () => {
    expect(defaultAutoSendSettings().category_autonomy.client_quoting).toBe("auto_draft");
  });

  it("maps client_followup to auto_draft", () => {
    expect(defaultAutoSendSettings().category_autonomy.client_followup).toBe("auto_draft");
  });

  it("does NOT map warranty_claim, vendor_ordering, or subtrade_coordination (sensitive categories stay draft_on_request by omission)", () => {
    const { category_autonomy } = defaultAutoSendSettings();
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
