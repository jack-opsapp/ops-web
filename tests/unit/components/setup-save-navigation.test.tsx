import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import SetupPage from "@/app/(onboarding)/setup/page";
import { useSetupStore } from "@/stores/setup-store";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  token: vi.fn(async () => "private-token"),
  user: {
    id: "test-user",
    firstName: "Test",
    lastName: "User",
    phone: "",
    companyId: null,
    isCompanyAdmin: true,
    setupProgress: { steps: {} },
  } as Record<string, unknown> | null,
  setUser: vi.fn(),
  begin: vi.fn(),
  applyWidgets: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { getIdToken: mocks.token } }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        currentUser: mocks.user,
        company: null,
        isLoading: false,
        setUser: mocks.setUser,
      }),
    { getState: () => ({ currentUser: mocks.user, setUser: mocks.setUser }) }
  ),
}));
vi.mock("@/stores/preferences-store", () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({ applyWidgetInstances: mocks.applyWidgets }),
}));
vi.mock("@/stores/signout-store", () => ({
  useSignOutStore: (selector: (state: unknown) => unknown) =>
    selector({ begin: mocks.begin }),
}));
vi.mock("@/lib/utils/widget-defaults", () => ({
  getDefaultWidgetInstancesFromSetup: () => [],
}));
vi.mock("@/lib/analytics/analytics", () => ({
  trackCompleteOnboarding: vi.fn(),
}));
vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: mocks.track,
    sessionId: "10000000-0000-4000-8000-000000000001",
  },
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/components/brand", () => ({
  OpsLockup: () => null,
  LogoLoader: () => null,
}));
vi.mock("@/components/setup/SetupIdentityStep", () => ({
  IdentityStep1: () => <div>Identity form</div>,
  IdentityStep2: ({
    companyName,
    onUpdate,
  }: {
    companyName: string;
    onUpdate: (data: { companyName: string }) => void;
  }) => (
    <input
      aria-label="Company name"
      value={companyName}
      onChange={(event) => onUpdate({ companyName: event.target.value })}
    />
  ),
}));
vi.mock("@/components/setup/SetupStarfield", () => ({
  SetupStarfield: () => <div>Questionnaire</div>,
}));
vi.mock("@/components/setup/SetupLaunchAnimation", () => ({
  SetupLaunchAnimation: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = {
    id: "test-user",
    firstName: "Test",
    lastName: "User",
    companyId: null,
    isCompanyAdmin: true,
    setupProgress: { steps: {} },
  };
  mocks.token.mockResolvedValue("private-token");
  useSetupStore.getState().reset();
  useSetupStore.setState({ _hydrated: true });
  window.history.replaceState({}, "", "/setup");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("setup save navigation", () => {
  it.each(["identity", "company"] as const)(
    "keeps %s open on rejection, then advances after a successful retry",
    async (phase) => {
      useSetupStore.setState({ phase, companyName: "Private business" });
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ error: "private failure" }, { status: 500 })
        )
        .mockResolvedValueOnce(Response.json({ success: true }));
      vi.stubGlobal("fetch", fetcher);
      render(<SetupPage />);
      const next = await screen.findByRole("button", { name: /Continue to/ });
      fireEvent.click(next);
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          "Couldn't confirm your details were saved. Try again."
        )
      );
      expect(useSetupStore.getState().phase).toBe(phase);
      expect(useSetupStore.getState().steps[phase]).toBe(false);
      expect(
        mocks.track.mock.calls.some(
          (call) => call[1] === "setup_step_completed"
        )
      ).toBe(false);
      fireEvent.click(next);
      await waitFor(() =>
        expect(useSetupStore.getState().phase).toBe(
          phase === "identity" ? "company" : "starfield"
        )
      );
      expect(useSetupStore.getState().steps[phase]).toBe(true);
      expect(
        mocks.track.mock.calls.filter(
          (call) => call[1] === "setup_step_completed"
        )
      ).toHaveLength(1);
    }
  );

  it("blocks duplicate saves and navigation while an acknowledgement is pending", async () => {
    useSetupStore.setState({ phase: "company" });
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal("fetch", fetcher);
    render(<SetupPage />);
    const next = await screen.findByRole("button", {
      name: "Continue to questionnaire",
    });
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(next).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Company name" })
    ).toBeDisabled();
    // Also guard callbacks (including popover portals outside the fieldset).
    fireEvent.change(screen.getByRole("textbox", { name: "Company name" }), {
      target: { value: "Unsaved edit" },
    });
    expect(useSetupStore.getState().companyName).not.toBe("Unsaved edit");
    fireEvent.click(
      screen.getByRole("button", { name: "Back to personal information" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Skip setup and go to dashboard" })
    );
    expect(useSetupStore.getState().phase).toBe("company");
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => finish(Response.json({ success: true })));
    expect(useSetupStore.getState().phase).toBe("starfield");
  });

  it("waits for the account's saved source and never guesses direct for an older account", async () => {
    mocks.user = null;
    const view = render(<SetupPage />);
    expect(
      mocks.track.mock.calls.filter((call) => call[1] === "setup_started")
    ).toHaveLength(0);
    mocks.user = { id: "account", setupProgress: { steps: {} } };
    view.rerender(<SetupPage />);
    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith(
        "lifecycle",
        "setup_started",
        expect.objectContaining({
          source: "unknown",
          source_reason: "no_signup_snapshot",
        })
      )
    );
    view.rerender(<SetupPage />);
    expect(
      mocks.track.mock.calls.filter((call) => call[1] === "setup_started")
    ).toHaveLength(1);
  });

  it("uses the source captured at signup instead of the current page referrer", async () => {
    mocks.user = {
      id: "account",
      setupProgress: {
        steps: {},
        signup_attribution: {
          version: 1,
          recorded_at: "2026-09-14T20:00:00Z",
          channel: "organic_search",
          basis: "utm_referrer",
          confidence: 0.85,
          reason: "search_referrer",
        },
      },
    };
    render(<SetupPage />);
    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith(
        "lifecycle",
        "setup_started",
        expect.objectContaining({
          source: "organic_search",
          source_basis: "utm_referrer",
        })
      )
    );
  });
});
