import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  OpportunityStage,
  formatCurrency,
  getStageDisplayName,
  type Opportunity,
} from "@/lib/types/pipeline";
import { LeadDispositionFeedbackError } from "@/lib/api/services/lead-disposition-feedback-service";

// Discard is the ONE lead action that carries a learning signal, so
// `requestStageChange(id, Discarded)` no longer falls through to a plain stage
// move. Phase C ON: flip the card, defer the write, and let one toast capture
// the reason. Phase C OFF: the same RPC records an authoritative
// `legacy_unspecified` audit row with UX identical to today. Either way the
// discard itself can never fail to happen.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const setQueriesData = vi.fn();
const getQueriesData = vi.fn(() => []);
const invalidateQueries = vi.fn();
const cancelQueries = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query"
  );
  return {
    ...actual,
    useQueryClient: () => ({
      setQueriesData,
      getQueriesData,
      invalidateQueries,
      cancelQueries,
    }),
  };
});

const moveMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const moveMutateAsync = vi.fn(async () => {});
const applyMutateAsync = vi.fn(async () => ({
  feedbackId: "fb-1",
  outcome: "discarded" as const,
  priorStage: "new_lead",
  currentStage: "discarded",
  lifecycleChanged: true,
  idempotentReplay: false,
}));
const undoMutateAsync = vi.fn(async () => ({
  feedbackId: "fb-1",
  outcome: "discarded" as const,
  priorStage: "negotiation",
  currentStage: "negotiation",
  lifecycleChanged: true,
  idempotentReplay: false,
}));

vi.mock("@/lib/hooks", () => ({
  useClients: () => ({ data: { clients: [{ id: "client-1", name: "Acme" }] } }),
  useMoveOpportunityStage: () => ({
    mutate: moveMutate,
    mutateAsync: moveMutateAsync,
  }),
  useUpdateOpportunity: () => ({ mutate: vi.fn() }),
  useConvertOpportunityToProject: () => ({ mutate: vi.fn() }),
  useLinkOpportunityToExistingProject: () => ({ mutate: vi.fn() }),
  useConversionPreflight: () => ({ data: undefined, isLoading: false }),
  useApplyLeadDispositionFeedback: () => ({ mutateAsync: applyMutateAsync }),
  useUndoLeadDispositionFeedback: () => ({ mutateAsync: undoMutateAsync }),
}));

const showCaptureToast = vi.fn(() => ({
  toastId: "toast-1",
  settle: vi.fn(),
}));
const confirmCaptureToast = vi.fn();
const dismissCaptureToast = vi.fn();
vi.mock(
  "@/app/(dashboard)/pipeline/_components/discard-feedback-toast",
  () => ({
    showDiscardFeedbackToast: (options: unknown) =>
      showCaptureToast(options as never),
    confirmDiscardFeedbackToast: (...args: unknown[]) =>
      confirmCaptureToast(...(args as [])),
    dismissDiscardFeedbackToast: (...args: unknown[]) =>
      dismissCaptureToast(...(args as [])),
    discardReasonLabel: (_t: unknown, code: string) => code,
  })
);

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ currentUser: { id: "user-1" } }),
}));

const flags = vi.hoisted(() => ({ initialized: true, phaseC: true }));
vi.mock("@/lib/store/feature-flags-store", () => ({
  useFeatureFlagsStore: {
    getState: () => ({
      initialized: flags.initialized,
      canAccessFeature: (slug: string) =>
        slug === "phase_c" ? flags.phaseC : true,
    }),
  },
}));

const permissionState = vi.hoisted(() => ({
  permissions: new Map<string, "all" | "assigned" | "own">(),
  configuredPermissions: new Set<string>(),
}));

vi.mock("@/lib/store/permissions-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/store/permissions-store")
  >("@/lib/store/permissions-store");
  const can = (permission: string, requiredScope?: string) => {
    const granted = permissionState.permissions.get(permission);
    if (!granted) return false;
    if (!requiredScope) return true;
    if (granted === "all") return true;
    if (granted === "assigned") {
      return requiredScope === "assigned" || requiredScope === "own";
    }
    return requiredScope === "own";
  };
  return {
    ...actual,
    usePermissionStore: (selector: (state: unknown) => unknown) =>
      selector({
        can,
        permissions: permissionState.permissions,
        configuredPermissions: permissionState.configuredPermissions,
      }),
  };
});

const pushUndo = vi.fn();
vi.mock("@/stores/undo-store", () => ({
  useUndoStore: (selector: (s: { pushUndo: typeof pushUndo }) => unknown) =>
    selector({ pushUndo }),
}));

