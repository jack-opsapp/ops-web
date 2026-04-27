import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SignInFlow } from "@/app/(auth)/auth/action/SignInFlow";

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  isSignInWithEmailLink: vi.fn(() => true),
  signInWithEmailLink: vi.fn(),
}));
const fb = await import("firebase/auth");

describe("SignInFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => "user@opsapp.co"),
        removeItem: vi.fn(),
      },
      writable: true,
    });
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });
  });

  it("invalid continueUrl falls back to /dashboard", async () => {
    vi.mocked(fb.signInWithEmailLink).mockResolvedValue({} as never);
    render(<SignInFlow oobCode="ok" continueUrl="https://attacker.com" />);
    await waitFor(() =>
      expect(window.location.href).toMatch(/dashboard|opsapp\.co/),
    );
  });

  it("valid continueUrl preserved", async () => {
    vi.mocked(fb.signInWithEmailLink).mockResolvedValue({} as never);
    render(
      <SignInFlow
        oobCode="ok"
        continueUrl="https://app.opsapp.co/projects"
      />,
    );
    await waitFor(() =>
      expect(window.location.href).toBe("https://app.opsapp.co/projects"),
    );
  });
});
