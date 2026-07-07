import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mutable across tests; `vi.hoisted` so it exists before the hoisted mock
// factories below reference it.
const nav = vi.hoisted(() => ({ redirect: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(
      nav.redirect === null
        ? ""
        : `redirect=${encodeURIComponent(nav.redirect)}`
    ),
}));

vi.mock("@/lib/firebase/auth", () => ({
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  consumeRedirectContext: vi.fn(() => null),
  peekRedirectContext: vi.fn(() => null),
}));

vi.mock("@/lib/api/services/user-service", () => ({
  UserService: { syncUser: vi.fn() },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      currentUser: null,
      setUser: vi.fn(),
      setCompany: vi.fn(),
      isLoading: false,
      isAuthenticated: false,
    }),
}));

vi.mock("@/stores/setup-store", () => ({
  useSetupStore: { getState: () => ({ reset: vi.fn() }) },
}));

vi.mock("@/lib/hooks/use-users", () => ({
  useResetPassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/analytics/analytics", () => ({ trackLogin: vi.fn() }));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

vi.mock("@/components/auth/join-team-prompt", () => ({
  JoinTeamPrompt: () => null,
}));

vi.mock("@/components/brand", () => ({ OpsLockup: () => null }));

const auth = await import("@/lib/firebase/auth");
const LoginPage = (await import("@/app/(auth)/login/page")).default;

describe("login page — post-auth redirect sanitization", () => {
  beforeEach(() => {
    vi.mocked(auth.signInWithGoogle).mockReset();
    vi.mocked(auth.signInWithGoogle).mockResolvedValue(undefined as never);
  });

  it("collapses an external ?redirect to /dashboard (open-redirect guard)", async () => {
    nav.redirect = "https://evil.com";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("login.continueGoogle"));
    await waitFor(() =>
      expect(auth.signInWithGoogle).toHaveBeenCalledWith({
        origin: "login",
        provider: "google",
        redirectTo: "/dashboard",
      })
    );
  });

  it("preserves a safe client-seeded deep link through login", async () => {
    nav.redirect = "/projects/new?clientId=abc";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("login.continueGoogle"));
    await waitFor(() =>
      expect(auth.signInWithGoogle).toHaveBeenCalledWith({
        origin: "login",
        provider: "google",
        redirectTo: "/projects/new?clientId=abc",
      })
    );
  });
});
