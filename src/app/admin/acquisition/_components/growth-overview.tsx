"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Surface } from "@/components/ui/surface";
import { useDictionary, useLocale } from "@/i18n/client";
import type {
  GrowthOverview as GrowthOverviewData,
  GrowthResponseEnvelope,
  GrowthSearchReport,
  GrowthSourceStatus,
} from "@/lib/admin/growth-analytics-types";
import type { AttributionChannel } from "@/lib/pmf/types";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { GrowthTrendChart } from "./acquisition-charts";
import { ChannelPerformanceTable } from "./channel-performance-table";
import { CompanyFunnel } from "./company-funnel";
import { ContentPerformanceTable } from "./content-performance-table";
import { DataHealthRail } from "./data-health-rail";
import { stateMessageKey, stateTone } from "./growth-ui";
import { SourceLanes } from "./source-lanes";

type GrowthChannelFilter = AttributionChannel | "all" | "auto";

interface GrowthFilters {
  startDate: string;
  endDate: string;
  channel: GrowthChannelFilter;
}

interface GrowthOverviewProps {
  initialFilters: GrowthFilters;
  initialHealth: GrowthResponseEnvelope<{ statuses: GrowthSourceStatus[] }>;
  initialOverview: GrowthResponseEnvelope<GrowthOverviewData>;
  initialSearch: GrowthResponseEnvelope<GrowthSearchReport>;
}

const RANGE_OPTIONS = [30, 90, 180] as const;
const CHANNEL_OPTIONS: GrowthChannelFilter[] = [
  "auto",
  "all",
  "organic_search",
  "organic_social",
  "app_store_search",
  "app_store_browse",
  "referral",
  "direct",
  "google_ads",
  "meta_ads",
  "apple_search_ads",
  "other",
  "unknown",
];

function subtractDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function periodDays(filters: GrowthFilters): number {
  const start = new Date(`${filters.startDate}T12:00:00.000Z`).getTime();
  const end = new Date(`${filters.endDate}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

async function fetchGrowth<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Growth request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function GrowthOverview({
  initialFilters,
  initialHealth,
  initialOverview,
  initialSearch,
}: GrowthOverviewProps) {
  const { t } = useDictionary("admin-growth");
  const { locale } = useLocale();
  const reduceMotion = useReducedMotion();
  const firstRender = useRef(true);
  const [rangeDays, setRangeDays] = useState(() => {
    const days = periodDays(initialFilters);
    return RANGE_OPTIONS.includes(days as (typeof RANGE_OPTIONS)[number]) ? days : 30;
  });
  const [channel, setChannel] = useState<GrowthChannelFilter>(initialFilters.channel);
  const [overview, setOverview] = useState(initialOverview);
  const [search, setSearch] = useState(initialSearch);
  const [health, setHealth] = useState(initialHealth);
  const [loading, setLoading] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const filters = useMemo<GrowthFilters>(
    () => ({
      startDate: subtractDays(initialFilters.endDate, rangeDays - 1),
      endDate: initialFilters.endDate,
      channel,
    }),
    [channel, initialFilters.endDate, rangeDays]
  );
  const query = useMemo(() => {
    const params = new URLSearchParams({
      from: filters.startDate,
      to: filters.endDate,
      channel: filters.channel,
    });
    return params.toString();
  }, [filters]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setRefreshFailed(false);
    Promise.all([
      fetchGrowth<GrowthResponseEnvelope<GrowthOverviewData>>(
        `/api/admin/acquisition/overview?${query}`,
        controller.signal
      ),
      fetchGrowth<GrowthResponseEnvelope<GrowthSearchReport>>(
        `/api/admin/acquisition/search?${query}`,
        controller.signal
      ),
      fetchGrowth<GrowthResponseEnvelope<{ statuses: GrowthSourceStatus[] }>>(
        `/api/admin/acquisition/health?${query}`,
        controller.signal
      ),
    ])
      .then(([nextOverview, nextSearch, nextHealth]) => {
        setOverview(nextOverview);
        setSearch(nextSearch);
        setHealth(nextHealth);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setRefreshFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale]
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, style: "percent" }),
    [locale]
  );
  const changeFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
        signDisplay: "always",
        style: "percent",
      }),
    [locale]
  );
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        currency: "CAD",
        maximumFractionDigits: 0,
        style: "currency",
      }),
    [locale]
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
      }),
    [locale]
  );
  const formatNumber = (value: number | null) =>
    value === null ? "—" : numberFormatter.format(value);
  const formatPercent = (value: number | null) =>
    value === null ? "—" : percentFormatter.format(value);
  const formatCurrency = (value: number | null) =>
    value === null ? "—" : currencyFormatter.format(value / 100);
  const data = overview.data;
  const stateMessage = refreshFailed
    ? t("refreshFailed", "The refresh failed. The last verified figures remain visible.")
    : stateMessageKey(overview.state)
      ? t(stateMessageKey(overview.state) as string)
      : null;
  const statuses = health.data?.statuses ?? overview.sources;

  return (
    <div className="min-w-0" data-growth-state={overview.state}>
      <header className="border-b border-border px-3 py-3 md:px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-cakemono text-cake-display uppercase text-text">
              {t("title")}
            </h1>
            <p className="mt-0.5 font-mono text-micro uppercase text-text-mute">
              {t("caption")}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <fieldset>
              <legend className="mb-0.5 font-mono text-micro uppercase text-text-mute">
                {t("rangeLabel")}
              </legend>
              <div className="flex rounded-chip border border-border bg-surface-input p-0.5">
                {RANGE_OPTIONS.map((days) => (
                  <button
                    aria-pressed={rangeDays === days}
                    className={`rounded-sm px-2 py-1 font-mohave text-caption-sm transition-colors duration-150 ease-smooth ${
                      rangeDays === days
                        ? "bg-surface-active text-text"
                        : "text-text-3 hover:text-text-2"
                    }`}
                    key={days}
                    onClick={() => setRangeDays(days)}
                    type="button"
                  >
                    {t(`range${days}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-0.5 block font-mono text-micro uppercase text-text-mute">
                {t("channelLabel")}
              </span>
              <select
                className="h-control-32 rounded-chip border border-border bg-surface-input px-2 font-mohave text-caption-sm text-text outline-none focus:border-border-medium"
                onChange={(event) => setChannel(event.target.value as GrowthChannelFilter)}
                value={channel}
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "auto"
                      ? t("channelAuto")
                      : option === "all"
                        ? t("channelAll")
                        : t(option)}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="inline-flex h-control-32 items-center rounded-chip border border-border px-2 font-cakemono text-cake-button uppercase text-text-2 transition-colors duration-150 ease-smooth hover:border-border-medium hover:text-text"
              href={`/api/admin/acquisition/overview?${query}&format=csv`}
            >
              {t("export")}
            </a>
          </div>
        </div>
      </header>

      <main aria-busy={loading} className="space-y-4 p-3 md:p-4">
        {(loading || stateMessage) && (
          <div aria-live="polite">
            {loading && (
              <p className="font-mono text-micro uppercase text-text-mute">
                {t("loading")}
              </p>
            )}
            {!loading && stateMessage && (
              <p
                className={`rounded-chip border px-2 py-1 font-mohave text-caption-sm ${stateTone(
                  refreshFailed ? "failed" : overview.state
                )}`}
              >
                {stateMessage}
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            animate={{ opacity: 1 }}
            className="space-y-4"
            initial={reduceMotion ? false : { opacity: 0 }}
            key={`${filters.startDate}-${filters.endDate}-${filters.channel}-${overview.asOf}`}
            transition={{ duration: reduceMotion ? 0.15 : 0.25, ease: EASE_SMOOTH }}
          >
            {data ? (
              <>
                <Surface className="p-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <p className="font-mohave text-caption text-text-3">
                        {t("activatedCompanies")}
                      </p>
                      <p className="mt-1 font-mono text-display-lg tabular-nums text-text">
                        {formatNumber(data.activatedCompanies.current)}
                      </p>
                      <p className="mt-1 font-mono text-micro text-text-3">
                        {data.activatedCompanies.changeRatio === null
                          ? "—"
                          : changeFormatter.format(data.activatedCompanies.changeRatio)}{" "}
                        {t("versusPrior")}
                      </p>
                      <p className="mt-2 font-mohave text-caption-sm text-text-3">
                        {t("activatedCaption")}
                      </p>
                    </div>
                    <div className="lg:col-span-2">
                      <GrowthTrendChart
                        formatNumber={formatNumber}
                        points={data.trend}
                        t={t}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2">
                    <p className="font-mohave text-caption-sm text-text-3">
                      {t("coverage")}: {formatPercent(data.attributionCoverage.ratio)}
                    </p>
                    <p className="font-mono text-micro text-text-mute">
                      {data.attributionCoverage.observed !== null &&
                      data.attributionCoverage.total !== null
                        ? t("coverageKnown", {
                            observed: formatNumber(data.attributionCoverage.observed),
                            total: formatNumber(data.attributionCoverage.total),
                          })
                        : data.attributionCoverage.label}
                    </p>
                    <p className="font-mono text-micro text-text-mute">
                      {t("updated", {
                        date: dateTimeFormatter.format(new Date(overview.asOf)),
                      })}
                    </p>
                  </div>
                </Surface>

                <SourceLanes
                  formatNumber={formatNumber}
                  formatPercent={formatPercent}
                  lanes={data.sourceLanes}
                  t={t}
                />
                <CompanyFunnel
                  formatNumber={formatNumber}
                  formatPercent={formatPercent}
                  stages={data.funnel}
                  t={t}
                />
                {data.recentPaidSpendCents > 0 && (
                  <p className="border-l border-border pl-2 font-mono text-data-sm text-text-2">
                    {t("paidSpend", "Paid spend")}: {formatCurrency(data.recentPaidSpendCents)}
                  </p>
                )}
                <ChannelPerformanceTable
                  formatCurrency={formatCurrency}
                  formatNumber={formatNumber}
                  formatPercent={formatPercent}
                  rows={data.channels}
                  t={t}
                />
                <ContentPerformanceTable
                  formatNumber={formatNumber}
                  formatPercent={formatPercent}
                  report={search.data}
                  t={t}
                />
              </>
            ) : (
              <Surface className="p-4">
                <p className="font-mohave text-body text-text-3">{t("unavailable")}</p>
              </Surface>
            )}
            <DataHealthRail statuses={statuses} t={t} />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
