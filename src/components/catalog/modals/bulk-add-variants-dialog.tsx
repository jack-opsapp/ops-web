"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDictionary } from "@/i18n/client";
import { CatalogBulkVariantRpcError } from "@/lib/api/services/catalog-bulk-variant-service";
import {
  buildBulkVariantExpansionRequest,
  normalizeBulkVariantText,
  planBulkVariantExpansion,
  type BulkVariantBlockerCode,
  type BulkVariantExpansionPreview,
  type BulkVariantFamilyPlan,
  type BulkVariantOptionSelection,
} from "@/lib/catalog/bulk-variant-expansion";
import {
  useCatalogBulkVariantFamilies,
  useExpandCatalogVariants,
} from "@/lib/hooks/use-catalog-bulk-variants";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";

type Stage = "families" | "change" | "review";

interface Draft {
  stage: Stage;
  selectedFamilyIds: string[];
  axisName: string;
  existingValue: string;
  newValues: string[];
  idempotencyKey: string;
}

interface WorkflowError {
  key: string;
  params?: Record<string, unknown>;
}

const EMPTY_DRAFT: Omit<Draft, "idempotencyKey"> = {
  stage: "families",
  selectedFamilyIds: [],
  axisName: "",
  existingValue: "",
  newValues: [""],
};

const labelClass =
  "font-mono text-[11px] uppercase tracking-[0.14em] text-text-3";
const stepOrder: Stage[] = ["families", "change", "review"];

function newRequestKey(): string {
  return crypto.randomUUID().toLowerCase();
}

function draftKey(companyId: string): string {
  return `ops:catalog:bulk-variants:${companyId}`;
}

