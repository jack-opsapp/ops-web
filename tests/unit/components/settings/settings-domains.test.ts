import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/auth", () => ({
  changePassword: vi.fn(),
  getAuthProvider: vi.fn().mockReturnValue(null),
  getIdToken: vi.fn().mockResolvedValue(null),
  isEmailPasswordUser: vi.fn().mockReturnValue(false),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(),
}));

import {
  SETTINGS_DOMAINS,
  isSettingsSectionVisible,
} from "@/components/settings/settings-domains";

const website = SETTINGS_DOMAINS.flatMap((domain) =>
  domain.sections.map((section) => ({ domain: domain.id, section }))
).find(({ section }) => section.id === "website");

describe("settings Website information architecture", () => {
  it("places Website under Comms with both the permission and pilot gate", () => {
    expect(website).toBeDefined();
    expect(website?.domain).toBe("comms");
    expect(website?.section.permission).toBe("settings.integrations");
    expect(website?.section.flag).toBe("external_api");
    expect(website?.section.devOnly).not.toBe(true);

    const advanced = SETTINGS_DOMAINS.find(
      (domain) => domain.id === "advanced"
    );
    expect(advanced?.sections.some((section) => section.id === "website")).toBe(
      false
    );
  });

  it.each([
    ["permissions unresolved", false, true, true, false],
    ["flags unresolved", true, false, true, false],
    ["permission denied", true, true, false, false],
    ["pilot disabled", true, true, true, false],
    ["both granted", true, true, true, true],
  ])(
    "fails closed when %s",
    (_label, permissionsReady, flagsReady, permissionGranted, expected) => {
      const canAccessFeature = vi
        .fn()
        .mockReturnValue(_label === "pilot disabled" ? false : true);
      const visible = isSettingsSectionVisible(website!.section, {
        devPermission: false,
        permissionsReady,
        flagsReady,
        can: () => permissionGranted,
        isPermissionUnlocked: () => true,
        canAccessFeature,
      });

      expect(visible).toBe(expected);
    }
  );
});
