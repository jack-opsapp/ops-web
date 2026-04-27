import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StrengthMeter } from "@/app/(auth)/auth/action/StrengthMeter";

describe("StrengthMeter", () => {
  it("score=0 for empty", async () => {
    render(<StrengthMeter password="" onScoreChange={() => {}} />);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
  });

  it("strong password scores >=2", async () => {
    let s = -1;
    render(
      <StrengthMeter
        password="ZebraCorrectHorseBattery!2026"
        onScoreChange={(x) => (s = x)}
      />,
    );
    await waitFor(() => expect(s).toBeGreaterThanOrEqual(2), {
      timeout: 2000,
    });
  });

  it("weak <=1", async () => {
    let s = 999;
    render(
      <StrengthMeter password="abc123" onScoreChange={(x) => (s = x)} />,
    );
    await waitFor(() => expect(s).toBeLessThanOrEqual(1), { timeout: 2000 });
  });
});
