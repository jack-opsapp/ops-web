"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LOSS_REASONS, formatCurrency } from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { Trophy, XCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StageTransitionDialogProps {
  type: "won" | "lost" | null;
  opportunity: Opportunity | null;
  onConfirm: (data: {
    actualValue?: number;
    lostReason?: string;
    lostNotes?: string;
  }) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Won Dialog Content
// ---------------------------------------------------------------------------
function WonContent({
  opportunity,
  onConfirm,
  onCancel,
}: {
  opportunity: Opportunity;
  onConfirm: (data: { actualValue?: number }) => void;
  onCancel: () => void;
}) {
  const [actualValue, setActualValue] = useState(
    opportunity.estimatedValue?.toString() ?? ""
  );
  const [convertToProject, setConvertToProject] = useState(false);

  const handleConfirm = () => {
    const value = actualValue ? parseFloat(actualValue) : undefined;
    onConfirm({
      actualValue: value && !isNaN(value) ? value : undefined,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Trophy className="w-[18px] h-[18px] text-status-success" />
          Deal Won!
        </DialogTitle>
        <DialogDescription>
          Congratulations on closing {opportunity.title}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        {/* Final deal value */}
        <div className="space-y-0.5">
          <label className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest">
            Final Deal Value
          </label>
          <div className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-text-tertiary">
              $
            </span>
            <input
              type="number"
              value={actualValue}
              onChange={(e) => setActualValue(e.target.value)}
              placeholder={
                opportunity.estimatedValue
                  ? formatCurrency(opportunity.estimatedValue)
                  : "0.00"
              }
              className={cn(
                "w-full bg-background-input text-text-primary font-mono text-body",
                "pl-4 pr-1.5 py-1.5 rounded-lg border border-border",
                "placeholder:text-text-tertiary",
                "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent"
              )}
            />
          </div>
        </div>

        {/* Convert to project checkbox */}
        <label className="flex items-center gap-1.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={convertToProject}
            onChange={(e) => setConvertToProject(e.target.checked)}
            className="w-[14px] h-[14px] rounded border-border bg-background-input accent-ops-accent"
          />
          <span className="font-kosugi text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
            Convert to Project
          </span>
          <span className="font-kosugi text-[9px] text-text-disabled">(coming soon)</span>
        </label>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm}>
          Mark Won
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lost Dialog Content
// ---------------------------------------------------------------------------
function LostContent({
  opportunity,
  onConfirm,
  onCancel,
}: {
  opportunity: Opportunity;
  onConfirm: (data: { lostReason?: string; lostNotes?: string }) => void;
  onCancel: () => void;
}) {
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");

  const handleConfirm = () => {
    onConfirm({
      lostReason: lostReason || undefined,
      lostNotes: lostNotes.trim() || undefined,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <XCircle className="w-[18px] h-[18px] text-ops-error" />
          Mark as Lost
        </DialogTitle>
        <DialogDescription>
          Record why {opportunity.title} was lost
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        {/* Loss reason */}
        <div className="space-y-0.5">
          <label className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest">
            Reason *
          </label>
          <select
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            className={cn(
              "w-full bg-background-input text-text-primary font-mohave text-body",
              "px-1.5 py-1.5 rounded-lg border border-border",
              "focus:border-ops-accent focus:outline-none",
              "cursor-pointer",
              !lostReason && "text-text-tertiary"
            )}
          >
            <option value="">Select a reason...</option>
            {LOSS_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="space-y-0.5">
          <label className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest">
            Notes (optional)
          </label>
          <textarea
            value={lostNotes}
            onChange={(e) => setLostNotes(e.target.value)}
            placeholder="Any additional details..."
            rows={3}
            className={cn(
              "w-full bg-background-input text-text-primary font-kosugi text-body-sm",
              "px-1.5 py-1.5 rounded-lg border border-border resize-none",
              "placeholder:text-text-tertiary",
              "focus:border-ops-accent focus:outline-none"
            )}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!lostReason}
          onClick={handleConfirm}
        >
          Mark Lost
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stage Transition Dialog
// ---------------------------------------------------------------------------
export function StageTransitionDialog({
  type,
  opportunity,
  onConfirm,
  onCancel,
}: StageTransitionDialogProps) {
  if (!opportunity) return null;

  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {type === "won" && (
          <WonContent
            opportunity={opportunity}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
        {type === "lost" && (
          <LostContent
            opportunity={opportunity}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