const { useStageTransition } = await import(
  "@/app/(dashboard)/pipeline/_components/use-stage-transition"
);

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    companyId: "co-1",
    clientId: "client-1",
    title: "Acme — roof",
    contactName: "Acme",
    stage: OpportunityStage.Negotiation,
    estimatedValue: 12000,
    projectId: null,
    ...overrides,
  } as Opportunity;
}

const EXPECTED_TITLE = `Acme · ${formatCurrency(12000)}`;
const EXPECTED_STAGE_LINE = `${getStageDisplayName(
  OpportunityStage.Negotiation
)} → ${getStageDisplayName(OpportunityStage.Discarded)}`;

type CaptureOptions = {
  title: string;
  stateLine: string;
  onReason: (code: string) => void;
  onUndo: () => void;
  onClosedWithoutReason: () => void;
};

function lastCaptureOptions(): CaptureOptions {
  const call = showCaptureToast.mock.calls.at(-1);
  if (!call) throw new Error("capture toast was never shown");
  return call[0] as unknown as CaptureOptions;
}

function discard(opp: Opportunity) {
  const { result } = renderHook(() =>
    useStageTransition({ opportunities: [opp] })
  );
  act(() =>
    result.current.requestStageChange(opp.id, OpportunityStage.Discarded)
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.initialized = true;
  flags.phaseC = true;
  permissionState.permissions = new Map([["pipeline.edit", "assigned"]]);
  permissionState.configuredPermissions = new Set(["pipeline.edit"]);
  moveMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
  applyMutateAsync.mockResolvedValue({
    feedbackId: "fb-1",
    outcome: "discarded",
    priorStage: "new_lead",
    currentStage: "discarded",
    lifecycleChanged: true,
    idempotentReplay: false,
  });
  undoMutateAsync.mockResolvedValue({
    feedbackId: "fb-1",
    outcome: "discarded",
    priorStage: "negotiation",
    currentStage: "negotiation",
    lifecycleChanged: true,
    idempotentReplay: false,
  });
});

