"use client";

import { useDictionary } from "@/i18n/client";

export interface WeeklySignal {
  id: string;
  sphere: string;
  source: string;
  kind: "video" | "article" | "thread";
  title: string;
  url: string;
  views: number | null;
  typical_views: number | null;
  momentum: number | null;
  replies: number | null;
}

export interface WeeklyPitch {
  topic: string;
  reader: string;
  why_now: string;
  ethos: string;
  angle: string;
  hook: string;
  headline: string;
  signals: WeeklySignal[];
  chatter: Array<{ url: string; shows: string }>;
  hooks_considered: Array<{ headline: string; hook: string; verdict: string }>;
  runners_up: Array<{ topic: string; why_not: string }>;
}

// Same measures as the weekly panel: DESIGN.md spacing written in px, labels
// in JetBrains Mono (tabular, slashed zero), prose in Mohave, links in the
// secondary tone and never the accent.
const MONO_LABEL = "font-mono text-micro uppercase tracking-authority text-text-tertiary";
const META = "font-mono text-micro uppercase tracking-[0.12em] text-text-tertiary";
const LINK = "font-mohave text-body text-text-secondary underline hover:text-text";

const count = new Intl.NumberFormat("en-US");
const multiple = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * The one number that says why a signal counted: a video against its
 * channel's typical video, a thread by its replies, writing by nothing but
 * where it ran.
 */
export function signalMetric(signal: WeeklySignal, t: (key: string, fallback: string) => string): string | null {
  if (signal.kind === "video" && signal.momentum !== null && signal.momentum >= 1.5)
    return `${multiple.format(signal.momentum)}× ${t("weekly.why.typicalViews", "TYPICAL VIEWS")}`;
  if (signal.kind === "video" && signal.views !== null)
    return `${count.format(signal.views)} ${t("weekly.why.views", "VIEWS")}`;
  if (signal.kind === "thread" && signal.replies !== null)
    return `${count.format(signal.replies)} ${t("weekly.why.replies", "REPLIES")}`;
  return null;
}

/**
 * Why this topic and this hook, read by the operator before PUBLISH NOW: the
 * topic and why it is hot, the take, the opening line, what people were
 * talking about, and — one click deeper — the headlines and topics it beat.
 */
export function WeeklyPostWhy({ pitch }: { pitch: WeeklyPitch }) {
  const { t } = useDictionary("admin-blog");
  const alternatives = pitch.hooks_considered.filter((entry) => entry.headline !== pitch.headline);

  return (
    <section aria-labelledby="weekly-why-label" className="flex max-w-[68ch] flex-col gap-[16px] border-l border-line pl-[16px]">
      <p id="weekly-why-label" className={MONO_LABEL}>
        {t("weekly.why.label", "// WHY THIS POST")}
      </p>

      <div className="flex flex-col gap-[8px]">
        <p className="font-mohave text-body-lg text-text">{pitch.topic}</p>
        <p className="font-mohave text-body text-text-secondary">{pitch.why_now}</p>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-[16px] gap-y-[8px]">
        <dt className={META}>{t("weekly.why.angle", "ANGLE")}</dt>
        <dd className="font-mohave text-body text-text-secondary">{pitch.angle}</dd>
        <dt className={META}>{t("weekly.why.hook", "HOOK")}</dt>
        <dd className="font-mohave text-body text-text">{pitch.hook}</dd>
      </dl>

      {(pitch.signals.length > 0 || pitch.chatter.length > 0) && (
        <div className="flex flex-col gap-[8px]">
          <p className={MONO_LABEL}>{t("weekly.why.signals", "// SIGNALS")}</p>
          <ul className="flex flex-col gap-[8px]">
            {pitch.signals.map((signal) => {
              const metric = signalMetric(signal, t);
              return (
                <li key={signal.id} className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[2px]">
                  <span className={META}>{[signal.source, metric].filter(Boolean).join(" · ")}</span>
                  <a href={signal.url} target="_blank" rel="noreferrer" className={LINK}>
                    {signal.title}
                  </a>
                </li>
              );
            })}
            {pitch.chatter.map((entry) => (
              <li key={entry.url} className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[2px]">
                <span className={META}>{t("weekly.why.search", "SEARCH")}</span>
                <a href={entry.url} target="_blank" rel="noreferrer" className={LINK}>
                  {entry.shows}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="group flex flex-col">
        <summary className={`${META} cursor-pointer list-none select-none hover:text-text-secondary focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent [&::-webkit-details-marker]:hidden`}>
          <span aria-hidden="true" className="inline-block w-[16px] group-open:hidden">
            +
          </span>
          <span aria-hidden="true" className="hidden w-[16px] group-open:inline-block">
            −
          </span>
          {`${t("weekly.why.hooksWeighed", "HEADLINES WEIGHED")} · ${pitch.hooks_considered.length} · ${t("weekly.why.runnersUp", "TOPICS PASSED OVER")} · ${pitch.runners_up.length}`}
        </summary>
        <div className="flex flex-col gap-[16px] pt-[12px]">
          <ul className="flex flex-col gap-[8px]">
            {alternatives.map((entry) => (
              <li key={entry.headline} className="flex flex-col">
                <span className="font-mohave text-body text-text">{entry.headline}</span>
                <span className="font-mohave text-body-sm text-text-tertiary">{entry.verdict}</span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-[8px]">
            {pitch.runners_up.map((entry) => (
              <li key={entry.topic} className="flex flex-col">
                <span className="font-mohave text-body text-text-secondary">{entry.topic}</span>
                <span className="font-mohave text-body-sm text-text-tertiary">{entry.why_not}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
