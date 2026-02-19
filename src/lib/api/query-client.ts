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
import { BubbleApiError, BubbleUnauthorizedError } from "./bubble-client";

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

  // Calendar Events
  calendar: {
    all: ["calendar"] as const,
    lists: () => [...queryKeys.calendar.all, "list"] as const,
    list: (companyId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.calendar.lists(), companyId, filters] as const,
    dateRange: (companyId: string, start: string, end: string) =>
      [...queryKeys.calendar.lists(), companyId, start, end] as const,
    details: () => [...queryKeys.calendar.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.calendar.details(), id] as const,
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
  },

  // Payments
  payments: {
    all: ["payments"] as const,
    invoicePayments: (invoiceId: string) =>
      [...queryKeys.payments.all, "invoice", invoiceId] as const,
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

  // Company Settings
  companySettings: {
    all: ["companySettings"] as const,
    detail: (companyId: string) =>
      [...queryKeys.companySettings.all, companyId] as const,
  },

  // Gmail
  gmailConnections: {
    all: ["gmailConnections"] as const,
    list: (companyId: string) =>
      [...queryKeys.gmailConnections.all, companyId] as const,
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
  if (error instanceof BubbleUnauthorizedError && onUnauthorized) {
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
          // Don't retry auth errors
          if (error instanceof BubbleUnauthorizedError) return false;
          // Don't retry 4xx errors (except 429)
          if (
            error instanceof BubbleApiError &&
            error.statusCode !== null &&
            error.statusCode >= 400 &&
            error.statusCode < 500 &&
            error.statusCode !== 429
          ) {
            return false;
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
