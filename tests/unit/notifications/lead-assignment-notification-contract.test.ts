import { describe, expect, it } from "vitest";

import { DEFAULT_CHANNEL_PREFERENCES } from "@/lib/api/services/notification-preferences-service";
import { NOTIF_TYPE_META } from "@/lib/notifications/notification-meta";

describe("lead assignment notification contract", () => {
  it("registers lead_assigned as an attention-worthy rail notification", () => {
    expect(NOTIF_TYPE_META.lead_assigned).toEqual({
      label: "LEAD",
      icon: "user-plus",
      tone: "attn",
    });
  });

  it("defaults lead assignment push on without enabling email", () => {
    expect(DEFAULT_CHANNEL_PREFERENCES.lead_assignments).toEqual({
      push: true,
      email: false,
    });
  });
});
