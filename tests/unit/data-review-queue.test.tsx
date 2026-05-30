/**
 * DataReviewQueue panel (Surface 2) component behavior.
 *
 * Asserts: actionable split + terminal/live items render as rows; the muted
 * passive quarantined count renders (and is not an actionable row); the
 * segmented filter narrows the table; LINK-TO opens the picker and CONFIRM LINK
 * calls useResolveLink with the chosen owner; QUARANTINE calls useQuarantineItem;
 * empty + error states render.
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Passthrough framer-motion so AnimatePresence does not retain exiting rows in
// jsdom (exit animations never "complete" without a real compositor, which
// would leave filtered-out rows mounted and defeat the filter assertion).
vi.mock("framer-motion", () => {
  const React = require("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => true,
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) =>
          ({ children, ...props }: { children?: React.ReactNode }) => {
            // strip framer-only props so React doesn't warn
            const {
              initial: _i,
              animate: _a,
              exit: _e,
              transition: _tr,
              ...rest
            } = props as Record<string, unknown>;
            return React.createElement(tag, rest, children);
          },
      }
    ),
  };
});

const resolveMutate = vi.fn();
const quarantineMutate = vi.fn();
const queueState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null,
};

vi.mock("@/lib/hooks/use-data-review", () => ({
  useDataReviewQueue: () => ({ ...queueState, refetch: vi.fn() }),
  useResolveLink: () => ({ mutate: resolveMutate, isPending: false, error: null }),
  useQuarantineItem: () => ({ mutate: quarantineMutate, isPending: false, error: null }),
}));

import { DataReviewQueue } from "@/app/admin/data-setup/_components/data-review-queue";

const SPLIT_ITEM = {
  id: "T-split",
  kind: "split" as const,
  providerThreadId: "T-split",
  subject: "Deck quote",
  clientId: "c1",
  clientName: "Smith",
  lastActivityAt: "2026-05-20T00:00:00Z",
  reason: "2 live owners — no single canonical opportunity",
  oppCount: 2,
  terminalCount: 0,
  owners: [
    { opportunityId: "opp-live", title: "Deck — Smith", stage: "quoting", archived: false, deleted: false, terminal: false, activityCount: 5, clientId: "c1", clientName: "Smith" },
    { opportunityId: "opp-shell", title: "Deck — dupe", stage: "follow_up", archived: false, deleted: false, terminal: false, activityCount: 2, clientId: "c1", clientName: "Smith" },
  ],
  linkCandidates: [
    { opportunityId: "opp-live", title: "Deck — Smith", stage: "quoting", terminal: false },
    { opportunityId: "opp-shell", title: "Deck — dupe", stage: "follow_up", terminal: false },
  ],
};

const TERMINAL_ITEM = {
  id: "et-1",
  kind: "terminal_live" as const,
  providerThreadId: "T-term",
  subject: "Patio thread",
  clientId: "c2",
  clientName: "Jones",
  lastActivityAt: "2026-05-01T00:00:00Z",
  reason: "Cache unset; canonical owner is closed (won) but live",
  oppCount: 1,
  terminalCount: 1,
  owners: [
    { opportunityId: "opp-won", title: "Patio — Jones", stage: "won", archived: false, deleted: false, terminal: true, activityCount: 0, clientId: "c2", clientName: "Jones" },
  ],
  linkCandidates: [
    { opportunityId: "opp-won", title: "Patio — Jones", stage: "won", terminal: true },
  ],
};

beforeEach(() => {
  resolveMutate.mockClear();
  quarantineMutate.mockClear();
  queueState.data = {
    split: [SPLIT_ITEM],
    terminalLive: [TERMINAL_ITEM],
    quarantinedCount: 2198,
  };
  queueState.isLoading = false;
  queueState.isError = false;
  queueState.isFetching = false;
  queueState.error = null;
});
afterEach(() => vi.clearAllMocks());

describe("DataReviewQueue", () => {
  it("lists both actionable items and renders the muted quarantined count", () => {
    render(<DataReviewQueue />);
    expect(screen.getByText("Deck quote")).toBeTruthy();
    expect(screen.getByText("Patio thread")).toBeTruthy();
    // muted passive count present (formatted) and labelled as no-action
    expect(screen.getByText("2,198")).toBeTruthy();
    expect(screen.getByText("[quarantined · no action]")).toBeTruthy();
  });

  it("filters to split threads only", () => {
    render(<DataReviewQueue />);
    fireEvent.click(screen.getByRole("button", { name: "SPLIT THREADS" }));
    expect(screen.getByText("Deck quote")).toBeTruthy();
    expect(screen.queryByText("Patio thread")).toBeNull();
  });

  it("filters to terminal/live only", () => {
    render(<DataReviewQueue />);
    fireEvent.click(screen.getByRole("button", { name: "TERMINAL/LIVE" }));
    expect(screen.getByText("Patio thread")).toBeTruthy();
    expect(screen.queryByText("Deck quote")).toBeNull();
  });

  it("LINK-TO opens the picker and CONFIRM LINK calls useResolveLink with the chosen owner", () => {
    render(<DataReviewQueue />);
    fireEvent.click(screen.getAllByRole("button", { name: "LINK TO…" })[0]);
    // pick the live owner, then confirm
    fireEvent.click(screen.getByRole("radio", { name: /Deck — Smith/ }));
    fireEvent.click(screen.getByRole("button", { name: "// CONFIRM LINK" }));
    expect(resolveMutate).toHaveBeenCalledWith(
      { providerThreadId: "T-split", targetOpportunityId: "opp-live", kind: "split" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("QUARANTINE calls useQuarantineItem with the provider thread id + kind", () => {
    render(<DataReviewQueue />);
    fireEvent.click(screen.getAllByRole("button", { name: "QUARANTINE" })[0]);
    expect(quarantineMutate).toHaveBeenCalledWith({
      providerThreadId: "T-split",
      kind: "split",
    });
  });

  it("a terminal_live LINK-TO carries kind:'terminal_live' (cache-align path)", () => {
    render(<DataReviewQueue />);
    fireEvent.click(screen.getByRole("button", { name: "TERMINAL/LIVE" }));
    fireEvent.click(screen.getByRole("button", { name: "LINK TO…" }));
    fireEvent.click(screen.getByRole("radio", { name: /Patio — Jones/ }));
    fireEvent.click(screen.getByRole("button", { name: "// CONFIRM LINK" }));
    expect(resolveMutate).toHaveBeenCalledWith(
      {
        providerThreadId: "T-term",
        targetOpportunityId: "opp-won",
        kind: "terminal_live",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("renders the empty state when there are no actionable items", () => {
    queueState.data = { split: [], terminalLive: [], quarantinedCount: 2198 };
    render(<DataReviewQueue />);
    expect(
      screen.getByText("No items need review. Link integrity is clean.")
    ).toBeTruthy();
    // muted count still shown
    expect(screen.getByText("2,198")).toBeTruthy();
  });

  it("renders the error state", () => {
    queueState.data = undefined;
    queueState.isError = true;
    queueState.error = new Error("boom");
    render(<DataReviewQueue />);
    expect(screen.getByText(/QUEUE UNAVAILABLE/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "RETRY" })).toBeTruthy();
  });
});
