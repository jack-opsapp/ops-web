"use client";

import * as React from "react";
import type { TemplateVersionRow } from "@/lib/admin/email-template-queries";

interface Props {
  versions: TemplateVersionRow[];
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TemplateVersionsTab({ versions }: Props) {
  const [openId, setOpenId] = React.useState<string | null>(versions[0]?.id ?? null);

  if (versions.length === 0) {
    return (
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        // NO VERSIONS RECORDED
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => {
        const open = openId === v.id;
        return (
          <div
            key={v.id}
            className="border border-white/[0.09] rounded-panel overflow-hidden"
          >
            <button
              onClick={() => setOpenId(open ? null : v.id)}
              className="w-full text-left px-5 py-4 hover:bg-white/[0.02] flex items-center justify-between transition-colors"
              style={{
                transitionDuration: "180ms",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div className="min-w-0">
                <div className="font-cakemono font-light text-[16px] uppercase tracking-[0.04em] text-[#EDEDED]">
                  v{v.version}
                </div>
                <div
                  className="mt-1 font-mono text-[11px] text-[#8A8A8A]"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {formatTimestamp(v.created_at)} · sha256 {v.content_hash.slice(0, 12)}…
                </div>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#B5B5B5]">
                {open ? "[hide]" : "[view]"}
              </div>
            </button>
            {open && (
              <div className="border-t border-white/[0.06] p-4">
                {v.rendered_sample_html ? (
                  <iframe
                    srcDoc={v.rendered_sample_html}
                    className="w-full rounded-[5px]"
                    style={{ height: "560px", background: "#fff" }}
                    title={`v${v.version} preview`}
                    sandbox=""
                  />
                ) : (
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
                    // NO RENDERED SAMPLE STORED FOR THIS VERSION
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
