# App Messages Admin Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated admin page at `/admin/app-messages` with full CRUD for managing in-app messages broadcast to the iOS app via the Supabase `app_messages` table.

**Architecture:** Follows existing admin panel patterns — server page fetches data, client component handles CRUD via API routes, mutations go through `admin-queries.ts` using `getAdminSupabase()`. One active message at a time (activating auto-deactivates others). Non-dismissable activation requires AlertDialog confirmation.

**Tech Stack:** Next.js 14 (App Router), Supabase (service role), Radix UI (Sheet, AlertDialog, DropdownMenu), Lucide icons, Tailwind CSS with OPS admin styling conventions.

---

### Task 1: Expand the AppMessage type

**Files:**
- Modify: `src/lib/admin/types.ts:129-135`

**Step 1: Update the AppMessage interface to include all columns from the `app_messages` table**

Replace the existing `AppMessage` interface:

```typescript
export interface AppMessage {
  id: string;
  title: string;
  body: string | null;
  active: boolean;
  message_type: string;
  dismissable: boolean;
  target_user_types: string[] | null;
  app_store_url: string | null;
  created_at: string;
}

export const APP_MESSAGE_TYPES = [
  "mandatory_update",
  "optional_update",
  "maintenance",
  "announcement",
  "info",
] as const;

export type AppMessageType = (typeof APP_MESSAGE_TYPES)[number];

export const APP_MESSAGE_TYPE_LABELS: Record<AppMessageType, string> = {
  mandatory_update: "Required Update",
  optional_update: "Update Available",
  maintenance: "Maintenance",
  announcement: "Announcement",
  info: "Notice",
};

export const TARGET_USER_TYPES = ["admin", "officeCrew", "fieldCrew"] as const;

export const TARGET_USER_TYPE_LABELS: Record<string, string> = {
  admin: "Admin",
  officeCrew: "Office Crew",
  fieldCrew: "Field Crew",
};
```

**Step 2: Commit**

```bash
git add src/lib/admin/types.ts
git commit -m "feat(admin): expand AppMessage type with all table columns"
```

---

### Task 2: Add query and mutation functions

**Files:**
- Modify: `src/lib/admin/admin-queries.ts` (the existing `getAppMessages` function around line 780)

**Step 1: Update `getAppMessages` to select all columns**

Replace the existing function:

```typescript
export async function getAppMessages(): Promise<AppMessage[]> {
  const { data } = await db()
    .from("app_messages")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as AppMessage[];
}
```

**Step 2: Add mutation functions below `getAppMessages`**

```typescript
export async function createAppMessage(
  message: Omit<AppMessage, "id" | "created_at">
): Promise<AppMessage> {
  // If activating, deactivate all others first
  if (message.active) {
    await db().from("app_messages").update({ active: false }).eq("active", true);
  }
  const { data, error } = await db()
    .from("app_messages")
    .insert(message)
    .select()
    .single();
  if (error) throw error;
  return data as AppMessage;
}

export async function updateAppMessage(
  id: string,
  updates: Partial<Omit<AppMessage, "id" | "created_at">>
): Promise<AppMessage> {
  // If activating, deactivate all others first
  if (updates.active) {
    await db().from("app_messages").update({ active: false }).eq("active", true).neq("id", id);
  }
  const { data, error } = await db()
    .from("app_messages")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as AppMessage;
}

export async function deleteAppMessage(id: string): Promise<void> {
  const { error } = await db().from("app_messages").delete().eq("id", id);
  if (error) throw error;
}
```

**Step 3: Commit**

```bash
git add src/lib/admin/admin-queries.ts
git commit -m "feat(admin): add CRUD mutation functions for app messages"
```

---

### Task 3: Create API routes

**Files:**
- Create: `src/app/api/admin/app-messages/route.ts`
- Create: `src/app/api/admin/app-messages/[id]/route.ts`

**Step 1: Create the collection route (GET + POST)**

File: `src/app/api/admin/app-messages/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail, getAppMessages, createAppMessage } from "@/lib/admin/admin-queries";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const messages = await getAppMessages();
    return NextResponse.json(messages);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch app messages" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body.title || !body.body) {
      return NextResponse.json(
        { error: "title and body are required" },
        { status: 400 }
      );
    }
    const message = await createAppMessage(body);
    return NextResponse.json(message, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create app message" },
      { status: 500 }
    );
  }
}
```

