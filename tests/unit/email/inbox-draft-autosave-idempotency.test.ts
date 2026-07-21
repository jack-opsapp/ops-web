import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/ops/inbox/inbox-route.tsx"),
  "utf8"
);

describe("inbox provider-draft autosave idempotency", () => {
  it("uses one persisted draft-instance key rather than the permanent actor/thread store key", () => {
    expect(source).toContain("autoSaveDraftOperationKeyRef");
    expect(source).toContain("autoSaveDraftOperationKey");
    expect(source).toContain("globalThis.crypto.randomUUID()");
    expect(source).toContain("idempotencyKey: durableDraftOperationKey");
    expect(source).not.toContain(
      "idempotencyKey: currentCommunicationDraftKey"
    );
  });

  it("rotates the draft-instance key after a successful send", () => {
    const sentLifecycle = source.slice(
      source.indexOf('liveCommunicationDraft?.state.sendStatus !== "sent"'),
      source.indexOf(
        "}, [currentCommunicationDraftKey, liveCommunicationDraft?.state.sendStatus]"
      )
    );
    expect(sentLifecycle).toContain(
      "autoSaveDraftOperationKeyRef.current = null"
    );
  });
});
