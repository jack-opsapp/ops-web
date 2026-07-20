import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

import { PipelineDetailBody } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-panel";
import {
  OpportunityAssignedContextError,
  type OpportunityAssignedContext,
} from "@/lib/api/services/opportunity-assigned-context-service";
import type { Opportunity } from "@/lib/types/pipeline";

// The global setupFiles jest-dom registration isn't reliably applied under a
// filtered vitest run, so self-register (mirrors the sibling pipeline tests).
expect.extend(jestDomMatchers);

const childProps = vi.hoisted(() => ({
  overview: vi.fn(),
  correspondence: vi.fn(),
  timeline: vi.fn(),
  nextSteps: vi.fn(),
}));
const assignedContextHookMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/use-opportunity-assigned-context", () => ({
  useOpportunityAssignedContext: assignedContextHookMock,
}));

// Mock every child so this is a pure composition/routing test for the body —
// the band + Overview + tabs are covered by their own suites.
vi.mock("@/app/(dashboard)/pipeline/_components/lead-map-band", () => ({
  LeadMapBand: () => <div data-testid="mock-band" />,
}));
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab",
  () => ({
    PipelineDetailOverviewTab: (props: unknown) => {
      childProps.overview(props);
      return <div data-testid="mock-overview" />;
    },
  })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-correspondence-tab",
  () => ({
    PipelineDetailCorrespondenceTab: (props: unknown) => {
      childProps.correspondence(props);
      return <div data-testid="mock-correspondence" />;
    },
  })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab",
  () => ({
    PipelineDetailTimelineTab: (props: unknown) => {
      childProps.timeline(props);
      return <div data-testid="mock-timeline" />;
    },
  })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab",
  () => ({ PipelineDetailPhotosTab: () => <div data-testid="mock-photos" /> })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps",
  () => ({
    PipelineDetailNextSteps: (props: unknown) => {
      childProps.nextSteps(props);
      return <div data-testid="mock-next-steps" />;
    },
  })
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-tab-bar",
  () => ({ PipelineDetailTabBar: () => <div data-testid="mock-tab-bar" /> })
);

const opportunity = { id: "opp-1" } as Opportunity;
const assignedContext = {
  lead: { id: "opp-1" },
  contact: { name: "Dana Scully" },
  estimateSummaries: [{ id: "estimate-1" }],
  activities: [{ id: "activity-1" }],
  followUps: [{ id: "follow-up-1" }],
  siteVisits: [{ id: "visit-1" }],
  correspondence: [{ id: "correspondence-1" }],
} as OpportunityAssignedContext;
const fullLeadAccess = {
  canView: true,
  canEdit: true,
  canAssign: true,
  canUnassign: true,
  canConvert: true,
};
const readOnlyLeadAccess = {
  ...fullLeadAccess,
  canEdit: false,
  canAssign: false,
  canUnassign: false,
  canConvert: false,
};

// The full query-result shape the body reads. Individual tests override the
// relevant fields; defaults model a settled successful read.
function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: assignedContext,
    isError: false,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("PipelineDetailBody composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignedContextHookMock.mockReturnValue(queryResult());
  });

  it("always renders the map-backed band", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={fullLeadAccess}
      />
    );
    expect(screen.getByTestId("mock-band")).toBeInTheDocument();
  });

  it("routes the Overview tab to the Overview component", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={fullLeadAccess}
      />
    );
    expect(screen.getByTestId("mock-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-correspondence")).not.toBeInTheDocument();
  });

  it("routes the Correspondence tab to the Correspondence component", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="correspondence"
        leadAccess={readOnlyLeadAccess}
      />
    );
    expect(screen.getByTestId("mock-correspondence")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-overview")).not.toBeInTheDocument();
    // The band is present even when the operator cannot manage.
    expect(screen.getByTestId("mock-band")).toBeInTheDocument();
  });

  it("loads the guarded context once and sends only its projections to detail children", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={readOnlyLeadAccess}
      />
    );

    expect(assignedContextHookMock).toHaveBeenCalledWith("opp-1");
    expect(childProps.overview).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignedContext })
    );
    expect(childProps.nextSteps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        followUps: assignedContext.followUps,
        siteVisits: assignedContext.siteVisits,
        canManage: false,
      })
    );
  });

  it("fails closed when the guarded context read is denied", () => {
    assignedContextHookMock.mockReturnValue(
      queryResult({
        // React Query retains the previous payload when a refetch is denied —
        // a confirmed access_denied must redact it regardless.
        data: assignedContext,
        isError: true,
        error: new OpportunityAssignedContextError(
          "access_denied",
          "Opportunity context access denied"
        ),
      })
    );

    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="correspondence"
        leadAccess={readOnlyLeadAccess}
      />
    );

    expect(childProps.correspondence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activities: [],
        correspondence: [],
        contactName: null,
      })
    );
    expect(childProps.nextSteps).toHaveBeenLastCalledWith(
      expect.objectContaining({ followUps: [], siteVisits: [] })
    );
    // Redaction is deliberate — it must not dress up as a transient failure.
    expect(
      screen.queryByTestId("detail-context-error")
    ).not.toBeInTheDocument();
  });

  it("keeps last-good context on screen during a background refetch", () => {
    assignedContextHookMock.mockReturnValue(queryResult({ isFetching: true }));

    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="correspondence"
        leadAccess={readOnlyLeadAccess}
      />
    );

    // The refocus-blank regression: a background refetch must NOT null the
    // projections into misleading empty states.
    expect(childProps.correspondence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activities: assignedContext.activities,
        correspondence: assignedContext.correspondence,
        contactName: assignedContext.contact.name,
      })
    );
    expect(childProps.nextSteps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        followUps: assignedContext.followUps,
        siteVisits: assignedContext.siteVisits,
      })
    );
  });

  it("renders skeleton rows instead of tab content on first load", () => {
    assignedContextHookMock.mockReturnValue(
      queryResult({ data: undefined, isLoading: true, isFetching: true })
    );

    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={fullLeadAccess}
        withRegion
      />
    );

    expect(screen.getByTestId("detail-context-loading")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Deal detail panel" })
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("mock-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-next-steps")).not.toBeInTheDocument();
  });

  it("shows the error row with a working retry when a settled non-denied read failed with nothing to show", () => {
    const refetch = vi.fn();
    assignedContextHookMock.mockReturnValue(
      queryResult({
        data: undefined,
        isError: true,
        error: new OpportunityAssignedContextError(
          "rpc_error",
          "Opportunity context read failed"
        ),
        refetch,
      })
    );

    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={fullLeadAccess}
      />
    );

    expect(screen.getByTestId("detail-context-error")).toBeInTheDocument();
    // The truth is "failed to load" — Overview must not render
    // "[ no contact ]" / "[ no estimates ]" empties.
    expect(screen.queryByTestId("mock-overview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "RETRY" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps last-good content under the error advisory when a refetch fails", () => {
    assignedContextHookMock.mockReturnValue(
      queryResult({
        data: assignedContext,
        isError: true,
        error: new OpportunityAssignedContextError(
          "rpc_error",
          "Opportunity context read failed"
        ),
      })
    );

    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        leadAccess={fullLeadAccess}
      />
    );

    expect(screen.getByTestId("detail-context-error")).toBeInTheDocument();
    expect(screen.getByTestId("mock-overview")).toBeInTheDocument();
    expect(childProps.overview).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignedContext })
    );
  });
});
