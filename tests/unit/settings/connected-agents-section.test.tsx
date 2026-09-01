import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const V3_SCOPES = [
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const;

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAgentsSection />
    </QueryClientProvider>
  );
}

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
    renderSection();

    const summary = await screen.findByText(V2_SCOPE_SUMMARY);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/\bops\.[a-z_]+\.read\b/u);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("shows one exact daily control only for a server-eligible v3 grant", async () => {
    authedFetch.mockImplementation(async (url: string) => {
      if (url === "/api/mcp/oauth/grants") {
        return {
          ok: true,
          json: async () => ({
            grants: [
              {
                grantId: "dc000000-0000-4000-8000-000000000031",
                clientName: "Claude",
                scopes: V3_SCOPES,
                createdAt: "2026-08-30T20:00:00.000Z",
                lastUsedAt: null,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          routines: [
            {
              grantId: "dc000000-0000-4000-8000-000000000031",
              clientId: "dc000000-0000-4000-8000-000000000021",
              clientName: "Claude",
              enabled: false,
              localTime: "20:00",
              timezone: "America/Vancouver",
              nextRunAt: null,
              lastRunAt: null,
              lastSuccessAt: null,
              lastFailureCode: null,
              scheduleRevision: 0,
            },
          ],
        }),
      };
    });

    renderSection();

    expect(await screen.findByText("Close out my day")).toBeInTheDocument();
    expect(
      screen.getByText("Sends nothing. Moves no money.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Run every day")).not.toBeChecked();
    expect(screen.getByLabelText("Local time")).toHaveValue("20:00");
    expect(screen.getByText("America/Vancouver")).toBeInTheDocument();
  });

  it("saves the explicit switch and time, then refetches authoritative state", async () => {
    let enabled = false;
    let localTime = "20:00";
    authedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/mcp/oauth/grants") {
        return {
          ok: true,
          json: async () => ({
            grants: [
              {
                grantId: "dc000000-0000-4000-8000-000000000031",
                clientName: "Claude",
                scopes: V3_SCOPES,
                createdAt: "2026-08-30T20:00:00.000Z",
                lastUsedAt: null,
              },
            ],
          }),
        };
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          enabled: boolean;
          localTime: string;
        };
        enabled = body.enabled;
        localTime = body.localTime;
        return {
          ok: true,
          json: async () => ({ routine: { enabled, localTime } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          routines: [
            {
              grantId: "dc000000-0000-4000-8000-000000000031",
              clientId: "dc000000-0000-4000-8000-000000000021",
              clientName: "Claude",
              enabled,
              localTime,
              timezone: "America/Vancouver",
              nextRunAt: enabled ? "2026-09-01T04:30:00.000Z" : null,
              lastRunAt: null,
              lastSuccessAt: null,
              lastFailureCode: null,
              scheduleRevision: enabled ? 1 : 0,
            },
          ],
        }),
      };
    });

    renderSection();
    const control = await screen.findByLabelText("Run every day");
    fireEvent.click(control);
    fireEvent.change(screen.getByLabelText("Local time"), {
      target: { value: "21:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save closeout" }));

    await waitFor(() => {
      expect(authedFetch).toHaveBeenCalledWith(
        "/api/mcp/routines/day-closeout",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            grantId: "dc000000-0000-4000-8000-000000000031",
            enabled: true,
            localTime: "21:30",
          }),
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Run every day")).toBeChecked();
      expect(screen.getByLabelText("Local time")).toHaveValue("21:30");
    });
  });

  it("removes the routine with its grant after server-confirmed revocation", async () => {
    let live = true;
    authedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/mcp/oauth/grants" && init?.method === "DELETE") {
        live = false;
        return { ok: true, json: async () => ({ revoked: true }) };
      }
      if (url === "/api/mcp/oauth/grants") {
        return {
          ok: true,
          json: async () => ({
            grants: live
              ? [
                  {
                    grantId: "dc000000-0000-4000-8000-000000000031",
                    clientName: "Claude",
                    scopes: V3_SCOPES,
                    createdAt: "2026-08-30T20:00:00.000Z",
                    lastUsedAt: null,
                  },
                ]
              : [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          routines: live
            ? [
                {
                  grantId: "dc000000-0000-4000-8000-000000000031",
                  clientId: "dc000000-0000-4000-8000-000000000021",
                  clientName: "Claude",
                  enabled: true,
                  localTime: "20:00",
                  timezone: "America/Vancouver",
                  nextRunAt: "2026-09-01T03:00:00.000Z",
                  lastRunAt: null,
                  lastSuccessAt: null,
                  lastFailureCode: null,
                  scheduleRevision: 1,
                },
              ]
            : [],
        }),
      };
    });

    renderSection();
    expect(await screen.findByText("Close out my day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(
      await screen.findByText("[no external agents connected]")
    ).toBeInTheDocument();
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/mcp/oauth/grants",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(screen.queryByText("Close out my day")).not.toBeInTheDocument();
  });
});
