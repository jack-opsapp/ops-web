import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPPORTUNITY_STAGE_COLORS,
  type Opportunity,
  OpportunityStage,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { PipelineFocusedCard } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-card";

const dndMocks = vi.hoisted(() => ({
  pointerDown: vi.fn(),
  keyDown: vi.fn(),
  setActivatorNodeRef: vi.fn(),
  setNodeRef: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: { "data-dnd-activator": "true" },
    listeners: {
      onPointerDown: dndMocks.pointerDown,
      onKeyDown: dndMocks.keyDown,
    },
    setActivatorNodeRef: dndMocks.setActivatorNodeRef,
    setNodeRef: dndMocks.setNodeRef,
    transform: null,
    isDragging: false,
  }),
}));

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion"
  );

  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        "focused.dragHandle.label": "Drag card to another stage",
        "focused.openDetail.label": "Open deal details",
        "card.emailCount": "{count} emails",
        "card.followUpDate": "Follow up {date}",
        "card.titleEditLabel": "Edit deal title: {title}",
        "card.titleInputLabel": "Deal title",
        "card.clientLinkLabel": "Link client: {client}",
        "card.clientEmpty": "NO CLIENT",
        "card.clientCurrent": "CURRENT CLIENT",
        "card.clientSearchLabel": "Search clients",
        "card.clientSearchPlaceholder": "Search clients...",
        "card.clientCreate": "Create client",
        "card.clientCreateNew": "CREATE NEW CLIENT",
        "card.clientCreateHint": "TYPE NAME TO CREATE",
        "card.clientNoMatches": "No client match",
        "card.addressLabel": "Edit site address",
        "card.addressEmpty": "NO ADDRESS",
        "actions.logCall": "Log call",
        "actions.logText": "Log text",
        "actions.openDetail": "Open detail",
        "actions.addNote": "Add note",
        "actions.more": "More",
        "actions.notePlaceholder": "Note",
        "card.advanceStage": "Move to {stage}",
        "card.retreatStage": "Back to {stage}",
        "card.stageMenu": "Stage",
        "card.stageMenuLabel": "Choose stage",
        "card.confirm": "Confirm",
      };

      return translations[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock("@/lib/api/services/geocoding-service", () => ({
  GeocodingService: {
    forwardGeocode: vi.fn(async () => [
      {
        id: "address-1",
        fullAddress: "1234 Industrial Way, Vancouver, BC",
        shortAddress: "1234 Industrial Way",
        latitude: 49.2827,
        longitude: -123.1207,
      },
    ]),
  },
}));

const NOW = new Date("2026-05-12T12:00:00.000Z");

function makeOpportunity(): Opportunity {
  return {
    id: "opp-1",
    companyId: "company-1",
    clientId: "client-1",
    title: "Deck rebuild",
    description: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoted,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: 12500,
    actualValue: null,
    winProbability: 60,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: NOW,
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: null,
    latitude: null,
    longitude: null,
    sourceEmailId: null,
    correspondenceCount: 3,
    outboundCount: 2,
    inboundCount: 1,
    lastInboundAt: NOW,
    lastOutboundAt: null,
    lastMessageDirection: null,
    aiSummary: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archivedAt: null,
  };
}

function makeClients(): Client[] {
  return [
    {
      id: "client-1",
      name: "North Shore Decks",
      email: "north@example.com",
      phoneNumber: "778-555-0101",
      address: "101 Marine Dr",
      latitude: 49.318,
      longitude: -123.089,
      profileImageURL: null,
      notes: null,
      companyId: "company-1",
      lastSyncedAt: null,
      needsSync: false,
      createdAt: NOW,
      deletedAt: null,
    },
    {
      id: "client-2",
      name: "Cedar Rail Co",
      email: "cedar@example.com",
      phoneNumber: null,
      address: null,
      latitude: null,
      longitude: null,
      profileImageURL: null,
      notes: null,
      companyId: "company-1",
      lastSyncedAt: null,
      needsSync: false,
      createdAt: NOW,
      deletedAt: null,
    },
  ];
}

function renderFocusedCard({
  canManage = true,
  opportunity = makeOpportunity(),
  clientName = "North Shore Decks",
  clients = makeClients(),
  onMoveStage = vi.fn(),
  onTitleSave = vi.fn(),
  onLinkClient = vi.fn(),
  onCreateAndLinkClient = vi.fn(),
  onAddressSave = vi.fn(),
}: {
  canManage?: boolean;
  opportunity?: Opportunity;
  clientName?: string;
  clients?: Client[];
  onMoveStage?: (
    opportunity: Opportunity,
    stage: OpportunityStage
  ) => void;
  onTitleSave?: (opportunity: Opportunity, title: string) => void;
  onLinkClient?: (opportunity: Opportunity, clientId: string) => void;
  onCreateAndLinkClient?: (opportunity: Opportunity, clientName: string) => void;
  onAddressSave?: (
    opportunity: Opportunity,
    selection: { address: string; latitude: number; longitude: number }
  ) => void;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PipelineFocusedCard
        opportunity={opportunity}
        clientName={clientName}
        clients={clients}
        stageColor="#8F9AA3"
        stalenessOpacity={1}
        canManage={canManage}
        onLogCall={vi.fn()}
        onLogText={vi.fn()}
        onAddNote={vi.fn()}
        onArchive={vi.fn()}
        onDiscard={vi.fn()}
        onMarkWon={vi.fn()}
        onMarkLost={vi.fn()}
        onAssign={vi.fn()}
        onScheduleFollowUp={vi.fn()}
        onMoveStage={onMoveStage}
        onTitleSave={onTitleSave}
        onLinkClient={onLinkClient}
        onCreateAndLinkClient={onCreateAndLinkClient}
        onAddressSave={onAddressSave}
      />
    </QueryClientProvider>
  );
}

describe("<PipelineFocusedCard>", () => {
  beforeEach(() => {
    dndMocks.pointerDown.mockClear();
    dndMocks.keyDown.mockClear();
    dndMocks.setActivatorNodeRef.mockClear();
    dndMocks.setNodeRef.mockClear();
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.Quoted,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("uses a native labeled button as the drag activator", () => {
    renderFocusedCard();

    const dragActivator = screen.getByRole("button", {
      name: "Drag card to another stage",
    });

    expect(dragActivator).toHaveAttribute("data-dnd-activator", "true");
    expect(dragActivator).toHaveClass("min-h-11", "w-11");
    expect(dndMocks.setActivatorNodeRef).toHaveBeenCalled();
  });

  it("does not open detail when the card body title is clicked", () => {
    renderFocusedCard();

    const dragActivator = screen.getByRole("button", {
      name: "Drag card to another stage",
    });
    const titleButton = screen.getByRole("button", {
      name: "Edit deal title: Deck rebuild",
    });

    expect(titleButton).not.toHaveAttribute("data-dnd-activator");

    fireEvent.pointerDown(titleButton);
    expect(dndMocks.pointerDown).not.toHaveBeenCalled();

    fireEvent.click(titleButton);
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();

    fireEvent.pointerDown(dragActivator);
    expect(dndMocks.pointerDown).toHaveBeenCalledTimes(1);
  });

  it("opens detail only from the explicit toolbar details action", () => {
    renderFocusedCard();

    fireEvent.click(screen.getByRole("button", { name: "Open detail" }));

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
  });

  it("saves and cancels inline title edits from the title control", () => {
    const onTitleSave = vi.fn();
    renderFocusedCard({ onTitleSave });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit deal title: Deck rebuild",
      })
    );
    const titleInput = screen.getByRole("textbox", { name: "Deal title" });
    fireEvent.change(titleInput, { target: { value: "Deck rebuild phase 2" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(onTitleSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      "Deck rebuild phase 2"
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit deal title: Deck rebuild",
      })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Deal title" }), {
      target: { value: "Cancelled title" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Deal title" }), {
      key: "Escape",
    });

    expect(onTitleSave).toHaveBeenCalledTimes(1);
  });

  it("opens the client linker from the client name and links existing clients", () => {
    const onLinkClient = vi.fn();
    renderFocusedCard({ onLinkClient });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Link client: North Shore Decks",
      })
    );

    expect(
      screen.getByRole("combobox", { name: "Search clients" })
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-pipeline-client-linker-popover]")
    ).toHaveClass("fixed", "glass-dense");
    const popover = document.querySelector(
      "[data-pipeline-client-linker-popover]"
    ) as HTMLElement;
    expect(popover.firstElementChild).toHaveTextContent("CURRENT CLIENT");
    expect(within(popover).getByText("North Shore Decks")).toBeInTheDocument();
    expect(
      within(popover).queryByRole("option", { name: "North Shore Decks" })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Search clients" }), {
      target: { value: "cedar" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Cedar Rail Co" }));

    expect(onLinkClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      "client-2"
    );
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("shows an unlinked client empty state and pins create new at the top", () => {
    const onCreateAndLinkClient = vi.fn();
    const unlinkedOpportunity = {
      ...makeOpportunity(),
      clientId: null,
      contactName: null,
    };
    renderFocusedCard({
      opportunity: unlinkedOpportunity,
      clientName: "Unknown Contact",
      onCreateAndLinkClient,
    });

    const trigger = screen.getByRole("button", {
      name: "Link client: NO CLIENT",
    });
    expect(trigger).toHaveTextContent("NO CLIENT");

    fireEvent.click(trigger);

    const popover = document.querySelector(
      "[data-pipeline-client-linker-popover]"
    ) as HTMLElement;
    expect(popover.firstElementChild).toHaveTextContent("CREATE NEW CLIENT");
    expect(within(popover).getByText("TYPE NAME TO CREATE")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Search clients" }), {
      target: { value: "Harbour Fence" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create client Harbour Fence" })
    );

    expect(onCreateAndLinkClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      "Harbour Fence"
    );
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("creates and links a client from the linker when no match exists", () => {
    const onCreateAndLinkClient = vi.fn();
    renderFocusedCard({ onCreateAndLinkClient });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Link client: North Shore Decks",
      })
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Search clients" }), {
      target: { value: "Harbour Fence" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create client Harbour Fence" })
    );

    expect(onCreateAndLinkClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      "Harbour Fence"
    );
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("opens the inline site address autocomplete from the empty address state", () => {
    renderFocusedCard();

    expect(screen.getByText("NO ADDRESS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit site address" }));

    const input = screen.getByRole("combobox", {
      name: "Edit site address",
    });
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("font-mohave", "text-body-sm");
    expect(input.getAttribute("style")).toContain("background: transparent");
    expect(input.getAttribute("style")).toContain(
      "border-bottom: 1px solid hsl(var(--border))"
    );
    expect(
      document.querySelector("[data-pipeline-address-popover]")
    ).not.toBeInTheDocument();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("keeps address suggestions portaled outside the clipped card", async () => {
    renderFocusedCard();

    fireEvent.click(screen.getByRole("button", { name: "Edit site address" }));
    await act(async () => {
      fireEvent.change(
        screen.getByRole("combobox", { name: "Edit site address" }),
        {
          target: { value: "1234 industrial" },
        }
      );
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByRole("listbox")).toHaveClass("fixed");
        expect(screen.getByRole("option", { name: /1234 industrial way/i }))
          .toBeInTheDocument();
      });
    });
  });

  it("renders focused quick reassign buttons without opening detail", () => {
    const onMoveStage = vi.fn();
    renderFocusedCard({ onMoveStage });

    const advance = screen.getByRole("button", {
      name: "Move to Follow-Up",
    });

    expect(advance).toHaveTextContent("Follow-Up");
    expect(advance.getAttribute("style")).toContain(
      OPPORTUNITY_STAGE_COLORS[OpportunityStage.FollowUp]
    );
    expect(advance).toHaveClass("border-line", "bg-transparent", "text-text-3");
    expect(advance.className).toContain("hover:border-[var(--target-stage)]");

    fireEvent.click(advance);

    expect(onMoveStage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      OpportunityStage.FollowUp
    );
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("opens a focused stage menu and moves to the picked status", () => {
    const onMoveStage = vi.fn();
    renderFocusedCard({ onMoveStage });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose stage",
      })
    );

    expect(
      screen.getByRole("menu", {
        name: "Choose stage",
      })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "Move to Negotiation",
      })
    );

    expect(onMoveStage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opp-1" }),
      OpportunityStage.Negotiation
    );
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("uses the OPS focused card shell without a heavy left rail", () => {
    const { container } = renderFocusedCard();
    const shell = container.querySelector(
      '[data-pipeline-card-shell="focused"]'
    );

    expect(shell).toHaveClass("rounded-panel");
    expect(shell?.getAttribute("style")).not.toContain("4px solid");
    expect(
      shell?.querySelector("[data-pipeline-card-stage-accent]")
    ).toBeInTheDocument();
  });

  it("disables focused quick reassign buttons without manage permission", () => {
    const onMoveStage = vi.fn();
    renderFocusedCard({ canManage: false, onMoveStage });

    const advance = screen.getByRole("button", {
      name: "Move to Follow-Up",
    });

    expect(advance).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Choose stage",
      })
    ).toBeDisabled();
    fireEvent.click(advance);
    expect(onMoveStage).not.toHaveBeenCalled();
  });
});
