import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RecoverFlow } from "@/app/(auth)/auth/action/RecoverFlow";

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  checkActionCode: vi.fn(),
  applyActionCode: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
const fb = await import("firebase/auth");

describe("RecoverFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders old → new diff", async () => {
    vi.mocked(fb.checkActionCode).mockResolvedValue({
      data: { email: "old@opsapp.co", previousEmail: "new@opsapp.co" },
      operation: "RECOVER_EMAIL",
    } as never);
    render(<RecoverFlow oobCode="ok" />);
    await waitFor(() => {
      expect(screen.getByText(/old@opsapp\.co/)).toBeInTheDocument();
      expect(screen.getByText(/new@opsapp\.co/)).toBeInTheDocument();
    });
  });

  it("revert + reset offered", async () => {
    vi.mocked(fb.checkActionCode).mockResolvedValue({
      data: { email: "old@opsapp.co", previousEmail: "new@opsapp.co" },
      operation: "RECOVER_EMAIL",
    } as never);
    vi.mocked(fb.applyActionCode).mockResolvedValue(undefined);
    render(<RecoverFlow oobCode="ok" />);
    await waitFor(() =>
      screen.getByRole("button", { name: /revert email/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /revert email/i }));
    await waitFor(() =>
      expect(screen.getByText(/email reverted/i)).toBeInTheDocument(),
    );
  });
});
