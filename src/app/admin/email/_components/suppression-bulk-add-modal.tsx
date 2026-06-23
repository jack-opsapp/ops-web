"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface Props {
  open: boolean;
  onClose: () => void;
}

type BulkReason =
  | "manual"
  | "hard_bounce"
  | "spam_report"
  | "unsubscribe"
  | "invalid_address";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SuppressionBulkAddModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [text, setText] = React.useState("");
  const [reason, setReason] = React.useState<BulkReason>("manual");

  const emails = React.useMemo(
    () =>
      Array.from(
        new Set(
          text
            .split(/[\s,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => EMAIL_REGEX.test(e))
        )
      ),
    [text]
  );

  const submit = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/email/suppressions/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", emails, reason }),
      });
      if (!r.ok) throw new Error("bulk_failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppressions"] });
      setText("");
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
            className="w-full max-w-[520px] mx-4 p-6 rounded-modal"
            style={{
              background: "rgba(18,18,20,0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <h2 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED] mb-1">
              {"// BULK SUPPRESS"}
            </h2>
            <p className="font-mono text-[11px] text-[#8A8A8A] mb-4">
              [paste email list — comma, space, or newline separated]
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"user1@example.com\nuser2@example.com"}
              autoFocus
              className="w-full font-mono text-[12px] bg-transparent border border-white/10 rounded px-3 py-2 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0] mb-3"
            />
            <div className="flex items-center justify-between mb-5">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as BulkReason)}
                className="font-mohave text-[13px] bg-transparent border border-white/10 rounded px-2 py-1 text-[#EDEDED]"
              >
                <option value="manual" className="bg-black">Manual</option>
                <option value="hard_bounce" className="bg-black">Hard bounce</option>
                <option value="spam_report" className="bg-black">Spam report</option>
                <option value="unsubscribe" className="bg-black">Unsubscribe</option>
                <option value="invalid_address" className="bg-black">Invalid address</option>
              </select>
              <span
                className="font-mono text-[11px] text-[#9DB582]"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                [{emails.length} valid]
              </span>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#8A8A8A] hover:text-[#EDEDED] px-3 py-2"
              >
                CANCEL
              </button>
              <button
                onClick={() => submit.mutate()}
                disabled={emails.length === 0 || submit.isPending}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black disabled:opacity-40 px-4 py-2 rounded transition-colors"
              >
                {submit.isPending ? "ADDING…" : `ADD ${emails.length}`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
