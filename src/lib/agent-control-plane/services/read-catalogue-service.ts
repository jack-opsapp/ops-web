import "server-only";

import { isTrustedOpsAgentDomainService } from "./create-domain-service";
import type { OpsAgentDomainService } from "./domain-service";
import {
  isTrustedOpsAgentP2DomainService,
  type OpsAgentP2DomainService,
} from "./p2/domain-service";

const TRUSTED_READ_CATALOGUE_SERVICES = new WeakSet<object>();

export type OpsAgentReadCatalogueService = OpsAgentDomainService &
  OpsAgentP2DomainService;

/**
 * Joins the frozen production-v1 facade and the independently nominal P2
 * facade. The merge cannot add policy or repository ports: it only exposes
 * the already-authorized domain methods in canonical manifest order.
 */
export function createOpsAgentReadCatalogueService(input: {
  readonly currentProduction: OpsAgentDomainService;
  readonly p2: OpsAgentP2DomainService;
}): OpsAgentReadCatalogueService {
  const currentProduction = input?.currentProduction;
  const p2 = input?.p2;
  if (!isTrustedOpsAgentDomainService(currentProduction)) {
    throw new TypeError("A trusted production domain service is required");
  }
  if (!isTrustedOpsAgentP2DomainService(p2)) {
    throw new TypeError("A trusted P2 domain service is required");
  }

  const service = { ...currentProduction, ...p2 };
  TRUSTED_READ_CATALOGUE_SERVICES.add(service);
  return Object.freeze(service) as OpsAgentReadCatalogueService;
}

export function isTrustedOpsAgentReadCatalogueService(
  value: unknown
): value is OpsAgentReadCatalogueService {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_READ_CATALOGUE_SERVICES.has(value)
  );
}
