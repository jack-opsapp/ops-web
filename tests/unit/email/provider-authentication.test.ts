import { describe, expect, it } from "vitest";

import { gmailAuthenticatedFromDomains } from "@/lib/email/provider-authentication";

describe("gmailAuthenticatedFromDomains", () => {
  it("accepts aligned Gmail DMARC and DKIM pass evidence", () => {
    expect(
      gmailAuthenticatedFromDomains([
        {
          name: "Authentication-Results",
          value:
            "mx.google.com; dkim=pass header.i=@canprodeckandrail.com header.s=google; spf=pass smtp.mailfrom=canprodeckandrail.com; dmarc=pass (p=NONE) header.from=canprodeckandrail.com",
        },
      ])
    ).toEqual(["canprodeckandrail.com"]);
  });

  it("uses only Gmail's first trusted result and ignores a lower forged pass", () => {
    expect(
      gmailAuthenticatedFromDomains([
        {
          name: "Authentication-Results",
          value:
            "mx.google.com; dkim=fail header.i=@canprodeckandrail.com; dmarc=fail header.from=canprodeckandrail.com",
        },
        {
          name: "Authentication-Results",
          value:
            "mx.google.com; dkim=pass header.i=@canprodeckandrail.com; dmarc=pass header.from=canprodeckandrail.com",
        },
      ])
    ).toEqual([]);
  });

  it("accepts Gmail's aligned Workspace SPF domain while ignoring non-Google headers", () => {
    expect(
      gmailAuthenticatedFromDomains([
        {
          name: "Authentication-Results",
          value:
            "mx.google.com; dkim=pass header.i=@canprodeckandrail-com.20251104.gappssmtp.com; spf=pass (google.com: permitted sender) smtp.mailfrom=victoria@canprodeckandrail.com",
        },
        {
          name: "Authentication-Results",
          value:
            "attacker.example; dmarc=pass header.from=canprodeckandrail.com",
        },
      ])
    ).toEqual([
      "canprodeckandrail-com.20251104.gappssmtp.com",
      "canprodeckandrail.com",
    ]);
  });
});
