"use client";

import { AlertTriangle } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";

/**
 * The two terminal states of the CALIBRATION deck.
 *
 * `locked` is the honest reading of a 403 from any calibration route: the
 * operator either lacks email.configure_ai or has no mailbox in scope. That is
 * an access fact, not a fault, so there is nothing to retry — the state names
 * what is missing and who can grant it.
 *
 * `error` is everything else, and carries the only action that can help. The
 * deck stops polling once a read fails (see use-calibration-deck), so this
 * button is the recovery path, not a decoration.
 */
export function CalibrationState({
  variant,
  onRetry,
}: {
  variant: "locked" | "error";
  onRetry?: () => void;
}) {
  const { t } = useDictionary("calibration");
  const prefix = variant === "locked" ? "state.forbidden" : "state.error";

  return (
    <div className="glass-surface rounded-panel flex flex-col items-start gap-1.5 p-3">
      <AlertTriangle
        className="h-icon-20 w-icon-20 text-text-3"
        aria-hidden="true"
      />
      <h2 className="font-cakemono text-cake-section font-light uppercase text-text">
        {t(`${prefix}.heading`)}
      </h2>
      <p className="max-w-2xl font-mohave text-body-sm text-text-2">
        {t(`${prefix}.body`)}
      </p>
      {onRetry ? (
        <Button
          variant="primary"
          size="sm"
          onClick={onRetry}
          className="mt-0.5"
        >
          {t("state.error.retry")}
        </Button>
      ) : null}
    </div>
  );
}
