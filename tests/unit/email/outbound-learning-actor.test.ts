import { describe, expect, it } from "vitest";

import { resolveOutboundLearningActorId } from "@/lib/email/outbound-learning-actor";

describe("outbound learning actor attribution", () => {
  it("uses the authenticated OPS actor recorded on an OPS-created activity", () => {
    expect(
      resolveOutboundLearningActorId({
        activityCreatedBy: "jason-user-id",
        connectionType: "company",
        connectionOwnerId: "connector-user-id",
      })
    ).toBe("jason-user-id");
  });

  it("uses the canonical owner for native sent mail from a personal mailbox", () => {
    expect(
      resolveOutboundLearningActorId({
        activityCreatedBy: null,
        connectionType: "individual",
        connectionOwnerId: "personal-owner-id",
      })
    ).toBe("personal-owner-id");
  });

  it("never infers a user for native sent mail from a shared company mailbox", () => {
    expect(
      resolveOutboundLearningActorId({
        activityCreatedBy: null,
        connectionType: "company",
        connectionOwnerId: "connection-creator-id",
      })
    ).toBeNull();
  });

  it("fails closed when a personal mailbox has no canonical owner", () => {
    expect(
      resolveOutboundLearningActorId({
        activityCreatedBy: null,
        connectionType: "individual",
        connectionOwnerId: null,
      })
    ).toBeNull();
  });
});
