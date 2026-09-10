"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";

type WeeklyState =
  | "queued"
  | "authoring"
  | "drafted"
  | "scheduled"
  | "published"
  | "cancelled"
  | "blocked";

interface WeeklyArticle {
  article: {
    title: string;
    subtitle: string;
    category: string;
    faqs: Array<{ question: string; answer: string }>;
  };
  html: string;
  word_count: number;
  citations: Array<{
    role: "primary" | "supporting";
    title: string | null;
    site_name: string | null;
    final_url: string;
  }>;
  internal_links: number;
  evidence: number;
  editor_notes: string | null;
}

export interface WeeklyAssignment {
  id: string;
  identity: string;
  state: WeeklyState;
  mode: "prepare" | "publish" | null;
  slot_at: string;
  publish_at: string | null;
  published_at: string | null;
  title: string | null;
  slug: string | null;
  last_code: string | null;
  preview: { url: string; width: number; height: number } | null;
  package: WeeklyArticle | null;
  newsletter_state: string | null;
}

export interface WeeklyData {
  settings: { mode: "off" | "prepare" | "publish" } | null;
  newsletter_enabled: boolean;
  assignments: WeeklyAssignment[];
}

type Action = "stop" | "publish_now" | "write_another" | "send_test";

export const WEEKLY_QUERY_KEY = ["journal-weekly-editorial"] as const;
const CONFIRM_MS = 5000;

const launchFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Etc/GMT+7",
  weekday: "short",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `MON SEP 14 · 06:00` in Vancouver time, the clock the whole pipeline runs on. */
