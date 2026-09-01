import "server-only";

import {
  createSupabaseArtifactReadRepository,
  type ArtifactReadRepository,
} from "./artifacts/artifact-repository";
import {
  createSupabaseTeamAvailabilityRepository,
  type TeamAvailabilityRepository,
} from "./availability/availability-repository";
import {
  createSupabaseCatalogReadRepository,
  type CatalogReadRepository,
} from "./catalog/catalog-repository";
import {
  createSupabaseCompanyContextRepository,
  type CompanyContextRepository,
} from "./company/company-repository";
import {
  createSupabaseCustomerContextRepository,
  type CustomerContextRepository,
} from "./customer/customer-context-repository";
import {
  createSupabaseDeckGeometryReadRepository,
  type DeckGeometryReadRepository,
} from "./deck-design/deck-geometry-repository";
import {
  createSupabaseExpenseReadRepository,
  type ExpenseReadRepository,
} from "./expenses/expense-repository";
import {
  createSupabaseIntegrationHealthRepository,
  type IntegrationHealthRepository,
} from "./integrations/integration-repository";
import {
  createSupabaseOperationalOverviewRepository,
  type OperationalOverviewRepository,
} from "./overview/overview-repository";
import {
  createSupabasePaymentReadRepository,
  type PaymentReadRepository,
} from "./payments/payment-repository";
import {
  createSupabasePurchaseOrderReadRepository,
  type PurchaseOrderReadRepository,
} from "./purchasing/purchase-order-repository";
import {
  createSupabaseSalesDocumentReadRepository,
  type SalesDocumentReadRepository,
} from "./sales/sales-repository";
import {
  createSupabaseSiteVisitReadRepository,
  type SiteVisitReadRepository,
} from "./site-visits/site-visit-repository";
import {
  createSupabaseTaskReadRepository,
  type TaskReadRepository,
} from "./tasks/task-repository";
import {
  createSupabaseTeamDirectoryRepository,
  type TeamDirectoryRepository,
} from "./team/team-repository";
import {
  createWorkQueueRepository,
  type WorkQueueRepository,
} from "./work-queue/work-queue-repository";

declare const TRUSTED_OPS_AGENT_P2_REPOSITORIES: unique symbol;
const TRUSTED_REPOSITORY_GRAPHS = new WeakSet<object>();

interface TrustedOpsAgentP2RepositoriesBrand {
  readonly [TRUSTED_OPS_AGENT_P2_REPOSITORIES]: true;
}

export interface OpsAgentP2RpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface OpsAgentP2Repositories extends TrustedOpsAgentP2RepositoriesBrand {
  readonly customer: CustomerContextRepository;
  readonly tasks: TaskReadRepository;
  readonly artifacts: ArtifactReadRepository;
  readonly siteVisits: SiteVisitReadRepository;
  readonly deckDesign: DeckGeometryReadRepository;
  readonly sales: SalesDocumentReadRepository;
  readonly payments: PaymentReadRepository;
  readonly expenses: ExpenseReadRepository;
  readonly workQueue: WorkQueueRepository;
  readonly catalog: CatalogReadRepository;
  readonly purchasing: PurchaseOrderReadRepository;
  readonly company: CompanyContextRepository;
  readonly team: TeamDirectoryRepository;
  readonly availability: TeamAvailabilityRepository;
  readonly integrations: IntegrationHealthRepository;
  readonly overview: OperationalOverviewRepository;
}

/**
 * Mints the complete P2 repository graph from one fixed RPC transport. The
 * graph is nominal so callers cannot replace one repository with a structural
 * lookalike after composition.
 */
export function createSupabaseOpsAgentP2Repositories(
  client: OpsAgentP2RpcClient
): OpsAgentP2Repositories {
  let rpc: OpsAgentP2RpcClient["rpc"] | undefined;
  try {
    rpc = (client as OpsAgentP2RpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A P2 RPC client is required");
  }
  if (typeof rpc !== "function") {
    throw new TypeError("A P2 RPC client is required");
  }
  const stableClient: OpsAgentP2RpcClient = Object.freeze({
    rpc(
      functionName: string,
      args: Readonly<Record<string, unknown>>
    ): PromiseLike<{ readonly data: unknown; readonly error: unknown }> {
      return Reflect.apply(rpc, client, [functionName, args]);
    },
  });

  const repositories = {
    customer: createSupabaseCustomerContextRepository(stableClient),
    tasks: createSupabaseTaskReadRepository(stableClient),
    artifacts: createSupabaseArtifactReadRepository(stableClient),
    siteVisits: createSupabaseSiteVisitReadRepository(stableClient),
    deckDesign: createSupabaseDeckGeometryReadRepository(stableClient),
    sales: createSupabaseSalesDocumentReadRepository(stableClient),
    payments: createSupabasePaymentReadRepository(stableClient),
    expenses: createSupabaseExpenseReadRepository(stableClient),
    workQueue: createWorkQueueRepository(stableClient),
    catalog: createSupabaseCatalogReadRepository(stableClient),
    purchasing: createSupabasePurchaseOrderReadRepository(stableClient),
    company: createSupabaseCompanyContextRepository(stableClient),
    team: createSupabaseTeamDirectoryRepository(stableClient),
    availability: createSupabaseTeamAvailabilityRepository(stableClient),
    integrations: createSupabaseIntegrationHealthRepository(stableClient),
    overview: createSupabaseOperationalOverviewRepository(stableClient),
  };
  TRUSTED_REPOSITORY_GRAPHS.add(repositories);
  return Object.freeze(repositories) as OpsAgentP2Repositories;
}

export function isTrustedOpsAgentP2Repositories(
  value: unknown
): value is OpsAgentP2Repositories {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORY_GRAPHS.has(value)
  );
}
