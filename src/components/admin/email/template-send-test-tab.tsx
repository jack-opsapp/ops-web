"use client";

import * as React from "react";

interface Props {
  templateId: string;
  initialProps: any;
}

type SendStatus = "idle" | "sending" | "success" | "error";

export function TemplateSendTestTab({ templateId, initialProps }: Props) {
  const [recipient, setRecipient] = React.useState("");
  const [propsText, setPropsText] = React.useState(JSON.stringify(initialProps, null, 2));
  const [status, setStatus] = React.useState<SendStatus>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const submit = async () => {
    setStatus("sending");
    setErrorMessage(null);
    let props: any;
    try {
      props = JSON.parse(propsText);
    } catch (e: any) {
      setStatus("error");
      setErrorMessage(`Invalid JSON: ${e.message}`);
      return;
    }
    try {
      const r = await fetch(
        `/api/admin/email/templates/${encodeURIComponent(templateId)}/send-test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient, props }),
        }
      );
      if (r.ok) {
        setStatus("success");
      } else {
        const j = await r.json().catch(() => ({}));
        setStatus("error");
        setErrorMessage(j?.error ?? "Send failed");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message ?? "Network error");
    }
  };

  const recipientValid = recipient.includes("@");

  return (
    <div className="space-y-5 max-w-[640px]">
      <div>
        <label className="block font-cakemono font-light text-[11px] uppercase tracking-[0.16em] text-[#B5B5B5]">
          Recipient
        </label>
        <input
          type="email"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="qa@opsapp.co"
          className="mt-2 w-full bg-white/[0.04] border border-white/[0.10] px-3 py-2 font-mohave text-[14px] text-[#EDEDED] focus:outline-none focus:border-ops-accent rounded-[5px]"
        />
      </div>

      <div>
        <label className="block font-cakemono font-light text-[11px] uppercase tracking-[0.16em] text-[#B5B5B5]">
          Props / JSON
        </label>
        <textarea
          value={propsText}
          onChange={(e) => setPropsText(e.target.value)}
          rows={14}
          spellCheck={false}
          className="mt-2 w-full bg-white/[0.04] border border-white/[0.10] px-3 py-2 font-mono text-[12px] text-[#EDEDED] focus:outline-none focus:border-ops-accent rounded-[5px]"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        />
      </div>

      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6A6A6A]">
        [test sends bypass suppression and tag email_log.metadata.is_test=true]
      </div>

      <button
        onClick={submit}
        disabled={status === "sending" || !recipientValid}
        className="px-5 py-2 border border-ops-accent text-ops-accent font-cakemono font-light text-[12px] uppercase tracking-[0.18em] hover:bg-ops-accent hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-[5px]"
        style={{
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {status === "sending" ? "Sending…" : "Send test"}
      </button>

      {status === "success" && (
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#9DB582]">
          {"// SENT — check the inbox"}
        </div>
      )}
      {status === "error" && errorMessage && (
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#B58289]">
          {"// ERROR :: "}{errorMessage}
        </div>
      )}
    </div>
  );
}
