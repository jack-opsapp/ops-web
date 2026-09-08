"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod-v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDictionary, useLocale } from "@/i18n/client";
import { authedFetch } from "@/lib/utils/authed-fetch";
import {
  FinancialPolicyInputSchema,
  FinancialPolicyPreviewSchema,
  FinancialPolicyReadinessSchema,
  FinancialPolicyReceiptSchema,
  type FinancialPolicyInput,
} from "@/lib/agent-control-plane/contracts/financial-policy";

type Readiness = z.infer<typeof FinancialPolicyReadinessSchema>;
type Preview = z.infer<typeof FinancialPolicyPreviewSchema>;
type Receipt = z.infer<typeof FinancialPolicyReceiptSchema>;
const priceSources = ["catalog", "historical_line", "operator"] as const;

/** Human owner setup. Source evidence is text; it never supplies executable instructions. */
export function FinancialPolicyPanel({ sourceId }: { sourceId?: string }) {
  const { t } = useDictionary("agent-queue");
  const { locale } = useLocale();
  const [ready, setReady] = useState<Readiness | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoke, setRevoke] = useState(false);
  const [revision, setRevision] = useState("");
  const [terms, setTerms] = useState("");
  const [units, setUnits] = useState("");
  const [sources, setSources] = useState<
    FinancialPolicyInput["permitted_price_sources"]
  >([]);
  // A synchronous latch prevents duplicate actions before React commits busy state.
  const pending = useRef(false);
  const request = useCallback(
    async (body?: unknown) => {
      const response = await authedFetch(
        `/api/agent/financial-policy${body === undefined && sourceId ? `?source=${encodeURIComponent(sourceId)}` : ""}`,
        body === undefined
          ? { cache: "no-store" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
      );
      const data: unknown = await response.json();
      if (!response.ok) throw new Error("FINANCIAL_POLICY_UNAVAILABLE");
      return data;
    },
    [sourceId]
  );
  useEffect(() => {
    let current = true;
    setReady(null);
    setPreview(null);
    setReceipt(null);
    setError(null);
    setRevoke(false);
    request()
      .then((data) => {
        if (current) setReady(FinancialPolicyReadinessSchema.parse(data));
      })
      .catch(() => {
        if (current) setError("financialPolicy.unavailable");
      });
    return () => {
      current = false;
    };
  }, [request]);

  async function act(action: "preview" | "enroll" | "revoke") {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === "preview") {
        if (!ready.source) return;
        const policy = FinancialPolicyInputSchema.parse({
          revision,
          terms,
          currency_code: ready.currency_code,
          source_document_id: ready.source.id,
          source_sha256: ready.source.sha256,
          expected_policy_sha256: ready.policy?.sha256 ?? null,
          permitted_units: units.split(",").map((unit) => unit.trim()),
          permitted_price_sources: sources,
        });
        const result = FinancialPolicyPreviewSchema.parse(
          await request({ action, policy })
        );
        setPreview(result);
        setReceipt(null);
      } else {
        if (
          (action === "enroll" && !preview) ||
          (action === "revoke" && !ready.policy)
        )
          return;
        const result = FinancialPolicyReceiptSchema.parse(
          await request(
            action === "enroll"
              ? {
                  action,
                  preview_id: preview!.preview_id,
                  preview_sha256: preview!.preview_sha256,
                }
              : {
                  action,
                  policy_id: ready.policy!.id,
                  policy_sha256: ready.policy!.sha256,
                }
          )
        );
        setReceipt(result);
        setPreview(null);
        setRevoke(false);
        // Preserve the durable receipt even if the independent refresh is unavailable.
        setReady(null);
        try {
          setReady(FinancialPolicyReadinessSchema.parse(await request()));
        } catch {
          setError("financialPolicy.refreshRequired");
        }
      }
    } catch (e) {
      setError(
        e instanceof z.ZodError && action === "preview"
          ? "financialPolicy.invalid"
          : "financialPolicy.retry"
      );
      // Keep the exact sealed preview for an uncertain enrollment response.
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const source = preview?.source ?? ready?.source;
  return (
    <section className="space-y-3 text-body text-text" aria-busy={busy}>
      <header className="space-y-1">
        <h1 className="font-cakemono text-heading font-light uppercase">
          {t("financialPolicy.title")}
        </h1>
        <p className="text-text-2">{t("financialPolicy.scope")}</p>
        {ready && (
          <p className="text-text-2">
            {ready.company_name} · {ready.operator_name}
          </p>
        )}
      </header>
      {error && (
        <p role="alert" className="text-rose">
          {t(error)}
        </p>
      )}
      {receipt && (
        <div
          role="status"
          className="space-y-1 rounded border border-border-subtle p-2"
        >
          <p>
            {t(
              receipt.operation === "enroll"
                ? "financialPolicy.enrolled"
                : "financialPolicy.revoked"
            )}
          </p>
          <p className="break-all font-mono text-body-sm">
            {receipt.revision} · {receipt.policy_id}
          </p>
          <p className="text-text-2">{t("financialPolicy.receiptScope")}</p>
        </div>
      )}
      {!ready && !error && !receipt && (
        <p role="status">{t("financialPolicy.loading")}</p>
      )}
      {ready && (
        <>
          {ready.policy && (
            <div className="flex flex-wrap items-center gap-2">
              <p>
                {t("financialPolicy.current")}{" "}
                <span className="font-mono">{ready.policy.revision}</span>
              </p>
              {!preview && !revoke && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRevoke(true)}
                >
                  {t("financialPolicy.revoke")}
                </Button>
              )}
            </div>
          )}
          {revoke && (
            <div className="space-y-2 rounded border border-border-subtle p-2">
              <p>{t("financialPolicy.revokeConfirm")}</p>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void act("revoke")}
                >
                  {t("financialPolicy.confirmRevoke")}
                </Button>
                <Button disabled={busy} onClick={() => setRevoke(false)}>
                  {t("financialPolicy.cancel")}
                </Button>
              </div>
            </div>
          )}
          {ready.blockers.length > 0 && (
            <ul className="space-y-1 text-text-2">
              {ready.blockers.map((block) => (
                <li key={block}>{t(`financialPolicy.block.${block}`)}</li>
              ))}
            </ul>
          )}
          <p className="text-body-sm text-text-3">
            {t("financialPolicy.hostGate")}
          </p>
          {source ? (
            <div className="space-y-1 rounded border border-border-subtle p-2">
              <h2 className="font-cakemono font-light uppercase">
                {t("financialPolicy.source")}
              </h2>
              <blockquote className="whitespace-pre-wrap break-words">
                {source.content}
              </blockquote>
              <details className="text-body-sm text-text-3">
                <summary>{t("financialPolicy.provenance")}</summary>
                <p className="break-all font-mono">{source.id}</p>
                <p className="break-all font-mono">{source.sha256}</p>
              </details>
            </div>
          ) : (
            <p>{t("financialPolicy.noSource")}</p>
          )}
          {!revoke && source && !preview && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void act("preview");
              }}
            >
              <Input
                label={t("financialPolicy.revision")}
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
                maxLength={80}
                required
                disabled={busy}
                autoComplete="off"
              />
              <p>
                {t("financialPolicy.currency")}{" "}
                <span className="font-mono">{ready.currency_code ?? "—"}</span>
              </p>
              <Textarea
                label={t("financialPolicy.terms")}
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                maxLength={8000}
                required
                disabled={busy}
              />
              <Input
                label={t("financialPolicy.units")}
                helperText={t("financialPolicy.unitsHelp")}
                value={units}
                onChange={(event) => setUnits(event.target.value)}
                required
                disabled={busy}
              />
              <fieldset className="space-y-1" disabled={busy}>
                <legend className="text-text-2">
                  {t("financialPolicy.prices")}
                </legend>
                {priceSources.map((kind) => (
                  <label key={kind} className="flex items-center gap-1 py-1">
                    <input
                      type="checkbox"
                      checked={sources.includes(kind)}
                      onChange={(event) =>
                        setSources((previous) =>
                          event.target.checked
                            ? [...previous, kind]
                            : previous.filter((value) => value !== kind)
                        )
                      }
                    />
                    {t(`financialPolicy.price.${kind}`)}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" variant="primary" disabled={busy}>
                {t("financialPolicy.preview")}
              </Button>
            </form>
          )}
          {preview && (
            <div className="space-y-2 rounded border border-border-subtle p-2">
              <h2 className="font-cakemono font-light uppercase">
                {t("financialPolicy.review")}
              </h2>
              <p>
                {preview.company_name} · {preview.operator_name}
              </p>
              <p className="font-mono">
                {preview.policy.revision} · {preview.policy.currency_code}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {preview.policy.terms}
              </p>
              <p>
                {t("financialPolicy.units")}{" "}
                <span className="font-mono">
                  {preview.policy.permitted_units.join(", ")}
                </span>
              </p>
              <p>
                {preview.policy.permitted_price_sources
                  .map((kind) => t(`financialPolicy.price.${kind}`))
                  .join(" · ")}
              </p>
              <p>
                {preview.tax.name}{" "}
                <span className="font-mono tabular-nums">
                  {new Intl.NumberFormat(locale, {
                    style: "percent",
                    maximumFractionDigits: 4,
                  }).format(Number(preview.tax.rate))}
                </span>
              </p>
              <p>
                {t("financialPolicy.expires")}{" "}
                <span className="font-mono">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(preview.expires_at))}
                </span>
              </p>
              <p className="text-text-2">{t("financialPolicy.exactReview")}</p>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void act("enroll")}
                >
                  {t("financialPolicy.enroll")}
                </Button>
                <Button disabled={busy} onClick={() => setPreview(null)}>
                  {t("financialPolicy.edit")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
