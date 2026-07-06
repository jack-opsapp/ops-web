/**
 * Tests for the lead-detail Overview tab (`pipeline-detail-overview-tab.tsx`).
 *
 * `PipelineDetailOverviewTab` is the full lead record: an agent-authored Summary
 * band, the scope editor, a read-only Health grid, tags, contact, location, and
 * the Linked records (estimates / project / site visits). It owns ONE
 * `useOpportunityFieldEdit` instance (real hook over a stubbed mutation engine)
 * and threads it into the reused field editors, and reads four data hooks
 * (`useEstimates`, `useSiteVisits`, `useClient`, `useClients`) plus the attach
 * mutation. We stub every network boundary so the component is exercised without
 * TanStack Query / Supabase.
 *
 * Contract under test (mirrors Phase 4 of the plan + §8 of the design spec):
 *  - Summary is HIDDEN when `aiSummary` is null, and rendered on the agent
 *    provenance palette (lavender `--agent-*` tokens) when present,
 *  - Health surfaces the computed weighted value + days-in-stage,
 *  - Scope + Tags render their inline editors,
 *  - Linked lists estimates (mocked) and degrades to a quiet empty state when
 *    there are none,
 *  - Contact renders linked-client info when `clientId` is set, and the inline
 *    contact fields when it is not.
 */

import * as React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

// The global setup registers jest-dom via setupFiles, but when this file is run
// through a name filter (`vitest run pipeline-detail-overview-tab`) the matcher
// extension is not reliably applied to the worker — so register it explicitly
// here. Idempotent and harmless when the global registration also runs.
expect.extend(jestDomMatchers);

import {
  EstimateStatus,
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  formatCurrency,
  getWeightedValue,
  type Estimate,
  type Opportunity,
  type SiteVisit,
} from "@/lib/types/pipeline";
import { SiteVisitStatus } from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";

// Echo-key dictionary so labels are deterministic; `t(key, fallback)` returns
// the English fallback when present, so forward it.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

// ─── Data-hook mocks (the network boundary) ───────────────────────────────────

const useEstimatesMock = vi.fn();
const useSiteVisitsMock = vi.fn();
const useClientMock = vi.fn();
const useClientsMock = vi.fn();
const attachMutate = vi.fn();
const createSubClientMutate = vi.fn();
const mutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/hooks/use-estimates", () => ({
  useEstimates: (opts: unknown) => useEstimatesMock(opts),
}));
vi.mock("@/lib/hooks/use-site-visits", () => ({
  useSiteVisits: (opts: unknown) => useSiteVisitsMock(opts),
}));
vi.mock("@/lib/hooks/use-clients", () => ({
  useClient: (id: unknown) => useClientMock(id),
  useClients: (opts?: unknown) => useClientsMock(opts),
  useCreateSubClient: () => ({ mutate: createSubClientMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/use-opportunities", () => ({
  useUpdateOpportunity: () => ({ mutateAsync }),
  useAttachClientToOpportunity: () => ({ mutate: attachMutate, isPending: false }),
}));

// Owner/team hook is reached by no Overview field directly, but the reused
// TagsField/TextAreaField/AddressField don't load it — still, keep a safe stub
// in case an editor lazily touches it.
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [] }, isLoading: false }),
}));

// AddressField is geocode-backed — stub the autocomplete to a plain input.
vi.mock(
  "@/components/ops/projects/workspace/inputs/address-autocomplete",
  () => ({
    AddressAutocomplete: ({ value }: { value: string }) => (
      <input aria-label="address-autocomplete-stub" defaultValue={value} />
    ),
  }),
);

// CreateSiteVisitModal is a portaled Radix dialog with its own data deps — stub
// it to a marker so the Schedule affordance can mount without the real modal.
vi.mock("@/components/ops/site-visit/create-site-visit-modal", () => ({
  CreateSiteVisitModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-site-visit-modal" /> : null,
}));

// Permission gate for the Linked → New estimate action. Default: allow every
// permission; per-test overrides reassign `canMock`.
let canMock: (permission: string) => boolean = () => true;
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (s: { can: (p: string) => boolean }) => unknown) =>
    selector({ can: (p: string) => canMock(p) }),
}));

// The New-estimate action opens the global create-estimate floating window —
// capture the opener so we can assert the deal-scoped metadata it carries.
const openWindowMock = vi.fn();
vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (s: { openWindow: typeof openWindowMock }) => unknown) =>
    selector({ openWindow: openWindowMock }),
}));

