"use client";

import { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useActionPromptStore,
  type ActionPromptConfig,
} from "@/stores/action-prompt-store";
import {
  actionPromptVariants,
  actionPromptVariantsReduced,
} from "@/lib/utils/motion";

// ─── Individual Card ─────────────────────────────────────────────────────────

function ActionPromptCard({ prompt }: { prompt: ActionPromptConfig }) {
  const dismissPrompt = useActionPromptStore((s) => s.dismissPrompt);
  const removePrompt = useActionPromptStore((s) => s.removePrompt);
  const prefersReducedMotion = useReducedMotion();

  const {
    id,
    icon: Icon,
    title,
    description,
    ctaLabel,
    ctaAction,
    persistent = true,
    dismissable = true,
    autoDismissMs,
    variant = "default",
  } = prompt;

  // Auto-dismiss for non-persistent prompts
  useEffect(() => {
    if (persistent || !autoDismissMs) return;
    const timer = setTimeout(() => removePrompt(id), autoDismissMs);
    return () => clearTimeout(timer);
  }, [persistent, autoDismissMs, id, removePrompt]);

  return (
    <motion.div
      layout
      variants={prefersReducedMotion ? actionPromptVariantsReduced : actionPromptVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        "max-w-[380px] w-full",
        "bg-background-panel border border-border shadow-floating backdrop-blur-sm",
        "rounded-lg p-3 flex items-start gap-3",
        variant === "accent" && "border-l-4 border-l-ops-accent"
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <Icon className="w-[18px] h-[18px] text-ops-accent" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary leading-tight">
          {title}
        </p>
        <p className="font-kosugi text-caption-sm text-text-secondary mt-0.5 leading-snug">
          {description}
        </p>
        <button
          onClick={() => {
            ctaAction();
            dismissPrompt(id, true);
          }}
          className={cn(
            "mt-2 px-3 py-1 rounded text-button-sm font-mohave",
            "bg-ops-accent/15 text-ops-accent",
            "hover:bg-ops-accent/25 transition-colors duration-150"
          )}
        >
          {ctaLabel}
        </button>
      </div>

      {/* Dismiss */}
      {dismissable && (
        <button
          onClick={() => dismissPrompt(id, true)}
          className="shrink-0 p-0.5 rounded hover:bg-border-subtle transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-[14px] h-[14px] text-text-tertiary" />
        </button>
      )}
    </motion.div>
  );
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export function ActionPromptRenderer() {
  const activePrompts = useActionPromptStore((s) => s.activePrompts);
  const visible = activePrompts.slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <div className="fixed top-[60px] left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-1 items-center pointer-events-none">
      <AnimatePresence mode="popLayout">
        {visible.map((prompt) => (
          <div key={prompt.id} className="pointer-events-auto">
            <ActionPromptCard prompt={prompt} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
