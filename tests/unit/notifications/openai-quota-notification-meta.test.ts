import { describe, expect, it } from "vitest";

import {
  lucideIconFromName,
  NOTIF_TYPE_META,
} from "@/lib/notifications/notification-meta";

describe("OpenAI quota notification metadata", () => {
  it("renders through the existing critical notification-rail system", () => {
    const metadata = NOTIF_TYPE_META.ai_provider_quota;

    expect(metadata).toEqual({
      label: "OPENAI",
      icon: "activity",
      tone: "critical",
    });
    expect(lucideIconFromName(metadata.icon)).toBeTypeOf("object");
  });
});
