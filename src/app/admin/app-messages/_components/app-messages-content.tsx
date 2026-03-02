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
import type { AppMessage, AppMessageType } from "@/lib/admin/types";
import {
  APP_MESSAGE_TYPES,
  APP_MESSAGE_TYPE_LABELS,
  TARGET_USER_TYPES,
  TARGET_USER_TYPE_LABELS,
} from "@/lib/admin/types";

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

  const isUpdateType =
    form.message_type === "mandatory_update" ||
    form.message_type === "optional_update";

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
            if (updated.active) {
              next = next.map((m) =>
                m.id !== editingId ? { ...m, active: false } : m
              );
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
            if (created.active) {
              next = next.map((m) =>
                m.id !== created.id ? { ...m, active: false } : m
              );
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
              {["STATUS", "TITLE", "TYPE", "TARGET", "DISMISSABLE", "DATE"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]"
                  >
                    {h}
                  </th>
                )
              )}
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
                  {APP_MESSAGE_TYPE_LABELS[m.message_type as AppMessageType] ??
                    m.message_type}
                </td>
                <td className="px-2 py-3 font-mohave text-[13px] text-[#A0A0A0]">
                  {m.target_user_types && m.target_user_types.length > 0
                    ? m.target_user_types
                        .map((t) => TARGET_USER_TYPE_LABELS[t] ?? t)
                        .join(", ")
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
            <SheetTitle>
              {editingId ? "Edit Message" : "Create Message"}
            </SheetTitle>
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      body: e.target.value || null,
                    }))
                  }
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, message_type: e.target.value }))
                  }
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
                    <label
                      key={t}
                      className="flex items-center gap-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={
                          form.target_user_types?.includes(t) ?? false
                        }
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
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dismissable: e.target.checked,
                      }))
                    }
                    className="accent-[#597794]"
                  />
                  <span className="font-mohave text-[13px] text-[#E5E5E5]">
                    Dismissable
                  </span>
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
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        app_store_url: e.target.value || null,
                      }))
                    }
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
                    onChange={(e) =>
                      setForm((f) => ({ ...f, active: e.target.checked }))
                    }
                    className="accent-[#9DB582]"
                  />
                  <span className="font-mohave text-[13px] text-[#E5E5E5]">
                    Active
                  </span>
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
              This message is non-dismissable. Targeted users will be blocked
              from using the app until this message is deactivated.
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
              This will permanently delete this app message. This action cannot
              be undone.
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
