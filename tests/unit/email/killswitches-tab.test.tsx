/**
 * KillswitchesTab — basic render test. Confirms the three required
 * sections appear and the global switch starts in the "off" position.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KillswitchesTab } from "@/app/admin/email/_components/killswitches-tab";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, active: [] }),
    })
  );
});

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <KillswitchesTab />
    </QueryClientProvider>
  );
}

describe("KillswitchesTab", () => {
  it("renders global, sender bucket, and campaigns sections", () => {
    renderTab();
    expect(screen.getByText("// GLOBAL")).toBeTruthy();
    expect(screen.getByText("// SENDER BUCKETS")).toBeTruthy();
    expect(screen.getByText("// CAMPAIGNS")).toBeTruthy();
  });

  it("renders all four bucket switches", () => {
    renderTab();
    expect(screen.getByText("DISPATCH")).toBeTruthy();
    expect(screen.getByText("GATE")).toBeTruthy();
    expect(screen.getByText("FIELD_NOTES")).toBeTruthy();
    expect(screen.getByText("PORTAL")).toBeTruthy();
  });

  it("global switch is off (aria-checked=false) when no active pauses", () => {
    renderTab();
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBe(5); // global + 4 buckets
    for (const s of switches) {
      expect(s.getAttribute("aria-checked")).toBe("false");
    }
  });
});
