import { describe, expect, it } from "vitest";

import {
  CONNECTED_AGENT_SCOPE_LABELS,
  connectedAgentScopeLine,
} from "@/components/settings/connected-agent-scope-labels";
import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import { mcpScopeConsentLabel } from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

describe("Connected Agents scope labels", () => {
  it("mirrors every active consent label byte-for-byte", () => {
    const activeScopes = resolveActiveMcpExposure().grantableScopes;

    expect(activeScopes).toHaveLength(20);
    expect(Object.keys(CONNECTED_AGENT_SCOPE_LABELS)).toEqual(activeScopes);
    expect(CONNECTED_AGENT_SCOPE_LABELS).toEqual(
      Object.fromEntries(
        activeScopes.map((scope) => [scope, mcpScopeConsentLabel(scope)])
      )
    );
  });

  it("summarizes a full v2 grant with approved language and no raw scope codes", () => {
    const activeScopes = resolveActiveMcpExposure().grantableScopes;
    const summary = connectedAgentScopeLine(activeScopes);

    for (const scope of activeScopes) {
      const label = mcpScopeConsentLabel(scope);
      expect(label).not.toBeNull();
      expect(summary).toContain(label);
      expect(summary).not.toContain(scope);
    }
    expect(summary.split(" · ")).toHaveLength(20);
  });

  it("keeps an unknown scope visible instead of hiding unexpected authority", () => {
    expect(connectedAgentScopeLine(["ops.future.read"])).toBe(
      "ops.future.read"
    );
  });
});
