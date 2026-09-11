import { describe, expect, it } from "vitest";
import { verifySiteVisitTimezoneProof } from "../civil-time";

describe("authenticated SQL civil-time proof arithmetic", () => {
  it.each([
    ["America/Vancouver", "2026-11-02T00:00:00", "2026-11-02T07:00:00Z", -420],
    [
      "America/Los_Angeles",
      "2024-11-03T01:30:00",
      "2024-11-03T08:30:00Z",
      -420,
    ],
    [
      "America/Los_Angeles",
      "2024-11-03T01:30:00",
      "2024-11-03T09:30:00Z",
      -480,
    ],
    ["Asia/Kathmandu", "2026-01-01T00:00:00", "2025-12-31T18:15:00Z", 345],
    ["Asia/Kolkata", "2026-01-01T00:00:00", "2025-12-31T18:30:00Z", 330],
    ["America/St_Johns", "2026-12-31T23:30:00", "2027-01-01T03:00:00Z", -210],
  ])(
    "preserves SQL's exact %s interpretation without Node ICU",
    (timezone, local, instant, utc_offset_minutes) => {
      const proof = {
        timezone,
        probes: [{ local, instant, utc_offset_minutes }],
      };
      expect(verifySiteVisitTimezoneProof(proof)).toEqual(proof);
    }
  );
  it.each([
    "2026-02-30T12:00:00",
    "2026-01-01T24:00:00",
    "2026-09-10T09:00:00Z",
  ])("rejects invalid civil text %s", (local) => {
    expect(() =>
      verifySiteVisitTimezoneProof({
        timezone: "UTC",
        probes: [
          { local, instant: "2026-01-01T00:00:00Z", utc_offset_minutes: 0 },
        ],
      })
    ).toThrow();
  });
  it("rejects offset/instant substitution and empty proof", () => {
    const proof = {
      timezone: "America/Vancouver",
      probes: [
        {
          local: "2026-11-02T00:00:00",
          instant: "2026-11-02T07:00:00Z",
          utc_offset_minutes: -480,
        },
      ],
    };
    expect(() => verifySiteVisitTimezoneProof(proof)).toThrow(
      "TIMEZONE_PROOF_MISMATCH"
    );
    expect(() =>
      verifySiteVisitTimezoneProof({ ...proof, probes: [] })
    ).toThrow();
  });
});