import { PipelineDetailOverviewTab } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  const now = new Date("2026-06-01T12:00:00.000Z");
  return {
    id: "opp-1",
    companyId: "co-1",
    clientId: null,
    title: "Greenway re-roof",
    description: null,
    contactName: "Dana Scully",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoting,
    source: OpportunitySource.Referral,
    assignedTo: null,
    priority: OpportunityPriority.High,
    estimatedValue: 14200,
    actualValue: null,
    winProbability: 40,
    expectedCloseDate: new Date("2026-07-15T12:00:00.000Z"),
    actualCloseDate: null,
    stageEnteredAt: now,
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: "1180 Howe St, Vancouver, BC",
    latitude: 49.2785,
    longitude: -123.1278,
    sourceEmailId: null,
    correspondenceCount: 0,
    outboundCount: 2,
    inboundCount: 5,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    aiSummary: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  const now = new Date("2026-06-01T12:00:00.000Z");
  return {
    id: "est-1",
    companyId: "co-1",
    opportunityId: "opp-1",
    projectId: null,
    clientId: "client-1",
    estimateNumber: "EST-1042",
    version: 1,
    parentId: null,
    title: null,
    clientMessage: null,
    internalNotes: null,
    terms: null,
    subtotal: 9000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    taxRate: null,
    taxAmount: 0,
    total: 9000,
    depositType: null,
    depositValue: null,
    depositAmount: null,
    status: EstimateStatus.Sent,
    issueDate: now,
    expirationDate: null,
    sentAt: now,
    viewedAt: null,
    approvedAt: null,
    pdfStoragePath: null,
    templateId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeSiteVisit(overrides: Partial<SiteVisit> = {}): SiteVisit {
  const now = new Date("2026-06-01T12:00:00.000Z");
  return {
    id: "sv-1",
    companyId: "co-1",
    opportunityId: "opp-1",
    projectId: null,
    clientId: null,
    scheduledAt: new Date("2026-06-10T17:00:00.000Z"),
    durationMinutes: 60,
    assigneeIds: [],
    status: SiteVisitStatus.Scheduled,
    completedAt: null,
    notes: null,
    internalNotes: null,
    measurements: null,
    photos: [],
    activityId: null,
    calendarEventId: null,
    createdBy: "user-ada",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    name: "Greenway Property Group",
    email: "ops@greenway.example",
    phoneNumber: "+1 604 555 0142",
    address: "1180 Howe St, Vancouver, BC",
    latitude: 49.2785,
    longitude: -123.1278,
    profileImageURL: null,
    notes: null,
    companyId: "co-1",
    lastSyncedAt: null,
    needsSync: false,
    createdAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// Default every hook to an empty/quiet state; individual tests override.
beforeEach(() => {
  vi.clearAllMocks();
  canMock = () => true;
  useEstimatesMock.mockReturnValue({ data: undefined, isLoading: false });
  useSiteVisitsMock.mockReturnValue({ data: undefined, isLoading: false });
  useClientMock.mockReturnValue({ data: undefined, isLoading: false });
  useClientsMock.mockReturnValue({ data: { clients: [] }, isLoading: false });
});

// ─── Summary (agent provenance) ───────────────────────────────────────────────

describe("PipelineDetailOverviewTab — Summary", () => {
  it("does NOT render the Summary section when aiSummary is null", () => {
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );
    expect(screen.queryByTestId("overview-summary")).toBeNull();
  });

  it("renders the Summary on the agent provenance palette when aiSummary is present", () => {
    const summary =
      "Warm referral; client wants the quote before the long weekend.";
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({
          aiSummary: summary,
          aiStageSignals: ["mentioned budget", "asked for timeline"],
        })}
        canManage
      />,
    );

    const band = screen.getByTestId("overview-summary");
    expect(band).toBeInTheDocument();
    // The summary text is the Claude-authored read.
    expect(within(band).getByText(summary)).toBeInTheDocument();
    // Agent provenance: the container is painted on the reserved lavender
    // tokens (bg + border), never the neutral surface.
    expect(band.className).toContain("var(--agent-bg)");
    expect(band.className).toContain("var(--agent-border)");
    // Stage signals render as chips on the agent palette.
    expect(within(band).getByText("mentioned budget")).toBeInTheDocument();
    expect(within(band).getByText("asked for timeline")).toBeInTheDocument();
  });
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe("PipelineDetailOverviewTab — Health", () => {
  it("shows the computed weighted value and days-in-stage", () => {
    const opp = makeOpportunity({ estimatedValue: 14200, winProbability: 40 });
    render(<PipelineDetailOverviewTab opportunity={opp} canManage />);

    // weighted = 14200 * 0.40 = 5680 → formatted currency.
    expect(
      screen.getByText(formatCurrency(getWeightedValue(opp))),
    ).toBeInTheDocument();
    // Win probability is shown as a percentage.
    expect(screen.getByText("40%")).toBeInTheDocument();
    // Correspondence in/out counts come straight off the record. The cell mixes
    // text nodes (`5` · `in` · `/` · `2` · `out`), so assert against the cell's
    // normalized combined text content rather than a bare digit match.
    const health = screen.getByTestId("overview-health");
    const correspondence = within(health).getAllByText((_content, node) => {
      const text = node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return text === "5 in / 2 out";
    });
    expect(correspondence.length).toBeGreaterThan(0);
  });
});

// ─── Scope + Tags editors ─────────────────────────────────────────────────────

describe("PipelineDetailOverviewTab — editors", () => {
  it("renders the scope textarea editor when canManage", () => {
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({ description: "Tear-off + 30yr arch" })}
        canManage
      />,
    );
    const scope = screen.getByLabelText("Scope") as HTMLTextAreaElement;
    expect(scope).toBeInTheDocument();
    expect(scope.value).toBe("Tear-off + 30yr arch");
  });

  it("renders the tags editor with an add affordance when canManage", () => {
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({ tags: ["urgent"] })}
        canManage
      />,
    );
    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tag" })).toBeInTheDocument();
  });
});

