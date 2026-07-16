import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";

// `<StageTransitionDialog>` Phase 3.1 — the Won path is now preflight-driven.
// It collects the final value, shows an auto-name preview that tracks the
// (editable) site address, exposes a quiet `rename` escape hatch, and renders
// the dedup states from `get_conversion_preflight`: existing-linked, duplicate
// candidates (link vs create), and the client's other projects. The footer CTA
// varies by state: MARK WON / MARK WON & OPEN / OPEN PROJECT / LINK & WIN /
// CREATE NEW.

// Deterministic dictionary — return the English fallback (the dialog always
// passes one), or the key when none is supplied.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

// Stub the Mapbox autocomplete so the dialog test stays free of the geocoding
// service + react-query. The stub fires `onChange` with a geocoded selection
// the same way a real result pick would.
vi.mock(
  "@/components/ops/projects/workspace/inputs/address-autocomplete",
  () => ({
    AddressAutocomplete: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (sel: {
        address: string;
        latitude: number;
        longitude: number;
      }) => void;
    }) => (
      <input
        data-testid="won-address-input"
        value={value}
        onChange={(e) =>
          onChange({
            address: e.target.value,
            latitude: 49.1,
            longitude: -123.1,
          })
        }
      />
    ),
  })
);

const { StageTransitionDialog } =
  await import("@/app/(dashboard)/pipeline/_components/stage-transition-dialog");

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    companyId: "co-1",
    clientId: "client-1",
    title: "Acme — roof tear-off",
    description: null,
    contactName: "Acme",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Negotiation,
    source: null,
    assignedTo: null,
    priority: null,
    estimatedValue: 12000,
    actualValue: null,
    winProbability: 50,
    expectedCloseDate: null,
    actualCloseDate: null,
    stageEnteredAt: new Date("2026-06-01"),
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: "1240 W 6th Ave, Vancouver, BC",
    latitude: 49.26,
    longitude: -123.14,
    sourceEmailId: null,
    correspondenceCount: 0,
    outboundCount: 0,
    inboundCount: 0,
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
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  } as Opportunity;
}

const CLEAN_PREFLIGHT: ConversionPreflight = {
  assignmentVersion: 0,
  alreadyConverted: false,
  projectAccessible: false,
  existingLinkedProject: null,
  duplicateCandidates: [],
  otherClientProjects: [],
  suggestedName: "1240 W 6th Ave",
};

