"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";

const EASE = [0.22, 1, 0.36, 1] as const;
const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const staggerItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } } };

interface ConnectStepProps {
  companyId: string;
}

export function ConnectStep({ companyId }: ConnectStepProps) {
  const [connecting, setConnecting] = useState<"gmail" | "microsoft365" | null>(null);
  const { currentUser } = useAuthStore();

  const handleConnect = (provider: "gmail" | "microsoft365") => {
    setConnecting(provider);

    // Build the OAuth initiation URL — same pattern as the existing integrations tab.
    // The OAuth callback redirects back to /settings?tab=integrations&status=connected&firstConnect=true
    // which auto-opens the wizard with the new connection.
    const endpoint =
      provider === "gmail"
        ? "/api/integrations/gmail"
        : "/api/integrations/microsoft365";

    // userId is required for BOTH company and individual connections — Phase C
    // memory/writing-profile extraction attributes artifacts to a real user.
    // Company connections attribute to whichever admin ran the wizard.
    if (!currentUser?.id) {
      console.error("[connect-step] No current user — cannot initiate OAuth");
      setConnecting(null);
      return;
    }

    const params = new URLSearchParams({
      companyId,
      userId: currentUser.id,
      type: "company",
    });

    // Full-page redirect to OAuth consent screen
    window.location.href = `${endpoint}?${params}`;
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.p
        variants={staggerItem}
        className="font-mohave text-[15px] text-[#999] mb-6"
      >
        Connect your business email to automatically discover and import your pipeline.
      </motion.p>

      <div className="flex flex-col gap-3">
        <motion.button
          variants={staggerItem}
          onClick={() => handleConnect("gmail")}
          disabled={!!connecting}
          className="group flex items-center gap-4 p-4 border border-white/10 bg-glass glass-surface hover:border-white/20 transition-all"
          style={{ borderRadius: 3 }}
        >
          <div className="w-10 h-10 flex items-center justify-center bg-white/5 border border-white/10" style={{ borderRadius: 2 }}>
            <Mail size={20} className="text-white" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-mohave text-[15px] font-medium text-white">
              Gmail / Google Workspace
            </p>
            <p className="font-mohave text-[12px] text-[#666]">
              Personal or business Gmail accounts
            </p>
          </div>
          {connecting === "gmail" ? (
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          ) : (
            <ExternalLink size={14} className="text-[#666] group-hover:text-[#999] transition-colors" />
          )}
        </motion.button>

        <motion.button
          variants={staggerItem}
          onClick={() => handleConnect("microsoft365")}
          disabled={!!connecting}
          className="group flex items-center gap-4 p-4 border border-white/10 bg-glass glass-surface hover:border-white/20 transition-all"
          style={{ borderRadius: 3 }}
        >
          <div className="w-10 h-10 flex items-center justify-center bg-white/5 border border-white/10" style={{ borderRadius: 2 }}>
            <Mail size={20} className="text-white" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-mohave text-[15px] font-medium text-white">
              Microsoft 365 / Outlook
            </p>
            <p className="font-mohave text-[12px] text-[#666]">
              Business Outlook and Microsoft 365
            </p>
          </div>
          {connecting === "microsoft365" ? (
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          ) : (
            <ExternalLink size={14} className="text-[#666] group-hover:text-[#999] transition-colors" />
          )}
        </motion.button>
      </div>

      <motion.p
        variants={staggerItem}
        className="font-mohave text-[11px] text-[#666] mt-5"
      >
        You&apos;ll be redirected to authorize. OPS requests full mailbox
        access to find leads, label threads, and draft replies on your behalf.
      </motion.p>
    </motion.div>
  );
}
