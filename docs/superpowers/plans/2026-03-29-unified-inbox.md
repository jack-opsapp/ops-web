# Unified Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `/inbox` (email) and `/portal-inbox` (portal messages) into a single unified inbox at `/inbox` with iMessage-style chat bubbles, a resizable conversation list, channel filtering, and a collapsible client context panel.

**Architecture:** UI-layer normalization — no database changes. New `useUnifiedInbox` hooks fetch from existing `InboxService` (client-side Supabase) and direct `requireSupabase()` portal queries, then normalize into a shared `InboxConversation` / `InboxMessage` model. Three-panel layout: conversation list (left) + thread view (center) + context panel (right, collapsed).

**Tech Stack:** Next.js 14 (App Router), TypeScript, TanStack Query, Zustand (none added), Framer Motion, Tailwind CSS, Lucide React, existing Supabase helpers.

**Spec:** `docs/superpowers/specs/2026-03-29-unified-inbox-design.md`

---

## File Structure

```
NEW FILES:
src/lib/types/unified-inbox.ts              — unified type definitions (InboxConversation, InboxMessage, ChannelFilter)
src/lib/hooks/use-unified-inbox.ts           — data hooks (useUnifiedConversations, useUnifiedThread, useUnifiedUnreadCount)
src/components/ops/inbox/conversation-list.tsx   — left panel (search + scrollable list)
src/components/ops/inbox/conversation-item.tsx   — single conversation row
src/components/ops/inbox/unified-thread-view.tsx — center panel (header + picker + bubbles + reply bar)
src/components/ops/inbox/message-bubble.tsx       — chat bubble for both email and portal messages
src/components/ops/inbox/channel-divider.tsx      — inline channel separator ("EMAIL: Re: Subject" / "CLIENT PORTAL")
src/components/ops/inbox/channel-filter.tsx       — sticky segmented picker (ALL / EMAIL / PORTAL)
src/components/ops/inbox/unified-reply-bar.tsx    — reply input with channel selector
src/components/ops/inbox/context-panel.tsx        — collapsible right panel (client info + linked records)
src/components/ops/inbox/resizable-divider.tsx    — drag handle between panels

MODIFIED FILES:
src/lib/types/inbox.ts                       — add clientId to PipelineThread
src/lib/api/services/inbox-service.ts        — pass clientId through in getPipelineThreads
src/lib/api/query-client.ts                  — add portal query keys under queryKeys.inbox
src/app/(dashboard)/inbox/page.tsx           — full rewrite (unified inbox)
src/components/layouts/sidebar.tsx           — remove /portal-inbox entry, update badge
src/i18n/dictionaries/en/inbox.json          — add unified inbox keys
src/i18n/dictionaries/es/inbox.json          — add Spanish translations
src/i18n/dictionaries/en/sidebar.json        — remove nav.portalInbox
src/i18n/dictionaries/es/sidebar.json        — remove nav.portalInbox

DELETED FILES (after all tasks complete):
src/app/(dashboard)/portal-inbox/page.tsx
src/components/ops/portal-inbox.tsx
src/components/ops/inbox/pipeline-thread-list.tsx
src/components/ops/inbox/all-mail-list.tsx
```

---

### Task 1: Extend PipelineThread with clientId

**Files:**
- Modify: `src/lib/types/inbox.ts:13-33`
- Modify: `src/lib/api/services/inbox-service.ts:89-118`

- [ ] **Step 1: Add clientId to PipelineThread interface**

In `src/lib/types/inbox.ts`, add `clientId` field to the `PipelineThread` interface:

```typescript
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
  clientId: string | null;
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
```

- [ ] **Step 2: Update InboxService to map clientId**

In `src/lib/api/services/inbox-service.ts`, update the `oppMap` building and `threads.push` to include `clientId`. Change the oppMap entry shape (around line 69-79):

```typescript
  const oppMap = Object.fromEntries(
    (opportunities ?? []).map((o) => [
      o.id,
      {
        title: o.title as string,
        stage: o.stage as OpportunityStage,
        aiSummary: (o.ai_summary as string) ?? null,
        clientId: (o.client_id as string) ?? null,
        clientName: o.client_id ? clientMap[o.client_id as string] ?? null : null,
      },
    ])
  );
```

Then update the `threads.push` call (around line 102-118) to include `clientId: opp.clientId`:

```typescript
    threads.push({
      threadId,
      opportunityId: oppId,
      opportunityTitle: opp.title,
      opportunityStage: opp.stage,
      aiSummary: opp.aiSummary,
      clientId: opp.clientId,
      clientName: opp.clientName,
      latestSubject: (latest.subject as string) || "(no subject)",
      latestSnippet: (latest.content as string) || "",
      latestSender: (latest.from_email as string) || "",
      latestDirection: (latest.direction as "inbound" | "outbound") ?? null,
      latestAt: parseDate(latest.created_at) ?? new Date(),
      messageCount: msgs.length,
      unreadCount,
      hasAttachments,
    });
```

- [ ] **Step 3: Verify existing inbox still works**

