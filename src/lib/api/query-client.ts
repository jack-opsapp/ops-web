/**
 * OPS Web - TanStack Query Client Configuration
 *
 * Configured with defaults for:
 * - staleTime: 2 minutes (data considered fresh)
 * - gcTime: 10 minutes (garbage collection)
 * - retry: 2 retries with exponential backoff
 * - refetchOnWindowFocus: true (re-sync when user returns)
 */

import { QueryClient } from "@tanstack/react-query";

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const queryKeys = {
  // Projects
  projects: {
    all: ["projects"] as const,
    lists: () => [...queryKeys.projects.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.projects.lists(), companyId, filters] as const,
    userList: (userId: string, companyId: string) =>
      [...queryKeys.projects.lists(), "user", userId, companyId] as const,
    tableRows: (params: Record<string, unknown>) =>
      [...queryKeys.projects.all, "tableRows", params] as const,
    tableViews: (companyId: string, userId: string) =>
      [...queryKeys.projects.all, "tableViews", companyId, userId] as const,
    tableTeam: (projectId: string) =>
      [...queryKeys.projects.all, "tableTeam", projectId] as const,
    tableTeamMembers: (companyId: string) =>
      [...queryKeys.projects.all, "tableTeamMembers", companyId] as const,
    tablePhotos: (projectId: string) =>
      [...queryKeys.projects.all, "tablePhotos", projectId] as const,
    details: () => [...queryKeys.projects.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },

  // Opportunities (Supabase pipeline)
  opportunities: {
    all: ["opportunities"] as const,
    lists: () => [...queryKeys.opportunities.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.opportunities.lists(), companyId, filters] as const,
    details: () => [...queryKeys.opportunities.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.opportunities.details(), id] as const,
    activities: (opportunityId: string) =>
      [...queryKeys.opportunities.all, "activities", opportunityId] as const,
    followUps: (opportunityId: string) =>
      [...queryKeys.opportunities.all, "followUps", opportunityId] as const,
    stageTransitions: (opportunityId: string) =>
      [...queryKeys.opportunities.all, "stageTransitions", opportunityId] as const,
    stageConfigs: (companyId: string) =>
      [...queryKeys.opportunities.all, "stageConfigs", companyId] as const,
    tableViews: (companyId: string, userId: string) =>
      [...queryKeys.opportunities.all, "tableViews", companyId, userId] as const,
  },

  // Tasks
  tasks: {
    all: ["tasks"] as const,
    lists: () => [...queryKeys.tasks.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.tasks.lists(), companyId, filters] as const,
    projectTasks: (projectId: string) =>
      [...queryKeys.tasks.lists(), "project", projectId] as const,
    details: () => [...queryKeys.tasks.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.tasks.details(), id] as const,
  },

  // Clients
  clients: {
    all: ["clients"] as const,
    lists: () => [...queryKeys.clients.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.clients.lists(), companyId, filters] as const,
    details: () => [...queryKeys.clients.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.clients.details(), id] as const,
    subClients: (clientId: string) =>
      [...queryKeys.clients.all, "subClients", clientId] as const,
  },

  // Users
  users: {
    all: ["users"] as const,
    lists: () => [...queryKeys.users.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.users.lists(), companyId, filters] as const,
    details: () => [...queryKeys.users.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
    current: () => [...queryKeys.users.all, "current"] as const,
  },

  // Company
  company: {
    all: ["company"] as const,
    detail: (id: string) => [...queryKeys.company.all, id] as const,
    subscription: (id: string) =>
      [...queryKeys.company.all, "subscription", id] as const,
  },

  // Calendar (reads from tasks — calendar_events table is deprecated)
  calendar: {
    all: ["calendar"] as const,
    lists: () => [...queryKeys.calendar.all, "list"] as const,
    scheduled: (companyId: string, start: string, end: string, scopedUserId = "") =>
      [...queryKeys.calendar.lists(), "scheduled", companyId, start, end, scopedUserId] as const,
    // Phase 3 — recurring task templates and exceptions
    recurrences: (companyId: string) =>
      [...queryKeys.calendar.all, "recurrences", companyId] as const,
    recurrence: (id: string) =>
      [...queryKeys.calendar.all, "recurrence", id] as const,
    recurrenceExceptions: (recurrenceId: string) =>
      [...queryKeys.calendar.all, "recurrence-exceptions", recurrenceId] as const,
  },

  // Task Types
  taskTypes: {
    all: ["taskTypes"] as const,
    list: (companyId: string) =>
      [...queryKeys.taskTypes.all, companyId] as const,
    detail: (id: string) =>
      [...queryKeys.taskTypes.all, "detail", id] as const,
  },

  // Products
  products: {
    all: ["products"] as const,
    lists: () => [...queryKeys.products.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.products.lists(), companyId, filters] as const,
    details: () => [...queryKeys.products.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.products.details(), id] as const,
  },

  // Estimates
  estimates: {
    all: ["estimates"] as const,
    lists: () => [...queryKeys.estimates.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.estimates.lists(), companyId, filters] as const,
    projectEstimates: (projectId: string) =>
      [...queryKeys.estimates.lists(), "project", projectId] as const,
    details: () => [...queryKeys.estimates.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.estimates.details(), id] as const,
  },

  // Invoices
  invoices: {
    all: ["invoices"] as const,
    lists: () => [...queryKeys.invoices.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.invoices.lists(), companyId, filters] as const,
    projectInvoices: (projectId: string) =>
      [...queryKeys.invoices.lists(), "project", projectId] as const,
    details: () => [...queryKeys.invoices.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.invoices.details(), id] as const,
    lineItems: (companyId: string) => [...queryKeys.invoices.all, "lineItems", companyId] as const,
  },

  // Payments
  payments: {
    all: ["payments"] as const,
    invoicePayments: (invoiceId: string) =>
      [...queryKeys.payments.all, "invoice", invoiceId] as const,
  },

  // Metrics (tab-level aggregated metrics)
  metrics: {
    all: ["metrics"] as const,
    tab: (tabId: string, companyId: string) =>
      [...queryKeys.metrics.all, tabId, companyId] as const,
  },

  // Accounting
  accounting: {
    all: ["accounting"] as const,
    connections: (companyId: string) =>
      [...queryKeys.accounting.all, "connections", companyId] as const,
    syncHistory: (companyId: string) =>
      [...queryKeys.accounting.all, "syncHistory", companyId] as const,
  },

  // Task Templates
  taskTemplates: {
    all: ["taskTemplates"] as const,
    lists: () => [...queryKeys.taskTemplates.all, "list"] as const,
    list: (companyId: string, taskTypeId?: string) =>
      [...queryKeys.taskTemplates.lists(), companyId, taskTypeId] as const,
    detail: (id: string) =>
      [...queryKeys.taskTemplates.all, "detail", id] as const,
    proposed: (estimateId: string) =>
      [...queryKeys.taskTemplates.all, "proposed", estimateId] as const,
  },

  // Activity Comments
  activityComments: {
    all: ["activityComments"] as const,
    byActivity: (activityId: string) =>
      [...queryKeys.activityComments.all, activityId] as const,
  },

  // Site Visits
  siteVisits: {
    all: ["siteVisits"] as const,
    lists: () => [...queryKeys.siteVisits.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.siteVisits.lists(), companyId, filters] as const,
    detail: (id: string) =>
      [...queryKeys.siteVisits.all, "detail", id] as const,
  },

  // Project Photos
  projectPhotos: {
    all: ["projectPhotos"] as const,
    byProject: (projectId: string) =>
      [...queryKeys.projectPhotos.all, projectId] as const,
  },

  // Project Notes
  projectNotes: {
    all: ["projectNotes"] as const,
    byProject: (projectId: string) =>
      [...queryKeys.projectNotes.all, projectId] as const,
  },

  // Project Workspace — workspace-modal scoped reads
  projectWorkspace: {
    all: ["projectWorkspace"] as const,
    activity: (projectId: string | null, limit: number) =>
      [...queryKeys.projectWorkspace.all, "activity", projectId, limit] as const,
    pipeline: (projectId: string | null) =>
      [...queryKeys.projectWorkspace.all, "pipeline", projectId] as const,
    ledger: (projectId: string | null) =>
      [...queryKeys.projectWorkspace.all, "ledger", projectId] as const,
    tasksGrouped: (projectId: string | null) =>
      [...queryKeys.projectWorkspace.all, "tasksGrouped", projectId] as const,
    team: (projectId: string | null) =>
      [...queryKeys.projectWorkspace.all, "team", projectId] as const,
    weather: (projectId: string | null) =>
      [...queryKeys.projectWorkspace.all, "weather", projectId] as const,
  },

  // Company Settings
  companySettings: {
    all: ["companySettings"] as const,
    detail: (companyId: string) =>
      [...queryKeys.companySettings.all, companyId] as const,
  },

  // Expense Settings
  expenseSettings: {
    all: ["expenseSettings"] as const,
    detail: (companyId: string) =>
      [...queryKeys.expenseSettings.all, companyId] as const,
  },

  // Expense Approval (batches, line items, auto-approve rules)
  expenseBatches: {
    all: ["expenseBatches"] as const,
    lists: () => [...queryKeys.expenseBatches.all, "list"] as const,
    list: (companyId: string) =>
      [...queryKeys.expenseBatches.lists(), companyId] as const,
    details: () => [...queryKeys.expenseBatches.all, "detail"] as const,
    detail: (batchId: string) =>
      [...queryKeys.expenseBatches.details(), batchId] as const,
    expenses: (batchId: string) =>
      [...queryKeys.expenseBatches.all, "expenses", batchId] as const,
    allExpenses: (companyId: string) =>
      [...queryKeys.expenseBatches.all, "allExpenses", companyId] as const,
    autoApproveRules: (companyId: string) =>
      [...queryKeys.expenseBatches.all, "autoApproveRules", companyId] as const,
  },

  // Notifications
  notifications: {
    all: ["notifications"] as const,
    unread: (userId: string, companyId: string) =>
      [...queryKeys.notifications.all, "unread", userId, companyId] as const,
  },

  // Notification Preferences
  notificationPreferences: {
    all: ["notificationPreferences"] as const,
    detail: (userId: string, companyId: string) =>
      [...queryKeys.notificationPreferences.all, userId, companyId] as const,
  },

  // Dashboard Preferences (widget layout, map, scheduling)
  dashboardPreferences: {
    all: ["dashboardPreferences"] as const,
    detail: (userId: string, companyId: string) =>
      [...queryKeys.dashboardPreferences.all, userId, companyId] as const,
  },

  // Gmail (legacy — use emailConnections for new code)
  gmailConnections: {
    all: ["gmailConnections"] as const,
    list: (companyId: string) =>
      [...queryKeys.gmailConnections.all, companyId] as const,
  },

  // Email connections (provider-agnostic)
  emailConnections: {
    all: ["emailConnections"] as const,
    list: (companyId: string) =>
      [...queryKeys.emailConnections.all, companyId] as const,
  },

  // Inventory
  inventory: {
    all: ["inventory"] as const,
    items: {
      all: ["inventory", "items"] as const,
      lists: () => [...queryKeys.inventory.items.all, "list"] as const,
      list: (companyId: string, filters?: Record<string, unknown>) =>
        [...queryKeys.inventory.items.lists(), companyId, filters] as const,
      details: () => [...queryKeys.inventory.items.all, "detail"] as const,
      detail: (id: string) =>
        [...queryKeys.inventory.items.details(), id] as const,
    },
    units: {
      all: ["inventory", "units"] as const,
      lists: () => [...queryKeys.inventory.units.all, "list"] as const,
      list: (companyId: string) =>
        [...queryKeys.inventory.units.lists(), companyId] as const,
    },
    tags: {
      all: ["inventory", "tags"] as const,
      lists: () => [...queryKeys.inventory.tags.all, "list"] as const,
      list: (companyId: string) =>
        [...queryKeys.inventory.tags.lists(), companyId] as const,
    },
    itemTags: {
      all: ["inventory", "itemTags"] as const,
      lists: () => [...queryKeys.inventory.itemTags.all, "list"] as const,
      list: (companyId: string) =>
        [...queryKeys.inventory.itemTags.lists(), companyId] as const,
    },
    snapshots: {
      all: ["inventory", "snapshots"] as const,
      lists: () => [...queryKeys.inventory.snapshots.all, "list"] as const,
      list: (companyId: string) =>
        [...queryKeys.inventory.snapshots.lists(), companyId] as const,
      items: (snapshotId: string) =>
        [...queryKeys.inventory.snapshots.all, "items", snapshotId] as const,
    },
  },

  // Product Materials (BOM)
  productMaterials: {
    all: ["productMaterials"] as const,
    byProduct: (productId: string) =>
      [...queryKeys.productMaterials.all, productId] as const,
  },

  // Product Options + Option Values (configurable knobs)
  productOptions: {
    all: ["productOptions"] as const,
    byProduct: (productId: string) =>
      [...queryKeys.productOptions.all, productId] as const,
    valuesByProduct: (productId: string) =>
      [...queryKeys.productOptions.all, "values", productId] as const,
  },

  // Product Pricing Modifiers (rules)
  productPricingModifiers: {
    all: ["productPricingModifiers"] as const,
    byProduct: (productId: string) =>
      [...queryKeys.productPricingModifiers.all, productId] as const,
  },

  // Task Materials
  taskMaterials: {
    all: ["taskMaterials"] as const,
    byTask: (taskId: string) =>
      [...queryKeys.taskMaterials.all, taskId] as const,
  },

  // Line Item Materials (per-estimate overrides)
  lineItemMaterials: {
    all: ["lineItemMaterials"] as const,
    byLineItem: (lineItemId: string) =>
      [...queryKeys.lineItemMaterials.all, lineItemId] as const,
  },

  // Inventory Deductions
  inventoryDeductions: {
    all: ["inventoryDeductions"] as const,
    byProject: (projectId: string) =>
      [...queryKeys.inventoryDeductions.all, "project", projectId] as const,
    byTask: (taskId: string) =>
      [...queryKeys.inventoryDeductions.all, "task", taskId] as const,
  },

  // Stock Indicator
  stockIndicator: {
    all: ["stockIndicator"] as const,
    forLineItems: (lineItemIds: string[]) =>
      [...queryKeys.stockIndicator.all, ...[...lineItemIds].sort()] as const,
  },

  // Bug Reports
  bugReports: {
    all: ["bugReports"] as const,
    lists: () => [...queryKeys.bugReports.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.bugReports.lists(), companyId, filters] as const,
    details: () => [...queryKeys.bugReports.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.bugReports.details(), id] as const,
  },

  // Roles & Permissions
  roles: {
    all: ["roles"] as const,
    lists: () => [...queryKeys.roles.all, "list"] as const,
    list: (companyId: string) =>
      [...queryKeys.roles.lists(), companyId] as const,
    details: () => [...queryKeys.roles.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.roles.details(), id] as const,
    permissions: (roleId: string) =>
      [...queryKeys.roles.all, "permissions", roleId] as const,
    members: (roleId: string) =>
      [...queryKeys.roles.all, "members", roleId] as const,
    userRoles: (companyId: string) =>
      [...queryKeys.roles.all, "userRoles", companyId] as const,
    userPermissions: (userId: string) =>
      [...queryKeys.roles.all, "userPermissions", userId] as const,
  },
  // Team Invitations
  invitations: {
    all: ["invitations"] as const,
    lists: () => [...queryKeys.invitations.all, "list"] as const,
    list: (companyId: string) =>
      [...queryKeys.invitations.lists(), companyId] as const,
  },

  // Intel (Galaxy Visualization)
  intel: {
    all: ["intel"] as const,
    graph: (companyId: string) => [...queryKeys.intel.all, "graph", companyId] as const,
    entity: (entityId: string) => [...queryKeys.intel.all, "entity", entityId] as const,
  },

  // Email Templates
  emailTemplates: {
    all: ["emailTemplates"] as const,
    lists: () => [...queryKeys.emailTemplates.all, "list"] as const,
    list: (companyId: string) =>
      [...queryKeys.emailTemplates.lists(), companyId] as const,
    details: () => [...queryKeys.emailTemplates.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.emailTemplates.details(), id] as const,
  },

  // AI Drafting
  aiDrafting: {
    all: ["aiDrafting"] as const,
    stats: (companyId: string, userId: string) =>
      [...queryKeys.aiDrafting.all, "stats", companyId, userId] as const,
    pendingSends: (companyId: string) =>
      [...queryKeys.aiDrafting.all, "pendingSends", companyId] as const,
    autoSendSettings: (companyId: string, connectionId: string) =>
      [...queryKeys.aiDrafting.all, "autoSendSettings", companyId, connectionId] as const,
  },

  // Inbox (Email + Portal — unified)
  inbox: {
    all: ["inbox"] as const,
    pipelineThreads: (companyId: string) =>
      [...queryKeys.inbox.all, "pipeline", companyId] as const,
    allMail: (companyId: string, query?: string) =>
      [...queryKeys.inbox.all, "allMail", companyId, query] as const,
    threadMessages: (companyId: string, threadId: string) =>
      [...queryKeys.inbox.all, "thread", companyId, threadId] as const,
    unreadCount: (companyId: string) =>
      [...queryKeys.inbox.all, "unread", companyId] as const,
    // Portal message keys (unified inbox)
    portalConversations: (companyId: string) =>
      [...queryKeys.inbox.all, "portal-conversations", companyId] as const,
    portalMessages: (companyId: string, clientId: string) =>
      [...queryKeys.inbox.all, "portal-messages", companyId, clientId] as const,
    portalUnread: (companyId: string) =>
      [...queryKeys.inbox.all, "portal-unread", companyId] as const,
    // Inbox v2 — thread-based (email_threads table)
    threadsAll: () => [...queryKeys.inbox.all, "v2", "threads"] as const,
    threads: (params: Record<string, unknown>) =>
      [...queryKeys.inbox.all, "v2", "threads", params] as const,
    threadDetail: (threadId: string) =>
      [...queryKeys.inbox.all, "v2", "thread", threadId] as const,
    drafts: (scope: "own" | "company") =>
      [...queryKeys.inbox.all, "v2", "drafts", scope] as const,
    velocity: (scope: "own" | "company") =>
      [...queryKeys.inbox.all, "v2", "velocity", scope] as const,
  },

  // Approval Queue (agent actions)
  approvalQueue: {
    all: ["approvalQueue"] as const,
    lists: () => [...queryKeys.approvalQueue.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.approvalQueue.lists(), companyId, filters] as const,
    detail: (id: string) =>
      [...queryKeys.approvalQueue.all, "detail", id] as const,
    stats: (companyId: string) =>
      [...queryKeys.approvalQueue.all, "stats", companyId] as const,
    pendingCount: (companyId: string) =>
      [...queryKeys.approvalQueue.all, "pendingCount", companyId] as const,
  },

  // Duplicate Reviews
  duplicateReviews: {
    all: ["duplicateReviews"] as const,
    pending: (companyId: string) =>
      ["duplicateReviews", "pending", companyId] as const,
  },

  // Data Review Queue (P1 DW2 link-integrity residual — admin surface)
  dataReview: {
    all: ["dataReview"] as const,
    queue: () => ["dataReview", "queue"] as const,
  },
} as const;

// ─── Query Client ─────────────────────────────────────────────────────────────

// Global 401 handler — triggers logout on auth errors.
// Set by the QueryProvider after auth store is available.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

function handleGlobalError(error: unknown) {
  // Check for 401 responses to trigger logout
  if (
    error instanceof Error &&
    "status" in error &&
    (error as { status: number }).status === 401 &&
    onUnauthorized
  ) {
    onUnauthorized();
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data considered fresh for 2 minutes
        staleTime: 2 * 60 * 1000,

        // Garbage collection after 10 minutes
        gcTime: 10 * 60 * 1000,

        // Retry failed requests up to 2 times
        retry: (failureCount, error) => {
          // Don't retry auth errors (401)
          if (
            error instanceof Error &&
            "status" in error &&
            (error as { status: number }).status === 401
          ) return false;
          // Don't retry 4xx errors (except 429)
          if (
            error instanceof Error &&
            "status" in error
          ) {
            const status = (error as { status: number }).status;
            if (status >= 400 && status < 500 && status !== 429) return false;
          }
          return failureCount < 2;
        },

        // Exponential backoff for retries
        retryDelay: (attemptIndex) =>
          Math.min(1000 * 2 ** attemptIndex, 10000),

        // Re-fetch when window regains focus
        refetchOnWindowFocus: true,

        // Don't refetch on mount if data is fresh
        refetchOnMount: "always",

        // Don't refetch on reconnect automatically
        refetchOnReconnect: "always",
      },

      mutations: {
        // Don't retry mutations by default
        retry: false,
        onError: handleGlobalError,
      },
    },
  });
}

// Singleton query client
let queryClientInstance: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (!queryClientInstance) {
    queryClientInstance = createQueryClient();
  }
  return queryClientInstance;
}

export default getQueryClient;
