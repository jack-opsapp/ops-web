"use client";
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { AudienceFilterNode } from "@/lib/admin/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  /**
   * When provided, overrides the built-in segment dropdown with a custom
   * predicate from the Audience Builder. Sent to /api/admin/email/campaigns
   * as the `audienceFilter` field, and previewed via /audience/preview.
   */
  audienceFilterOverride?: AudienceFilterNode | null;
}

interface TemplateOption {
  id: string;
  label: string;
  description: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "product_update",
    label: "Product update",
    description: "Periodic product news to active subscribers and trials.",
  },
  {
    id: "trial_expiry_campaign",
    label: "Trial expiry warning",
    description: "Trial expiry urgency campaign — points users at billing.",
  },
  {
    id: "feature_announcement",
    label: "Feature announcement",
    description: "Major feature ship announcement.",
  },
  {
    id: "reengagement",
    label: "Reengagement",
    description: "Win-back for dormant users (not trial-specific).",
  },
];

interface SegmentOption {
  id: string;
  label: string;
  description: string;
}

const SEGMENTS: SegmentOption[] = [
  { id: "all_users", label: "All opted-in users", description: "Everyone is_active and not opted out." },
  { id: "trial_users", label: "Trial users", description: "Companies whose subscription_status is trial." },
  { id: "active_subscribers", label: "Active subscribers", description: "active or grace subscriptions." },
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

interface CreateResponse {
  campaign: { id: string };
}

export function CampaignCreateModal({
  open,
  onClose,
  onCreated,
  audienceFilterOverride,
}: Props) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();

  const [name, setName] = React.useState("");
  const [templateId, setTemplateId] = React.useState(TEMPLATES[0].id);
  const [segment, setSegment] = React.useState(SEGMENTS[0].id);
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Reset form when the modal closes — next open starts clean.
  React.useEffect(() => {
    if (!open) {
      setName("");
      setTemplateId(TEMPLATES[0].id);
      setSegment(SEGMENTS[0].id);
      setScheduleAt("");
      setError(null);
    }
  }, [open]);

  const slug = React.useMemo(() => slugify(name), [name]);

  const usingOverride = !!audienceFilterOverride;
  const overrideKey = usingOverride
    ? JSON.stringify(audienceFilterOverride)
    : null;

  const audienceQuery = useQuery({
    queryKey: ["audienceEstimate", usingOverride ? overrideKey : segment],
    queryFn: async () => {
      if (usingOverride) {
        const res = await fetch("/api/admin/email/audience/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filter: audienceFilterOverride }),
        });
        if (!res.ok) throw new Error("preview_failed");
        const j = await res.json();
        return { count: (j.count as number) ?? 0 };
      }
      const res = await fetch(
        "/api/admin/email/campaigns/audience-estimate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filter: { segment } }),
        }
      );
      if (!res.ok) throw new Error("estimate_failed");
      return (await res.json()) as { count: number };
    },
    enabled: open,
    staleTime: 30_000,
  });

  const createMutation = useMutation<CreateResponse, Error>({
    mutationFn: async () => {
      setError(null);
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required.");
      if (!slug) throw new Error("Name must contain at least one letter or digit.");

      const createRes = await fetch("/api/admin/email/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          slug,
          templateId,
          audienceFilter: usingOverride
            ? audienceFilterOverride
            : { segment },
        }),
      });
      if (!createRes.ok) {
        const errBody = await createRes.json().catch(() => null);
        throw new Error(errBody?.error ?? "create_failed");
      }
      const body = (await createRes.json()) as CreateResponse;

      if (scheduleAt) {
        const when = new Date(scheduleAt);
        const schedRes = await fetch(
          `/api/admin/email/campaigns/${body.campaign.id}/schedule`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scheduledFor: when.toISOString() }),
          }
        );
        if (!schedRes.ok) {
          const errBody = await schedRes.json().catch(() => null);
          throw new Error(errBody?.error ?? "schedule_failed");
        }
      }

      return body;
    },
    onSuccess: (body) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      onCreated?.(body.campaign.id);
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const audienceText = audienceQuery.isLoading
    ? "counting…"
    : audienceQuery.isError
    ? "[count unavailable]"
    : `${audienceQuery.data?.count ?? 0} recipients`;

  const t = reduce
    ? { duration: 0.15 }
    : { duration: 0.32, ease: EASE_SMOOTH };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.65)", zIndex: 3000 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={t}
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-create-title"
            className="w-full max-w-[480px] p-6 rounded-[12px]"
            style={{
              background: "rgba(18,18,20,0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <h2
              id="campaign-create-title"
              className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED] mb-1"
            >
              {"// NEW CAMPAIGN"}
            </h2>
            <p className="font-mono text-[11px] text-[#8A8A8A] mb-5">
              [save as draft now, schedule once you&apos;re ready]
            </p>

            <label className="block mb-4">
              <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                NAME
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full font-mohave text-[14px] bg-transparent border border-white/10 rounded-[5px] px-3 py-2 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0]"
                placeholder="Q2 product update"
                autoFocus
              />
              {slug ? (
                <span className="font-mono text-[10px] text-[#6A6A6A] mt-1 block">
                  [slug = {slug}]
                </span>
              ) : null}
            </label>

            <label className="block mb-4">
              <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                TEMPLATE
              </span>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full font-mohave text-[14px] bg-transparent border border-white/10 rounded-[5px] px-3 py-2 text-[#EDEDED]"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id} className="bg-black">
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[10px] text-[#6A6A6A] mt-1 block">
                [{TEMPLATES.find((t) => t.id === templateId)?.description}]
              </span>
            </label>

            <label className="block mb-4">
              <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                AUDIENCE
              </span>
              {usingOverride ? (
                <div
                  className="w-full font-mono text-[12px] text-[#EDEDED] border border-white/10 rounded-[5px] px-3 py-2"
                  style={{ background: "rgba(157,181,130,0.04)" }}
                >
                  [custom predicate from audience builder]
                </div>
              ) : (
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full font-mohave text-[14px] bg-transparent border border-white/10 rounded-[5px] px-3 py-2 text-[#EDEDED]"
                >
                  {SEGMENTS.map((s) => (
                    <option key={s.id} value={s.id} className="bg-black">
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <span
                className="font-mono text-[11px] text-[#9DB582] mt-1 block"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                [{audienceText}]
              </span>
            </label>

            <label className="block mb-6">
              <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] block mb-1">
                SCHEDULE FOR
              </span>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="w-full font-mono text-[13px] bg-transparent border border-white/10 rounded-[5px] px-3 py-2 text-[#EDEDED] focus:outline-none focus:border-[#6F94B0]"
              />
              <span className="font-mono text-[10px] text-[#6A6A6A] mt-1 block">
                [leave blank to save as draft]
              </span>
            </label>

            {error ? (
              <p
                className="font-mono text-[11px] text-[#B58289] mb-4"
                role="alert"
              >
                [error] {error}
              </p>
            ) : null}

            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#8A8A8A] hover:text-[#EDEDED] px-3 py-2 transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!name.trim() || createMutation.isPending}
                className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-[5px] transition-colors"
              >
                {createMutation.isPending
                  ? "SAVING…"
                  : scheduleAt
                  ? "SCHEDULE SEND"
                  : "SAVE DRAFT"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