// ─── Linked: estimates ────────────────────────────────────────────────────────

describe("PipelineDetailOverviewTab — Linked estimates", () => {
  it("lists estimates from useEstimates with number, status, and total", () => {
    useEstimatesMock.mockReturnValue({
      data: [makeEstimate({ estimateNumber: "EST-1042", total: 9000 })],
      isLoading: false,
    });
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );

    const linked = screen.getByTestId("overview-linked");
    expect(within(linked).getByText("EST-1042")).toBeInTheDocument();
    expect(within(linked).getByText(formatCurrency(9000))).toBeInTheDocument();
    // Status label is present (Chip always carries its text).
    expect(within(linked).getByText(/sent/i)).toBeInTheDocument();
  });

  it("shows a quiet empty state for estimates when there are none (or estimates.view denied → undefined)", () => {
    useEstimatesMock.mockReturnValue({ data: undefined, isLoading: false });
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );
    const linked = screen.getByTestId("overview-linked");
    expect(within(linked).getByTestId("overview-estimates-empty")).toBeInTheDocument();
  });

  it("renders a Schedule affordance and lists a site visit when present", () => {
    useSiteVisitsMock.mockReturnValue({
      data: [makeSiteVisit()],
      isLoading: false,
    });
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );
    const linked = screen.getByTestId("overview-linked");
    // The site-visit row is present (status label always shown).
    expect(within(linked).getByText(/scheduled/i)).toBeInTheDocument();
  });
});

// ─── Contact ──────────────────────────────────────────────────────────────────

describe("PipelineDetailOverviewTab — Contact", () => {
  it("renders linked-client info (name + mailto + tel + client link) when clientId is set", () => {
    const client = makeClient();
    useClientMock.mockReturnValue({ data: client, isLoading: false });
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({ clientId: "client-1" })}
        canManage
      />,
    );

    const contact = screen.getByTestId("overview-contact");
    expect(within(contact).getByText(client.name)).toBeInTheDocument();
    // mailto + tel links — they carry an intentional `aria-label` ("Email" /
    // "Phone"), so match on the rendered address text + the href, not the name.
    expect(within(contact).getByText(client.email!)).toBeInTheDocument();
    const links = within(contact).getAllByRole("link");
    expect(
      links.find((l) => l.getAttribute("href") === `mailto:${client.email}`),
    ).toBeDefined();
    expect(within(contact).getByText(client.phoneNumber!)).toBeInTheDocument();
    expect(
      links.find((l) => l.getAttribute("href") === `tel:${client.phoneNumber}`),
    ).toBeDefined();
    // Link to the client record.
    const record = within(contact).getByRole("link", {
      name: /open client|view client|client record/i,
    });
    expect(record).toHaveAttribute("href", `/clients/${client.id}`);
  });

  it("renders inline contact fields + an Attach client affordance when no client is linked", () => {
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({
          clientId: null,
          contactName: "Dana Scully",
          contactEmail: "dana@x-files.example",
          contactPhone: "+1 202 555 0150",
        })}
        canManage
      />,
    );

    const contact = screen.getByTestId("overview-contact");
    expect(within(contact).getByText("Dana Scully")).toBeInTheDocument();
    expect(
      within(contact).getByText("dana@x-files.example"),
    ).toBeInTheDocument();
    const inlineLinks = within(contact).getAllByRole("link");
    expect(
      inlineLinks.find(
        (l) => l.getAttribute("href") === "mailto:dana@x-files.example",
      ),
    ).toBeDefined();
    // Attach-client affordance is offered when the operator can manage.
    expect(
      within(contact).getByRole("button", { name: /attach client/i }),
    ).toBeInTheDocument();
  });

  it("hides the Attach client affordance when !canManage", () => {
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({ clientId: null })}
        canManage={false}
      />,
    );
    const contact = screen.getByTestId("overview-contact");
    expect(
      within(contact).queryByRole("button", { name: /attach client/i }),
    ).toBeNull();
  });
});

