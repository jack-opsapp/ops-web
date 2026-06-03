import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

import { PipelineDetailBody } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-panel";
import type { Opportunity } from "@/lib/types/pipeline";

// The global setupFiles jest-dom registration isn't reliably applied under a
// filtered vitest run, so self-register (mirrors the sibling pipeline tests).
expect.extend(jestDomMatchers);

// Mock every child so this is a pure composition/routing test for the body —
// the band + Overview + tabs are covered by their own suites.
vi.mock(
  "@/app/(dashboard)/pipeline/_components/lead-map-band",
  () => ({ LeadMapBand: () => <div data-testid="mock-band" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab",
  () => ({ PipelineDetailOverviewTab: () => <div data-testid="mock-overview" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-correspondence-tab",
  () => ({ PipelineDetailCorrespondenceTab: () => <div data-testid="mock-correspondence" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab",
  () => ({ PipelineDetailTimelineTab: () => <div data-testid="mock-timeline" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab",
  () => ({ PipelineDetailPhotosTab: () => <div data-testid="mock-photos" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps",
  () => ({ PipelineDetailNextSteps: () => <div data-testid="mock-next-steps" /> }),
);
vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-detail-tab-bar",
  () => ({ PipelineDetailTabBar: () => <div data-testid="mock-tab-bar" /> }),
);

const opportunity = { id: "opp-1" } as Opportunity;

describe("PipelineDetailBody composition", () => {
  it("always renders the map-backed band", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        canManage
      />,
    );
    expect(screen.getByTestId("mock-band")).toBeInTheDocument();
  });

  it("routes the Overview tab to the Overview component", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="overview"
        canManage
      />,
    );
    expect(screen.getByTestId("mock-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-correspondence")).not.toBeInTheDocument();
  });

  it("routes the Correspondence tab to the Correspondence component", () => {
    render(
      <PipelineDetailBody
        opportunity={opportunity}
        activeTab="correspondence"
        canManage={false}
      />,
    );
    expect(screen.getByTestId("mock-correspondence")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-overview")).not.toBeInTheDocument();
    // The band is present even when the operator cannot manage.
    expect(screen.getByTestId("mock-band")).toBeInTheDocument();
  });
});
