"use client";
import { useQuery } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";
import type { SocialContent } from "@/lib/social/contract";
import type { RenderedSocialAsset } from "@/lib/social/types";

type AssignmentState =
  | "queued"
  | "authoring"
  | "drafted"
  | "prepared"
  | "submitted"
  | "blocked";

interface EditorialPackage {
  submission: { content: SocialContent; source: { url?: string } };
  preview?: RenderedSocialAsset[];
}

interface SourceSnapshot {
  id?: string;
  title?: string;
  slug?: string;
  published_at?: string;
}

interface Assignment {
  id: string;
  identity: string;
  kind: "blog" | "protocol" | "product" | "rotation";
  mode: "prepare" | "publish" | null;
  state: AssignmentState;
  attempts: number;
  last_code: string | null;
  source_snapshot: SourceSnapshot | null;
  package: EditorialPackage | null;
  preview: RenderedSocialAsset[] | null;
  post_id: string | null;
  post: {
    status: string;
    publish_after: string | null;
    instagram_permalink: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

interface LegacyRun {
  slot_date: string;
  state: string;
  mode: string;
  last_code: string | null;
  post_id: string | null;
  package: EditorialPackage | null;
}

interface CloudData {
  settings: {
    mode: "off" | "prepare" | "publish";
    delivery_gap_minutes?: number;
  };
  assignments: Assignment[];
  legacy_runs: LegacyRun[];
}

/**
 * Fallback copy for every state and stop reason. The operator must never read
 * a raw enum, so the fallback is the sentence, not the token.
 */
const STATE_COPY: Record<AssignmentState, string> = {
  queued: "Waiting for the writer",
  authoring: "Being written",
  drafted: "Written · preview pending",
  prepared: "Draft ready",
  submitted: "In publishing queue",
  blocked: "Needs attention",
};

const CODE_COPY: Record<string, string> = {
  SOURCE_WITHDRAWN: "The article was unpublished before this post went out.",
  SOURCE_CHANGED: "The source changed or was unpublished during preparation.",
  UNSUPPORTED_FORMAT:
    "The writer could not fit this source to a supported format.",
  SUBMISSIONS_EXHAUSTED:
    "The draft failed validation three times. It retries in six hours.",
  RENDER_FAILED: "The artwork could not be produced.",
  AUTHORING_STALLED:
    "No writing run has checked in. Confirm the cloud routine is scheduled.",
  EDITOR_REJECTED: "The editorial check rejected this idea.",
  NO_FRESH_SOURCE: "No unused source met the freshness requirements.",
  ATTEMPTS_EXHAUSTED: "Preparation failed after three attempts.",
  DELIVERY_NEEDS_REVIEW:
    "The publishing queue needs attention. Inspect the queued post.",
};

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Etc/GMT+7",
  weekday: "short",
  month: "short",
  day: "2-digit",
});

/**
 * The operator scans this list for one thing: which article is where. A blog
 * assignment is named by its article; a recurring assignment by its day.
 */
function assignmentLabel(assignment: Assignment): string {
  const title =
    assignment.source_snapshot?.title ??
    assignment.package?.submission.content.title;
  if (assignment.kind === "blog") return title ?? assignment.identity;
  const slotDate = assignment.identity.split(":")[1];
  const parts = Object.fromEntries(
    WEEKDAY_FORMAT.formatToParts(new Date(`${slotDate}T12:00:00Z`)).map(
      (part) => [part.type, part.value]
    )
  );
  return `${assignment.kind} · ${parts.weekday} ${parts.month} ${parts.day}`.toUpperCase();
}