Run: `npx tsc --noEmit`
Expected: no type errors (the new field is `| null` so existing consumers are unaffected)

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/inbox.ts src/lib/api/services/inbox-service.ts
git commit -m "feat(inbox): add clientId to PipelineThread for unified inbox grouping"
```

---

### Task 2: Add unified inbox types

**Files:**
- Create: `src/lib/types/unified-inbox.ts`

- [ ] **Step 1: Create unified type definitions**

Create `src/lib/types/unified-inbox.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types/unified-inbox.ts
git commit -m "feat(inbox): add unified inbox type definitions"
```

---

### Task 3: Extend query keys for portal data

**Files:**
- Modify: `src/lib/api/query-client.ts:374-385`

- [ ] **Step 1: Add portal query keys to queryKeys.inbox**

In `src/lib/api/query-client.ts`, extend the `inbox` section (around line 374-385):

```typescript
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
  },
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/query-client.ts
git commit -m "feat(inbox): add portal query keys to centralized queryKeys"
```

---

### Task 4: Build unified inbox data hooks

**Files:**
- Create: `src/lib/hooks/use-unified-inbox.ts`

- [ ] **Step 1: Create the unified hooks file**

Create `src/lib/hooks/use-unified-inbox.ts`:

```typescript
/**
 * OPS Web - Unified Inbox Hooks
 *
 * Merges pipeline email threads + portal conversations into a single
 * normalized data model for the unified inbox UI.
 *
 * Portal messages use requireSupabase() (client-side) — same pattern
 * as the existing portal-inbox page. PortalMessageService uses
 * getServiceRoleClient() which is server-only and cannot be used here.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";
import { InboxService } from "@/lib/api/services/inbox-service";
import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type { PipelineThread, ThreadMessage } from "@/lib/types/inbox";
import type { PortalMessage, PortalMessageSender } from "@/lib/types/portal";
import type {
  InboxConversation,
  InboxMessage,
  ChannelFilter,
} from "@/lib/types/unified-inbox";

// ─── Portal Data Fetching (client-side Supabase) ────────────────────────────

interface PortalConversation {
  clientId: string;
  clientName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

async function fetchPortalConversations(companyId: string): Promise<PortalConversation[]> {
  const supabase = requireSupabase();

  const { data: messages, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new Error(`Failed to fetch portal conversations: ${error.message}`);
  if (!messages || messages.length === 0) return [];

  const clientMap = new Map<string, PortalConversation>();

  for (const row of messages) {
    const clientId = row.client_id as string;

    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        clientId,
        clientName: row.sender_name as string,
        lastMessage: row.content as string,
        lastMessageAt: parseDateRequired(row.created_at),
        unreadCount: 0,
      });
    }

    if ((row.sender_type as string) === "client" && row.read_at == null) {
      clientMap.get(clientId)!.unreadCount += 1;
    }
  }

  // Fetch actual client names
  const clientIds = Array.from(clientMap.keys());
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", clientIds);

    if (clients) {
      for (const client of clients) {
        const entry = clientMap.get(client.id as string);
        if (entry && client.name) {
          entry.clientName = client.name as string;
        }
      }
    }
  }

  return Array.from(clientMap.values()).sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  );
}

async function fetchPortalMessages(
  companyId: string,
  clientId: string
): Promise<PortalMessage[]> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("portal_messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(`Failed to fetch portal messages: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    companyId: row.company_id as string,
    clientId: row.client_id as string,
    projectId: (row.project_id as string) ?? null,
    estimateId: (row.estimate_id as string) ?? null,
    invoiceId: (row.invoice_id as string) ?? null,
    senderType: row.sender_type as PortalMessageSender,
    senderName: row.sender_name as string,
    content: row.content as string,
    readAt: parseDate(row.read_at),
    createdAt: parseDateRequired(row.created_at),
  }));
}

async function fetchPortalUnreadCount(companyId: string): Promise<number> {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("portal_messages")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("sender_type", "client")
    .is("read_at", null);

  if (error) return 0;
  return count ?? 0;
}

async function markPortalMessagesRead(
  companyId: string,
  clientId: string
): Promise<void> {
  const supabase = requireSupabase();

  await supabase
    .from("portal_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .eq("sender_type", "client")
    .is("read_at", null);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name[0] ?? "?").toUpperCase();
}

// ─── Normalization: Conversations ───────────────────────────────────────────

function normalizeConversations(
  pipelineThreads: PipelineThread[],
  portalConversations: PortalConversation[]
): InboxConversation[] {
  const conversations = new Map<string, InboxConversation>();

  // 1) Group pipeline threads by clientId
  for (const thread of pipelineThreads) {
    const key = thread.clientId ?? `unmatched-${thread.latestSender}`;
    const existing = conversations.get(key);

    if (existing) {
      // Merge: update if this thread is newer
      if (thread.latestAt > existing.lastMessageAt) {
        existing.lastMessageAt = thread.latestAt;
        existing.lastMessagePreview = thread.latestSnippet || thread.latestSubject;
        existing.lastMessageChannel = "email";
      }
      existing.unreadCount += thread.unreadCount;
      existing.hasEmailThreads = true;
    } else {
      conversations.set(key, {
        id: key,
        type: thread.clientId ? "client" : "unmatched",
        clientId: thread.clientId,
        displayName: thread.clientName ?? thread.latestSender,
        projectName: null,
        avatarInitials: thread.clientName
          ? getInitials(thread.clientName)
          : "?",
        lastMessageAt: thread.latestAt,
        lastMessagePreview: thread.latestSnippet || thread.latestSubject,
        lastMessageChannel: "email",
        unreadCount: thread.unreadCount,
        hasEmailThreads: true,
        hasPortalMessages: false,
      });
    }
  }

  // 2) Merge portal conversations
  for (const portal of portalConversations) {
    const key = portal.clientId;
    const existing = conversations.get(key);

    if (existing) {
      // Merge: update if portal message is newer
      if (portal.lastMessageAt > existing.lastMessageAt) {
        existing.lastMessageAt = portal.lastMessageAt;
        existing.lastMessagePreview = portal.lastMessage;
        existing.lastMessageChannel = "portal";
      }
      existing.unreadCount += portal.unreadCount;
      existing.hasPortalMessages = true;
      // Prefer the client name from portal (it's fetched from clients table)
      if (portal.clientName) {
        existing.displayName = portal.clientName;
        existing.avatarInitials = getInitials(portal.clientName);
      }
    } else {
      conversations.set(key, {
        id: key,
        type: "client",
        clientId: portal.clientId,
        displayName: portal.clientName,
        projectName: null,
        avatarInitials: getInitials(portal.clientName),
        lastMessageAt: portal.lastMessageAt,
        lastMessagePreview: portal.lastMessage,
        lastMessageChannel: "portal",
        unreadCount: portal.unreadCount,
        hasEmailThreads: false,
        hasPortalMessages: true,
      });
    }
  }

  // Sort by lastMessageAt descending
  return Array.from(conversations.values()).sort(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
  );
}

// ─── Normalization: Messages ────────────────────────────────────────────────

function normalizeEmailMessages(messages: ThreadMessage[], emailThreadId: string): InboxMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    channel: "email" as const,
    direction: msg.direction ?? "inbound",
    senderName: msg.fromEmail?.split("@")[0] ?? "Unknown",
    senderEmail: msg.fromEmail,
    content: msg.bodyText || msg.content || "",
    timestamp: msg.createdAt,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    attachmentCount: msg.attachmentCount,
    emailThreadId,
    emailMessageId: msg.emailMessageId,
    subject: msg.subject,
    toEmails: msg.toEmails,
    ccEmails: msg.ccEmails,
    projectId: null,
    estimateId: null,
    invoiceId: null,
  }));
}

function normalizePortalMessages(messages: PortalMessage[]): InboxMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    channel: "portal" as const,
    direction: msg.senderType === "client" ? "inbound" : "outbound",
    senderName: msg.senderName,
    senderEmail: null,
    content: msg.content,
    timestamp: msg.createdAt,
    isRead: msg.readAt !== null,
    hasAttachments: false,
    attachmentCount: 0,
    emailThreadId: null,
    emailMessageId: null,
    subject: null,
    toEmails: [],
    ccEmails: [],
    projectId: msg.projectId,
    estimateId: msg.estimateId,
    invoiceId: msg.invoiceId,
  }));
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Fetch unified conversation list — merges pipeline threads + portal conversations.
 */
export function useUnifiedConversations() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [...queryKeys.inbox.all, "unified", companyId ?? ""],
    queryFn: async () => {
      const [pipelineThreads, portalConversations] = await Promise.all([
        InboxService.getPipelineThreads(companyId!),
        fetchPortalConversations(companyId!),
      ]);
      return normalizeConversations(pipelineThreads, portalConversations);
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
}

/**
 * Fetch unified thread messages for a conversation.
 * Merges email thread messages + portal messages, applies channel filter.
 */
export function useUnifiedThread(
  conversationId: string | null,
  clientId: string | null,
  emailThreadIds: string[],
  filter: ChannelFilter
) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [
      ...queryKeys.inbox.all,
      "unified-thread",
      companyId ?? "",
      conversationId ?? "",
      filter,
    ],
    queryFn: async () => {
      const results: InboxMessage[] = [];

      // Fetch email messages (if filter allows)
      if (filter !== "portal" && emailThreadIds.length > 0) {
        const emailPromises = emailThreadIds.map((tid) =>
          InboxService.getThreadMessages(companyId!, tid).then((msgs) =>
            normalizeEmailMessages(msgs, tid)
          )
        );
        const emailResults = await Promise.all(emailPromises);
        results.push(...emailResults.flat());
      }

      // Fetch portal messages (if filter allows and client is matched)
      if (filter !== "email" && clientId) {
        const portalMsgs = await fetchPortalMessages(companyId!, clientId);
        results.push(...normalizePortalMessages(portalMsgs));
      }

      // Sort chronologically (oldest first — newest at bottom)
      results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return results;
    },
    enabled: !!companyId && !!conversationId,
    refetchInterval: 15_000,
  });
}

