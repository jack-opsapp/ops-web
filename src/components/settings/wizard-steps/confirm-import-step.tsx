"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  UserPlus,
  Link2,
  Users,
  Target,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalyzedLead } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  qualifying: "Qualifying",
  quoting: "Quoting",
  quoted: "Quoted",
  follow_up: "Follow Up",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

interface LeadMatch {
  existingClientId: string | null;
  existingClientName: string | null;
  existingClientEmail: string | null;
  hasOpenOpp: boolean;
  openOppStage: string | null;
  matchSource: "email" | "subclient" | "pre-matched" | null;
}

interface VerifyResult {
  matches: Record<string, LeadMatch>;
  summary: {
    newClients: number;
    existingLinks: number;
    newLeads: number;
    existingOpps: number;
    subContacts: number;
    total: number;
  };
}

interface ConfirmImportStepProps {
  leads: AnalyzedLead[];
  companyId: string;
  onBack: () => void;
  onImport: () => Promise<void>;
  importing: boolean;
}

export function ConfirmImportStep({
  leads,
  companyId,
  onBack,
  onImport,
  importing,
}: ConfirmImportStepProps) {
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabledLeads = useMemo(() => leads.filter((l) => l.enabled), [leads]);

  // ─── Verify leads on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/integrations/email/verify-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            leads: enabledLeads.map((l) => ({
              id: l.id,
              clientEmail: l.client.email,
              clientName: l.client.name,
              stage: l.stage,
              action: l.matchResult.action,
              existingClientId: l.matchResult.existingClientId,
              subContacts: l.subContacts?.map((sc) => ({ name: sc.name, email: sc.email })),
            })),
          }),
        });

        if (!res.ok) throw new Error("Verification failed");
        const data: VerifyResult = await res.json();
        if (!cancelled) setVerifyResult(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Verification failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [companyId, enabledLeads]);

  // ─── Derive duplicate list ──────────────────────────────────────────────
  const duplicates = useMemo(() => {
    if (!verifyResult) return [];
    return enabledLeads
      .filter((l) => {
        const match = verifyResult.matches[l.id];
        return match && match.existingClientId;
      })
      .map((l) => ({
        lead: l,
        match: verifyResult.matches[l.id],
      }));
  }, [enabledLeads, verifyResult]);

  const existingOppLeads = useMemo(() => {
    if (!verifyResult) return [];
    return enabledLeads
      .filter((l) => verifyResult.matches[l.id]?.hasOpenOpp)
      .map((l) => ({
        lead: l,
        match: verifyResult.matches[l.id],
      }));
  }, [enabledLeads, verifyResult]);

  // ─── Loading state ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 size={24} className="text-[#597794] animate-spin" />
        <p className="font-mohave text-[14px] text-[#999]">
          Checking for duplicates...
        </p>
        <p className="font-mohave text-[11px] text-[#666]">
          Verifying {enabledLeads.length} leads against your database
        </p>
      </div>
    );
  }

  // ─── Error state ──────────────────────────────────────────────────────
  if (error || !verifyResult) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertTriangle size={24} className="text-[#C4A868]" />
        <p className="font-mohave text-[14px] text-[#999]">
          {error || "Verification failed"}
        </p>
        <div className="flex gap-3">
          <Button
            onClick={onBack}
            variant="ghost"
            className="font-mohave text-[13px] text-[#666]"
          >
            &larr; Back
          </Button>
          <Button
            onClick={onImport}
            className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6"
            style={{ borderRadius: 3 }}
          >
            Import Anyway
          </Button>
        </div>
      </div>
    );
  }

  const { summary } = verifyResult;

  return (
    <div>
      <p className="font-mohave text-[15px] text-[#999] mb-1">
        Final review before import
      </p>
      <p className="font-mohave text-[12px] text-[#666] mb-5">
        Verified {summary.total} leads against your database. Here&apos;s what will happen.
      </p>

      {/* ─── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0 }}
          className="p-3 border border-white/8 bg-[#111]"
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <UserPlus size={13} className="text-[#597794]" />
            <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#666]">
              New clients
            </span>
          </div>
          <p className="font-mohave text-[22px] text-white leading-none">
            {summary.newClients}
          </p>
          <p className="font-mohave text-[10px] text-[#555] mt-0.5">
            will be created
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.05 }}
          className="p-3 border border-white/8 bg-[#111]"
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Link2 size={13} className="text-[#C4A868]" />
            <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#666]">
              Existing clients
            </span>
          </div>
          <p className="font-mohave text-[22px] text-white leading-none">
            {summary.existingLinks}
          </p>
          <p className="font-mohave text-[10px] text-[#555] mt-0.5">
            will be linked
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.1 }}
          className="p-3 border border-white/8 bg-[#111]"
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Target size={13} className="text-[#9DB582]" />
            <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#666]">
              Leads
            </span>
          </div>
          <p className="font-mohave text-[22px] text-white leading-none">
            {summary.newLeads}
          </p>
          <p className="font-mohave text-[10px] text-[#555] mt-0.5">
            opportunities to create
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.15 }}
          className="p-3 border border-white/8 bg-[#111]"
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Users size={13} className="text-[#A182B5]" />
            <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#666]">
              Sub-contacts
            </span>
          </div>
          <p className="font-mohave text-[22px] text-white leading-none">
            {summary.subContacts}
          </p>
          <p className="font-mohave text-[10px] text-[#555] mt-0.5">
            additional contacts
          </p>
        </motion.div>
      </div>

      {/* ─── Existing open opportunities warning ──────────────────────── */}
      {existingOppLeads.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.2 }}
          className="mb-4 p-3 border border-[#C4A868]/15 bg-[#111]"
          style={{ borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={12} className="text-[#C4A868]" />
            <span className="font-kosugi text-[9px] tracking-[0.12em] uppercase text-[#C4A868]">
              Existing opportunities found
            </span>
          </div>
          <p className="font-mohave text-[11px] text-[#666] mb-2">
            These clients already have open leads — import will add to their existing opportunity instead of creating a new one.
          </p>
          <div className="space-y-1 max-h-[100px] overflow-y-auto scrollbar-hide">
            {existingOppLeads.map(({ lead, match }) => (
              <div key={lead.id} className="flex items-center gap-2 py-0.5">
                <span className="font-mohave text-[12px] text-white truncate">
                  {lead.client.name}
                </span>
                <ArrowRight size={10} className="text-[#555] flex-shrink-0" />
                <span className="font-mohave text-[11px] text-[#C4A868] truncate">
                  {STAGE_LABELS[match.openOppStage || ""] || match.openOppStage}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─── Duplicate matches ────────────────────────────────────────── */}
      {duplicates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.25 }}
          className="mb-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={12} className="text-[#597794]" />
            <span className="font-kosugi text-[9px] tracking-[0.12em] uppercase text-[#597794]">
              Database matches ({duplicates.length})
            </span>
          </div>
          <div className="space-y-1 max-h-[140px] overflow-y-auto scrollbar-hide">
            {duplicates.map(({ lead, match }) => (
              <div
                key={lead.id}
                className="flex items-center gap-2 py-1.5 px-2.5 border border-white/5 bg-[#111]"
                style={{ borderRadius: 2 }}
              >
                <span className="font-mohave text-[12px] text-white truncate flex-1 min-w-0">
                  {lead.client.name}
                </span>
                <ArrowRight size={10} className="text-[#555] flex-shrink-0" />
                <span className="font-mohave text-[11px] text-[#597794] truncate flex-1 min-w-0 text-right">
                  {match.existingClientName || match.existingClientEmail || "Existing client"}
                </span>
                <span
                  className="font-kosugi text-[7px] tracking-[0.1em] uppercase px-1.5 py-0.5 flex-shrink-0"
                  style={{
                    borderRadius: 2,
                    background: match.matchSource === "email" ? "rgba(89, 119, 148, 0.15)" : "rgba(161, 130, 181, 0.15)",
                    color: match.matchSource === "email" ? "#597794" : "#A182B5",
                  }}
                >
                  {match.matchSource === "subclient" ? "sub-contact" : "email"}
                </span>
              </div>
            ))}
          </div>
          <p className="font-mohave text-[10px] text-[#555] mt-1.5">
            Matched leads will be linked to existing clients — no duplicates will be created.
          </p>
        </motion.div>
      )}

      {/* ─── Import bar ───────────────────────────────────────────────── */}
      <div
        className="sticky bottom-0 mt-4 -mx-6 px-6 py-3 flex items-center justify-between border-t border-white/8"
        style={{
          background: "rgba(13, 13, 13, 0.85)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        }}
      >
        <button
          onClick={onBack}
          className="font-mohave text-[13px] text-[#666] hover:text-white transition-colors"
        >
          &larr; Back to review
        </button>
        <Button
          onClick={onImport}
          disabled={importing}
          className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2 disabled:opacity-40"
          style={{ borderRadius: 3 }}
        >
          {importing ? (
            <>
              <Loader2 size={14} className="animate-spin mr-2" />
              Importing...
            </>
          ) : (
            `Import ${summary.newLeads + summary.existingOpps} Lead${summary.newLeads + summary.existingOpps !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>
    </div>
  );
}
