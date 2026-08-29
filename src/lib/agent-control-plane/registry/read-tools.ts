/**
 * Compatibility entrypoint for existing v7 consumers. Definitions now live in
 * purpose-built domain modules under read-capabilities/.
 */
export {
  READ_CAPABILITY_DEFINITIONS,
  V7_READ_CAPABILITY_DEFINITIONS,
} from "./read-capabilities";
export type {
  GetJobConversationContextInput,
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
} from "./read-capabilities/v7-shared";
