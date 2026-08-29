import "server-only";

import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  ActorAccessError,
  authorizationInternal,
} from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type {
  GetCatalogItemInput,
  GetPurchaseOrderInput,
  ListPurchaseOrdersInput,
  SearchCatalogItemsInput,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import type {
  CompanyContextInput,
  GetIntegrationHealthInput,
  ListTeamAvailabilityInput,
  ListTeamMembersInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import type { CustomerContextInput } from "@/lib/agent-control-plane/contracts/customer-context";
import type { DeckDesignGeometryInput } from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import type {
  GetExpenseContextInput,
  ListExpensesInput,
} from "@/lib/agent-control-plane/contracts/expenses";
import type {
  GetJobArtifactEvidenceInput,
  JobArtifactListInput,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import type { GetOperationalOverviewInput } from "@/lib/agent-control-plane/contracts/operational-overview";
import type {
  GetSalesDocumentInput,
  ListPaymentsInput,
  ListSalesDocumentsInput,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import type {
  GetSiteVisitContextInput,
  ListSiteVisitsInput,
} from "@/lib/agent-control-plane/contracts/site-visits";
import type {
  GetTaskContextInput,
  ListTasksInput,
} from "@/lib/agent-control-plane/contracts/tasks";
import type { ListWorkQueueInput } from "@/lib/agent-control-plane/contracts/work-queue";
import {
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  P2_READ_CAPABILITY_IDS,
  type P2ReadCapabilityId,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2";
import { selectedDeckDesignGeometryVariantKeys } from "@/lib/agent-control-plane/registry/read-capabilities/p2/deck-design";
import type { DomainCallOptions } from "../domain-service";
import { authorizeGetJobArtifactEvidenceRead } from "./artifacts/artifact-authorization";
import { authorizeListJobArtifactsRead } from "./artifacts/artifact-authorization";
import { createArtifactListCursorService } from "./artifacts/artifact-cursor";
import {
  getJobArtifactEvidence as readJobArtifactEvidence,
  listJobArtifacts as readJobArtifacts,
} from "./artifacts/artifact-reads";
import { authorizeTeamAvailabilityRead } from "./availability/availability-authorization";
import { createTeamAvailabilityCursorService } from "./availability/availability-cursor";
import { listTeamAvailability as readTeamAvailability } from "./availability/availability-reads";
import {
  authorizeGetCatalogItemRead,
  authorizeSearchCatalogItemsRead,
} from "./catalog/catalog-authorization";
import { createCatalogCursorService } from "./catalog/catalog-cursor";
import {
  getCatalogItem as readCatalogItem,
  searchCatalogItems as readCatalogItems,
} from "./catalog/catalog-reads";
import { authorizeCompanyContextRead } from "./company/company-authorization";
import { getCompanyContext as readCompanyContext } from "./company/get-company-context";
import { authorizeCustomerContextRead } from "./customer/customer-context-authorization";
import { getCustomerContext as readCustomerContext } from "./customer/get-customer-context";
import { authorizeDeckDesignGeometryRead } from "./deck-design/deck-geometry-authorization";
import { getDeckDesignGeometry as readDeckDesignGeometry } from "./deck-design/deck-geometry-reads";
import {
  authorizeGetExpenseContextRead,
  authorizeListExpensesRead,
} from "./expenses/expense-authorization";
import { createExpenseCursorService } from "./expenses/expense-cursor";
import {
  getExpenseContext as readExpenseContext,
  listExpenses as readExpenses,
} from "./expenses/expense-reads";
import { authorizeIntegrationHealthRead } from "./integrations/integration-authorization";
import { getIntegrationHealth as readIntegrationHealth } from "./integrations/get-integration-health";
import { getOperationalOverview as readOperationalOverview } from "./overview/get-operational-overview";
import { authorizeOperationalOverviewRead } from "./overview/overview-authorization";
import { authorizeListPaymentsRead } from "./payments/payment-authorization";
import { createPaymentCursorService } from "./payments/payment-cursor";
import { listPayments as readPayments } from "./payments/payment-reads";
import {
  authorizeGetPurchaseOrderRead,
  authorizeListPurchaseOrdersRead,
} from "./purchasing/purchase-order-authorization";
import { createPurchaseOrderCursorService } from "./purchasing/purchase-order-cursor";
import {
  getPurchaseOrder as readPurchaseOrder,
  listPurchaseOrders as readPurchaseOrders,
} from "./purchasing/purchase-order-reads";
import {
  isTrustedOpsAgentP2Repositories,
  type OpsAgentP2Repositories,
} from "./repositories";
import {
  authorizeGetSalesDocumentRead,
  authorizeListSalesDocumentsRead,
} from "./sales/sales-authorization";
import { createSalesDocumentCursorService } from "./sales/sales-cursor";
import {
  getSalesDocument as readSalesDocument,
  listSalesDocuments as readSalesDocuments,
} from "./sales/sales-reads";
import {
  authorizeGetSiteVisitContextRead,
  authorizeListSiteVisitsRead,
} from "./site-visits/site-visit-authorization";
import { createSiteVisitListCursorService } from "./site-visits/site-visit-cursor";
import {
  getSiteVisitContext as readSiteVisitContext,
  listSiteVisits as readSiteVisits,
} from "./site-visits/site-visit-reads";
import {
  authorizeGetTaskContextRead,
  authorizeListTasksRead,
} from "./tasks/task-authorization";
import { createTaskListCursorService } from "./tasks/task-cursor";
import {
  getTaskContext as readTaskContext,
  listTasks as readTasks,
} from "./tasks/task-reads";
import { authorizeTeamDirectoryRead } from "./team/team-authorization";
import { createTeamDirectoryCursorService } from "./team/team-cursor";
import { listTeamMembers as readTeamMembers } from "./team/team-reads";
import { authorizeWorkQueueRead } from "./work-queue/work-queue-authorization";
import { createWorkQueueCursorService } from "./work-queue/work-queue-cursor";
import { listWorkQueue as readWorkQueue } from "./work-queue/work-queue-reads";

const TRUSTED_P2_DOMAIN_SERVICES = new WeakSet<object>();
const P2_CAPABILITY_IDS = P2_READ_CAPABILITY_IDS;

export interface P2CursorKey {
  readonly keyId: string;
  readonly key: Uint8Array;
}

export interface OpsAgentP2DomainService {
  getCustomerContext(
    actorContext: ActorContext,
    input: CustomerContextInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readCustomerContext>;
  listTasks(
    actorContext: ActorContext,
    input: ListTasksInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readTasks>;
  getTaskContext(
    actorContext: ActorContext,
    input: GetTaskContextInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readTaskContext>;
  listJobArtifacts(
    actorContext: ActorContext,
    input: JobArtifactListInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readJobArtifacts>;
  getJobArtifactEvidence(
    actorContext: ActorContext,
    input: GetJobArtifactEvidenceInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readJobArtifactEvidence>;
  listSiteVisits(
    actorContext: ActorContext,
    input: ListSiteVisitsInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readSiteVisits>;
  getSiteVisitContext(
    actorContext: ActorContext,
    input: GetSiteVisitContextInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readSiteVisitContext>;
  getDeckDesignGeometry(
    actorContext: ActorContext,
    input: DeckDesignGeometryInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readDeckDesignGeometry>;
  listSalesDocuments(
    actorContext: ActorContext,
    input: ListSalesDocumentsInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readSalesDocuments>;
  getSalesDocument(
    actorContext: ActorContext,
    input: GetSalesDocumentInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readSalesDocument>;
  listPayments(
    actorContext: ActorContext,
    input: ListPaymentsInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readPayments>;
  listExpenses(
    actorContext: ActorContext,
    input: ListExpensesInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readExpenses>;
  getExpenseContext(
    actorContext: ActorContext,
    input: GetExpenseContextInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readExpenseContext>;
  listWorkQueue(
    actorContext: ActorContext,
    input: ListWorkQueueInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readWorkQueue>;
  searchCatalogItems(
    actorContext: ActorContext,
    input: SearchCatalogItemsInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readCatalogItems>;
  getCatalogItem(
    actorContext: ActorContext,
    input: GetCatalogItemInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readCatalogItem>;
  listPurchaseOrders(
    actorContext: ActorContext,
    input: ListPurchaseOrdersInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readPurchaseOrders>;
  getPurchaseOrder(
    actorContext: ActorContext,
    input: GetPurchaseOrderInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readPurchaseOrder>;
  getCompanyContext(
    actorContext: ActorContext,
    input: CompanyContextInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readCompanyContext>;
  listTeamMembers(
    actorContext: ActorContext,
    input: ListTeamMembersInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readTeamMembers>;
  listTeamAvailability(
    actorContext: ActorContext,
    input: ListTeamAvailabilityInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readTeamAvailability>;
  getIntegrationHealth(
    actorContext: ActorContext,
    input: GetIntegrationHealthInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readIntegrationHealth>;
  getOperationalOverview(
    actorContext: ActorContext,
    input: GetOperationalOverviewInput,
    options?: DomainCallOptions
  ): ReturnType<typeof readOperationalOverview>;
}

interface P2AuthorizationBinding {
  readonly query: Readonly<Record<string, unknown>>;
  readonly authorizations: Readonly<Record<string, unknown>>;
}

function isNominalAlternativeDenial(error: unknown): error is ActorAccessError {
  return (
    error instanceof ActorAccessError &&
    (error.code === "FORBIDDEN" || error.code === "INSUFFICIENT_SCOPE")
  );
}

function bindP2Authorization(
  capabilityId: P2ReadCapabilityId,
  actorContext: ActorContext,
  input: unknown
): P2AuthorizationBinding {
  if (!isActorContext(actorContext)) {
    throw authorizationInternal(
      "unknown-request",
      "p2_domain_actor_context_untrusted"
    );
  }
  const resolved = resolveCapabilityAuthorization(capabilityId, input);
  if (
    resolved.capability.name !== capabilityId ||
    resolved.capability.operation !== "read" ||
    resolved.capability.availability.implementation !== "available" ||
    resolved.variants.length === 0
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "p2_domain_capability_unavailable"
    );
  }

  if (capabilityId === "get_deck_design_geometry") {
    const selection = selectedDeckDesignGeometryVariantKeys(
      resolved.parsedInput as DeckDesignGeometryInput
    );
    const variantsByKey = new Map(
      resolved.variants.map((variant) => [variant.key, variant] as const)
    );
    const declaredKeys = [
      ...selection.required,
      ...selection.alternatives.flat(),
    ];
    const declaredKeySet = new Set<string>(declaredKeys);
    if (
      selection.alternatives.some((alternative) => alternative.length === 0) ||
      declaredKeySet.size !== declaredKeys.length ||
      declaredKeys.length !== resolved.variants.length ||
      declaredKeys.some((key) => !variantsByKey.has(key)) ||
      resolved.variants.some((variant) => !declaredKeySet.has(variant.key))
    ) {
      throw authorizationInternal(
        actorContext.requestId,
        "p2_domain_authorization_selection_invalid"
      );
    }

    const authorizationEntries: [string, unknown][] = [];
    for (const key of selection.required) {
      authorizationEntries.push([
        key,
        authorizeCapability({
          actorContext,
          policy: variantsByKey.get(key)!.policy,
        }),
      ]);
    }

    let firstAlternativeDenial: ActorAccessError | undefined;
    for (const alternative of selection.alternatives) {
      const alternativeEntries: [string, unknown][] = [];
      try {
        for (const key of alternative) {
          alternativeEntries.push([
            key,
            authorizeCapability({
              actorContext,
              policy: variantsByKey.get(key)!.policy,
            }),
          ]);
        }
      } catch (error) {
        if (!isNominalAlternativeDenial(error)) throw error;
        firstAlternativeDenial ??= error;
        continue;
      }
      authorizationEntries.push(...alternativeEntries);
    }
    if (authorizationEntries.length === 0) {
      if (firstAlternativeDenial) throw firstAlternativeDenial;
      throw authorizationInternal(
        actorContext.requestId,
        "p2_domain_authorization_alternative_missing"
      );
    }

    return Object.freeze({
      query: resolved.parsedInput,
      authorizations: Object.freeze(Object.fromEntries(authorizationEntries)),
    });
  }

  return Object.freeze({
    query: resolved.parsedInput,
    authorizations: Object.freeze(
      Object.fromEntries(
        resolved.variants.map((variant) => [
          variant.key,
          authorizeCapability({ actorContext, policy: variant.policy }),
        ])
      )
    ),
  });
}

function assertP2ManifestAvailable(): void {
  for (const capabilityId of P2_CAPABILITY_IDS) {
    const capability = getCapabilityManifestEntry(capabilityId);
    if (
      capability.operation !== "read" ||
      capability.availability.implementation !== "available"
    ) {
      throw new TypeError("The complete P2 read catalogue is required");
    }
  }
}

export function createOpsAgentP2DomainService(input: {
  readonly repositories: OpsAgentP2Repositories;
  readonly cursorKey: P2CursorKey;
}): OpsAgentP2DomainService {
  const repositories = input?.repositories;
  const rawCursorKey = input?.cursorKey;
  if (!isTrustedOpsAgentP2Repositories(repositories)) {
    throw new TypeError("Trusted P2 repositories are required");
  }
  let keyId: unknown;
  let key: unknown;
  try {
    keyId = rawCursorKey?.keyId;
    key = rawCursorKey?.key;
  } catch {
    throw new TypeError("An exact P2 cursor key is required");
  }
  if (
    typeof keyId !== "string" ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(keyId) ||
    !(key instanceof Uint8Array) ||
    key.byteLength !== 32
  ) {
    throw new TypeError("An exact P2 cursor key is required");
  }
  assertP2ManifestAvailable();

  const cursorKey = {
    keyId,
    key: Uint8Array.from(key),
  };
  const cursors = Object.freeze({
    tasks: createTaskListCursorService(cursorKey),
    artifacts: createArtifactListCursorService(cursorKey),
    siteVisits: createSiteVisitListCursorService(cursorKey),
    sales: createSalesDocumentCursorService(cursorKey),
    payments: createPaymentCursorService(cursorKey),
    expenses: createExpenseCursorService(cursorKey),
    workQueue: createWorkQueueCursorService(cursorKey),
    catalog: createCatalogCursorService(cursorKey),
    purchasing: createPurchaseOrderCursorService(cursorKey),
    team: createTeamDirectoryCursorService(cursorKey),
    availability: createTeamAvailabilityCursorService(cursorKey),
  });

  const getCustomerContext: OpsAgentP2DomainService["getCustomerContext"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_customer_context",
        actorContext,
        domainInput
      );
      return await readCustomerContext({
        authorization: authorizeCustomerContextRead(binding),
        repository: repositories.customer,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const listTasks: OpsAgentP2DomainService["listTasks"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_tasks",
      actorContext,
      domainInput
    );
    return await readTasks({
      authorization: authorizeListTasksRead(binding),
      repository: repositories.tasks,
      cursors: cursors.tasks,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const getTaskContext: OpsAgentP2DomainService["getTaskContext"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "get_task_context",
      actorContext,
      domainInput
    );
    return await readTaskContext({
      authorization: authorizeGetTaskContextRead(binding),
      repository: repositories.tasks,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const listJobArtifacts: OpsAgentP2DomainService["listJobArtifacts"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_job_artifacts",
      actorContext,
      domainInput
    );
    return await readJobArtifacts({
      authorization: authorizeListJobArtifactsRead(binding),
      repository: repositories.artifacts,
      cursors: cursors.artifacts,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const getJobArtifactEvidence: OpsAgentP2DomainService["getJobArtifactEvidence"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_job_artifact_evidence",
        actorContext,
        domainInput
      );
      return await readJobArtifactEvidence({
        authorization: authorizeGetJobArtifactEvidenceRead(binding),
        repository: repositories.artifacts,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const listSiteVisits: OpsAgentP2DomainService["listSiteVisits"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_site_visits",
      actorContext,
      domainInput
    );
    return await readSiteVisits({
      authorization: authorizeListSiteVisitsRead(binding),
      repository: repositories.siteVisits,
      cursors: cursors.siteVisits,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const getSiteVisitContext: OpsAgentP2DomainService["getSiteVisitContext"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_site_visit_context",
        actorContext,
        domainInput
      );
      return await readSiteVisitContext({
        authorization: authorizeGetSiteVisitContextRead(binding),
        repository: repositories.siteVisits,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getDeckDesignGeometry: OpsAgentP2DomainService["getDeckDesignGeometry"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_deck_design_geometry",
        actorContext,
        domainInput
      );
      return await readDeckDesignGeometry({
        authorization: authorizeDeckDesignGeometryRead(binding),
        repository: repositories.deckDesign,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const listSalesDocuments: OpsAgentP2DomainService["listSalesDocuments"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "list_sales_documents",
        actorContext,
        domainInput
      );
      return await readSalesDocuments({
        authorization: authorizeListSalesDocumentsRead(binding),
        repository: repositories.sales,
        cursors: cursors.sales,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getSalesDocument: OpsAgentP2DomainService["getSalesDocument"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "get_sales_document",
      actorContext,
      domainInput
    );
    return await readSalesDocument({
      authorization: authorizeGetSalesDocumentRead(binding),
      repository: repositories.sales,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const listPayments: OpsAgentP2DomainService["listPayments"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_payments",
      actorContext,
      domainInput
    );
    return await readPayments({
      authorization: authorizeListPaymentsRead(binding),
      repository: repositories.payments,
      cursors: cursors.payments,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const listExpenses: OpsAgentP2DomainService["listExpenses"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_expenses",
      actorContext,
      domainInput
    );
    return await readExpenses({
      authorization: authorizeListExpensesRead(binding),
      repository: repositories.expenses,
      cursors: cursors.expenses,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const getExpenseContext: OpsAgentP2DomainService["getExpenseContext"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_expense_context",
        actorContext,
        domainInput
      );
      return await readExpenseContext({
        authorization: authorizeGetExpenseContextRead(binding),
        repository: repositories.expenses,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const listWorkQueue: OpsAgentP2DomainService["listWorkQueue"] = async (
    actorContext,
    domainInput,
    options
  ) =>
    await readWorkQueue({
      authorization: authorizeWorkQueueRead({
        actorContext,
        query: domainInput,
      }),
      repository: repositories.workQueue,
      cursors: cursors.workQueue,
      ...(options?.signal ? { signal: options.signal } : {}),
    });

  const searchCatalogItems: OpsAgentP2DomainService["searchCatalogItems"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "search_catalog_items",
        actorContext,
        domainInput
      );
      return await readCatalogItems({
        authorization: authorizeSearchCatalogItemsRead(binding),
        repository: repositories.catalog,
        cursors: cursors.catalog,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getCatalogItem: OpsAgentP2DomainService["getCatalogItem"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "get_catalog_item",
      actorContext,
      domainInput
    );
    return await readCatalogItem({
      authorization: authorizeGetCatalogItemRead(binding),
      repository: repositories.catalog,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const listPurchaseOrders: OpsAgentP2DomainService["listPurchaseOrders"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "list_purchase_orders",
        actorContext,
        domainInput
      );
      return await readPurchaseOrders({
        authorization: authorizeListPurchaseOrdersRead(binding),
        repository: repositories.purchasing,
        cursors: cursors.purchasing,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getPurchaseOrder: OpsAgentP2DomainService["getPurchaseOrder"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "get_purchase_order",
      actorContext,
      domainInput
    );
    return await readPurchaseOrder({
      authorization: authorizeGetPurchaseOrderRead(binding),
      repository: repositories.purchasing,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const getCompanyContext: OpsAgentP2DomainService["getCompanyContext"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_company_context",
        actorContext,
        domainInput
      );
      return await readCompanyContext({
        authorization: authorizeCompanyContextRead(binding),
        repository: repositories.company,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const listTeamMembers: OpsAgentP2DomainService["listTeamMembers"] = async (
    actorContext,
    domainInput,
    options
  ) => {
    const binding = bindP2Authorization(
      "list_team_members",
      actorContext,
      domainInput
    );
    return await readTeamMembers({
      authorization: authorizeTeamDirectoryRead(binding),
      repository: repositories.team,
      cursors: cursors.team,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  };

  const listTeamAvailability: OpsAgentP2DomainService["listTeamAvailability"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "list_team_availability",
        actorContext,
        domainInput
      );
      return await readTeamAvailability({
        authorization: authorizeTeamAvailabilityRead(binding),
        repository: repositories.availability,
        cursors: cursors.availability,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getIntegrationHealth: OpsAgentP2DomainService["getIntegrationHealth"] =
    async (actorContext, domainInput, options) => {
      const binding = bindP2Authorization(
        "get_integration_health",
        actorContext,
        domainInput
      );
      return await readIntegrationHealth({
        authorization: authorizeIntegrationHealthRead(binding),
        repository: repositories.integrations,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    };

  const getOperationalOverview: OpsAgentP2DomainService["getOperationalOverview"] =
    async (actorContext, domainInput, options) =>
      await readOperationalOverview({
        authorization: authorizeOperationalOverviewRead({
          actorContext,
          query: domainInput,
        }),
        repository: repositories.overview,
        ...(options?.signal ? { signal: options.signal } : {}),
      });

  const service = {
    getCustomerContext,
    listTasks,
    getTaskContext,
    listJobArtifacts,
    getJobArtifactEvidence,
    listSiteVisits,
    getSiteVisitContext,
    getDeckDesignGeometry,
    listSalesDocuments,
    getSalesDocument,
    listPayments,
    listExpenses,
    getExpenseContext,
    listWorkQueue,
    searchCatalogItems,
    getCatalogItem,
    listPurchaseOrders,
    getPurchaseOrder,
    getCompanyContext,
    listTeamMembers,
    listTeamAvailability,
    getIntegrationHealth,
    getOperationalOverview,
  } satisfies OpsAgentP2DomainService;
  TRUSTED_P2_DOMAIN_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedOpsAgentP2DomainService(
  value: unknown
): value is OpsAgentP2DomainService {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_P2_DOMAIN_SERVICES.has(value)
  );
}
