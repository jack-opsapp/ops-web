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

  it("reads the connect round-trip from the param the shell does not rewrite", () => {
    // The shell canonicalizes `?tab=integrations` → `?section=email` before this
    // tab mounts, so a `tab` check here would never see the connect.
    expect(integrationsSource).toContain('params.get("status") === "connected"');
    expect(integrationsSource).not.toContain('params.get("tab") === "integrations"');
    expect(integrationsSource).toContain('"/settings?section=email"');
  });

  it("asks for the sender identity after a connect, behind the import wizard", () => {
    expect(integrationsSource).toContain("<SenderIdentityConnectStep");
    // Two setups must not compete for the same moment: the import wizard runs
    // first, and the identity step opens as it closes.
    expect(integrationsSource).toContain("active={justConnected && !wizardOpen}");
  });
});
