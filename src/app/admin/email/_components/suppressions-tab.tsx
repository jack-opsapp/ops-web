"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { campaignRowVariants } from "@/lib/utils/motion";
import { SuppressionDetailDrawer } from "./suppression-detail-drawer";
import { SuppressionBulkAddModal } from "./suppression-bulk-add-modal";
import { SuppressionImportModal } from "./suppression-import-modal";
import type { SuppressionRow } from "@/lib/admin/types";

const PAGE_SIZE = 50;

interface ListResp {
  rows: SuppressionRow[];
  total: number;
}

export function SuppressionsTab() {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [reason, setReason] = React.useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawerRow, setDrawerRow] = React.useState<SuppressionRow | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ["suppressions", page, debouncedSearch, reason],
    queryFn: async (): Promise<ListResp> => {
      const sp = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (debouncedSearch) sp.set("emailLike", debouncedSearch);
      if (reason) sp.set("reason", reason);
      const r = await fetch(`/api/admin/email/suppressions?${sp.toString()}`);
      if (!r.ok) throw new Error("list_failed");
      return (await r.json()) as ListResp;
    },
  });

  const removeSelected = useMutation({
    mutationFn: async () => {
      const emails = Array.from(selected)
        .map((id) => list.data?.rows.find((r) => r.id === id)?.email)
        .filter((e): e is string => Boolean(e));
      if (emails.length === 0) return;
      await fetch("/api/admin/email/suppressions/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove", emails }),
      });
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["suppressions"] });
    },
  });

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED]">
            {"// SUPPRESSIONS"}
          </h3>
          <p
            className="font-mono text-[11px] text-[#8A8A8A]"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            [{total} blocked addresses]
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setAddOpen(true)}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black px-3 py-1.5 rounded-[5px]"
          >
            BULK ADD
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] border border-white/10 hover:bg-white/[0.05] px-3 py-1.5 rounded-[5px]"
          >
            IMPORT CSV
          </button>
          <button
            onClick={() => {
              window.location.href = "/api/admin/email/suppressions/export";
            }}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] border border-white/10 hover:bg-white/[0.05] px-3 py-1.5 rounded-[5px]"
          >
            EXPORT
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => removeSelected.mutate()}
              className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B58289] border border-[#93321A]/50 hover:bg-[#93321A]/10 px-3 py-1.5 rounded-[5px]"
            >
              REMOVE [{selected.size}]
            </button>
          )}
        </div>
      </header>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="search email…"
          className="flex-1 font-mono text-[12px] bg-transparent border border-white/10 rounded-[5px] px-3 py-1.5 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0]"
        />
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setPage(0);
          }}
          className="font-mohave text-[13px] bg-transparent border border-white/10 rounded-[5px] px-2 py-1 text-[#EDEDED]"
        >
          <option value="" className="bg-black">all reasons</option>
          <option value="hard_bounce" className="bg-black">hard bounce</option>
          <option value="spam_report" className="bg-black">spam report</option>
          <option value="unsubscribe" className="bg-black">unsubscribe</option>
          <option value="manual" className="bg-black">manual</option>
        </select>
      </div>

      <div
        className="rounded-[10px] overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="grid grid-cols-[24px_1fr_140px_120px_140px] gap-3 px-3 py-2 font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A]"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <span></span>
          <span>EMAIL</span>
          <span>REASON</span>
          <span>SOURCE</span>
          <span>CREATED</span>
        </div>
        {list.data?.rows.map((r, i) => (
          <motion.div
            key={r.id}
            custom={i}
            variants={campaignRowVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-[24px_1fr_140px_120px_140px] gap-3 px-3 py-2 border-t border-white/[0.04] hover:bg-white/[0.03] cursor-pointer items-center"
            onClick={() => setDrawerRow(r)}
          >
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(r.id);
                else next.delete(r.id);
                setSelected(next);
              }}
            />
            <span className="font-mono text-[12px] text-[#EDEDED] truncate">
              {r.email}
            </span>
            <span className="font-mono text-[11px] text-[#B5B5B5]">
              {r.reason}
            </span>
            <span className="font-mono text-[11px] text-[#8A8A8A]">
              {r.source}
            </span>
            <span
              className="font-mono text-[11px] text-[#8A8A8A]"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </motion.div>
        ))}
        {(list.data?.rows.length ?? 0) === 0 && !list.isLoading && (
          <p className="font-mono text-[12px] text-[#6A6A6A] py-8 px-3">
            [no suppressions match the filter]
          </p>
        )}
      </div>

      <footer
        className="flex items-center justify-between font-mono text-[11px] text-[#8A8A8A]"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        <span>
          [page {page + 1} / {totalPages}]
        </span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            className="px-3 py-1 border border-white/10 rounded-[4px] disabled:opacity-30 hover:bg-white/[0.05]"
          >
            PREV
          </button>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border border-white/10 rounded-[4px] disabled:opacity-30 hover:bg-white/[0.05]"
          >
            NEXT
          </button>
        </div>
      </footer>

      <SuppressionDetailDrawer
        row={drawerRow}
        onClose={() => setDrawerRow(null)}
        onDelete={async (email, list) => {
          await fetch(
            `/api/admin/email/suppressions/${encodeURIComponent(email)}?list=${encodeURIComponent(list)}`,
            { method: "DELETE" }
          );
          qc.invalidateQueries({ queryKey: ["suppressions"] });
          setDrawerRow(null);
        }}
      />
      <SuppressionBulkAddModal open={addOpen} onClose={() => setAddOpen(false)} />
      <SuppressionImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </section>
  );
}
