import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";

// `useStageTransition` Phase 3.2 — the Won path is now a SINGLE atomic
// win+convert. Confirming a win calls ONLY the unified convert RPC (which wins
// + converts in one transaction) with the PRE-win stage as the snapshot guard;
// the card flips to won optimistically; picking a dedup candidate links instead
// of creates; an already-linked-but-not-won deal still runs the idempotent
// conversion before navigation. Lost is untouched.

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
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

// Mutations — `mutate` invokes its onSuccess so the success branches run.
const convertMutate = vi.fn((_vars, opts) =>
  opts?.onSuccess?.({ projectId: "proj-new", projectAccessible: true })
);
const linkMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const moveMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const moveMutateAsync = vi.fn(async () => {});
const updateMutate = vi.fn();
const applyFeedbackMutateAsync = vi.fn(async () => ({ feedbackId: "fb-1" }));
const undoFeedbackMutateAsync = vi.fn(async () => {});
const preflightHook = vi.fn(
  (
    id: string | undefined
  ): { data?: ConversionPreflight; isLoading: boolean } => ({
    data: id ? PREFLIGHT : undefined,
    isLoading: false,
  })
);

vi.mock("@/lib/hooks", () => ({
  useClients: () => ({ data: { clients: [{ id: "client-1", name: "Acme" }] } }),
  useMoveOpportunityStage: () => ({
    mutate: moveMutate,
    mutateAsync: moveMutateAsync,
  }),
  useUpdateOpportunity: () => ({ mutate: updateMutate }),
  useConvertOpportunityToProject: () => ({ mutate: convertMutate }),
  useLinkOpportunityToExistingProject: () => ({ mutate: linkMutate }),
  useConversionPreflight: (id: string | undefined) => preflightHook(id),
  // Discard dependencies. Hoisted to module scope (rather than a fresh
  // `vi.fn()` per render) so the discard tests can drive the feedback
  // contract's success and rejection branches.
  useApplyLeadDispositionFeedback: () => ({
    mutateAsync: applyFeedbackMutateAsync,
  }),
  useUndoLeadDispositionFeedback: () => ({
    mutateAsync: undoFeedbackMutateAsync,
  }),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastBase = vi.fn();
// Sonner's `toast` is a callable with variant methods hung off it. The base
// call matters here: `showUndoToast` (the undo toast an active stage move now
// renders) invokes `toast(title, opts)` directly.
vi.mock("@/components/ui/toast", () => {
  const toast = Object.assign(
    (...a: unknown[]) => toastBase(...a),
    {
      success: (...a: unknown[]) => toastSuccess(...a),
      error: (...a: unknown[]) => toastError(...a),
    }
  );
  return { toast };
});

// A DELEGATING spy: the real `showUndoToast` still runs (so the assertions
// that read the emitted `toast.success` payload keep exercising the actual
// variant routing and action wiring), while tests can also assert directly on
// whether a mutation rendered an undo affordance at all.
const showUndoToastSpy = vi.fn();
vi.mock("@/components/ui/toast-undo", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/toast-undo")>(
      "@/components/ui/toast-undo"
    );
  return {
    ...actual,
    showUndoToast: (options: Parameters<typeof actual.showUndoToast>[0]) => {
      showUndoToastSpy(options);
      return actual.showUndoToast(options);
    },
  };
});

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ currentUser: { id: "user-1" } }),
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

const pushUndo = vi.fn(() => "undo-entry-1");
const undoEntry = vi.fn(async () => {});
vi.mock("@/stores/undo-store", () => ({
  useUndoStore: (
    selector: (s: {
      pushUndo: typeof pushUndo;
      undoEntry: typeof undoEntry;
    }) => unknown
  ) => selector({ pushUndo, undoEntry }),
}));

const PREFLIGHT: ConversionPreflight = {
  assignmentVersion: 12,
  alreadyConverted: false,
  projectAccessible: false,
  existingLinkedProject: null,
  duplicateCandidates: [],
  otherClientProjects: [],
  suggestedName: "1240 W 6th Ave",
};

const { useStageTransition } =
  await import("@/app/(dashboard)/pipeline/_components/use-stage-transition");

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