/**
 * Combined unread count: email + portal.
 */
export function useUnifiedUnreadCount() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [...queryKeys.inbox.all, "unified-unread", companyId ?? ""],
    queryFn: async () => {
      const [emailUnread, portalUnread] = await Promise.all([
        InboxService.getUnreadCount(companyId!),
        fetchPortalUnreadCount(companyId!),
      ]);
      return emailUnread + portalUnread;
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}

/**
 * Mark portal messages as read for a client conversation.
 */
export { markPortalMessagesRead };
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/use-unified-inbox.ts
git commit -m "feat(inbox): add unified inbox data hooks"
```

---

### Task 5: Build resizable-divider component

**Files:**
- Create: `src/components/ops/inbox/resizable-divider.tsx`

- [ ] **Step 1: Create the resizable divider**

Create `src/components/ops/inbox/resizable-divider.tsx`:

```typescript
"use client";

import { useCallback, useRef } from "react";

interface ResizableDividerProps {
  onResize: (deltaX: number) => void;
  onResizeEnd: () => void;
}

export function ResizableDivider({ onResize, onResizeEnd }: ResizableDividerProps) {
  const startXRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        onResize(delta);
      };

      const handleUp = () => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        onResizeEnd();
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
    },
    [onResize, onResizeEnd]
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      className="w-[4px] cursor-col-resize relative shrink-0 group"
    >
      {/* Visible grab indicator */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-[32px] rounded-full bg-[rgba(255,255,255,0.08)] group-hover:bg-[rgba(255,255,255,0.15)] transition-colors" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/resizable-divider.tsx
git commit -m "feat(inbox): add resizable divider component"
```

---

### Task 6: Build channel-filter (segmented picker)

**Files:**
- Create: `src/components/ops/inbox/channel-filter.tsx`

- [ ] **Step 1: Create the segmented picker**

Create `src/components/ops/inbox/channel-filter.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ChannelFilter } from "@/lib/types/unified-inbox";

interface ChannelFilterProps {
  active: ChannelFilter;
  onChange: (filter: ChannelFilter) => void;
}

