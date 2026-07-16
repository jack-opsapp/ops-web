/**
 * Won-conversion hooks — preflight query + convert / link-existing mutations.
 *
 * These are thin TanStack wrappers over the service-role API routes (the
 * browser client runs as anon and cannot call the SECURITY DEFINER RPCs
 * directly). The tests mock fetch + the Firebase id token and assert each hook
 * hits the right route, method, and body:
 *   - useConversionPreflight     → GET  /api/opportunities/{id}/preflight
 *   - useConvertOpportunityToProject → POST /convert (value/stage/titleOverride)
 *   - useLinkOpportunityToExistingProject → POST /convert with linkToProjectId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: async () => "test-token",
}));
vi.mock("@/lib/api/services", () => ({ OpportunityService: {} }));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "user-1" },
  }),
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
    if (!requiredScope || granted === "all") return true;
    if (granted === "assigned") {
      return requiredScope === "assigned" || requiredScope === "own";
    }
    return requiredScope === "own";
  };
  return {
    ...actual,
    usePermissionStore: (selector?: (state: unknown) => unknown) => {
      const state = {
        can,
        permissions: permissionState.permissions,
        configuredPermissions: permissionState.configuredPermissions,
      };
      return selector ? selector(state) : state;
    },
  };
});

import {
  useConversionPreflight,
  useConvertOpportunityToProject,
  useLinkOpportunityToExistingProject,
  type ConvertOpportunityResponse,
} from "@/lib/hooks/use-opportunities";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function QueryClientTestWrapper({
    children,
  }: {
    children: React.ReactNode;
  }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function stubFetch(jsonBody: unknown) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: FetchCall["init"]) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => jsonBody,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionState.permissions = new Map([["pipeline.convert", "assigned"]]);
  permissionState.configuredPermissions = new Set(["pipeline.convert"]);
});
afterEach(() => vi.unstubAllGlobals());

describe("useConversionPreflight", () => {
  it("GETs the preflight route with the bearer token and returns the JSON", async () => {
    const calls = stubFetch({
      existingLinkedProject: null,
      duplicateCandidates: [],
      otherClientProjects: [],
      suggestedName: "1240 W 6th Ave",
      assignmentVersion: 12,
      alreadyConverted: false,
      projectAccessible: false,
    });

    const { result } = renderHook(() => useConversionPreflight("opp-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/opportunities/opp-1/preflight");
    expect(calls[0].init?.headers?.Authorization).toBe("Bearer test-token");
    expect(result.current.data?.suggestedName).toBe("1240 W 6th Ave");
    expect(result.current.data?.assignmentVersion).toBe(12);
  });

  it("is disabled (no fetch) when no opportunity id is provided", async () => {
    const calls = stubFetch({});
    renderHook(() => useConversionPreflight(undefined), {
      wrapper: makeWrapper(),
    });
    // give microtasks a tick; the disabled query must never fetch.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
  });

  it("is disabled when granular convert is explicitly revoked despite legacy manage", async () => {
    permissionState.permissions = new Map([["pipeline.manage", "all"]]);
    permissionState.configuredPermissions = new Set(["pipeline.convert"]);
    const calls = stubFetch({});

    renderHook(() => useConversionPreflight("opp-1"), {
      wrapper: makeWrapper(),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
  });
});

describe("useConvertOpportunityToProject", () => {
  it("POSTs to /convert once with value, stage, and titleOverride", async () => {
    const calls = stubFetch({
      ok: true,
      converted: true,
      alreadyConverted: false,
      projectId: "p1",
      opportunityId: "opp-1",
      won: true,
    });

    const { result } = renderHook(() => useConvertOpportunityToProject(), {
      wrapper: makeWrapper(),
    });

    let response: ConvertOpportunityResponse | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        id: "opp-1",
        actualValue: 1000,
        expectedStage: "proposal",
        expectedAssignmentVersion: 12,
        titleOverride: "Custom name",
      });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/opportunities/opp-1/convert");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(calls[0].init?.body ?? "{}");
    expect(body).toMatchObject({
      actualValue: 1000,
      expectedStage: "proposal",
      expectedAssignmentVersion: 12,
      titleOverride: "Custom name",
    });
    expect(body.linkToProjectId).toBeUndefined();
    expect(response?.won).toBe(true);
  });
});

describe("useLinkOpportunityToExistingProject", () => {
  it("POSTs to /convert with linkToProjectId and surfaces linkedExisting", async () => {
    const calls = stubFetch({
      ok: true,
      converted: true,
      alreadyConverted: false,
      projectId: "existing-proj",
      opportunityId: "opp-1",
      linkedExisting: true,
    });

    const { result } = renderHook(() => useLinkOpportunityToExistingProject(), {
      wrapper: makeWrapper(),
    });

    let response: ConvertOpportunityResponse | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        id: "opp-1",
        projectId: "existing-proj",
        actualValue: 500,
        expectedAssignmentVersion: 12,
      });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/opportunities/opp-1/convert");
    const body = JSON.parse(calls[0].init?.body ?? "{}");
    expect(body.linkToProjectId).toBe("existing-proj");
    expect(body.actualValue).toBe(500);
    expect(body.expectedAssignmentVersion).toBe(12);
    expect(response?.linkedExisting).toBe(true);
  });
});
