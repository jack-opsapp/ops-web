"use client";

import { useEffect } from "react";
import { OpsLockup } from "@/components/brand";
import { useDictionary } from "@/i18n/client";

/**
 * Error boundary for the hosted customer surface. Sits above the branded
 * layout (which may itself be what failed), so it renders on OPS tokens only.
 * Copy loads through the client dictionary with English fallbacks so the page
 * never shows raw keys.
 */
export default function HostedCustomerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useDictionary("customer");

  useEffect(() => {
    console.error("[customer-identity] hosted page failed", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-text flex flex-col">
      <div className="flex-1 flex flex-col px-3 pt-5 sm:px-5 sm:pt-8">
        <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest text-text leading-none">
              {t("error.title", "PAGE FAILED TO LOAD")}
            </h1>
            <p className="font-mohave text-body text-text-2">
              {t(
                "error.body",
                "Refresh to try again. If it keeps happening, contact the business that sent this link."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="h-control-36 self-start rounded px-2 border border-border bg-transparent text-text-2 hover:text-text hover:border-border-medium transition-colors font-cakemono font-light text-cake-button uppercase tracking-widest"
          >
            {t("error.retry", "REFRESH")}
          </button>
        </div>
      </div>
      <footer className="px-3 pb-3 sm:px-5 sm:pb-5">
        <div className="w-full max-w-sm mx-auto">
          <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-widest text-text-2">
            {t("brand.poweredBy", "powered by")}
            <OpsLockup orientation="horizontal" title={t("brand.ops", "OPS")} className="h-icon-24 w-auto" />
          </span>
        </div>
      </footer>
    </div>
  );
}
