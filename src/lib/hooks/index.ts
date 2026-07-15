/**
 * OPS Web - Hooks Barrel Export
 */

// Projects
export {
  useProjects,
  useUserProjects,
  useScopedProjects,
  useProject,
  useCreateProject,
  useUpdateProject,
  useUpdateProjectStatus,
  useDeleteProject,
} from "./use-projects";

// Tasks
export {
  useTasks,
  useProjectTasks,
  useTask,
  useScheduledTasks,
  useCreateTask,
  useCreateTaskWithEvent,
  useUpdateTask,
  useUpdateTaskStatus,
  useDeleteTask,
  useReorderTasks,
} from "./use-tasks";

// Recurrences (Phase 3)
export {
  useRecurrences,
  useRecurrence,
  useRecurrenceExceptions,
  useCreateRecurrence,
  useUpdateRecurrence,
  useSoftDeleteRecurrence,
  useUpsertRecurrenceException,
} from "./use-recurrences";
export { useRecurrenceEdit } from "./use-recurrence-edit";
export type { RecurrenceEditInput } from "./use-recurrence-edit";

// Clients
export {
  useClients,
  useClientMap,
  useClient,
  useSubClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useCreateSubClient,
  useUpdateSubClient,
  useDeleteSubClient,
} from "./use-clients";
export {
  useClientOutstandingMap,
  useClientFinancials,
  useClientActivity,
} from "./use-client-financials";
export type {
  ClientOutstanding,
  ClientOutstandingResult,
  ClientFinancials,
  ClientActivityEvent,
  ClientActivityKind,
  ClientActivityResult,
} from "./use-client-financials";

// Users / Team
export {
  useTeamMembers,
  useUser,
  useCurrentUser,
  useUpdateUser,
  useUpdateUserRole,
  useDeactivateUser,
  useReactivateUser,
  useMarkTutorialCompleted,
  useSendInvite,
  useResetPassword,
  useJoinCompany,
} from "./use-users";

// Team Invitations
export {
  usePendingInvitations,
  useUpdateInvitationRole,
  useRevokeInvitation,
} from "./use-invitations";

// Company
export {
  useCompany,
  useCompanyById,
  useSubscriptionInfo,
  useUpdateCompany,
  useCompleteSubscription,
  useCancelSubscription,
  useAddSeatedEmployee,
  useRemoveSeatedEmployee,
} from "./use-company";

// Subscription Add-ons
export { useAddOns, useAddOnPrices } from "./use-addons";
export type {
  AddOnsState,
  DataSetupState,
  PrioritySupportState,
  DataSetupStatus,
  AddOnPriceMap,
} from "./use-addons";

// Calendar (deprecated — site visit hooks only)
// New calendar data flows through useScheduledTasks in ./use-tasks.ts

// Task Types
export {
  useTaskTypes,
  useTaskType,
  useCreateTaskType,
  useUpdateTaskType,
  useDeleteTaskType,
} from "./use-task-types";

// Image Upload
export { useImageUpload, useMultiImageUpload } from "./use-image-upload";

// Connectivity
export { useConnectivity } from "./use-connectivity";

