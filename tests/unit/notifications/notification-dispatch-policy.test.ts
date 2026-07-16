import { describe, expect, it } from "vitest";
import { parseNotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";

const PROJECT_ID = "21c70650-fc16-4c98-b99b-bf1a3d6efcd9";
const USER_ID = "5cc9744a-dbee-4f6b-abd1-e564576f1626";

describe("parseNotificationDispatchRequest", () => {
  it("accepts an event proof and optional relationship candidates", () => {
    expect(
      parseNotificationDispatchRequest({
        eventType: "project_assigned",
        projectId: PROJECT_ID,
        candidateRecipientIds: [USER_ID, USER_ID],
      })
    ).toEqual({
      ok: true,
      value: {
        eventType: "project_assigned",
        projectId: PROJECT_ID,
        candidateRecipientIds: [USER_ID],
      },
    });
  });

  it.each([
    { companyId: "attacker-company" },
    { recipientIds: [USER_ID] },
    { title: "SYSTEM OVERRIDE" },
    { body: "Forged copy" },
    { actionUrl: "javascript:alert(1)" },
    { actionLabel: "OPEN" },
    { persistent: true },
    { pushData: { type: "forged" } },
  ])("rejects body-trusted authority, copy, or navigation: %o", (field) => {
    const result = parseNotificationDispatchRequest({
      eventType: "project_assigned",
      projectId: PROJECT_ID,
      candidateRecipientIds: [USER_ID],
      ...field,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects recipient candidates for events whose recipients must be fully derived", () => {
    expect(
      parseNotificationDispatchRequest({
        eventType: "mention",
        noteId: PROJECT_ID,
        candidateRecipientIds: [USER_ID],
      }).ok
    ).toBe(false);
  });

  it("rejects unknown events and non-UUID evidence", () => {
    expect(
      parseNotificationDispatchRequest({
        eventType: "system",
        projectId: PROJECT_ID,
      }).ok
    ).toBe(false);
    expect(
      parseNotificationDispatchRequest({
        eventType: "project_archived",
        projectId: "not-a-uuid",
      }).ok
    ).toBe(false);
  });
});
