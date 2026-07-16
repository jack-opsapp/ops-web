import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authedFetchMock, invalidateMock, useQueryClientMock } = vi.hoisted(
  () => ({
    authedFetchMock: vi.fn(),
    invalidateMock: vi.fn(),
    useQueryClientMock: vi.fn(),
  })
);

vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: (...args: unknown[]) => authedFetchMock(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => useQueryClientMock(),
}));

import { useActionPrompts } from "@/hooks/useActionPrompts";

describe("useActionPrompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateMock });
    authedFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    invalidateMock.mockResolvedValue(undefined);
  });

  it("sends a bodyless sync request and refreshes the notification rail", async () => {
    renderHook(() => useActionPrompts());

    await waitFor(() => {
      expect(authedFetchMock).toHaveBeenCalledWith(
        "/api/notifications/setup-prompts",
        { method: "POST" }
      );
    });
    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalledWith({
        queryKey: ["notifications"],
      });
    });
  });

  it("does not refresh the rail when the server rejects reconciliation", async () => {
    authedFetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    renderHook(() => useActionPrompts());

    await waitFor(() => expect(authedFetchMock).toHaveBeenCalledTimes(1));
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
