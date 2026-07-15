import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("signature-test-jwt"),
}));

import {
  useEmailSignature,
  useImportProviderEmailSignature,
  useSaveEmailSignature,
} from "@/lib/hooks/use-email-signature";

const fetchMock = vi.fn();

const scope = {
  companyId: "company-1",
  userId: "user-1",
  connectionId: "connection-1",
};

const signature = {
  connectionId: scope.connectionId,
  mailbox: "jack@ops.test",
  provider: "gmail" as const,
  effective: {
    source: "gmail" as const,
    html: "<div>Jack<br>OPS</div>",
    text: "Jack\nOPS",
    hash: "hash-1",
  },
  ops: null,
  providerSignature: {
    source: "gmail" as const,
    html: "<div>Jack<br>OPS</div>",
    text: "Jack\nOPS",
    fetchedAt: "2026-07-14T12:00:00.000Z",
  },
  providerImportSupported: true,
  missing: false,
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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email signature hooks", () => {
  it("loads the current mailbox signature through the authenticated route", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => signature,
    });

    const { result } = renderHook(() => useEmailSignature(scope), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(signature);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/integrations/email/signature?companyId=company-1&userId=user-1&connectionId=connection-1"
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer signature-test-jwt",
    });
  });

  it("saves an OPS signature with the exact mailbox scope", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...signature,
        effective: {
          source: "ops",
          html: "Jack\nOPS",
          text: "Jack\nOPS",
          hash: "hash-2",
        },
        ops: { html: "Jack\nOPS", text: "Jack\nOPS" },
      }),
    });

    const { result } = renderHook(() => useSaveEmailSignature(), { wrapper });
    await result.current.mutateAsync({ ...scope, opsText: "Jack\nOPS" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/integrations/email/signature");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer signature-test-jwt",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      ...scope,
      opsText: "Jack\nOPS",
    });
  });

  it("imports the connected Gmail signature without sending mail", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => signature,
    });

    const { result } = renderHook(() => useImportProviderEmailSignature(), {
      wrapper,
    });
    await result.current.mutateAsync(scope);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/integrations/email/signature");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      ...scope,
      action: "import_provider",
    });
  });
});
