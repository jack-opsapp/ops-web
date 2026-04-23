# Unified Inbox — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Replaces:** `/inbox` (email-only) + `/portal-inbox` (portal messages) — two separate pages merged into one

---

## Problem

OPS has two disconnected inbox experiences:

1. **`/inbox`** — email threads (Pipeline tab + All Mail tab), backed by `activities` table and provider API
2. **`/portal-inbox`** — client portal messages, backed by `portal_messages` table

Users must check two different pages to see all client communication. The goal is to replace both — AND replace checking Gmail/Outlook — with a single unified inbox that feels like iMessage: familiar, fast, chat-bubble conversations regardless of channel.

---

## Decisions

| Question | Decision |
|----------|----------|
| Primary use case | Both reactive (responding to clients) and proactive (following up on deals). Replaces Gmail/Outlook as daily email client for business comms. |
| Thread grouping | Separate threads by channel, grouped by client. Email threads and portal messages stay distinct but appear under the same client. |
| Unmatched emails | Appear in the main list sorted by recency, with visual indicator (orange `?` avatar, `UNMATCHED` badge). No separate leads queue. |
| Reply channel | Stays in same channel automatically. New messages offer channel picker. |
| Client context | Full context panel (contact info, projects, estimates, invoices) — collapsed by default, expandable. |
| Channel filtering | Segmented picker: ALL / EMAIL / PORTAL. Sticky below thread header (pipeline tab-bar pattern). |
| Search | Search-first. Prominent search bar filtering across all messages. |
| Layout | Three-panel: persistent conversation list (left) + thread view (center) + context panel (right, collapsed). Resizable divider between list and thread. |

---

## Layout

### Three-Panel Structure

```
┌─────────────────┬────┬──────────────────────────────┬──────────────────┐
│  Conversation    │ ⋮⋮ │  Thread View                  │  Context Panel   │
│  List            │    │                                │  (collapsed)     │
│                  │    │  ┌────────────────────────┐   │                  │
│  [Search bar]    │ R  │  │ Header: Name + Project  │   │  Client info     │
│  [New Message]   │ E  │  ├────────────────────────┤   │  Projects        │
│                  │ S  │  │ [ALL] [EMAIL] [PORTAL] │   │  Estimates       │
│  ┌────────────┐  │ I  │  ├────────────────────────┤   │  Invoices        │
│  │ John Smith │◄─│ Z  │  │                        │   │  Quick actions   │
│  │ PORTAL 2m  │  │ E  │  │  ◄ inbound bubble      │   │                  │
│  ├────────────┤  │    │  │      outbound bubble ►  │   │                  │
│  │ Sarah J    │  │    │  │  ◄ inbound bubble      │   │                  │
│  │ EMAIL 1h   │  │    │  │                        │   │                  │
│  ├────────────┤  │    │  ├────────────────────────┤   │                  │
│  │ Mike T     │  │    │  │ [PORTAL ▾] [Type...]   │   │                  │
│  │ EMAIL 3h   │  │    │  │              [Send]    │   │                  │
│  └────────────┘  │    │  └────────────────────────┘   │                  │
└─────────────────┴────┴──────────────────────────────┴──────────────────┘
```

### Panel Dimensions

| Panel | Default | Min | Max |
|-------|---------|-----|-----|
| Conversation list | 300px | 240px | 400px |
| Thread view | fills remaining | — | — |
| Context panel | 320px | — | — (collapsed by default) |
| Resize handle | 4px | — | — |

### Resizable Divider

Visible grab indicator (2px × 32px, centered, `rgba(255,255,255,0.08)`). Cursor changes to `col-resize` on hover. Panel width persisted to `localStorage`.

---

## Conversation List (Left Panel)

### Search Bar

- Top of panel, always visible
- Searches: client name, email address, message content (preview text)
- Client-side filtering for instant results on loaded conversations
- Deep content search: Supabase full-text on `activities.content` + `portal_messages.content`
- Debounced 300ms

### "New Message" Button

- Below search bar
- Opens composer with channel picker (Email or Portal) + recipient fields

### Conversation Items

Sorted by `lastMessageAt` descending. Each item shows:

