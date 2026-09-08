"use client";

import { useCallback, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Radar } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useCalibrationDeck } from "./_components/hooks/use-calibration-deck";
import { useCalibrationFirstRun } from "./_components/hooks/use-calibration-first-run";
import { CalibrationState } from "./_components/calibration-state";
import { CommandDeck } from "./_components/command-deck";
import { FirstRunWizard } from "./_components/first-run-wizard";
import { SectionInputs } from "./_components/section-inputs";
import { SectionCorpus } from "./_components/section-corpus";
import { SectionConfig } from "./_components/section-config";
import { SectionActivity } from "./_components/section-activity";
import { SectionMilestones } from "./_components/section-milestones";

/**
 * The calibration hooks throw an error carrying the HTTP status (see
 * calibration-request-error.ts). 403 is an access fact — no mailbox in scope,
 * or no email.configure_ai — and reads differently to the operator than a
 * failed read, so the page tells them apart here.
 */
function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

export default function CalibrationPage() {
  const { t } = useDictionary("calibration");
  const router = useRouter();
  const sp = useSearchParams();
  const section = sp.get("section");
  usePageTitle(t("page.title"));

  // `isPending` (no data yet) rather than `isLoading` (no data AND a fetch in
  // flight): while the auth store hydrates the query is merely disabled, and
  // that must read as loading — never as a blank page.
  const {
    data: deck,
    isPending: deckPending,
    isError: deckFailed,
    error: deckError,
    refetch: refetchDeck,
  } = useCalibrationDeck();
  const {
    data: firstRun,
    isPending: firstRunPending,
    isError: firstRunFailed,
    error: firstRunError,
    refetch: refetchFirstRun,
  } = useCalibrationFirstRun();

  const retry = useCallback(() => {
    void refetchDeck();
    void refetchFirstRun();
  }, [refetchDeck, refetchFirstRun]);

  // One heading for every branch — the operator always knows which page they
  // are on, including when the deck could not be read.
  const heading = (className: string) => (
    <div className={`flex items-center gap-2 ${className}`}>
      <Radar className="w-[18px] h-[18px] text-ops-accent" />
      <h1 className="font-cakemono font-light text-cake-display uppercase text-text">
        {t("page.title")}
      </h1>
    </div>
  );

  const frame = (children: ReactNode) => (
    <div className="px-11 py-9 max-w-[1320px] mx-auto">
      {heading("mb-6")}
      {children}
    </div>
  );

  // A failed read is neither loading nor loaded. It is checked first so a 403
  // or a 500 surfaces immediately instead of parking on the loading line.
  if (deckFailed || firstRunFailed) {
    const locked =
      statusOf(deckError) === 403 || statusOf(firstRunError) === 403;
    return frame(
      <CalibrationState
        variant={locked ? "locked" : "error"}
        onRetry={locked ? undefined : retry}
      />
    );
  }

  if (deckPending || firstRunPending) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          {t("state.loading.heading")}
        </span>
      </div>
    );
  }

  if (section === "inputs") return <SectionInputs />;
  if (section === "corpus") return <SectionCorpus />;
  if (section === "config") return <SectionConfig />;
  if (section === "activity") return <SectionActivity />;
  if (section === "milestones") return <SectionMilestones />;

  // First-run wizard wins if the user hasn't dismissed and has no data yet.
  if (firstRun?.shouldShowWizard) {
    return frame(<FirstRunWizard onDone={() => router.refresh()} />);
  }

  // A resolved query with no payload is not a real state to render; treat it
  // as the failure it is rather than showing an empty page.
  if (!deck) return frame(<CalibrationState variant="error" onRetry={retry} />);

  return (
    <>
      {heading("px-11 pt-9")}
      <p className="font-mono text-micro uppercase tracking-wider text-text-3 px-11 pb-2">
        <span className="text-text-mute">{"//"}</span> COMMAND
        <span className="text-text-mute mx-1">{"//"}</span> CALIBRATION
      </p>
      <CommandDeck deck={deck} />
    </>
  );
}
