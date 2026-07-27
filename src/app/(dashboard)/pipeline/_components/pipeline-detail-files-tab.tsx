"use client";

import { Download, FileText, Image as ImageIcon } from "lucide-react";

import { getDateLocale } from "@/i18n/date-utils";
import { useDictionary, useLocale } from "@/i18n/client";
import type { OpportunityAssignedContextIntakeAttachment } from "@/lib/api/services/opportunity-assigned-context-service";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PipelineDetailFilesTab({
  attachments,
}: {
  attachments: OpportunityAssignedContextIntakeAttachment[];
}) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();

  return (
    <div className="divide-y divide-border-subtle rounded-panel border border-border-subtle">
      {attachments.map((attachment) => {
        const Icon = attachment.kind === "image" ? ImageIcon : FileText;
        const occurredAt = attachment.occurredAt.toLocaleDateString(
          getDateLocale(locale),
          { month: "short", day: "numeric", year: "numeric" }
        );
        return (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            aria-label={t("detail.fileDownload", "Download {name}").replace(
              "{name}",
              attachment.filename
            )}
            className="group flex min-h-11 items-center gap-2 px-3 py-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ops-accent motion-reduce:transition-none"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border-subtle bg-fill-neutral-dim text-text-2">
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mohave text-body text-text">
                {attachment.filename}
              </span>
              <span className="tracking-label block truncate font-mono text-micro uppercase text-text-mute">
                {t("detail.fileWebsiteSource", "Website")} · {occurredAt} ·{" "}
                {formatBytes(attachment.sizeBytes)}
              </span>
            </span>
            <Download
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-text-mute transition-colors duration-150 ease-smooth group-hover:text-text-2 motion-reduce:transition-none"
              strokeWidth={1.75}
            />
          </a>
        );
      })}
    </div>
  );
}