- **Avatar**: client initials (28px circle). Unmatched: `?` with orange tint
- **Client name**: Mohave font. Unmatched: italic email address
- **Project name**: Kosugi, if linked
- **Channel badge**: `EMAIL` (neutral) or `PORTAL` (accent) or `UNMATCHED` (orange)
- **Preview text**: truncated last message
- **Relative timestamp**: "2m", "1h", "3d"
- **Unread count badge**: accent circle with count (if > 0)

**States:**
- Active: left border `#6F94B0`, background `rgba(111,148,176,0.08)`
- Unread: full opacity, bold client name
- Read: reduced opacity (0.5)
- Unmatched: orange `?` avatar, `UNMATCHED` badge, italic name

### Unmatched Email Actions

When an unmatched conversation is selected, the thread header shows inline actions:
- "Link to Client" — opens client picker to associate
- "Ignore" — removes from inbox view

---

## Thread View (Center Panel)

### Header

- Client avatar (32px) + name (Mohave 13px) + project name (Kosugi 9px)
- Thread count indicator
- Actions: "Link to Client" (for unmatched), "Context" toggle button

### Sticky Segmented Picker

Positioned directly below header, sticky on scroll. Pipeline tab-bar pattern:
- Three segments: **ALL** / **EMAIL** / **PORTAL**
- Active segment: `rgba(111,148,176,0.2)` background + 2px bottom border `#6F94B0`
- Inactive: transparent, `rgba(255,255,255,0.35)` text
- Kosugi font, 9px, uppercase, letter-spacing 0.5px
- Container: `rgba(255,255,255,0.04)` background, `1px solid rgba(255,255,255,0.06)`, 3px radius

**Permission gating:**
- EMAIL tab requires `pipeline.view`
- PORTAL tab requires `portal.view`
- If only one permission: show only that tab + no picker needed
- ALL tab requires both permissions

### Chat Bubbles

All messages rendered as chat bubbles regardless of channel:

**Inbound (from client):**
- Left-aligned
- Background: `rgba(255,255,255,0.05)`
- Border: `1px solid rgba(255,255,255,0.06)`
- Border-radius: `3px 3px 3px 1px`
- Max-width: 65%

**Outbound (from company):**
- Right-aligned
- Background: `rgba(111,148,176,0.12)`
- Border: `1px solid rgba(111,148,176,0.18)`
- Border-radius: `3px 3px 1px 3px`
- Max-width: 65%

**Timestamp display:**
- Below each bubble, small text (9px)
- Consecutive same-sender messages within 5 minutes: only show timestamp on last message
- Email messages also show sender email below timestamp on inbound

### Channel Dividers

When the "ALL" filter is active, inline dividers appear when messages switch channels:

**Email thread divider:**
```
[mail-icon] RE: DECK ESTIMATE — CEDAR PRICING ─────────
```

**Portal divider:**
```
[message-icon] CLIENT PORTAL ───────────────────────────
```

- Kosugi font, 8px, uppercase, letter-spacing 0.5px
- Email dividers: `rgba(255,255,255,0.2)` color
- Portal dividers: `rgba(111,148,176,0.5)` color
- 1px separator line extending to fill width

### Date Separators

```
────────── TODAY ──────────
────────── YESTERDAY ──────────
────────── MAR 27 ──────────
```

- Kosugi font, 9px, uppercase, `rgba(255,255,255,0.15)`
- 1px lines: `rgba(255,255,255,0.04)`

---

## Reply Bar

- Fixed at bottom of thread view
- Channel selector: small dropdown defaulting to last message's channel
  - Shows icon + channel name + dropdown arrow
  - Portal: `rgba(111,148,176,0.08)` background, portal icon
  - Email: neutral background, mail icon
- Text input: `rgba(255,255,255,0.04)` background, 1px border
- Attach button (paperclip icon)
- Send button: `#6F94B0` background, Kosugi font

**Channel-specific behavior:**
- **Portal reply**: direct Supabase insert via `PortalMessageService.sendMessage()`. Inline, instant.
- **Email reply**: opens `ComposeEmailModal` pre-filled with thread context (`ComposeEmailData` with `mode: "reply"`, `threadId`, `to`, `subject`, `quotedMessage`). This preserves the full email compose experience (CC, templates, merge fields).
- **New Message (email)**: opens `ComposeEmailModal` with `mode: "new"`
- **New Message (portal)**: need client selection first, then inline compose

