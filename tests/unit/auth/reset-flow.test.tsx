import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ResetFlow } from "@/app/(auth)/auth/action/ResetFlow";

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  verifyPasswordResetCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));
const fb = await import("firebase/auth");

describe("ResetFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checking → form on valid code", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockResolvedValue("user@opsapp.co");
    render(<ResetFlow oobCode="ok" />);
    await waitFor(() =>
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("user@opsapp.co")).toBeInTheDocument();
  });

  it("expired → expired error", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockRejectedValue({
      code: "auth/expired-action-code",
    });
    render(<ResetFlow oobCode="exp" />);
    await waitFor(() =>
      expect(screen.getByText(/link expired/i)).toBeInTheDocument(),
    );
  });

  it("invalid → already used", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockRejectedValue({
      code: "auth/invalid-action-code",
    });
    render(<ResetFlow oobCode="bad" />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /already used/i }),
      ).toBeInTheDocument(),
    );
  });

  it("network → network error", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockRejectedValue({
      code: "auth/network-request-failed",
    });
    render(<ResetFlow oobCode="net" />);
    await waitFor(() =>
      expect(screen.getByText(/can't reach us/i)).toBeInTheDocument(),
    );
  });

  it("submit → success", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockResolvedValue("u@opsapp.co");
    vi.mocked(fb.confirmPasswordReset).mockResolvedValue(undefined);
    render(<ResetFlow oobCode="ok" />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "ZebraCorrectHorseBattery2026!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() =>
      expect(screen.getByText(/password reset/i)).toBeInTheDocument(),
    );
  });

  it("weak rejected", async () => {
    vi.mocked(fb.verifyPasswordResetCode).mockResolvedValue("u@opsapp.co");
    vi.mocked(fb.confirmPasswordReset).mockRejectedValue({
      code: "auth/weak-password",
    });
    render(<ResetFlow oobCode="ok" />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "Decent12!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() =>
      expect(screen.getByText(/needs more/i)).toBeInTheDocument(),
    );
  });
});
