import { describe, it, expect } from "vitest";
import { buildMemberJoinedCopy } from "@/lib/notifications/notification-copy";

describe("buildMemberJoinedCopy", () => {
  it("role assigned + seated", () => {
    const copy = buildMemberJoinedCopy({
      firstName: "Sarah",
      roleName: "Operator",
      wasSeated: true,
    });
    expect(copy.title).toBe("Sarah joined your crew");
    expect(copy.body).toBe("Sarah is on as Operator. Seated and ready.");
    expect(copy.persistent).toBe(false);
    expect(copy.actionLabel).toBe("VIEW MEMBER");
  });

  it("role assigned + unseated", () => {
    const copy = buildMemberJoinedCopy({
      firstName: "Sarah",
      roleName: "Operator",
      wasSeated: false,
    });
    expect(copy.title).toBe("Sarah joined your crew");
    expect(copy.body).toBe(
      "Sarah is on as Operator. Unseated — shift seats or upgrade to give them access."
    );
    expect(copy.persistent).toBe(true);
    expect(copy.actionLabel).toBe("VIEW MEMBER");
  });

  it("no role + seated", () => {
    const copy = buildMemberJoinedCopy({
      firstName: "Sarah",
      roleName: null,
      wasSeated: true,
    });
    expect(copy.title).toBe("Sarah needs a role");
    expect(copy.body).toBe("Sarah joined your crew. Tap to assign a role.");
    expect(copy.persistent).toBe(true);
    expect(copy.actionLabel).toBe("ASSIGN ROLE");
  });

  it("no role + unseated", () => {
    const copy = buildMemberJoinedCopy({
      firstName: "Sarah",
      roleName: null,
      wasSeated: false,
    });
    expect(copy.title).toBe("Sarah needs a role");
    expect(copy.body).toBe(
      "Sarah joined your crew. Unseated — assign a role and free up a seat."
    );
    expect(copy.persistent).toBe(true);
    expect(copy.actionLabel).toBe("ASSIGN ROLE");
  });

  it("treats 'unassigned' role as no role", () => {
    const copy = buildMemberJoinedCopy({
      firstName: "Sarah",
      roleName: "unassigned",
      wasSeated: true,
    });
    expect(copy.title).toBe("Sarah needs a role");
  });
});
