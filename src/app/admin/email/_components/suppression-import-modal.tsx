"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface Props {
  open: boolean;
  onClose: () => void;
}

const BATCH = 100;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SuppressionImportModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
    errors: number;
  } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.split(",")[0]?.trim().toLowerCase() ?? "")
      .filter((e) => EMAIL_REGEX.test(e));
    const total = lines.length;
    setProgress({ done: 0, total, errors: 0 });
    let errors = 0;
    for (let i = 0; i < total; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      try {
        const r = await fetch("/api/admin/email/suppressions/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "add",
            emails: batch,
            reason: "manual",
          }),
        });
        if (!r.ok) {
          errors += batch.length;
        } else {
          const json = await r.json();
          errors += json.errors?.length ?? 0;
        }
      } catch {
        errors += batch.length;
      }
      setProgress({ done: Math.min(i + BATCH, total), total, errors });
    }
    qc.invalidateQueries({ queryKey: ["suppressions"] });
  };

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
            className="w-full max-w-[480px] mx-4 p-6 rounded-modal"
            style={{
              background: "rgba(18,18,20,0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <h2 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED] mb-1">
              {"// IMPORT CSV"}
            </h2>
            <p className="font-mono text-[11px] text-[#8A8A8A] mb-4">
              [first column = email; one per row]
            </p>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
              className="block p-8 rounded-panel text-left cursor-pointer"
              style={{
                border: `1px dashed ${
                  dragOver ? "#6F94B0" : "rgba(255,255,255,0.18)"
                }`,
                background: dragOver
                  ? "rgba(111,148,176,0.05)"
                  : "transparent",
              }}
            >
              <span className="font-mono text-[12px] text-[#B5B5B5]">
                drag a CSV here, or click to choose
              </span>
              <input
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </label>
            {progress && (
              <div
                className="mt-4 font-mono text-[11px] text-[#B5B5B5]"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <p>
                  [{progress.done}/{progress.total} processed — {progress.errors} errors]
                </p>
                <div className="h-[2px] bg-white/[0.06] rounded-bar overflow-hidden mt-2">
                  <motion.div
                    className="h-full"
                    style={{ background: "#9DB582" }}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                    }}
                    transition={{ duration: 0.3, ease: EASE_SMOOTH }}
                  />
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={onClose}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#8A8A8A] hover:text-[#EDEDED] px-3 py-2"
              >
                DONE
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
