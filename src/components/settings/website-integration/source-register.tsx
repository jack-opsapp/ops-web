"use client";

import { Copy, Plus, Settings2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Surface } from "@/components/ui/surface";
import { Tag } from "@/components/ui/tag";
import type { WebsiteSource } from "../website-integration-tab";

interface SourceRegisterProps {
  sources: WebsiteSource[];
  onAdd: (trigger: HTMLButtonElement) => void;
  onEdit: (source: WebsiteSource, trigger: HTMLButtonElement) => void;
  onCopy: (value: string, label: string) => void | Promise<void>;
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="font-mono text-micro uppercase tracking-widest text-text-3">
        {label}
      </p>
      <p className="break-words font-mono text-data-sm tabular-nums text-text">
        {value ?? "—"}
      </p>
    </div>
  );
}

function CopyValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: SourceRegisterProps["onCopy"];
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="font-mono text-micro uppercase tracking-widest text-text-3">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-1">
        <code className="min-w-0 truncate font-mono text-data-sm text-text-2">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`COPY ${label}`}
          onClick={() => void onCopy(value, label)}
        >
          <Copy className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function SourceRegister({
  sources,
  onAdd,
  onEdit,
  onCopy,
}: SourceRegisterProps) {
  const { t } = useDictionary("settings");

  return (
    <section aria-labelledby="website-source-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="website-source-heading"
            className="font-mohave text-heading text-text"
          >
            {t("website.source.title", "WEBSITE SOURCE")}
          </h2>
          <p className="font-mohave text-body-sm text-text-2">
            {t(
              "website.source.detail",
              "Original inquiries enter OPS through this source."
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={(event) => onAdd(event.currentTarget)}
        >
          <Plus className="size-4" aria-hidden />
          {t("website.source.add", "ADD WEBSITE")}
        </Button>
      </div>

      <Surface className="space-y-2 p-2">
        {sources.map((source) => {
          const defaultForm =
            source.forms.find((form) => form.isDefault) ?? source.forms[0];
          const sourceActive = source.status === "active";

          return (
            <Card key={source.sourceId} variant="ghost" className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <h3 className="truncate font-mohave text-card-title text-text">
                      {source.siteLabel}
                    </h3>
                    <Tag variant={sourceActive ? "olive" : "dim"}>
                      {sourceActive
                        ? t("website.status.active", "ACTIVE")
                        : t("website.status.inactive", "INACTIVE")}
                    </Tag>
                  </div>
                  <p className="font-mono text-data-sm text-text-3">
                    {source.canonicalHost}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(event) => onEdit(source, event.currentTarget)}
                >
                  <Settings2 className="size-4" aria-hidden />
                  {t("website.manage", "MANAGE")}
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Metric
                  label={t("website.health.lastAccepted", "LAST ACCEPTED")}
                  value={displayDate(source.lastAcceptedAt)}
                />
                <Metric
                  label={t("website.health.pendingFiles", "PENDING FILES")}
                  value={source.pendingFileCount}
                />
                <Metric
                  label={t("website.health.rejectedFiles", "REJECTED FILES")}
                  value={source.rejectedFileCount}
                />
              </div>

              <div className="grid gap-2 border-t border-border-subtle pt-2 sm:grid-cols-2">
                <CopyValue
                  label={t("website.source.sourceId", "SOURCE ID")}
                  value={source.sourceId}
                  onCopy={onCopy}
                />
                {defaultForm ? (
                  <CopyValue
                    label={t("website.source.formId", "FORM ID")}
                    value={defaultForm.formId}
                    onCopy={onCopy}
                  />
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Metric
                  label={t("website.source.origin", "ALLOWED ORIGIN")}
                  value={source.allowedBrowserOrigins.join(", ") || "—"}
                />
                <Metric
                  label={t("website.source.phoneRegion", "PHONE REGION")}
                  value={source.defaultPhoneRegion}
                />
                <Metric
                  label={t("website.source.owner", "DEFAULT OWNER")}
                  value={source.defaultIntakeOwnerId ?? "—"}
                />
              </div>
            </Card>
          );
        })}
      </Surface>
    </section>
  );
}
