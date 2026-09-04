import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGA4SpecRequests } from "@/lib/admin/spec-analytics-queries";

describe("SPEC analytics GA4 requests", () => {
  beforeEach(() => {
    vi.stubEnv("GA4_MARKETING_PROPERTY_ID", "475051117");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("combines page and event filters with the marketing production hosts", () => {
    const [webRequest, eventRequest] = buildGA4SpecRequests(
      "2026-08-01",
      "2026-08-31"
    );

    const hostnameFilter = {
      filter: {
        fieldName: "hostName",
        inListFilter: {
          values: ["opsapp.co", "www.opsapp.co", "try.opsapp.co"],
          caseSensitive: false,
        },
      },
    };

    expect(webRequest.dimensions ?? []).not.toContainEqual({
      name: "hostName",
    });
    expect(webRequest.dimensionFilter).toEqual({
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "pagePath",
              stringFilter: { matchType: "BEGINS_WITH", value: "/spec" },
            },
          },
          hostnameFilter,
        ],
      },
    });

    expect(eventRequest.dimensions).toEqual([{ name: "eventName" }]);
    expect(eventRequest.dimensionFilter).toEqual({
      andGroup: {
        expressions: [
          {
            andGroup: {
              expressions: [
                {
                  filter: {
                    fieldName: "pagePath",
                    stringFilter: {
                      matchType: "BEGINS_WITH",
                      value: "/spec",
                    },
                  },
                },
                {
                  filter: {
                    fieldName: "eventName",
                    inListFilter: {
                      values: [
                        "page_view",
                        "spec_card_expand",
                        "pay_deposit_click",
                        "billing_address_submitted",
                        "stripe_checkout_opened",
                        "stripe_checkout_completed",
                        "intake_submitted",
                        "discovery_booked",
                        "spec_default_ops_signup_completed",
                      ],
                    },
                  },
                },
              ],
            },
          },
          hostnameFilter,
        ],
      },
    });
  });
});
