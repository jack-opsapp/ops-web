import "server-only";

import {
  McpOAuthStoreError,
  resolveCanaryBinding,
  type ClientRow,
  type McpOAuthRpcClient,
} from "./grants";
import {
  MCP_CONSENT_CATALOG_V1,
  MCP_CONSENT_CATALOG_V2,
  MCP_CONSENT_CATALOG_V9,
} from "./scope-catalog";
import {
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V14,
  resolveActiveMcpExposure,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V3,
  type McpExposure,
} from "../../registry/mcp-exposure-catalog";

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function clientMatchesExposure(
  client: ClientRow,
  exposure: McpExposure,
  consentCatalogRevision: string
): boolean {
  return (
    !client.disabled &&
    client.exposure_revision === exposure.revision &&
    client.consent_catalog_revision === consentCatalogRevision &&
    arraysEqual(client.scope_ceiling, exposure.grantableScopes) &&
    client.scope === exposure.grantableScopes.join(" ")
  );
}

/**
 * Resolve OAuth authority from immutable server state. Inactive v3 clients
 * never fall back to the public active exposure when their exact binding is
 * absent or unavailable.
 */
export async function resolveOAuthExposureForSubject(input: {
  readonly rpcClient: McpOAuthRpcClient;
  readonly client: ClientRow;
  readonly userId: string;
  readonly companyId: string;
}): Promise<McpExposure | null> {
  const active = resolveActiveMcpExposure();
  if (
    active === MCP_EXPOSURE_V14 &&
    !input.client.disabled &&
    input.client.exposure_revision === active.revision &&
    input.client.consent_catalog_revision === MCP_CONSENT_CATALOG_V9.revision &&
    input.client.scope_ceiling.length > 0 &&
    arraysEqual(
      input.client.scope_ceiling,
      active.grantableScopes.filter((scope) =>
        input.client.scope_ceiling.includes(scope)
      )
    ) &&
    input.client.scope === input.client.scope_ceiling.join(" ")
  )
    return active;

  if (
    clientMatchesExposure(
      input.client,
      MCP_EXPOSURE_V1,
      MCP_CONSENT_CATALOG_V1.revision
    )
  )
    return MCP_EXPOSURE_V1;

  if (
    clientMatchesExposure(
      input.client,
      MCP_EXPOSURE_V2,
      MCP_CONSENT_CATALOG_V1.revision
    )
  ) {
    return MCP_EXPOSURE_V2;
  }

  if (
    !clientMatchesExposure(
      input.client,
      MCP_EXPOSURE_V3,
      MCP_CONSENT_CATALOG_V2.revision
    )
  ) {
    return null;
  }

  try {
    const binding = await resolveCanaryBinding(input.rpcClient, {
      clientId: input.client.client_id,
      userId: input.userId,
      companyId: input.companyId,
      exposureRevision: input.client.exposure_revision,
      consentCatalogRevision: input.client.consent_catalog_revision,
    });
    if (
      binding === null ||
      binding.exposure_revision !== input.client.exposure_revision ||
      binding.consent_catalog_revision !== input.client.consent_catalog_revision
    ) {
      return null;
    }

    const expiresAt = new Date(binding.expires_at);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return MCP_EXPOSURE_V3;
  } catch (error) {
    if (error instanceof McpOAuthStoreError) return null;
    throw error;
  }
}
