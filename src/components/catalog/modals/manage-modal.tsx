"use client";

/**
 * Catalog "// MANAGE" modal — categories, tags, units, and category-level
 * threshold defaults (the cascade's admin surface). One dialog, four tabs.
 * All mutations gate on inventory.manage at the kebab; this renders the
 * authoring controls.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  useCatalogCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCatalogTags,
  useCreateTag,
  useDeleteTag,
  useCatalogUnits,
  useCreateUnit,
  useDeleteUnit,
} from "@/lib/hooks/use-catalog-meta";

export type ManageTab = "categories" | "tags" | "units" | "thresholds";

const TABS: ManageTab[] = ["categories", "tags", "units", "thresholds"];

export function ManageModal({
  tab,
  onTabChange,
  onClose,
}: {
  tab: ManageTab;
  onTabChange: (t: ManageTab) => void;
  onClose: () => void;
}) {
  const { t } = useDictionary("catalog");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-[18px] font-light uppercase tracking-[0.02em] text-text">
            {t(`manage.${tab}.title`, "// MANAGE")}
          </DialogTitle>
        </DialogHeader>

        <div className="mb-3 inline-flex gap-[2px] rounded-[6px] border border-border p-[3px]">
          {TABS.map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => onTabChange(tb)}
              className={cn(
                "rounded-[4px] px-[12px] py-[5px] font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                tb === tab
                  ? "bg-surface-active text-text"
                  : "text-text-3 hover:bg-surface-hover hover:text-text-2",
              )}
            >
              {t(`kebab.${tb === "thresholds" ? "thresholdDefaults" : tb}`, tb)}
            </button>
          ))}
        </div>

        {tab === "categories" && <CategoriesPanel />}
        {tab === "tags" && <TagsPanel />}
        {tab === "units" && <UnitsPanel />}
        {tab === "thresholds" && <ThresholdsPanel />}
      </DialogContent>
    </Dialog>
  );
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.05)] py-1.5 last:border-b-0">
      {children}
    </div>
  );
}

// ─── Categories ────────────────────────────────────────────────────────────────

function CategoriesPanel() {
  const { t } = useDictionary("catalog");
  const { data: categories = [] } = useCatalogCategories();
  const create = useCreateCategory();
  const del = useDeleteCategory();
  const [name, setName] = useState("");

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("manage.name", "Name")}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              create.mutate({ name }, { onSuccess: () => setName("") });
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!name.trim()}
          onClick={() => create.mutate({ name }, { onSuccess: () => setName("") })}
        >
          <Plus className="h-[14px] w-[14px]" />
        </Button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {categories.map((c) => (
          <RowShell key={c.id}>
            <span className="flex-1 font-mohave text-[14px] text-text">{c.name}</span>
            <button
              type="button"
              onClick={() => {
                if (confirm(t("manage.deleteConfirm", { name: c.name }))) del.mutate(c.id);
              }}
              className="rounded p-1 text-text-mute transition-colors hover:bg-rose-soft hover:text-rose"
            >
              <Trash2 className="h-[14px] w-[14px]" />
            </button>
          </RowShell>
        ))}
      </div>
    </div>
  );
}

// ─── Tags ────────────────────────────────────────────────────────────────────

function TagsPanel() {
  const { t } = useDictionary("catalog");
  const { data: tags = [] } = useCatalogTags();
  const create = useCreateTag();
  const del = useDeleteTag();
  const [name, setName] = useState("");

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("manage.name", "Name")}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              create.mutate(name, { onSuccess: () => setName("") });
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!name.trim()}
          onClick={() => create.mutate(name, { onSuccess: () => setName("") })}
        >
          <Plus className="h-[14px] w-[14px]" />
        </Button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {tags.length === 0 ? (
          <p className="py-4 font-mono text-[11px] text-text-mute">{"// NO TAGS"}</p>
        ) : (
          tags.map((tag) => (
            <RowShell key={tag.id}>
              <span className="flex-1 font-mohave text-[14px] text-text">{tag.name}</span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("manage.deleteConfirm", { name: tag.name }))) del.mutate(tag.id);
                }}
                className="rounded p-1 text-text-mute transition-colors hover:bg-rose-soft hover:text-rose"
              >
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            </RowShell>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Units ────────────────────────────────────────────────────────────────────

function UnitsPanel() {
  const { t } = useDictionary("catalog");
  const { data: units = [] } = useCatalogUnits();
  const create = useCreateUnit();
  const del = useDeleteUnit();
  const [display, setDisplay] = useState("");

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          placeholder={t("manage.name", "Name")}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && display.trim()) {
              create.mutate({ display, dimension: "count" }, { onSuccess: () => setDisplay("") });
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!display.trim()}
          onClick={() =>
            create.mutate({ display, dimension: "count" }, { onSuccess: () => setDisplay("") })
          }
        >
          <Plus className="h-[14px] w-[14px]" />
        </Button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {units.map((u) => (
          <RowShell key={u.id}>
            <span className="flex-1 font-mohave text-[14px] text-text">{u.display}</span>
            {u.isDefault ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-mute">
                {t("manage.default", "Default")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("manage.deleteConfirm", { name: u.display }))) del.mutate(u.id);
                }}
                className="rounded p-1 text-text-mute transition-colors hover:bg-rose-soft hover:text-rose"
              >
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            )}
          </RowShell>
        ))}
      </div>
    </div>
  );
}

// ─── Threshold defaults (per category) ─────────────────────────────────────────

function ThresholdsPanel() {
  const { t } = useDictionary("catalog");
  const { data: categories = [] } = useCatalogCategories();
  const update = useUpdateCategory();

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          {t("manage.name", "Name")}
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
          {t("manage.warn", "Warn")}
        </span>
        <span className="w-[72px] text-right font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
          {t("manage.critical", "Critical")}
        </span>
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {categories.map((c) => (
          <RowShell key={c.id}>
            <span className="flex-1 font-mohave text-[14px] text-text">{c.name}</span>
            <input
              type="number"
              defaultValue={c.defaultWarningThreshold ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() === "" ? null : Number(e.target.value);
                if (v !== c.defaultWarningThreshold)
                  update.mutate({ id: c.id, patch: { defaultWarningThreshold: v } });
              }}
              className="w-[72px] rounded-[5px] border border-border bg-surface-input px-2 py-1 text-right font-mono text-[12px] text-text tabular-nums focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
            />
            <input
              type="number"
              defaultValue={c.defaultCriticalThreshold ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() === "" ? null : Number(e.target.value);
                if (v !== c.defaultCriticalThreshold)
                  update.mutate({ id: c.id, patch: { defaultCriticalThreshold: v } });
              }}
              className="w-[72px] rounded-[5px] border border-border bg-surface-input px-2 py-1 text-right font-mono text-[12px] text-text tabular-nums focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
            />
          </RowShell>
        ))}
      </div>
    </div>
  );
}
