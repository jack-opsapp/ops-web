// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/settings/integrations-tab.tsx"),
  "utf8"
);

describe("IntegrationsTab email signature placement", () => {
  it("renders signature settings for each connected mailbox", () => {
    expect(source).toContain(
      'import { EmailSignatureSettings } from "./email-signature-settings";'
    );
    expect(source).toMatch(
      /signatureConnections\.map\(\(conn\)[\s\S]*?<EmailSignatureSettings[\s\S]*?connectionId=\{conn\.id\}/
    );
    expect(source).toContain(
      'c.type === "company" || c.userId === currentUser?.id'
    );
    expect(source).toContain("id={`email-signature-${conn.id}`}");
  });
});