describe("<StageTransitionDialog> — Won (preflight-driven)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── clean state ──────────────────────────────────────────────────────────
  it("clean: shows value, auto-name preview from the address, and a MARK WON cta", () => {
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={CLEAN_PREFLIGHT}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("won-value-input")).toBeInTheDocument();
    expect(screen.getByTestId("won-name-preview")).toHaveTextContent(
      "1240 W 6th Ave"
    );
    expect(screen.getByTestId("won-address-input")).toBeInTheDocument();

    const cta = screen.getByTestId("won-confirm-cta");
    expect(cta).toHaveTextContent(/mark won/i);
    expect(cta).toBeEnabled();
  });

  it("clean: confirm passes the entered value, no link/open ids", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp({ estimatedValue: null })}
        preflight={CLEAN_PREFLIGHT}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await userEvent.type(screen.getByTestId("won-value-input"), "15000");
    await userEvent.click(screen.getByTestId("won-confirm-cta"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]![0];
    expect(arg.actualValue).toBe(15000);
    expect(arg.linkToProjectId).toBeUndefined();
    expect(arg.openProjectId).toBeUndefined();
    expect(arg.titleOverride == null).toBe(true);
  });

  // ── live name preview ────────────────────────────────────────────────────
  it("name preview tracks the edited address and reports it via onAddressChange", async () => {
    const onAddressChange = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={CLEAN_PREFLIGHT}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onAddressChange={onAddressChange}
      />
    );

    const addr = screen.getByTestId("won-address-input");
    await userEvent.clear(addr);
    await userEvent.type(addr, "500 Main St, Burnaby, BC");

    expect(screen.getByTestId("won-name-preview")).toHaveTextContent(
      "500 Main St"
    );
    expect(onAddressChange).toHaveBeenCalled();
    const last = onAddressChange.mock.calls.at(-1)![0];
    expect(last.address).toContain("500 Main St");
    expect(typeof last.latitude).toBe("number");
  });

  // ── rename escape hatch ──────────────────────────────────────────────────
  it("rename: reveals an input and confirm carries the typed title override", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={CLEAN_PREFLIGHT}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByTestId("won-rename-input")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("won-rename-toggle"));
    const input = screen.getByTestId("won-rename-input");
    await userEvent.type(input, "Heritage House reroof");

    await userEvent.click(screen.getByTestId("won-confirm-cta"));
    expect(onConfirm.mock.calls[0]![0].titleOverride).toBe(
      "Heritage House reroof"
    );
  });

  // ── existing_linked ──────────────────────────────────────────────────────
  it("existing_linked non-won: shows a MARK WON & OPEN cta", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={{
          ...CLEAN_PREFLIGHT,
          existingLinkedProject: {
            id: "proj-existing",
            title: "1240 W 6th Ave",
          },
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("won-existing-linked")).toHaveTextContent(
      "1240 W 6th Ave"
    );
    const cta = screen.getByTestId("won-confirm-cta");
    expect(cta).toHaveTextContent(/mark won & open/i);

    await userEvent.click(cta);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ openProjectId: "proj-existing" })
    );
  });

  it("existing_linked already won: shows a plain OPEN PROJECT cta", () => {
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp({ stage: OpportunityStage.Won })}
        preflight={{
          ...CLEAN_PREFLIGHT,
          alreadyConverted: true,
          projectAccessible: true,
          existingLinkedProject: {
            id: "proj-existing",
            title: "1240 W 6th Ave",
          },
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("won-confirm-cta")).toHaveTextContent(
      /open project/i
    );
    expect(screen.getByTestId("won-confirm-cta")).not.toHaveTextContent(
      /mark won/i
    );
  });

  // ── duplicate_candidates ─────────────────────────────────────────────────
  it("candidates: default cta is CREATE NEW; selecting a row switches to LINK & WIN", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={{
          ...CLEAN_PREFLIGHT,
          duplicateCandidates: [
            {
              projectId: "proj-dup",
              title: "1240 W 6th Ave",
              address: "1240 W 6th Ave, Vancouver, BC",
              confidence: "high",
              signals: ["same_client", "same_address"],
            },
          ],
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    // Default selection = create new.
    const cta = screen.getByTestId("won-confirm-cta");
    expect(cta).toHaveTextContent(/create new/i);

    // The candidate row is shown with its title.
    const row = screen.getByTestId("won-candidate-proj-dup");
    expect(row).toHaveTextContent("1240 W 6th Ave");

    // Select it → cta becomes LINK & WIN, confirm carries linkToProjectId.
    await userEvent.click(row);
    expect(cta).toHaveTextContent(/link & win/i);
    await userEvent.click(cta);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ linkToProjectId: "proj-dup" })
    );
  });

  it("candidates: choosing 'create new' after a selection clears the link id", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={{
          ...CLEAN_PREFLIGHT,
          duplicateCandidates: [
            {
              projectId: "proj-dup",
              title: "1240 W 6th Ave",
              address: null,
              confidence: "medium",
              signals: ["same_address"],
            },
          ],
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await userEvent.click(screen.getByTestId("won-candidate-proj-dup"));
    await userEvent.click(screen.getByTestId("won-create-new-option"));

    const cta = screen.getByTestId("won-confirm-cta");
    expect(cta).toHaveTextContent(/create new/i);
    await userEvent.click(cta);
    expect(onConfirm.mock.calls[0]![0].linkToProjectId).toBeUndefined();
  });

  // ── other_client_projects ────────────────────────────────────────────────
  it("other_client_projects: shows a collapsed list and keeps a MARK WON cta", async () => {
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={{
          ...CLEAN_PREFLIGHT,
          otherClientProjects: [
            {
              projectId: "proj-other",
              title: "88 Elm St",
              address: "88 Elm St",
              status: "in_progress",
            },
          ],
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const toggle = screen.getByTestId("won-other-projects-toggle");
    expect(screen.getByTestId("won-confirm-cta")).toHaveTextContent(
      /mark won/i
    );

    // Collapsed by default — expand to reveal the project.
    await userEvent.click(toggle);
    expect(screen.getByTestId("won-other-projects-list")).toHaveTextContent(
      "88 Elm St"
    );
  });

  // ── loading ──────────────────────────────────────────────────────────────
  it("loading: surfaces a checking-for-duplicates state and disables the cta", () => {
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflightLoading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("won-preflight-loading")).toBeInTheDocument();
    expect(screen.getByTestId("won-confirm-cta")).toBeDisabled();
  });

  // ── cancel ───────────────────────────────────────────────────────────────
  it("cancel fires onCancel", async () => {
    const onCancel = vi.fn();
    render(
      <StageTransitionDialog
        type="won"
        opportunity={makeOpp()}
        preflight={CLEAN_PREFLIGHT}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByTestId("won-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("<StageTransitionDialog> — Lost (unchanged path)", () => {
  it("renders the loss-reason form and confirms with the reason", async () => {
    const onConfirm = vi.fn();
    render(
      <StageTransitionDialog
        type="lost"
        opportunity={makeOpp()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const select = screen.getByTestId("lost-reason-select");
    const firstReal = within(select)
      .getAllByRole("option")
      .find((o) => (o as HTMLOptionElement).value !== "");
    await userEvent.selectOptions(
      select,
      (firstReal as HTMLOptionElement).value
    );
    await userEvent.click(screen.getByTestId("lost-confirm-cta"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].lostReason).toBeTruthy();
  });
});
