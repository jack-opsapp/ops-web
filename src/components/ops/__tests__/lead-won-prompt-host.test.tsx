import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
  propose: vi.fn(async () => {}),
  winLinkedOpportunity: vi.fn(async () => {}),
  declineWonPrompt: vi.fn(async () => {}),
}));

vi.mock("@/lib/api/services/lead-won-prompt-service", () => ({
  LeadWonPromptService: serviceMock,
}));

// `useDictionary` resolves its namespace through an ASYNC dynamic import, so a
// bare render yields raw keys for one tick. Back the hook with the REAL shipped
// English dictionary instead — the assertions below then pin the actual copy in
// `src/i18n/dictionaries/en/pipeline.json`, not a hand-written fixture.
// (House idiom: `vi.mock("@/i18n/client", …)` + a real dictionary import, per
// tests/unit/settings/permission-grid-action-level.test.tsx.)
vi.mock("@/i18n/client", async () => {
  const en = (await import("@/i18n/dictionaries/en/pipeline.json"))
    .default as unknown as Record<string, string>;
  return {
    useDictionary: () => ({
      t: (key: string, fallback?: string) => en[key] ?? fallback ?? key,
      dict: en,
    }),
    useLocale: () => ({ locale: "en", setLocale: () => {} }),
  };
});

import { LeadWonPromptHost } from "@/components/ops/lead-won-prompt-host";
import {
  useLeadWonPromptStore,
  type LeadWonProposal,
} from "@/stores/lead-won-prompt-store";

const PROPOSAL: LeadWonProposal = {
  opportunityId: "cccccccc-0000-4000-8000-000000000003",
  projectId: "aaaaaaaa-0000-4000-8000-000000000001",
  leadLabel: "Calloway re-roof",
  userId: "bbbbbbbb-0000-4000-8000-000000000002",
};

function renderHost() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeadWonPromptHost />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLeadWonPromptStore.setState({
    pending: null,
    queue: [],
    answered: new Set<string>(),
  });
});

describe("<LeadWonPromptHost>", () => {
  it("renders nothing while no proposal is pending", () => {
    renderHost();
    expect(screen.queryByText("// MARK LEAD WON")).toBeNull();
  });

  it("presents the pending proposal with the lead label and both verbs", () => {
    useLeadWonPromptStore.setState({ pending: PROPOSAL });
    renderHost();
    expect(screen.getByText("// MARK LEAD WON")).toBeTruthy();
    expect(
      screen.getByText(/This job came from Calloway re-roof\./)
    ).toBeTruthy();
    expect(screen.getByText("MARK WON")).toBeTruthy();
    expect(screen.getByText("KEEP OPEN")).toBeTruthy();
  });

  it("falls back to the dictionary label when the lead has no name", () => {
    useLeadWonPromptStore.setState({
      pending: { ...PROPOSAL, leadLabel: null },
    });
    renderHost();
    expect(screen.getByText(/This job came from this lead\./)).toBeTruthy();
  });

  it("MARK WON resolves the proposal and commits through the RPC service", () => {
    useLeadWonPromptStore.setState({ pending: PROPOSAL });
    renderHost();
    fireEvent.click(screen.getByText("MARK WON"));
    expect(serviceMock.winLinkedOpportunity).toHaveBeenCalledWith(PROPOSAL);
    expect(serviceMock.declineWonPrompt).not.toHaveBeenCalled();
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
    expect(
      useLeadWonPromptStore.getState().answered.has(PROPOSAL.opportunityId)
    ).toBe(true);
  });

  it("KEEP OPEN records the permanent decline", () => {
    useLeadWonPromptStore.setState({ pending: PROPOSAL });
    renderHost();
    fireEvent.click(screen.getByText("KEEP OPEN"));
    expect(serviceMock.declineWonPrompt).toHaveBeenCalledWith(PROPOSAL);
    expect(serviceMock.winLinkedOpportunity).not.toHaveBeenCalled();
    expect(
      useLeadWonPromptStore.getState().answered.has(PROPOSAL.opportunityId)
    ).toBe(true);
  });

  it("Escape dismisses WITHOUT recording anything — the lead can ask again", () => {
    useLeadWonPromptStore.setState({ pending: PROPOSAL });
    renderHost();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(serviceMock.declineWonPrompt).not.toHaveBeenCalled();
    expect(serviceMock.winLinkedOpportunity).not.toHaveBeenCalled();
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
    expect(
      useLeadWonPromptStore.getState().answered.has(PROPOSAL.opportunityId)
    ).toBe(false);
  });

  it("advances to the next queued proposal after an answer (bulk flows)", () => {
    const second: LeadWonProposal = {
      ...PROPOSAL,
      opportunityId: "eeeeeeee-0000-4000-8000-000000000005",
      leadLabel: "Krusekopf fence",
    };
    useLeadWonPromptStore.setState({ pending: PROPOSAL, queue: [second] });
    renderHost();
    fireEvent.click(screen.getByText("MARK WON"));
    expect(
      screen.getByText(/This job came from Krusekopf fence\./)
    ).toBeTruthy();
  });
});
