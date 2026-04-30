"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { AudienceFilterRow } from "./audience-filter-row";
import { AudienceSaveTemplateModal } from "./audience-save-template-modal";
import { audienceCountVariants } from "@/lib/utils/motion";
import type {
  AudienceFilterClause,
  AudienceFilterNode,
  AudiencePreviewResponse,
  AudienceTemplate,
} from "@/lib/admin/types";

function clausesToNode(
  combinator: "and" | "or",
  clauses: AudienceFilterClause[]
): AudienceFilterNode {
  return { [combinator]: clauses } as AudienceFilterNode;
}

interface TemplateRoot {
  and?: AudienceFilterClause[];
  or?: AudienceFilterClause[];
}

const DEFAULT_CLAUSES: AudienceFilterClause[] = [
  { field: "subscription_status", op: "eq", value: "trialing" },
];

export function AudienceBuilderTab() {
  const [combinator, setCombinator] = React.useState<"and" | "or">("and");
  const [clauses, setClauses] =
    React.useState<AudienceFilterClause[]>(DEFAULT_CLAUSES);
  const [debouncedFilter, setDebouncedFilter] = React.useState<AudienceFilterNode>(
    clausesToNode("and", DEFAULT_CLAUSES)
  );
  const [saveOpen, setSaveOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(
      () => setDebouncedFilter(clausesToNode(combinator, clauses)),
      400
    );
    return () => clearTimeout(t);
  }, [combinator, clauses]);

  const preview = useQuery({
    queryKey: ["audiencePreview", JSON.stringify(debouncedFilter)],
    queryFn: async (): Promise<AudiencePreviewResponse> => {
      const r = await fetch("/api/admin/email/audience/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: debouncedFilter }),
      });
      if (!r.ok) throw new Error("preview_failed");
      return (await r.json()) as AudiencePreviewResponse;
    },
  });

  const templates = useQuery({
    queryKey: ["audienceTemplates"],
    queryFn: async (): Promise<AudienceTemplate[]> => {
      const r = await fetch("/api/admin/email/suppressions/templates");
      if (!r.ok) throw new Error("templates_failed");
      return ((await r.json()).templates ?? []) as AudienceTemplate[];
    },
  });

  const useInCampaign = () => {
    window.dispatchEvent(
      new CustomEvent("ops:audience-use-in-campaign", {
        detail: { filter: debouncedFilter },
      })
    );
  };

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED]">
            {"// AUDIENCE BUILDER"}
          </h3>
          <p className="font-mono text-[11px] text-[#8A8A8A]">
            [build a filter, save it, point a campaign at it]
          </p>
        </div>
      </header>

      <div
        className="rounded-[10px] p-4"
        style={{ border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A]">
            MATCH
          </span>
          <button
            onClick={() => setCombinator("and")}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] px-2 py-0.5 rounded-[4px]"
            style={{
              border: `1px solid ${
                combinator === "and" ? "#6F94B0" : "rgba(255,255,255,0.12)"
              }`,
              color: combinator === "and" ? "#6F94B0" : "#B5B5B5",
            }}
          >
            ALL
          </button>
          <button
            onClick={() => setCombinator("or")}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] px-2 py-0.5 rounded-[4px]"
            style={{
              border: `1px solid ${
                combinator === "or" ? "#6F94B0" : "rgba(255,255,255,0.12)"
              }`,
              color: combinator === "or" ? "#6F94B0" : "#B5B5B5",
            }}
          >
            ANY
          </button>
        </div>
        <div className="space-y-3">
          {clauses.map((c, i) => (
            <AudienceFilterRow
              key={i}
              clause={c}
              onChange={(next) =>
                setClauses(clauses.map((x, j) => (j === i ? next : x)))
              }
              onRemove={() => setClauses(clauses.filter((_, j) => j !== i))}
            />
          ))}
        </div>
        <button
          onClick={() =>
            setClauses([...clauses, { field: "email", op: "like", value: "" }])
          }
          className="mt-3 font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] border border-white/10 hover:bg-white/[0.05] px-3 py-1 rounded-[4px]"
        >
          + ADD CONDITION
        </button>
      </div>

      <div
        className="rounded-[10px] p-5 flex items-center justify-between"
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(157,181,130,0.04)",
        }}
      >
        <div>
          <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#8A8A8A] block">
            RECIPIENTS
          </span>
          <motion.span
            key={preview.data?.count ?? 0}
            variants={audienceCountVariants}
            initial="hidden"
            animate="visible"
            className="font-cakemono font-light text-[28px] text-[#9DB582] inline-block"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {preview.isLoading ? "—" : (preview.data?.count ?? 0)}
          </motion.span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSaveOpen(true)}
            className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5] border border-white/10 hover:bg-white/[0.05] px-3 py-1.5 rounded-[5px]"
          >
            SAVE AS TEMPLATE
          </button>
          <button
            onClick={useInCampaign}
            className="font-cakemono font-light text-[12px] tracking-[0.06em] text-[#6F94B0] border border-[#6F94B0] hover:bg-[#6F94B0] hover:text-black px-3 py-1.5 rounded-[5px]"
          >
            USE IN CAMPAIGN
          </button>
        </div>
      </div>

      {(preview.data?.sample.length ?? 0) > 0 && (
        <div
          className="rounded-[10px] overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p
            className="px-3 py-2 font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A]"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            SAMPLE [first 10]
          </p>
          {preview.data!.sample.map((s) => (
            <div
              key={s.user_id}
              className="px-3 py-1.5 border-t border-white/[0.04] font-mono text-[12px] text-[#B5B5B5]"
            >
              {s.email}
            </div>
          ))}
        </div>
      )}

      {(templates.data?.length ?? 0) > 0 && (
        <div>
          <h4 className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#8A8A8A] mb-2">
            {"// SAVED TEMPLATES"}
          </h4>
          <div className="space-y-1">
            {templates.data!.map((t) => {
              const root = t.filter as TemplateRoot;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (root.and) {
                      setCombinator("and");
                      setClauses(root.and);
                    } else if (root.or) {
                      setCombinator("or");
                      setClauses(root.or);
                    }
                  }}
                  className="w-full text-left px-3 py-2 rounded-[10px] hover:bg-white/[0.03]"
                  style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="font-mohave text-[14px] text-[#EDEDED]">
                    {t.name}
                  </span>
                  <span
                    className="font-mono text-[11px] text-[#8A8A8A] ml-2"
                    style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                  >
                    [used {t.lastUsedCount}×]
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AudienceSaveTemplateModal
        open={saveOpen}
        filter={debouncedFilter}
        onClose={() => setSaveOpen(false)}
      />
    </section>
  );
}
