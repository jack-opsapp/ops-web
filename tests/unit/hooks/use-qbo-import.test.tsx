import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn();
vi.mock("@/lib/hooks/use-notifications", () => ({
  useCreateNotification: () => notify,
}));
vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-jwt"),
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars
        ? Object.entries(vars).reduce(
            (s, [k, v]) => s.replace(`{${k}}`, String(v)),
            key
          )
        : key,
  }),
}));

import {
  useStartImport,
  useImportReview,
  useApplyImport,
} from "@/lib/hooks/use-qbo-import";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();

beforeEach(() => {
  notify.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStartImport", () => {
  it("POSTs to the import route with the company id and Firebase bearer", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runId: "run-1" }),
    });
    const { result } = renderHook(() => useStartImport(), { wrapper });
    const res = await result.current.mutateAsync({ companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077" });
    expect(res).toEqual({ runId: "run-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks/import");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(init.body)).toEqual({
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
    });
  });
});

describe("useImportReview", () => {
  it("GETs the review by runId and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run: { id: "run-1", status: "staged" } }),
    });
    const { result } = renderHook(() => useImportReview("run-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/integrations/quickbooks/import?runId=run-1"
    );
    expect(result.current.data?.run.id).toBe("run-1");
  });

  it("is disabled when runId is null", () => {
    const { result } = renderHook(() => useImportReview(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useApplyImport", () => {
  it("POSTs decisions and does NOT fire a client-side notification (server owns it)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ applied: { customers: 3, invoices: 5, payments: 2, estimates: 1, lineItems: 12 } }),
    });
    const { result } = renderHook(() => useApplyImport(), { wrapper });
    const res = await result.current.mutateAsync({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
    });
    expect(res.applied.customers).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks/import/apply");
    expect(JSON.parse(init.body)).toEqual({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
    });
    // The apply API route inserts the `accounting_import_complete` rail
    // notification server-side; the hook must NOT double-notify client-side.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(notify).not.toHaveBeenCalled();
  });
});