describe("useStageTransition — Won (single atomic win+convert)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionState.permissions = new Map([
      ["pipeline.convert", "assigned"],
      ["pipeline.manage", "all"],
    ]);
    permissionState.configuredPermissions = new Set(["pipeline.convert"]);
    convertMutate.mockReset();
    convertMutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ projectId: "proj-new", projectAccessible: true })
    );
    linkMutate.mockReset();
    linkMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id ? PREFLIGHT : undefined,
      isLoading: false,
    }));
  });

  it("opening the Won dialog fetches the preflight for that opportunity", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    // Closed → preflight disabled (undefined id).
    expect(preflightHook).toHaveBeenLastCalledWith(undefined);

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));

    expect(result.current.dialogType).toBe("won");
    expect(result.current.dialogOpportunity).toBe(opp);
    expect(preflightHook).toHaveBeenLastCalledWith(opp.id);
    expect(result.current.preflight).toEqual(PREFLIGHT);
    expect(result.current.preflightLoading).toBe(false);
  });

  it("confirm (clean) calls convert ONCE with the pre-win stage; no separate moveStage", () => {
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 15000 }));

    expect(convertMutate).toHaveBeenCalledTimes(1);
    const [vars] = convertMutate.mock.calls[0]!;
    expect(vars).toMatchObject({
      id: opp.id,
      actualValue: 15000,
      expectedStage: OpportunityStage.Negotiation, // PRE-win stage, not 'won'
      expectedAssignmentVersion: 12,
    });
    // Winning no longer routes through a separate stage move.
    expect(moveMutate).not.toHaveBeenCalled();
    // Optimistic local flip + undo entry retained.
    expect(setQueriesData).toHaveBeenCalled();
    expect(pushUndo).toHaveBeenCalledTimes(1);
    // Dialog closes.
    expect(result.current.dialogType).toBeNull();
  });

  it("confirm with a chosen candidate links the existing project instead of creating", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.confirmTransition({
        actualValue: 9000,
        linkToProjectId: "proj-existing",
      })
    );

    expect(linkMutate).toHaveBeenCalledTimes(1);
    expect(linkMutate.mock.calls[0]![0]).toMatchObject({
      id: opp.id,
      projectId: "proj-existing",
      actualValue: 9000,
      expectedStage: OpportunityStage.Negotiation,
      expectedAssignmentVersion: 12,
    });
    expect(convertMutate).not.toHaveBeenCalled();
  });

  it("linked-but-not-won accessible project is won atomically before navigation", () => {
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id
        ? {
            ...PREFLIGHT,
            alreadyConverted: true,
            projectAccessible: true,
            existingLinkedProject: {
              id: "proj-existing",
              title: "Existing project",
            },
          }
        : undefined,
      isLoading: false,
    }));
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );
    convertMutate.mockImplementationOnce((_vars, opts) =>
      opts?.onSuccess?.({
        projectId: "proj-existing",
        projectAccessible: true,
      })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.confirmTransition({ openProjectId: "proj-existing" })
    );

    expect(routerPush).toHaveBeenCalledWith(
      "/dashboard?openProject=proj-existing&mode=view"
    );
    expect(convertMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: opp.id,
        expectedStage: OpportunityStage.Negotiation,
        expectedAssignmentVersion: 12,
      }),
      expect.any(Object)
    );
    expect(linkMutate).not.toHaveBeenCalled();
    expect(moveMutate).not.toHaveBeenCalled();
    expect(result.current.dialogType).toBeNull();
  });

  it("already-won linked project opens without another conversion write", () => {
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id
        ? {
            ...PREFLIGHT,
            alreadyConverted: true,
            projectAccessible: true,
            existingLinkedProject: {
              id: "proj-existing",
              title: "Existing project",
            },
          }
        : undefined,
      isLoading: false,
    }));
    const opp = makeOpp({ stage: OpportunityStage.Won });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestConvertAlreadyWon(opp.id));
    act(() =>
      result.current.confirmTransition({ openProjectId: "proj-existing" })
    );

    expect(routerPush).toHaveBeenCalledWith(
      "/dashboard?openProject=proj-existing&mode=view"
    );
    expect(convertMutate).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
  });

  it("convert failure rolls back by invalidating opportunities", () => {
    convertMutate.mockImplementationOnce((_vars, opts) =>
      opts?.onError?.(new Error("boom"))
    );
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 1000 }));

    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("requestConvertAlreadyWon opens the Won dialog for an already-won opp (bypasses the same-stage no-op)", () => {
    const opp = makeOpp({ stage: OpportunityStage.Won, projectId: null });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    // requestStageChange no-ops on the same stage — the dialog never opens.
    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    expect(result.current.dialogType).toBeNull();

    // The dedicated entry opens the same Won dialog.
    act(() => result.current.requestConvertAlreadyWon(opp.id));
    expect(result.current.dialogType).toBe("won");
    expect(result.current.dialogOpportunity).toBe(opp);

    // Confirm converts with expectedStage='won' — RPC step-12 writes no 2nd
    // transition.
    act(() => result.current.confirmTransition({ actualValue: 5000 }));
    expect(convertMutate).toHaveBeenCalledTimes(1);
    expect(convertMutate.mock.calls[0]![0]).toMatchObject({
      id: opp.id,
      expectedStage: OpportunityStage.Won,
      expectedAssignmentVersion: 12,
    });
  });

  it("allows already-won recovery with explicit assigned convert access and no legacy manage grant", () => {
    permissionState.permissions = new Map([["pipeline.convert", "assigned"]]);
    permissionState.configuredPermissions = new Set(["pipeline.convert"]);
    const opp = makeOpp({ stage: OpportunityStage.Won, projectId: null });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestConvertAlreadyWon(opp.id));

    expect(result.current.dialogType).toBe("won");
  });

  it("denies already-won recovery when granular convert is explicitly revoked even if legacy manage remains", () => {
    permissionState.permissions = new Map([["pipeline.manage", "all"]]);
    permissionState.configuredPermissions = new Set(["pipeline.convert"]);
    const opp = makeOpp({ stage: OpportunityStage.Won, projectId: null });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestConvertAlreadyWon(opp.id));

    expect(result.current.dialogType).toBeNull();
  });

  it("allows bounded legacy recovery only when granular convert is genuinely absent", () => {
    permissionState.permissions = new Map([["pipeline.manage", "all"]]);
    permissionState.configuredPermissions = new Set();
    const opp = makeOpp({ stage: OpportunityStage.Won, projectId: null });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestConvertAlreadyWon(opp.id));

    expect(result.current.dialogType).toBe("won");
  });

  it("refuses to mutate when preflight has no safe assignment snapshot", () => {
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id
        ? ({ ...PREFLIGHT, assignmentVersion: -1 } as ConversionPreflight)
        : undefined,
      isLoading: false,
    }));
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 1000 }));

    expect(convertMutate).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("linked-but-inaccessible project is recovered without a link target or navigation", () => {
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id
        ? { ...PREFLIGHT, alreadyConverted: true, projectAccessible: false }
        : undefined,
      isLoading: false,
    }));
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );
    convertMutate.mockImplementationOnce((_vars, opts) =>
      opts?.onSuccess?.({ projectId: null, projectAccessible: false })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 12500 }));

    expect(routerPush).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
    expect(convertMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: opp.id,
        actualValue: 12500,
        expectedStage: OpportunityStage.Negotiation,
        expectedAssignmentVersion: 12,
      }),
      expect.any(Object)
    );
    expect(convertMutate.mock.calls[0]![0]).not.toHaveProperty(
      "linkToProjectId"
    );
    expect(toastSuccess).toHaveBeenCalledWith("toast.dealMarkedWon", {
      description: opp.title,
    });
  });

  it("ignores a forged open-project id during inaccessible already-won recovery", () => {
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id
        ? { ...PREFLIGHT, alreadyConverted: true, projectAccessible: false }
        : undefined,
      isLoading: false,
    }));
    const opp = makeOpp({ stage: OpportunityStage.Won });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );
    convertMutate.mockImplementationOnce((_vars, opts) =>
      opts?.onSuccess?.({ projectId: null, projectAccessible: false })
    );

    act(() => result.current.requestConvertAlreadyWon(opp.id));
    act(() =>
      result.current.confirmTransition({ openProjectId: "proj-hidden" })
    );

    expect(routerPush).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
    expect(convertMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: opp.id,
        expectedStage: OpportunityStage.Won,
        expectedAssignmentVersion: 12,
      }),
      expect.any(Object)
    );
  });

  it("onAddressChange persists the corrected address to the opportunity", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.onAddressChange({
        address: "500 Main St, Burnaby",
        latitude: 49.2,
        longitude: -123.0,
      })
    );

    expect(updateMutate).toHaveBeenCalledWith({
      id: opp.id,
      data: {
        address: "500 Main St, Burnaby",
        latitude: 49.2,
        longitude: -123.0,
      },
    });
  });
});

