"use client";

import { ChangeEvent, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, FileUp, Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { parseCsv, type ParsedSheet } from "@/lib/catalog-setup/csv-parse";
import { parseXlsx } from "@/lib/catalog-setup/xlsx-parse";

interface PreviewRow {
  rowNumber: number;
  status: "matched" | "needs_input";
  normalizedData: Record<string, unknown>;
  proposedStockUnit: Record<string, unknown> | null;
  issues: Array<{ code: string; message: string }>;
}

interface PreviewResult {
  importId: string;
  status: "review" | "complete";
  summary: {
    rows: number;
    matched: number;
    needsInput: number;
    defaultLocation?: string;
  };
  rows: PreviewRow[];
}

async function idToken(expiredMessage: string): Promise<string> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const value = await getIdToken();
  if (!value) throw new Error(expiredMessage);
  return value;
}

async function responseJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; blockers?: Array<{ message?: string }> })
    | null;
  if (!response.ok || !body) {
    const blocker = body?.blockers?.[0]?.message;
    throw new Error(blocker ?? body?.error ?? fallbackMessage);
  }
  return body;
}

export function InventoryImportRoute() {
  const { t } = useDictionary("catalog-setup");
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = usePermissionStore((state) => state.can);
  const [location, setLocation] = useState(
    searchParams.get("location") ||
      t("inventoryImport.defaultLocation", "Main Shop"),
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeCount, setCompleteCount] = useState<number | null>(null);

  const readFile = useCallback(async (file: File): Promise<ParsedSheet> => {
    const lower = file.name.toLocaleLowerCase("en-CA");
    if (lower.endsWith(".csv") || file.type.includes("csv")) {
      return parseCsv(await file.text());
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      return parseXlsx(await file.arrayBuffer());
    }
    throw new Error(
      t(
        "inventoryImport.invalidFile",
        "Use a CSV or Excel inventory list.",
      ),
    );
  }, [t]);

  const upload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        setError(
          t(
            "inventoryImport.tooLarge",
            "Keep the inventory list under 8 MB.",
          ),
        );
        return;
      }
      setBusy(true);
      setError(null);
      setPreview(null);
      try {
        const sheet = await readFile(file);
        if (sheet.rows.length === 0) {
          throw new Error(
            t(
              "inventoryImport.empty",
              "The inventory list has no rows.",
            ),
          );
        }
        const response = await fetch(
          "/api/catalog/setup/inventory/preview",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: await idToken(
                t(
                  "inventoryImport.sessionExpired",
                  "Your session has expired. Sign in again.",
                ),
              ),
              setupSessionId: searchParams.get("sessionId"),
              sourceName: file.name,
              sourceMimeType: file.type,
              defaultLocation: location,
              sheet,
            }),
          },
        );
        const result = await responseJson<PreviewResult>(
          response,
          t(
            "inventoryImport.importError",
            "Inventory import failed.",
          ),
        );
        setFilename(file.name);
        setPreview(result);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : t(
                "inventoryImport.readError",
                "Inventory list could not be read.",
              ),
        );
      } finally {
        setBusy(false);
      }
    },
    [location, readFile, searchParams, t],
  );

  const commit = useCallback(async () => {
    if (!preview || preview.summary.needsInput > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/catalog/setup/inventory/${preview.importId}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: await idToken(
              t(
                "inventoryImport.sessionExpired",
                "Your session has expired. Sign in again.",
              ),
            ),
          }),
        },
      );
      const result = await responseJson<{ committed: number }>(
        response,
        t(
          "inventoryImport.commitError",
          "Inventory could not be added.",
        ),
      );
      setCompleteCount(result.committed);
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : t(
              "inventoryImport.commitError",
              "Inventory could not be added.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, preview, t]);

  if (!can("catalog.run_setup") || !can("inventory.manage")) {
    return (
      <div
        data-testid="inventory-import-denied"
        className="px-4 py-6 font-mono text-micro uppercase tracking-wide text-text-3"
      >
        {"// "}
        {t("denied", "NO ACCESS")}
      </div>
    );
  }

  if (completeCount != null) {
    return (
      <section
        data-testid="inventory-import-complete"
        className="mx-auto flex min-h-96 max-w-3xl flex-col justify-center px-5"
      >
        <span className="font-mono text-micro uppercase tracking-wide text-success">
          {"// "}
          {t("inventoryImport.completeKicker", "INVENTORY VERIFIED")}
        </span>
        <h1 className="mt-3 font-cakemono text-cake-title font-light uppercase text-text">
          {t("inventoryImport.completeTitle", "STOCK IS ON FILE")}
        </h1>
        <p className="mt-3 font-mohave text-body text-text-2">
          {t(
            "inventoryImport.completeBody",
            "{count} physical stock records were added and matched to your catalog.",
          ).replace("{count}", String(completeCount))}
        </p>
        <button
          type="button"
          onClick={() => router.push("/catalog?segment=stock")}
          className="mt-6 w-fit rounded border border-ops-accent px-3 py-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black"
        >
          {t("inventoryImport.open", "OPEN INVENTORY")}
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6">
      <header className="border-b border-glass-border pb-4">
        <span className="font-mono text-micro uppercase tracking-wide text-text-3">
          {"// "}
          {t("inventoryImport.kicker", "OPENING INVENTORY")}
        </span>
        <h1 className="mt-2 font-cakemono text-cake-title font-light uppercase text-text">
          {t("inventoryImport.title", "ADD YOUR CURRENT STOCK")}
        </h1>
        <p className="mt-2 max-w-prose font-mohave text-body text-text-2">
          {t(
            "inventoryImport.body",
            "Upload a CSV or Excel list. I’ll match each row to the catalog first; nothing is added until you review it.",
          )}
        </p>
      </header>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-glass-border bg-glass-fill px-4 text-center transition-colors hover:border-ops-accent md:col-span-2">
          {busy ? (
            <Loader2
              aria-hidden
              className="h-5 w-5 animate-spin text-ops-accent"
            />
          ) : (
            <FileUp aria-hidden className="h-5 w-5 text-text-3" />
          )}
          <span className="mt-3 font-cakemono text-cake-button uppercase text-text">
            {busy
              ? t("inventoryImport.reading", "READING LIST")
              : t("inventoryImport.upload", "UPLOAD INVENTORY LIST")}
          </span>
          <span className="mt-1 font-mono text-micro text-text-3">
            {t("inventoryImport.formats", "[ CSV or Excel · up to 8 MB ]")}
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            disabled={busy}
            onChange={(event) => void upload(event)}
            className="sr-only"
          />
        </label>

        <label className="glass-surface flex flex-col justify-center p-4">
          <span className="font-mono text-micro uppercase tracking-wide text-text-3">
            {t("inventoryImport.location", "DEFAULT LOCATION")}
          </span>
          <input
            value={location}
            disabled={busy}
            onChange={(event) => setLocation(event.target.value)}
            className="mt-3 h-11 rounded border border-glass-border bg-glass-fill px-3 font-mohave text-body text-text outline-none transition-colors focus:border-ops-accent"
          />
          <span className="mt-2 font-mono text-micro text-text-mute">
            {t(
              "inventoryImport.locationHint",
              "[ used when a row has no location ]",
            )}
          </span>
        </label>
      </div>

      {error ? (
        <p className="mt-4 font-mono text-micro text-danger">{error}</p>
      ) : null}

      {preview ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-glass-border pb-3">
            <div>
              <div className="font-cakemono text-cake-section font-light uppercase text-text">
                {filename}
              </div>
              <div className="mt-1 font-mono text-micro text-text-3">
                {t(
                  "inventoryImport.summary",
                  "{matched} matched · {needs} need input",
                )
                  .replace("{matched}", String(preview.summary.matched))
                  .replace(
                    "{needs}",
                    String(preview.summary.needsInput),
                  )}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || preview.summary.needsInput > 0}
              onClick={() => void commit()}
              className="inline-flex min-h-11 items-center gap-2 rounded border border-ops-accent px-4 font-cakemono text-cake-button uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:border-glass-border disabled:text-text-mute"
            >
              {busy ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : null}
              {t("inventoryImport.commit", "ADD INVENTORY")}
            </button>
          </div>

          {preview.summary.needsInput > 0 ? (
            <p className="mt-3 font-mono text-micro text-warning">
              {"// "}
              {t(
                "inventoryImport.fix",
                "Add the missing color, thickness, item name, or SKU to the flagged rows, then upload again.",
              )}
            </p>
          ) : null}

          <div className="mt-3 overflow-hidden rounded border border-glass-border">
            {preview.rows.slice(0, 100).map((row) => (
              <div
                key={row.rowNumber}
                className="flex items-center gap-3 border-b border-glass-border px-3 py-2 last:border-b-0"
              >
                <span className="w-10 shrink-0 font-mono text-micro tabular-nums text-text-mute">
                  {row.rowNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mohave text-body text-text">
                    {String(row.normalizedData.item ?? "—")}
                    {row.normalizedData.color
                      ? ` · ${String(row.normalizedData.color)}`
                      : ""}
                  </div>
                  {row.issues[0] ? (
                    <div className="font-mono text-micro text-warning">
                      {t(
                        `inventoryImport.issue.${row.issues[0].code}`,
                        row.issues[0].message,
                      )}
                    </div>
                  ) : (
                    <div className="font-mono text-micro text-text-3">
                      {String(
                        row.proposedStockUnit?.location ?? location,
                      )}
                    </div>
                  )}
                </div>
                <span
                  className={
                    row.status === "matched"
                      ? "shrink-0 text-success"
                      : "shrink-0 font-mono text-micro uppercase text-warning"
                  }
                >
                  {row.status === "matched" ? (
                    <Check
                      aria-label={t(
                        "inventoryImport.matched",
                        "Matched",
                      )}
                      className="h-4 w-4"
                    />
                  ) : (
                    t("inventoryImport.needsInput", "NEEDS INPUT")
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => router.push("/catalog")}
        className="mt-6 font-mono text-micro text-text-3 transition-colors hover:text-text"
      >
        {t("guided.exit", "[ back to catalog ]")}
      </button>
    </section>
  );
}

export default InventoryImportRoute;
