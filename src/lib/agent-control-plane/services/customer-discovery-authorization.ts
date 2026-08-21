import "server-only";

import type { AuthorizedCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { ParsedSearchCustomersInput } from "@/lib/agent-control-plane/contracts/discovery";
import { authorizeTask13CapabilityReadInternal } from "./customer-jobs-authorization";

const CAPABILITY_ID = "search_customers" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_CUSTOMER_DISCOVERY_READ: unique symbol;

export interface AuthorizedCustomerDiscoveryRead {
  readonly [AUTHORIZED_CUSTOMER_DISCOVERY_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly clientsScope: "all" | "assigned";
  readonly query: ParsedSearchCustomersInput;
}

export function authorizeCustomerDiscoveryRead(input: {
  readonly authorization: AuthorizedCapability;
  readonly rawInput: unknown;
}): AuthorizedCustomerDiscoveryRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedSearchCustomersInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "customer_discovery",
    authorizations: input.authorization,
    rawInput: input.rawInput,
  });
  const clientsScope = base.resolvedPermissions["clients.view"];
  if (clientsScope !== "all" && clientsScope !== "assigned") {
    throw authorizationInternal(
      base.actorContext.requestId,
      "customer_discovery_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    clientsScope,
    query: base.query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedCustomerDiscoveryRead;
}

export function isAuthorizedCustomerDiscoveryRead(
  value: unknown
): value is AuthorizedCustomerDiscoveryRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
