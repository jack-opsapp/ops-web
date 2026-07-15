"use client";

/**
 * Toast — Sonner wrapper styled to the OPS Web design system (spec v2).
 *
 * Design contract:
 *   - Glass-dense surface (rgba(18,18,20,0.78) + 28px blur, 12px radius)
 *   - 3px left status rail signals type at a glance: olive (success),
 *     rose (error), ops-amber (warning), ops-accent (info)
 *   - Title uses uppercase Mohave with tight tracking — tactical voice
 *   - Description uses JetBrains Mono micro label, sentence case
 *   - Borders-only depth; no box-shadow
 *   - Motion follows EASE_SMOOTH (cubic-bezier(0.22, 1, 0.36, 1))
 *
 * API surface is preserved 1:1 with the existing `sonner` package:
 *   import { toast } from "@/components/ui/toast";
 *   toast.success("STATUS UPDATED", { description: "Moved to In Progress" });
 *
 * Accessibility:
 *   - Sonner emits role="status" with aria-live="polite" by default; nothing
 *     here overrides it. Keyboard-dismiss (Esc when focused) still works.
 *
 * Mounted once in src/app/layout.tsx.
 */

import { Toaster as Sonner, toast } from "sonner";
import { cn } from "@/lib/utils/cn";

/** Default visibility window. Exported for callers that update a persistent
 * toast in place (Sonner merges update payloads, so a previous Infinity
 * duration must be overwritten explicitly). */
export const DEFAULT_TOAST_DURATION_MS = 4500;

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ className, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-right"
      offset={72}
      gap={8}
      duration={DEFAULT_TOAST_DURATION_MS}
      visibleToasts={3}
      className={cn("ops-toaster toaster group", className)}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: cn(
            "ops-toast group toast",
            "glass-dense",
            // Override Sonner's default padding/min-width so density matches
            // other glass-dense surfaces (popovers, dropdowns).
            "!w-[340px] !min-h-0 !p-0 !rounded-modal !border-glass-border",
            // Remove Sonner's default shadow — borders-only depth per spec v2.
            "!shadow-none"
          ),
          title: cn(
            "font-mohave uppercase text-text",
            "text-[12px] leading-[1.1] tracking-[0.08em] font-medium"
          ),
          description: cn(
            "font-mono text-text-3",
            "text-[11px] leading-[1.35] tracking-[0.02em]",
            "mt-1"
          ),
          actionButton: cn(
            "font-mohave uppercase text-[11px] tracking-[0.12em]",
            "!bg-transparent !text-ops-accent",
            "!border !border-ops-accent !rounded",
            "!px-2 !py-[3px] !h-auto",
            "hover:!bg-ops-accent hover:!text-black",
            "transition-colors duration-150"
          ),
          cancelButton: cn(
            "font-mohave uppercase text-[11px] tracking-[0.12em]",
            "!bg-transparent !text-text-2",
            "!border !border-line-hi !rounded",
            "!px-2 !py-[3px] !h-auto",
            "hover:!text-text hover:!border-text-2",
            "transition-colors duration-150"
          ),
          closeButton: cn(
            "!bg-transparent !border-0 !text-text-3",
            "hover:!text-text hover:!bg-fill-neutral-dim",
            "!rounded !left-auto !right-2 !top-2",
            "!h-5 !w-5"
          ),
          icon: "hidden",
          // Type-scoped hooks — left status rail color is applied via
          // [data-type] selectors in globals.css. Class names below stay for
          // structural clarity in DevTools.
          success: "ops-toast-success",
          error: "ops-toast-error",
          info: "ops-toast-info",
          warning: "ops-toast-warning",
          loading: "ops-toast-loading",
          default: "ops-toast-default",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
