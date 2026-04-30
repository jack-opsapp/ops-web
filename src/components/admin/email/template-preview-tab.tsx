"use client";

import * as React from "react";

interface Props {
  templateId: string;
  initialProps: any;
}

export function TemplatePreviewTab({ templateId, initialProps }: Props) {
  const [propsText, setPropsText] = React.useState(JSON.stringify(initialProps, null, 2));
  const [html, setHtml] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [isRendering, setIsRendering] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(async () => {
      let parsed: any;
      try {
        parsed = JSON.parse(propsText);
      } catch (e: any) {
        setError(`Invalid JSON: ${e.message}`);
        return;
      }
      setError(null);
      setIsRendering(true);
      try {
        const r = await fetch(
          `/api/admin/email/templates/${encodeURIComponent(templateId)}/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ props: parsed }),
          }
        );
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j?.error ?? "Render failed");
          return;
        }
        const j = await r.json();
        setHtml(j.html ?? "");
      } finally {
        setIsRendering(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [propsText, templateId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A] mb-2">
          {"// PROPS / JSON"}
        </div>
        <textarea
          value={propsText}
          onChange={(e) => setPropsText(e.target.value)}
          rows={22}
          spellCheck={false}
          className="w-full bg-white/[0.04] border border-white/[0.10] px-3 py-2 font-mono text-[12px] text-[#EDEDED] focus:outline-none focus:border-ops-accent rounded-[5px]"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        />
        {error && (
          <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#B58289]">
            {"// ERROR :: "}{error}
          </div>
        )}
        {isRendering && !error && (
          <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8A8A]">
            {"// SYS :: RENDERING"}
          </div>
        )}
      </div>
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A] mb-2">
          {"// RENDERED PREVIEW"}
        </div>
        <iframe
          srcDoc={html}
          className="w-full border border-white/[0.10] rounded-[5px]"
          style={{ height: "640px", background: "#fff" }}
          title="Email preview"
          sandbox=""
        />
      </div>
    </div>
  );
}
