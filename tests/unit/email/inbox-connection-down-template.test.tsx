import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { InboxConnectionDown } from "@/lib/email/react/templates/InboxConnectionDown";

const baseProps = {
  companyName: "Canpro",
  inboxAddress: "owner@example.com",
  hoursSilent: 18,
  reconnectUrl: "https://ops.test/reconnect-inbox",
};

describe("inbox connection health email", () => {
  it("tells an active stale mailbox that OPS processing is delayed without prescribing reconnect", async () => {
    const text = await render(
      <InboxConnectionDown {...baseProps} reason="sync_stale" />,
      { plainText: true }
    );
    const compact = text.replace(/\s+/g, " ");

    expect(compact.toLowerCase()).toContain("inbox processing is delayed.");
    expect(compact).toContain(
      "Your inbox is still connected. OPS has not processed recent mail. Automatic retry is active. You do not need to reconnect."
    );
    expect(compact).toContain("Processing delayed");
    expect(compact).toContain("Open inbox settings");
    expect(compact).not.toContain("Reconnect inbox");
    expect(compact).not.toContain("connection is down");
  });

  it("keeps reconnect as the direct remedy for an expired provider connection", async () => {
    const text = await render(
      <InboxConnectionDown {...baseProps} reason="webhook_expired" />,
      { plainText: true }
    );
    const compact = text.replace(/\s+/g, " ");

    expect(compact.toLowerCase()).toContain(
      "your inbox stopped feeding leads to ops."
    );
    expect(compact).toContain("Reconnect inbox");
  });
});