---

## Context Panel (Right Panel)

Collapsed by default. Toggled via "Context" button in thread header. Slides in from right with animation (`EASE_SMOOTH = [0.22, 1, 0.36, 1]`, 200ms).

**Contents:**
- Client name + avatar (large)
- Phone number (click to call)
- Email address (click to copy)
- **Linked Projects**: list with status badges, click to navigate
- **Recent Estimates**: last 3, with status (draft/sent/approved/rejected)
- **Recent Invoices**: last 3, with status (draft/sent/paid/overdue)
- **Quick Actions**: "View Client Profile", "Create Estimate", "Create Project"

**For unmatched conversations:**
- Shows email address only
- Actions: "Create Client", "Link to Existing Client", "Ignore"

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate conversation list |
| `Enter` / `→` | Open selected conversation |
| `Escape` | Close context panel (if open), otherwise deselect conversation |
| `Cmd+K` | Focus search bar |

---

## Data Model

### New Types (extend `src/lib/types/inbox.ts`)

```typescript
export type ChannelFilter = "all" | "email" | "portal";

export interface InboxConversation {
  id: string;                           // clientId or email address hash for unmatched
  type: "client" | "unmatched";
  clientId: string | null;              // null for unmatched
  displayName: string;                  // client name or email address
  projectName: string | null;           // first linked project name
  avatarInitials: string;               // "JS", "?", etc.
  lastMessageAt: Date;
  lastMessagePreview: string;
  lastMessageChannel: "email" | "portal";
  unreadCount: number;                  // combined across channels
  hasEmailThreads: boolean;
  hasPortalMessages: boolean;
}

export interface InboxMessage {
  id: string;
  channel: "email" | "portal";
  direction: "inbound" | "outbound";
  senderName: string;
  senderEmail: string | null;
  content: string;                      // rendered content (bodyText for email, content for portal)
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

### Existing Type Extension

`PipelineThread` in `src/lib/types/inbox.ts` needs one new field:

```typescript
// Add to existing PipelineThread interface:
clientId: string | null;    // from opportunity.client_id — already fetched, just not mapped
```

`InboxService.getPipelineThreads()` already joins `opportunities.client_id` — the mapping in the service just needs to pass it through to the return type.

### No Database Migration

This is a UI-layer normalization. Both `activities` and `portal_messages` tables stay as-is. The new hooks fetch from both existing services and normalize into the types above.

---

## Data Fetching

### `useUnifiedConversations(searchQuery?: string)`

1. Fetches in parallel:
   - `InboxService.getPipelineThreads(companyId)` → `PipelineThread[]`
   - `PortalMessageService.getConversations(companyId)` → portal conversation list
   - `useAllMail()` for non-pipeline emails (provider API)
2. Groups by client:
   - Pipeline threads are matched to portal conversations by `clientId`
   - **Note:** `PipelineThread` currently only exposes `clientName`, not `clientId`. The `InboxService.getPipelineThreads()` method must be extended to also return `clientId` (already available from the `opportunity.client_id` join — just not mapped to the return type). Add `clientId: string | null` to `PipelineThread` interface.
   - Unmatched emails (from All Mail without a pipeline thread) become `type: "unmatched"`
3. Normalizes into `InboxConversation[]`
4. Applies search filter (client-side on name/email/preview)
5. Sorts by `lastMessageAt` descending
6. Polls every 30s

### `useUnifiedThread(conversationId: string, filter: ChannelFilter)`

1. For client conversations: fetches both email thread messages and portal messages in parallel
   - Email: `InboxService.getThreadMessages(companyId, emailThreadId)` for each thread
   - Portal: `PortalMessageService.getMessages(clientId, companyId)`
2. Normalizes all into `InboxMessage[]`
3. Applies channel filter
4. Sorts chronologically (ascending — newest at bottom)
5. Polls every 15s

### `useUnifiedUnreadCount()`

- `InboxService.getUnreadCount(companyId)` + `PortalMessageService.getUnreadCountForCompany(companyId)`
- Returns combined total
- Polls every 60s (matches current `useInboxUnreadCount` interval)

### Query Keys (extend `queryKeys.inbox` in `query-client.ts`)

```typescript
queryKeys.inbox = {
  ...existing,
  portalConversations: (companyId: string) => [...queryKeys.inbox.all, "portal-conversations", companyId] as const,
  portalMessages: (companyId: string, clientId: string) => [...queryKeys.inbox.all, "portal-messages", companyId, clientId] as const,
  portalUnread: (companyId: string) => [...queryKeys.inbox.all, "portal-unread", companyId] as const,
  unified: (companyId: string) => [...queryKeys.inbox.all, "unified", companyId] as const,
}
```

---

## Component Architecture

### New Files

```
src/app/(dashboard)/inbox/page.tsx              — REWRITE: unified inbox page
src/components/ops/inbox/
  ├── conversation-list.tsx                     — left panel (search + list)
  ├── conversation-item.tsx                     — single conversation row
  ├── unified-thread-view.tsx                   — center panel (header + picker + bubbles + reply)
  ├── message-bubble.tsx                        — single chat bubble
  ├── channel-divider.tsx                       — inline channel separator
  ├── channel-filter.tsx                        — sticky segmented picker
  ├── unified-reply-bar.tsx                     — reply input with channel selector
  ├── context-panel.tsx                         — right panel (client context)
  └── resizable-divider.tsx                     — drag handle between panels
