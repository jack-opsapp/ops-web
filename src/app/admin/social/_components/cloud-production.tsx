"use client";
import { useQuery } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";
import type { EditorialPackage } from "@/lib/social/editorial/worker";
interface CloudRun {
  slot_date: string;
  state: string;
  mode: string;
  last_code: string | null;
  post_id: string | null;
  package: EditorialPackage | null;
  attempt_log?: Array<{ review?: { reason?: string } }>;
}
interface CloudData {
  settings: { mode: "off" | "prepare" | "publish" };
  runs: CloudRun[];
}
export function CloudProduction() {
  const { t } = useDictionary("admin-social");
  const query = useQuery<CloudData>({
    queryKey: ["social-cloud-editorial"],
    queryFn: async () => {
      const response = await fetch("/api/admin/social/editorial", {
        cache: "no-store",
      });
      if (!response.ok) throw Error("unavailable");
      return response.json();
    },
    refetchInterval: 60000,
  });
  const mode = query.data?.settings.mode;
  const summary = query.isPending
    ? t("cloud.loading", "Loading cloud production…")
    : query.isError
      ? t("cloud.unavailable", "Cloud production unavailable")
      : mode === "publish"
        ? t("cloud.active", "Five weekday posts · automatic publishing")
        : mode === "prepare"
          ? t("cloud.prepare", "Draft preparation · publishing held")
          : t("cloud.off", "Cloud production is off");
  return (
    <details
      id="cloud-production"
      className="border-b border-line px-6 py-3 text-text"
    >
      <summary className="cursor-pointer font-mono text-caption text-text-secondary focus-visible:outline focus-visible:outline-ops-accent">
        {summary}
      </summary>
      <div className="flex flex-col gap-3 py-3">
        {query.isError ? (
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="self-start rounded border border-line px-2 py-1 font-cakemono text-cake-button text-text focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent"
          >
            {t("cloud.retry", "RETRY")}
          </button>
        ) : (
          <p className="font-mohave text-body text-text-secondary">
            {t(
              "cloud.schedule",
              "Weekdays at 10:00 Vancouver time. Missed runs can recover until 20:00. A weak or unsupported idea is skipped."
            )}
          </p>
        )}
        {query.data?.runs.length === 0 && (
          <p className="font-mohave text-body text-text-secondary">
            {t("cloud.empty", "No cloud drafts have been prepared.")}
          </p>
        )}
        {query.data?.runs.map((run) => (
          <details key={run.slot_date} className="border-t border-line py-3">
            <summary className="cursor-pointer font-mohave text-body">
              <span className="font-mono tabular-nums">{run.slot_date}</span>
              {" · "}
              {t(`cloud.state.${run.state}`, run.state)}
              {run.package ? " · " + run.package.submission.content.title : ""}
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              {run.last_code && (
                <p className="font-mohave text-body text-text-secondary">
                  {t(
                    `cloud.code.${run.last_code}`,
                    t(
                      "cloud.check",
                      "Preparation stopped. Inspect the draft and source before trying again."
                    )
                  )}
                </p>
              )}
              {run.mode === "prepare" && run.package && (
                <p className="font-mohave text-body text-text-secondary">
                  {t(
                    "cloud.held",
                    "Preview only. This draft will not publish automatically."
                  )}
                </p>
              )}
              {run.package && (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {run.package.preview?.map((asset) => (
                      <a
                        href={asset.url}
                        key={asset.order}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          loading="lazy"
                          src={asset.url}
                          alt={asset.alt_text}
                          width={asset.width}
                          height={asset.height}
                          className="h-auto w-full"
                        />
                      </a>
                    ))}
                  </div>
                  <p className="whitespace-pre-wrap font-mohave text-body text-text">
                    {run.package.submission.content.caption}
                  </p>
                  {!run.package.preview &&
                    run.package.submission.content.slides.map((slide, i) => (
                      <p className="font-mohave text-body" key={i}>
                        {slide.headline}
                        {" — "}
                        {slide.body}
                      </p>
                    ))}
                  <a
                    href={run.package.submission.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mohave text-body text-text-secondary underline"
                  >
                    {t("cloud.source", "Read the source")}
                  </a>
                </>
              )}
              {run.post_id && (
                <a
                  href={`/admin/social?post=${run.post_id}`}
                  className="font-mohave text-body text-text-secondary underline"
                >
                  {t("cloud.queue", "Inspect queued post")}
                </a>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
