"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MailCheck,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/register-table";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import { useDictionary } from "@/i18n/client";
import {
  useEmailSignature,
  useImportProviderEmailSignature,
  useSaveEmailSignature,
} from "@/lib/hooks/use-email-signature";
import type { EmailSignatureSource } from "@/lib/types/email-signature";

interface EmailSignatureSettingsProps {
  companyId: string;
  userId: string;
  connectionId: string;
  mailbox: string;
  canManage?: boolean;
}

function signatureSourceLabel(
  source: EmailSignatureSource,
  t: (key: string, fallback?: string) => string
) {
  if (source === "ops") {
    return t("integrations.signature.source.ops", "OPS SIGNATURE");
  }
  if (source === "gmail") {
    return t("integrations.signature.source.gmail", "GMAIL SIGNATURE");
  }
  return t("integrations.signature.source.microsoft365", "OUTLOOK SIGNATURE");
}

export function EmailSignatureSettings({
  companyId,
  userId,
  connectionId,
  mailbox,
  canManage = true,
}: EmailSignatureSettingsProps) {
  const { t } = useDictionary("settings");
  const scope = { companyId, userId, connectionId };
  const signature = useEmailSignature(scope);
  const saveSignature = useSaveEmailSignature();
  const importProvider = useImportProviderEmailSignature();
  const [opsText, setOpsText] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (signature.data) {
      setOpsText(signature.data.ops?.text ?? "");
      if (signature.data.missing) setIsEditing(true);
    }
  }, [signature.data]);

  const savedOpsText = signature.data?.ops?.text ?? "";
  const canSave =
    canManage &&
    !saveSignature.isPending &&
    opsText !== savedOpsText &&
    (opsText.trim().length > 0 || savedOpsText.length > 0);

  const handleSave = async () => {
    try {
      const updated = await saveSignature.mutateAsync({ ...scope, opsText });
      setIsEditing(updated.missing);
      toast.success(t("integrations.signature.saved", "Signature saved"));
    } catch (error) {
      toast.error(
        t("integrations.signature.saveFailed", "Signature not saved"),
        {
          description: error instanceof Error ? error.message : String(error),
        }
      );
    }
  };

  const handleImport = async () => {
    try {
      const updated = await importProvider.mutateAsync(scope);
      setIsEditing(updated.missing);
      toast.success(
        t("integrations.signature.imported", "Gmail signature imported")
      );
    } catch (error) {
      toast.error(
        t("integrations.signature.importFailed", "Signature not imported"),
        {
          description: error instanceof Error ? error.message : String(error),
        }
      );
    }
  };

  const handleCancel = () => {
    setOpsText(savedOpsText);
    setIsEditing(false);
  };

  return (
    <Surface
      variant="inset"
      className="p-2"
      data-testid="email-signature-settings"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-mono text-micro uppercase tracking-wider text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("integrations.signature.title", "EMAIL SIGNATURE")}
          </h3>
          <p className="mt-1 truncate font-mono text-micro text-text-3">
            {mailbox}
          </p>
        </div>

        {signature.data?.missing ? (
          <Tag variant="tan">
            {t("integrations.signature.missing", "NO SIGNATURE")}
          </Tag>
        ) : signature.data?.effective ? (
          <Tag
            variant={
              signature.data.effective.source === "ops" ? "olive" : "neutral"
            }
          >
            {signatureSourceLabel(signature.data.effective.source, t)}
          </Tag>
        ) : null}
      </div>

      {signature.isLoading ? (
        <div className="mt-2 flex items-center gap-1 text-text-3" role="status">
          <Loader2
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="font-mohave text-body-sm">
            {t("integrations.loading", "Loading…")}
          </span>
        </div>
      ) : signature.isError ? (
        <div
          className="mt-2 flex items-start gap-2 border-t border-border pt-2"
          role="alert"
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-rose"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mohave text-body-sm text-rose">
              {t(
                "integrations.signature.loadFailed",
                "Signature status unavailable"
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1"
              onClick={() => signature.refetch()}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("integrations.signature.retry", "RETRY")}
            </Button>
          </div>
        </div>
      ) : signature.data ? (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {signature.data.effective ? (
            <div>
              <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                {t("integrations.signature.preview", "CURRENT SIGNATURE")}
              </p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
                {signature.data.effective.text}
              </pre>
            </div>
          ) : null}

          {!isEditing && !signature.data.missing ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setIsEditing(true)}
              disabled={!canManage}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t("integrations.signature.edit", "EDIT SIGNATURE")}
            </Button>
          ) : (
            <>
              <p className="font-mohave text-body-sm text-text-2">
                {signature.data.provider === "microsoft365"
                  ? t(
                      "integrations.signature.microsoft365Help",
                      "Outlook does not share signatures with OPS. Paste yours below."
                    )
                  : t(
                      "integrations.signature.gmailHelp",
                      "Import from Gmail or create one here. An OPS signature takes precedence."
                    )}
              </p>

              <Textarea
                label={t("integrations.signature.opsLabel", "OPS SIGNATURE")}
                value={opsText}
                onChange={(event) => setOpsText(event.target.value)}
                placeholder={t(
                  "integrations.signature.placeholder",
                  "Name\nCompany\nPhone"
                )}
                disabled={!canManage || saveSignature.isPending}
                rows={4}
              />

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  loading={saveSignature.isPending}
                  disabled={!canSave}
                >
                  <MailCheck className="h-4 w-4" aria-hidden="true" />
                  {t("integrations.signature.save", "SAVE SIGNATURE")}
                </Button>

                {signature.data.effective && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                    disabled={saveSignature.isPending}
                  >
                    {t("integrations.signature.cancel", "CANCEL")}
                  </Button>
                )}

                {signature.data.provider === "gmail" &&
                  signature.data.providerImportSupported && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleImport}
                      loading={importProvider.isPending}
                      disabled={!canManage}
                    >
                      {t(
                        "integrations.signature.importGmail",
                        "IMPORT FROM GMAIL"
                      )}
                    </Button>
                  )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </Surface>
  );
}
