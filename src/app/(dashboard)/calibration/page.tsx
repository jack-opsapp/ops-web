"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Radar } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
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

  const { data: deck, isLoading: deckLoading } = useCalibrationDeck();
  const { data: firstRun, isLoading: firLoading } = useCalibrationFirstRun();

  if (deckLoading || firLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
          SYS :: LOADING
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

  if (!deck) return null;

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
