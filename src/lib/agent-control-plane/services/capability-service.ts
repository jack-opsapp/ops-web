import "server-only";

import {
  isTrustedDayCloseoutService,
  type DayCloseoutService,
} from "./day-closeout/day-closeout-service";
import {
  isTrustedCollectionsService,
  type CollectionsService,
} from "./collections/collections-service";
import {
  isTrustedHiringWhatIfService,
  type HiringWhatIfService,
} from "./hiring-what-if/hiring-what-if-service";
import {
  isTrustedPromiseRecoveryService,
  type PromiseRecoveryService,
} from "./promise-recovery/promise-recovery-service";
import {
  isTrustedOpsAgentReadCatalogueService,
  type OpsAgentReadCatalogueService,
} from "./read-catalogue-service";

const TRUSTED_CAPABILITY_SERVICES = new WeakSet<object>();

export type OpsAgentCapabilityService = OpsAgentReadCatalogueService &
  DayCloseoutService &
  CollectionsService &
  HiringWhatIfService &
  PromiseRecoveryService;

export function createOpsAgentCapabilityService(input: {
  readonly reads: OpsAgentReadCatalogueService;
  readonly dayCloseout: DayCloseoutService;
  readonly collections: CollectionsService;
  readonly hiringWhatIf: HiringWhatIfService;
  readonly promiseRecovery: PromiseRecoveryService;
}): OpsAgentCapabilityService {
  if (!isTrustedOpsAgentReadCatalogueService(input.reads)) {
    throw new TypeError("A trusted OPS read catalogue is required");
  }
  if (!isTrustedDayCloseoutService(input.dayCloseout)) {
    throw new TypeError("A trusted day-closeout service is required");
  }
  if (!isTrustedCollectionsService(input.collections)) {
    throw new TypeError("A trusted collections service is required");
  }
  if (!isTrustedHiringWhatIfService(input.hiringWhatIf)) {
    throw new TypeError("A trusted hiring analysis service is required");
  }
  if (!isTrustedPromiseRecoveryService(input.promiseRecovery)) {
    throw new TypeError("A trusted promise-recovery service is required");
  }
  const service = Object.freeze({
    ...input.reads,
    ...input.dayCloseout,
    ...input.collections,
    ...input.hiringWhatIf,
    ...input.promiseRecovery,
  });
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
