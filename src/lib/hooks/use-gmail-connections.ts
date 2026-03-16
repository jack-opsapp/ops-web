/**
 * DEPRECATED: Use use-email-connections.ts instead.
 * This file re-exports for backward compatibility during migration.
 */
export {
  useEmailConnections as useGmailConnections,
  useUpdateEmailConnection as useUpdateGmailConnection,
  useDeleteEmailConnection as useDeleteGmailConnection,
  useTriggerEmailSync as useTriggerGmailSync,
} from "./use-email-connections";
