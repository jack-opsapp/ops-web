"use client";

/**
 * A Google-style responsive search ad preview: three headlines, two
 * descriptions, the display path. Pinned headlines are marked with their
 * position in tactical brackets, so Jackson sees what the engine locked.
 */
import { cn } from "@/lib/utils/cn";

export interface RsaPreviewProps {
  headlines: Array<{ text: string; pinnedField?: string }>;
  descriptions: Array<{ text: string }>;
  path1?: string | null;
  path2?: string | null;
  finalUrl: string;
  className?: string;
}

function displayUrl(finalUrl: string, path1?: string | null, path2?: string | null): string {
  let host = finalUrl;
  try {
    host = new URL(finalUrl).host;
  } catch {
    // Keep the raw value when the URL does not parse.
  }
  return [host, path1, path2].filter((part): part is string => !!part).join(" › ");
}

export function RsaPreview({ headlines, descriptions, path1, path2, finalUrl, className }: RsaPreviewProps) {
  const pinned = headlines.filter((h) => h.pinnedField === "HEADLINE_1");
  const rest = headlines.filter((h) => h.pinnedField !== "HEADLINE_1");
  const shown = [...pinned, ...rest].slice(0, 3);
  return (
    <div className={cn("rounded-chip border border-line bg-surface-input px-2 py-1.5", className)} data-testid="rsa-preview">
      <p className="font-mono text-micro text-text-3">{displayUrl(finalUrl, path1, path2)}</p>
      <p className="mt-0.5 font-mohave text-body text-text">
        {shown.map((headline, index) => (
          <span key={`${headline.text}-${index}`}>
            {index > 0 && <span className="text-text-mute"> | </span>}
            {headline.text}
            {headline.pinnedField === "HEADLINE_1" && (
              <span className="ml-0.5 font-mono text-micro text-text-3" aria-label="pinned to position one">
                [1]
              </span>
            )}
          </span>
        ))}
      </p>
      <p className="mt-0.5 font-mohave text-body-sm text-text-2">{descriptions.slice(0, 2).map((d) => d.text).join(" ")}</p>
      {headlines.length > 3 && (
        <ul className="mt-1 flex flex-wrap gap-0.5" aria-label="remaining headlines">
          {[...pinned, ...rest].slice(3).map((headline, index) => (
            <li key={`${headline.text}-${index}`} className="rounded-chip border border-border px-0.5 font-mono text-micro text-text-3">
              {headline.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
