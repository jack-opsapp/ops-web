import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "company-1" } }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("firebase-token"),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

import { InvoiceSettingsTab } from "@/components/settings/invoice-settings-tab";

describe("InvoiceSettingsTab", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          config: {
            default_payment_terms: "NET-30",
            default_tax_rate: 0,
            auto_suggest_on_completion: true,
            auto_suggest_from_estimate: true,
            high_value_threshold: 5000,
            include_cover_email: true,
          },
        }),
      })
    );
  });

  it("keeps payment reminders out of invoice settings", async () => {
    render(<InvoiceSettingsTab />);

    await waitFor(() => {
      expect(
        screen.getByText("invoiceSettings.paymentTerms")
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("invoiceSettings.reminders")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("invoiceSettings.enableReminders")
    ).not.toBeInTheDocument();
  });

  it("never sends the financial intelligence section owned by the sibling tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config: {
          default_payment_terms: "NET-30",
          financial_intelligence: { enabled: false, aging_days_threshold: 99 },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceSettingsTab />);

    const coverEmail = await screen.findByRole("switch", {
      name: "invoiceSettings.includeCoverEmail",
    });
    fireEvent.click(coverEmail);
    fireEvent.click(
      screen.getByRole("button", { name: "invoiceSettings.save" })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      config: Record<string, unknown>;
    };
    expect(body.config).not.toHaveProperty("financial_intelligence");
  });
});