describe("useStageTransition — active-move undo toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id ? PREFLIGHT : undefined,
      isLoading: false,
    }));
  });

  it("renders a VISIBLE undo action instead of a bare success toast", async () => {
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() =>
      result.current.requestStageChange(opp.id, OpportunityStage.Quoting)
    );

    // The old toast carried no way back — the undo entry was pushed but
    // invisible. The move now renders through showUndoToast, which must still
    // emit the SUCCESS variant so the olive status rail survives the change.
    expect(toastBase).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledTimes(1);

    const [title, options] = toastSuccess.mock.calls[0] as [
      string,
      { description?: string; action?: { label: string; onClick: () => void } },
    ];
    expect(title).toContain("Acme");
    expect(options.description).toBe("Negotiation → Quoting");
    expect(options.action?.label).toBeTruthy();
  });

  it("undo action targets the pushed entry so the top bar can't undo it twice", async () => {
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() =>
      result.current.requestStageChange(opp.id, OpportunityStage.Quoting)
    );

    // The same entry backs both affordances: the global stack (Cmd+Z) and the
    // toast. The toast must consume it BY ID, never pop the stack blindly.
    expect(pushUndo).toHaveBeenCalledTimes(1);
    const entryId = pushUndo.mock.results[0].value;

    const [, options] = toastSuccess.mock.calls[0] as [
      string,
      { action?: { onClick: () => void } },
    ];
    await act(async () => {
      options.action?.onClick();
    });

    expect(undoEntry).toHaveBeenCalledWith(entryId);
  });
});

