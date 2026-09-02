"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import { useDictionary } from "@/i18n/client";
import { useSocialPosts } from "@/lib/hooks/use-social-posts";
import {
  canManuallyRetrySocialPost,
  requiresInstagramReconciliation,
} from "@/lib/social/publish-policy";
import type { SocialContent, SocialSlide } from "@/lib/social/contract";
import type { SocialPostRecord, SocialPostStatus } from "@/lib/social/types";
import { cn } from "@/lib/utils/cn";

type QueueFilter = "all" | "active" | "published" | "failed";
type Translate = (key: string, fallbackOrParams?: string | Record<string, unknown>) => string;

const ACTIVE_STATUSES = new Set<SocialPostStatus>(["rendering", "review", "publishing"]);

const STATUS_TONES: Record<SocialPostStatus, string> = {
  rendering: "border-line-hi text-text-2",
  review: "border-line-hi text-text-2",
  publishing: "border-tan/40 text-tan",
  published: "border-olive/40 text-olive",
  cancelled: "border-line text-text-mute",
  failed: "border-rose/40 text-rose",
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").toUpperCase();
}

function withParams(
  translate: Translate,
  key: string,
  fallback: string,
  params: Record<string, string | number>
): string {
  const translated = translate(key, params);
  const template = translated === key ? fallback : translated;
  return template.replace(/\{(\w+)\}/g, (match, token) =>
    token in params ? String(params[token]) : match
  );
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function countdown(target: string | null, now: number, due: string, unscheduled: string): string {
  if (!target) return unscheduled;
  const remaining = new Date(target).getTime() - now;
  if (remaining <= 0) return due;
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function filterPosts(posts: SocialPostRecord[], filter: QueueFilter): SocialPostRecord[] {
  if (filter === "all") return posts;
  if (filter === "active") return posts.filter((post) => ACTIVE_STATUSES.has(post.status));
  return posts.filter((post) => post.status === filter);
}

function orderPosts(posts: SocialPostRecord[]): SocialPostRecord[] {
  return [...posts].sort((left, right) => {
    const leftActive = ACTIVE_STATUSES.has(left.status);
    const rightActive = ACTIVE_STATUSES.has(right.status);
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    if (leftActive && rightActive) {
      return new Date(left.publish_after).getTime() - new Date(right.publish_after).getTime();
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function selectorRationale(post: SocialPostRecord): string {
  const breakdown = post.selection_metadata.scoreBreakdown;
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) {
    return humanize(post.story_type);
  }
  const scores = breakdown as Record<string, unknown>;
  const value = (key: string) =>
    typeof scores[key] === "number" ? Math.round(scores[key] as number) : 0;
  return `FIT ${value("fit")} · CADENCE ${value("cadence")} · PREFERENCE ${value("preference")}`;
}

function assetEvidence(asset: SocialPostRecord["rendered_assets"][number]): string {
  return `${asset.width} × ${asset.height} · ${Math.max(1, Math.round(asset.bytes / 1024))} KB · SHA ${asset.sha256.slice(0, 12).toUpperCase()}`;
}

function StatusPill({ status }: { status: SocialPostStatus }) {
  const { t } = useDictionary("admin-social");
  return (
    <span
      className={cn(
        "inline-flex rounded-chip border px-1.5 py-px font-mono text-micro tracking-wide",
        STATUS_TONES[status]
      )}
    >
      {t(`status.${status}`, humanize(status))}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-line pl-2 first:border-l-0 first:pl-0">
      <p className="font-mono text-micro uppercase tracking-wide text-text-mute">{label}</p>
      <p className="font-mono text-heading tabular-nums text-text">{value}</p>
    </div>
  );
}

function CopyEditor({
  post,
  saving,
  onCancel,
  onSave,
}: {
  post: SocialPostRecord;
  saving: boolean;
  onCancel: () => void;
  onSave: (content: SocialContent) => Promise<void>;
}) {
  const { t } = useDictionary("admin-social");
  const [draft, setDraft] = useState<SocialContent>(post.content);

  useEffect(() => setDraft(post.content), [post]);

  function update<K extends keyof SocialContent>(key: K, value: SocialContent[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSlide(index: number, updateValue: Partial<SocialSlide>) {
    setDraft((current) => ({
      ...current,
      slides: current.slides.map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, ...updateValue } : slide
      ),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div>
        <h2 className="font-cakemono text-heading font-light uppercase text-text">
          {t("edit.title", "EDIT COPY")}
        </h2>
        <p className="mt-0.5 font-mohave text-body-sm text-text-3">
          {t(
            "edit.subtitle",
            "The artwork will be regenerated and a new 10-minute veto window will begin."
          )}
        </p>
      </div>
      <Input
        label={t("edit.field.title", "TITLE")}
        value={draft.title}
        maxLength={100}
        required
        onChange={(event) => update("title", event.target.value)}
      />
      <Input
        label={t("edit.field.subtitle", "SUBTITLE")}
        value={draft.subtitle ?? ""}
        maxLength={160}
        onChange={(event) => update("subtitle", event.target.value || undefined)}
      />
      <Input
        label={t("edit.field.date", "DATE")}
        value={draft.date ?? ""}
        maxLength={40}
        onChange={(event) => update("date", event.target.value || undefined)}
      />
      <Input
        label={t("edit.field.hook", "HOOK")}
        value={draft.hook}
        maxLength={90}
        required
        onChange={(event) => update("hook", event.target.value)}
      />
      <Textarea
        label={t("edit.field.angle", "ANGLE")}
        value={draft.angle}
        maxLength={220}
        required
        onChange={(event) => update("angle", event.target.value)}
      />
      <Textarea
        label={t("edit.field.caption", "CAPTION")}
        value={draft.caption}
        maxLength={2200}
        required
        onChange={(event) => update("caption", event.target.value)}
      />
      <Input
        label={t("edit.field.cta", "CALL TO ACTION")}
        value={draft.cta ?? ""}
        maxLength={120}
        onChange={(event) => update("cta", event.target.value || undefined)}
      />
      <Textarea
        label={t("edit.field.alt", "ALT TEXT")}
        value={draft.alt_text}
        maxLength={1000}
        required
        onChange={(event) => update("alt_text", event.target.value)}
      />
      {draft.slides.map((slide, index) => (
        <Surface key={index} variant="inset" className="flex flex-col gap-2 p-3">
          <p className="font-mono text-micro uppercase tracking-wide text-text-3">
            {withParams(t, "edit.slide", "SLIDE {number}", { number: index + 1 })}
          </p>
          <Input
            label={t("edit.field.eyebrow", "EYEBROW")}
            value={slide.eyebrow ?? ""}
            maxLength={40}
            onChange={(event) => updateSlide(index, { eyebrow: event.target.value || undefined })}
          />
          <Input
            label={t("edit.field.headline", "HEADLINE")}
            value={slide.headline}
            maxLength={100}
            required
            onChange={(event) => updateSlide(index, { headline: event.target.value })}
          />
          <Textarea
            label={t("edit.field.body", "BODY")}
            value={slide.body ?? ""}
            maxLength={350}
            onChange={(event) => updateSlide(index, { body: event.target.value || undefined })}
          />
          <Input
            label={t("edit.field.image", "IMAGE URL")}
            type="url"
            value={slide.image_url ?? ""}
            onChange={(event) => updateSlide(index, { image_url: event.target.value || undefined })}
          />
          <Textarea
            label={t("edit.field.slideAlt", "SLIDE ALT TEXT")}
            value={slide.alt_text ?? ""}
            maxLength={500}
            onChange={(event) => updateSlide(index, { alt_text: event.target.value || undefined })}
          />
        </Surface>
      ))}
      <div className="flex justify-end gap-1 border-t border-line pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("edit.cancel", "DISCARD")}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {t("edit.save", "SAVE + REGENERATE")}
        </Button>
      </div>
    </form>
  );
}

export function SocialCommandDeck({ initialPostId }: { initialPostId?: string }) {
  const { t } = useDictionary("admin-social");
  const { posts, isLoading, error, action } = useSocialPosts();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialPostId ?? null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const orderedPosts = useMemo(() => orderPosts(posts), [posts]);
  const visiblePosts = useMemo(
    () => filterPosts(orderedPosts, filter),
    [filter, orderedPosts]
  );
  const selected =
    visiblePosts.find((post) => post.id === selectedId) ?? visiblePosts[0] ?? null;

  useEffect(() => {
    setSlideIndex(0);
    setEditing(false);
    setConfirmingStop(false);
    setFeedback(null);
  }, [selected?.id]);

  const counts = useMemo(
    () => ({
      queue: posts.filter((post) => ACTIVE_STATUSES.has(post.status)).length,
      ready: posts.filter((post) => post.status === "review").length,
      live: posts.filter((post) => post.status === "published").length,
      failed: posts.filter((post) => post.status === "failed").length,
    }),
    [posts]
  );

  const filters: Array<{ id: QueueFilter; label: string }> = [
    { id: "all", label: t("filter.all", "ALL") },
    { id: "active", label: t("filter.active", "ACTIVE") },
    { id: "published", label: t("filter.published", "PUBLISHED") },
    { id: "failed", label: t("filter.failed", "FAILED") },
  ];

  async function run(body: { action: "cancel" | "publish_now" | "retry" }, success: string) {
    if (!selected) return;
    setFeedback(null);
    try {
      await action.mutateAsync({ id: selected.id, body });
      setFeedback(success);
      setConfirmingStop(false);
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : t("state.error", "SOCIAL QUEUE UNAVAILABLE"));
    }
  }

  async function save(content: SocialContent) {
    if (!selected) return;
    setFeedback(null);
    try {
      await action.mutateAsync({ id: selected.id, body: { action: "edit", content } });
      setEditing(false);
      setFeedback(t("feedback.saved", "COPY SAVED. VETO WINDOW RESTARTED."));
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : t("state.error", "SOCIAL QUEUE UNAVAILABLE"));
    }
  }

  const assets = selected?.rendered_assets ?? [];
  const activeAsset = assets[Math.min(slideIndex, Math.max(assets.length - 1, 0))];
  const dueCopy = t("state.due", "DUE NOW");
  const unscheduledCopy = t("state.unscheduled", "NO LAUNCH TIME");
  const reconciliationRequired = selected ? requiresInstagramReconciliation(selected) : false;
  const canEditOrStop =
    selected !== null &&
    (selected.status === "review" || selected.status === "failed") &&
    !reconciliationRequired;

  return (
    <div className="min-h-screen bg-black text-text">
      <header className="border-b border-line px-6 py-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <h1 className="font-cakemono text-title font-light uppercase tracking-wide text-text">
              {t("header.title", "SOCIAL")}
            </h1>
            <p className="mt-0.5 font-mono text-caption-sm text-text-mute">
              [{t("header.caption", "curated feed + launch control")}]
            </p>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Metric label={t("stat.queue", "IN FLIGHT")} value={counts.queue} />
            <Metric label={t("stat.ready", "IN VETO")} value={counts.ready} />
            <Metric label={t("stat.live", "LIVE")} value={counts.live} />
            <Metric label={t("stat.failed", "FAILED")} value={counts.failed} />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3 xl:p-4">
        <Surface variant="dense" className="col-span-12 overflow-hidden xl:col-span-3">
          <div className="border-b border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-cakemono text-heading font-light uppercase text-text">
                {t("rail.title", "LAUNCH RAIL")}
              </h2>
              <span className="font-mono text-micro tabular-nums text-text-mute">
                {withParams(t, "rail.count", "{count} POSTS", { count: visiblePosts.length })}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("rail.title", "LAUNCH RAIL")}>
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => {
                    setFilter(item.id);
                    setSelectedId(null);
                  }}
                  className={cn(
                    "rounded-chip border px-1.5 py-0.5 font-mono text-micro uppercase tracking-wide transition-colors",
                    filter === item.id
                      ? "border-line-hi bg-surface-active text-text"
                      : "border-line text-text-3 hover:text-text-2"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-screen overflow-y-auto">
            {isLoading ? (
              <p className="p-4 font-mono text-micro uppercase text-text-mute">
                {t("state.loading", "LOADING LAUNCH RAIL")}
              </p>
            ) : error ? (
              <p className="p-4 font-mono text-micro uppercase text-rose" role="alert">
                {t("state.error", "SOCIAL QUEUE UNAVAILABLE")}
              </p>
            ) : visiblePosts.length === 0 ? (
              <p className="p-4 font-mono text-micro uppercase text-text-mute">
                {t("rail.empty", "NO POSTS IN THIS CHANNEL")}
              </p>
            ) : (
              visiblePosts.map((post, index) => (
                <button
                  key={post.id}
                  type="button"
                  aria-current={selected?.id === post.id ? "true" : undefined}
                  onClick={() => setSelectedId(post.id)}
                  className={cn(
                    "flex w-full gap-2 border-b border-line p-3 text-left transition-colors last:border-b-0",
                    selected?.id === post.id ? "bg-surface-active" : "hover:bg-surface-hover"
                  )}
                >
                  <span className="pt-px font-mono text-micro tabular-nums text-text-mute">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-1">
                      <span className="line-clamp-2 font-mohave text-body font-medium text-text">
                        {post.content.title}
                      </span>
                      <StatusPill status={post.status} />
                    </span>
                    {selected?.id === post.id && (
                      <span className="mt-1 block font-mono text-micro uppercase text-text-2">
                        {t("rail.selected", "SELECTED")}
                      </span>
                    )}
                    <span className="mt-1 flex items-center justify-between gap-1 font-mono text-micro uppercase text-text-mute">
                      <span>{humanize(post.visual_treatment)}</span>
                      <span className="tabular-nums">
                        {post.status === "review"
                          ? countdown(post.publish_after, now, dueCopy, unscheduledCopy)
                          : dateTime(post.publish_after)}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </Surface>

        <Surface variant="dense" className="col-span-12 p-3 xl:col-span-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-cakemono text-heading font-light uppercase text-text">
              {t("preview.title", "ARTWORK")}
            </h2>
            {assets.length > 0 && (
              <span className="font-mono text-micro tabular-nums text-text-mute">
                {withParams(t, "preview.slide", "SLIDE {current} / {total}", {
                  current: slideIndex + 1,
                  total: assets.length,
                })}
              </span>
            )}
          </div>
          {activeAsset ? (
            <div className="mx-auto max-w-md">
              <div className="aspect-[4/5] overflow-hidden rounded border border-line bg-surface-input">
                {/* Generated social assets are already optimized 1080 x 1350 JPEGs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeAsset.url}
                  alt={activeAsset.alt_text}
                  className="h-full w-full object-cover"
                />
              </div>
              {assets.length > 1 && (
                <div className="mt-2 flex items-center justify-between">
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={t("preview.previous", "PREVIOUS SLIDE")}
                    disabled={slideIndex === 0}
                    onClick={() => setSlideIndex((current) => Math.max(0, current - 1))}
                  >
                    <ChevronLeft className="h-icon-16 w-icon-16" aria-hidden="true" />
                  </Button>
                  <div className="flex gap-1">
                    {assets.map((asset, index) => (
                      <button
                        key={asset.sha256}
                        type="button"
                        aria-pressed={index === slideIndex}
                        aria-label={withParams(t, "edit.slide", "SLIDE {number}", {
                          number: index + 1,
                        })}
                        onClick={() => setSlideIndex(index)}
                        className={cn(
                          "h-1.5 w-6 rounded-chip",
                          index === slideIndex ? "bg-text-2" : "bg-line-hi"
                        )}
                      />
                    ))}
                  </div>
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={t("preview.next", "NEXT SLIDE")}
                    disabled={slideIndex === assets.length - 1}
                    onClick={() => setSlideIndex((current) => Math.min(assets.length - 1, current + 1))}
                  >
                    <ChevronRight className="h-icon-16 w-icon-16" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center rounded border border-line bg-surface-input">
              <p className="font-mono text-micro uppercase text-text-mute">
                {t("state.noSelection", "SELECT A POST TO INSPECT")}
              </p>
            </div>
          )}

          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 font-mono text-micro uppercase tracking-wide text-text-mute">
              {t("preview.feed", "FEED RHYTHM")}
            </p>
            <div className="grid grid-cols-6 gap-1">
              {orderedPosts.slice(0, 6).map((post) => {
                const asset = post.rendered_assets[0];
                return (
                  <button
                    key={post.id}
                    type="button"
                    aria-current={selected?.id === post.id ? "true" : undefined}
                    aria-label={post.content.title}
                    onClick={() => {
                      setFilter("all");
                      setSelectedId(post.id);
                    }}
                    className={cn(
                      "aspect-square overflow-hidden rounded border bg-surface-input",
                      selected?.id === post.id ? "border-line-hi" : "border-line"
                    )}
                  >
                    {asset && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.url} alt="" className="h-full w-full object-cover" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </Surface>

        <Surface variant="dense" className="col-span-12 p-3 xl:col-span-4">
          {!selected ? (
            <p className="font-mono text-micro uppercase text-text-mute">
              {t("state.noSelection", "SELECT A POST TO INSPECT")}
            </p>
          ) : editing ? (
            <CopyEditor
              post={selected}
              saving={action.isPending}
              onCancel={() => setEditing(false)}
              onSave={save}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                    {t("control.title", "CONTROL FILE")}
                  </p>
                  <h2 className="mt-0.5 font-mohave text-title-sm font-semibold leading-tight text-text">
                    {selected.content.title}
                  </h2>
                </div>
                <StatusPill status={selected.status} />
              </div>

              <dl className="grid grid-cols-2 gap-2 border-y border-line py-2">
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.source", "SOURCE")}
                  </dt>
                  <dd className="mt-0.5 truncate font-mohave text-body-sm text-text-2">
                    {selected.source_url ? (
                      <a
                        href={selected.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-text"
                      >
                        {t(`source.${selected.source_type}`, humanize(selected.source_type))}
                        <ExternalLink className="h-icon-16 w-icon-16" aria-hidden="true" />
                      </a>
                    ) : (
                      t(`source.${selected.source_type}`, humanize(selected.source_type))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.treatment", "TREATMENT")}
                  </dt>
                  <dd className="mt-0.5 truncate font-mohave text-body-sm text-text-2">
                    {humanize(selected.visual_treatment)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.format", "FORMAT")}
                  </dt>
                  <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {t(`format.${selected.post_format}`, humanize(selected.post_format))}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.launch", "LAUNCH")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-caption-sm tabular-nums text-text-2">
                    {selected.status === "review"
                      ? countdown(selected.publish_after, now, dueCopy, unscheduledCopy)
                      : dateTime(selected.publish_after)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.attempts", "ATTEMPTS")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-caption-sm tabular-nums text-text-2">
                    {selected.attempt_count} / {selected.max_attempts}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.publishStage", "PUBLISH STAGE")}
                  </dt>
                  <dd className="mt-0.5 font-mono text-caption-sm text-text-2">
                    {humanize(selected.publish_stage)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase text-text-mute">
                    {t("control.selector", "SELECTOR")}
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-caption-sm text-text-2">
                    {selected.selector_version}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.hook", "HOOK")}
                </p>
                <p className="mt-1 font-mohave text-body-sm leading-relaxed text-text-2">
                  {selected.content.hook}
                </p>
              </div>

              <div>
                <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.angle", "ANGLE")}
                </p>
                <p className="mt-1 font-mohave text-body-sm leading-relaxed text-text-2">
                  {selected.content.angle}
                </p>
              </div>

              <div>
                <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.caption", "CAPTION")}
                </p>
                <p className="mt-1 whitespace-pre-wrap font-mohave text-body-sm leading-relaxed text-text-2">
                  {selected.caption}
                </p>
              </div>

              <Surface variant="inset" className="p-2">
                <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.selectionRationale", "SELECTION RATIONALE")}
                </p>
                <p className="mt-0.5 font-mono text-micro uppercase text-text-2">
                  {selectorRationale(selected)}
                </p>
                <p className="mt-2 font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.renderEvidence", "RENDER EVIDENCE")}
                </p>
                <p className="mt-0.5 font-mono text-micro text-text-2">
                  {selected.render_version}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {selected.rendered_assets.map((asset) => (
                    <li key={asset.sha256} className="font-mono text-micro tabular-nums text-text-3">
                      {withParams(t, "control.asset", "SLIDE {number}", { number: asset.order })} · {assetEvidence(asset)}
                    </li>
                  ))}
                </ul>
              </Surface>

              {selected.last_error_message && (
                <Surface variant="inset" className="border-rose-line bg-rose-soft p-2">
                  <p className="font-mono text-micro uppercase text-rose">
                    {selected.last_error_code ?? humanize(selected.status)}
                  </p>
                  <p className="mt-0.5 font-mohave text-body-sm text-rose">
                    {selected.last_error_message}
                  </p>
                </Surface>
              )}

              {reconciliationRequired && (
                <Surface variant="inset" className="border-rose-line bg-rose-soft p-3" role="alert">
                  <p className="font-cakemono text-heading font-light uppercase text-rose">
                    {t("reconciliation.title", "RECONCILIATION REQUIRED")}
                  </p>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {t(
                      "reconciliation.body",
                      "Instagram may already contain this post. Verify the account and preserve this record before taking another action."
                    )}
                  </p>
                </Surface>
              )}

              {confirmingStop ? (
                <Surface variant="inset" className="border-rose-line bg-rose-soft p-3">
                  <p className="font-cakemono text-heading font-light uppercase text-rose">
                    {t("confirm.title", "STOP THIS POST?")}
                  </p>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {t(
                      "confirm.body",
                      "This removes it from the launch rail. The audit record stays intact."
                    )}
                  </p>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button variant="secondary" onClick={() => setConfirmingStop(false)}>
                      {t("action.keep", "KEEP POST")}
                    </Button>
                    <Button
                      variant="destructive"
                      loading={action.isPending}
                      onClick={() => run({ action: "cancel" }, t("feedback.stopped", "POST STOPPED."))}
                    >
                      {t("action.confirmStop", "CONFIRM STOP")}
                    </Button>
                  </div>
                </Surface>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selected.status === "review" && (
                    <Button
                      variant="primary"
                      loading={action.isPending}
                      onClick={() =>
                        run(
                          { action: "publish_now" },
                          t("feedback.published", "PUBLISH COMMAND ACCEPTED.")
                        )
                      }
                    >
                      {t("action.publish", "PUBLISH NOW")}
                    </Button>
                  )}
                  {canManuallyRetrySocialPost(selected) && (
                    <Button
                      variant="primary"
                      loading={action.isPending}
                      onClick={() =>
                        run(
                          { action: "retry" },
                          t("feedback.retry", "RETRY COMMAND ACCEPTED.")
                        )
                      }
                    >
                      {t("action.retry", "RETRY NOW")}
                    </Button>
                  )}
                  {canEditOrStop && (
                    <>
                      <Button variant="secondary" onClick={() => setEditing(true)}>
                        {t("action.edit", "EDIT COPY")}
                      </Button>
                      <Button variant="destructive" onClick={() => setConfirmingStop(true)}>
                        {t("action.stop", "STOP")}
                      </Button>
                    </>
                  )}
                  {selected.status === "published" && selected.instagram_permalink && (
                    <Button asChild variant="secondary">
                      <a href={selected.instagram_permalink} target="_blank" rel="noreferrer">
                        {t("action.openInstagram", "OPEN ON INSTAGRAM")}
                        <ExternalLink className="h-icon-16 w-icon-16" aria-hidden="true" />
                      </a>
                    </Button>
                  )}
                  {selected.status === "published" && (
                    <span className="self-center font-mono text-micro uppercase text-olive">
                      {t("control.locked", "LOCKED AFTER PUBLISH")}
                    </span>
                  )}
                  {selected.status === "cancelled" && (
                    <span className="self-center font-mono text-micro uppercase text-text-mute">
                      {t("control.cancelled", "POST STOPPED")}
                    </span>
                  )}
                </div>
              )}

              {feedback && (
                <p className="font-mono text-micro uppercase text-olive" role="status">
                  {feedback}
                </p>
              )}

              <div className="border-t border-line pt-3">
                <p className="font-mono text-micro uppercase tracking-wide text-text-mute">
                  {t("control.audit", "AUDIT TRAIL")}
                </p>
                {selected.audit_log.length === 0 ? (
                  <p className="mt-1 font-mono text-micro uppercase text-text-mute">
                    {t("control.noAudit", "NO AUDIT EVENTS")}
                  </p>
                ) : (
                  <ol className="mt-2 flex flex-col gap-2">
                    {[...selected.audit_log].reverse().slice(0, 8).map((event, index) => (
                      <li key={`${event.at}-${event.event}-${index}`} className="border-l border-line-hi pl-2">
                        <p className="font-mono text-micro uppercase text-text-2">
                          {humanize(event.event)}
                        </p>
                        <p className="mt-px font-mono text-micro tabular-nums text-text-mute">
                          {dateTime(event.at)} · {event.actor}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
