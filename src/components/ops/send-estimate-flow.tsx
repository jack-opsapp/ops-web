"use client";

import { useState, useMemo } from "react";
import { Send, Loader2, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useSendEstimate, useClients } from "@/lib/hooks";
import { formatCurrency } from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";

interface SendEstimateFlowProps {
  estimate: Estimate;
  opportunityId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

export function SendEstimateFlow({
  estimate,
  open,
  onOpenChange,
  onSent,
}: SendEstimateFlowProps) {
  const { data: clientsData } = useClients();
  const clients = clientsData?.clients ?? [];
  const sendEstimate = useSendEstimate();

  const client = useMemo(
    () => clients.find((c) => c.id === estimate.clientId),
    [clients, estimate.clientId]
  );

  const [email, setEmail] = useState(client?.email ?? "");
  const [sending, setSending] = useState(false);

  // Update email when client data loads
  if (client?.email && !email) {
    setEmail(client.email);
  }

  const handleSend = async () => {
    if (!email.trim()) {
      toast.error("Please enter a client email address");
      return;
    }

    setSending(true);
    try {
      await sendEstimate.mutateAsync(estimate.id);
      toast.success(`Estimate ${estimate.estimateNumber} sent`);
      onSent();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send estimate"
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0A0A0A] border border-[#2A2A2A] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#E5E5E5] font-['Mohave'] text-lg">
            Send Estimate
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Estimate summary */}
          <div className="rounded-lg bg-[#111] border border-[#2A2A2A] px-4 py-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#9CA3AF]">Estimate</span>
              <span className="font-mono text-sm text-[#C4A868]">
                {estimate.estimateNumber}
              </span>
            </div>
            {client && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#9CA3AF]">Client</span>
                <span className="text-sm text-[#E5E5E5]">{client.name}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#9CA3AF]">Total</span>
              <span className="font-mono text-sm text-[#E5E5E5]">
                {formatCurrency(estimate.total)}
              </span>
            </div>
          </div>

          {/* Email input */}
          <div className="space-y-1.5">
            <label className="text-xs text-[#9CA3AF] uppercase tracking-wider font-medium flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              Send to
            </label>
            <Input
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!client?.email && (
              <p className="text-xs text-[#6B7280]">
                No email on file for this client. Enter one above.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-[#2A2A2A]">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="flex-1 text-[#9CA3AF] hover:text-[#E5E5E5]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || !email.trim()}
              className="flex-1 bg-[#417394] hover:bg-[#4f8aae] text-white gap-2"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Estimate
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
