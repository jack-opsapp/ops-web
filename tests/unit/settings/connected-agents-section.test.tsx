import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authedFetch } = vi.hoisted(() => ({ authedFetch: vi.fn() }));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ currentUser: { id: "operator-1" } }),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({ authedFetch }));

import { ConnectedAgentsSection } from "@/components/settings/connected-agents-section";

const V2_SCOPES = [
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.customers.read",
  "ops.customer_contacts.read",
  "ops.photos.read",
  "ops.correspondence.read",
  "ops.financials.read",
  "ops.tasks.read",
  "ops.site_visits.read",
  "ops.files.read",
  "ops.financial_documents.read",
  "ops.payments.read",
  "ops.expenses.read",
  "ops.catalog.read",
  "ops.purchasing.read",
  "ops.catalog_costs.read",
  "ops.company.read",
  "ops.team.read",
  "ops.integrations.read",
  "ops.operations.read",
] as const;

const V2_SCOPE_SUMMARY = [
  "See your jobs and their status",
  "See your schedule and who's assigned",
  "See your clients and their jobs",
  "See who to contact on a job and how to reach them",
  "See which jobs are missing photos",
  "See client email history on your jobs",
  "See estimate and invoice summaries on your jobs",
  "See tasks and work that needs attention",
  "See site visits and their evidence status",
  "See authorized job photos, files, and documents",
  "See estimates and invoices in detail",
  "See payment records on authorized invoices",
  "See authorized expenses and reimbursements",
  "See products, stock levels, and selling prices",
  "See purchase orders",
  "See authorized supplier cost facts",
  "See the company operating profile",
  "See the team directory and company availability",
  "See integration health without credentials",
  "See authorized work queues and operational summaries",
].join(" · ");

describe("ConnectedAgentsSection", () => {
  beforeEach(() => {
    authedFetch.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        grants: [
          {
            grantId: "grant-v2",
            clientName: "ChatGPT",
            scopes: V2_SCOPES,
            createdAt: "2026-08-29T20:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      }),
    });
  });

  it("renders a v2 grant with reviewed permission language, never raw scope codes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ConnectedAgentsSection />
      </QueryClientProvider>
    );

    const summary = await screen.findByText(V2_SCOPE_SUMMARY);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/\bops\.[a-z_]+\.read\b/u);
  });
});
