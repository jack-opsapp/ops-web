import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExpenseAccountingIssues } from "@/components/settings/expense-accounting-issues";
import type { ExpenseAccountingIssue } from "@/lib/types/expense-accounting-issues";
import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";
import { toast } from "@/components/ui/toast";
const state = vi.hoisted(() => ({ locale: "en", allowed: true }));
vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: async () => "actor-token",
}));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (s: { can: () => boolean }) => unknown) =>
    selector({ can: () => state.allowed }),
}));
vi.mock("@/i18n/client", () => ({
  useLocale: () => ({ locale: state.locale }),
  useDictionary: () => ({
    t: (key: string) =>
      (state.locale === "en" ? en : es)[key as keyof typeof en] ?? key,
  }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn() } }));
const issue: ExpenseAccountingIssue = {
  queueId: "queue-1",
  provider: "sage",
  kind: "accrual",
  merchantName: "Hardware",
  amount: 105,
  currency: "CAD",
  expenseDate: "2026-09-12",
  reason: "accounts",
  recovery: "retry",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const page = (issues = [issue], nextOffset: number | null = null) => ({
  connectionId: "connection-1",
  issues,
  nextOffset,
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExpenseAccountingIssues
        companyId="company-1"
        connectionId="connection-1"
      />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  state.locale = "en";
  state.allowed = true;
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(respond(page())))
  );
});
describe("expense issue recovery UI", () => {
  it("does not fetch financial issues without permission", () => {
    state.allowed = false;
    mount();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Expense sync")).toBeNull();
  });
  it.each(["en", "es"])(
    "shows named retry work and explicit current-settings copy in %s",
    async (locale) => {
      state.locale = locale;
      mount();
      await screen.findByText("Hardware");
      expect(
        screen.getByRole("button", {
          name:
            locale === "en"
              ? "Retry with current settings"
              : "Reintentar con configuración actual",
        })
      ).toBeEnabled();
      expect(screen.queryByText("queue-1")).toBeNull();
      expect(screen.queryByText(/accounting\.expenseIssues/)).toBeNull();
    }
  );
  it.each(["reconcile", "connection"] as const)(
    "offers no retry for %s work",
    async (recovery) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        respond(page([{ ...issue, recovery }]))
      );
      mount();
      await screen.findByText("Hardware");
      expect(
        screen.queryByRole("button", { name: "Retry with current settings" })
      ).toBeNull();
      expect(
        screen.getByText(
          recovery === "reconcile"
            ? /Check the transaction/
            : /Reconnect or enable/
        )
      ).toBeInTheDocument();
    }
  );
  it("posts only the chosen queue ID and resets pagination after confirmed queueing", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page()))
      .mockResolvedValueOnce(
        respond({ queueId: issue.queueId, status: "pending" })
      )
      .mockResolvedValueOnce(respond(page([])));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry with current settings" })
    );
    await screen.findByText("No expense sync issues.");
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    ).toEqual({ queueId: issue.queueId });
    expect(vi.mocked(fetch).mock.calls[1][1]!.headers).toMatchObject({
      Authorization: "Bearer actor-token",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Expense queued with current settings."
    );
  });
  it("reports safe cancellation as an updated accounting status, not queued or paid", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page()))
      .mockResolvedValueOnce(
        respond({ queueId: issue.queueId, status: "cancelled" })
      )
      .mockResolvedValueOnce(respond(page([])));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry with current settings" })
    );
    await screen.findByText("No expense sync issues.");
    expect(toast.success).toHaveBeenCalledWith(
      "Expense accounting status updated."
    );
    expect(toast.success).not.toHaveBeenCalledWith(
      "Expense queued with current settings."
    );
  });
  it("allows a newly failed retry to be reviewed again after refreshed canonical status", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page()))
      .mockResolvedValueOnce(
        respond({ queueId: issue.queueId, status: "pending" })
      )
      .mockResolvedValueOnce(respond(page()));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry with current settings" })
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(
      await screen.findByRole("button", { name: "Retry with current settings" })
    ).toBeEnabled();
  });
  it("blocks repeated clicks until retry returns", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page()))
      .mockImplementationOnce(() => new Promise(() => undefined));
    mount();
    const retry = await screen.findByRole("button", {
      name: "Retry with current settings",
    });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Queueing…" })).toBeDisabled();
  });
  it("retains the issue after rejected or unconfirmed retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page()))
      .mockResolvedValueOnce(
        respond({ queueId: issue.queueId, status: "succeeded" })
      );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry with current settings" })
    );
    await screen.findByRole("alert");
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("loads subsequent pages without hiding the first issues", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(page([issue], 50)))
      .mockResolvedValueOnce(
        respond(page([{ ...issue, queueId: "queue-2", merchantName: "Fuel" }]))
      );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Fuel");
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("offset=50");
  });
  it("rejects a response for a different connection", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      respond({ ...page(), connectionId: "other" })
    );
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Hardware")).toBeNull();
  });
});


it.each(["en", "es"])("shows paused sync without a retry action in %s", async (locale) => {
  state.locale = locale;
  vi.mocked(fetch).mockResolvedValueOnce(respond(page([{ ...issue, recovery: "paused" }])));
  mount();
  await screen.findByText("Hardware");
  expect(screen.getByText(locale === "en" ? "PAUSED" : "EN PAUSA")).toBeInTheDocument();
  expect(screen.getByText(locale === "en" ? "Expense accounting sync is paused. Retry will be available when sync resumes." : "La sincronización contable de gastos está en pausa. Podrás reintentar cuando se reanude.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Retry with current settings|Reintentar con configuración actual/ })).toBeNull();
  expect(screen.queryByText(/accounting\.expenseIssues/)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shows paused status after a stale retry is rejected and refreshes its canonical status", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(respond(page()))
    .mockResolvedValueOnce(respond({ code: "EXPENSE_ACCOUNTING_PAUSED", error: "Expense accounting sync is paused." }, 409))
    .mockResolvedValueOnce(respond(page([{ ...issue, recovery: "paused" }])));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Retry with current settings" }));
  await screen.findByText("PAUSED");
  expect(screen.queryByRole("button", { name: "Retry with current settings" })).toBeNull();
  expect(toast.success).not.toHaveBeenCalled();
});