**Step 2: Create the item route (PUT + DELETE)**

File: `src/app/api/admin/app-messages/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail, updateAppMessage, deleteAppMessage } from "@/lib/admin/admin-queries";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const updated = await updateAppMessage(id, body);
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update app message" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await deleteAppMessage(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete app message" },
      { status: 500 }
    );
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/admin/app-messages/
git commit -m "feat(admin): add app messages API routes (CRUD)"
```

---

### Task 4: Create the admin page and CRUD component

**Files:**
- Create: `src/app/admin/app-messages/page.tsx`
- Create: `src/app/admin/app-messages/_components/app-messages-content.tsx`

**Step 1: Create the server page**

File: `src/app/admin/app-messages/page.tsx`

```typescript
import { getAppMessages } from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { AppMessagesContent } from "./_components/app-messages-content";

export default async function AppMessagesPage() {
  let messages;
  try {
    messages = await getAppMessages();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">App Messages Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="App Messages"
        caption={`${messages.length} messages · ${messages.filter((m) => m.active).length} active`}
      />
      <div className="p-8">
        <AppMessagesContent initialMessages={messages} />
      </div>
    </div>
  );
}
```

**Step 2: Create the client CRUD component**

File: `src/app/admin/app-messages/_components/app-messages-content.tsx`

This is the largest file. It contains:
- Messages table with status, title, type, target, dismissable, date columns
- Create/Edit form in a Sheet (slide-out panel)
- AlertDialog confirmation for non-dismissable activation
- Optimistic UI updates on create/update/delete

Key behaviors:
- Form fields: title (text), body (textarea), message_type (select), dismissable (checkbox), target_user_types (checkboxes for admin/officeCrew/fieldCrew), app_store_url (text, shown only for update types), active (checkbox)
- When user checks `active` + `dismissable` is unchecked → show AlertDialog before saving
- Row click opens edit sheet
- "Create Message" button opens empty sheet
- Delete button in edit sheet with confirmation
- Uses `useTransition` for async operations (matches admin pattern)
- Uses `fetch()` to call the API routes (matches newsletter tab pattern)

