"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Radar, AlertCircle, ShieldOff, RefreshCw } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useCalibrationDeck } from "./_components/hooks/use-calibration-deck";
import { useCalibrationFirstRun } from "./_components/hooks/use-calibration-first-run";
import { CommandDeck } from "./_components/command-deck";
import { FirstRunWizard } from "./_components/first-run-wizard";
import { SectionInputs } from "./_components/section-inputs";
import { SectionCorpus } from "./_components/section-corpus";
import { SectionConfig } from "./_components/section-config";
import { SectionActivity } from "./_components/section-activity";
import { SectionMilestones } from "./_components/section-milestones";

export default function CalibrationPage() {
  const { t } = useDictionary("calibration");
  const router = useRouter();
  const sp = useSearchParams();
  const section = sp.get("section");
  usePageTitle(t("page.title"));

  const can = usePermissionStore((s) => s.can);
  const hasConfigureAi = can("email.configure_ai");

  const {
    data: deck,
    isLoading: deckLoading,
    error: deckError,
    refetch: refetchDeck,
    isRefetching: deckRefetching,
  } = useCalibrationDeck();
  const {
    data: firstRun,
    isLoading: firLoading,
    error: firError,
  } = useCalibrationFirstRun();

  // Permission check — dashboard layout also gates this route, but the
  // page itself must not blank-screen if the gate is bypassed via deep
  // link before the layout enforces it.
  if (!hasConfigureAi) {
    return (
      <div className="px-11 py-9 max-w-[840px] mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <ShieldOff className="w-[18px] h-[18px] text-[#B58289]" />
          <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
            ACCESS DENIED
          </h1>
        </div>
        <p className="font-mohave text-[14px] text-text-2 mb-2">
          Calibration is restricted to operators with AI configuration
          access.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
          [REQUIRED :: email.configure_ai]
        </p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 font-cakemono font-light text-[12px] uppercase tracking-[0.18em] text-ops-accent border border-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
          style={{ borderRadius: 5 }}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (deckLoading || firLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          SYS :: LOADING
        </span>
      </div>
    );
  }

  // Query failure — the deck or first-run hook errored. We surface the
  // failure with a retry instead of returning null (which previously
  // produced a blank page when the deck call 401'd or 500'd).
  if (deckError || firError) {
    const reason =
      (deckError instanceof Error ? deckError.message : null) ??
      (firError instanceof Error ? firError.message : null) ??
      "Unknown error";
    return (
      <div className="px-11 py-9 max-w-[840px] mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-[18px] h-[18px] text-[#B58289]" />
          <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
            DECK UNAVAILABLE
          </h1>
        </div>
        <p className="font-mohave text-[14px] text-text-2 mb-2">
          The calibration deck failed to load. The service may be
          unreachable or the session expired.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute mb-6">
          [{reason.slice(0, 160)}]
        </p>
        <button
          type="button"
          onClick={() => refetchDeck()}
          disabled={deckRefetching}
          className="inline-flex items-center gap-2 px-3 py-1.5 font-cakemono font-light text-[12px] uppercase tracking-[0.18em] text-ops-accent border border-ops-accent hover:bg-ops-accent hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: 5 }}
        >
          <RefreshCw size={12} className={deckRefetching ? "animate-spin" : ""} />
          {deckRefetching ? "Retrying..." : "Retry"}
        </button>
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
    return (
      <div className="px-11 py-9 max-w-[1320px] mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Radar className="w-[18px] h-[18px] text-ops-accent" />
          <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
            {t("page.title")}
          </h1>
        </div>
        <FirstRunWizard onDone={() => router.refresh()} />
      </div>
    );
  }

  // Deck loaded but missing — surface a recoverable empty state rather
  // than returning null (the prior behavior produced a blank screen).
  if (!deck) {
    return (
      <div className="px-11 py-9 max-w-[840px] mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-[18px] h-[18px] text-[#C4A868]" />
          <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
            DECK NOT FOUND
          </h1>
        </div>
        <p className="font-mohave text-[14px] text-text-2 mb-6">
          We could not assemble a calibration deck for this company. This
          is usually fixed by reloading; if it persists, contact support.
        </p>
        <button
          type="button"
          onClick={() => refetchDeck()}
          disabled={deckRefetching}
          className="inline-flex items-center gap-2 px-3 py-1.5 font-cakemono font-light text-[12px] uppercase tracking-[0.18em] text-ops-accent border border-ops-accent hover:bg-ops-accent hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: 5 }}
        >
          <RefreshCw size={12} className={deckRefetching ? "animate-spin" : ""} />
          {deckRefetching ? "Reloading..." : "Reload"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-11 pt-9">
        <Radar className="w-[18px] h-[18px] text-ops-accent" />
        <h1 className="font-cakemono font-light uppercase text-[22px] text-text">
          {t("page.title")}
        </h1>
      </div>
      <p className="font-mono text-micro uppercase tracking-wider text-text-3 px-11 pb-2">
        <span className="text-text-mute">{"//"}</span> COMMAND
        <span className="text-text-mute mx-1">{"//"}</span> CALIBRATION
      </p>
      <CommandDeck deck={deck} />
    </>
  );
}
