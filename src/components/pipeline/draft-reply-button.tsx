"use client";

import { useState, useEffect } from "react";
import { Sparkles, X, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useDictionary } from "@/i18n/client";

interface DraftReplyButtonProps {
  opportunityId: string;
  companyId: string;
  userId: string;
}

interface DraftResponse {
  draft: string;
  confidence: number;
  sources: string[];
  available: boolean;
  reason?: string;
  draftHistoryId?: string;
  mailboxSaved?: boolean;
  mailboxDraftId?: string | null;
  mailboxErrorCode?: string | null;
  provider?: "gmail" | "microsoft365";
}

type CopyState = "idle" | "copied";

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

function mailboxLabel(provider?: "gmail" | "microsoft365"): string {
  return provider === "microsoft365" ? "Outlook" : "Gmail";
}

export function DraftReplyButton({
  opportunityId,
  companyId,
  userId,
}: DraftReplyButtonProps) {
  const { t } = useDictionary("pipeline");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const res = await authedFetch("/api/integrations/email/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            userId,
            opportunityId,
            checkOnly: true,
          }),
        });
        const data: DraftResponse = await res.json();
        setAvailable(data.available);
      } catch {
        setAvailable(false);
      }
    };
    checkAvailability();
  }, [companyId, userId, opportunityId]);

  // Don't render if not available or still checking
  if (available === null || available === false) return null;

  const mailboxPlacementUnknown =
    draftResult?.mailboxErrorCode ===
    "EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED";

  const generateDraft = async () => {
    if (mailboxPlacementUnknown) {
      setShowModal(true);
      return;
    }
    setLoading(true);
    setShowModal(true);
    setCopyState("idle");
    try {
      const res = await authedFetch("/api/integrations/email/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, userId, opportunityId }),
      });
      const data: DraftResponse = await res.json();
      setDraftResult(data);
    } catch {
      setDraftResult({
        draft: "",
        confidence: 0,
        sources: [],
        available: false,
        reason: "Failed to generate draft",
      });
    }
    setLoading(false);
  };

  const copyDraft = async () => {
    if (!draftResult?.draft) return;
    await navigator.clipboard.writeText(draftResult.draft);
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 2000);
  };

  const mailboxName = mailboxLabel(draftResult?.provider);

  return (
    <>
      <button
        onClick={generateDraft}
        className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-[#6F94B0] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
        title="Generate AI draft reply"
      >
        <Sparkles className="h-3 w-3" />
        Draft
      </button>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.3, ease: EASE_SMOOTH }}
              className="mx-4 w-full max-w-lg rounded border border-white/10 bg-black shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#6F94B0]" />
                  <span className="font-mohave text-sm font-semibold text-white">
                    Draft Reply
                  </span>
                  {draftResult && (
                    <span className="rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-[#6F94B0]">
                      {(draftResult.confidence * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 text-[#999] transition-colors hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-2 text-[#999]">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      >
                        <Sparkles className="h-4 w-4 text-[#6F94B0]" />
                      </motion.div>
                      <span className="font-mohave text-sm">
                        Generating draft...
                      </span>
                    </div>
                  </div>
                ) : draftResult?.draft ? (
                  <div className="space-y-3">
                    <div className="glass-surface scrollbar-hide max-h-[300px] overflow-y-auto rounded border border-white/10 bg-glass p-3">
                      <pre className="whitespace-pre-wrap font-mohave text-sm leading-relaxed text-white">
                        {draftResult.draft}
                      </pre>
                    </div>

                    {/* Sources */}
                    {draftResult.sources.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-micro uppercase tracking-wider text-[#999]">
                          Sources:
                        </span>
                        {draftResult.sources.map((s) => (
                          <span
                            key={s}
                            className="rounded border border-white/5 bg-white/5 px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-[#999]"
                          >
                            {s.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Mailbox save status */}
                    {draftResult.mailboxSaved === true && (
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#B5B5B5]">
                        <Check className="h-3 w-3 shrink-0 text-[#9DB582]" />
                        {`Saved to your ${mailboxName} drafts.`}
                      </div>
                    )}
                    {draftResult.mailboxSaved === false && (
                      <div className="font-mono text-[11px] text-[#B5B5B5]">
                        {mailboxPlacementUnknown
                          ? t("draft.mailboxOutcomeUnknown", {
                              mailbox: mailboxName,
                            })
                          : draftResult.mailboxErrorCode ===
                              "EMAIL_DRAFT_AUTHORIZATION_REVOKED"
                            ? t("draft.accessChanged")
                            : t("draft.mailboxSaveFailed", {
                                mailbox: mailboxName,
                              })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-4 font-mohave text-sm text-[#999]">
                    {draftResult?.reason || "Unable to generate draft"}
                  </div>
                )}
              </div>

              {/* Footer */}
              {draftResult?.draft && (
                <div className="flex items-center justify-end gap-2 border-t border-white/10 p-4">
                  <button
                    onClick={copyDraft}
                    className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[#B5B5B5] transition-colors hover:bg-white/5 hover:text-white"
                  >
                    {copyState === "copied" ? (
                      <>
                        <Check className="h-3 w-3 text-[#9DB582]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
