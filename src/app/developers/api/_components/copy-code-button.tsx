"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyCodeButtonProps {
  code: string;
  label: string;
  copyText: string;
  copiedText: string;
  failureText: string;
}

type CopyStatus = "idle" | "copied" | "failed";

export function CopyCodeButton({
  code,
  label,
  copyText,
  copiedText,
  failureText,
}: CopyCodeButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copyCode() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  const succeeded = status === "copied";

  return (
    <div className="flex items-center gap-1">
      <span
        aria-live="polite"
        className={
          status === "failed"
            ? "max-w-64 font-mono text-micro text-rose"
            : "font-mono text-micro text-text-3"
        }
      >
        {status === "copied"
          ? copiedText
          : status === "failed"
            ? failureText
            : ""}
      </span>
      <button
        type="button"
        onClick={() => void copyCode()}
        aria-label={label}
        className="inline-flex min-h-control-32 items-center gap-0.5 rounded border border-line bg-surface-input px-1 font-cakemono text-cake-badge uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        {succeeded ? (
          <Check aria-hidden className="h-icon-16 w-icon-16" />
        ) : (
          <Copy aria-hidden className="h-icon-16 w-icon-16" />
        )}
        {succeeded ? copiedText : copyText}
      </button>
    </div>
  );
}
