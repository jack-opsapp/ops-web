"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TemplatePreviewTab } from "@/components/admin/email/template-preview-tab";
import { TemplateVersionsTab } from "@/components/admin/email/template-versions-tab";
import { TemplateSendTestTab } from "@/components/admin/email/template-send-test-tab";

type SubTab = "preview" | "versions" | "send_test";

interface DetailResponse {
  ok: boolean;
  template?: {
    templateId: string;
    displayName: string;
    defaultSubject: string;
    previewProps: any;
    sourcePath: string;
  };
  versions?: any[];
  error?: string;
}

async function fetchDetail(templateId: string): Promise<DetailResponse | null> {
  const r = await fetch(`/api/admin/email/templates/${encodeURIComponent(templateId)}`, {
    cache: "no-store",
  });
  if (!r.ok && r.status !== 404) return null;
  return (await r.json()) as DetailResponse;
}

export default function TemplateDetailPage() {
  const params = useParams<{ templateId: string }>();
  const templateId = params.templateId;
  const [tab, setTab] = React.useState<SubTab>("preview");

  const { data, isLoading } = useQuery({
    queryKey: ["email-template-detail", templateId],
    queryFn: () => fetchDetail(templateId),
    enabled: !!templateId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-[#EDEDED] px-[44px] py-[36px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
          {"// SYS :: LOADING TEMPLATE"}
        </div>
      </div>
    );
  }

  if (!data?.ok || !data.template) {
    return (
      <div className="min-h-screen bg-black text-[#EDEDED] px-[44px] py-[36px]">
        <Link
          href="/admin/email/templates"
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
        >
          {"// / TEMPLATES"}
        </Link>
        <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#B58289]">
          {"// ERROR :: "}{data?.error ?? "template not found"}
        </div>
      </div>
    );
  }

  const tpl = data.template;

  return (
    <div className="min-h-screen bg-black text-[#EDEDED] px-[44px] py-[36px]">
      <Link
        href="/admin/email/templates"
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED] transition-colors"
        style={{ transitionDuration: "180ms" }}
      >
        {"// / TEMPLATES"}
      </Link>
      <h1 className="mt-2 font-cakemono font-light text-[28px] uppercase tracking-[0.04em] text-[#EDEDED]">
        {tpl.displayName}
      </h1>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8A8A]">
        [{tpl.templateId}] · {tpl.sourcePath}
      </div>

      <nav className="mt-6 flex gap-0 border-b border-white/[0.09]">
        {(["preview", "versions", "send_test"] as const).map((t) => {
          const active = tab === t;
          const label = t === "send_test" ? "SEND TEST" : t.toUpperCase();
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "relative px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                active ? "text-[#EDEDED]" : "text-[#8A8A8A] hover:text-[#B5B5B5]",
              ].join(" ")}
              style={{
                transitionDuration: "220ms",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {"// "}{label}
              {active && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[1px]"
                  style={{ background: "#6F94B0" }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <section className="mt-6">
        {tab === "preview" && (
          <TemplatePreviewTab templateId={tpl.templateId} initialProps={tpl.previewProps} />
        )}
        {tab === "versions" && <TemplateVersionsTab versions={data.versions ?? []} />}
        {tab === "send_test" && (
          <TemplateSendTestTab templateId={tpl.templateId} initialProps={tpl.previewProps} />
        )}
      </section>
    </div>
  );
}