describe("useStageTransition — undo contract on the terminal paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionState.permissions = new Map([
      ["pipeline.convert", "assigned"],
      ["pipeline.manage", "all"],
    ]);
    permissionState.configuredPermissions = new Set(["pipeline.convert"]);
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id ? PREFLIGHT : undefined,
      isLoading: false,
    }));
    applyFeedbackMutateAsync.mockImplementation(async () => ({
      feedbackId: "fb-1",
    }));
    convertMutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ projectId: "proj-new", projectAccessible: true })
    );
  });

  it("Lost confirm renders a visible undo that consumes the pushed entry", async () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    act(() => result.current.confirmTransition({ lostReason: "Price" }));

    // Marking a deal lost has a true inverse (move the stage back), so it owes
    // the operator the same visible UNDO an active move gives them.
    expect(showUndoToastSpy).toHaveBeenCalledTimes(1);
    const options = showUndoToastSpy.mock.calls[0]![0] as {
      title: string;
      description?: string;
      onUndo: () => void;
    };
    expect(options.title).toBe("toast.dealMarkedLost");
    expect(options.description).toBe(opp.title);

    const entryId = pushUndo.mock.results[0]!.value;
    await act(async () => {
      options.onUndo();
    });
    expect(undoEntry).toHaveBeenCalledWith(entryId);
  });

  it("Won confirm offers no undo toast — the inverse would not un-create the project", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 12500 }));

    // Deliberate: `moveStage` back to the prior stage does NOT unwind the
    // project the convert RPC just minted, so a visible UNDO here would
    // promise a reversal the handler cannot deliver.
    expect(showUndoToastSpy).not.toHaveBeenCalled();
    expect(pushUndo).toHaveBeenCalledTimes(1);
  });

  it("discard records the audit row and renders a visible undo", async () => {
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    await act(async () => {
      result.current.requestStageChange(opp.id, OpportunityStage.Discarded);
    });

    expect(applyFeedbackMutateAsync).toHaveBeenCalledTimes(1);
    expect(showUndoToastSpy).toHaveBeenCalledTimes(1);
    const options = showUndoToastSpy.mock.calls[0]![0] as {
      title: string;
      description?: string;
      onUndo: () => void;
    };
    expect(options.title).toContain("Acme");
    expect(options.description).toBe("Negotiation → Discarded");

    const entryId = pushUndo.mock.results[0]!.value;
    await act(async () => {
      options.onUndo();
    });
    expect(undoEntry).toHaveBeenCalledWith(entryId);
  });

  it("discard falls back to a plain move on an unknown feedback error and still shows undo", async () => {
    applyFeedbackMutateAsync.mockRejectedValueOnce(new Error("network down"));
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    await act(async () => {
      result.current.requestStageChange(opp.id, OpportunityStage.Discarded);
    });

    // The discard must never fail to happen because the feedback contract was
    // unavailable — and the fallback owes the same visible undo as the path
    // it replaced.
    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({
      id: opp.id,
      stage: OpportunityStage.Discarded,
    });
    expect(showUndoToastSpy).toHaveBeenCalledTimes(1);
    const options = showUndoToastSpy.mock.calls[0]![0] as {
      description?: string;
    };
    expect(options.description).toBe("Negotiation → Discarded");
  });
});

