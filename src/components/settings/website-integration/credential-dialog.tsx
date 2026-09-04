"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
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
import { Surface } from "@/components/ui/surface";
import { toast } from "@/components/ui/toast";
import type {
  CredentialSecret,
  WebsiteCredential,
  WebsiteCredentialClass,
  WebsiteCredentialScope,
  WebsiteSource,
} from "../website-integration-tab";

interface CredentialDialogProps {
  open: boolean;
  kind: WebsiteCredentialClass;
  credential: WebsiteCredential | null;
  returnFocusTo: HTMLButtonElement | null;
  sources: WebsiteSource[];
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  onCreate: (payload: {
    name: string;
    class: WebsiteCredentialClass;
    scopes: WebsiteCredentialScope[];
    sourceIds: string[];
    expiresAt: string | null;
  }) => Promise<CredentialSecret>;
  onUpdate: (
    credential: WebsiteCredential,
    payload: { name: string; expiresAt: string | null }
  ) => Promise<WebsiteCredential>;
}

function dateValue(timestamp: string | null): string {
  return timestamp ? timestamp.slice(0, 10) : "";
}

function expiryTimestamp(date: string): string | null {
  return date ? `${date}T23:59:59.999Z` : null;
}

export function CredentialDialog({
  open,
  kind,
  credential,
  returnFocusTo,
  sources,
  onOpenChange,
  onClosed,
  onCreate,
  onUpdate,
}: CredentialDialogProps) {
  const { t } = useDictionary("settings");
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [includeFinancial, setIncludeFinancial] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const defaultName =
    kind === "intake"
      ? t("website.key.defaultIntakeName", "Website intake")
      : t("website.key.defaultAnalyticsName", "Website analytics");
  const initialSourceId =
    credential?.sourceIds[0] ??
    sources.find((source) => source.status === "active")?.sourceId ??
    "";

  useEffect(() => {
    if (!open) return;
    setName(credential?.name ?? defaultName);
    setSourceId(initialSourceId);
    setExpiresOn(dateValue(credential?.expiresAt ?? null));
    setIncludeFinancial(
      credential?.scopes.includes("analytics.financial.read") ?? false
    );
  }, [credential, defaultName, initialSourceId, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const expiresAt = expiryTimestamp(expiresOn);
      if (credential) {
        await onUpdate(credential, { name: name.trim(), expiresAt });
      } else {
        const scopes: WebsiteCredentialScope[] =
          kind === "intake"
            ? ["intake.write"]
            : [
                "analytics.leads.read",
                ...(includeFinancial
                  ? (["analytics.financial.read"] as const)
                  : []),
              ];
        await onCreate({
          name: name.trim(),
          class: kind,
          scopes,
          sourceIds: kind === "intake" ? [sourceId] : [],
          expiresAt,
        });
      }
      onOpenChange(false);
    } catch {
      toast.error(
        credential
          ? t("website.toast.keySaveFailed", "ACCESS KEY UPDATE FAILED")
          : t("website.toast.keyCreateFailed", "ACCESS KEY CREATION FAILED")
      );
    } finally {
      setSubmitting(false);
    }
  }

  const title = credential
    ? t("website.key.manageTitle", "MANAGE ACCESS KEY")
    : kind === "intake"
      ? t("website.key.createIntake", "CREATE INTAKE KEY")
      : t("website.key.createAnalytics", "CREATE ANALYTICS KEY");

  const submitLabel = credential
    ? t("website.key.save", "SAVE ACCESS KEY")
    : kind === "intake"
      ? t("website.key.issueIntake", "ISSUE INTAKE KEY")
      : t("website.key.issueAnalytics", "ISSUE ANALYTICS KEY");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusTo) {
            event.preventDefault();
            returnFocusTo.focus();
          }
          onClosed();
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-cakemono font-light uppercase">
              {title}
            </DialogTitle>
            <DialogDescription>
              {kind === "intake"
                ? t(
                    "website.key.intakeDetail",
                    "Allows one trusted website source to submit new inquiries and request file uploads."
                  )
                : t(
                    "website.key.analyticsDetail",
                    "Allows a server-rendered website dashboard to read approved analytics."
                  )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {!credential && kind === "analytics" ? (
              <Surface variant="inset" className="flex items-start gap-2 p-2">
                <AlertTriangle
                  className="size-4 shrink-0 text-tan"
                  aria-hidden
                />
                <p className="font-mohave text-body-sm text-text-2">
                  {t(
                    "website.key.analyticsWarning",
                    "This key can read pseudonymous lead data for the entire company."
                  )}
                </p>
              </Surface>
            ) : null}

            <Input
              label={t("website.key.name", "KEY NAME")}
              labelClassName="font-cakemono font-light"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
              autoComplete="off"
            />

            {!credential && kind === "intake" ? (
              <div className="space-y-1">
                <label
                  htmlFor="website-key-source"
                  className="font-cakemono text-caption-sm font-light uppercase tracking-wide text-text-3"
                >
                  {t("website.key.source", "WEBSITE SOURCE")}
                </label>
                <Select value={sourceId} onValueChange={setSourceId} required>
                  <SelectTrigger id="website-key-source">
                    <SelectValue
                      placeholder={t(
                        "website.key.selectSource",
                        "Select website"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.sourceId} value={source.sourceId}>
                        {source.siteLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <Input
              type="date"
              label={t("website.key.expiry", "EXPIRY DATE")}
              labelClassName="font-cakemono font-light"
              value={expiresOn}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setExpiresOn(event.target.value)}
              helperText={t(
                "website.key.expiryHelp",
                "Leave blank for no automatic expiry."
              )}
            />

            {!credential && kind === "analytics" ? (
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 font-cakemono text-body-sm font-light uppercase text-text">
                  <Checkbox
                    checked={includeFinancial}
                    onClick={() => setIncludeFinancial((current) => !current)}
                    aria-label={t(
                      "website.key.includeFinancial",
                      "INCLUDE MONETARY DATA"
                    )}
                  />
                  {t("website.key.includeFinancial", "INCLUDE MONETARY DATA")}
                </label>
                {includeFinancial ? (
                  <Surface
                    variant="inset"
                    className="flex items-start gap-2 p-2"
                  >
                    <AlertTriangle
                      className="size-4 shrink-0 text-tan"
                      aria-hidden
                    />
                    <p className="font-mohave text-body-sm text-text-2">
                      {t(
                        "website.key.financialWarning",
                        "Revenue, estimate, invoice, and payment metrics will be available to this key."
                      )}
                    </p>
                  </Surface>
                ) : null}
              </div>
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
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={kind === "intake" && !credential && !sourceId}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
