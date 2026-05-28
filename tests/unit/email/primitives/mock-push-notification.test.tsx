import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { MockPushNotification } from "@/lib/email/react/primitives/MockPushNotification";

describe("MockPushNotification", () => {
  it("renders the real dispatchTaskCompleted format", async () => {
    // Must match notification-dispatch.ts:200-201:
    //   title: "Task Completed"
    //   body:  `${completedByName} completed "${taskTitle}" on ${projectTitle}`
    const html = await render(
      <MockPushNotification
        completedByName="Jake"
        taskTitle="Rail Install"
        projectTitle="5611 Batu Rd"
      />,
    );
    expect(html).toContain("Task Completed");
    expect(html).toContain(`Jake completed &quot;Rail Install&quot; on 5611 Batu Rd`);
  });

  it("renders the sender name (OPS) and a 'now' timestamp", async () => {
    const html = await render(
      <MockPushNotification
        completedByName="Jake"
        taskTitle="Rail Install"
        projectTitle="5611 Batu Rd"
      />,
    );
    expect(html).toContain("OPS");
    expect(html).toContain("now");
  });
});