export function ChannelFilterBar({ active, onChange }: ChannelFilterProps) {
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);

  const canViewEmail = can("pipeline.view");
  const canViewPortal = can("portal.view");

  // If user only has one permission, no picker needed
  if (!canViewEmail || !canViewPortal) return null;

  const segments: Array<{ value: ChannelFilter; label: string }> = [
    { value: "all", label: t("filter.all") },
    { value: "email", label: t("filter.email") },
    { value: "portal", label: t("filter.portal") },
  ];

  return (
    <div className="px-3.5 py-1.5 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.9)] backdrop-blur-[12px] sticky top-0 z-10">
      <div className="inline-flex bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-[3px] overflow-hidden">
        {segments.map((seg) => (
          <button
            key={seg.value}
            onClick={() => onChange(seg.value)}
            className={cn(
              "px-3.5 py-1 font-kosugi text-[9px] uppercase tracking-[0.5px] border-b-2 transition-colors",
              active === seg.value
                ? "text-white bg-[rgba(111,148,176,0.2)] border-b-[#6F94B0]"
                : "text-[rgba(255,255,255,0.35)] bg-transparent border-b-transparent hover:text-[rgba(255,255,255,0.5)]"
            )}
          >
            {seg.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/channel-filter.tsx
git commit -m "feat(inbox): add channel filter segmented picker"
```

---

### Task 7: Build message-bubble component

**Files:**
- Create: `src/components/ops/inbox/message-bubble.tsx`

- [ ] **Step 1: Create the chat bubble component**

Create `src/components/ops/inbox/message-bubble.tsx`:

```typescript
"use client";

import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { InboxMessage } from "@/lib/types/unified-inbox";

interface MessageBubbleProps {
  message: InboxMessage;
  /** Hide timestamp for grouped consecutive messages from same sender */
  showTimestamp?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageBubble({ message, showTimestamp = true }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className="max-w-[65%]">
        {/* Bubble */}
        <div
          className={cn(
            "px-3 py-2.5 border",
            isOutbound
              ? "bg-[rgba(111,148,176,0.12)] border-[rgba(111,148,176,0.18)] rounded-[3px_3px_1px_3px]"
              : "bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.06)] rounded-[3px_3px_3px_1px]"
          )}
        >
          <p className="font-mohave text-body-sm text-[rgba(255,255,255,0.8)] leading-relaxed whitespace-pre-wrap break-words">
            {message.content || (
              <span className="italic text-text-disabled">No message content available.</span>
            )}
          </p>

          {/* Attachment indicator */}
          {message.hasAttachments && message.attachmentCount > 0 && (
            <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-[rgba(255,255,255,0.04)]">
              <Paperclip className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-kosugi text-[9px] text-text-disabled">
                {message.attachmentCount} attachment{message.attachmentCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Metadata below bubble */}
        {showTimestamp && (
          <div
            className={cn(
              "flex items-center gap-1 mt-0.5 px-1",
              isOutbound ? "justify-end" : "justify-start"
            )}
          >
            <span className="font-kosugi text-[9px] text-[rgba(255,255,255,0.15)]">
              {formatTime(message.timestamp)}
            </span>
            {!isOutbound && message.senderEmail && (
              <>
                <span className="text-[rgba(255,255,255,0.1)] text-[9px]">&middot;</span>
                <span className="font-kosugi text-[8px] text-[rgba(255,255,255,0.15)]">
                  {message.senderEmail}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/message-bubble.tsx
git commit -m "feat(inbox): add iMessage-style chat bubble component"
```

---

### Task 8: Build channel-divider component

**Files:**
- Create: `src/components/ops/inbox/channel-divider.tsx`

- [ ] **Step 1: Create the channel divider**

Create `src/components/ops/inbox/channel-divider.tsx`:

```typescript
"use client";

import { Mail, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ChannelDividerProps {
  channel: "email" | "portal";
  /** Email subject line (for email threads) */
  subject?: string;
}

export function ChannelDivider({ channel, subject }: ChannelDividerProps) {
  const isEmail = channel === "email";

  return (
    <div className="flex items-center gap-1.5 my-1.5">
      {isEmail ? (
        <Mail className="w-[10px] h-[10px] text-[rgba(255,255,255,0.2)] shrink-0" />
      ) : (
        <MessageSquareText className="w-[10px] h-[10px] text-[rgba(111,148,176,0.5)] shrink-0" />
      )}
      <span
        className={cn(
          "font-kosugi text-[8px] uppercase tracking-[0.5px] shrink-0",
          isEmail ? "text-[rgba(255,255,255,0.2)]" : "text-[rgba(111,148,176,0.5)]"
        )}
      >
        {isEmail ? (subject ?? "EMAIL") : "CLIENT PORTAL"}
      </span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
    </div>
  );
}

interface DateDividerProps {
  label: string;
}

export function DateDivider({ label }: DateDividerProps) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
      <span className="font-kosugi text-[9px] uppercase tracking-[0.3px] text-[rgba(255,255,255,0.15)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/channel-divider.tsx
git commit -m "feat(inbox): add channel and date divider components"
```

---

### Task 9: Build conversation-item component

**Files:**
- Create: `src/components/ops/inbox/conversation-item.tsx`

- [ ] **Step 1: Create the conversation list item**

Create `src/components/ops/inbox/conversation-item.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils/cn";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ConversationItemProps {
  conversation: InboxConversation;
  isActive: boolean;
  onClick: () => void;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationItem({
  conversation,
  isActive,
  onClick,
}: ConversationItemProps) {
  const isUnmatched = conversation.type === "unmatched";
  const hasUnread = conversation.unreadCount > 0;

  const channelBadge = conversation.lastMessageChannel === "portal"
    ? { label: "PORTAL", accent: true }
    : isUnmatched
      ? { label: "UNMATCHED", accent: false, warning: true }
      : { label: "EMAIL", accent: false };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2.5 py-2.5 border-l-2 cursor-pointer transition-colors",
        isActive
          ? "border-l-[#6F94B0] bg-[rgba(111,148,176,0.08)]"
          : "border-l-transparent hover:bg-[rgba(255,255,255,0.02)]",
        !hasUnread && !isActive && "opacity-50"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Avatar */}
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0",
            "font-kosugi text-[10px] font-semibold",
            isUnmatched
              ? "bg-[rgba(255,165,0,0.1)] text-[rgba(255,165,0,0.5)]"
              : isActive
                ? "bg-[rgba(111,148,176,0.25)] text-[#6F94B0]"
                : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]"
          )}
        >
          {conversation.avatarInitials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "font-mohave text-body-sm truncate",
                isUnmatched ? "italic text-[rgba(255,255,255,0.5)]" : "text-text-primary",
                hasUnread && "font-semibold"
              )}
            >
              {conversation.displayName}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-kosugi text-[9px] text-[rgba(255,255,255,0.25)]">
                {formatRelativeTime(conversation.lastMessageAt)}
              </span>
              {hasUnread && (
                <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-[#6F94B0] text-white font-kosugi text-[8px] leading-none">
                  {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Project name */}
          {conversation.projectName && (
            <span className="font-kosugi text-[9px] text-[rgba(255,255,255,0.2)] uppercase block mt-0.5 truncate">
              {conversation.projectName}
            </span>
          )}

          {/* Preview */}
          <div className="flex items-center gap-1 mt-1">
            <span
              className={cn(
                "px-1 rounded-[2px] font-kosugi text-[7px] shrink-0",
                channelBadge.accent
                  ? "bg-[rgba(111,148,176,0.25)] text-[#6F94B0]"
                  : channelBadge.warning
                    ? "bg-[rgba(255,165,0,0.12)] text-[rgba(255,165,0,0.5)]"
                    : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.35)]"
              )}
            >
              {channelBadge.label}
            </span>
            <span className="font-mohave text-body-sm text-[rgba(255,255,255,0.3)] truncate">
              {conversation.lastMessagePreview}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/conversation-item.tsx
git commit -m "feat(inbox): add conversation list item component"
```

---

### Task 10: Build conversation-list component

**Files:**
- Create: `src/components/ops/inbox/conversation-list.tsx`

- [ ] **Step 1: Create the left panel**

Create `src/components/ops/inbox/conversation-list.tsx`:

```typescript
"use client";

import { useState, useMemo, useCallback } from "react";
import { Search, Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { ConversationItem } from "./conversation-item";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ConversationListProps {
  conversations: InboxConversation[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (conversation: InboxConversation) => void;
  onNewMessage: () => void;
}

function ConversationSkeleton() {
  return (
    <div className="px-2.5 py-2.5 flex items-start gap-1.5 animate-pulse">
      <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.06)] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex justify-between">
          <div className="h-[14px] w-[100px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[12px] w-[24px] rounded bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="h-[12px] w-3/4 rounded bg-[rgba(255,255,255,0.04)]" />
      </div>
    </div>
  );
}

export function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  onNewMessage,
}: ConversationListProps) {
  const { t } = useDictionary("inbox");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q) ||
        (c.projectName?.toLowerCase().includes(q) ?? false)
    );
  }, [conversations, searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      const currentIndex = filtered.findIndex((c) => c.id === selectedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, filtered.length - 1);
        onSelect(filtered[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        onSelect(filtered[prev]);
      } else if ((e.key === "Enter" || e.key === "ArrowRight") && currentIndex >= 0) {
        e.preventDefault();
        onSelect(filtered[currentIndex]);
      }
    },
    [filtered, selectedId, onSelect]
  );

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Search */}
      <div className="p-2.5 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[3px] px-2.5 py-[7px]">
          <Search className="w-[12px] h-[12px] text-[rgba(255,255,255,0.3)] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-[10px] font-mohave text-text-primary placeholder:text-[rgba(255,255,255,0.25)] placeholder:uppercase outline-none"
          />
        </div>
      </div>

      {/* New Message */}
      <div className="px-2.5 py-1.5">
        <button
          onClick={onNewMessage}
          className="flex items-center justify-center gap-1 w-full py-[5px] rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
        >
          <Plus className="w-[11px] h-[11px] text-[rgba(255,255,255,0.4)]" />
          <span className="font-kosugi text-[9px] text-[rgba(255,255,255,0.4)] uppercase tracking-[0.5px]">
            {t("newMessage")}
          </span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading && (
          <>
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
          </>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="font-mohave text-body-sm text-text-disabled">
              {searchQuery ? "No conversations match your search." : t("empty.title")}
            </p>
            {!searchQuery && (
              <p className="font-kosugi text-[10px] text-text-disabled mt-1">
                {t("empty.description")}
              </p>
            )}
          </div>
        )}

        {!isLoading &&
          filtered.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === selectedId}
              onClick={() => onSelect(conversation)}
            />
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/conversation-list.tsx
git commit -m "feat(inbox): add conversation list panel with search and keyboard nav"
```

---

### Task 11: Build unified-reply-bar component

**Files:**
- Create: `src/components/ops/inbox/unified-reply-bar.tsx`

- [ ] **Step 1: Create the reply bar**

Create `src/components/ops/inbox/unified-reply-bar.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { Mail, MessageSquareText, Paperclip, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

interface UnifiedReplyBarProps {
  defaultChannel: "email" | "portal";
  onSendPortal: (content: string) => void;
  onSendEmail: () => void;
  isSending: boolean;
  hasEmailThreads: boolean;
  hasPortalMessages: boolean;
}

export function UnifiedReplyBar({
  defaultChannel,
  onSendPortal,
  onSendEmail,
  isSending,
  hasEmailThreads,
  hasPortalMessages,
}: UnifiedReplyBarProps) {
  const { t } = useDictionary("inbox");
  const [channel, setChannel] = useState<"email" | "portal">(defaultChannel);
  const [message, setMessage] = useState("");
  const [showChannelPicker, setShowChannelPicker] = useState(false);

  const handleSend = useCallback(() => {
    if (!message.trim()) return;

    if (channel === "portal") {
      onSendPortal(message.trim());
      setMessage("");
    } else {
      // Email opens the compose modal
      onSendEmail();
    }
  }, [channel, message, onSendPortal, onSendEmail]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="px-3.5 py-2.5 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.5)]">
      <div className="flex items-center gap-2">
        {/* Channel selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowChannelPicker((prev) => !prev)}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] font-kosugi text-[8px] uppercase tracking-[0.3px] cursor-pointer transition-colors",
              channel === "portal"
                ? "bg-[rgba(111,148,176,0.08)] text-[rgba(111,148,176,0.6)]"
                : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.35)]"
            )}
          >
            {channel === "portal" ? (
              <MessageSquareText className="w-[9px] h-[9px]" />
            ) : (
              <Mail className="w-[9px] h-[9px]" />
            )}
            {channel === "portal" ? t("reply.viaPortal") : t("reply.viaEmail")}
            <ChevronDown className="w-[8px] h-[8px]" />
          </button>

          {showChannelPicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-[rgba(20,20,20,0.95)] border border-[rgba(255,255,255,0.08)] rounded-[3px] overflow-hidden z-20 backdrop-blur-[12px]">
              {hasPortalMessages && (
                <button
                  onClick={() => {
                    setChannel("portal");
                    setShowChannelPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 w-full text-left hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <MessageSquareText className="w-[10px] h-[10px] text-[rgba(111,148,176,0.6)]" />
                  <span className="font-kosugi text-[9px] text-text-secondary uppercase">
                    {t("reply.viaPortal")}
                  </span>
                </button>
              )}
              {hasEmailThreads && (
                <button
                  onClick={() => {
                    setChannel("email");
                    setShowChannelPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 w-full text-left hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <Mail className="w-[10px] h-[10px] text-[rgba(255,255,255,0.35)]" />
                  <span className="font-kosugi text-[9px] text-text-secondary uppercase">
                    {t("reply.viaEmail")}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Text input */}
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("reply.placeholder")}
          disabled={isSending}
          className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[3px] px-3 py-2 font-mohave text-body-sm text-text-primary placeholder:text-[rgba(255,255,255,0.2)] outline-none disabled:opacity-50"
        />

        {/* Attach + Send */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="w-[28px] h-[28px] flex items-center justify-center rounded-[3px] text-[rgba(255,255,255,0.25)] hover:text-text-secondary transition-colors">
            <Paperclip className="w-[14px] h-[14px]" />
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="bg-[#6F94B0] text-white px-3.5 py-1.5 rounded-[3px] font-kosugi text-[10px] uppercase tracking-[0.3px] hover:bg-[#6a8aaa] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("reply.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/unified-reply-bar.tsx
git commit -m "feat(inbox): add unified reply bar with channel selector"
```

---

### Task 12: Build context-panel component

**Files:**
- Create: `src/components/ops/inbox/context-panel.tsx`

- [ ] **Step 1: Create the collapsible context panel**

Create `src/components/ops/inbox/context-panel.tsx`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  Mail,
  FolderKanban,
  FileText,
  Receipt,
  ExternalLink,
  UserPlus,
  Link,
  X,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ContextPanelProps {
  open: boolean;
  onClose: () => void;
  conversation: InboxConversation | null;
}

interface ClientContext {
  name: string;
  email: string | null;
  phone: string | null;
  projects: Array<{ id: string; title: string; status: string }>;
  estimates: Array<{ id: string; title: string | null; status: string; total: number }>;
  invoices: Array<{ id: string; subject: string | null; status: string; total: number }>;
}

async function fetchClientContext(
  companyId: string,
  clientId: string
): Promise<ClientContext> {
  const supabase = requireSupabase();

  const [clientRes, projectsRes, estimatesRes, invoicesRes] = await Promise.all([
    supabase.from("clients").select("name, email, phone").eq("id", clientId).single(),
    supabase
      .from("projects")
      .select("id, title, status")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("estimates")
      .select("id, title, status, total")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("invoices")
      .select("id, subject, status, total")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  return {
    name: (clientRes.data?.name as string) ?? "",
    email: (clientRes.data?.email as string) ?? null,
    phone: (clientRes.data?.phone as string) ?? null,
    projects: (projectsRes.data ?? []).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      status: p.status as string,
    })),
    estimates: (estimatesRes.data ?? []).map((e) => ({
      id: e.id as string,
      title: (e.title as string) ?? null,
      status: e.status as string,
      total: (e.total as number) ?? 0,
    })),
    invoices: (invoicesRes.data ?? []).map((i) => ({
      id: i.id as string,
      subject: (i.subject as string) ?? null,
      status: i.status as string,
      total: (i.total as number) ?? 0,
    })),
  };
}

export function ContextPanel({ open, onClose, conversation }: ContextPanelProps) {
  const { t } = useDictionary("inbox");
  const router = useRouter();
  const companyId = useAuthStore((s) => s.company?.id);

  const { data: context, isLoading } = useQuery({
    queryKey: ["inbox", "context", conversation?.clientId ?? ""],
    queryFn: () => fetchClientContext(companyId!, conversation!.clientId!),
    enabled: open && !!companyId && !!conversation?.clientId,
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1, transition: { duration: 0.2, ease: EASE_SMOOTH } }}
          exit={{ width: 0, opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } }}
          className="shrink-0 border-l border-[rgba(255,255,255,0.06)] overflow-hidden"
        >
          <div className="w-[320px] h-full flex flex-col overflow-y-auto scrollbar-hide">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-[rgba(255,255,255,0.06)]">
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                {t("context.toggle")}
              </span>
              <button onClick={onClose} className="text-text-disabled hover:text-text-secondary transition-colors">
                <X className="w-[14px] h-[14px]" />
              </button>
            </div>

            {/* Unmatched state */}
            {conversation?.type === "unmatched" && (
              <div className="p-3 space-y-2">
                <p className="font-mohave text-body text-text-primary">
                  {conversation.displayName}
                </p>
                <div className="space-y-1">
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                    <UserPlus className="w-[12px] h-[12px] text-text-tertiary" />
                    <span className="font-kosugi text-[9px] text-text-secondary uppercase">{t("unmatched.createClient")}</span>
                  </button>
                  <button className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                    <Link className="w-[12px] h-[12px] text-text-tertiary" />
                    <span className="font-kosugi text-[9px] text-text-secondary uppercase">{t("unmatched.linkToClient")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Client context */}
            {conversation?.type === "client" && (
              <div className="p-3 space-y-4">
                {isLoading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-[18px] w-[120px] rounded bg-[rgba(255,255,255,0.06)]" />
                    <div className="h-[14px] w-[180px] rounded bg-[rgba(255,255,255,0.04)]" />
                    <div className="h-[14px] w-[140px] rounded bg-[rgba(255,255,255,0.04)]" />
                  </div>
                ) : context ? (
                  <>
                    {/* Name + contact */}
                    <div>
                      <p className="font-mohave text-body text-text-primary font-semibold">
                        {context.name}
                      </p>
                      {context.phone && (
                        <a
                          href={`tel:${context.phone}`}
                          className="flex items-center gap-1.5 mt-1.5 text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <Phone className="w-[11px] h-[11px]" />
                          <span className="font-mohave text-body-sm">{context.phone}</span>
                        </a>
                      )}
                      {context.email && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Mail className="w-[11px] h-[11px] text-text-tertiary" />
                          <span className="font-mohave text-body-sm text-text-secondary">{context.email}</span>
                        </div>
                      )}
                    </div>

                    {/* Projects */}
                    {context.projects.length > 0 && (
                      <div>
                        <p className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.projects")}
                        </p>
                        <div className="space-y-1">
                          {context.projects.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => router.push(`/projects/${p.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <FolderKanban className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {p.title}
                              </span>
                              <span className="font-kosugi text-[8px] text-text-disabled uppercase">
                                {p.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Estimates */}
                    {context.estimates.length > 0 && (
                      <div>
                        <p className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.estimates")}
                        </p>
                        <div className="space-y-1">
                          {context.estimates.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => router.push(`/estimates/${e.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <FileText className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {e.title || "Untitled"}
                              </span>
                              <span className="font-kosugi text-[8px] text-text-disabled uppercase">
                                {e.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Invoices */}
                    {context.invoices.length > 0 && (
                      <div>
                        <p className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider mb-1.5">
                          {t("context.invoices")}
                        </p>
                        <div className="space-y-1">
                          {context.invoices.map((inv) => (
                            <button
                              key={inv.id}
                              onClick={() => router.push(`/invoices/${inv.id}`)}
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-[3px] hover:bg-[rgba(255,255,255,0.04)] transition-colors text-left"
                            >
                              <Receipt className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                              <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                                {inv.subject || "Untitled"}
                              </span>
                              <span className="font-kosugi text-[8px] text-text-disabled uppercase">
                                {inv.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick actions */}
                    <div className="pt-2 border-t border-[rgba(255,255,255,0.06)]">
                      <button
                        onClick={() => router.push(`/clients/${conversation?.clientId}`)}
                        className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                      >
                        <ExternalLink className="w-[11px] h-[11px] text-text-tertiary" />
                        <span className="font-kosugi text-[9px] text-text-secondary uppercase">
                          {t("context.viewClient")}
                        </span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/context-panel.tsx
git commit -m "feat(inbox): add collapsible client context panel"
```

---

### Task 13: Build unified-thread-view (center panel orchestrator)

**Files:**
- Create: `src/components/ops/inbox/unified-thread-view.tsx`

- [ ] **Step 1: Create the center panel component**

Create `src/components/ops/inbox/unified-thread-view.tsx`:

```typescript
"use client";

import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { PanelRight, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";
import { useUnifiedThread, markPortalMessagesRead } from "@/lib/hooks/use-unified-inbox";
import { useMarkThreadRead } from "@/lib/hooks/use-inbox";
import { ChannelFilterBar } from "./channel-filter";
import { MessageBubble } from "./message-bubble";
import { ChannelDivider, DateDivider } from "./channel-divider";
import { UnifiedReplyBar } from "./unified-reply-bar";
import type { InboxConversation, InboxMessage, ChannelFilter } from "@/lib/types/unified-inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

interface UnifiedThreadViewProps {
  conversation: InboxConversation;
  emailThreadIds: string[];
  onToggleContext: () => void;
  contextOpen: boolean;
  onReply: (data: ComposeEmailData) => void;
}

// ─── Date formatting helpers ────────────────────────────────────────────────

function getDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shouldShowTimestamp(
  current: InboxMessage,
  previous: InboxMessage | undefined
): boolean {
  if (!previous) return true;
  if (current.direction !== previous.direction) return true;
  if (current.channel !== previous.channel) return true;
  // Group consecutive same-sender messages within 5 minutes
  const diffMs = current.timestamp.getTime() - previous.timestamp.getTime();
  return diffMs > 5 * 60_000;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UnifiedThreadView({
  conversation,
  emailThreadIds,
  onToggleContext,
  contextOpen,
  onReply,
}: UnifiedThreadViewProps) {
  const { t } = useDictionary("inbox");
  const companyId = useAuthStore((s) => s.company?.id);
  const currentUser = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<ChannelFilter>("all");

  const { data: messages = [], isLoading } = useUnifiedThread(
    conversation.id,
    conversation.clientId,
    emailThreadIds,
    filter
  );

  const markEmailRead = useMarkThreadRead();

  // Mark as read on mount
  useEffect(() => {
    if (!companyId) return;

    // Mark email threads as read
    for (const tid of emailThreadIds) {
      markEmailRead.mutate(tid);
    }

    // Mark portal messages as read
    if (conversation.clientId) {
      markPortalMessagesRead(companyId, conversation.clientId).then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send portal message
  const sendPortalMutation = useMutation({
    mutationFn: async (content: string) => {
      const supabase = requireSupabase();
      const senderName = currentUser
        ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email || "Admin"
        : "Admin";

      const { error } = await supabase.from("portal_messages").insert({
        company_id: companyId,
        client_id: conversation.clientId,
        sender_type: "company",
        sender_name: senderName,
        content,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
    },
  });

  const handleSendEmail = useCallback(() => {
    // Find the last email message to build reply context
    const lastEmail = [...messages].reverse().find((m) => m.channel === "email");
    onReply({
      mode: "reply",
      to: lastEmail?.senderEmail ?? "",
      subject: lastEmail?.subject ?? "",
      quotedMessage: lastEmail?.content?.slice(0, 2000) ?? "",
      threadId: lastEmail?.emailThreadId ?? emailThreadIds[0],
      inReplyTo: lastEmail?.emailMessageId ?? undefined,
    });
  }, [messages, emailThreadIds, onReply]);

  // Build message list with dividers
  const renderedMessages = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let lastDateLabel = "";
    let lastChannel = "";
    let lastSubject = "";

    messages.forEach((msg, i) => {
      const dateLabel = getDateLabel(msg.timestamp);
      const prev = i > 0 ? messages[i - 1] : undefined;

      // Date divider
      if (dateLabel !== lastDateLabel) {
        elements.push(<DateDivider key={`date-${i}`} label={dateLabel} />);
        lastDateLabel = dateLabel;
        lastChannel = ""; // Reset channel tracking on new date
      }

      // Channel divider (only in "all" filter)
      if (filter === "all" && msg.channel !== lastChannel) {
        elements.push(
          <ChannelDivider
            key={`channel-${i}`}
            channel={msg.channel}
            subject={msg.channel === "email" ? msg.subject ?? undefined : undefined}
          />
        );
        lastChannel = msg.channel;
      } else if (msg.channel === "email" && msg.subject !== lastSubject) {
        // New email subject within same channel
        if (filter !== "portal") {
          elements.push(
            <ChannelDivider
              key={`subject-${i}`}
              channel="email"
              subject={msg.subject ?? undefined}
            />
          );
        }
      }

      if (msg.channel === "email") lastSubject = msg.subject ?? "";

      elements.push(
        <MessageBubble
          key={msg.id}
          message={msg}
          showTimestamp={shouldShowTimestamp(msg, prev)}
        />
      );
    });

    return elements;
  }, [messages, filter]);

  // Loading skeleton
  const MessageSkeleton = () => (
    <div className="flex justify-start">
      <div className="max-w-[65%] animate-pulse">
        <div className="bg-[rgba(255,255,255,0.04)] rounded-[3px] px-3 py-2.5 space-y-1.5">
          <div className="h-[14px] w-[200px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[14px] w-[150px] rounded bg-[rgba(255,255,255,0.04)]" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 font-kosugi text-[11px] font-semibold",
              conversation.type === "unmatched"
                ? "bg-[rgba(255,165,0,0.1)] text-[rgba(255,165,0,0.5)]"
                : "bg-[rgba(111,148,176,0.25)] text-[#6F94B0]"
            )}
          >
            {conversation.avatarInitials}
          </div>
          <div className="min-w-0">
            <h2 className="font-mohave text-[13px] text-text-primary font-semibold truncate">
              {conversation.displayName}
            </h2>
            <p className="font-kosugi text-[9px] text-text-disabled uppercase truncate">
              {conversation.projectName
                ? `${conversation.projectName} \u00b7 ${emailThreadIds.length + (conversation.hasPortalMessages ? 1 : 0)} threads`
                : `${emailThreadIds.length + (conversation.hasPortalMessages ? 1 : 0)} threads`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {conversation.type === "unmatched" && (
            <button className="flex items-center gap-1 px-2 py-1 rounded-[3px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] font-kosugi text-[9px] uppercase tracking-[0.3px] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
              <LinkIcon className="w-[10px] h-[10px]" />
              {t("unmatched.linkToClient")}
            </button>
          )}
          <button
            onClick={onToggleContext}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-[3px] border border-[rgba(255,255,255,0.06)] font-kosugi text-[9px] uppercase tracking-[0.3px] transition-colors",
              contextOpen
                ? "bg-[rgba(111,148,176,0.1)] text-[#6F94B0] border-[rgba(111,148,176,0.2)]"
                : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] hover:bg-[rgba(255,255,255,0.06)]"
            )}
          >
            <PanelRight className="w-[10px] h-[10px]" />
            {t("context.toggle")}
          </button>
        </div>
      </div>

      {/* Channel filter */}
      <ChannelFilterBar active={filter} onChange={setFilter} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-3.5 py-3 space-y-1.5">
        {isLoading && (
          <div className="space-y-3">
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </div>
        )}
        {!isLoading && renderedMessages}
      </div>

      {/* Reply bar */}
      {conversation.clientId && (
        <UnifiedReplyBar
          defaultChannel={conversation.lastMessageChannel}
          onSendPortal={(content) => sendPortalMutation.mutate(content)}
          onSendEmail={handleSendEmail}
          isSending={sendPortalMutation.isPending}
          hasEmailThreads={conversation.hasEmailThreads}
          hasPortalMessages={conversation.hasPortalMessages}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/inbox/unified-thread-view.tsx
git commit -m "feat(inbox): add unified thread view with bubbles, filters, and reply"
```

---

### Task 14: Rewrite inbox page

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the inbox page**

Replace the entire contents of `src/app/(dashboard)/inbox/page.tsx`:

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useUnifiedConversations } from "@/lib/hooks/use-unified-inbox";
import { usePipelineThreads } from "@/lib/hooks/use-inbox";
import { ConversationList } from "@/components/ops/inbox/conversation-list";
import { UnifiedThreadView } from "@/components/ops/inbox/unified-thread-view";
import { ContextPanel } from "@/components/ops/inbox/context-panel";
import { ResizableDivider } from "@/components/ops/inbox/resizable-divider";
import { ComposeEmailModal } from "@/components/ops/compose-email-modal";
import type { InboxConversation } from "@/lib/types/unified-inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

const LIST_MIN = 240;
const LIST_MAX = 400;
const LIST_DEFAULT = 300;
const STORAGE_KEY = "ops-inbox-list-width";

function getStoredWidth(): number {
  if (typeof window === "undefined") return LIST_DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= LIST_MIN && parsed <= LIST_MAX) return parsed;
  }
  return LIST_DEFAULT;
}

export default function InboxPage() {
  usePageTitle("Inbox");
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);

  const [listWidth, setListWidth] = useState(getStoredWidth);
  const [selectedConversation, setSelectedConversation] = useState<InboxConversation | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<ComposeEmailData | undefined>(undefined);

  // Data
  const { data: conversations = [], isLoading } = useUnifiedConversations();
  const { data: pipelineThreads = [] } = usePipelineThreads();

  // Auto-select first conversation
  useEffect(() => {
    if (!selectedConversation && conversations.length > 0) {
      setSelectedConversation(conversations[0]);
    }
  }, [conversations, selectedConversation]);

  // Get email thread IDs for the selected conversation's client
  const emailThreadIds = selectedConversation?.clientId
    ? pipelineThreads
        .filter((t) => t.clientId === selectedConversation.clientId)
        .map((t) => t.threadId)
    : [];

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleResize = useCallback((delta: number) => {
    setListWidth((prev) => {
      const next = Math.max(LIST_MIN, Math.min(LIST_MAX, prev + delta));
      return next;
    });
  }, []);

  const handleResizeEnd = useCallback(() => {
    setListWidth((current) => {
      localStorage.setItem(STORAGE_KEY, String(current));
      return current;
    });
  }, []);

  const handleSelectConversation = useCallback((conv: InboxConversation) => {
    setSelectedConversation(conv);
  }, []);

  const handleReply = useCallback((data: ComposeEmailData) => {
    setComposeData(data);
    setComposeOpen(true);
  }, []);

  const handleNewMessage = useCallback(() => {
    setComposeData({ mode: "new" });
    setComposeOpen(true);
  }, []);

  const handleToggleContext = useCallback(() => {
    setContextOpen((prev) => !prev);
  }, []);

  // Keyboard: Escape to close context panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextOpen) {
          setContextOpen(false);
        }
      }
      // Cmd+K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          '[placeholder]'
        );
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextOpen]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-68px)] flex rounded-[4px] border border-border bg-[rgba(255,255,255,0.02)] overflow-hidden">
      {/* Left: Conversation List */}
      <div style={{ width: listWidth, minWidth: listWidth }} className="shrink-0">
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedId={selectedConversation?.id ?? null}
          onSelect={handleSelectConversation}
          onNewMessage={handleNewMessage}
        />
      </div>

      {/* Resizable Divider */}
      <ResizableDivider onResize={handleResize} onResizeEnd={handleResizeEnd} />

      {/* Center: Thread View */}
      <div className="flex-1 min-w-0">
        {selectedConversation ? (
          <UnifiedThreadView
            conversation={selectedConversation}
            emailThreadIds={emailThreadIds}
            onToggleContext={handleToggleContext}
            contextOpen={contextOpen}
            onReply={handleReply}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="font-mohave text-body text-text-disabled">
              {t("empty.title")}
            </p>
          </div>
        )}
      </div>

      {/* Right: Context Panel */}
      <ContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        conversation={selectedConversation}
      />

      {/* Compose Email Modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        composeData={composeData}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/inbox/page.tsx
git commit -m "feat(inbox): rewrite inbox page as unified three-panel layout"
```

---

### Task 15: Update i18n dictionaries

**Files:**
- Modify: `src/i18n/dictionaries/en/inbox.json`
- Modify: `src/i18n/dictionaries/en/sidebar.json`

- [ ] **Step 1: Update English inbox dictionary**

Replace the entire contents of `src/i18n/dictionaries/en/inbox.json`:

```json
{
  "title": "Inbox",

  "filter.all": "All",
  "filter.email": "Email",
  "filter.portal": "Portal",

  "search.placeholder": "Search messages",
  "newMessage": "New Message",

  "context.toggle": "Context",
  "context.viewClient": "View Client",
  "context.createEstimate": "Create Estimate",
  "context.createProject": "Create Project",
  "context.projects": "Projects",
  "context.estimates": "Estimates",
  "context.invoices": "Invoices",

  "reply.placeholder": "Type a message...",
  "reply.send": "Send",
  "reply.viaPortal": "Portal",
  "reply.viaEmail": "Email",

  "channel.portal": "Client Portal",
  "channel.email": "Email",
  "channel.unmatched": "Unmatched",

  "unmatched.linkToClient": "Link to Client",
  "unmatched.ignore": "Ignore",
  "unmatched.createClient": "Create Client",

  "empty.title": "No conversations yet",
  "empty.description": "Messages from clients and email threads will appear here.",

  "date.today": "Today",
  "date.yesterday": "Yesterday",

  "thread.back": "Back to inbox",
  "thread.aiSummary": "AI Summary",
  "thread.reply": "Reply",
  "thread.markUnread": "Mark as unread",
  "thread.markRead": "Mark as read",
  "thread.noBody": "No message content available.",
  "thread.attachments": "attachments",

  "badge.unread": "new",
  "loading": "Loading...",
  "error": "Something went wrong. Try again."
}
```

- [ ] **Step 2: Remove portalInbox from sidebar dictionary**

In `src/i18n/dictionaries/en/sidebar.json`, remove the `"nav.portalInbox"` line.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/inbox.json src/i18n/dictionaries/en/sidebar.json
git commit -m "feat(inbox): update i18n dictionaries for unified inbox"
```

---

### Task 16: Update sidebar navigation

**Files:**
- Modify: `src/components/layouts/sidebar.tsx:67-93`

- [ ] **Step 1: Remove portal-inbox nav entry and update badge**

In `src/components/layouts/sidebar.tsx`, update the `buildNavItems` function. Remove the portal-inbox entry and update the inbox entry to require either permission:

```typescript
function buildNavItems(t: (key: string) => string, opts: BuildNavOpts = {}): NavEntry[] {
  return [
    { label: t("nav.dashboard"), href: "/dashboard", icon: LayoutDashboard },
    "divider",
    { label: t("nav.projects"), href: "/projects", icon: FolderKanban, permission: "projects.view" },
    { label: t("nav.calendar"), href: "/calendar", icon: CalendarDays, permission: "calendar.view" },
    { label: t("nav.clients"), href: "/clients", icon: Users, permission: "clients.view" },
    { label: t("nav.jobBoard"), href: "/job-board", icon: Columns3, permission: "job_board.view" },
    { label: t("nav.team"), href: "/team", icon: UserCog, permission: "team.view" },
    { label: t("nav.map"), href: "/map", icon: MapPin, permission: "map.view" },
    "divider",
    { label: t("nav.pipeline"), href: "/pipeline", icon: GitBranch, permission: "pipeline.view" },
    { label: t("nav.inbox"), href: "/inbox", icon: Mail, permission: "pipeline.view" },
    { label: t("nav.estimates"), href: "/estimates", icon: FileText, permission: "estimates.view" },
    { label: t("nav.invoices"), href: "/invoices", icon: Receipt, permission: "invoices.view" },
    "divider",
    { label: t("nav.products"), href: "/products", icon: Package, permission: "products.view" },
    ...(opts.inventoryAccess
      ? [{ label: t("nav.inventory"), href: "/inventory", icon: Boxes, permission: "inventory.view" } as NavItem]
      : []),
    { label: t("nav.accounting"), href: "/accounting", icon: Calculator, permission: "accounting.view" },
    "divider",
    { label: t("nav.intel"), href: "/intel", icon: Radar },
    "divider",
    { label: t("nav.settings"), href: "/settings", icon: Settings },
  ];
}
```

Note: The portal-inbox entry (`{ label: t("nav.portalInbox"), href: "/portal-inbox", ...}`) is removed entirely.

- [ ] **Step 2: Update the unread badge to use unified count**

In the same file, replace the `useInboxUnreadCount` import and usage. Change:

```typescript
import { useInboxUnreadCount } from "@/lib/hooks/use-inbox";
```

to:

```typescript
import { useUnifiedUnreadCount } from "@/lib/hooks/use-unified-inbox";
```

And update the hook call (around line 194):

```typescript
  const { data: inboxUnreadCount = 0 } = useUnifiedUnreadCount();
```

Also remove the `MessageSquareText` import from lucide-react (it's no longer used for the portal-inbox nav item).

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/layouts/sidebar.tsx
git commit -m "feat(inbox): unify sidebar nav — remove portal-inbox, use combined badge"
```

---

### Task 17: Clean up deleted files

**Files:**
- Delete: `src/app/(dashboard)/portal-inbox/page.tsx`
- Delete: `src/components/ops/portal-inbox.tsx`
- Delete: `src/components/ops/inbox/pipeline-thread-list.tsx`
- Delete: `src/components/ops/inbox/all-mail-list.tsx`

- [ ] **Step 1: Delete old files**

```bash
rm src/app/\(dashboard\)/portal-inbox/page.tsx
rm src/components/ops/portal-inbox.tsx
rm src/components/ops/inbox/pipeline-thread-list.tsx
rm src/components/ops/inbox/all-mail-list.tsx
```

- [ ] **Step 2: Remove any remaining imports of deleted files**

Search for imports of the deleted files and remove them:

```bash
grep -rn "portal-inbox\|pipeline-thread-list\|all-mail-list" src/ --include="*.ts" --include="*.tsx"
```

Fix any broken imports found.

- [ ] **Step 3: Verify the build**

Run: `npx tsc --noEmit`
Expected: PASS (no references to deleted files)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(inbox): remove old portal-inbox and separate list components"
```

---

### Task 18: Update Spanish i18n (if exists)

**Files:**
- Modify: `src/i18n/dictionaries/es/inbox.json` (if it exists)
- Modify: `src/i18n/dictionaries/es/sidebar.json` (if it exists)

- [ ] **Step 1: Check if Spanish dictionaries exist**

```bash
ls src/i18n/dictionaries/es/inbox.json src/i18n/dictionaries/es/sidebar.json 2>/dev/null
```

- [ ] **Step 2: If they exist, add the same keys with Spanish translations**

Mirror the new keys from the English inbox.json with Spanish translations. Remove `nav.portalInbox` from the Spanish sidebar.json.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/es/
git commit -m "feat(inbox): update Spanish translations for unified inbox"
```

---

### Task 19: Final verification

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 2: Run the dev server**

```bash
npm run dev
```

Navigate to `/inbox` and verify:
- Conversation list loads with both email and portal conversations merged
- Clicking a conversation shows chat bubbles
- Segmented picker (ALL/EMAIL/PORTAL) filters messages
- Reply bar shows channel selector
- Context panel toggles open/closed
- Resizable divider works
- Keyboard shortcuts work (arrow keys, Enter, Escape, Cmd+K)
- Sidebar shows single "Inbox" entry with combined unread badge
- `/portal-inbox` no longer exists in sidebar

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(inbox): address integration issues from unified inbox build"
```
