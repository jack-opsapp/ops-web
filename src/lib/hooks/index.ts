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
