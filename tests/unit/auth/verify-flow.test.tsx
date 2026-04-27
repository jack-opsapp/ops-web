import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { VerifyFlow } from "@/app/(auth)/auth/action/VerifyFlow";

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  applyActionCode: vi.fn(),
}));
const fb = await import("firebase/auth");

describe("VerifyFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies on mount → success", async () => {
    vi.mocked(fb.applyActionCode).mockResolvedValue(undefined);
    render(<VerifyFlow oobCode="ok" />);
    await waitFor(() =>
      expect(screen.getByText(/email verified/i)).toBeInTheDocument(),
    );
  });

  it("expired → expired error", async () => {
    vi.mocked(fb.applyActionCode).mockRejectedValue({
      code: "auth/expired-action-code",
    });
    render(<VerifyFlow oobCode="exp" />);
    await waitFor(() =>
      expect(screen.getByText(/link expired/i)).toBeInTheDocument(),
    );
  });
});