```typescript
"use client";

import { useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { AppMessage } from "@/lib/admin/types";
import {
  APP_MESSAGE_TYPES,
  APP_MESSAGE_TYPE_LABELS,
  TARGET_USER_TYPES,
  TARGET_USER_TYPE_LABELS,
} from "@/lib/admin/types";
import type { AppMessageType } from "@/lib/admin/types";

interface AppMessagesContentProps {
  initialMessages: AppMessage[];
}

const EMPTY_FORM: Omit<AppMessage, "id" | "created_at"> = {
  title: "",
  body: null,
  active: false,
  message_type: "announcement",
  dismissable: true,
  target_user_types: null,
  app_store_url: null,
};

export function AppMessagesContent({ initialMessages }: AppMessagesContentProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isUpdateType = form.message_type === "mandatory_update" || form.message_type === "optional_update";

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  function openEdit(msg: AppMessage) {
    setEditingId(msg.id);
    setForm({
      title: msg.title,
      body: msg.body,
      active: msg.active,
      message_type: msg.message_type,
      dismissable: msg.dismissable,
      target_user_types: msg.target_user_types,
      app_store_url: msg.app_store_url,
    });
    setSheetOpen(true);
  }

  function handleSave() {
    // If activating a non-dismissable message, require confirmation
    if (form.active && !form.dismissable) {
      setConfirmOpen(true);
      return;
    }
    doSave();
  }

  function doSave() {
    startTransition(async () => {
      try {
        if (editingId) {
          const res = await fetch(`/api/admin/app-messages/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
          if (!res.ok) throw new Error(await res.text());
          const updated = await res.json();
          setMessages((prev) => {
            let next = prev.map((m) => (m.id === editingId ? updated : m));
            // If we activated this one, deactivate others
            if (updated.active) {
              next = next.map((m) => (m.id !== editingId ? { ...m, active: false } : m));
            }
            return next;
          });
        } else {
          const res = await fetch("/api/admin/app-messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
          if (!res.ok) throw new Error(await res.text());
          const created = await res.json();
          setMessages((prev) => {
            let next = [created, ...prev];
            // If we activated the new one, deactivate others
            if (created.active) {
              next = next.map((m) => (m.id !== created.id ? { ...m, active: false } : m));
            }
            return next;
          });
        }
        setSheetOpen(false);
      } catch (err) {
        console.error("Failed to save app message:", err);
      }
    });
  }

  function handleDelete() {
    if (!editingId) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/app-messages/${editingId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(await res.text());
        setMessages((prev) => prev.filter((m) => m.id !== editingId));
        setSheetOpen(false);
        setDeleteConfirmOpen(false);
      } catch (err) {
        console.error("Failed to delete app message:", err);
      }
    });
  }

  function toggleTargetType(type: string) {
    setForm((prev) => {
      const current = prev.target_user_types ?? [];
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { ...prev, target_user_types: next.length > 0 ? next : null };
    });
  }

  return (
    <div className="space-y-4">
      {/* Header with Create button */}
      <div className="flex items-center justify-between">
        <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded font-mohave text-[13px] uppercase bg-white/[0.05] border border-white/[0.12] text-[#E5E5E5] hover:bg-white/[0.08] transition-colors"
        >
          Create Message
        </button>
      </div>

      {/* Messages Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              {["STATUS", "TITLE", "TYPE", "TARGET", "DISMISSABLE", "DATE"].map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr
                key={m.id}
                onClick={() => openEdit(m)}
                className="border-b border-white/[0.05] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-6 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full font-mohave text-[11px] uppercase ${
                      m.active
                        ? "bg-[#9DB582]/20 text-[#9DB582]"
                        : "bg-white/[0.05] text-[#6B6B6B]"
                    }`}
                  >
                    {m.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-2 py-3 font-mohave text-[14px] text-[#E5E5E5]">
                  {m.title}
                </td>
                <td className="px-2 py-3 font-mohave text-[13px] text-[#A0A0A0]">
                  {APP_MESSAGE_TYPE_LABELS[m.message_type as AppMessageType] ?? m.message_type}
                </td>
                <td className="px-2 py-3 font-mohave text-[13px] text-[#A0A0A0]">
                  {m.target_user_types && m.target_user_types.length > 0
                    ? m.target_user_types.map((t) => TARGET_USER_TYPE_LABELS[t] ?? t).join(", ")
                    : "All Users"}
                </td>
                <td className="px-2 py-3 font-mohave text-[13px] text-[#A0A0A0]">
                  {m.dismissable ? "Yes" : "No"}
                </td>
                <td className="px-2 py-3 font-kosugi text-[12px] text-[#6B6B6B]">
                  [{new Date(m.created_at).toLocaleDateString()}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {messages.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
              No app messages
            </p>
          </div>
        )}
      </div>

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit Message" : "Create Message"}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full bg-white/[0.05] border border-white/[0.12] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794]"
                  placeholder="Message title"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                  Body *
                </label>
                <textarea
                  value={form.body ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value || null }))}
                  rows={4}
                  className="w-full bg-white/[0.05] border border-white/[0.12] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794] resize-y"
                  placeholder="Message body"
                />
              </div>

              {/* Message Type */}
              <div>
                <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                  Message Type
                </label>
                <select
                  value={form.message_type}
                  onChange={(e) => setForm((f) => ({ ...f, message_type: e.target.value }))}
                  className="w-full bg-white/[0.05] border border-white/[0.12] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794]"
                >
                  {APP_MESSAGE_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-[#1D1D1D]">
                      {APP_MESSAGE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target User Types */}
              <div>
                <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                  Target Users
                </label>
                <p className="font-kosugi text-[11px] text-[#6B6B6B] mb-2">
                  Leave all unchecked to target all users
                </p>
                <div className="flex gap-3">
                  {TARGET_USER_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.target_user_types?.includes(t) ?? false}
                        onChange={() => toggleTargetType(t)}
                        className="accent-[#597794]"
                      />
                      <span className="font-mohave text-[13px] text-[#A0A0A0]">
                        {TARGET_USER_TYPE_LABELS[t]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dismissable */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.dismissable}
                    onChange={(e) => setForm((f) => ({ ...f, dismissable: e.target.checked }))}
                    className="accent-[#597794]"
                  />
                  <span className="font-mohave text-[13px] text-[#E5E5E5]">Dismissable</span>
                </label>
                {!form.dismissable && (
                  <p className="font-kosugi text-[11px] text-[#C4A868] mt-1">
                    Non-dismissable messages block users from using the app
                  </p>
                )}
              </div>

              {/* App Store URL — only for update types */}
              {isUpdateType && (
                <div>
                  <label className="block font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                    App Store URL
                  </label>
                  <input
                    type="url"
                    value={form.app_store_url ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, app_store_url: e.target.value || null }))}
                    className="w-full bg-white/[0.05] border border-white/[0.12] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] focus:outline-none focus:border-[#597794]"
                    placeholder="https://apps.apple.com/..."
                  />
                </div>
              )}

              {/* Active */}
              <div className="pt-2 border-t border-white/[0.08]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="accent-[#9DB582]"
                  />
                  <span className="font-mohave text-[13px] text-[#E5E5E5]">Active</span>
                </label>
                {form.active && (
                  <p className="font-kosugi text-[11px] text-[#6B6B6B] mt-1">
                    Activating will deactivate any other active message
                  </p>
                )}
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            {editingId && (
              <button
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={isPending}
                className="mr-auto px-3 py-1.5 rounded font-mohave text-[13px] uppercase text-red-400 hover:bg-red-400/10 border border-red-400/20 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <button
              onClick={() => setSheetOpen(false)}
              className="px-4 py-1.5 rounded font-mohave text-[13px] uppercase text-[#6B6B6B] hover:text-[#A0A0A0] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || !form.title || !form.body}
              className="px-4 py-1.5 rounded font-mohave text-[13px] uppercase bg-white/[0.05] border border-white/[0.12] text-[#E5E5E5] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
            >
              {isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Non-dismissable Activation Confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate Blocking Message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message is non-dismissable. Targeted users will be blocked from using the app
              until this message is deactivated.
              {form.target_user_types && form.target_user_types.length > 0
                ? ` Affected roles: ${form.target_user_types.map((t) => TARGET_USER_TYPE_LABELS[t] ?? t).join(", ")}.`
                : " All users will be affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                doSave();
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this app message. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/admin/app-messages/
git commit -m "feat(admin): add app messages admin page with full CRUD"
```

---

### Task 5: Add sidebar navigation entry

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx`

**Step 1: Add "APP MESSAGES" to NAV_ITEMS**

Insert after the "FEEDBACK" entry:

```typescript
{ href: "/admin/app-messages", label: "APP MESSAGES" },
```

**Step 2: Commit**

```bash
git add src/app/admin/_components/sidebar.tsx
git commit -m "feat(admin): add app messages to admin sidebar nav"
```

---

### Task 6: Remove read-only AppMessages from Feedback tab

**Files:**
- Modify: `src/app/admin/feedback/page.tsx`
- Modify: `src/app/admin/feedback/_components/feedback-content.tsx`

**Step 1: Remove appMessages prop and tab from FeedbackContent**

In `feedback-content.tsx`:
- Remove `appMessages` from `FeedbackContentProps`
- Remove the "App Messages" tab from SubTabs
- Delete the `AppMessagesTab` component entirely

In `feedback/page.tsx`:
- Remove `getAppMessages` import and call from `fetchFeedbackData`
- Remove `appMessages` prop from `<FeedbackContent>`
- Update caption to not mention messages

**Step 2: Commit**

```bash
git add src/app/admin/feedback/
git commit -m "refactor(admin): remove app messages from feedback tab (moved to own page)"
```

---

### Task 7: Build verification

**Step 1: Run the build**

```bash
cd OPS-Web && npx next build --no-lint
```

Expected: Build succeeds with no errors.

**Step 2: Verify page renders**

Visit `/admin/app-messages` in the browser and confirm:
- Table renders (possibly empty)
- "Create Message" button opens the sheet
- All form fields render correctly
- Sheet can be closed

**Step 3: Final commit if any fixes needed**

---

### Task 8: Mark Slate item complete

Mark the Slate note `18e8b2be-7f47-4498-af57-ca0828e9b5b8` as completed.