src/lib/hooks/use-unified-inbox.ts              — unified data hooks
src/lib/types/inbox.ts                          — EXTEND: add unified types
```

### Modified Files

```
src/components/layouts/sidebar.tsx              — remove /portal-inbox, update badge
src/lib/api/query-client.ts                     — add portal query keys
src/i18n/dictionaries/en/inbox.json             — add unified inbox keys
src/i18n/dictionaries/en/sidebar.json           — remove nav.portalInbox
src/i18n/dictionaries/es/inbox.json             — add Spanish translations
src/i18n/dictionaries/es/sidebar.json           — remove nav.portalInbox
```

### Deleted Files (after migration)

```
src/app/(dashboard)/portal-inbox/page.tsx       — replaced by unified inbox
src/components/ops/portal-inbox.tsx             — components migrated
src/components/ops/inbox/pipeline-thread-list.tsx — replaced by conversation-list
src/components/ops/inbox/all-mail-list.tsx       — replaced by conversation-list
```

### Kept Unchanged

```
src/lib/api/services/inbox-service.ts           — consumed by new hooks
src/lib/api/services/portal-message-service.ts  — consumed by new hooks
src/lib/hooks/use-inbox.ts                      — consumed by new hooks
src/lib/hooks/use-portal-messages.ts            — consumed by new hooks
src/components/ops/compose-email-modal.tsx       — used for email replies
src/components/ops/inbox/thread-view.tsx         — may be reused for email rendering
```

---

## Navigation & Routing

- **Sidebar**: single "Inbox" entry at `/inbox` with `Mail` icon
  - Badge: combined unread count from `useUnifiedUnreadCount()`
  - Requires: `pipeline.view` OR `portal.view`
- **`/portal-inbox`**: redirect to `/inbox` (temporary, then remove route)
- **Permissions**:
  - EMAIL tab: `pipeline.view`
  - PORTAL tab: `portal.view`
  - If only one permission: picker hidden, shows only that channel

---

## i18n Keys to Add

```json
{
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
  "date.yesterday": "Yesterday"
}
```

---

## Design System Compliance

All styling follows `CLAUDE.md` and the OPS design system:

| Property | Value |
|----------|-------|
| Surfaces | `rgba(10, 10, 10, 0.70)` + `backdrop-blur(20px) saturate(1.2)` |
| Borders | `1px solid rgba(255,255,255,0.08)` |
| Accent | `#6F94B0` — used for active states, outbound bubbles, unread badges |
| Border radius | 3px (bubbles, inputs, buttons) — sharp, not rounded |
| Depth | Borders-only, no shadows |
| Text alignment | Left-aligned only |
| Headings | Mohave font |
| Labels/metadata | Kosugi font, uppercase, letter-spacing |
| Animation easing | `EASE_SMOOTH = [0.22, 1, 0.36, 1]` |
| Icons | Lucide React |