function readDraft(companyId: string): Draft {
  const empty = { ...EMPTY_DRAFT, idempotencyKey: newRequestKey() };
  if (!companyId) return empty;
  try {
    const raw = localStorage.getItem(draftKey(companyId));
    if (!raw) return empty;
    const saved = JSON.parse(raw) as Partial<Draft>;
    if (!stepOrder.includes(saved.stage as Stage)) return empty;
    return {
      stage: saved.stage as Stage,
      selectedFamilyIds: Array.isArray(saved.selectedFamilyIds)
        ? saved.selectedFamilyIds.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
      axisName: typeof saved.axisName === "string" ? saved.axisName : "",
      existingValue:
        typeof saved.existingValue === "string" ? saved.existingValue : "",
      newValues:
        Array.isArray(saved.newValues) && saved.newValues.length > 0
          ? saved.newValues
              .filter((value): value is string => typeof value === "string")
              .slice(0, 20)
          : [""],
      idempotencyKey:
        typeof saved.idempotencyKey === "string"
          ? saved.idempotencyKey
          : newRequestKey(),
    };
  } catch {
    return empty;
  }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function familyIssueKey(code: BulkVariantBlockerCode): string {
  const keys: Partial<Record<BulkVariantBlockerCode, string>> = {
    no_active_variants: "bulkVariants.family.disabled.noActiveVariants",
    duplicate_option_axis: "bulkVariants.family.disabled.duplicateOptionAxis",
    duplicate_option_value: "bulkVariants.family.disabled.duplicateOptionValue",
    unknown_option_value: "bulkVariants.family.disabled.unknownOptionValue",
    incomplete_variant_options:
      "bulkVariants.family.disabled.incompleteVariantOptions",
    multiple_values_for_option:
      "bulkVariants.family.disabled.multipleValuesForOption",
    duplicate_variant_signature:
      "bulkVariants.family.disabled.duplicateVariantSignature",
  };
  return keys[code] ?? "bulkVariants.error.familyUnsafe";
}

function previewError(
  preview: BulkVariantExpansionPreview
): WorkflowError | null {
  const first = preview.blockers[0];
  if (!first) return null;
  const keys: Partial<Record<BulkVariantBlockerCode, string>> = {
    axis_name_required: "bulkVariants.error.axisRequired",
    existing_value_required: "bulkVariants.error.existingRequired",
    new_value_required: "bulkVariants.error.newRequired",
    too_many_new_values: "bulkVariants.error.tooManyValues",
    duplicate_new_value: "bulkVariants.error.duplicateValue",
    new_value_matches_existing: "bulkVariants.error.noOpValue",
    no_variants_to_add: "bulkVariants.error.noVariants",
  };
  return { key: keys[first.code] ?? "bulkVariants.error.familyUnsafe" };
}

function selectionText(selections: BulkVariantOptionSelection[]): string {
  return selections
    .map((selection) => `${selection.optionName}: ${selection.value}`)
    .join(" · ");
}

function Metric({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface-input px-3 py-2 font-mono text-[12px] tabular-nums text-text">
      {children}
    </div>
  );
}

function FamilyReview({ plan }: { plan: BulkVariantFamilyPlan }) {
  const { t } = useDictionary("catalog");
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded border border-border bg-surface-input">
      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
        aria-expanded={open}
        aria-label={
          open
            ? t("bulkVariants.review.collapse", { name: plan.familyName })
            : t("bulkVariants.review.expand", { name: plan.familyName })
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className="block font-mohave text-body text-text">
            {plan.familyName}
          </span>
          <span className="block font-mono text-[11px] text-text-3">
            {plan.newVariants.length}{" "}
            {t("bulkVariants.review.after", "CREATES")}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-text-3 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          data-testid="bulk-variant-family-review"
          className="border-t border-border px-3 py-2"
        >
          <div className="space-y-3">
            {plan.combinationChanges.map((change) => (
              <div
                key={change.sourceVariantId}
                className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              >
                <div>
                  <p className={labelClass}>
                    {t("bulkVariants.review.before", "EXISTING")}
                  </p>
                  <p className="font-mono text-[11px] text-text-3">
                    {t("bulkVariants.review.sourceSku", {
                      sku:
                        change.sourceSku ??
                        t("bulkVariants.review.noSku", "NO SKU"),
                    })}
                  </p>
                  <p className="mt-1 font-mohave text-body-sm text-text">
                    {selectionText(change.before) || "—"}
                  </p>
                </div>
                <div>
                  <p className={labelClass}>
                    {t("bulkVariants.review.after", "CREATES")}
                  </p>
                  <div className="mt-1 space-y-1">
                    {change.after.map((selections) => (
                      <p
                        key={selectionText(selections)}
                        className="font-mohave text-body-sm text-text"
                      >
                        {selectionText(selections)}
                      </p>
                    ))}
                    {change.skipped.map((selections) => (
                      <p
                        key={selectionText(selections)}
                        className="font-mohave text-body-sm text-text-3 line-through"
                      >
                        {selectionText(selections)} ·{" "}
                        {t("bulkVariants.review.exists", "ALREADY EXISTS")}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function BulkAddVariantsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useDictionary("catalog");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const [draft, setDraft] = useState<Draft>(() => readDraft(companyId));
  const [search, setSearch] = useState("");
  const [workflowError, setWorkflowError] = useState<WorkflowError | null>(
    null
  );
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const applyStartedRef = useRef(false);
  const online = useOnline();
  const familiesQuery = useCatalogBulkVariantFamilies();
  const expand = useExpandCatalogVariants();
  const records = useMemo(() => familiesQuery.data ?? [], [familiesQuery.data]);

  const selectedRecords = useMemo(() => {
    const selected = new Set(draft.selectedFamilyIds);
    return records.filter(
      (record) => selected.has(record.snapshot.id) && !record.issue
    );
  }, [draft.selectedFamilyIds, records]);
  const preview = useMemo(
    () =>
      planBulkVariantExpansion({
        axisName: draft.axisName,
        existingValue: draft.existingValue,
        newValues: draft.newValues,
        families: selectedRecords.map((record) => record.snapshot),
      }),
    [draft.axisName, draft.existingValue, draft.newValues, selectedRecords]
  );
  const normalizedSearch = normalizeBulkVariantText(search);
  const visible = useMemo(
    () =>
      records.filter(
        (record) =>
          !normalizedSearch ||
          normalizeBulkVariantText(record.searchText).includes(normalizedSearch)
      ),
    [normalizedSearch, records]
  );
  const visibleSafeIds = visible
    .filter((record) => !record.issue)
    .map((record) => record.snapshot.id);
  const safeCount = records.filter((record) => !record.issue).length;

  useEffect(() => {
    if (!companyId) return;
    localStorage.setItem(draftKey(companyId), JSON.stringify(draft));
  }, [companyId, draft]);

  useEffect(() => {
    if (!records.length) return;
    const safe = new Set(
      records
        .filter((record) => !record.issue)
        .map((record) => record.snapshot.id)
    );
    setDraft((current) => {
      const selectedFamilyIds = current.selectedFamilyIds.filter((id) =>
        safe.has(id)
      );
      return selectedFamilyIds.length === current.selectedFamilyIds.length
        ? current
        : { ...current, selectedFamilyIds, stage: "families" };
    });
  }, [records]);

  useEffect(() => {
    if (draft.stage === "families") return;
    stageHeadingRef.current?.focus();
  }, [draft.stage]);

  function setStage(stage: Stage) {
    setWorkflowError(null);
    setDraft((current) => ({ ...current, stage }));
  }

  function toggleFamily(id: string) {
    setDraft((current) => ({
      ...current,
      selectedFamilyIds: current.selectedFamilyIds.includes(id)
        ? current.selectedFamilyIds.filter((currentId) => currentId !== id)
        : [...current.selectedFamilyIds, id],
      idempotencyKey: newRequestKey(),
    }));
  }

  function toggleVisible() {
    const selected = new Set(draft.selectedFamilyIds);
    const allSelected =
      visibleSafeIds.length > 0 &&
      visibleSafeIds.every((id) => selected.has(id));
    setDraft((current) => ({
      ...current,
      selectedFamilyIds: allSelected
        ? current.selectedFamilyIds.filter((id) => !visibleSafeIds.includes(id))
        : Array.from(
            new Set([...current.selectedFamilyIds, ...visibleSafeIds])
          ),
      idempotencyKey: newRequestKey(),
    }));
  }

  function changeDraft(
    patch: Partial<Pick<Draft, "axisName" | "existingValue" | "newValues">>
  ) {
    setWorkflowError(null);
    setDraft((current) => ({
      ...current,
      ...patch,
      idempotencyKey: newRequestKey(),
    }));
  }

  function review() {
    const error = previewError(preview);
    if (error) {
      setWorkflowError(error);
      return;
    }
    setStage("review");
  }

  async function apply() {
    if (
      !online ||
      !preview.canApply ||
      expand.isPending ||
      applyStartedRef.current
    )
      return;
    applyStartedRef.current = true;
    setWorkflowError(null);
    try {
      await expand.mutateAsync(
        buildBulkVariantExpansionRequest({
          companyId,
          idempotencyKey: draft.idempotencyKey,
          preview,
        })
      );
      localStorage.removeItem(draftKey(companyId));
      onClose();
    } catch (error) {
      applyStartedRef.current = false;
      const code =
        error instanceof CatalogBulkVariantRpcError
          ? error.code
          : "transport_error";
      if (code === "stale_catalog") {
        await familiesQuery.refetch();
        setWorkflowError({ key: "bulkVariants.error.stale" });
      } else if (code === "idempotency_conflict") {
        setDraft((current) => ({
          ...current,
          idempotencyKey: newRequestKey(),
        }));
        setWorkflowError({ key: "bulkVariants.error.idempotency" });
      } else if (code === "permission_denied" || code === "company_forbidden") {
        setWorkflowError({ key: "bulkVariants.error.permission" });
      } else if (code === "transport_error") {
        setWorkflowError({ key: "bulkVariants.error.transport" });
      } else {
        setWorkflowError({ key: "bulkVariants.error.rejected" });
      }
    }
  }

  function discard() {
    localStorage.removeItem(draftKey(companyId));
    setDraft({ ...EMPTY_DRAFT, idempotencyKey: newRequestKey() });
    setSearch("");
    setWorkflowError(null);
    onClose();
  }

  const stageTitle = t(
    `bulkVariants.stage.${draft.stage}`,
    draft.stage.toUpperCase()
  );
  const hasDraft =
    draft.selectedFamilyIds.length > 0 ||
    Boolean(
      draft.axisName || draft.existingValue || draft.newValues.some(Boolean)
    );
  const allVisibleSelected =
    visibleSafeIds.length > 0 &&
    visibleSafeIds.every((id) => draft.selectedFamilyIds.includes(id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hideClose
        aria-describedby="bulk-variant-dialog-description"
        className="flex h-[min(760px,calc(100dvh-32px))] w-[calc(100vw-32px)] max-w-[880px] flex-col overflow-hidden p-0"
      >
        <header className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
                {t("bulkVariants.title", "Bulk add variants")}
              </DialogTitle>
              <p
                id="bulk-variant-dialog-description"
                className="mt-0.5 font-mohave text-body-sm text-text-2"
              >
                {t(
                  "bulkVariants.subtitle",
                  "Add one real option across existing stock families."
                )}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("bulkVariants.close", "Close bulk add variants")}
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav
            aria-label={t("bulkVariants.title", "Bulk add variants")}
            className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border"
          >
            {stepOrder.map((stage, index) => {
              const active = draft.stage === stage;
              const reached = stepOrder.indexOf(draft.stage) >= index;
              return (
                <div
                  key={stage}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "bg-surface-panel px-2 py-2 text-center font-mono text-[11px] tracking-[0.14em] text-text-3",
                    reached && "text-text",
                    active && "bg-surface-hover"
                  )}
                >
                  <span className="mr-1.5 tabular-nums text-text-mute">
                    0{index + 1}
                  </span>
                  {t(`bulkVariants.stage.${stage}`, stage.toUpperCase())}
                </div>
              );
            })}
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div
            key={draft.stage}
            className="motion-safe:animate-fade-in motion-reduce:animate-none"
          >
            <h2
              ref={stageHeadingRef}
              tabIndex={-1}
              className="mb-3 font-cakemono text-[16px] font-light uppercase tracking-[0.04em] text-text focus:outline-none"
            >
              {stageTitle}
            </h2>

            {draft.stage === "families" && (
              <div className="space-y-3">
                <Input
                  type="search"
                  role="searchbox"
                  autoFocus
                  aria-label={t(
                    "bulkVariants.families.search",
                    "Search families"
                  )}
                  placeholder={t(
                    "bulkVariants.families.searchPlaceholder",
                    "Family, category, option or value…"
                  )}
                  prefixIcon={<Search />}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[11px] tabular-nums text-text-3">
                    {t("bulkVariants.families.selected", {
                      selected: draft.selectedFamilyIds.length,
                      safe: safeCount,
                    })}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={visibleSafeIds.length === 0}
                    onClick={toggleVisible}
                  >
                    {allVisibleSelected
                      ? t("bulkVariants.families.clearAll", "CLEAR VISIBLE")
                      : t(
                          "bulkVariants.families.selectAll",
                          "SELECT ALL VISIBLE"
                        )}
                  </Button>
                </div>

                {familiesQuery.isLoading ? (
                  <div className="rounded border border-border px-3 py-8 text-center font-mono text-[11px] text-text-3">
                    {t("bulkVariants.loading", "READING CURRENT FAMILIES…")}
                  </div>
                ) : familiesQuery.isError ? (
                  <div
                    role="alert"
                    className="rounded border border-rose-line bg-rose-soft px-3 py-3"
                  >
                    <p className="font-mohave text-body text-rose">
                      {t(
                        "bulkVariants.families.loadError",
                        "Families could not be read safely."
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => familiesQuery.refetch()}
                    >
                      {t("bulkVariants.action.retry", "RETRY")}
                    </Button>
                  </div>
                ) : visible.length === 0 ? (
                  <div className="rounded border border-border px-3 py-8 text-center font-mono text-[11px] text-text-3">
                    {t(
                      "bulkVariants.families.noResults",
                      "NO MATCHING FAMILIES"
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded border border-border">
                    {visible.map((record) => {
                      const disabled = Boolean(record.issue);
                      const selected = draft.selectedFamilyIds.includes(
                        record.snapshot.id
                      );
                      const descriptionId = `bulk-family-${record.snapshot.id}-description`;
                      return (
                        <label
                          key={record.snapshot.id}
                          className={cn(
                            "flex min-h-12 items-start gap-3 bg-surface-input px-3 py-2 transition-colors",
                            disabled
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer hover:bg-surface-hover"
                          )}
                        >
                          <Checkbox
                            checked={selected}
                            disabled={disabled}
                            aria-label={`${record.snapshot.name}${record.categoryName ? `, ${record.categoryName}` : ""}`}
                            aria-describedby={descriptionId}
                            onCheckedChange={() =>
                              toggleFamily(record.snapshot.id)
                            }
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-mohave text-body text-text">
                              {record.snapshot.name}
                            </span>
                            <span
                              id={descriptionId}
                              className="mt-0.5 block font-mono text-[11px] text-text-3"
                            >
                              {record.categoryName ?? "—"} ·{" "}
                              {t("bulkVariants.families.variantCount", {
                                n: record.snapshot.variants.length,
                              })}
                            </span>
                            {record.issue && (
                              <span className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ops-amber">
                                <AlertTriangle
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                {t(
                                  familyIssueKey(record.issue.code),
                                  "Unsafe family"
                                )}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {draft.stage === "change" && (
              <div className="space-y-4">
                <p className="max-w-[640px] font-mohave text-body text-text-2">
                  {t(
                    "bulkVariants.change.intro",
                    "Name the option, identify the current source value, then add up to 20 new values."
                  )}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label={t("bulkVariants.change.axisName", "Option name")}
                    placeholder={t(
                      "bulkVariants.change.axisPlaceholder",
                      "Top profile"
                    )}
                    value={draft.axisName}
                    onChange={(event) =>
                      changeDraft({ axisName: event.target.value })
                    }
                  />
                  <Input
                    label={t(
                      "bulkVariants.change.existingValue",
                      "Existing value"
                    )}
                    placeholder={t(
                      "bulkVariants.change.existingPlaceholder",
                      "Round top"
                    )}
                    value={draft.existingValue}
                    onChange={(event) =>
                      changeDraft({ existingValue: event.target.value })
                    }
                  />
                </div>
                <section>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className={labelClass}>
                      {t("bulkVariants.change.newValues", "New values")}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-text-3">
                      {t("bulkVariants.change.valueLimit", {
                        n: draft.newValues.length,
                      })}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {draft.newValues.map((value, index) => (
                      <div key={index} className="flex items-end gap-2">
                        <Input
                          label={t("bulkVariants.change.newValue", {
                            n: index + 1,
                          })}
                          aria-label={t("bulkVariants.change.newValue", {
                            n: index + 1,
                          })}
                          placeholder={t(
                            "bulkVariants.change.newPlaceholder",
                            "Flat top"
                          )}
                          value={value}
                          onChange={(event) => {
                            const next = [...draft.newValues];
                            next[index] = event.target.value;
                            changeDraft({ newValues: next });
                          }}
                          className="w-full"
                        />
                        {draft.newValues.length > 1 && (
                          <button
                            type="button"
                            aria-label={t("bulkVariants.change.removeValue", {
                              n: index + 1,
                            })}
                            className="mb-px inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-rose-soft hover:text-rose focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
                            onClick={() =>
                              changeDraft({
                                newValues: draft.newValues.filter(
                                  (_, valueIndex) => valueIndex !== index
                                ),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    disabled={draft.newValues.length >= 20}
                    onClick={() =>
                      changeDraft({ newValues: [...draft.newValues, ""] })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    {t("bulkVariants.change.addValue", "ADD VALUE")}
                  </Button>
                </section>
              </div>
            )}

            {draft.stage === "review" && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric>
                    {preview.familyCount === 1
                      ? t("bulkVariants.review.family.one", "1 FAMILY")
                      : t("bulkVariants.review.family.many", {
                          n: preview.familyCount,
                        })}
                  </Metric>
                  <Metric>
                    {preview.existingVariantAssignmentCount === 1
                      ? t(
                          "bulkVariants.review.existing.one",
                          "1 EXISTING VARIANT LABELLED"
                        )
                      : t("bulkVariants.review.existing.many", {
                          n: preview.existingVariantAssignmentCount,
                        })}
                  </Metric>
                  <Metric>
                    {preview.newVariantCount === 1
                      ? t("bulkVariants.review.new.one", "1 NEW VARIANT")
                      : t("bulkVariants.review.new.many", {
                          n: preview.newVariantCount,
                        })}
                  </Metric>
                  <Metric>
                    {draft.axisName} · {draft.newValues.join(", ")}
                  </Metric>
                </div>
                <div className="rounded border border-border bg-surface-input px-3 py-2">
                  <p className="font-mohave text-body text-text">
                    {t(
                      "bulkVariants.review.preservation",
                      "Existing IDs, stock, SKU, history and joins stay unchanged."
                    )}
                  </p>
                  <p className="mt-1 font-mohave text-body-sm text-text-2">
                    {t(
                      "bulkVariants.review.newDefaults",
                      "New variants start at 0 with blank SKUs. Safe settings carry forward."
                    )}
                  </p>
                  {preview.skippedExistingCombinationCount > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-text-3">
                      {t("bulkVariants.review.skipped", {
                        n: preview.skippedExistingCombinationCount,
                      })}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  {preview.familyPlans.map((plan) => (
                    <FamilyReview key={plan.familyId} plan={plan} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="bg-surface-panel shrink-0 border-t border-border px-4 py-3">
          {(workflowError || !online) && (
            <div
              role="status"
              className={cn(
                "mb-2 flex items-center gap-2 rounded border px-3 py-2 font-mono text-[11px]",
                workflowError
                  ? "border-rose-line bg-rose-soft text-rose"
                  : "border-ops-amber/30 bg-ops-amber/15 text-ops-amber"
              )}
            >
              {!online && (
                <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {workflowError
                ? t(workflowError.key, workflowError.params)
                : t(
                    "bulkVariants.offline",
                    "OFFLINE — DRAFT SAVED ON THIS DEVICE"
                  )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {hasDraft && (
                <Button variant="ghost" size="sm" onClick={discard}>
                  {t("bulkVariants.action.discard", "DISCARD DRAFT")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {draft.stage === "families" ? (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {t("bulkVariants.action.cancel", "CANCEL")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setStage(draft.stage === "review" ? "change" : "families")
                  }
                >
                  {t("bulkVariants.action.back", "BACK")}
                </Button>
              )}
              {draft.stage === "families" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    draft.selectedFamilyIds.length === 0 ||
                    familiesQuery.isLoading
                  }
                  onClick={() => setStage("change")}
                >
                  {t("bulkVariants.action.next", "NEXT")}
                </Button>
              )}
              {draft.stage === "change" && (
                <Button variant="primary" size="sm" onClick={review}>
                  {t("bulkVariants.action.review", "REVIEW")}
                </Button>
              )}
              {draft.stage === "review" && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={expand.isPending}
                  disabled={!online || !preview.canApply}
                  onClick={apply}
                >
                  {t("bulkVariants.action.apply", "APPLY")}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
