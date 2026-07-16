import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("connection-test-jwt"),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

import {
  useDeleteEmailConnection,
  useEmailConnections,
  useUpdateEmailConnection,
} from "@/lib/hooks/use-email-connections";
import { useGmailConnections } from "@/lib/hooks/use-gmail-connections";
import { useAuthStore } from "@/lib/store/auth-store";

const fetchMock = vi.fn();

const descriptor = {
  id: "connection-1",
  companyId: "company-1",
  provider: "gmail",
  type: "company",
  userId: null,
  email: "shared@canpro.test",
  syncEnabled: true,
  lastSyncedAt: "2026-07-15T12:00:00.000Z",
  syncIntervalMinutes: 60,
  syncFilters: { wizardCompleted: true },
  opsLabelId: "OPS_LABEL",
  aiReviewEnabled: true,
  aiMemoryEnabled: true,
  status: "active",
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useAuthStore.setState({
    company: { id: "company-1" } as never,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email connection browser hooks", () => {
  it("loads sanitized descriptors through the authenticated API", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        connections: [
          {
            ...descriptor,
            accessToken: "route-regression-access-token",
            refreshToken: "route-regression-refresh-token",
          },
        ],
      })
    );

    const { result } = renderHook(() => useEmailConnections(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        ...descriptor,
        lastSyncedAt: new Date(descriptor.lastSyncedAt),
        createdAt: new Date(descriptor.createdAt),
        updatedAt: new Date(descriptor.updatedAt),
      },
    ]);
    expect(result.current.data?.[0]).not.toHaveProperty("accessToken");
    expect(result.current.data?.[0]).not.toHaveProperty("refreshToken");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/email/connection",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer connection-test-jwt",
        }),
      })
    );
  });

  it("routes the legacy Gmail list hook through the same safe API", async () => {
    fetchMock.mockResolvedValueOnce(response({ connections: [descriptor] }));

    const { result } = renderHook(() => useGmailConnections(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].email).toBe("shared@canpro.test");
    expect(result.current.data?.[0]).not.toHaveProperty("accessToken");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/email/connection",
      expect.any(Object)
    );
  });

  it("updates and disconnects through authenticated route mutations", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ok: true, connection: descriptor }))
      .mockResolvedValueOnce(response({ ok: true }));

    const update = renderHook(() => useUpdateEmailConnection(), { wrapper });
    await update.result.current.mutateAsync({
      id: "connection-1",
      data: { syncEnabled: false, syncIntervalMinutes: 30 },
    });

    const [patchUrl, patchInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(patchUrl).toBe("/api/integrations/email/connection");
    expect(patchInit.method).toBe("PATCH");
    expect(patchInit.headers).toMatchObject({
      Authorization: "Bearer connection-test-jwt",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(patchInit.body))).toEqual({
      connectionId: "connection-1",
      data: { syncEnabled: false, syncIntervalMinutes: 30 },
    });

    const remove = renderHook(() => useDeleteEmailConnection(), { wrapper });
    await remove.result.current.mutateAsync("connection-1");

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(deleteUrl).toBe(
      "/api/integrations/email/connection?id=connection-1"
    );
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.headers).toMatchObject({
      Authorization: "Bearer connection-test-jwt",
    });
  });
});
