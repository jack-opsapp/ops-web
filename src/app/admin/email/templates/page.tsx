"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

interface TemplateListItem {
  templateId: string;
  displayName: string;
  currentVersion: string | null;
  versionsCount: number;
}

async function fetchTemplates(): Promise<TemplateListItem[]> {
  const r = await fetch("/api/admin/email/templates", { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.templates ?? []) as TemplateListItem[];
}

export default function TemplatesListPage() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["email-templates-list"],
    queryFn: fetchTemplates,
  });

  return (
    <div className="min-h-screen bg-black text-[#EDEDED] px-[44px] py-[36px]">
      <header className="mb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8A8A8A]">
          // OPS LTD. / EMAIL / TEMPLATES
        </div>
        <h1 className="mt-2 font-cakemono font-light text-[28px] uppercase tracking-[0.04em] text-[#EDEDED]">
          Templates
        </h1>
        <p className="mt-2 font-mohave text-[14px] text-[#B5B5B5]">
          {isLoading ? "Loading registry…" : `${templates.length} typed templates. Each version is hash-verified at build time.`}
        </p>
      </header>

      <div className="rounded-panel border border-white/[0.09] overflow-hidden">
        {templates.length === 0 && !isLoading && (
          <div className="px-5 py-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
            // NO TEMPLATES REGISTERED
          </div>
        )}
        {templates.map((t) => (
          <Link
            key={t.templateId}
            href={`/admin/email/templates/${t.templateId}`}
            className="block px-5 py-4 border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.02] transition-colors"
            style={{ transitionDuration: "180ms", transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-cakemono font-light text-[16px] uppercase tracking-[0.04em] text-[#EDEDED] truncate">
                  {t.displayName}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8A8A]">
                  [{t.templateId}]
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-[14px] text-[#B5B5B5]" style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}>
                  v{t.currentVersion ?? "—"}
                </div>
                <div className="mt-1 font-mono text-[11px] text-[#6A6A6A]">
                  {t.versionsCount} version{t.versionsCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
