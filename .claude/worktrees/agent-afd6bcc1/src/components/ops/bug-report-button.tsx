"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Bug, X, Send, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useDictionary } from "@/i18n/client";

type FormState = "idle" | "submitting" | "success";

export function BugReportButton() {
  const { t } = useDictionary("common");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const pathname = usePathname();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const { currentUser } = useAuthStore();
  const sidebarWidth = isCollapsed ? 72 : 256;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleClose() {
    if (formState === "submitting") return;
    setOpen(false);
    // Reset after animation
    setTimeout(() => {
      setTitle("");
      setDescription("");
      setFormState("idle");
    }, 200);
  }

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || formState === "submitting") return;
    setFormState("submitting");

    try {
      const supabase = requireSupabase();
      await supabase.from("feature_requests").insert({
        type: "bug",
        title: title.trim(),
        description: description.trim() || null,
        platform: "web",
        status: "new",
        user_email: currentUser?.email ?? null,
      });

      setFormState("success");
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch {
      setFormState("idle");
    }
  }, [title, description, formState, currentUser]);

  // Don't render on dashboard (map filter rail occupies bottom-left)
  if (pathname === "/dashboard") return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-[90]"
      style={{ bottom: 16, left: sidebarWidth + 12 }}
    >
      {/* Popover form */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="absolute bottom-[44px] left-0 w-[320px] rounded-sm overflow-hidden"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[rgba(255,255,255,0.08)]">
              <span className="font-kosugi text-[10px] uppercase tracking-wider text-text-secondary">
                {t("bugReport.title")}
              </span>
              <button
                onClick={handleClose}
                className="p-1 text-text-disabled hover:text-text-secondary transition-colors duration-150"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Body */}
            <div className="p-3 space-y-2.5">
              {formState === "success" ? (
                <div className="flex flex-col items-center justify-center py-4 gap-2">
                  <CheckCircle2 className="w-5 h-5 text-ops-accent" />
                  <p className="font-mohave text-body-sm text-text-secondary text-left">
                    {t("bugReport.submitted")}
                  </p>
                </div>
              ) : (
                <>
                  {/* Title input */}
                  <div>
                    <label className="font-kosugi text-[9px] uppercase tracking-wider text-text-tertiary mb-1 block">
                      {t("bugReport.whatHappened")}
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("bugReport.titlePlaceholder")}
                      className={cn(
                        "w-full px-2.5 py-2 rounded-sm font-mohave text-body-sm text-text-primary",
                        "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                        "placeholder:text-text-disabled",
                        "focus:outline-none focus:border-ops-accent/40",
                        "transition-colors duration-150"
                      )}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                    />
                  </div>

                  {/* Description textarea */}
                  <div>
                    <label className="font-kosugi text-[9px] uppercase tracking-wider text-text-tertiary mb-1 block">
                      {t("bugReport.details")}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("bugReport.detailsPlaceholder")}
                      rows={3}
                      className={cn(
                        "w-full px-2.5 py-2 rounded-sm font-mohave text-body-sm text-text-primary resize-none",
                        "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                        "placeholder:text-text-disabled",
                        "focus:outline-none focus:border-ops-accent/40",
                        "transition-colors duration-150"
                      )}
                    />
                  </div>

                  {/* Auto-captured context */}
                  <p className="font-kosugi text-[9px] text-text-disabled tracking-wider">
                    {t("bugReport.autoCapture")}
                  </p>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || formState === "submitting"}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm",
                      "font-kosugi text-[10px] uppercase tracking-wider",
                      "transition-all duration-150",
                      title.trim() && formState !== "submitting"
                        ? "bg-ops-accent/20 text-ops-accent border border-ops-accent/30 hover:bg-ops-accent/30"
                        : "bg-[rgba(255,255,255,0.04)] text-text-disabled border border-[rgba(255,255,255,0.06)] cursor-not-allowed"
                    )}
                  >
                    {formState === "submitting" ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    {formState === "submitting"
                      ? t("bugReport.sending")
                      : t("bugReport.submit")}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bug button */}
      <motion.button
        onClick={() => setOpen((prev) => !prev)}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
        }
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-sm",
          "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)]",
          "border border-[rgba(255,255,255,0.08)]",
          "hover:border-[rgba(255,255,255,0.15)]",
          "transition-colors duration-150",
          open && "border-ops-accent/30"
        )}
        title={t("bugReport.title")}
      >
        <Bug className="w-[13px] h-[13px] text-text-disabled" />
        <span className="font-kosugi text-[9px] text-text-disabled tracking-wider uppercase select-none">
          {t("bugReport.label")}
        </span>
      </motion.button>
    </div>
  );
}