describe("useStageTransition — discard capture (Phase C ON)", () => {
  it("flips the card optimistically and opens the capture toast instead of writing", () => {
    discard(makeOpp());

    expect(showCaptureToast).toHaveBeenCalledTimes(1);
    expect(setQueriesData).toHaveBeenCalled();
    expect(lastCaptureOptions().title).toBe(EXPECTED_TITLE);
    expect(lastCaptureOptions().stateLine).toBe(EXPECTED_STAGE_LINE);
    // Nothing is written until the operator resolves the toast.
    expect(moveMutate).not.toHaveBeenCalled();
    expect(applyMutateAsync).not.toHaveBeenCalled();
  });

  it("a tapped reason applies the RPC and never also moves the stage", async () => {
    discard(makeOpp());

    await act(async () => {
      lastCaptureOptions().onReason("vendor_sales");
    });

    expect(applyMutateAsync).toHaveBeenCalledTimes(1);
    expect(applyMutateAsync).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      reasonCode: "vendor_sales",
      idempotencyKey: expect.any(String),
    });
    expect(moveMutate).not.toHaveBeenCalled();
    expect(confirmCaptureToast).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalled();
    expect(pushUndo).toHaveBeenCalledTimes(1);
  });

  it("carries the outcome copy when the server routes the lead somewhere else", async () => {
    applyMutateAsync.mockResolvedValue({
      feedbackId: "fb-2",
      outcome: "duplicate_review",
      priorStage: "negotiation",
      currentStage: "negotiation",
      lifecycleChanged: false,
      idempotentReplay: false,
    });
    discard(makeOpp());

    await act(async () => {
      lastCaptureOptions().onReason("duplicate");
    });

    expect(confirmCaptureToast.mock.calls[0]![1]).toMatchObject({
      stateLine: "Duplicate review — stays on board",
      reasonLabel: "duplicate",
    });
  });

  it("ignoring the toast commits today's plain discard with its undo entry", () => {
    discard(makeOpp());

    act(() => {
      lastCaptureOptions().onClosedWithoutReason();
    });

    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({
      id: "opp-1",
      stage: OpportunityStage.Discarded,
    });
    expect(applyMutateAsync).not.toHaveBeenCalled();
    expect(pushUndo).toHaveBeenCalledTimes(1);
  });

  it("undo while pending writes nothing at all and restores server truth", () => {
    discard(makeOpp());

    act(() => {
      lastCaptureOptions().onUndo();
    });

    expect(moveMutate).not.toHaveBeenCalled();
    expect(applyMutateAsync).not.toHaveBeenCalled();
    expect(undoMutateAsync).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
    expect(dismissCaptureToast).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("an unexpected apply failure still discards the lead and says the reason was lost", async () => {
    applyMutateAsync.mockRejectedValue(new Error("network down"));
    discard(makeOpp());

    await act(async () => {
      lastCaptureOptions().onReason("spam");
    });

    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({
      stage: OpportunityStage.Discarded,
    });
    expect(dismissCaptureToast).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Reason not saved", {
      description: "Lead discarded — the reason did not record",
    });
  });

  it("a terminal/merged refusal reconciles instead of discarding twice", async () => {
    applyMutateAsync.mockRejectedValue(
      new LeadDispositionFeedbackError(
        "terminal_or_merged",
        "opportunity_terminal_or_merged"
      )
    );
    discard(makeOpp());

    await act(async () => {
      lastCaptureOptions().onReason("spam");
    });

    expect(moveMutate).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("toast.failedMove", {
      description: "opportunity_terminal_or_merged",
    });
  });

  it("a flag flipped mid-session falls back to the plain discard, silently", async () => {
    applyMutateAsync.mockRejectedValue(
      new LeadDispositionFeedbackError("phase_c_disabled", "phase_c_disabled")
    );
    discard(makeOpp());

    await act(async () => {
      lastCaptureOptions().onReason("spam");
    });

    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("undo after a confirmed reason retracts through the undo RPC", async () => {
    discard(makeOpp());
    await act(async () => {
      lastCaptureOptions().onReason("spam");
    });

    const confirmed = confirmCaptureToast.mock.calls[0]![1] as {
      onUndo: () => void;
    };
    await act(async () => {
      confirmed.onUndo();
    });

    expect(undoMutateAsync).toHaveBeenCalledWith({
      feedbackId: "fb-1",
      idempotencyKey: expect.any(String),
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a conflicted undo tells the operator the lead moved on", async () => {
    undoMutateAsync.mockRejectedValue(
      new LeadDispositionFeedbackError(
        "undo_conflict",
        "feedback_undo_conflict"
      )
    );
    discard(makeOpp());
    await act(async () => {
      lastCaptureOptions().onReason("spam");
    });
    invalidateQueries.mockClear();

    const confirmed = confirmCaptureToast.mock.calls[0]![1] as {
      onUndo: () => void;
    };
    await act(async () => {
      confirmed.onUndo();
    });

    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Undo blocked", {
      description: "This lead changed after the discard",
    });
  });
});

describe("useStageTransition — discard capture (Phase C OFF)", () => {
  beforeEach(() => {
    flags.phaseC = false;
  });

  it("records the legacy audit reason immediately with today's toast copy", async () => {
    discard(makeOpp());
    await act(async () => {});

    expect(showCaptureToast).not.toHaveBeenCalled();
    expect(applyMutateAsync).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      reasonCode: "legacy_unspecified",
      idempotencyKey: expect.any(String),
    });
    expect(moveMutate).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(EXPECTED_TITLE, {
      description: EXPECTED_STAGE_LINE,
    });
    expect(pushUndo).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain stage move when the RPC is unavailable", async () => {
    applyMutateAsync.mockRejectedValue(new Error("network down"));

    discard(makeOpp());
    await act(async () => {});

    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({
      stage: OpportunityStage.Discarded,
    });
    expect(toastSuccess).toHaveBeenCalledWith(EXPECTED_TITLE, {
      description: EXPECTED_STAGE_LINE,
    });
  });

  it("treats uninitialized flags as Phase C off (never fail open)", async () => {
    flags.phaseC = true;
    flags.initialized = false;

    discard(makeOpp());
    await act(async () => {});

    expect(showCaptureToast).not.toHaveBeenCalled();
    expect(applyMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "legacy_unspecified" })
    );
  });
});

describe("useStageTransition — discard from a terminal stage", () => {
  it.each([OpportunityStage.Won, OpportunityStage.Lost])(
    "moves a %s lead straight to discarded (the contract excludes it)",
    (stage) => {
      discard(makeOpp({ stage }));

      expect(showCaptureToast).not.toHaveBeenCalled();
      expect(applyMutateAsync).not.toHaveBeenCalled();
      expect(moveMutate).toHaveBeenCalledTimes(1);
      expect(moveMutate.mock.calls[0]![0]).toMatchObject({
        id: "opp-1",
        stage: OpportunityStage.Discarded,
      });
      expect(pushUndo).toHaveBeenCalledTimes(1);
    }
  );
});
