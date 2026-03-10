# Header Notification Rail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the TopBar's left-side page action buttons with a notification rail that shows collapsed pills or expanded mini cards, with a full modal view.

**Architecture:** A horizontal notification rail component in the TopBar left zone reads from the existing Supabase `notifications` table via a TanStack Query hook. A Zustand store manages collapsed/expanded/modal UI state. Framer Motion handles all transitions. The bell icon triggers the modal. Page action buttons are removed (FAB covers those actions). The notification data model is extended with `persistent`, `action_url`, and `action_label` columns.

**Tech Stack:** Next.js 14, Framer Motion, TanStack Query, Zustand, Supabase, Lucide icons, Tailwind CSS

**Design doc:** `docs/plans/2026-03-09-notification-rail-design.md`

**Design system:** `.interface-design/system.md` — frosted glass surfaces, `#597794` accent (sparingly), Mohave body, Kosugi labels, 2-4px radius, borders-only depth, `EASE_SMOOTH` easing, no spring/bounce, left-aligned text only

---

### Task 1: Database Migration — Add Notification Columns

**Files:**
- Migration: Run via Supabase MCP tool (no migration file needed)

**Step 1: Run the migration**

Execute this SQL against the Supabase database:

```sql
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS persistent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS action_label TEXT DEFAULT NULL;

COMMENT ON COLUMN notifications.persistent IS 'If true, notification cannot be dismissed — stays until resolved programmatically';
COMMENT ON COLUMN notifications.action_url IS 'Optional deep-link URL for click-through (e.g. /projects/abc)';
COMMENT ON COLUMN notifications.action_label IS 'Optional button label for action (e.g. View Results)';
```

**Step 2: Verify the migration**

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'notifications'
ORDER BY ordinal_position;
```

Expected: `persistent`, `action_url`, `action_label` columns present.

**Step 3: Commit**

```bash
git add -A && git commit -m "chore: add persistent, action_url, action_label columns to notifications table"
```

---

### Task 2: Extend Notification Service Types + Fetch Logic

**Files:**
- Modify: `src/lib/api/services/notification-service.ts`

**Step 1: Update the `AppNotification` interface and mapper**

Replace the entire file content:

```typescript
import { requireSupabase } from "@/lib/supabase/helpers";

export interface AppNotification {
  id: string;
  userId: string;
  companyId: string;
  type: "mention" | "role_needed";
  title: string;
  body: string;
  projectId: string | null;
  noteId: string | null;
  isRead: boolean;
  persistent: boolean;
  actionUrl: string | null;
  actionLabel: string | null;
  createdAt: Date;
}

function mapRow(row: Record<string, unknown>): AppNotification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    type: row.type as "mention" | "role_needed",
    title: row.title as string,
    body: row.body as string,
    projectId: row.project_id as string | null,
    noteId: row.note_id as string | null,
    isRead: row.is_read as boolean,
    persistent: (row.persistent as boolean) ?? false,
    actionUrl: row.action_url as string | null,
    actionLabel: row.action_label as string | null,
    createdAt: new Date(row.created_at as string),
  };
}

export const NotificationService = {
  async createMentionNotifications(params: {
    mentionedUserIds: string[];
    authorName: string;
    projectId: string;
    projectTitle: string;
    noteId: string;
    companyId: string;
  }): Promise<void> {
    if (params.mentionedUserIds.length === 0) return;

    const supabase = requireSupabase();
    const rows = params.mentionedUserIds.map((userId) => ({
      user_id: userId,
      company_id: params.companyId,
      type: "mention" as const,
      title: `${params.authorName} mentioned you`,
      body: `You were mentioned in a note on ${params.projectTitle}`,
      project_id: params.projectId,
      note_id: params.noteId,
      is_read: false,
    }));

    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      console.error("Failed to create mention notifications:", error);
    }
  },

  async fetchUnread(
    userId: string,
    companyId: string
  ): Promise<AppNotification[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async markAsRead(notificationId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
    if (error) throw error;
  },

  async markAllAsRead(userId: string, companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false);
    if (error) throw error;
  },

  async dismissAllDismissible(userId: string, companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_read", false)
      .eq("persistent", false);
    if (error) throw error;
  },
};
```

Key changes:
- Added `persistent`, `actionUrl`, `actionLabel` to interface
- Extracted `mapRow` helper
- Changed `fetchUnread` to `ascending: true` (oldest first for left-to-right stacking) and limit 50
- Added `markAllAsRead()` and `dismissAllDismissible()` methods

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to notification-service.

**Step 3: Commit**

```bash
git add src/lib/api/services/notification-service.ts
git commit -m "feat: extend notification service with persistent, actionUrl, actionLabel fields"
```

---

### Task 3: Add Query Keys + TanStack Query Hook

**Files:**
- Modify: `src/lib/api/query-client.ts` (add notifications query keys)
- Create: `src/lib/hooks/use-notifications.ts`

**Step 1: Add query keys to query-client.ts**

Find the `notificationPreferences` block in `src/lib/api/query-client.ts` and add a `notifications` key block directly BEFORE it:

```typescript
  // Notifications
  notifications: {
    all: ["notifications"] as const,
    unread: (userId: string, companyId: string) =>
      [...queryKeys.notifications.all, "unread", userId, companyId] as const,
  },