// ─── Deal contact → sub-client (bug 59dd4aa0) ─────────────────────────────────

describe("PipelineDetailOverviewTab — deal contact → sub-client", () => {
  it("offers 'Save contact to client' when the deal contact is a different person not on file", () => {
    // Linked client is the company; the deal contact is the site super.
    useClientMock.mockReturnValue({
      data: makeClient({ subClients: [] }),
      isLoading: false,
    });
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({
          clientId: "client-1",
          contactName: "Marcus Hail",
          contactEmail: "marcus@site.example",
          contactPhone: "+1 604 555 0199",
        })}
        canManage
      />,
    );

    const row = screen.getByTestId("overview-deal-contact");
    expect(within(row).getByText("Marcus Hail")).toBeInTheDocument();
    const save = within(row).getByRole("button", {
      name: /save contact to client/i,
    });
    fireEvent.click(save);
    expect(createSubClientMutate).toHaveBeenCalledTimes(1);
    expect(createSubClientMutate.mock.calls[0][0]).toMatchObject({
      clientId: "client-1",
      name: "Marcus Hail",
      email: "marcus@site.example",
      phoneNumber: "+1 604 555 0199",
    });
  });

  it("marks the contact 'On file' (no save button) when already a sub-client (email match)", () => {
    useClientMock.mockReturnValue({
      data: makeClient({
        subClients: [
          {
            id: "sc-1",
            name: "Marcus H.",
            title: null,
            email: "marcus@site.example",
            phoneNumber: null,
            address: null,
            clientId: "client-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSyncedAt: null,
            needsSync: false,
            deletedAt: null,
          },
        ],
      }),
      isLoading: false,
    });
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({
          clientId: "client-1",
          contactName: "Marcus Hail",
          contactEmail: "marcus@site.example",
        })}
        canManage
      />,
    );

    const row = screen.getByTestId("overview-deal-contact");
    expect(within(row).getByText("On file")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /save contact to client/i }),
    ).toBeNull();
  });

  it("hides the deal-contact row when the contact just mirrors the client record", () => {
    const client = makeClient({
      name: "Greenway Property Group",
      email: "ops@greenway.example",
      subClients: [],
    });
    useClientMock.mockReturnValue({ data: client, isLoading: false });
    render(
      <PipelineDetailOverviewTab
        opportunity={makeOpportunity({
          clientId: "client-1",
          contactName: "Greenway Property Group",
          contactEmail: "ops@greenway.example",
          contactPhone: null,
        })}
        canManage
      />,
    );

    expect(screen.queryByTestId("overview-deal-contact")).toBeNull();
  });
});

// ─── Linked: New estimate affordance ──────────────────────────────────────────

describe("PipelineDetailOverviewTab — New estimate action", () => {
  it("renders a New estimate action in the Linked estimates section when estimates.create is allowed", () => {
    canMock = (p) => p === "estimates.create";
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );
    const linked = screen.getByTestId("overview-linked");
    expect(
      within(linked).getByRole("button", { name: /new estimate/i }),
    ).toBeInTheDocument();
  });

  it("hides the New estimate action when estimates.create is denied", () => {
    canMock = () => false;
    render(
      <PipelineDetailOverviewTab opportunity={makeOpportunity()} canManage />,
    );
    const linked = screen.getByTestId("overview-linked");
    expect(
      within(linked).queryByRole("button", { name: /new estimate/i }),
    ).toBeNull();
  });

  it("opens a deal-scoped create-estimate window carrying the opportunity id + client id", () => {
    canMock = (p) => p === "estimates.create";
    const opp = makeOpportunity({ id: "opp-77", clientId: "client-5" });
    render(<PipelineDetailOverviewTab opportunity={opp} canManage />);

    const linked = screen.getByTestId("overview-linked");
    fireEvent.click(
      within(linked).getByRole("button", { name: /new estimate/i }),
    );

    expect(openWindowMock).toHaveBeenCalledTimes(1);
    const [arg] = openWindowMock.mock.calls[0];
    expect(arg).toMatchObject({
      id: "create-estimate:opp-77",
      type: "create-estimate",
      metadata: { opportunityId: "opp-77", clientId: "client-5" },
    });
  });
});
