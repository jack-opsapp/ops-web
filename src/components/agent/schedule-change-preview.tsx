"use client";

import { ScheduleChangePreviewSchema } from "@/lib/agent-control-plane/contracts/schedule-change";
import { useDictionary, useLocale } from "@/i18n/client";

/** Format a server-sealed civil label without interpreting it in the viewer's zone. */
function civilLabel(value: string, locale: string, dateOnly = false): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" } as const),
  }).format(new Date(`${value}Z`));
}

export function ScheduleChangePreview({ proposal }: { proposal: unknown }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = ScheduleChangePreviewSchema.safeParse(proposal);
  if (!parsed.success) return <p className="font-mohave text-body text-text-2">{t("scheduleChange.unavailable")}</p>;
  const p = parsed.data;
  const scheduleLabel = (value: typeof p.tasks[number]["before"]) => {
    if (!value.all_day) return `${civilLabel(value.local_start, locale)} – ${civilLabel(value.local_end_exclusive, locale)}`;
    const finalDay = new Date(Date.parse(`${value.local_end_exclusive}Z`) - 86_400_000).toISOString().slice(0, 19);
    return value.local_start.slice(0, 10) === finalDay.slice(0, 10)
      ? civilLabel(value.local_start, locale, true)
      : `${civilLabel(value.local_start, locale, true)} – ${civilLabel(finalDay, locale, true)}`;
  };
  return (
    <section className="min-w-0 space-y-3 break-words" aria-label={t("scheduleChange.title")}>
      <div className="space-y-1">
        <h3 className="font-cakemono text-body font-light uppercase text-text">{t("scheduleChange.title")}</h3>
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.timezone")} <span className="font-mono">{p.timezone}</span></p>
      </div>
      <div className="divide-y divide-border-subtle">
        {p.tasks.map(task => (
          <article key={task.task_id} className="space-y-2 py-2">
            <div>
              <h4 className="font-mohave text-body text-text">{task.title}</h4>
              <p className="font-mohave text-body-sm text-text-2">{task.project_name}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["before", "after"] as const).map(side => (
                <div key={side} className="space-y-1">
                  <p className="font-cakemono text-body-sm font-light uppercase text-text-2">{t(`scheduleChange.${side}`)}</p>
                  <p className="font-mono text-body-sm text-text">{scheduleLabel(task[side])}</p>
                  <p className="font-mohave text-body text-text">{task[side].team.map(member => member.name).join(", ") || "—"}</p>
                  {task[side].schedule_confirmed_at && <p className="font-mohave text-body-sm text-text-2">{t("scheduleChange.confirmed")}</p>}
                  {side === "after" && task.before.schedule_confirmed_at && <p className="font-mohave text-body-sm text-text-2">{t("scheduleChange.confirmationCleared")}</p>}
                </div>
              ))}
            </div>
            {task.scopes.length > 0 && (
              <div className="space-y-1">
                <p className="font-cakemono text-body-sm font-light uppercase text-text-2">{t("scheduleChange.scopes")}</p>
                {task.scopes.map(scope => <div key={scope.id} className="font-mohave text-body-sm text-text-2"><p>{scope.name}</p>{scope.note && <p className="whitespace-pre-wrap">{scope.note}</p>}</div>)}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="space-y-2 border-t border-border-subtle pt-2">
        <h4 className="font-cakemono text-body-sm font-light uppercase text-text">{t("scheduleChange.effects")}</h4>
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.internalEffects")}</p>
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.capacityProtection")}</p>
        {p.effects.project_crew.filter(project => JSON.stringify(project.before) !== JSON.stringify(project.after)).map(project => (
          <div key={project.project_id} className="font-mohave text-body text-text-2">
            <p>{t("scheduleChange.projectCrew")} {p.tasks.find(task => task.project_id === project.project_id)?.project_name}</p>
            <p>{project.before.map(member => member.name).join(", ") || "—"} → {project.after.map(member => member.name).join(", ") || "—"}</p>
          </div>
        ))}
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.communicationLimit")}</p>
      </div>
      <div className="space-y-1">
        <h4 className="font-cakemono text-body-sm font-light uppercase text-text">{t("scheduleChange.availability")}</h4>
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.availabilityBasis")}</p>
        <p className="font-mohave text-body text-text-2">{t("scheduleChange.externalLimit")}</p>
      </div>
      <blockquote className="whitespace-pre-wrap border-l border-border-subtle pl-2 font-mohave text-body text-text-2">{p.reason}</blockquote>
      <p className="font-mohave text-body-sm text-text-2">{t("scheduleChange.reversal")}</p>
      <p className="font-mono text-body-sm text-text-2">{t("scheduleChange.expires")} {civilLabel(new Date(p.expires_at).toISOString().slice(0, 19), locale)} UTC</p>
    </section>
  );
}
