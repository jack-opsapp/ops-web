import {
  GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  LIST_JOB_ARTIFACTS_CANDIDATE,
} from "./artifacts";
import { LIST_TEAM_AVAILABILITY_CANDIDATE } from "./availability";
import {
  GET_CATALOG_ITEM_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
} from "./catalog";
import { COMPANY_CONTEXT_CANDIDATE } from "./company";
import { CUSTOMER_CONTEXT_CANDIDATE } from "./customer-context";
import { GET_DECK_DESIGN_GEOMETRY_CANDIDATE } from "./deck-design";
import {
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
} from "./expenses";
import { GET_INTEGRATION_HEALTH_CANDIDATE } from "./integrations";
import { GET_OPERATIONAL_OVERVIEW_CANDIDATE } from "./overview";
import { LIST_PAYMENTS_CANDIDATE } from "./payments";
import {
  GET_PURCHASE_ORDER_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
} from "./purchasing";
import {
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
} from "./sales";
import {
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
} from "./site-visits";
import { GET_TASK_CONTEXT_CANDIDATE, LIST_TASKS_CANDIDATE } from "./tasks";
import { LIST_TEAM_MEMBERS_CANDIDATE } from "./team";
import { LIST_WORK_QUEUE_CANDIDATE } from "./work-queue";

export { RESERVED_P2_MANIFEST_REVISION } from "./candidate-policy";

/**
 * Final v8 order for the twenty-three independently proven P2 reads. Entries
 * are reused by identity so integration cannot remint a semantically similar
 * policy with different nominal bytes.
 */
export const P2_READ_CAPABILITY_CANDIDATES = Object.freeze([
  CUSTOMER_CONTEXT_CANDIDATE,
  LIST_TASKS_CANDIDATE,
  GET_TASK_CONTEXT_CANDIDATE,
  LIST_JOB_ARTIFACTS_CANDIDATE,
  GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  GET_DECK_DESIGN_GEOMETRY_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_PAYMENTS_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_WORK_QUEUE_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
  GET_CATALOG_ITEM_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
  GET_PURCHASE_ORDER_CANDIDATE,
  COMPANY_CONTEXT_CANDIDATE,
  LIST_TEAM_MEMBERS_CANDIDATE,
  LIST_TEAM_AVAILABILITY_CANDIDATE,
  GET_INTEGRATION_HEALTH_CANDIDATE,
  GET_OPERATIONAL_OVERVIEW_CANDIDATE,
] as const);

export const P2_READ_CAPABILITY_IDS = Object.freeze([
  "get_customer_context",
  "list_tasks",
  "get_task_context",
  "list_job_artifacts",
  "get_job_artifact_evidence",
  "list_site_visits",
  "get_site_visit_context",
  "get_deck_design_geometry",
  "list_sales_documents",
  "get_sales_document",
  "list_payments",
  "list_expenses",
  "get_expense_context",
  "list_work_queue",
  "search_catalog_items",
  "get_catalog_item",
  "list_purchase_orders",
  "get_purchase_order",
  "get_company_context",
  "list_team_members",
  "list_team_availability",
  "get_integration_health",
  "get_operational_overview",
] as const);

export type P2ReadCapabilityId = (typeof P2_READ_CAPABILITY_IDS)[number];