```

**Step 2: Create the hook**

Create `src/lib/hooks/use-notifications.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { NotificationService, type AppNotification } from "../api/services/notification-service";
import { useAuthStore } from "../store/auth-store";

/**
 * Fetch unread notifications for the current user.
 * Auto-refetches on window focus, stale after 30s.
 */
export function useNotifications() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.notifications.unread(userId, companyId),
    queryFn: () => NotificationService.fetchUnread(userId, companyId),
    enabled: !!userId && !!companyId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Dismiss (mark as read) a single notification with optimistic update.
 */
export function useDismissNotification() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications.unread(userId, companyId);

  return useMutation({
    mutationFn: (notificationId: string) =>
      NotificationService.markAsRead(notificationId),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey);
      queryClient.setQueryData<AppNotification[]>(queryKey, (old) =>
        old?.filter((n) => n.id !== notificationId) ?? []
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Dismiss all non-persistent notifications with optimistic update.
 */
export function useDismissAllNotifications() {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications.unread(userId, companyId);

  return useMutation({
    mutationFn: () =>
      NotificationService.dismissAllDismissible(userId, companyId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey);
      queryClient.setQueryData<AppNotification[]>(queryKey, (old) =>
        old?.filter((n) => n.persistent) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
```

**Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add src/lib/api/query-client.ts src/lib/hooks/use-notifications.ts
git commit -m "feat: add useNotifications hook with optimistic dismiss mutations"
```

---

### Task 4: Add Animation Variants to motion.ts

**Files:**
- Modify: `src/lib/utils/motion.ts`

**Step 1: Append notification animation variants at the end of the file**

Add after the last existing export:

```typescript
// ── Notification rail animations ──

/** Notification pill enter/exit — width animates for smooth gap filling */
export const notifPillVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6, width: 0 },
  visible: { opacity: 1, scale: 1, width: 6, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.6, width: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** Mini card enter/exit (expanded rail) — stagger index via custom prop */
export const notifCardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, x: -8 },
  visible: (i: number) => ({
    opacity: 1, scale: 1, x: 0,
    transition: { delay: i * 0.03, duration: 0.25, ease: EASE_SMOOTH },
  }),
  exit: { opacity: 0, x: -12, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** Full card dismiss (modal) — height collapse for layout shift */
export const notifCardFullVariants: Variants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: "auto", transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

/** Modal entrance/exit */
export const notifModalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.97, y: -8, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

/** Modal backdrop */
export const notifBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** Reduced-motion fallbacks — opacity only */
export const notifPillVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const notifCardVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.02, duration: 0.15 },
  }),
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const notifModalVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/lib/utils/motion.ts
git commit -m "feat: add notification rail animation variants with reduced-motion fallbacks"
```

---

### Task 5: Create Notification Rail Store

**Files:**
- Create: `src/stores/notification-rail-store.ts`

**Step 1: Create the store**

```typescript
"use client";

import { create } from "zustand";

interface NotificationRailState {
  railState: "collapsed" | "expanded";
  modalOpen: boolean;
  expand: () => void;
  collapse: () => void;
  toggleRail: () => void;
  openModal: () => void;
  closeModal: () => void;
}

export const useNotificationRailStore = create<NotificationRailState>()(
  (set) => ({
    railState: "collapsed",
    modalOpen: false,
    expand: () => set({ railState: "expanded" }),
    collapse: () => set({ railState: "collapsed" }),
    toggleRail: () =>
      set((s) => ({
        railState: s.railState === "collapsed" ? "expanded" : "collapsed",
      })),
    openModal: () => set({ modalOpen: true }),
    closeModal: () => set({ modalOpen: false }),
  })
);
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/stores/notification-rail-store.ts
git commit -m "feat: add notification rail Zustand store"
```

---

### Task 6: Add i18n Keys

**Files:**
- Modify: `src/i18n/dictionaries/en/topbar.json`
- Modify: `src/i18n/dictionaries/es/topbar.json`

**Step 1: Update English topbar.json**

Replace entire file:

```json
{
  "sync.synced": "Synced",
  "sync.syncing": "Syncing",
  "sync.pending": "Pending",
  "sync.offline": "Offline",
  "sync.syncedTitle": "All data synced",
  "sync.syncingTitle": "Syncing data...",
  "sync.pendingTitle": "Changes pending sync",
  "sync.offlineTitle": "No internet connection",

  "search.placeholder": "Search...",
  "search.shortcut": "⌘K",
  "search.ariaLabel": "Open search",

  "notifications.title": "Notifications",
  "notifications.ariaLabel": "Notifications",
  "notifications.viewAll": "View all",
  "notifications.dismissAll": "Dismiss all",
  "notifications.empty": "No notifications",
  "notifications.today": "Today",
  "notifications.yesterday": "Yesterday",
  "notifications.earlier": "Earlier",
  "notifications.count": "{count}",
  "notifications.overflow": "+{count}"
}
```

**Step 2: Update Spanish topbar.json**

Replace entire file:

```json
{
  "sync.synced": "Sincronizado",
  "sync.syncing": "Sincronizando",
  "sync.pending": "Pendiente",
  "sync.offline": "Sin conexión",
  "sync.syncedTitle": "Todos los datos sincronizados",
  "sync.syncingTitle": "Sincronizando datos...",
  "sync.pendingTitle": "Cambios pendientes de sincronizar",
  "sync.offlineTitle": "Sin conexión a internet",

  "search.placeholder": "Buscar...",
  "search.shortcut": "⌘K",
  "search.ariaLabel": "Abrir búsqueda",

  "notifications.title": "Notificaciones",
  "notifications.ariaLabel": "Notificaciones",
  "notifications.viewAll": "Ver todo",
  "notifications.dismissAll": "Descartar todo",
  "notifications.empty": "Sin notificaciones",
  "notifications.today": "Hoy",
  "notifications.yesterday": "Ayer",
  "notifications.earlier": "Anteriores",
  "notifications.count": "{count}",
  "notifications.overflow": "+{count}"
}
```

**Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/topbar.json src/i18n/dictionaries/es/topbar.json
git commit -m "feat: add notification rail i18n keys (en + es)"
```

---

### Task 7: Build NotificationPill Component

**Files:**
- Create: `src/components/layouts/notification-pill.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { motion } from "framer-motion";
import { notifPillVariants, notifPillVariantsReduced } from "@/lib/utils/motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface NotificationPillProps {
  persistent: boolean;
  layoutId: string;
}

export function NotificationPill({ persistent, layoutId }: NotificationPillProps) {
  const reducedMotion = useReducedMotion();
  const variants = reducedMotion ? notifPillVariantsReduced : notifPillVariants;

  return (
    <motion.div
      layout
      layoutId={layoutId}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="shrink-0 h-[14px] rounded-full"
      style={{
        width: 6,
        backgroundColor: persistent
          ? "#597794"
          : "rgba(255, 255, 255, 0.20)",
      }}
    />
  );
}
```

**Note:** Check if `use-reduced-motion` hook exists. If not, use `import { useReducedMotion } from "framer-motion"` instead (Framer Motion provides this natively). Adjust the import accordingly.

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/notification-pill.tsx
git commit -m "feat: add NotificationPill component"
```

---

### Task 8: Build NotificationMiniCard Component

**Files:**
- Create: `src/components/layouts/notification-mini-card.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardVariants, notifCardVariantsReduced } from "@/lib/utils/motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { AppNotification } from "@/lib/api/services/notification-service";

interface NotificationMiniCardProps {
  notification: AppNotification;
  index: number;
  onDismiss: (id: string) => void;
}

export function NotificationMiniCard({
  notification,
  index,
  onDismiss,
}: NotificationMiniCardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const variants = reducedMotion ? notifCardVariantsReduced : notifCardVariants;

  return (
    <motion.div
      layout
      layoutId={`notif-${notification.id}`}
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      custom={index}
      className="shrink-0 flex items-center gap-[6px] h-[36px] px-[8px] rounded-sm snap-start"
      style={{
        width: 180,
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderLeft: notification.persistent
          ? "2px solid #597794"
          : "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Title */}
      <span className="font-mohave text-[12px] text-text-primary truncate flex-1 text-left">
        {notification.title}
      </span>

      {/* Action button */}
      {notification.actionLabel && notification.actionUrl && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(notification.actionUrl!);
          }}
          className="shrink-0 font-kosugi text-[9px] uppercase tracking-wider text-[#597794] hover:text-text-primary transition-colors duration-150"
        >
          {notification.actionLabel}
        </button>
      )}

      {/* Dismiss button — only on non-persistent */}
      {!notification.persistent && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="shrink-0 p-[2px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}
    </motion.div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/notification-mini-card.tsx
git commit -m "feat: add NotificationMiniCard component"
```

---

### Task 9: Build NotificationCardFull Component

**Files:**
- Create: `src/components/layouts/notification-card-full.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifCardFullVariants } from "@/lib/utils/motion";
import type { AppNotification } from "@/lib/api/services/notification-service";

interface NotificationCardFullProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1d ago";
  return `${diffDays}d ago`;
}

export function NotificationCardFull({
  notification,
  onDismiss,
}: NotificationCardFullProps) {
  const router = useRouter();

  return (
    <motion.div
      layout
      variants={notifCardFullVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="relative px-[12px] py-[10px] border-b border-[rgba(255,255,255,0.06)]"
      style={{
        borderLeft: notification.persistent
          ? "2px solid #597794"
          : undefined,
      }}
    >
      {/* Dismiss X — top right, only non-persistent */}
      {!notification.persistent && (
        <button
          onClick={() => onDismiss(notification.id)}
          className="absolute top-[8px] right-[8px] p-[2px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
          aria-label="Dismiss"
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}

      {/* Row 1: Title + timestamp */}
      <div className="flex items-center gap-[8px] pr-[20px]">
        <span className="font-mohave text-body-sm text-text-primary text-left flex-1">
          {notification.title}
        </span>
        <span className="font-mono text-[10px] text-text-disabled shrink-0">
          {formatTimestamp(notification.createdAt)}
        </span>
      </div>

      {/* Row 2: Body */}
      {notification.body && (
        <p className="font-mohave text-[12px] text-text-secondary text-left line-clamp-2 mt-[2px]">
          {notification.body}
        </p>
      )}

      {/* Row 3: Action button */}
      {notification.actionLabel && notification.actionUrl && (
        <button
          onClick={() => router.push(notification.actionUrl!)}
          className="font-kosugi text-[10px] uppercase tracking-wider text-[#597794] hover:text-text-primary transition-colors duration-150 mt-[4px]"
        >
          {notification.actionLabel}
        </button>
      )}
    </motion.div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/notification-card-full.tsx
git commit -m "feat: add NotificationCardFull component for modal view"
```

---

### Task 10: Build NotificationModal Component

**Files:**
- Create: `src/components/layouts/notification-modal.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { notifModalVariants, notifBackdropVariants, EASE_SMOOTH } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification, useDismissAllNotifications } from "@/lib/hooks/use-notifications";
import { NotificationCardFull } from "./notification-card-full";
import { useDictionary } from "@/i18n/client";
import type { AppNotification } from "@/lib/api/services/notification-service";

function groupByDate(
  notifications: AppNotification[],
  t: (key: string) => string
): { label: string; items: AppNotification[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);

  const groups: Record<string, AppNotification[]> = {};
  const order: string[] = [];

  for (const n of notifications) {
    const created = new Date(n.createdAt);
    let label: string;
    if (created >= today) {
      label = t("notifications.today");
    } else if (created >= yesterday) {
      label = t("notifications.yesterday");
    } else {
      label = t("notifications.earlier");
    }
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(n);
  }

  return order.map((label) => ({ label, items: groups[label] }));
}

export function NotificationModal() {
  const { t } = useDictionary("topbar");
  const { modalOpen, closeModal } = useNotificationRailStore();
  const { data: notifications = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const dismissAllMutation = useDismissAllNotifications();

  // Sort newest first for modal view
  const sorted = useMemo(
    () => [...notifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [notifications]
  );

  const grouped = useMemo(() => groupByDate(sorted, t), [sorted, t]);

  const hasDismissible = sorted.some((n) => !n.persistent);

  const handleDismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

  const handleDismissAll = useCallback(
    () => dismissAllMutation.mutate(),
    [dismissAllMutation]
  );

  return (
    <AnimatePresence>
      {modalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={notifBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[100]"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
            onClick={closeModal}
          />

          {/* Modal */}
          <motion.div
            variants={notifModalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed z-[101] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[480px] max-h-[70vh] flex flex-col rounded-sm"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-[12px] py-[10px] border-b border-[rgba(255,255,255,0.08)] shrink-0">
              <h2 className="font-mohave text-body-lg text-text-primary font-medium text-left">
                {t("notifications.title")}
              </h2>
              <div className="flex items-center gap-[8px]">
                {hasDismissible && (
                  <button
                    onClick={handleDismissAll}
                    className="font-kosugi text-[10px] uppercase tracking-wider text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  >
                    {t("notifications.dismissAll")}
                  </button>
                )}
                <button
                  onClick={closeModal}
                  className="p-[4px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
                  aria-label="Close"
                >
                  <X className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
              {sorted.length === 0 ? (
                <div className="px-[12px] py-[24px]">
                  <p className="font-mohave text-body-sm text-text-disabled text-left">
                    {t("notifications.empty")}
                  </p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {grouped.map((group) => (
                    <div key={group.label}>
                      {/* Group label */}
                      <div className="px-[12px] pt-[10px] pb-[4px]">
                        <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-tertiary">
                          {group.label}
                        </span>
                      </div>

                      {/* Cards */}
                      {group.items.map((n) => (
                        <NotificationCardFull
                          key={n.id}
                          notification={n}
                          onDismiss={handleDismiss}
                        />
                      ))}
                    </div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/notification-modal.tsx
git commit -m "feat: add NotificationModal with grouped cards and dismiss-all"
```

---

### Task 11: Build NotificationRail Component

**Files:**
- Create: `src/components/layouts/notification-rail.tsx`

**Step 1: Create the component**

This is the main container that renders in the TopBar left zone.

```typescript
"use client";

import { useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { NotificationPill } from "./notification-pill";
import { NotificationMiniCard } from "./notification-mini-card";
import { useDictionary } from "@/i18n/client";

const MAX_VISIBLE_PILLS = 15;

export function NotificationRail() {
  const { t } = useDictionary("topbar");
  const { railState, expand, collapse, openModal } = useNotificationRailStore();
  const { data: notifications = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const railRef = useRef<HTMLDivElement>(null);

  const isExpanded = railState === "expanded";
  const count = notifications.length;

  const handleDismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

  // Click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        collapse();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, collapse]);

  if (count === 0) return null;

  const visiblePills = notifications.slice(0, MAX_VISIBLE_PILLS);
  const overflowCount = count - MAX_VISIBLE_PILLS;

  return (
    <div ref={railRef} className="flex items-center gap-[3px] h-[40px]">
      <AnimatePresence mode="popLayout">
        {isExpanded ? (
          <>
            {/* Collapse chevron */}
            <motion.button
              key="collapse-btn"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              onClick={collapse}
              className="shrink-0 p-[4px] text-text-disabled hover:text-text-secondary transition-colors duration-150"
              aria-label="Collapse notifications"
            >
              <ChevronLeft className="w-[14px] h-[14px]" />
            </motion.button>

            {/* Scrollable mini cards */}
            <div className="flex items-center gap-[6px] overflow-x-auto scrollbar-hide snap-x snap-mandatory pr-[4px]">
              {notifications.map((n, i) => (
                <NotificationMiniCard
                  key={n.id}
                  notification={n}
                  index={i}
                  onDismiss={handleDismiss}
                />
              ))}

              {/* View all button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.2, ease: EASE_SMOOTH }}
                onClick={openModal}
                className="shrink-0 font-kosugi text-[9px] uppercase tracking-wider text-text-disabled hover:text-text-secondary transition-colors duration-150 px-[8px] snap-start whitespace-nowrap"
              >
                {t("notifications.viewAll")}
              </motion.button>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed pills — click to expand */}
            <motion.button
              key="pill-row"
              className="flex items-center gap-[3px] py-[4px] px-[4px] rounded-sm hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 cursor-pointer"
              onClick={expand}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              aria-label={`${count} notifications — click to expand`}
            >
              {visiblePills.map((n) => (
                <NotificationPill
                  key={n.id}
                  persistent={n.persistent}
                  layoutId={`notif-pill-${n.id}`}
                />
              ))}

              {overflowCount > 0 && (
                <span className="font-mono text-[9px] text-text-disabled ml-[2px]">
                  +{overflowCount}
                </span>
              )}
            </motion.button>

            {/* Count label */}
            <span className="font-mono text-[10px] text-text-disabled ml-[4px]">
              {count}
            </span>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/notification-rail.tsx
git commit -m "feat: add NotificationRail with collapsed pills and expanded cards"
```

---

### Task 12: Update TopBar — Remove Page Actions, Add Rail + Bell Handler

**Files:**
- Modify: `src/components/layouts/top-bar.tsx`

**Step 1: Rewrite the TopBar**

Replace the entire file:

```typescript
"use client";

import {
  Search,
  Bell,
  RefreshCw,
  Check,
  Clock,
  WifiOff,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useConnectivity } from "@/lib/hooks/use-connectivity";
import { useDictionary } from "@/i18n/client";
import { NotificationRail } from "./notification-rail";

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({ status, t }: { status: SyncStatus; t: (key: string) => string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-1 py-[6px] rounded",
        "font-mono text-[11px] tracking-wider",
        status === "offline" ? "text-ops-error" : "text-text-tertiary"
      )}
      title={
        status === "synced"
          ? t("sync.syncedTitle")
          : status === "syncing"
            ? t("sync.syncingTitle")
            : status === "offline"
              ? t("sync.offlineTitle")
              : t("sync.pendingTitle")
      }
    >
      {status === "synced" && (
        <>
          <Check className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.synced")}</span>
        </>
      )}
      {status === "syncing" && (
        <>
          <RefreshCw className="w-[14px] h-[14px] animate-spin" />
          <span className="hidden xl:inline uppercase">{t("sync.syncing")}</span>
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.pending")}</span>
        </>
      )}
      {status === "offline" && (
        <>
          <WifiOff className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.offline")}</span>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const { t } = useDictionary("topbar");
  const openModal = useNotificationRailStore((s) => s.openModal);
  const { data: notifications = [] } = useNotifications();
  const unreadCount = notifications.length;

  // Live sync status from TanStack Query + connectivity
  const isOnline = useConnectivity();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const syncStatus: SyncStatus = !isOnline
    ? "offline"
    : isMutating > 0
      ? "pending"
      : isFetching > 0
        ? "syncing"
        : "synced";

  return (
    <header className="h-[56px] flex items-center justify-between px-3 shrink-0 relative bg-transparent">
      {/* Left: Notification Rail */}
      <NotificationRail />

      {/* Right: Search + Sync + Notifications Bell */}
      <div className="flex items-center gap-1">
        {/* Search trigger */}
        <button
          className={cn(
            "flex items-center gap-[6px] px-1.5 py-[8px] rounded",
            "bg-[rgba(10,10,10,0.40)] backdrop-blur-sm border border-[rgba(255,255,255,0.10)]",
            "text-text-tertiary hover:border-[rgba(255,255,255,0.18)] hover:text-text-secondary",
            "transition-all duration-150 cursor-pointer",
            "min-w-[140px] sm:min-w-[200px]"
          )}
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              })
            );
          }}
          aria-label={t("search.ariaLabel")}
        >
          <Search className="w-[16px] h-[16px] shrink-0" />
          <span className="font-mohave text-body-sm hidden sm:inline">{t("search.placeholder")}</span>
          {showShortcutHints && (
            <kbd className="ml-auto font-mono text-[10px] text-text-disabled bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded px-[5px] py-[1px] hidden sm:inline">
              {t("search.shortcut")}
            </kbd>
          )}
        </button>

        {/* Sync status */}
        <SyncIndicator status={syncStatus} t={t} />

        {/* Notifications bell — opens modal */}
        <button
          onClick={openModal}
          className="relative p-[10px] rounded text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title={t("notifications.title")}
          aria-label={t("notifications.ariaLabel")}
        >
          <Bell className="w-[18px] h-[18px]" />

          {/* Unread dot */}
          {unreadCount > 0 && (
            <span
              className="absolute top-[8px] right-[8px] w-[6px] h-[6px] rounded-full"
              style={{ backgroundColor: "#93321A" }}
            />
          )}
        </button>
      </div>
    </header>
  );
}
```

Key changes:
- Removed `usePageActionsStore`, `Button`, `Tooltip*` imports
- Left side: `<NotificationRail />` replaces page action buttons
- Bell gets `onClick={openModal}` and unread dot indicator
- `showShortcutHints` now only controls the keyboard shortcut badge visibility (not page action shortcuts)

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/components/layouts/top-bar.tsx
git commit -m "feat: replace page actions with notification rail in TopBar"
```

---

### Task 13: Mount NotificationModal in Dashboard Layout

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

**Step 1: Add NotificationModal import and render**

Add at the top with other imports:

```typescript
import { NotificationModal } from "@/components/layouts/notification-modal";
```

Then render `<NotificationModal />` inside the layout, adjacent to the other global overlays (after `<FloatingActionButton />` or similar). It should be inside the authenticated wrapper but outside the scrollable content area.

Find where `FloatingActionButton` is rendered and add `<NotificationModal />` right after it.

**Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add src/app/(dashboard)/layout.tsx
git commit -m "feat: mount NotificationModal in dashboard layout"
```

---

### Task 14: Clean Up — Remove Page Actions From Pages

**Files:**
- Modify: `src/app/(dashboard)/projects/page.tsx`
- Modify: `src/app/(dashboard)/job-board/page.tsx`
- Modify: `src/app/(dashboard)/clients/page.tsx`
- Modify: `src/app/(dashboard)/products/page.tsx`
- Modify: `src/app/(dashboard)/invoices/page.tsx`
- Modify: `src/app/(dashboard)/estimates/page.tsx`
- Modify: `src/app/(dashboard)/pipeline/page.tsx`

**Step 1: For each file listed above**

Search for `usePageActionsStore` in the file. If found:
1. Remove the import of `usePageActionsStore`
2. Remove any `useEffect` that calls `setActions(...)` and `clearActions()`
3. Remove any `const { setActions, clearActions } = usePageActionsStore()` or similar destructuring
4. Keep all other functionality intact

**Important:** Do NOT delete `src/stores/page-actions-store.ts` yet — verify no other files reference it first. If nothing else imports it after cleaning these 7 files + top-bar.tsx, then delete it.

**Step 2: Check for remaining references**

```bash
grep -r "usePageActionsStore\|page-actions-store" src/ --include="*.ts" --include="*.tsx" -l
```

If only `src/stores/page-actions-store.ts` remains, delete it:

```bash
rm src/stores/page-actions-store.ts
```

**Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove page action buttons from all dashboard pages"
```

---

### Task 15: Verify Reduced Motion + Type-check Full Build

**Step 1: Check for `use-reduced-motion` hook**

```bash
find src -name "use-reduced-motion*" -type f
```

If the hook doesn't exist, update `notification-pill.tsx` and `notification-mini-card.tsx` to use Framer Motion's built-in `useReducedMotion`:

```typescript
import { useReducedMotion } from "framer-motion";
```

The API is the same — returns `boolean | null`. Treat `null` as `false`.

**Step 2: Full type-check**

```bash
npx tsc --noEmit
```

**Step 3: Run dev server and verify no runtime errors**

```bash
npm run dev
```

Open the dashboard in the browser. Verify:
- No page action buttons in the header
- Bell icon shows in top-right
- No console errors

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: reduced-motion hook imports and type fixes"
```

---

### Task 16: Final Commit — Squash or Tag

**Step 1: Verify everything compiles**

```bash
npx tsc --noEmit && echo "BUILD OK"
```

**Step 2: Push**

```bash
git push
```

The notification rail is now in place. Features will populate notifications as they're built — each new feature just needs to call `NotificationService` to create a notification row, and the rail picks it up automatically.
