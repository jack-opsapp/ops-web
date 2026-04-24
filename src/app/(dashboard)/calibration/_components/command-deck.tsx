"use client";

import { useRouter } from "next/navigation";
import { useDictionary } from "@/i18n/client";
import { DeckTile } from "./deck-tile";
import { TileInputsBody } from "./tile-inputs-body";
import { TileCorpusBody } from "./tile-corpus-body";
import { TileConfigBody } from "./tile-config-body";
import { TileActivityBody } from "./tile-activity-body";
import { TileMilestonesBody } from "./tile-milestones-body";
import { RecentRail } from "./recent-rail";
import type { DeckState } from "@/lib/types/calibration";
import type { RadarSweepState } from "./radar-sweep";

interface Props {
  deck: DeckState;
}

type Translator = (key: string) => string;

export function CommandDeck({ deck }: Props) {
  const { t } = useDictionary("calibration");
  const router = useRouter();
  const goTo = (section: string) =>
    router.push(`/calibration?section=${section}`);

  const inputsCompletedCount =
    (deck.inputs.interview.status === "complete" ? 1 : 0) +
    (deck.inputs.scan.status === "complete" ? 1 : 0) +
    (deck.inputs.mining.status === "complete" ? 1 : 0);

  const inputsRadar: RadarSweepState =
    deck.inputs.scan.status === "running"
      ? "running"
      : inputsCompletedCount > 0
        ? "nominal"
        : "empty";
  const corpusRadar: RadarSweepState =
    deck.corpus.factCount > 0 ? "nominal" : "empty";
  const configRadar: RadarSweepState =
    deck.config.rulesCount > 0 ? "nominal" : "empty";
  const activityRadar: RadarSweepState =
    deck.activity.status === "running"
      ? "running"
      : deck.activity.status === "error"
        ? "error"
        : "nominal";
  const milestonesRadar: RadarSweepState =
    deck.milestones.reachedCount > 0 ? "nominal" : "empty";

  return (
    <div className="calibration-deck">
      <DeckTile
        title={t("tiles.inputs.title")}
        indexInGrid={0}
        radarState={inputsRadar}
        onClick={() => goTo("inputs")}
        ariaLabel={`INPUTS. ${inputsCompletedCount} of 3 complete. Click to drill in.`}
        footer={renderInputsFooter(deck, t)}
        className="deck-tile--inputs"
      >
        <TileInputsBody inputs={deck.inputs} />
      </DeckTile>

      <DeckTile
        title={t("tiles.corpus.title")}
        indexInGrid={1}
        radarState={corpusRadar}
        onClick={() => goTo("corpus")}
        ariaLabel={`CORPUS. ${deck.corpus.factCount} facts, confidence ${deck.corpus.writingConfidence.toFixed(2)}. Click to drill in.`}
        footer={renderCorpusFooter(deck, t)}
        className="deck-tile--corpus"
      >
        <TileCorpusBody corpus={deck.corpus} />
      </DeckTile>

      <DeckTile
        title={t("tiles.config.title")}
        indexInGrid={2}
        radarState={configRadar}
        onClick={() => goTo("config")}
        ariaLabel={`CONFIG. ${deck.config.rulesCount} rules, ${deck.config.categoriesCount} categories. Click to drill in.`}
        footer={renderConfigFooter(deck, t)}
        className="deck-tile--config"
      >
        <TileConfigBody config={deck.config} />
      </DeckTile>

      <DeckTile
        title={t("tiles.activity.title")}
        indexInGrid={3}
        radarState={activityRadar}
        onClick={() => goTo("activity")}
        ariaLabel={`ACTIVITY. Status ${deck.activity.status}. ${deck.activity.completedTodayCount} events today. Click to drill in.`}
        footer={renderActivityFooter(deck, t)}
        className="deck-tile--activity"
      >
        <TileActivityBody activity={deck.activity} />
      </DeckTile>

      <DeckTile
        title={t("tiles.milestones.title")}
        indexInGrid={4}
        radarState={milestonesRadar}
        onClick={() => goTo("milestones")}
        ariaLabel={`MILESTONES. ${deck.milestones.reachedCount} of 9 reached. Click to drill in.`}
        footer={renderMilestonesFooter(deck, t)}
        className="deck-tile--milestones"
      >
        <TileMilestonesBody milestones={deck.milestones} />
      </DeckTile>

      <RecentRail />
    </div>
  );
}

function renderInputsFooter(deck: DeckState, t: Translator) {
  const count =
    (deck.inputs.interview.status === "complete" ? 1 : 0) +
    (deck.inputs.scan.status === "complete" ? 1 : 0) +
    (deck.inputs.mining.status === "complete" ? 1 : 0);
  if (count === 0) return <>{t("tiles.inputs.footerEmpty")}</>;
  const lastRun = deck.inputs.lastAnyRunAt
    ? formatTimeAgo(deck.inputs.lastAnyRunAt)
    : "—";
  return (
    <>
      {t("tiles.inputs.footer")
        .replace("{count}", String(count))
        .replace("{time}", lastRun)}
    </>
  );
}

function renderCorpusFooter(deck: DeckState, t: Translator) {
  if (deck.corpus.factCount === 0) return <>{t("tiles.corpus.footerEmpty")}</>;
  return (
    <>
      {t("tiles.corpus.footer")
        .replace("{today}", String(deck.corpus.todayFactCount))
        .replace("{conf}", deck.corpus.writingConfidence.toFixed(2))}
    </>
  );
}

function renderConfigFooter(deck: DeckState, t: Translator) {
  if (deck.config.rulesCount === 0 && deck.config.categoriesCount === 0)
    return <>{t("tiles.config.footerEmpty")}</>;
  return (
    <>
      {t("tiles.config.footer")
        .replace("{rules}", String(deck.config.rulesCount))
        .replace("{cats}", String(deck.config.categoriesCount))}
    </>
  );
}

function renderActivityFooter(deck: DeckState, t: Translator) {
  if (
    deck.activity.queuedCount === 0 &&
    deck.activity.completedTodayCount === 0
  )
    return <>{t("tiles.activity.footerEmpty")}</>;
  return (
    <>
      {t("tiles.activity.footer")
        .replace("{q}", String(deck.activity.queuedCount))
        .replace("{c}", String(deck.activity.completedTodayCount))}
    </>
  );
}

function renderMilestonesFooter(deck: DeckState, t: Translator) {
  if (deck.milestones.reachedCount === 0)
    return <>{t("tiles.milestones.footerEmpty")}</>;
  const next = deck.milestones.nextLadderName
    ? t(`sections.milestones.${deck.milestones.nextLadderName}`)
    : "—";
  return (
    <>
      {t("tiles.milestones.footer")
        .replace("{reached}", String(deck.milestones.reachedCount))
        .replace("{next}", next)}
    </>
  );
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins}M`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.floor(hours / 24);
  return `${days}D`;
}
