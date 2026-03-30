/**
 * OPS Web - Unified Inbox Types
 *
 * Normalized types that merge email (activities table) and portal messages
 * (portal_messages table) into a single conversation model.
 */

// ─── Channel Filter ─────────────────────────────────────────────────────────

export type ChannelFilter = "all" | "email" | "portal";

// ─── Unified Conversation (left panel item) ─────────────────────────────────

export interface InboxConversation {
  /** clientId for matched conversations, email address for unmatched */
  id: string;
  type: "client" | "unmatched";
  /** Null for unmatched conversations */
  clientId: string | null;
  /** Client name or email address */
  displayName: string;
  /** First linked project name, if any */
  projectName: string | null;
  /** e.g. "JS", "?" for unmatched */
  avatarInitials: string;
  lastMessageAt: Date;
  lastMessagePreview: string;
  lastMessageChannel: "email" | "portal";
  /** Combined unread count across all channels */
  unreadCount: number;
  hasEmailThreads: boolean;
  hasPortalMessages: boolean;
}

// ─── Unified Message (thread view bubble) ───────────────────────────────────

export interface InboxMessage {
  id: string;
  channel: "email" | "portal";
  direction: "inbound" | "outbound";
  senderName: string;
  senderEmail: string | null;
  /** Rendered content — bodyText for email, content for portal */
  content: string;
  timestamp: Date;
  isRead: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
  // Email-specific (null for portal)
  emailThreadId: string | null;
  emailMessageId: string | null;
  subject: string | null;
  toEmails: string[];
  ccEmails: string[];
  // Portal-specific (null for email)
  projectId: string | null;
  estimateId: string | null;
  invoiceId: string | null;
}
