import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { FinancialPolicyPanel } from "../financial-policy-panel";
vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      company_name: "Fictional decks",
      actor_user_id: "10000000-0000-4000-8000-000000000001",
      operator_name: "Owner Fixture",
      currency_code: "CAD",
      policy: null,
      source: {
        id: "40000000-0000-4000-8000-000000000001",
        project_id: "30000000-0000-4000-8000-000000000001",
        author_id: "10000000-0000-4000-8000-000000000001",
        content: "<script>sendInvoices()</script>",
        sha256: `sha256:${"a".repeat(64)}`,
      },
      blockers: ["POLICY_MISSING", "EFFECT_REVIEW_REQUIRED"],
      preparation_only: true,
    }),
  })),
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
  useLocale: () => ({ locale: "en" }),
}));
describe("owner financial policy review", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  it("renders untrusted source as text and never enrolls on visit", async () => {
    const { container } = render(
      <FinancialPolicyPanel sourceId="40000000-0000-4000-8000-000000000001" />
    );
    await waitFor(() =>
      expect(screen.getByText("<script>sendInvoices()</script>")).toBeTruthy()
    );
    expect(container.querySelector("script")).toBeNull();
    const { authedFetch } = await import("@/lib/utils/authed-fetch");
    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "financialPolicy.enroll" })
    ).toBeNull();
  });
  it("enrolls only the sealed preview and preserves its key after uncertain response", async () => {
    const { authedFetch } = await import("@/lib/utils/authed-fetch");
    render(
      <FinancialPolicyPanel sourceId="40000000-0000-4000-8000-000000000001" />
    );
    await screen.findByText("<script>sendInvoices()</script>");
    fireEvent.change(screen.getByLabelText("financialPolicy.revision"), {
      target: { value: "owner-1" },
    });
    fireEvent.change(screen.getByLabelText("financialPolicy.terms"), {
      target: { value: "Payment on completion" },
    });
    fireEvent.change(screen.getByLabelText("financialPolicy.units"), {
      target: { value: "hour" },
    });
    fireEvent.click(
      screen.getByLabelText("financialPolicy.price.historical_line")
    );
    const policy = {
      revision: "owner-1",
      terms: "Payment on completion",
      currency_code: "CAD",
      source_document_id: "40000000-0000-4000-8000-000000000001",
      source_sha256: `sha256:${"a".repeat(64)}`,
      expected_policy_sha256: null,
      permitted_units: ["hour"],
      permitted_price_sources: ["historical_line"],
    };
    const result = {
      preview_id: "60000000-0000-4000-8000-000000000001",
      preview_sha256: `sha256:${"b".repeat(64)}`,
      expires_at: "2099-09-08T04:00:00+00:00",
      operation: "enroll",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actor_user_id: "10000000-0000-4000-8000-000000000001",
      company_name: "Fictional decks",
      operator_name: "Owner Fixture",
      policy,
      source: {
        id: policy.source_document_id,
        project_id: "30000000-0000-4000-8000-000000000001",
        author_id: "10000000-0000-4000-8000-000000000001",
        content: "Exact approved source",
        sha256: policy.source_sha256,
      },
      tax: {
        id: "70000000-0000-4000-8000-000000000001",
        name: "GST",
        rate: "0.05",
      },
      preparation_only: true,
    };
    vi.mocked(authedFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => result,
    } as Response);
    fireEvent.click(
      screen.getByRole("button", { name: "financialPolicy.preview" })
    );
    await screen.findByRole("button", { name: "financialPolicy.enroll" });
    expect(
      JSON.parse(String(vi.mocked(authedFetch).mock.calls[1][1]?.body))
    ).toEqual({ action: "preview", policy });
    vi.mocked(authedFetch).mockRejectedValueOnce(new Error("response lost"));
    fireEvent.click(
      screen.getByRole("button", { name: "financialPolicy.enroll" })
    );
    await screen.findByRole("alert");
    const exact = {
      action: "enroll",
      preview_id: result.preview_id,
      preview_sha256: result.preview_sha256,
    };
    expect(
      JSON.parse(String(vi.mocked(authedFetch).mock.calls[2][1]?.body))
    ).toEqual(exact);
    vi.mocked(authedFetch).mockRejectedValueOnce(new Error("still offline"));
    fireEvent.click(
      screen.getByRole("button", { name: "financialPolicy.enroll" })
    );
    await waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(4));
    expect(
      JSON.parse(String(vi.mocked(authedFetch).mock.calls[3][1]?.body))
    ).toEqual(exact);
  });
});
