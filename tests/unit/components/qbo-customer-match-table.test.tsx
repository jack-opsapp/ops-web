import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { CustomerMatchTable } from "@/components/accounting/qbo/customer-match-table";
import type { QboCustomerMatch } from "@/lib/types/qbo-import";

// QboCustomerMatch carries displayName (the QB customer's DisplayName, joined
// from staging by getImportReview). The name column renders displayName; the
// matched/candidate OPS client is shown separately in the OPS-client column.
const matches: QboCustomerMatch[] = [
  {
    id: "m1",
    runId: "run-1",
    companyId: "co",
    customerQbId: "QB1",
    displayName: "Sonnenschein Family Store",
    companyName: null,
    contactName: null,
    proposedAction: "link",
    matchedClientId: "c-1",
    matchBasis: "email",
    confidence: "high",
    candidates: [{ clientId: "c-1", name: "Acme Decks", basis: "email", score: 1 }],
    decidedAction: null,
    decidedClientId: null,
  },
  {
    id: "m2",
    runId: "run-1",
    companyId: "co",
    customerQbId: "QB2",
    displayName: "Adwin Ko",
    companyName: null,
    contactName: null,
    proposedAction: "create",
    matchedClientId: null,
    matchBasis: "none",
    confidence: "low",
    candidates: [],
    decidedAction: null,
    decidedClientId: null,
  },
];

// A company-type match: CompanyName + a contact person. proposedAction is
// "create" (NOT needs_review), so the disabled needs_review option is absent.
const companyMatch: QboCustomerMatch = {
  id: "m3",
  runId: "run-1",
  companyId: "co",
  customerQbId: "QB-CO",
  displayName: "Acme Corp",
  companyName: "Acme Corp",
  contactName: "John Smith",
  proposedAction: "create",
  matchedClientId: null,
  matchBasis: "none",
  confidence: null,
  candidates: [],
  decidedAction: null,
  decidedClientId: null,
};

describe("CustomerMatchTable", () => {
  it("does not offer needs_review as a selectable action", () => {
    render(
      <CustomerMatchTable matches={[companyMatch]} decisions={{}} onDecisionChange={vi.fn()} />
    );
    const select = screen.getByTestId("match-action-QB-CO");
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(values).toEqual(["link", "create", "skip"]);
  });

  it("shows the contact name as a sub-line for company customers", () => {
    render(
      <CustomerMatchTable matches={[companyMatch]} decisions={{}} onDecisionChange={vi.fn()} />
    );
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
  });

  it("renders one row per match with confidence + basis", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    // The name column shows the QB customer's DisplayName (not the matched
    // OPS client, which appears in the OPS-client picker).
    expect(screen.getByText("Sonnenschein Family Store")).toBeInTheDocument();
    expect(screen.getByText("Adwin Ko")).toBeInTheDocument();
    expect(screen.getByTestId("match-confidence-QB1").textContent).toContain(
      "qbo.confidence.high"
    );
    expect(screen.getByTestId("match-basis-QB1").textContent).toContain(
      "qbo.basis.email"
    );
  });

  it("emits a decision change when an action is picked", () => {
    const onChange = vi.fn();
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={onChange} />
    );
    fireEvent.change(screen.getByTestId("match-action-QB2"), {
      target: { value: "skip" },
    });
    expect(onChange).toHaveBeenCalledWith("QB2", { action: "skip", client_id: undefined });
  });

  it("shows the candidate picker for link rows", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    expect(screen.getByTestId("match-candidate-QB1")).toBeInTheDocument();
    expect(screen.queryByTestId("match-candidate-QB2")).not.toBeInTheDocument();
  });
});