function Preview({ assets }: { assets: RenderedSocialAsset[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {assets.map((asset) => (
        <a href={asset.url} key={asset.order} target="_blank" rel="noreferrer">
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
  );
}

function Draft({
  pack,
  preview,
  sourceLabel,
}: {
  pack: EditorialPackage;
  preview: RenderedSocialAsset[] | null;
  sourceLabel: string;
}) {
  const assets = preview ?? pack.preview ?? null;
  return (
    <>
      {assets ? (
        <Preview assets={assets} />
      ) : (
        pack.submission.content.slides.map((slide, index) => (
          <p className="font-mohave text-body" key={index}>
            {slide.headline}
            {" — "}
            {slide.body}
          </p>
        ))
      )}
      <p className="whitespace-pre-wrap font-mohave text-body text-text">
        {pack.submission.content.caption}
      </p>
      {pack.submission.source.url && (
        <a
          href={pack.submission.source.url}
          target="_blank"
          rel="noreferrer"
          className="font-mohave text-body text-text-secondary underline"
        >
          {sourceLabel}
        </a>
      )}
    </>
  );
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
  const assignments = query.data?.assignments ?? [];
  const legacyRuns = query.data?.legacy_runs ?? [];
  const summary = query.isPending
    ? t("cloud.loading", "Loading cloud production…")
    : query.isError
      ? t("cloud.unavailable", "Cloud production unavailable")
      : mode === "publish"
        ? t("cloud.active", "Adapting every blog · automatic publishing")
        : mode === "prepare"
          ? t("cloud.prepare", "Draft preparation · publishing held")
          : t("cloud.off", "Cloud production is off");
  const sourceLabel = t("cloud.source", "Read the source");

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
              "Blogs are adapted as they publish. Tuesday protocol, Wednesday product, Friday rotation. Posts are paced one per day inside 10:00–20:00."
            )}
          </p>
        )}

        {!query.isPending && !query.isError && assignments.length === 0 && (
          <p className="font-mohave text-body text-text-secondary">
            {t("cloud.empty", "No cloud drafts have been prepared.")}
          </p>
        )}

        {assignments.map((assignment) => (
          <details key={assignment.id} className="border-t border-line py-3">
            <summary className="cursor-pointer font-mohave text-body">
              <span className="font-cakemono uppercase">
                {assignmentLabel(assignment)}
              </span>
              {" · "}
              <span className="text-text-secondary">
                {t(
                  `cloud.state.${assignment.state}`,
                  STATE_COPY[assignment.state] ?? assignment.state
                )}
              </span>
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              {assignment.last_code && (
                <p className="font-mohave text-body text-text-secondary">
                  {t(
                    `cloud.code.${assignment.last_code}`,
                    CODE_COPY[assignment.last_code] ??
                      t(
                        "cloud.check",
                        "Preparation stopped. Inspect the draft and source before trying again."
                      )
                  )}
                </p>
              )}
              {assignment.state === "prepared" && (
                <p className="font-mohave text-body text-text-secondary">
                  {t(
                    "cloud.held",
                    "Preview only. This draft will not publish automatically."
                  )}
                </p>
              )}
              {assignment.package && (
                <Draft
                  pack={assignment.package}
                  preview={assignment.preview}
                  sourceLabel={sourceLabel}
                />
              )}
              {assignment.post_id && (
                <p className="flex flex-wrap gap-3 font-mono text-micro uppercase tracking-wider text-text-tertiary">
                  <a
                    href={`/admin/social?post=${assignment.post_id}`}
                    className="font-mohave text-body normal-case tracking-normal text-text-secondary underline"
                  >
                    {t("cloud.queue", "Inspect queued post")}
                  </a>
                  {assignment.post?.status && (
                    <span>
                      {t(
                        `status.${assignment.post.status}`,
                        assignment.post.status
                      )}
                    </span>
                  )}
                </p>
              )}
              {assignment.post?.instagram_permalink && (
                <a
                  href={assignment.post.instagram_permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mohave text-body text-text-secondary underline"
                >
                  {t("cloud.permalink", "Open on Instagram")}
                </a>
              )}
            </div>
          </details>
        ))}

        {legacyRuns.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <p className="font-mono text-micro uppercase tracking-wider text-text-tertiary">
              {t("cloud.legacy", "HELD LEGACY DRAFT")}
            </p>
            {legacyRuns.map((run) => (
              <details key={run.slot_date} className="py-3">
                <summary className="cursor-pointer font-mohave text-body">
                  <span className="font-mono tabular-nums">
                    {run.slot_date}
                  </span>
                  {" · "}
                  <span className="text-text-secondary">
                    {t(
                      `cloud.state.${run.state}`,
                      STATE_COPY[run.state as AssignmentState] ?? run.state
                    )}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 pt-3">
                  {run.package && (
                    <Draft
                      pack={run.package}
                      preview={null}
                      sourceLabel={sourceLabel}
                    />
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