describe("useStageTransition — Lost (unchanged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id ? PREFLIGHT : undefined,
      isLoading: false,
    }));
  });

  it("confirm marks lost via moveStage and records the reason; never converts", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    act(() =>
      result.current.confirmTransition({ lostReason: "Price too high" })
    );

    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({
      id: opp.id,
      stage: OpportunityStage.Lost,
    });
    expect(updateMutate).toHaveBeenCalledWith({
      id: opp.id,
      data: { lostReason: "Price too high" },
    });
    expect(convertMutate).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
  });

  it("Lost does not fetch a conversion preflight", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );
    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    expect(preflightHook).toHaveBeenLastCalledWith(undefined);
  });
});

describe("useStageTransition — granular edit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionState.permissions = new Map([["pipeline.edit", "assigned"]]);
    permissionState.configuredPermissions = new Set(["pipeline.edit"]);
    preflightHook.mockImplementation((id: string | undefined) => ({
      data: id ? PREFLIGHT : undefined,
      isLoading: false,
    }));
  });

  it("allows assigned edit access to move an assigned lead between active stages", () => {
    const opp = makeOpp({ stage: OpportunityStage.Negotiation });
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() =>
      result.current.requestStageChange(opp.id, OpportunityStage.Quoting)
    );

    expect(moveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: opp.id, stage: OpportunityStage.Quoting }),
      expect.any(Object)
    );
  });

  it("uses assigned edit access in both Lost request and confirm gates", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    expect(result.current.dialogType).toBe("lost");
    act(() =>
      result.current.confirmTransition({ lostReason: "Not proceeding" })
    );

    expect(moveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: opp.id, stage: OpportunityStage.Lost }),
      expect.any(Object)
    );
  });

  it("blocks active moves when granular edit is revoked despite legacy manage", () => {
    permissionState.permissions = new Map([["pipeline.manage", "all"]]);
    permissionState.configuredPermissions = new Set(["pipeline.edit"]);
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() =>
      result.current.requestStageChange(opp.id, OpportunityStage.Quoting)
    );

    expect(moveMutate).not.toHaveBeenCalled();
  });

  it("keeps legacy-only active moves when granular edit is genuinely absent", () => {
    permissionState.permissions = new Map([["pipeline.manage", "all"]]);
    permissionState.configuredPermissions = new Set();
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] })
    );

    act(() =>
      result.current.requestStageChange(opp.id, OpportunityStage.Quoting)
    );

    expect(moveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: opp.id, stage: OpportunityStage.Quoting }),
      expect.any(Object)
    );
  });
});
