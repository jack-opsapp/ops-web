import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { CustomerMatchTable } from "@/components/accounting/qbo/customer-match-table";
import type { QboCustomerMatch } from "@/lib/types/qbo-import";

// NOTE: shape reconciled to the A0-owned `QboCustomerMatch` type (the plan's
// A4.4 draft predates the canonical type and referenced a non-existent
// `displayName` / candidate `{ email, similarity }`). The real row carries no
// display name, so the name column falls back to the matched/first candidate
// name (or the QB id), and candidates use `{ clientId, name, basis, score }`.
const matches: QboCustomerMatch[] = [
  {
    id: "m1",
    runId: "run-1",
    companyId: "co",
    customerQbId: "QB1",
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
    proposedAction: "create",
    matchedClientId: null,
    matchBasis: "none",
    confidence: "low",
    candidates: [],
    decidedAction: null,
    decidedClientId: null,
  },
];

describe("CustomerMatchTable", () => {
  it("renders one row per match with confidence + basis", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    // QB1 resolves its name from the matched candidate; QB2 (no candidate) falls
    // back to its QB id.
    expect(screen.getByText("Acme Decks")).toBeInTheDocument();
    expect(screen.getByText("QB2")).toBeInTheDocument();
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
