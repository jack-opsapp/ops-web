/**
 * OPS Web - Hooks Barrel Export
 */

// Projects
export {
  useProjects,
  useUserProjects,
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
  useCreateTask,
  useCreateTaskWithEvent,
  useUpdateTask,
  useUpdateTaskStatus,
  useDeleteTask,
  useReorderTasks,
} from "./use-tasks";

// Clients
export {
  useClients,
  useClient,
  useSubClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useCreateSubClient,
  useUpdateSubClient,
  useDeleteSubClient,
} from "./use-clients";

// Users / Team
export {
  useTeamMembers,
  useUser,
  useCurrentUser,
  useUpdateUser,
  useUpdateUserRole,
  useMarkTutorialCompleted,
  useSendInvite,
  useLogin,
  useSignup,
  useResetPassword,
  useJoinCompany,
} from "./use-users";

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

// Calendar
export {
  useCalendarEvents,
  useCalendarEventsForRange,
  useCalendarEvent,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from "./use-calendar";

// Task Types
export {
  useTaskTypes,
  useTaskType,
  useCreateTaskType,
  useUpdateTaskType,
  useDeleteTaskType,
  useCreateDefaultTaskTypes,
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
  useMoveOpportunityStage,
  useDeleteOpportunity,
  useOpportunityActivities,
  useCreateActivity,
  useOpportunityFollowUps,
  useCreateFollowUp,
  useCompleteFollowUp,
  useStageTransitions,
} from "./use-opportunities";

// Accounting
export {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useTriggerSync,
  useSyncHistory,
} from "./use-accounting";

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

// Gmail Connections
export {
  useGmailConnections,
  useUpdateGmailConnection,
  useDeleteGmailConnection,
  useTriggerGmailSync,
} from "./use-gmail-connections";

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
