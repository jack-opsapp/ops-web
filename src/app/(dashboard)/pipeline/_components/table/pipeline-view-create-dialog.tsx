"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Copy, FilePlus2, Layers, PanelTop, Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { useOpportunityViewActions } from "@/lib/hooks/pipeline-table/use-opportunity-view-actions";
import type {
  OpportunityViewDefinition,
  OpportunityViewMutationErrorCode,
} from "@/lib/types/pipeline-table";
import { createDefaultOpportunityViewDefinitionInput } from "@/lib/utils/opportunity-view-defaults";
import { cn } from "@/lib/utils/cn";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPPORTUNITY_VIEW_NAME_MAX_LENGTH = 60;

type OpportunityViewActions = ReturnType<typeof useOpportunityViewActions>;
type CreateMode = "create" | "duplicate";
type CreateSource = "current" | "blank";

function formatText(template: string, replacements: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => replacements[key] ?? match);
}

function getMutationErrorCode(error: unknown): OpportunityViewMutationErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === "DUPLICATE_NAME" ||
      code === "PERMISSION_DENIED" ||
      code === "INVALID_INPUT" ||
      code === "UNKNOWN"
    ) {
      return code;
    }
  }
  return "UNKNOWN";
}

function viewErrorCopyKey(code: OpportunityViewMutationErrorCode) {
  switch (code) {
    case "DUPLICATE_NAME":
      return "table.views.errorDuplicateName";
    case "PERMISSION_DENIED":
      return "table.views.errorPermissionDenied";
    case "INVALID_INPUT":
      return "table.views.errorTooComplex";
    case "UNKNOWN":
      return "table.views.errorGeneric";
  }
}

function buildDuplicateName(template: string, viewName: string) {
  const generated = formatText(template, { name: viewName }).trim();
  if (generated.length <= OPPORTUNITY_VIEW_NAME_MAX_LENGTH) return generated;
  return generated.slice(0, OPPORTUNITY_VIEW_NAME_MAX_LENGTH).trim();
}

export function PipelineViewCreateDialog({
  open,
  mode,
  activeView,
  actions,
  onOpenChange,
  onViewCreated,
}: {
  open: boolean;
  mode: CreateMode;
  activeView: OpportunityViewDefinition | null;
  actions: OpportunityViewActions;
  onOpenChange: (open: boolean) => void;
  onViewCreated: (view: OpportunityViewDefinition) => void;
}) {
  const { t } = useDictionary("pipeline");
  const inputId = useId();
  const currentSourceId = useId();
  const blankSourceId = useId();
  const [name, setName] = useState("");
  const [source, setSource] = useState<CreateSource>("current");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const createResetRef = useRef(actions.createPersonalView.reset);
  const duplicateResetRef = useRef(actions.duplicateView.reset);
  const isDuplicateMode = mode === "duplicate";
  const pending = isDuplicateMode
    ? actions.duplicateView.isPending
    : actions.createPersonalView.isPending;

  const title = isDuplicateMode
    ? t("table.views.duplicateTitle")
    : t("table.views.createTitle");

  const generatedName = useMemo(() => {
    if (!activeView) return "";
    return buildDuplicateName(t("table.views.duplicateNameTemplate"), activeView.name);
  }, [activeView, t]);

  useEffect(() => {
    createResetRef.current = actions.createPersonalView.reset;
    duplicateResetRef.current = actions.duplicateView.reset;
  });

  useEffect(() => {
    if (!open) return;
    setName(isDuplicateMode ? generatedName : "");
    setSource("current");
    setErrorKey(null);
    createResetRef.current();
    duplicateResetRef.current();
  }, [generatedName, isDuplicateMode, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setErrorKey("table.views.validationRequired");
      return;
    }

    if (trimmedName.length > OPPORTUNITY_VIEW_NAME_MAX_LENGTH) {
      setErrorKey("table.views.validationTooLong");
      return;
    }

    if (isDuplicateMode) {
      if (!activeView) return;
      try {
        const createdView = await actions.duplicateView.mutateAsync({
          name: trimmedName,
          sourceView: activeView,
        });
        onViewCreated(createdView);
        onOpenChange(false);
      } catch (error) {
        setErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
      }
      return;
    }

    try {
      const createdView = await actions.createPersonalView.mutateAsync(
        source === "current" && activeView
          ? { name: trimmedName, sourceView: activeView }
          : { name: trimmedName, definition: createDefaultOpportunityViewDefinitionInput() },
      );
      onViewCreated(createdView);
      onOpenChange(false);
    } catch (error) {
      setErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dense max-w-[420px] rounded-modal p-0" hideClose>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader className="border-b border-border px-3 py-2">
            <DialogTitle className="flex items-center gap-2 font-cakemono text-cake-display font-light uppercase text-text">
              {isDuplicateMode ? <Copy className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}
              {title}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 px-3 py-3">
            <label className="flex flex-col gap-1" htmlFor={inputId}>
              <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                {t("table.views.nameLabel")}
              </span>
              <span className="flex min-h-9 items-center gap-2 rounded border border-border bg-surface-input px-2 focus-within:border-ops-accent">
                <PanelTop className="h-3.5 w-3.5 shrink-0 text-text-3" />
                <input
                  id={inputId}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setErrorKey(null);
                  }}
                  placeholder={t("table.views.namePlaceholder")}
                  className="min-w-0 flex-1 bg-transparent py-1.5 font-mohave text-body-sm text-text outline-none placeholder:text-text-3"
                />
              </span>
            </label>

            {!isDuplicateMode ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                  {t("table.views.startingPointLabel")}
                </legend>
                <label
                  htmlFor={currentSourceId}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded border px-2 py-2 font-mohave text-body-sm transition-colors",
                    source === "current"
                      ? "border-border bg-surface-active text-text"
                      : "border-border-subtle text-text-2 hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <input
                    id={currentSourceId}
                    type="radio"
                    name="pipeline-view-source"
                    value="current"
                    checked={source === "current"}
                    onChange={() => setSource("current")}
                    className="h-3.5 w-3.5 accent-[var(--text-3)]"
                  />
                  <Layers className="h-3.5 w-3.5 text-text-3" />
                  {t("table.views.cloneCurrent")}
                </label>
                <label
                  htmlFor={blankSourceId}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded border px-2 py-2 font-mohave text-body-sm transition-colors",
                    source === "blank"
                      ? "border-border bg-surface-active text-text"
                      : "border-border-subtle text-text-2 hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <input
                    id={blankSourceId}
                    type="radio"
                    name="pipeline-view-source"
                    value="blank"
                    checked={source === "blank"}
                    onChange={() => setSource("blank")}
                    className="h-3.5 w-3.5 accent-[var(--text-3)]"
                  />
                  <Plus className="h-3.5 w-3.5 text-text-3" />
                  {t("table.views.blankDefault")}
                </label>
              </fieldset>
            ) : null}

            {errorKey ? (
              <p role="alert" className="font-mono text-micro text-rose">
                {t(errorKey)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-3 py-2">
            <DialogClose
              type="button"
              className="rounded px-3 py-1.5 font-cakemono text-cake-button font-light uppercase text-text-3 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              {t("table.views.cancel")}
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-ops-accent bg-ops-accent px-3 py-1.5 font-cakemono text-cake-button font-light uppercase text-black transition-colors hover:bg-ops-accent-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-40"
            >
              {t("table.views.create")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
