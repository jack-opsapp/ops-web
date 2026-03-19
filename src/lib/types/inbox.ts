/**
 * OPS Web - Inbox Types
 *
 * Types for the in-app email inbox — Pipeline tab (Supabase-backed)
 * and All Mail tab (live provider API).
 */

import type { OpportunityStage } from "./pipeline";

// ─── Pipeline Tab Types ─────────────────────────────────────────────────────

/** A grouped email thread linked to an opportunity (from activities table) */
export interface PipelineThread {
  /** email_thread_id — the Gmail/M365 thread ID */
  threadId: string;
  /** Linked opportunity */
  opportunityId: string;
  opportunityTitle: string;
  opportunityStage: OpportunityStage;
  aiSummary: string | null;
  /** Client info (denormalized from opportunity) */
  clientName: string | null;
  /** Latest message metadata */
  latestSubject: string;
  latestSnippet: string;
  latestSender: string;
  latestDirection: "inbound" | "outbound" | null;
  latestAt: Date;
  /** Aggregated stats */
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
}

/** A single message within a thread (from activities table) */
export interface ThreadMessage {
  id: string;
  subject: string;
  content: string | null;
  bodyText: string | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  direction: "inbound" | "outbound" | null;
  isRead: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
  createdAt: Date;
  /** email_message_id for reply threading */
  emailMessageId: string | null;
}

// ─── All Mail Tab Types ─────────────────────────────────────────────────────

/** An email from the live provider API (Gmail/M365) */
export interface AllMailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  date: Date;
  isRead: boolean;
  hasAttachments: boolean;
}

/** Response from the All Mail API route */
export interface AllMailResponse {
  messages: AllMailMessage[];
  nextPageToken: string | null;
  hasMore: boolean;
}

/** Response from the All Mail thread detail API */
export interface AllMailThreadResponse {
  messages: Array<AllMailMessage & { bodyText: string }>;
}

// ─── Inbox Tab Types ────────────────────────────────────────────────────────

export type InboxTab = "pipeline" | "all-mail";
