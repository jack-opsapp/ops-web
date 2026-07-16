import { fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineDetailCorrespondenceTab } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-correspondence-tab";
import { PipelineDetailNextSteps } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps";
import { PipelineDetailTimelineTab } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab";
import type {
  OpportunityAssignedContextActivity,
  OpportunityAssignedContextCorrespondence,
  OpportunityAssignedContextFollowUp,
  OpportunityAssignedContextSiteVisit,
} from "@/lib/api/services/opportunity-assigned-context-service";
import {
  ActivityType,
  FollowUpStatus,
  FollowUpType,
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  SiteVisitStatus,
  type Opportunity,
} from "@/lib/types/pipeline";

expect.extend(jestDomMatchers);

const completeMutate = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en" }),
}));

vi.mock("@/lib/hooks", () => ({
  useOpportunityActivities: () => ({ data: [] }),
  useStageTransitions: () => ({ data: [] }),
  useOpportunityFollowUps: () => ({ data: [] }),
  useSiteVisits: () => ({ data: [] }),
  useCompleteFollowUp: () => ({ mutate: completeMutate, isPending: false }),
}));

const emailActivity: OpportunityAssignedContextActivity = {
  id: "44444444-4444-4444-8444-444444444444",
  type: ActivityType.Email,
  subject: "Re: framing package",
  content: "Jason, call me tomorrow morning.",
  bodyText: "Jason, call me tomorrow morning.",
  direction: "inbound",
  outcome: null,
  durationMinutes: null,
  hasAttachments: true,
  createdAt: new Date("2026-07-15T11:00:00.000Z"),
};

const correspondence: OpportunityAssignedContextCorrespondence = {
  id: "99999999-9999-4999-8999-999999999999",
  direction: "outbound",
  partyRole: "ops",
  isMeaningful: true,
  noiseReason: null,
  subject: "Site photos received",
  occurredAt: new Date("2026-07-15T12:00:00.000Z"),
};

const followUp: OpportunityAssignedContextFollowUp = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "Call Dana",
  description: null,
  type: FollowUpType.Call,
  status: FollowUpStatus.Pending,
  dueAt: new Date("2020-01-01T12:00:00.000Z"),
  reminderAt: null,
  completedAt: null,
  completionNotes: null,
  assignedTo: "66666666-6666-4666-8666-666666666666",
  createdAt: new Date("2019-12-01T12:00:00.000Z"),
};

const siteVisit: OpportunityAssignedContextSiteVisit = {
  id: "77777777-7777-4777-8777-777777777777",
  scheduledAt: new Date("2030-07-18T17:00:00.000Z"),
  durationMinutes: 60,
  status: SiteVisitStatus.Scheduled,
  notes: null,
  internalNotes: null,
  measurements: null,
  photos: [],
  completedAt: null,
};

const opportunity = {
  id: "11111111-1111-4111-8111-111111111111",
  stage: OpportunityStage.Quoting,
  priority: OpportunityPriority.High,
  source: OpportunitySource.Referral,
  lastOutboundAt: null,
  lastInboundAt: null,
} as Opportunity;

describe("assigned lead detail projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders whitelisted activity content in the timeline", () => {
    render(<PipelineDetailTimelineTab activities={[emailActivity]} />);

    expect(screen.getByText(/Re: framing package/)).toBeInTheDocument();
  });

  it("renders activity bodies and correspondence-only events without raw mailbox fields", () => {
    render(
      <PipelineDetailCorrespondenceTab
        activities={[emailActivity]}
        correspondence={[correspondence]}
        contactName="Dana Scully"
      />
    );

    expect(
      screen.getByText("Jason, call me tomorrow morning.")
    ).toBeInTheDocument();
    expect(screen.getByText("Site photos received")).toBeInTheDocument();
    expect(screen.getByText("Dana Scully")).toBeInTheDocument();
  });

  it("keeps distinct activity and correspondence records that share a subject", () => {
    const sameSubjectEvent: OpportunityAssignedContextCorrespondence = {
      ...correspondence,
      direction: "inbound",
      subject: emailActivity.subject,
    };

    render(
      <PipelineDetailCorrespondenceTab
        activities={[emailActivity]}
        correspondence={[sameSubjectEvent]}
        contactName="Dana Scully"
      />
    );

    expect(screen.getByText(emailActivity.subject)).toBeInTheDocument();
    expect(screen.getAllByTestId("correspondence-message")).toHaveLength(2);
  });

  it("shows projected next steps but gates completion on lead edit access", () => {
    const { rerender } = render(
      <PipelineDetailNextSteps
        opportunity={opportunity}
        followUps={[followUp]}
        siteVisits={[siteVisit]}
        canManage={false}
      />
    );

    expect(screen.getByText(/Call Dana/)).toBeInTheDocument();
    const readOnlyButtons = screen.getAllByRole("button");
    expect(readOnlyButtons).toHaveLength(1);
    fireEvent.click(readOnlyButtons[0]);
    expect(completeMutate).not.toHaveBeenCalled();

    rerender(
      <PipelineDetailNextSteps
        opportunity={opportunity}
        followUps={[followUp]}
        siteVisits={[siteVisit]}
        canManage
      />
    );
    const completionButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "");
    expect(completionButton).toBeDefined();
    fireEvent.click(completionButton!);
    expect(completeMutate).toHaveBeenCalledWith({ id: followUp.id });
  });
});
