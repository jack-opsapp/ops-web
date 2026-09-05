import type { ActorAuthorityRepository } from "../actor/authority-repository";
import {
  isActorContext,
  type ActorContext,
} from "../actor/resolve-actor-context";
import {
  CAPABILITY_MANIFEST_REVISION,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
} from "../registry/capability-manifest";
import { reauthorizeResolvedMcpActor } from "../mcp/actor-reauthorization";
import {
  isTrustedCustomerUpdateService,
  type CustomerUpdateService,
} from "./customer-update/customer-update-service";
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
  isTrustedSalesTruthService,
  type SalesTruthService,
} from "./sales-truth/sales-truth-service";
import {
  isTrustedPayrollReadinessService,
  type PayrollReadinessService,
} from "./payroll-readiness/payroll-readiness-service";
import {
  isTrustedRecurringServicePriceChangeService,
  type RecurringServicePriceChangeService,
} from "./recurring-service-price-change/recurring-service-price-change-service";
import {
  isTrustedEstimateDraftService,
  type EstimateDraftService,
} from "./estimate-draft/estimate-draft-service";
import {
  isTrustedWeatherRescheduleService,
  type WeatherRescheduleService,
} from "./weather-reschedule/weather-reschedule-service";
import {
  isTrustedCrewCalloutRecoveryService,
  type CrewCalloutRecoveryService,
} from "./crew-callout-recovery/crew-callout-recovery-service";
import {
  isTrustedDispatchConfirmationTaskService,
  type DispatchConfirmationTaskService,
} from "./dispatch-confirmation-task/dispatch-confirmation-task-service";
import {
  isTrustedOpsAgentReadCatalogueService,
  type OpsAgentReadCatalogueService,
} from "./read-catalogue-service";

const TRUSTED_CAPABILITY_SERVICES = new WeakSet<object>();

export type OpsAgentCapabilityService = OpsAgentReadCatalogueService &
  DayCloseoutService &
  CollectionsService &
  HiringWhatIfService &
  PromiseRecoveryService &
  SalesTruthService &
  PayrollReadinessService &
  RecurringServicePriceChangeService &
  EstimateDraftService &
  WeatherRescheduleService &
  CrewCalloutRecoveryService &
  DispatchConfirmationTaskService &
  CustomerUpdateService;

export function createOpsAgentCapabilityService(input: {
  readonly reads: OpsAgentReadCatalogueService;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly dayCloseout: DayCloseoutService;
  readonly collections: CollectionsService;
  readonly hiringWhatIf: HiringWhatIfService;
  readonly promiseRecovery: PromiseRecoveryService;
  readonly salesTruth: SalesTruthService;
  readonly payrollReadiness: PayrollReadinessService;
  readonly recurringServicePriceChange: RecurringServicePriceChangeService;
  readonly estimateDraft: EstimateDraftService;
  readonly weatherReschedule: WeatherRescheduleService;
  readonly crewCalloutRecovery: CrewCalloutRecoveryService;
  readonly customerUpdate: CustomerUpdateService;
  readonly dispatchConfirmationTask: DispatchConfirmationTaskService;
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
  if (!isTrustedSalesTruthService(input.salesTruth)) {
    throw new TypeError("A trusted sales-truth service is required");
  }
  if (!isTrustedPayrollReadinessService(input.payrollReadiness)) {
    throw new TypeError("A trusted payroll readiness service is required");
  }
  if (
    !isTrustedRecurringServicePriceChangeService(
      input.recurringServicePriceChange
    )
  ) {
    throw new TypeError(
      "A trusted recurring-service price-change service is required"
    );
  }
  if (!isTrustedEstimateDraftService(input.estimateDraft)) {
    throw new TypeError("A trusted estimate draft service is required");
  }
  if (!isTrustedWeatherRescheduleService(input.weatherReschedule)) {
    throw new TypeError("A trusted weather reschedule service is required");
  }
  if (!isTrustedCrewCalloutRecoveryService(input.crewCalloutRecovery)) {
    throw new TypeError("A trusted crew call-out recovery service is required");
  }
  if (
    !isTrustedDispatchConfirmationTaskService(input.dispatchConfirmationTask)
  ) {
    throw new TypeError(
      "A trusted dispatch confirmation task service is required"
    );
  }
  if (!isTrustedCustomerUpdateService(input.customerUpdate))
    throw new TypeError("A trusted customer update service is required");
  // Preserve the independently proven v8 read contracts under the additive v20
  // catalogue. Re-resolve the same principal and scope ceiling; never copy or
  // fabricate a nominal ActorContext or change prepare/commit authority.
  type ReadMethod = (
    actor: ActorContext,
    request: never,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
  const reads = Object.fromEntries(
    Object.entries(input.reads).map(([name, method]) => [
      name,
      async (
        actor: ActorContext,
        request: never,
        options?: { signal?: AbortSignal }
      ) => {
        const readActor = await reauthorizeCustomerUpdateReadActor(
          actor,
          input.authorityRepository,
          options?.signal
        );
        return (method as ReadMethod)(readActor, request, options);
      },
    ])
  ) as unknown as OpsAgentReadCatalogueService;
  const service = Object.freeze({
    ...reads,
    ...input.dayCloseout,
    ...input.collections,
    ...input.hiringWhatIf,
    ...input.promiseRecovery,
    ...input.salesTruth,
    ...input.payrollReadiness,
    ...input.recurringServicePriceChange,
    ...input.estimateDraft,
    ...input.weatherReschedule,
    ...input.crewCalloutRecovery,
    ...input.dispatchConfirmationTask,
    ...input.customerUpdate,
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

export async function reauthorizeCustomerUpdateReadActor(
  actor: ActorContext,
  authorityRepository: ActorAuthorityRepository,
  signal?: AbortSignal
): Promise<ActorContext> {
  if (
    !isActorContext(actor) ||
    actor.capabilityManifestRevision !==
      CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION
  )
    return actor;
  return reauthorizeResolvedMcpActor({
    actorContext: actor,
    authorityRepository,
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    signal,
  });
}
