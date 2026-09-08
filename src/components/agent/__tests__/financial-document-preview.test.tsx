import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import dictionary from "@/i18n/dictionaries/en/agent-queue.json";
import { resultFixture } from "@/lib/agent-control-plane/services/financial-document/__tests__/financial-fixtures";
vi.mock("@/i18n/client", () => ({
  useLocale: () => ({ locale: "en" }),
  useDictionary: () => ({
    t: (key: string) => (dictionary as Record<string, string>)[key] ?? key,
  }),
}));
import { FinancialDocumentPreview } from "../financial-document-preview";

describe("exact private financial draft approval", () => {
  it("shows complete scope, terms, quantity and original and proposed prices", () => {
    render(<FinancialDocumentPreview proposal={resultFixture().proposal} />);
    expect(screen.getByText("Replace damaged boards")).toBeInTheDocument();
    expect(screen.getByText("Railing")).toBeInTheDocument();
    expect(screen.getByText("Payment on completion")).toBeInTheDocument();
    expect(screen.getByText(/1.125 hour/)).toBeInTheDocument();
    expect(screen.getByText(/12.50.*13.50/)).toBeInTheDocument();
    expect(screen.getByText(/CAD.*15.95/)).toBeInTheDocument();
    expect(
      screen.getByText(dictionary["financialDocument.effects"])
    ).toBeInTheDocument();
  });
  it("renders source instructions as inert business text", () => {
    const p = resultFixture().proposal;
    p.request.scope_evidence.statement = '<img src=x onerror="sendInvoice()">';
    const { container } = render(<FinancialDocumentPreview proposal={p} />);
    expect(
      screen.getByText(p.request.scope_evidence.statement)
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
  it("refuses an altered effect or omitted line", () => {
    const p = resultFixture().proposal;
    render(<FinancialDocumentPreview proposal={{ ...p, lines: [] }} />);
    expect(
      screen.getByText(dictionary["financialDocument.unavailable"])
    ).toBeInTheDocument();
    expect(screen.queryByText("Payment on completion")).not.toBeInTheDocument();
  });
});
