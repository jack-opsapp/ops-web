// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  join(process.cwd(), "src/components/settings/profile-tab.tsx"),
  "utf8"
);
const integrationsSource = readFileSync(
  join(process.cwd(), "src/components/settings/integrations-tab.tsx"),
  "utf8"
);

describe("ProfileTab email signature placement", () => {
  it("renders signature settings only for the actor-authorized mailbox list", () => {
    expect(profileSource).toContain(
      'import { EmailSignatureSettings } from "./email-signature-settings";'
    );
    expect(profileSource).toContain("useEmailSignatureConnections");
    expect(profileSource).toMatch(
      /signatureConnections\.map\(\(conn\)[\s\S]*?<EmailSignatureSettings[\s\S]*?connectionId=\{conn\.id\}/
    );
    expect(profileSource).toContain("id={`email-signature-${conn.id}`}");
    expect(profileSource).toContain('searchParams.get("connection")');
  });

  it("keeps signature self-service out of company integration administration", () => {
    expect(integrationsSource).not.toContain("<EmailSignatureSettings");
    expect(integrationsSource).not.toContain("signatureConnections.map");
  });
});
