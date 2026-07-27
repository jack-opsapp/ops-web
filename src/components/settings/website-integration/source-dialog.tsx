"use client";

import { FormEvent, useEffect, useState } from "react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { WebsiteSource } from "../website-integration-tab";

interface SourceFields {
  siteLabel: string;
  canonicalHost: string;
  defaultPhoneRegion: string;
  allowedBrowserOrigins: string;
  active: boolean;
}

interface SourcePayload {
  siteLabel: string;
  canonicalHost: string;
  defaultPhoneRegion: string;
  allowedBrowserOrigins: string[];
  defaultCoarseSource: "website";
  defaultIntakeOwnerId: null;
  forms: [];
}

interface UpdateSourcePayload extends Omit<
  SourcePayload,
  "defaultIntakeOwnerId" | "forms"
> {
  defaultIntakeOwnerId: string | null;
  active: boolean;
  forms: null;
}

interface SourceDialogProps {
  open: boolean;
  source: WebsiteSource | null;
  returnFocusTo: HTMLButtonElement | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: SourcePayload) => Promise<WebsiteSource>;
  onUpdate: (
    source: WebsiteSource,
    payload: UpdateSourcePayload
  ) => Promise<WebsiteSource>;
}

const EMPTY_FIELDS: SourceFields = {
  siteLabel: "",
  canonicalHost: "",
  defaultPhoneRegion: "CA",
  allowedBrowserOrigins: "",
  active: true,
};

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

function parseOrigins(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function SourceDialog({
  open,
  source,
  returnFocusTo,
  onOpenChange,
  onCreate,
  onUpdate,
}: SourceDialogProps) {
  const { t } = useDictionary("settings");
  const [fields, setFields] = useState<SourceFields>(EMPTY_FIELDS);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields(
      source
        ? {
            siteLabel: source.siteLabel,
            canonicalHost: source.canonicalHost,
            defaultPhoneRegion: source.defaultPhoneRegion,
            allowedBrowserOrigins: source.allowedBrowserOrigins.join("\n"),
            active: source.status === "active",
          }
        : EMPTY_FIELDS
    );
  }, [open, source]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const common = {
        siteLabel: fields.siteLabel.trim(),
        canonicalHost: normalizeHost(fields.canonicalHost),
        defaultPhoneRegion: fields.defaultPhoneRegion,
        allowedBrowserOrigins: parseOrigins(fields.allowedBrowserOrigins),
        defaultCoarseSource: "website" as const,
      };
      if (source) {
        await onUpdate(source, {
          ...common,
          defaultIntakeOwnerId: source.defaultIntakeOwnerId,
          active: fields.active,
          forms: null,
        });
      } else {
        await onCreate({
          ...common,
          defaultIntakeOwnerId: null,
          forms: [],
        });
      }
      onOpenChange(false);
    } catch {
      toast.error(
        t("website.toast.sourceSaveFailed", "WEBSITE CONNECTION FAILED")
      );
    } finally {
      setSubmitting(false);
    }
  }

  const title = source
    ? t("website.source.manageTitle", "MANAGE WEBSITE")
    : t("website.source.connectTitle", "CONNECT WEBSITE");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo) return;
          event.preventDefault();
          returnFocusTo.focus();
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {t(
                "website.source.dialogDetail",
                "Set the trusted website address for original inquiry submissions."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input
              label={t("website.source.siteLabel", "SITE LABEL")}
              value={fields.siteLabel}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  siteLabel: event.target.value,
                }))
              }
              placeholder={t(
                "website.source.siteLabelPlaceholder",
                "Main website"
              )}
              autoComplete="off"
              required
              autoFocus
            />
            <Input
              label={t("website.source.host", "WEBSITE HOST")}
              value={fields.canonicalHost}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  canonicalHost: event.target.value,
                }))
              }
              placeholder="example.com"
              autoCapitalize="none"
              autoComplete="url"
              required
            />
            <Textarea
              label={t("website.source.origins", "ALLOWED BROWSER ORIGINS")}
              value={fields.allowedBrowserOrigins}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  allowedBrowserOrigins: event.target.value,
                }))
              }
              placeholder="https://example.com"
              helperText={t(
                "website.source.originsHelp",
                "One HTTPS origin per line."
              )}
              autoCapitalize="none"
              autoComplete="url"
              required
            />
            <div className="space-y-1">
              <label
                htmlFor="website-phone-region"
                className="font-mohave text-caption-sm uppercase tracking-wide text-text-3"
              >
                {t("website.source.phoneRegion", "PHONE REGION")}
              </label>
              <Select
                value={fields.defaultPhoneRegion}
                onValueChange={(value) =>
                  setFields((current) => ({
                    ...current,
                    defaultPhoneRegion: value,
                  }))
                }
              >
                <SelectTrigger id="website-phone-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CA">
                    {t("website.source.regionCA", "Canada")}
                  </SelectItem>
                  <SelectItem value="US">
                    {t("website.source.regionUS", "United States")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {source ? (
              <label className="flex cursor-pointer items-center gap-2 font-mohave text-body-sm text-text">
                <Checkbox
                  checked={fields.active}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({
                      ...current,
                      active: checked === true,
                    }))
                  }
                  aria-label={t(
                    "website.source.acceptSubmissions",
                    "ACCEPT NEW SUBMISSIONS"
                  )}
                />
                {t(
                  "website.source.acceptSubmissions",
                  "ACCEPT NEW SUBMISSIONS"
                )}
              </label>
            ) : null}
          </div>

          <DialogFooter className="mt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("website.cancel", "CANCEL")}
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {source
                ? t("website.source.save", "SAVE WEBSITE")
                : t("website.connect", "CONNECT WEBSITE")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
