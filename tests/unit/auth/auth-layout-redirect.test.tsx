import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  onboardingRoute: null as string | null,
  pathname: "/login",
  redirect: null as string | null,
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
  usePathname: () => state.pathname,
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
  }),
}));

vi.mock("@/hooks/useSetupGate", () => ({
  useSetupGate: () => ({ onboardingRoute: state.onboardingRoute }),
}));

vi.mock("@/components/providers/auth-provider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/brand", () => ({
  OpsLockup: () => null,
  LogoLoader: () => null,
}));

import AuthGroupLayout from "@/app/(auth)/layout";

function setRedirect(redirect: string | null) {
  state.redirect = redirect;
  const href =
    redirect === null
      ? "/login"
      : `/login?redirect=${encodeURIComponent(redirect)}`;
  window.history.replaceState({}, "", href);
}

describe("auth layout post-auth destination", () => {
  beforeEach(() => {
    state.isAuthenticated = true;
    state.isLoading = false;
    state.onboardingRoute = null;
    state.pathname = "/login";
    setRedirect(null);
    state.replace.mockReset();
  });

  it("preserves the exact same-origin MCP authorization continuation", async () => {
    setRedirect(
      "/oauth/authorize?response_type=code&client_id=codex&scope=ops.jobs.read"
    );

    render(<AuthGroupLayout>login</AuthGroupLayout>);

    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith(state.redirect)
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
  ])("rejects an unsafe redirect target: %s", async (redirect) => {
    setRedirect(redirect);

    render(<AuthGroupLayout>login</AuthGroupLayout>);

    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith("/dashboard")
    );
  });

  it("keeps incomplete onboarding ahead of a requested continuation", async () => {
    setRedirect("/oauth/authorize?client_id=codex");
    state.onboardingRoute = "/setup";

    render(<AuthGroupLayout>login</AuthGroupLayout>);

    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/setup"));
  });
});
