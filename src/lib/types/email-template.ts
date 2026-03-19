/**
 * OPS Web - Email Template Types
 *
 * Templates for the compose email modal.
 * Body stored as markdown. Merge fields resolved at compose time.
 */

// ─── Category ───────────────────────────────────────────────────────────────

export type EmailTemplateCategory =
  | "follow_up"
  | "scheduling"
  | "estimate"
  | "invoice"
  | "introduction"
  | "general";

export const EMAIL_TEMPLATE_CATEGORIES: EmailTemplateCategory[] = [
  "follow_up",
  "scheduling",
  "estimate",
  "invoice",
  "introduction",
  "general",
];

// ─── Core Type ──────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  companyId: string;
  name: string;
  subject: string;
  body: string;
  category: EmailTemplateCategory;
  sortOrder: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── CRUD Types ─────────────────────────────────────────────────────────────

export interface CreateEmailTemplate {
  companyId: string;
  name: string;
  subject: string;
  body: string;
  category: EmailTemplateCategory;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateEmailTemplate {
  name?: string;
  subject?: string;
  body?: string;
  category?: EmailTemplateCategory;
  sortOrder?: number;
  isActive?: boolean;
}

// ─── Merge Field Context ────────────────────────────────────────────────────

export interface MergeFieldContext {
  clientName?: string;
  projectTitle?: string;
  companyName?: string;
}

/** Supported merge fields and their display labels */
export const MERGE_FIELDS = [
  { key: "{{client_name}}", label: "Client Name" },
  { key: "{{project_title}}", label: "Project Title" },
  { key: "{{company_name}}", label: "Company Name" },
] as const;

/**
 * Resolve merge fields in a string.
 * Unresolved fields are left as-is (highlighted in the editor).
 */
export function resolveMergeFields(
  text: string,
  context: MergeFieldContext
): string {
  let resolved = text;
  if (context.clientName) {
    resolved = resolved.replace(/\{\{client_name\}\}/g, context.clientName);
  }
  if (context.projectTitle) {
    resolved = resolved.replace(/\{\{project_title\}\}/g, context.projectTitle);
  }
  if (context.companyName) {
    resolved = resolved.replace(/\{\{company_name\}\}/g, context.companyName);
  }
  return resolved;
}

/**
 * Check if a string contains unresolved merge fields.
 */
export function hasUnresolvedFields(text: string): boolean {
  return /\{\{(client_name|project_title|company_name)\}\}/.test(text);
}

// ─── Compose Modal Types ────────────────────────────────────────────────────

export type ComposeMode = "new" | "reply";

export interface ComposeEmailData {
  mode: ComposeMode;
  /** Pre-filled "To" address (reply mode) */
  to?: string;
  /** Pre-filled CC addresses */
  cc?: string[];
  /** Pre-filled subject */
  subject?: string;
  /** Quoted previous message (reply mode) */
  quotedMessage?: string;
  /** Merge field context from linked opportunity/client */
  mergeContext?: MergeFieldContext;
  /** Thread ID for reply tracking */
  threadId?: string;
  /** Connection ID to use for sending (if known) */
  connectionId?: string;
  /** Opportunity ID for AI draft context */
  opportunityId?: string;
  /** Recipient name for AI draft personalization */
  recipientName?: string;
  /** Provider message ID of the email being replied to (for threading) */
  inReplyTo?: string;
}
