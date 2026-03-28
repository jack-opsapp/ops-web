"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCw, LayoutDashboard, ChevronDown } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("[OPS Dashboard] Route error:", error);
  }, [error]);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-3 py-6"
      role="alert"
    >
      <div className="flex flex-col items-center max-w-[440px] w-full">
        {/* Icon */}
        <div className="w-[56px] h-[56px] rounded-xl bg-ops-error-muted border border-ops-error/20 flex items-center justify-center mb-3">
          <AlertCircle className="w-[28px] h-[28px] text-ops-error" />
        </div>

        {/* Title */}
        <h2 className="font-mohave text-display text-text-primary uppercase tracking-wider text-center">
          Something broke
        </h2>

        {/* Subtitle */}
        <p className="font-mohave text-body-sm text-text-tertiary text-center mt-1 max-w-[360px]">
          An unexpected error occurred. You can retry or head back to the dashboard.
        </p>

        {/* Error detail card */}
        <div className="w-full mt-3 ultrathin-material-dark rounded-lg overflow-hidden">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-[rgba(255,255,255,0.03)] transition-colors"
          >
            <span className="font-kosugi text-caption-sm text-text-disabled uppercase tracking-widest">
              Error Details
            </span>
            <ChevronDown
              className={cn(
                "w-[14px] h-[14px] text-text-disabled transition-transform duration-200",
                showDetails && "rotate-180"
              )}
            />
          </button>

          {showDetails && (
            <div className="px-2 pb-2 border-t border-border-subtle animate-fade-in">
              <p className="font-mono text-data-sm text-text-tertiary mt-1.5 break-all leading-relaxed">
                {error.message}
              </p>
              {error.digest && (
                <p className="font-mono text-[10px] text-text-disabled mt-1">
                  DIGEST: {error.digest}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 mt-3 w-full">
          <Button
            variant="primary"
            size="sm"
            onClick={reset}
            className="flex-1 gap-1"
          >
            <RefreshCw className="w-[14px] h-[14px]" />
            Retry
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => router.push("/dashboard")}
            className="flex-1 gap-1"
          >
            <LayoutDashboard className="w-[14px] h-[14px]" />
            Dashboard
          </Button>
        </div>

        {/* Branding */}
        <div className="mt-5 flex items-center gap-1 opacity-30">
          <Image
            src="/images/ops-logo-white.png"
            alt="OPS"
            width={24}
            height={9}
            className="select-none"
          />
          <span className="font-mono text-[10px] text-text-disabled select-none">
            ERROR BOUNDARY
          </span>
        </div>
      </div>
    </div>
  );
}
