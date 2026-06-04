import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";
import type { ConversionPreflight } from "@/lib/api/services/project-conversion-service";

// `useStageTransition` Phase 3.2 — the Won path is now a SINGLE atomic
// win+convert. Confirming a win calls ONLY the unified convert RPC (which wins
// + converts in one transaction) with the PRE-win stage as the snapshot guard;
// the card flips to won optimistically; picking a dedup candidate links instead
// of creates; an already-linked deal just deep-links open. Lost is untouched.

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const setQueriesData = vi.fn();
const getQueriesData = vi.fn(() => []);
const invalidateQueries = vi.fn();
const cancelQueries = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
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
const convertMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const linkMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const moveMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
const moveMutateAsync = vi.fn(async () => {});
const updateMutate = vi.fn();
const preflightHook = vi.fn(
  (id: string | undefined): { data?: ConversionPreflight; isLoading: boolean } => ({
    data: id ? PREFLIGHT : undefined,
    isLoading: false,
  }),
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
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ currentUser: { id: "user-1" } }),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (s: { can: () => boolean }) => unknown) =>
    selector({ can: () => true }),
}));

const pushUndo = vi.fn();
vi.mock("@/stores/undo-store", () => ({
  useUndoStore: (selector: (s: { pushUndo: typeof pushUndo }) => unknown) =>
    selector({ pushUndo }),
}));

const PREFLIGHT: ConversionPreflight = {
  existingLinkedProject: null,
  duplicateCandidates: [],
  otherClientProjects: [],
  suggestedName: "1240 W 6th Ave",
};

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

describe("useStageTransition — Won (single atomic win+convert)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opening the Won dialog fetches the preflight for that opportunity", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] }),
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
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 15000 }));

    expect(convertMutate).toHaveBeenCalledTimes(1);
    const [vars] = convertMutate.mock.calls[0]!;
    expect(vars).toMatchObject({
      id: opp.id,
      actualValue: 15000,
      expectedStage: OpportunityStage.Negotiation, // PRE-win stage, not 'won'
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
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.confirmTransition({
        actualValue: 9000,
        linkToProjectId: "proj-existing",
      }),
    );

    expect(linkMutate).toHaveBeenCalledTimes(1);
    expect(linkMutate.mock.calls[0]![0]).toMatchObject({
      id: opp.id,
      projectId: "proj-existing",
      actualValue: 9000,
      expectedStage: OpportunityStage.Negotiation,
    });
    expect(convertMutate).not.toHaveBeenCalled();
  });

  it("confirm with openProjectId deep-links the existing project and writes nothing", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.confirmTransition({ openProjectId: "proj-existing" }),
    );

    expect(routerPush).toHaveBeenCalledWith(
      "/dashboard?openProject=proj-existing&mode=view",
    );
    expect(convertMutate).not.toHaveBeenCalled();
    expect(linkMutate).not.toHaveBeenCalled();
    expect(moveMutate).not.toHaveBeenCalled();
    expect(result.current.dialogType).toBeNull();
  });

  it("convert failure rolls back by invalidating opportunities", () => {
    convertMutate.mockImplementationOnce((_vars, opts) =>
      opts?.onError?.(new Error("boom")),
    );
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() => result.current.confirmTransition({ actualValue: 1000 }));

    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("onAddressChange persists the corrected address to the opportunity", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Won));
    act(() =>
      result.current.onAddressChange({
        address: "500 Main St, Burnaby",
        latitude: 49.2,
        longitude: -123.0,
      }),
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

describe("useStageTransition — Lost (unchanged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirm marks lost via moveStage and records the reason; never converts", () => {
    const opp = makeOpp();
    const { result } = renderHook(() =>
      useStageTransition({ opportunities: [opp] }),
    );

    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    act(() =>
      result.current.confirmTransition({ lostReason: "Price too high" }),
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
      useStageTransition({ opportunities: [opp] }),
    );
    act(() => result.current.requestStageChange(opp.id, OpportunityStage.Lost));
    expect(preflightHook).toHaveBeenLastCalledWith(undefined);
  });
});
