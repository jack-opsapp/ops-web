import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  batchArchiveRequest,
  batchUnarchiveRequest,
} from "@/lib/hooks/use-inbox-threads";
import { getIdToken } from "@/lib/firebase/auth";

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("token-1"),
}));

describe("inbox batch partial responses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getIdToken).mockResolvedValue("token-1");
  });

  it("preserves a truthful partial archive body returned with HTTP 502", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Some threads could not be archived. Refresh and try again.",
          archivedThreadIds: ["thread-1"],
          failedThreadIds: ["thread-2"],
          leadArchivedOpportunityId: null,
          failedOpportunityId: "opportunity-1",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      batchArchiveRequest({
        threadIds: ["thread-1", "thread-2"],
        archiveOpportunityId: "opportunity-1",
      })
    ).resolves.toMatchObject({
      ok: false,
      archivedThreadIds: ["thread-1"],
      failedThreadIds: ["thread-2"],
      failedOpportunityId: "opportunity-1",
    });
  });

  it("preserves a truthful partial restore body returned with HTTP 502", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Some threads could not be restored. Refresh and try again.",
          unarchivedThreadIds: ["thread-1"],
          failedThreadIds: ["thread-2"],
          unarchivedOpportunityId: null,
          failedOpportunityId: "opportunity-1",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      batchUnarchiveRequest({
        threadIds: ["thread-1", "thread-2"],
        unarchiveOpportunityId: "opportunity-1",
      })
    ).resolves.toMatchObject({
      ok: false,
      unarchivedThreadIds: ["thread-1"],
      failedThreadIds: ["thread-2"],
      failedOpportunityId: "opportunity-1",
    });
  });
});
