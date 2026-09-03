/**
 * Settings › Comms › Booking — registration and its gate (PUBLIC API P2-4,
 * design §8).
 *
 * The section is hidden entirely for a company whose website is not connected
 * to OPS. That is a fact about the company, not a feature flag, so the shell
 * asks the booking settings once and gates the section on the answer — failing
 * closed while it is still loading, exactly as the Phase-C flag gate does.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  settings: {
    data: undefined as
      | undefined
      | { available: boolean; publicIntegration: boolean; policy: unknown },
    isPending: true,
  },
  can: (_key: string) => true,
};

vi.mock("@/lib/hooks/use-booking-settings", () => ({
  useBookingSettings: () => state.settings,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: <T,>(selector: (s: { currentUser: { devPermission: boolean } }) => T) =>
    selector({ currentUser: { devPermission: false } }),
}));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(selector: (s: { can: (key: string) => boolean }) => T) =>
    selector({ can: (key: string) => state.can(key) }),
  selectPermissionsReady: () => true,
}));
vi.mock("@/lib/store/feature-flags-store", () => ({
  useFeatureFlagsStore: <T,>(
    selector: (s: {
      isPermissionUnlocked: (key: string) => boolean;
      canAccessFeature: (flag: string) => boolean;
    }) => T
  ) => selector({ isPermissionUnlocked: () => true, canAccessFeature: () => true }),
  selectFlagsReady: () => true,
}));

// The registry the shell walks, reduced to the two shapes under test: an
// ordinary section and one that requires a public website integration.
vi.mock("@/components/settings/settings-domains", async () => {
  const { Mail } = await import("lucide-react");
  const domains = [
    {
      id: "comms",
      labelKey: "domains.comms",
      icon: Mail,
      sections: [
        {
          id: "email",
          labelKey: "sections.email",
          permission: "settings.integrations",
          component: () => <div data-testid="body-email" />,
        },
        // A second always-visible section so the sub-section switcher — and
        // therefore every tab in this test — renders whatever booking does.
        {
          id: "templates",
          labelKey: "sections.emailTemplates",
          permission: "settings.integrations",
          component: () => <div data-testid="body-templates" />,
        },
        {
          id: "booking",
          labelKey: "sections.booking",
          permission: "settings.company",
          requires: "public_integration" as const,
          component: () => <div data-testid="body-booking" />,
        },
      ],
    },
  ];
  return {
    SETTINGS_DOMAINS: domains,
    LEGACY_TAB_TO_SECTION: {},
    domainForSection: () => domains[0],
  };
});

import { SettingsShell } from "@/components/settings/settings-shell";

function bookingTab() {
  return screen.queryByRole("tab", { name: "sections.booking" });
}

beforeEach(() => {
  state.settings = { data: undefined, isPending: true };
  state.can = () => true;
});

describe("the booking section's gate", () => {
  it("stays hidden while the answer is still loading", async () => {
    render(<SettingsShell />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "sections.email" })).toBeTruthy());
    expect(bookingTab()).toBeNull();
  });

  it("stays hidden for a company with no public website integration", async () => {
    state.settings = {
      data: { available: true, publicIntegration: false, policy: {} },
      isPending: false,
    };
    render(<SettingsShell />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "sections.email" })).toBeTruthy());
    expect(bookingTab()).toBeNull();
  });

  it("stays hidden when the booking store cannot answer at all", async () => {
    state.settings = {
      data: { available: false, publicIntegration: true, policy: {} },
      isPending: false,
    };
    render(<SettingsShell />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "sections.email" })).toBeTruthy());
    expect(bookingTab()).toBeNull();
  });

  it("shows for a company whose website is wired to OPS", async () => {
    state.settings = {
      data: { available: true, publicIntegration: true, policy: {} },
      isPending: false,
    };
    render(<SettingsShell />);
    await waitFor(() => expect(bookingTab()).toBeTruthy());
  });

  it("stays hidden from an operator without settings.company, however wired", async () => {
    state.settings = {
      data: { available: true, publicIntegration: true, policy: {} },
      isPending: false,
    };
    state.can = (key) => key !== "settings.company";
    render(<SettingsShell />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "sections.email" })).toBeTruthy());
    expect(bookingTab()).toBeNull();
  });
});
