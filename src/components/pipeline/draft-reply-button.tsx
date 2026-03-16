"use client";

import { useState, useEffect } from "react";
import { Sparkles, X, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
}

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function DraftReplyButton({
  opportunityId,
  companyId,
  userId,
}: DraftReplyButtonProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const res = await fetch("/api/integrations/email/draft", {
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

  const generateDraft = async () => {
    setLoading(true);
    setShowModal(true);
    try {
      const res = await fetch("/api/integrations/email/draft", {
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button
        onClick={generateDraft}
        className="flex items-center gap-1 px-2 py-1 text-[11px] font-kosugi uppercase tracking-wider text-[#597794] hover:text-white hover:bg-[#597794]/10 rounded transition-colors"
        title="Generate AI draft reply"
      >
        <Sparkles className="w-3 h-3" />
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
              className="w-full max-w-lg mx-4 rounded border border-white/10 bg-[#0D0D0D] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#597794]" />
                  <span className="font-mohave text-sm font-semibold text-white">
                    Draft Reply
                  </span>
                  {draftResult && (
                    <span className="px-1.5 py-0.5 text-[10px] font-kosugi uppercase tracking-wider rounded bg-[#597794]/15 text-[#597794]">
                      {(draftResult.confidence * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 text-[#999] hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
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
                        <Sparkles className="w-4 h-4 text-[#597794]" />
                      </motion.div>
                      <span className="font-mohave text-sm">
                        Generating draft...
                      </span>
                    </div>
                  </div>
                ) : draftResult?.draft ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded border border-white/10 bg-[#141414] max-h-[300px] overflow-y-auto scrollbar-hide">
                      <pre className="font-mohave text-sm text-white whitespace-pre-wrap leading-relaxed">
                        {draftResult.draft}
                      </pre>
                    </div>

                    {/* Sources */}
                    {draftResult.sources.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-kosugi text-[10px] uppercase tracking-wider text-[#999]">
                          Sources:
                        </span>
                        {draftResult.sources.map((s) => (
                          <span
                            key={s}
                            className="px-1.5 py-0.5 text-[10px] font-kosugi uppercase tracking-wider rounded bg-white/5 text-[#999] border border-white/5"
                          >
                            {s.replace("_", " ")}
                          </span>
                        ))}
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
                <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10">
                  <button
                    onClick={copyDraft}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded border border-white/10 text-white hover:bg-white/5 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-[#9DB582]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy to Clipboard
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
