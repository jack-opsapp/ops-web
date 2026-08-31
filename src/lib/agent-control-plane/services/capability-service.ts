import "server-only";

import {
  isTrustedDayCloseoutService,
  type DayCloseoutService,
} from "./day-closeout/day-closeout-service";
import {
  isTrustedOpsAgentReadCatalogueService,
  type OpsAgentReadCatalogueService,
} from "./read-catalogue-service";

const TRUSTED_CAPABILITY_SERVICES = new WeakSet<object>();

export type OpsAgentCapabilityService = OpsAgentReadCatalogueService &
  DayCloseoutService;

export function createOpsAgentCapabilityService(input: {
  readonly reads: OpsAgentReadCatalogueService;
  readonly dayCloseout: DayCloseoutService;
}): OpsAgentCapabilityService {
  if (!isTrustedOpsAgentReadCatalogueService(input.reads)) {
    throw new TypeError("A trusted OPS read catalogue is required");
  }
  if (!isTrustedDayCloseoutService(input.dayCloseout)) {
    throw new TypeError("A trusted day-closeout service is required");
  }
  const service = Object.freeze({ ...input.reads, ...input.dayCloseout });
  TRUSTED_CAPABILITY_SERVICES.add(service);
  return service;
}

export function isTrustedOpsAgentCapabilityService(
  value: unknown
): value is OpsAgentCapabilityService {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_CAPABILITY_SERVICES.has(value)
  );
}
