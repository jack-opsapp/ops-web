/**
 * The booking section's place in the Settings IA (PUBLIC API P2-4, design §8):
 * Comms, gated on `settings.company`, and only for a company whose website is
 * connected to OPS.
 */

import { describe, expect, it } from "vitest";

import { SETTINGS_DOMAINS } from "@/components/settings/settings-domains";
import { BookingSettingsTab } from "@/components/settings/booking-settings-tab";

const comms = SETTINGS_DOMAINS.find((domain) => domain.id === "comms");
const booking = comms?.sections.find((section) => section.id === "booking");

describe("Settings › Comms › Booking", () => {
  it("is registered under Comms", () => {
    expect(booking).toBeTruthy();
    expect(booking?.component).toBe(BookingSettingsTab);
    expect(booking?.labelKey).toBe("sections.booking");
  });

  it("is gated on the granular company-settings permission, never a role", () => {
    expect(booking?.permission).toBe("settings.company");
  });

  it("requires a public website integration to appear at all", () => {
    expect(booking?.requires).toBe("public_integration");
  });

  it("carries no legacy tab id — it has never had one", () => {
    expect(booking?.legacyTabIds).toBeUndefined();
  });
});
