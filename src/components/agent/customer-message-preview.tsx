"use client";

import { useDictionary, useLocale } from "@/i18n/client";
import { CustomerMessagePreviewSchema } from "@/lib/agent-control-plane/contracts/customer-message";

export function CustomerMessagePreview({ proposal }: { proposal: unknown }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const parsed = CustomerMessagePreviewSchema.safeParse(proposal);
  if (!parsed.success) {
    return (
      <p role="alert" className="font-mohave text-body-sm text-rose">
        {t("customerMessage.invalid")}
      </p>
    );
  }
  const preview = parsed.data;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));

  return (
    <section className="space-y-4" aria-label={t("customerMessage.heading")}>
      <div>
        <h3 className="font-cakemono text-body font-light uppercase text-text">
          {t("customerMessage.heading")}
        </h3>
        <p className="font-mohave text-body-sm text-text-2">
          {preview.opportunity.title}
        </p>
      </div>

      <dl className="divide-y divide-border-subtle border-y border-border-subtle">
        <div className="grid gap-1 py-3 sm:grid-cols-4">
          <dt className="font-mono text-micro uppercase text-text-3">
            {t("customerMessage.from")}
          </dt>
          <dd className="break-all font-mono text-caption text-text sm:col-span-3">
            {preview.sender.address}
          </dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-4">
          <dt className="font-mono text-micro uppercase text-text-3">
            {t("customerMessage.to")}
          </dt>
          <dd className="break-all font-mono text-caption text-text sm:col-span-3">
            {preview.recipients.to[0]}
          </dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-4">
          <dt className="font-mono text-micro uppercase text-text-3">
            {t("customerMessage.subject")}
          </dt>
          <dd className="font-mohave text-body-sm text-text sm:col-span-3">
            {preview.message.subject}
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <h4 className="font-mono text-micro uppercase text-text-3">
          {t("customerMessage.message")}
        </h4>
        <p className="bg-surface-panel whitespace-pre-wrap break-words border border-border-subtle p-4 font-mohave text-body-sm text-text">
          {preview.message.body}
        </p>
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-3">
        <h4 className="font-mono text-micro uppercase text-text-3">
          {t("customerMessage.replyingTo")}
        </h4>
        <blockquote className="space-y-1 border-l border-border-subtle pl-3">
          <p className="whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
            {preview.source.excerpt}
          </p>
          <footer className="font-mono text-micro text-text-3">
            {preview.source.sender_identity} ·{" "}
            {stamp(preview.source.delivered_at)}
          </footer>
        </blockquote>
      </div>

      <p className="font-mohave text-body-sm text-text-2">
        {t("customerMessage.effects")}
      </p>
      <p className="font-mono text-micro text-text-3">
        {t("customerMessage.expires")} {stamp(preview.approval.expires_at)}
      </p>
    </section>
  );
}
