"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { Btn } from "@/components/ops/projects/workspace/atoms/btn";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";

// `<ConfirmModal>` — workspace-scoped destructive confirmation dialog.
//
// Used for archive / delete / detach flows where the action is reversible
// in policy but immediate in effect. The destructive variant wears a
// 1px rose accent stripe at the top edge so the operator clocks the
// "this is a hard action" signal before reading the body. CANCEL on the
// left, ARCHIVE/DELETE on the right — same Btn destructive variant that
// the workspace footer uses, so the visual language carries across.
//
// Built on Radix Dialog primitive — the workspace floating-window stack
// already opts into the `glass-dense` + `--shadow-window` sanctioned
// elevation pair (see system.md amendment 2026-05-07). The modal shares
// that elevation since it lives ABOVE the workspace shell.
//
// Motion: opacity 0→1 + scale 0.96→1, 220ms with EASE_SMOOTH. Reduced
// motion drops both transforms — the modal swaps in instantly. No spring.

export interface ConfirmModalProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the user dismisses (clicks scrim, presses Esc, hits CANCEL). */
  onOpenChange: (open: boolean) => void;
  /** UPPERCASE title — Cake Mono Light voice. e.g. `// ARCHIVE PROJECT`. */
  title: string;
  /** Body sentence(s) — Mohave 14px. Plain language, what the operator is about to do. */
  body: React.ReactNode;
  /** Confirm button label. UPPERCASE. e.g. `ARCHIVE`. */
  confirmLabel: string;
  /** Cancel button label. UPPERCASE. Defaults to `CANCEL`. */
  cancelLabel?: string;
  /** Fired when the operator confirms. The caller closes the modal and
   *  fires the mutation. The modal does not auto-close on confirm —
   *  callers may want to keep it open during an async operation. */
  onConfirm: () => void;
  /** Disables the confirm button (e.g. while a mutation is pending). */
  isConfirming?: boolean;
  /** Optional override testId for the content surface. */
  "data-testid"?: string;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  isConfirming = false,
  ...rest
}: ConfirmModalProps) {
  const reducedMotion = useReducedMotion();
  const { t } = useDictionary("project-workspace");
  const resolvedCancelLabel = cancelLabel ?? t("footer.cancel");
  const testId = rest["data-testid"] ?? "confirm-modal";

  // 220ms is the system-wide modal cadence — fast enough that the operator
  // doesn't perceive a delay, slow enough that the scale-in lands rather
  // than snaps. Reduced motion swaps in instantly so vestibular users
  // don't get a transform applied at all.
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: EASE_SMOOTH };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <motion.div
            data-testid={`${testId}-scrim`}
            // The scrim sits on top of the workspace shell — z-modal so it
            // outranks floating windows (z-window) but stays below the
            // emergency lockout layer.
            className={cn(
              "fixed inset-0 z-modal",
              "bg-[var(--scrim-overlay)] backdrop-blur-[2px]",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild>
          <motion.div
            data-testid={testId}
            role="alertdialog"
            // Top accent stripe is a 1px inset border on the top edge using
            // the rose token. Implemented via a wrapper border so it does
            // not alter the modal's content padding.
            className={cn(
              "fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2",
              "w-full max-w-[420px]",
              "glass-dense rounded-modal",
              "border-t border-t-[var(--rose)]",
              "focus:outline-none",
            )}
            style={{
              // --shadow-window is the sanctioned floating-window elevation —
              // see system.md amendment 2026-05-07. The modal inherits the
              // same depth treatment as the workspace shell because it
              // lives ABOVE that shell in the stacking order.
              boxShadow: "var(--shadow-window)",
            }}
            initial={
              reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }
            }
            animate={{ opacity: 1, scale: 1 }}
            exit={
              reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }
            }
            transition={transition}
          >
            <div className="flex flex-col gap-3 p-5">
              <DialogPrimitive.Title asChild>
                <Mono
                  size={11}
                  color="text"
                  className="font-cakemono font-light uppercase tracking-wider text-[18px] leading-tight"
                >
                  {title}
                </Mono>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description asChild>
                <Body size={14} color="text-2">
                  {body}
                </Body>
              </DialogPrimitive.Description>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  data-testid={`${testId}-cancel`}
                >
                  {resolvedCancelLabel}
                </Btn>
                <Btn
                  variant="destructive"
                  size="sm"
                  onClick={onConfirm}
                  disabled={isConfirming}
                  data-testid={`${testId}-confirm`}
                >
                  {confirmLabel}
                </Btn>
              </div>
            </div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
