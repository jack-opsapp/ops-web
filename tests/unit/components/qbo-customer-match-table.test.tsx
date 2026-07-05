import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { CustomerMatchTable } from "@/components/accounting/qbo/customer-match-table";
import type { QboCustomerMatch } from "@/lib/types/qbo-import";

// QboCustomerMatch carries displayName (the QB customer's DisplayName, joined
// from staging by getImportReview). The name column renders companyName ??
// displayName; the matched/candidate OPS client is a separate picker.
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
    // Exact email match: the score arrives null and coerces to 0. The label
    // must show the basis ("exact"), never a misleading "0%".
    candidates: [{ clientId: "c-1", name: "Acme Decks", basis: "email", score: 0 }],
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

// A needs_review row — the blocking state that must be surfaced (rose treatment).
const needsReviewMatch: QboCustomerMatch = {
  id: "m4",
  runId: "run-1",
  companyId: "co",
  customerQbId: "QB-NR",
  displayName: "Cascade Concrete",
  companyName: null,
  contactName: null,
  proposedAction: "needs_review",
  matchedClientId: null,
  matchBasis: "name_fuzzy",
  confidence: "medium",
  candidates: [{ clientId: "c-9", name: "Cascade Concrete", basis: "name_fuzzy", score: 0.82 }],
  decidedAction: null,
  decidedClientId: null,
};

describe("CustomerMatchTable", () => {
  it("does not offer needs_review as a selectable action", async () => {
    const user = userEvent.setup();
    render(
      <CustomerMatchTable matches={[companyMatch]} decisions={{}} onDecisionChange={vi.fn()} />
    );
    await user.click(screen.getByTestId("match-action-QB-CO"));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["qbo.action.link", "qbo.action.create", "qbo.action.skip"]);
    expect(options).not.toContain("qbo.action.needs_review");
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
    expect(screen.getByText("Sonnenschein Family Store")).toBeInTheDocument();
    expect(screen.getByText("Adwin Ko")).toBeInTheDocument();
    expect(screen.getByTestId("match-confidence-QB1").textContent).toContain(
      "qbo.confidence.high"
    );
    expect(screen.getByTestId("match-basis-QB1").textContent).toContain(
      "qbo.basis.email"
    );
  });

  it("labels an exact-match candidate by basis, never as a percentage", async () => {
    const user = userEvent.setup();
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    // QB1 is a link row → the candidate picker is present. Open it.
    await user.click(screen.getByTestId("match-candidate-QB1"));
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    const acme = options.find((o) => o.includes("Acme Decks"));
    expect(acme).toBeTruthy();
    // The exact email match shows the basis qualifier, NOT "0%".
    expect(acme).toContain("qbo.candidate.qualifier.email");
    expect(acme).not.toContain("0%");
  });

  it("emits a decision change when an action is picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={onChange} />
    );
    await user.click(screen.getByTestId("match-action-QB2"));
    await user.click(screen.getByRole("option", { name: "qbo.action.skip" }));
    expect(onChange).toHaveBeenCalledWith("QB2", { action: "skip", client_id: undefined });
  });

  it("shows the candidate picker for link rows only", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    expect(screen.getByTestId("match-candidate-QB1")).toBeInTheDocument();
    expect(screen.queryByTestId("match-candidate-QB2")).not.toBeInTheDocument();
  });

  it("gives an unresolved needs_review row the blocking (rose) treatment", () => {
    render(
      <CustomerMatchTable matches={[needsReviewMatch]} decisions={{}} onDecisionChange={vi.fn()} />
    );
    const row = screen.getByTestId("match-row-QB-NR");
    expect(row).toHaveAttribute("data-blocking", "true");
    expect(row.className).toContain("bg-rose-soft");
  });
});
