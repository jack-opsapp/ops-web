"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { drawerVariants } from "@/lib/utils/motion";
import type { SuppressionRow } from "@/lib/admin/types";

interface Props {
  row: SuppressionRow | null;
  onClose: () => void;
  onDelete?: (email: string, list: string) => void;
}

export function SuppressionDetailDrawer({ row, onClose, onDelete }: Props) {
  return (
    <AnimatePresence>
      {row && (
        <motion.aside
          variants={drawerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed top-0 right-0 h-full w-[400px] p-6 overflow-y-auto"
          style={{
            background: "rgba(18,18,20,0.78)",
            backdropFilter: "blur(28px) saturate(1.3)",
            borderLeft: "1px solid rgba(255,255,255,0.09)",
            zIndex: 3001,
          }}
        >
          <header className="flex items-center justify-between mb-5">
            <h3 className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#B5B5B5]">
              // SUPPRESSION
            </h3>
            <button
              onClick={onClose}
              className="font-mono text-[18px] text-[#8A8A8A] hover:text-[#EDEDED]"
              aria-label="Close drawer"
            >
              ×
            </button>
          </header>
          <p className="font-mono text-[14px] text-[#EDEDED] mb-4 break-all">
            {row.email}
          </p>
          <Field label="REASON" value={row.reason.toUpperCase()} />
          <Field label="LIST" value={row.list} />
          <Field label="SOURCE" value={row.source.toUpperCase()} />
          <Field
            label="CREATED"
            value={new Date(row.createdAt).toLocaleString()}
          />
          {row.expiresAt && (
            <Field
              label="EXPIRES"
              value={new Date(row.expiresAt).toLocaleString()}
            />
          )}
          {Object.keys(row.metadata).length > 0 && (
            <div className="mt-4">
              <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A] block mb-1">
                METADATA
              </span>
              <pre
                className="font-mono text-[11px] text-[#B5B5B5] whitespace-pre-wrap p-2 rounded-[5px]"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            </div>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(row.email, row.list)}
              className="mt-6 font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B58289] border border-[#93321A]/50 hover:bg-[#93321A]/10 px-3 py-2 rounded-[5px]"
            >
              REMOVE FROM SUPPRESSIONS
            </button>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A] block">
        {label}
      </span>
      <span
        className="font-mono text-[12px] text-[#EDEDED]"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {value}
      </span>
    </div>
  );
}
