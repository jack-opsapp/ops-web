"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { AudienceFilterNode } from "@/lib/admin/types";

interface Props {
  open: boolean;
  filter: AudienceFilterNode;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function AudienceSaveTemplateModal({
  open,
  filter,
  onClose,
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  const submit = useMutation({
    mutationFn: async (): Promise<string> => {
      const r = await fetch("/api/admin/email/suppressions/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, filter }),
      });
      if (!r.ok) throw new Error("save_failed");
      const { template } = await r.json();
      return template.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["audienceTemplates"] });
      onSaved?.(id);
      setName("");
      setDescription("");
      onClose();
    },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)", zIndex: 3000 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE_SMOOTH }}
            className="w-full max-w-[440px] mx-4 p-6 rounded-modal"
            style={{
              background: "rgba(18,18,20,0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <h2 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED] mb-4">
              {"// SAVE AUDIENCE"}
            </h2>
            <label className="block mb-3">
              <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                NAME
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full font-mohave text-[14px] bg-transparent border border-white/10 rounded px-3 py-2 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0]"
              />
            </label>
            <label className="block mb-5">
              <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                DESCRIPTION
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full font-mohave text-[13px] bg-transparent border border-white/10 rounded px-3 py-2 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0]"
              />
            </label>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#8A8A8A] hover:text-[#EDEDED] px-3 py-2"
              >
                CANCEL
              </button>
              <button
                onClick={() => submit.mutate()}
                disabled={!name.trim() || submit.isPending}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black disabled:opacity-40 px-4 py-2 rounded transition-colors"
              >
                {submit.isPending ? "SAVING…" : "SAVE"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
