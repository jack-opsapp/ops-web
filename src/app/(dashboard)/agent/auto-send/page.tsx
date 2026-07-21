"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { EmailCategoryAutonomy } from "@/components/settings/email-category-autonomy";
import { useDictionary } from "@/i18n/client";
import { parsePhaseCGraduationActionScope } from "@/lib/email/phase-c-graduation-action";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";

type VerificationState =
  | "checking"
  | "ready"
  | "disabled"
  | "unavailable"
  | "error";

function StatusCard({
  title,
  body,
  retry,
}: {
  title: string;
  body: string;
  retry?: () => void;
}) {
  const { t } = useDictionary("autonomy");

  return (
    <div className="rounded-panel border border-border bg-surface-input p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tan" />
        <div>
          <h2 className="font-cakemono text-body-sm font-light uppercase tracking-wide text-text-2">
            {title}
          </h2>
          <p className="mt-1 font-mohave text-body-sm text-text-mute">
            [{body}]
          </p>
          {retry ? (
            <button
              type="button"
              onClick={retry}
              className="mt-4 min-h-11 rounded border border-border-medium px-4 font-mono text-micro uppercase tracking-wider text-text-2 transition-colors hover:border-ops-accent hover:text-text"
            >
              {t("approval.retry")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AutoSendApprovalContent() {
  const { t } = useDictionary("autonomy");
  const searchParams = useSearchParams();
  const { company, currentUser } = useAuthStore();
  const [verification, setVerification] =
    useState<VerificationState>("checking");
  const [attempt, setAttempt] = useState(0);

  usePageTitle(t("approval.pageTitle"));

  const scope = useMemo(
    () => parsePhaseCGraduationActionScope(searchParams),
    [searchParams]
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!scope) {
      setVerification("unavailable");
      return;
    }
    if (!company?.id || !currentUser?.id) return;

    let cancelled = false;
    setVerification("checking");

    void (async () => {
      try {
        const response = await authedFetch(
          `/api/integrations/email/auto-send/settings?companyId=${encodeURIComponent(company.id)}&connectionId=${encodeURIComponent(scope.connectionId)}`
        );
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          setVerification("unavailable");
          return;
        }
        if (!response.ok) {
          setVerification("error");
          return;
        }

        const settingsData = (await response.json()) as {
          featureEnabled?: boolean;
        };
        if (cancelled) return;
        setVerification(
          settingsData.featureEnabled === true ? "ready" : "disabled"
        );
      } catch {
        if (!cancelled) setVerification("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, company?.id, currentUser?.id, scope]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-9">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-ops-accent" />
          <h1 className="font-cakemono text-heading font-light uppercase tracking-wide text-text">
            {t("approval.pageTitle")}
          </h1>
        </div>
        <p className="mt-2 max-w-2xl font-mohave text-body-sm text-text-mute">
          [{t("approval.pageDescription")}]
        </p>
      </header>

      {verification === "checking" ? (
        <div className="flex items-center gap-2 rounded-panel border border-border bg-surface-input p-5">
          <Loader2 className="h-4 w-4 text-text-mute motion-safe:animate-spin" />
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            {t("approval.checking")}
          </span>
        </div>
      ) : null}

      {verification === "ready" && scope ? (
        <div className="rounded-panel border border-border bg-surface-input p-5">
          <EmailCategoryAutonomy
            connectionId={scope.connectionId}
            autoSendFeatureEnabled
            focusPrimaryCategory={scope.category}
            visiblePrimaryCategories={[scope.category]}
          />
        </div>
      ) : null}

      {verification === "disabled" ? (
        <StatusCard
          title={t("approval.disabledTitle")}
          body={t("approval.disabledBody")}
        />
      ) : null}

      {verification === "unavailable" ? (
        <StatusCard
          title={t("approval.unavailableTitle")}
          body={t("approval.unavailableBody")}
        />
      ) : null}

      {verification === "error" ? (
        <StatusCard
          title={t("approval.errorTitle")}
          body={t("approval.errorBody")}
          retry={retry}
        />
      ) : null}
    </main>
  );
}

export default function AutoSendApprovalPage() {
  return (
    <Suspense fallback={null}>
      <AutoSendApprovalContent />
    </Suspense>
  );
}
