"use client";

import { useState, useTransition } from "react";
import type { NewsletterContent } from "@/lib/admin/types";

interface NewsletterTabProps {
  newsletters: NewsletterContent[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ArrayField = "shipped" | "in_progress" | "bug_fixes" | "coming_up";

const ARRAY_FIELDS: { key: ArrayField; label: string }[] = [
  { key: "shipped", label: "Shipped" },
  { key: "in_progress", label: "In Progress" },
  { key: "bug_fixes", label: "Bug Fixes" },
  { key: "coming_up", label: "Coming Up" },
];

function emptyDraft(): Omit<NewsletterContent, "id" | "created_at" | "updated_at"> {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    shipped: [],
    in_progress: [],
    bug_fixes: [],
    coming_up: [],
    custom_intro: null,
    custom_outro: null,
    status: "draft",
  };
}

export function NewsletterTab({ newsletters: initial }: NewsletterTabProps) {
  const [newsletters, setNewsletters] = useState(initial);
  const [selected, setSelected] = useState<NewsletterContent | null>(null);
  const [draft, setDraft] = useState<Omit<NewsletterContent, "id" | "created_at" | "updated_at">>(emptyDraft());
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isEditing = selected !== null;

  function selectNewsletter(nl: NewsletterContent) {
    setSelected(nl);
    setDraft({
      month: nl.month,
      year: nl.year,
      shipped: nl.shipped,
      in_progress: nl.in_progress,
      bug_fixes: nl.bug_fixes,
      coming_up: nl.coming_up,
      custom_intro: nl.custom_intro,
      custom_outro: nl.custom_outro,
      status: nl.status,
    });
    setMessage(null);
  }

  function startNew() {
    setSelected(null);
    setDraft(emptyDraft());
    setMessage(null);
  }

  function updateArrayField(field: ArrayField, index: number, value: string) {
    setDraft((prev) => {
      const arr = [...prev[field]];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  }

  function addArrayItem(field: ArrayField) {
    setDraft((prev) => ({ ...prev, [field]: [...prev[field], ""] }));
  }

  function removeArrayItem(field: ArrayField, index: number) {
    setDraft((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
  }

  async function save(markSent = false) {
    startTransition(async () => {
      try {
        const body = { ...draft, status: markSent ? "sent" : draft.status };

        if (isEditing && selected) {
          const res = await fetch(`/api/admin/email/newsletter/${selected.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(await res.text());
          const updated = await res.json();
          setNewsletters((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
          setSelected(updated);
          setMessage({ type: "success", text: markSent ? "Marked as sent" : "Saved" });
        } else {
          const res = await fetch("/api/admin/email/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(await res.text());
          const created = await res.json();
          setNewsletters((prev) => [created, ...prev]);
          setSelected(created);
          setMessage({ type: "success", text: "Created" });
        }
      } catch (err) {
        setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
      }
    });
  }

  async function handleDelete() {
    if (!selected) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/email/newsletter/${selected.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(await res.text());
        setNewsletters((prev) => prev.filter((n) => n.id !== selected.id));
        startNew();
        setMessage({ type: "success", text: "Deleted" });
      } catch (err) {
        setMessage({ type: "error", text: err instanceof Error ? err.message : "Delete failed" });
      }
    });
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      {/* Left: Newsletter list */}
      <div className="space-y-2">
        <button
          onClick={startNew}
          className="w-full px-4 py-2.5 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#597794] hover:bg-white/[0.04] transition-colors"
        >
          + New Newsletter
        </button>
        {newsletters.map((nl) => (
          <button
            key={nl.id}
            onClick={() => selectNewsletter(nl)}
            className={[
              "w-full text-left px-4 py-3 rounded-lg border transition-colors",
              selected?.id === nl.id
                ? "border-[#597794] bg-white/[0.04]"
                : "border-white/[0.05] hover:bg-white/[0.02]",
            ].join(" ")}
          >
            <span className="font-mohave text-[14px] text-[#E5E5E5]">
              {MONTHS[nl.month - 1]} {nl.year}
            </span>
            <span
              className={`ml-2 font-mohave text-[11px] uppercase ${
                nl.status === "sent" ? "text-[#9DB582]" : "text-[#C4A868]"
              }`}
            >
              {nl.status}
            </span>
          </button>
        ))}
      </div>

      {/* Right: Editor */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] space-y-5">
        {/* Month/Year */}
        <div className="flex gap-4">
          <div>
            <label className="font-mohave text-[11px] uppercase text-[#6B6B6B] block mb-1">Month</label>
            <select
              value={draft.month}
              onChange={(e) => setDraft((prev) => ({ ...prev, month: Number(e.target.value) }))}
              disabled={isEditing}
              className="bg-transparent border border-white/[0.08] rounded-lg px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:outline-none focus:border-[#597794] disabled:opacity-50"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1} className="bg-[#1D1D1D]">{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mohave text-[11px] uppercase text-[#6B6B6B] block mb-1">Year</label>
            <input
              type="number"
              value={draft.year}
              onChange={(e) => setDraft((prev) => ({ ...prev, year: Number(e.target.value) }))}
              disabled={isEditing}
              className="bg-transparent border border-white/[0.08] rounded-lg px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] w-24 focus:outline-none focus:border-[#597794] disabled:opacity-50"
            />
          </div>
        </div>

        {/* Array fields */}
        {ARRAY_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-2">
              <label className="font-mohave text-[11px] uppercase text-[#6B6B6B]">{label}</label>
              <button
                onClick={() => addArrayItem(key)}
                className="font-mohave text-[12px] text-[#597794] hover:text-[#6B8DAD] transition-colors"
              >
                + Add
              </button>
            </div>
            <div className="space-y-1.5">
              {draft[key].map((item, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={item}
                    onChange={(e) => updateArrayField(key, i, e.target.value)}
                    placeholder={`${label} item...`}
                    className="flex-1 bg-transparent border border-white/[0.08] rounded px-3 py-1.5 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#597794]"
                  />
                  <button
                    onClick={() => removeArrayItem(key, i)}
                    className="px-2 font-mohave text-[12px] text-[#93321A] hover:text-[#B54A2E] transition-colors"
                  >
                    -
                  </button>
                </div>
              ))}
              {draft[key].length === 0 && (
                <p className="font-kosugi text-[12px] text-[#6B6B6B]">[no items]</p>
              )}
            </div>
          </div>
        ))}

        {/* Intro/Outro textareas */}
        <div>
          <label className="font-mohave text-[11px] uppercase text-[#6B6B6B] block mb-1">Custom Intro</label>
          <textarea
            value={draft.custom_intro ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, custom_intro: e.target.value || null }))}
            rows={2}
            className="w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#597794] resize-none"
            placeholder="Optional intro paragraph..."
          />
        </div>
        <div>
          <label className="font-mohave text-[11px] uppercase text-[#6B6B6B] block mb-1">Custom Outro</label>
          <textarea
            value={draft.custom_outro ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, custom_outro: e.target.value || null }))}
            rows={2}
            className="w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#597794] resize-none"
            placeholder="Optional outro paragraph..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => save(false)}
            disabled={isPending}
            className="px-5 py-2 rounded-lg border border-white/[0.08] font-mohave text-[13px] uppercase tracking-wider text-[#E5E5E5] hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={() => save(true)}
            disabled={isPending}
            className="px-5 py-2 rounded-lg bg-[#597794] font-mohave text-[13px] uppercase tracking-wider text-[#E5E5E5] hover:bg-[#6B8DAD] transition-colors disabled:opacity-50"
          >
            Mark Sent
          </button>
          {isEditing && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="px-5 py-2 rounded-lg border border-[#93321A] font-mohave text-[13px] uppercase tracking-wider text-[#93321A] hover:bg-[#93321A]/10 transition-colors disabled:opacity-50 ml-auto"
            >
              Delete
            </button>
          )}
          {message && (
            <span
              className={`font-kosugi text-[12px] ${
                message.type === "success" ? "text-[#9DB582]" : "text-[#93321A]"
              }`}
            >
              [{message.text}]
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
