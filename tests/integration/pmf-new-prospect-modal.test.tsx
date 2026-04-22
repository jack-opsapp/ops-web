/**
 * Integration tests for NewProspectModal (Task 21).
 *
 * Mocks next/navigation for router and global.fetch for the POST. The
 * modal is rendered directly — no Next.js routing harness — and we
 * assert against the exact JSON body the form ships, the redirect
 * target, and the surfaced error on validation failure.
 *
 * Critical envelope assertion: the route returns { data: { id } }
 * (corrected in Task 15 fix-up dfd406b). The redirect MUST use
 * json.data.id, not json.prospect.id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
const mockBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { NewProspectModal } from "@/components/pmf/new-prospect-modal";

describe("NewProspectModal", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    vi.restoreAllMocks();
  });

  it("renders all required fields", () => {
    render(<NewProspectModal />);
    // Field labels are uppercase per the design system.
    expect(screen.getByText("NAME")).toBeInTheDocument();
    expect(screen.getByText("COMPANY")).toBeInTheDocument();
    expect(screen.getByText("EMAIL")).toBeInTheDocument();
    expect(screen.getByText("PHONE")).toBeInTheDocument();
    expect(screen.getByText("DEAL TYPE")).toBeInTheDocument();
    expect(screen.getByText("SOURCE")).toBeInTheDocument();
    expect(screen.getByText("FIRST CONTACT")).toBeInTheDocument();
    expect(screen.getByText("NOTES")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create prospect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("derives direction='outbound' for outbound_cold source and POSTs the right body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "new-prospect-id-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewProspectModal />);

    fireEvent.change(screen.getByPlaceholderText("Jane Foreman"), {
      target: { value: "Test Caller" },
    });
    fireEvent.change(screen.getByPlaceholderText("Acme Roofing"), {
      target: { value: "Cold Co" },
    });
    fireEvent.change(screen.getByDisplayValue("REFERRAL"), {
      target: { value: "outbound_cold" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create prospect/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/pmf/prospects");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Test Caller");
    expect(body.company).toBe("Cold Co");
    expect(body.source).toBe("outbound_cold");
    expect(body.first_contact_direction).toBe("outbound");
    expect(body.deal_type).toBe("tier_a"); // default
    // first_contact_at must be ISO 8601 with timezone marker
    expect(body.first_contact_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });

  it("derives direction='inbound' for paid_ad source", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "p-2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewProspectModal />);

    fireEvent.change(screen.getByPlaceholderText("Jane Foreman"), {
      target: { value: "Inbound Person" },
    });
    fireEvent.change(screen.getByDisplayValue("REFERRAL"), {
      target: { value: "paid_ad" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create prospect/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source).toBe("paid_ad");
    expect(body.first_contact_direction).toBe("inbound");
  });

  it("surfaces a 400 validation error and does NOT redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Invalid body",
        issues: [
          { path: ["email"], message: "Invalid email" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewProspectModal />);

    fireEvent.change(screen.getByPlaceholderText("Jane Foreman"), {
      target: { value: "Bad Email" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create prospect/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Field name surfaced from the Zod issue
    expect(screen.getByRole("alert").textContent).toMatch(/email/i);
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid email/i);
    // No navigation
    expect(mockPush).not.toHaveBeenCalled();
    // Submit button should be re-enabled (text reverts from "SAVING…")
    expect(
      screen.getByRole("button", { name: /create prospect/i }),
    ).not.toBeDisabled();
  });

  it("redirects to /admin/pmf/prospects/<id> using json.data.id on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: "abc-123", name: "X", company: "Y" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewProspectModal />);

    fireEvent.change(screen.getByPlaceholderText("Jane Foreman"), {
      target: { value: "Happy Path" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create prospect/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/admin/pmf/prospects/abc-123");
    });
  });

  it("CANCEL calls router.back()", () => {
    render(<NewProspectModal />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("handles missing id in success response without redirecting", async () => {
    // Defends against the Task 15 envelope drift — if a future change
    // returns { prospect: { id } } again, the form should error rather
    // than navigate to /admin/pmf/prospects/undefined.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewProspectModal />);
    fireEvent.change(screen.getByPlaceholderText("Jane Foreman"), {
      target: { value: "No Id" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create prospect/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
