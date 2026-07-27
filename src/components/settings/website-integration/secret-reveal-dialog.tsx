"use client";

import { AlertTriangle, Copy } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import type { CredentialSecret } from "../website-integration-tab";

interface SecretRevealDialogProps {
  secret: CredentialSecret | null;
  returnFocusTo: HTMLButtonElement | null;
  onCopy: (secret: string) => void | Promise<void>;
  onDismiss: () => void;
}

export function SecretRevealDialog({
  secret,
  returnFocusTo,
  onCopy,
  onDismiss,
}: SecretRevealDialogProps) {
  const { t } = useDictionary("settings");

  return (
    <Dialog
      open={Boolean(secret)}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        hideClose
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo) return;
          event.preventDefault();
          returnFocusTo.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t("website.secret.title", "COPY ACCESS KEY")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "website.secret.detail",
              "Store this key in your website server. OPS will not show it again."
            )}
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-2">
            <Surface variant="inset" className="flex items-start gap-2 p-2">
              <AlertTriangle className="size-4 shrink-0 text-tan" aria-hidden />
              <p className="font-mohave text-body-sm text-text-2">
                {t(
                  "website.secret.warning",
                  "Do not place this key in browser code or a public repository."
                )}
              </p>
            </Surface>
            <Input
              value={secret.secret}
              readOnly
              spellCheck={false}
              autoComplete="off"
              aria-label={t("website.secret.keyLabel", "ACCESS KEY")}
              className="select-all font-mono text-data-sm"
            />
          </div>
        ) : null}

        <DialogFooter className="mt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              if (!secret) return;
              await onCopy(secret.secret);
            }}
          >
            <Copy className="size-4" aria-hidden />
            {t("website.secret.copy", "COPY KEY")}
          </Button>
          <Button type="button" variant="primary" onClick={onDismiss}>
            {t("website.secret.done", "DONE")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
