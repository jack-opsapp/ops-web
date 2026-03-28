"use client";

/**
 * OPS Web - Share Portal Button
 *
 * Reusable button that opens a dialog to send a portal magic link
 * to a client. Used from client detail pages, estimate views, etc.
 */

import { useState } from "react";
import { Share2, Mail, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SharePortalButtonProps {
  clientId: string;
  clientEmail: string | null;
  companyName: string;
  context?: {
    estimateId?: string;
    invoiceId?: string;
    projectId?: string;
  };
  variant?: "default" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon";
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SharePortalButton({
  clientId,
  clientEmail,
  companyName,
  context,
  variant = "secondary",
  size = "sm",
  className,
}: SharePortalButtonProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(clientEmail ?? "");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const company = useAuthStore((s) => s.company);
  const companyId = company?.id;

  function handleOpen() {
    setEmail(clientEmail ?? "");
    setSent(false);
    setOpen(true);
  }

  async function handleSend() {
    if (!email.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    if (!companyId) {
      toast.error("Company not found. Please try again.");
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch("/api/portal/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          clientId,
          email: email.trim(),
          companyName,
          context,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send portal link");
      }

      setSent(true);
      toast.success(`Portal link sent to ${email.trim()}`);

      // Auto-close after brief success display
      setTimeout(() => {
        setOpen(false);
        setSent(false);
      }, 2000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send portal link"
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleOpen}
        className={cn("gap-[6px]", className)}
      >
        <Share2 className="w-[14px] h-[14px]" />
        Share Portal
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Client Portal</DialogTitle>
            <DialogDescription>
              Send a magic link so your client can access their portal to view
              estimates, invoices, and communicate with you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-1">
            {/* Email input */}
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                Client Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="client@example.com"
                prefixIcon={<Mail className="w-[14px] h-[14px]" />}
                disabled={isSending || sent}
              />
            </div>

            {/* Context info */}
            {context && (context.estimateId || context.invoiceId || context.projectId) && (
              <div className="px-1.5 py-1 rounded bg-[rgba(255,255,255,0.03)] border border-border-subtle">
                <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                  Linked to:
                </span>
                <div className="flex items-center gap-1 mt-[2px]">
                  {context.estimateId && (
                    <span className="font-mono text-[11px] text-text-tertiary">
                      Estimate
                    </span>
                  )}
                  {context.invoiceId && (
                    <span className="font-mono text-[11px] text-text-tertiary">
                      Invoice
                    </span>
                  )}
                  {context.projectId && (
                    <span className="font-mono text-[11px] text-text-tertiary">
                      Project
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Send button */}
            <div className="flex justify-end gap-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isSending}
              >
                Cancel
              </Button>
              {sent ? (
                <Button variant="primary" size="sm" disabled className="gap-[4px]">
                  <Check className="w-[14px] h-[14px]" />
                  Sent
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSend}
                  loading={isSending}
                  disabled={!email.trim()}
                  className="gap-[4px]"
                >
                  <Mail className="w-[14px] h-[14px]" />
                  Send Portal Link
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
