"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronDown, ChevronRight, Check, Flag,
} from "lucide-react";
import type { BetaRequest } from "./types";

interface BetaRequestsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BetaRequest[];
  onDecision: (requestId: string, status: "approved" | "rejected", notes: string) => void;
}

export function BetaRequestsDrawer({
  isOpen,
  onClose,
  requests,
  onDecision,
}: BetaRequestsDrawerProps) {
  const [filter, setFilter] = useState<string>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});

  const filtered = requests.filter((r) =>
    filter === "all" ? true : r.status === filter
  );
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const getNote = (id: string) => adminNotes[id] ?? "";
  const setNote = (id: string, value: string) =>
    setAdminNotes((prev) => ({ ...prev, [id]: value }));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: 440 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 bottom-0 w-[440px] z-50 border-l border-white/[0.08] overflow-y-auto"
            style={{
              background: "var(--surface-glass-dense)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-[#C4A868]" />
                <h2 className="font-mohave text-[14px] uppercase tracking-widest text-[#E5E5E5]">
                  Beta Requests
                </h2>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 bg-[#C4A868]/20 text-[#C4A868] text-[11px] font-mohave rounded">
                    {pendingCount}
                  </span>
                )}
              </div>
              <button onClick={onClose} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 px-6 py-3 border-b border-white/[0.06]">
              {["pending", "approved", "rejected", "all"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 font-mohave text-[11px] uppercase tracking-wider rounded transition-colors ${
                    filter === f
                      ? "bg-white/[0.08] text-[#E5E5E5]"
                      : "text-[#6B6B6B] hover:text-[#A0A0A0]"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Request list */}
            <div className="p-4 space-y-2">
              {filtered.length === 0 ? (
                <p className="font-mono text-[12px] text-[#6B6B6B] py-8 text-center">
                  No {filter === "all" ? "" : filter} requests.
                </p>
              ) : (
                filtered.map((req) => (
                  <div key={req.id} className="border border-white/[0.08] rounded overflow-hidden">
                    <button
                      onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="text-left min-w-0">
                        <div className="font-mohave text-[13px] text-[#E5E5E5] truncate">
                          {req.user_name}
                        </div>
                        <div className="font-mono text-[11px] text-[#6B6B6B] truncate">
                          {req.company_name} · {req.whats_new_items?.title ?? "Unknown"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`font-mohave text-micro uppercase tracking-widest ${
                            req.status === "pending"
                              ? "text-[#C4A868]"
                              : req.status === "approved"
                              ? "text-[#9DB582]"
                              : "text-[#93321A]"
                          }`}
                        >
                          {req.status}
                        </span>
                        {expandedId === req.id ? (
                          <ChevronDown className="w-3 h-3 text-[#6B6B6B]" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-[#6B6B6B]" />
                        )}
                      </div>
                    </button>

                    {expandedId === req.id && (
                      <div className="border-t border-white/[0.06] px-4 py-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3 text-[12px]">
                          <div>
                            <span className="font-mohave text-micro uppercase tracking-widest text-[#6B6B6B]">
                              Email
                            </span>
                            <p className="font-mono text-[#A0A0A0]">{req.user_email}</p>
                          </div>
                          <div>
                            <span className="font-mohave text-micro uppercase tracking-widest text-[#6B6B6B]">
                              Company
                            </span>
                            <p className="font-mono text-[#A0A0A0]">{req.company_name}</p>
                          </div>
                          <div>
                            <span className="font-mohave text-micro uppercase tracking-widest text-[#6B6B6B]">
                              Feature
                            </span>
                            <p className="font-mono text-[#A0A0A0]">
                              {req.whats_new_items?.title ?? "—"}
                            </p>
                          </div>
                          <div>
                            <span className="font-mohave text-micro uppercase tracking-widest text-[#6B6B6B]">
                              Requested
                            </span>
                            <p className="font-mono text-[#A0A0A0]">
                              {new Date(req.requested_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {req.status === "pending" && (
                          <>
                            <div>
                              <label className="block font-mohave text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
                                Notes (optional)
                              </label>
                              <textarea
                                value={getNote(req.id)}
                                onChange={(e) => setNote(req.id, e.target.value)}
                                placeholder="Add notes for the email..."
                                rows={2}
                                className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-3 py-2 font-mono text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50 resize-none"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => onDecision(req.id, "approved", getNote(req.id))}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30 transition-colors"
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                onClick={() => onDecision(req.id, "rejected", getNote(req.id))}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#93321A]/20 border border-[#93321A]/30 rounded font-mohave text-[11px] uppercase text-[#93321A] hover:bg-[#93321A]/30 transition-colors"
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          </>
                        )}

                        {req.admin_notes && (
                          <div>
                            <span className="font-mohave text-micro uppercase tracking-widest text-[#6B6B6B]">
                              Admin Notes
                            </span>
                            <p className="font-mono text-[12px] text-[#A0A0A0]">
                              {req.admin_notes}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
