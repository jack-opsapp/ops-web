"use client";

import { Fragment } from "react";
import {
  ChecklistFieldSchema,
  SiteVisitWorkflowProposalSchema,
} from "@/lib/agent-control-plane/contracts/site-visit-workflow";
import { useDictionary, useLocale } from "@/i18n/client";

type Data = Record<string, unknown>;
const object = (v: unknown): Data =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {};
const objects = (v: unknown): Data[] => (Array.isArray(v) ? v.map(object) : []);

/** Review only the sealed proposal. Corrections must produce a fresh approval. */
export function SiteVisitChangesPreview({
  proposal,
  expiresAt,
}: {
  proposal: unknown;
  expiresAt: Date | null;
}) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = SiteVisitWorkflowProposalSchema.safeParse(proposal);
  if (!parsed.success)
    return (
      <p className="font-mohave text-body text-text-2">
        {t("siteVisit.unavailable")}
      </p>
    );
  const p = parsed.data;
  const number = new Intl.NumberFormat(locale);
  const label = (key: string) => t(`siteVisit.${key}`);
  const yes = (v: unknown) => label(v === true ? "yes" : "no");
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : "—");
  const value = (raw: unknown, state?: unknown): string => {
    if (state === "unknown" || state === "cleared") return label(String(state));
    const v = object(raw);
    if (typeof v.boolValue === "boolean") return yes(v.boolValue);
    if (typeof v.choice === "string") return label(`choice.${v.choice}`);
    if (typeof v.text === "string") return text(v.text);
    if (Array.isArray(v.artifactIds) && v.artifactIds.length)
      return `${number.format(v.artifactIds.length)} ${label("attachedPhotos")}`;
    if (typeof v.deckDesignId === "string") return label("attachedDeck");
    return "—";
  };
  const time = (raw: unknown, local = false) => {
    if (typeof raw !== "string") return "—";
    const date = new Date(local ? `${raw}Z` : raw);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: date.getUTCSeconds() ? "medium" : "short",
      timeZone: "UTC",
    }).format(date);
  };
  const offset = (minutes: number) =>
    `UTC${minutes < 0 ? "−" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  const beforeOffset =
    p.before &&
    typeof p.before.local_start === "string" &&
    typeof p.before.starts_at === "string"
      ? (Date.parse(`${p.before.local_start}Z`) -
          Date.parse(p.before.starts_at)) /
        60000
      : null;
  const afterOffset = p.appointment
    ? (Date.parse(`${p.appointment.local_start}Z`) -
        Date.parse(p.appointment.starts_at)) /
      60000
    : null;
  const assetLink = (source: Data) => {
    if (typeof source.asset_url !== "string") return null;
    try {
      if (new URL(source.asset_url).protocol !== "https:") return null;
    } catch {
      return null;
    }
    return (
      <a
        href={source.asset_url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mohave text-body text-ops-accent underline focus-visible:outline focus-visible:outline-ops-accent"
      >
        {label("viewAttachment")}
      </a>
    );
  };
  const pair = (name: string, before: string | null, after: string) => (
    <div className="space-y-1">
      <dt className="font-mohave text-body-sm text-text-2">{name}</dt>
      <dd className="space-y-1 font-mono text-body-sm tabular-nums text-text">
        {before !== null && (
          <p>
            <span className="text-text-2">{label("before")}: </span>
            {before}
          </p>
        )}
        <p>
          <span className="text-text-2">{label("after")}: </span>
          {after}
        </p>
      </dd>
    </div>
  );
  const fields = (raw: unknown) =>
    objects(raw)
      .map((f) => ChecklistFieldSchema.safeParse(f))
      .filter((f) => f.success)
      .map((f) => f.data);
  return (
    <section
      className="min-w-0 space-y-3 break-words"
      aria-label={label("title")}
    >
      <header className="space-y-1">
        <h3 className="font-cakemono text-body-sm font-light uppercase text-text">
          {label(`operation.${p.operation}`)}
        </h3>
        {p.lead_title && (
          <p className="font-mohave text-body text-text">{p.lead_title}</p>
        )}
        {p.entity === "answer" && p.visit_context && (
          <div className="space-y-1">
            <p className="font-mohave text-body text-text">
              {p.visit_context.title || label("visit")}
            </p>
            {p.visit_context.address && (
              <p className="font-mohave text-body-sm text-text-2">
                {p.visit_context.address}
              </p>
            )}
            <p className="font-mono text-body-sm tabular-nums text-text-2">
              {time(p.visit_context.local_start, true)} ·{" "}
              {p.visit_context.timezone} ·{" "}
              {offset(p.visit_context.utc_offset_minutes)}
            </p>
            <p className="font-mono text-body-sm text-text-2">
              {label("visitReference")}: {p.site_visit_id}
            </p>
          </div>
        )}
        <p className="font-mohave text-body-sm text-text-2">
          {label("reviewNotice")}
        </p>
      </header>
      {p.appointment && (
        <dl className="space-y-2">
          {pair(
            label("appointment"),
            p.before
              ? `${time(p.before.local_start, true)} · ${text(p.before.timezone)}${beforeOffset !== null ? ` · ${offset(beforeOffset)}` : ""}`
              : null,
            `${time(p.appointment.local_start, true)} · ${p.appointment.timezone} · ${offset(afterOffset!)}`
          )}
          {pair(
            label("duration"),
            p.before
              ? `${number.format(Number(p.before.duration_minutes))} ${label("minutes")}`
              : null,
            `${number.format(p.appointment.duration_minutes)} ${label("minutes")}`
          )}
          {pair(
            label("crew"),
            p.before
              ? Array.isArray(p.before.assignee_ids)
                ? p.before.assignee_ids
                    .map(
                      (id) =>
                        objects(p.before?.crew).find((c) => c.id === id)
                          ?.name || label("previousCrewMember")
                    )
                    .join(", ")
                : "—"
              : null,
            p.appointment.crew
              .map((c) => c.name || label("unnamedCrewMember"))
              .join(", ") || "—"
          )}
          {pair(
            label("reminder"),
            p.before
              ? p.before.reminder_lead_minutes == null
                ? label("reminderDefaults")
                : `${number.format(Number(p.before.reminder_lead_minutes))} ${label("minutesBefore")}`
              : null,
            p.appointment.reminder_lead_minutes === null
              ? label("reminderDefaults")
              : `${number.format(p.appointment.reminder_lead_minutes)} ${label("minutesBefore")}`
          )}
          {p.operation === "cancel" && (
            <p className="font-mohave text-body text-text">
              {label("cancellation")}
            </p>
          )}
        </dl>
      )}
      {p.availability && (
        <div className="space-y-1 font-mohave text-body-sm text-text-2">
          <p>{label("externalUnknown")}</p>
          {p.availability.warnings.map((w) => (
            <p key={w}>{label(w)}</p>
          ))}
          {p.availability.conflicts.map((c) => (
            <p key={`${c.kind}:${c.id}`}>
              {label(`conflict.${c.kind}`)}:{" "}
              {label(`conflictReason.${c.reason}`)}
            </p>
          ))}
        </div>
      )}
      <div className="divide-y divide-border-subtle">
        {p.rows.map((row) => (
          <article key={row.id} className="space-y-2 py-2">
            <h4 className="font-mohave text-body text-text">
              {text(
                p.entity === "template" ? row.values.name : row.values.label
              )}
            </h4>
            {p.entity === "template" ? (
              <>
                <dl className="space-y-2">
                  {pair(
                    label("name"),
                    row.before ? text(row.before.name) : null,
                    text(row.values.name)
                  )}
                  {pair(
                    label("checklistKey"),
                    row.before ? text(row.before.slug) : null,
                    text(row.values.slug)
                  )}
                  {pair(
                    label("description"),
                    row.before ? text(row.before.description_text) : null,
                    text(row.values.description_text)
                  )}
                  {pair(
                    label("default"),
                    row.before ? yes(row.before.is_default) : null,
                    yes(row.values.is_default)
                  )}
                  {pair(
                    label("checklistOrder"),
                    row.before
                      ? number.format(Number(row.before.sort_order ?? 0))
                      : null,
                    number.format(Number(row.values.sort_order ?? 0))
                  )}
                </dl>
                <div className="space-y-2">
                  {fields(row.values.fields)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((field) => {
                      const previous = fields(row.before?.fields).find(
                        (f) => f.id === field.id
                      );
                      const definition = (f: typeof field) =>
                        `${f.label} · ${label(`kind.${f.kind}`)} · ${label(f.required ? "required" : "optional")} · ${label(f.isVisible === false ? "hidden" : "visible")} · ${label("order")} ${number.format(f.sortOrder)}`;
                      return (
                        <dl key={field.id} className="space-y-1">
                          {pair(
                            label("field"),
                            previous ? definition(previous) : null,
                            definition(field)
                          )}
                          {(field.helpText || previous?.helpText) &&
                            pair(
                              label("help"),
                              previous ? text(previous.helpText) : null,
                              text(field.helpText)
                            )}
                        </dl>
                      );
                    })}
                  {fields(row.before?.fields)
                    .filter(
                      (f) =>
                        !fields(row.values.fields).some((n) => n.id === f.id)
                    )
                    .map((f) => (
                      <p
                        key={f.id}
                        className="font-mohave text-body-sm text-text-2"
                      >
                        {label("removed")}: {f.label}
                      </p>
                    ))}
                </div>
              </>
            ) : (
              <>
                <p className="font-mohave text-body-sm text-text-2">
                  {label(`kind.${String(row.values.kind)}`)} ·{" "}
                  {label(row.values.required ? "required" : "optional")}
                </p>
                {p.operation === "select_checklist" && (
                  <>
                    <p className="font-mono text-body-sm tabular-nums text-text-2">
                      {label("order")}:{" "}
                      {number.format(Number(row.values.sort_order))}
                    </p>
                    {typeof row.values.help_text === "string" && (
                      <p className="font-mohave text-body-sm text-text-2">
                        {text(row.values.help_text)}
                      </p>
                    )}
                  </>
                )}
                <dl>
                  {pair(
                    label("answer"),
                    row.before
                      ? value(row.before.answer_value, row.before.answer_state)
                      : null,
                    value(row.values.answer_value, row.values.answer_state)
                  )}
                </dl>
                {row.before?.evidence_redacted === true && (
                  <p className="font-mohave text-body-sm text-text-2">
                    {label("earlierEvidenceHidden")}
                  </p>
                )}
                {typeof object(row.values.answer_evidence).reason ===
                  "string" && (
                  <p className="font-mohave text-body text-text">
                    {text(object(row.values.answer_evidence).reason)}
                  </p>
                )}
                {objects(object(row.values.answer_evidence).evidence).map(
                  (e, index) => (
                    <div key={index} className="space-y-1">
                      <p className="font-mono text-body-sm tabular-nums text-text-2">
                        {label("source")}{" "}
                        {number.format(Number(e.source_index) + 1)}
                      </p>
                      {e.reference_only === true ? (
                        <>
                          <p className="font-mohave text-body text-text">
                            {label("existingAttachment")}
                          </p>
                          {assetLink(p.sources[Number(e.source_index)] ?? {})}
                        </>
                      ) : (
                        <blockquote className="whitespace-pre-wrap font-mohave text-body text-text">
                          {text(e.quote)}
                        </blockquote>
                      )}
                    </div>
                  )
                )}
                {objects(object(row.values.answer_evidence).uncertainty).map(
                  (u, index) => (
                    <div key={index} className="space-y-1">
                      <p className="font-mohave text-body text-text">
                        {label("uncertain")}: {text(u.reason)}
                      </p>
                      {objects(u.evidence).map((e, i) => (
                        <blockquote
                          key={i}
                          className="whitespace-pre-wrap font-mohave text-body-sm text-text-2"
                        >
                          {text(e.quote)}
                        </blockquote>
                      ))}
                    </div>
                  )
                )}
              </>
            )}
          </article>
        ))}
      </div>
      {p.missing_required.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-cakemono text-body-sm font-light uppercase text-text-2">
            {label("missing")}
          </h4>
          <ul className="space-y-1 font-mohave text-body text-text">
            {p.missing_required.map((f) => (
              <li key={f.answer_id}>{f.label}</li>
            ))}
          </ul>
        </div>
      )}
      {p.sources.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer font-cakemono text-body-sm font-light uppercase text-text-2 focus-visible:outline focus-visible:outline-ops-accent">
            {label("sourceNotes")}
          </summary>
          {p.sources.map((s, index) => (
            <Fragment key={index}>
              <h4 className="font-mono text-body-sm tabular-nums text-text-2">
                {label("source")} {number.format(index + 1)} ·{" "}
                {label(
                  s.kind === "operator_notes"
                    ? "operatorNotes"
                    : `sourceKind.${String(s.artifact_kind)}`
                )}
              </h4>
              <p className="whitespace-pre-wrap font-mohave text-body text-text">
                {text(s.text)}
              </p>
              {assetLink(s)}
            </Fragment>
          ))}
        </details>
      )}
      <footer className="space-y-1 font-mohave text-body-sm text-text-2">
        {p.entity === "appointment" && (
          <p>
            {label(
              p.effects.calendar_intent === "queued"
                ? "calendarQueued"
                : "calendarNotRequested"
            )}
          </p>
        )}
        <p>{label("physicalBoundary")}</p>
        <p>{label("noCustomerMessages")}</p>
        {expiresAt && (
          <p className="font-mono text-body-sm tabular-nums">
            {label("expires")}: {time(expiresAt.toISOString())} UTC
          </p>
        )}
      </footer>
    </section>
  );
}
