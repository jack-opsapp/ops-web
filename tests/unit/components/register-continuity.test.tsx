import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/dictionaries/en/auth.json";
import es from "@/i18n/dictionaries/es/auth.json";
const m = vi.hoisted(() => ({ push: vi.fn(), google: vi.fn(), apple: vi.fn(), signup: vi.fn(), sync: vi.fn(), peek: vi.fn(), consume: vi.fn(), track: vi.fn(), updateProfile: vi.fn(), state: { currentUser: null as unknown, isLoading: false, isAuthenticated: false }, locale: "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/firebase/auth", () => ({ signInWithGoogle: m.google, signInWithApple: m.apple, signUpWithEmail: m.signup, consumeRedirectContext: m.consume, peekRedirectContext: m.peek, signOut: vi.fn() }));
vi.mock("firebase/auth", () => ({ updateProfile: m.updateProfile }));
vi.mock("@/lib/api/services/user-service", () => ({ UserService: { syncUser: m.sync } }));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: (selector: (s: typeof m.state) => unknown) => selector(m.state) }));
vi.mock("@/lib/analytics/analytics", () => ({ trackSignUp: m.track }));
vi.mock("@/components/brand", () => ({ OpsLockup: () => <span>OPS</span> }));
vi.mock("@/components/auth/join-team-prompt", () => ({ JoinTeamPrompt: () => <a href="/join">Enter invite code</a> }));
vi.mock("@/i18n/client", () => ({ useDictionary: () => ({ t: (key: string) => (m.locale === "es" ? es : en)[key as keyof typeof en] ?? key }) }));
import RegisterPage from "@/app/(auth)/register/page";
beforeEach(() => { vi.clearAllMocks(); m.state = { currentUser: null, isLoading: false, isAuthenticated: false }; m.locale = "en"; m.peek.mockReturnValue(null); m.consume.mockReturnValue(null); });
afterEach(() => cleanup());

it("keeps the verified trial offer beside the unchanged account creation action", () => {
  render(<RegisterPage />);
  expect(screen.getByText("30 days free. No credit card.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create Account" })).toBeVisible();
  expect(screen.getByLabelText("Full Name")).toBeVisible();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});
it("shows the offer in Spanish", () => {
  m.locale = "es"; render(<RegisterPage />);
  expect(screen.getByText("30 días gratis. Sin tarjeta de crédito.")).toBeVisible();
});
it("announces a recoverable error without throwing away form values", async () => {
  render(<RegisterPage />);
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Local Test" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(en["register.error.emptyFields"]);
  expect(screen.getByLabelText("Full Name")).toHaveValue("Local Test");
});
it("provides an accessible password visibility control", () => {
  render(<RegisterPage />);
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
});
describe.each(["google", "apple"] as const)("%s signup continuity", provider => {
  it("preserves the provider return context and waits for authenticated sync", async () => {
    m[provider].mockImplementation(() => new Promise(() => {}));
    const view = render(<RegisterPage />);
    fireEvent.click(screen.getByRole("button", { name: provider === "google" ? "Continue with Google" : "Continue with Apple" }));
    expect(m[provider]).toHaveBeenCalledWith({ origin: "register", provider });
    expect(m.track).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    m.state = { currentUser: { id: "canonical-user" }, isLoading: false, isAuthenticated: true };
    m.consume.mockReturnValueOnce({ origin: "register", provider });
    view.rerender(<RegisterPage />);
    await waitFor(() => expect(m.push).toHaveBeenCalledWith("/account-type"));
    expect(m.track).toHaveBeenCalledWith(provider);
    expect(m.sync).not.toHaveBeenCalled(); // AuthProvider owns provider sync.
  });
  it("allows retry after provider cancellation", async () => {
    m[provider].mockRejectedValue({ code: "auth/popup-closed-by-user" });
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole("button", { name: provider === "google" ? "Continue with Google" : "Continue with Apple" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
it("email signup waits for account sync and does not claim a company conversion", async () => {
  let finish: (() => void) | undefined;
  m.signup.mockResolvedValue({ getIdToken: async () => "local-test-token" });
  m.sync.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<RegisterPage />);
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Local Test" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "local@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "local-only-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
  await waitFor(() => expect(m.sync).toHaveBeenCalled());
  expect(m.push).not.toHaveBeenCalled();
  await act(async () => { finish?.(); });
  expect(m.push).toHaveBeenCalledWith("/account-type");
  expect(m.track).toHaveBeenCalledOnce();
  expect(m.track).toHaveBeenCalledWith("email");
});