export function weeklyTime(iso: string): string {
  const parts = Object.fromEntries(
    launchFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.month} ${parts.day} · ${parts.hour}:${parts.minute}`.toUpperCase();
}

const CODE_FALLBACK: Record<string, string> = {
  SLOT_MISSED: "No draft arrived in time. Nothing went live this week.",
  ATTEMPTS_EXHAUSTED: "The writer failed three times.",
  UNSUPPORTED_TOPIC: "The writer found no topic it could source.",
  STALE_DRAFT: "The draft sat more than a week. It will not publish.",
  SLUG_TAKEN: "Another post took this address first.",
  WEEKLY_ALREADY_LIVE: "Another weekly post already went live this week. Publish anyway, or let it go.",
  HERO_FAILED: "The header image failed three times.",
  HERO_UNREADABLE: "The header image never became public.",
  PACKAGE_MISSING: "The draft was incomplete.",
};

const DONE_KEY: Record<string, [string, string]> = {
  cancelled: ["weekly.done.cancelled", "STOPPED. NOTHING GOES LIVE THIS WEEK."],
  published: ["weekly.done.published", "LIVE ON THE JOURNAL."],
  queued: ["weekly.done.queued", "BACK WITH THE WRITER."],
  sent: ["weekly.done.sent", "TEST SENT TO YOUR INBOX."],
};

// OPS-Web replaces Tailwind's numeric spacing scale with an 8px unit, so every
// spacing value here is the DESIGN.md measure written in px: panel header
// 22/30, panel body 16/30/34, 24px between panels, buttons 9/16 at 36px.
//
// Prose inside the preview: Mohave body on the dark canvas, headings in
// sentence case (Cake Mono is uppercase-only), links in the secondary text
// tone, never the accent.
const PROSE =
  "max-w-[68ch] font-mohave text-body text-text-secondary [&_p]:mb-[16px] [&_h2]:mb-[12px] [&_h2]:mt-[32px] [&_h2]:font-mohave [&_h2]:text-body-lg [&_h2]:text-text [&_h3]:mb-[8px] [&_h3]:mt-[24px] [&_h3]:text-text [&_a]:text-text-secondary [&_a]:underline [&_a:hover]:text-text [&_strong]:text-text [&_blockquote]:my-[24px] [&_blockquote]:border-l [&_blockquote]:border-line [&_blockquote]:pl-[16px] [&_blockquote]:text-text [&_ul]:mb-[16px] [&_ul]:list-disc [&_ul]:pl-[20px] [&_ol]:mb-[16px] [&_ol]:list-decimal [&_ol]:pl-[20px] [&_li]:mb-[8px]";

const MONO_LABEL = "font-mono text-micro uppercase tracking-authority text-text-tertiary";
const BUTTON =
  "min-h-[36px] rounded border px-[16px] py-[9px] font-cakemono text-cake-button uppercase transition-colors duration-150 ease-smooth focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent disabled:opacity-40 motion-reduce:transition-none";
const PRIMARY = `${BUTTON} border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black`;
const SECONDARY = `${BUTTON} border-line text-text-secondary hover:text-text`;
const DESTRUCTIVE = `${BUTTON} border-rose-line bg-rose-soft text-rose`;

async function fetchWeekly(): Promise<WeeklyData> {
  const response = await fetch("/api/admin/journal/editorial", { cache: "no-store" });
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}

export function WeeklyPostPanel() {
  const { t } = useDictionary("admin-blog");
  const params = useSearchParams();
  const linked = params.get("journal");
  const client = useQueryClient();
  const query = useQuery<WeeklyData>({
    queryKey: WEEKLY_QUERY_KEY,
    queryFn: fetchWeekly,
    refetchInterval: 60000,
  });
  const [open, setOpen] = useState(Boolean(linked));
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (linked) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [linked]);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const data = query.data;
  const assignment =
    data?.assignments.find((entry) => entry.id === linked) ?? data?.assignments[0] ?? null;
  const accountMode = data?.settings?.mode ?? "off";

  function statusLine(): string {
    if (query.isPending) return t("weekly.loading", "LOADING");
    if (query.isError) return t("weekly.unavailable", "UNAVAILABLE");
    if (!assignment) return accountMode === "off" ? t("weekly.off", "WRITER OFF") : t("weekly.none", "NO POST IN PROGRESS");
    const slot = weeklyTime(assignment.slot_at);
    switch (assignment.state) {
      case "queued":
        return `${slot} · ${t("weekly.state.queued", "WAITING FOR THE WRITER")}`;
      case "authoring":
        return `${slot} · ${t("weekly.state.authoring", "BEING WRITTEN")}`;
      case "drafted":
        return `${slot} · ${t("weekly.state.drafted", "PREPARING THE PREVIEW")}`;
      case "scheduled":
        return accountMode === "publish" && assignment.mode === "publish" && assignment.publish_at
          ? `${t("weekly.state.scheduledLive", "READY · GOES LIVE")} ${weeklyTime(assignment.publish_at)}`
          : t("weekly.state.scheduledHeld", "READY · WAITS FOR YOUR GO");
      case "published":
        return `${t("weekly.state.published", "LIVE")} · ${weeklyTime(assignment.published_at ?? assignment.slot_at)}`;
      case "blocked":
        return `${slot} · ${t("weekly.state.blocked", "NEEDS YOU")}`;
      case "cancelled":
        return `${slot} · ${t("weekly.state.cancelled", "STOPPED")}`;
    }
  }

  async function act(action: Action) {
    if (!assignment) return;
    if ((action === "stop" || action === "publish_now") && confirming !== action) {
      setConfirming(action);
      return;
    }
    setConfirming(null);
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/journal/editorial/${assignment.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json().catch(() => ({}))) as { state?: string; sent?: number; code?: string };
      if (!response.ok) {
        setNotice(
          body.code && CODE_FALLBACK[body.code]
            ? t(`weekly.code.${body.code}`, CODE_FALLBACK[body.code])
            : t("weekly.error", "SYS :: ACTION FAILED")
        );
        return;
      }
      const done = DONE_KEY[body.sent ? "sent" : (body.state ?? "")];
      if (done) setNotice(t(done[0], done[1]));
      await client.invalidateQueries({ queryKey: WEEKLY_QUERY_KEY });
    } catch {
      setNotice(t("weekly.error", "SYS :: ACTION FAILED"));
    } finally {
      setBusy(null);
    }
  }

  const pack = assignment?.package ?? null;
  const title = pack?.article.title ?? assignment?.title ?? null;
  const canPublish =
    assignment?.state === "scheduled" ||
    (assignment?.state === "blocked" && assignment.last_code === "WEEKLY_ALREADY_LIVE");
  const canStop = assignment ? ["queued", "authoring", "drafted", "scheduled"].includes(assignment.state) : false;
  const canWriteAnother = assignment ? ["blocked", "cancelled"].includes(assignment.state) : false;
  const liveUrl = assignment?.state === "published" && assignment.slug ? `https://opsapp.co/journal/${assignment.slug}` : null;

  return (
    <section
      ref={sectionRef}
      id="weekly-post"
      aria-labelledby="weekly-post-status"
      className="mb-[24px] rounded-panel border border-line"
    >
      <button
        type="button"
        id="weekly-post-status"
        aria-expanded={open}
        aria-controls="weekly-post-preview"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-baseline gap-x-[16px] gap-y-[4px] px-[30px] py-[22px] text-left focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent"
      >
        <span className={MONO_LABEL}>{t("weekly.label", "// WEEKLY POST")}</span>
        <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-secondary">
          {statusLine()}
        </span>
        {title && <span className="min-w-0 flex-1 truncate font-mohave text-body text-text">{title}</span>}
      </button>

      {open && (
        <div
          id="weekly-post-preview"
          className="flex flex-col gap-[24px] border-t border-line px-[30px] pb-[34px] pt-[16px]"
        >
          {query.isError && (
            <button type="button" onClick={() => void query.refetch()} className={`${SECONDARY} self-start`}>
              {t("weekly.retry", "RETRY")}
            </button>
          )}

          {assignment?.state === "blocked" && (
            <p className="font-mohave text-body text-text-secondary">
              {t(
                `weekly.code.${assignment.last_code ?? "fallback"}`,
                CODE_FALLBACK[assignment.last_code ?? ""] ?? "The post stopped before going live."
              )}
            </p>
          )}

          {assignment?.state === "drafted" && (
            <p className="font-mohave text-body text-text-secondary">
              {t("weekly.previewPending", "The preview is being prepared. It appears within the hour.")}
            </p>
          )}

          {assignment?.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assignment.preview.url}
              alt={title ?? ""}
              width={assignment.preview.width}
              height={assignment.preview.height}
              className="h-auto w-full max-w-[720px] rounded-panel border border-line"
            />
          )}

          {pack && (
            <div className="flex flex-col gap-[8px]">
              <h2 className="font-cakemono text-cake-display font-light uppercase text-text">{pack.article.title}</h2>
              <p className="max-w-[68ch] font-mohave text-body text-text-secondary">{pack.article.subtitle}</p>
              <p className="font-mono text-micro uppercase tracking-[0.12em] text-text-tertiary">
                {[
                  pack.article.category.replace(/-/g, " ").toUpperCase(),
                  `${pack.word_count.toLocaleString("en-US")} ${t("weekly.facts.words", "WORDS")}`,
                  `${pack.article.faqs.length} ${t("weekly.facts.faqs", "FAQS")}`,
                  `${pack.citations.length} ${t("weekly.facts.sources", "SOURCES")}`,
                  `${pack.internal_links} ${t("weekly.facts.links", "LINKS")}`,
                ].join(" · ")}
              </p>
            </div>
          )}

          {assignment && (canPublish || canStop || canWriteAnother || liveUrl || pack) && (
            <div className="flex flex-wrap items-center gap-[12px]">
              {canPublish && (
                <button type="button" disabled={busy !== null} onClick={() => void act("publish_now")} className={PRIMARY}>
                  {confirming === "publish_now"
                    ? t("weekly.action.confirmPublish", "CONFIRM PUBLISH")
                    : t("weekly.action.publish", "PUBLISH NOW")}
                </button>
              )}
              {canStop && (
                <button type="button" disabled={busy !== null} onClick={() => void act("stop")} className={DESTRUCTIVE}>
                  {confirming === "stop" ? t("weekly.action.confirmStop", "CONFIRM STOP") : t("weekly.action.stop", "STOP")}
                </button>
              )}
              {canWriteAnother && (
                <button type="button" disabled={busy !== null} onClick={() => void act("write_another")} className={SECONDARY}>
                  {t("weekly.action.another", "WRITE ANOTHER")}
                </button>
              )}
              {pack && (
                <button type="button" disabled={busy !== null} onClick={() => void act("send_test")} className={SECONDARY}>
                  {t("weekly.action.test", "SEND TEST TO ME")}
                </button>
              )}
              {liveUrl && (
                <a href={liveUrl} target="_blank" rel="noreferrer" className="font-mohave text-body text-text-secondary underline hover:text-text">
                  {t("weekly.action.open", "OPEN ON THE JOURNAL")}
                </a>
              )}
              {notice && (
                <span role="status" className="font-mono text-micro uppercase tracking-[0.12em] text-text-secondary">
                  {notice}
                </span>
              )}
            </div>
          )}

          {pack && (
            <p className="font-mohave text-body-sm text-text-tertiary">
              {data?.newsletter_enabled
                ? t("weekly.newsletterOn", "Newsletter on. Subscribers get this Tuesday at 10:00.")
                : t("weekly.newsletterOff", "Newsletter off. Nothing mails until you turn it on.")}
            </p>
          )}

          {pack && (
            <article
              className={PROSE}
              // The article HTML is produced by OPS from the writer's blocks and
              // sanitized against the same allowlist the public page applies.
              dangerouslySetInnerHTML={{ __html: pack.html }}
            />
          )}

          {pack && pack.article.faqs.length > 0 && (
            <div className="flex max-w-[68ch] flex-col gap-[12px]">
              <p className={MONO_LABEL}>{t("weekly.faqs", "// FAQS")}</p>
              <dl className="flex flex-col gap-[16px]">
                {pack.article.faqs.map((faq) => (
                  <div key={faq.question}>
                    <dt className="font-mohave text-body text-text">{faq.question}</dt>
                    <dd className="font-mohave text-body text-text-secondary">{faq.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {pack && (
            <div className="flex max-w-[68ch] flex-col gap-[12px]">
              <p className={MONO_LABEL}>{t("weekly.sources", "// SOURCES")}</p>
              <ul className="flex flex-col gap-[8px]">
                {pack.citations.map((citation) => (
                  <li key={citation.final_url} className="flex flex-wrap items-baseline gap-[12px]">
                    <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-tertiary">
                      {citation.role === "primary" ? t("weekly.primary", "PRIMARY") : t("weekly.supporting", "SUPPORTING")}
                    </span>
                    <a href={citation.final_url} target="_blank" rel="noreferrer" className="font-mohave text-body text-text-secondary underline hover:text-text">
                      {citation.title ?? citation.site_name ?? citation.final_url}
                    </a>
                  </li>
                ))}
              </ul>
              {pack.editor_notes && (
                <p className="font-mohave text-body-sm text-text-tertiary">
                  <span className={MONO_LABEL}>{t("weekly.editor", "// EDITOR")}</span> {pack.editor_notes}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