// Products
export {
  useProducts,
  useProduct,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "./use-products";

// Catalog lookups (categories + units; read + inline-create writes)
export {
  useCatalogLookups,
  resolveCategoryId,
  resolveUnitId,
  useCreateCatalogCategory,
  useCreateCatalogUnit,
} from "./use-catalog-lookups";
export type {
  CatalogCategoryLookup,
  CatalogUnitLookup,
} from "./use-catalog-lookups";

// Estimates
export {
  useEstimates,
  useProjectEstimates,
  useEstimate,
  useCreateEstimate,
  useUpdateEstimate,
  useDeleteEstimate,
  useSendEstimate,
  useConvertEstimateToInvoice,
} from "./use-estimates";

// Invoices
export {
  useInvoiceLineItems,
  useInvoices,
  useProjectInvoices,
  useInvoice,
  useCreateInvoice,
  useUpdateInvoice,
  useDeleteInvoice,
  useSendInvoice,
  useVoidInvoice,
  useRecordPayment,
  useVoidPayment,
} from "./use-invoices";

// Opportunities (Pipeline)
export {
  useOpportunities,
  useOpportunity,
  useCreateOpportunity,
  useUpdateOpportunity,
  useAttachClientToOpportunity,
  useConvertOpportunityToProject,
  useLinkOpportunityToExistingProject,
  useConversionPreflight,
  useMoveOpportunityStage,
  useDeleteOpportunity,
  useArchiveOpportunity,
  useUnarchiveOpportunity,
  useOpportunityActivities,
  useCreateActivity,
  useOpportunityFollowUps,
  useCreateFollowUp,
  useCompleteFollowUp,
  useStageTransitions,
  useAddOpportunityImages,
  useRemoveOpportunityImage,
} from "./use-opportunities";
export { useOpportunityDeckDesigns } from "./use-opportunity-deck-designs";

// Accounting
export {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useUpdateSyncEnabled,
  useUpdateSyncMode,
  useTriggerSync,
  useSyncHistory,
  useAccountingSyncIssues,
} from "./use-accounting";
export * from "./use-qbo-import";

// Task Templates
export {
  useTaskTemplates,
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
  useDeleteTaskTemplate,
  useProposedTasks,
} from "./use-task-templates";

// Activity Comments
export {
  useActivityComments,
  useCreateActivityComment,
  useDeleteActivityComment,
} from "./use-activity-comments";

// Site Visits
export {
  useSiteVisits,
  useSiteVisit,
  useCreateSiteVisit,
  useStartSiteVisit,
  useCompleteSiteVisit,
  useCancelSiteVisit,
} from "./use-site-visits";

// Project Photos
export {
  useProjectPhotos,
  useCreateProjectPhoto,
  useDeleteProjectPhoto,
} from "./use-project-photos";

// Company Settings
export {
  useCompanySettings,
  useUpdateCompanySettings,
} from "./use-company-settings";

// Expense Settings
export {
  useExpenseSettings,
  useUpdateExpenseSettings,
} from "./use-expense-settings";

// Expense Approval (batches, flagging, approval, payout, auto-approve rules)
export {
  useAllExpenses,
  useExpenseBatches,
  useBatchExpenses,
  useFlagExpense,
  useUnflagExpense,
  useApproveBatch,
  useEarlyClearLine,
  useMarkBatchPaid,
  useUnmarkBatchPaid,
  useRejectWithRevisions,
  useQuickRejectBatch,
  useAutoApproveRules,
  useCreateAutoApproveRule,
  useToggleAutoApproveRule,
  useDeleteAutoApproveRule,
} from "./use-expense-approval";
export { useExpenseRealtime } from "./use-expense-realtime";

// Notification Preferences
export {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "./use-notification-preferences";

// Gmail Connections
export {
  useGmailConnections,
  useUpdateGmailConnection,
  useDeleteGmailConnection,
  useTriggerGmailSync,
} from "./use-gmail-connections";

// Email signatures
export {
  useEmailSignature,
  useSaveEmailSignature,
  useImportProviderEmailSignature,
} from "./use-email-signature";

// Gmail Import
export { useGmailImport, useImportHistory } from "./use-gmail-import";

// Gmail Sync Notifications
export { useGmailSyncNotifications } from "./use-gmail-sync-notifications";

// Roles & Permissions
export {
  useRoles,
  useRolePermissions,
  useRoleMembers,
  useAllUserRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useUpdateRolePermissions,
  useDuplicateRole,
  useAssignUserRole,
  useRemoveUserRole,
} from "./use-roles";
export { useMemberAccess, useSaveMemberAccess } from "./use-member-access";

// Portal — Client-facing hooks (session cookie auth, no useAuthStore)
export { portalKeys, portalFetch, usePortalData } from "./use-portal-data";
export {
  usePortalEstimate,
  useApproveEstimate,
  useDeclineEstimate,
} from "./use-portal-estimate";
export {
  usePortalInvoice,
  useCreatePaymentIntent,
} from "./use-portal-invoice";
export { usePortalProject } from "./use-portal-project";
export {
  usePortalMessages,
  useSendPortalMessage,
} from "./use-portal-messages";
export {
  usePortalQuestions,
  useSubmitPortalAnswers,
} from "./use-portal-questions";

// Crew Locations (real-time map tracking)
export { useCrewLocations } from "./use-crew-locations";

// Bug Reports
export {
  useBugReports,
  useBugReport,
  useCreateBugReport,
  useUpdateBugReportStatus,
  useUpdateBugReportPriority,
  useUpdateBugReport,
} from "./use-bug-reports";

// Cascade Preview
export { useCascade } from "./use-cascade";

// Smart Insert
export { useSmartInsert } from "./use-smart-insert";

// Page Title
export { usePageTitle } from "./use-page-title";

// Intel Graph (Galaxy Visualization)
export {
  useIntelGraph,
  type IntelEntity,
  type IntelEdge,
  type IntelVoiceProfile,
  type IntelGraphData,
} from "./use-intel-graph";

export {
  useIntelEntity,
  type IntelFact,
  type IntelKnowledgeEdge,
  type IntelEntityDetail,
} from "./use-intel-entity";

// Duplicate Reviews
export {
  useDuplicateReviews,
  useMergeDuplicate,
  useMergeConflicts,
  useDismissDuplicate,
  type DuplicateCluster,
  type GroupedClusters,
  type EnrichedEntity,
  type MergeConflictsResult,
  type ConflictSelections,
  type ConfirmedOverrides,
  type FieldConflict,
} from "./use-duplicate-reviews";

// Metrics
export {
  useInvoiceMetrics,
  useProjectMetrics,
  usePipelineMetrics,
  useEstimateMetrics,
  useAccountingMetrics,
  useInventoryMetrics,
  useClientMetrics,
  useTeamMetrics,
  useProductMetrics,
  useJobBoardMetrics,
  useScheduleMetrics,
  useMapMetrics,
  useInboxMetrics,
} from "./use-metrics";

// Books (ledger instrument strip)
export { useBooksLedger } from "./use-books";

// Approval Queue (agent actions)
export {
  useApprovalQueue,
  useApprovalQueueStats,
  useApprovalQueuePendingCount,
  useApproveAction,
  useRejectAction,
  useBulkApprove,
  useBulkReject,
  useCancelAction,
} from "./use-approval-queue";

// Product-Inventory Bridge
export { useProductMaterials, useSetProductBom } from "./use-product-materials";
export {
  useProductOptions,
  useProductOptionValues,
  useCreateProductOption,
  useUpdateProductOption,
  useReorderProductOptions,
  useDeleteProductOption,
  useCreateProductOptionValue,
  useUpdateProductOptionValue,
  useReorderProductOptionValues,
  useDeleteProductOptionValue,
} from "./use-product-options";
export {
  useProductPricingModifiers,
  useCreateProductPricingModifier,
  useUpdateProductPricingModifier,
  useDeleteProductPricingModifier,
} from "./use-product-pricing-modifiers";
export { useTaskMaterials, useSetTaskMaterials } from "./use-task-materials";
export { useLineItemMaterials, useSetLineItemMaterials } from "./use-line-item-materials";
export { useProjectDeductions, useTaskDeductions } from "./use-inventory-deductions";
export { useStockIndicator } from "./use-stock-indicator";
