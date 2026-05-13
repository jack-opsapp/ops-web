"use client";

import { AlertTriangle } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function ProjectsEmptyState({
  mode,
  onRetry,
}: {
  mode: "loading" | "empty" | "filtered" | "error";
  onRetry?: () => void;
}) {
  const { t } = useDictionary("projects");

  if (mode === "loading") {
    return <div className="p-6 font-mono text-micro uppercase tracking-wider text-text-3">{t("table.loading.refetching")}</div>;
  }

  if (mode === "error") {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <AlertTriangle className="h-5 w-5 text-text-3" />
        <div className="font-cakemono text-[18px] font-light uppercase text-text">{t("table.error.title")}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-[5px] border border-ops-accent px-3 py-1.5 font-cakemono text-sm font-light uppercase text-ops-accent hover:bg-ops-accent hover:text-black">
            {t("table.error.retry")}
          </button>
        )}
      </div>
    );
  }

  const title = mode === "filtered" ? t("table.empty.filteredTitle") : t("table.empty.allTitle");
  const body = mode === "filtered" ? t("table.empty.filteredBody") : t("table.empty.allBody");

  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-6">
      <div className="font-cakemono text-[18px] font-light uppercase text-text">{title}</div>
      <div className="font-mohave text-body-sm text-text-3">{body}</div>
    </div>
  );
}
