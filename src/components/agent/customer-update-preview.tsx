"use client";
import { CustomerUpdatePreviewSchema } from "@/lib/agent-control-plane/contracts/customer-update";
import { useDictionary, useLocale } from "@/i18n/client";
export function CustomerUpdatePreview({ proposal }: { proposal: unknown }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = CustomerUpdatePreviewSchema.safeParse(proposal);
  if (!parsed.success)
    return (
      <p role="alert" className="font-mohave text-body-sm text-rose">
        {t("customerUpdate.invalid")}
      </p>
    );
  const { before, after, evidence, effects, expires_at } = parsed.data;
  const stamp = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          ...(new Date(v).getMilliseconds()
            ? { fractionalSecondDigits: 3 as const }
            : {}),
          timeZoneName: "short",
        }).format(new Date(v))
      : "—";
  const owner = (name: string | null, id: string | null) =>
    id ? `${name ?? "—"} · ${id}` : null;
  const rows = [
    ["title", before.title, after.title],
    ["description", before.description, after.description],
    [
      "owner",
      owner(before.assigned_name, before.assigned_to),
      owner(after.assigned_name, after.assigned_to),
    ],
    [
      "followUp",
      stamp(before.next_follow_up_at),
      stamp(after.next_follow_up_at),
    ],
    ...(after.customer
      ? [["notes", before.customer?.notes ?? null, after.customer.notes]]
      : []),
  ].filter(([, oldValue, newValue]) => oldValue !== newValue);
  return (
    <section className="space-y-3" aria-label={t("customerUpdate.heading")}>
      <div>
        <h3 className="font-cakemono text-body font-light uppercase text-text">
          {t("customerUpdate.heading")}
        </h3>
        <p className="font-mohave text-body-sm text-text-2">
          {before.title}
          {before.customer ? ` · ${before.customer.name}` : ""}
        </p>
      </div>
      <dl className="divide-y divide-border-subtle">
        {rows.map(([key, oldValue, newValue]) => (
          <div key={key} className="space-y-1 py-2">
            <dt className="font-mono text-micro uppercase text-text-3">
              {t(`customerUpdate.${key}`)}
            </dt>
            <dd className="space-y-1">
              <p className="whitespace-pre-wrap break-words font-mohave text-body-sm text-text-3">
                <span className="font-mono text-micro">
                  {t("customerUpdate.before")}{" "}
                </span>
                <span
                  className={
                    key === "followUp" || key === "owner"
                      ? "font-mono tabular-nums"
                      : undefined
                  }
                >
                  {oldValue || "—"}
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words font-mohave text-body-sm text-text">
                <span className="font-mono text-micro">
                  {t("customerUpdate.after")}{" "}
                </span>
                <span
                  className={
                    key === "followUp" || key === "owner"
                      ? "font-mono tabular-nums"
                      : undefined
                  }
                >
                  {newValue || "—"}
                </span>
              </p>
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-3 border-t border-border-subtle pt-3">
        <h4 className="font-mono text-micro uppercase text-text-3">
          {t("customerUpdate.evidence")}
        </h4>
        {evidence.map((item, i) => (
          <blockquote
            key={i}
            className="space-y-1 border-l border-border-subtle pl-3"
          >
            <p className="whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
              {item.text}
            </p>
            <footer className="font-mono text-micro text-text-3">
              {t(
                item.kind === "correspondence"
                  ? "customerUpdate.correspondence"
                  : "customerUpdate.statement"
              )}
              {item.activity_id ? ` · ${item.activity_id}` : ""}
            </footer>
          </blockquote>
        ))}
      </div>
      <p className="font-mohave text-body-sm text-text-2">
        {t("customerUpdate.effects")}
        {effects.assignments_changed === 1
          ? ` ${t("customerUpdate.assignmentEffects")}`
          : ""}
      </p>
      <p className="font-mono text-micro text-text-3">
        {t("customerUpdate.expires")} {stamp(expires_at)}
      </p>
    </section>
  );
}
