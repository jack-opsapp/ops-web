"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  Copy,
  MoreVertical,
  Pencil,
  RotateCcw,
  Shield,
  User,
  Users,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { useOpportunityViewActions } from "@/lib/hooks/pipeline-table/use-opportunity-view-actions";
import type {
  OpportunityViewDefinition,
  OpportunityViewMutationErrorCode,
} from "@/lib/types/pipeline-table";
import { cn } from "@/lib/utils/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PipelineViewCreateDialog } from "./pipeline-view-create-dialog";

const OPPORTUNITY_VIEW_NAME_MAX_LENGTH = 60;

type OpportunityViewActions = ReturnType<typeof useOpportunityViewActions>;

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

function MenuCommand({
  children,
  icon,
  onClick,
  destructive = false,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-mohave text-body-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        destructive
          ? "text-rose hover:bg-surface-hover"
          : "text-text-2 hover:bg-surface-hover hover:text-text",
      )}
    >
      <span className="text-text-3 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      {children}
    </button>
  );
}

export function PipelineViewSettingsMenu({
  activeView,
  actions,
  onViewRenamed,
  onViewDuplicated,
  onViewArchived,
  onViewReset,
  onViewShared,
}: {
  activeView: OpportunityViewDefinition | null;
  actions: OpportunityViewActions;
  onViewRenamed: (view: OpportunityViewDefinition) => void;
  onViewDuplicated: (view: OpportunityViewDefinition) => void;
  onViewArchived: (viewId: string) => void;
  onViewReset: (view: OpportunityViewDefinition) => void;
  onViewShared: (view: OpportunityViewDefinition) => void;
}) {
  const { t } = useDictionary("pipeline");
  const inputId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [name, setName] = useState("");
  const [renameErrorKey, setRenameErrorKey] = useState<string | null>(null);
  const [confirmErrorKey, setConfirmErrorKey] = useState<string | null>(null);
  const [menuErrorKey, setMenuErrorKey] = useState<string | null>(null);
  const renameResetRef = useRef(actions.renameView.reset);
  const canArchive = Boolean(activeView && activeView.ownerType !== "company" && !activeView.isDefault);
  const canReset = Boolean(activeView?.isDefault);
  const badgeLabel = activeView?.ownerType === "company"
    ? t("table.views.companyBadge")
    : t("table.views.personalBadge");
  const badgeIcon = activeView?.ownerType === "company" ? (
    <Shield className="h-3.5 w-3.5" />
  ) : (
    <User className="h-3.5 w-3.5" />
  );
  const menuId = useMemo(() => `pipeline-view-menu-${inputId}`, [inputId]);

  useEffect(() => {
    renameResetRef.current = actions.renameView.reset;
  });

  useEffect(() => {
    if (!renameOpen) return;
    setName(activeView?.name ?? "");
    setRenameErrorKey(null);
    renameResetRef.current();
  }, [activeView?.name, renameOpen]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!activeView) {
    return null;
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeView) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setRenameErrorKey("table.views.validationRequired");
      return;
    }
    if (trimmedName.length > OPPORTUNITY_VIEW_NAME_MAX_LENGTH) {
      setRenameErrorKey("table.views.validationTooLong");
      return;
    }

    try {
      const renamedView = await actions.renameView.mutateAsync({
        viewId: activeView.id,
        name: trimmedName,
      });
      onViewRenamed(renamedView);
      setRenameOpen(false);
    } catch (error) {
      setRenameErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
    }
  }

  async function handleArchive() {
    if (!activeView) return;
    try {
      await actions.archiveView.mutateAsync({ viewId: activeView.id });
      onViewArchived(activeView.id);
      setArchiveOpen(false);
    } catch (error) {
      setConfirmErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
    }
  }

  async function handleReset() {
    if (!activeView) return;
    try {
      const resetView = await actions.resetDefaultView.mutateAsync({ viewId: activeView.id });
      onViewReset(resetView);
      setResetOpen(false);
    } catch (error) {
      setConfirmErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
    }
  }

  async function handleShare() {
    if (!activeView) return;
    setOpen(false);
    try {
      const sharedView = await actions.shareViewWithTeam.mutateAsync({ viewId: activeView.id });
      onViewShared(sharedView);
    } catch (error) {
      setMenuErrorKey(viewErrorCopyKey(getMutationErrorCode(error)));
      setOpen(true);
    }
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label={t("table.views.settingsLabel")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            setMenuErrorKey(null);
            setOpen((value) => !value);
          }}
          className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[5px] border border-border text-text-3 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          <MoreVertical className="h-[14px] w-[14px]" strokeWidth={1.5} />
        </button>

        {open ? (
          <div
            id={menuId}
            role="menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            className="glass-dense absolute right-0 top-8 z-[1000] flex w-[220px] flex-col gap-1 rounded-modal border border-border p-1"
          >
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 font-mono text-micro uppercase tracking-wider text-text-3">
              {badgeIcon}
              {badgeLabel}
            </div>
            <MenuCommand
              icon={<Pencil />}
              onClick={() => {
                setOpen(false);
                setRenameErrorKey(null);
                setRenameOpen(true);
              }}
            >
              {t("table.views.rename")}
            </MenuCommand>
            <MenuCommand
              icon={<Copy />}
              onClick={() => {
                setOpen(false);
                setMenuErrorKey(null);
                setDuplicateOpen(true);
              }}
            >
              {t("table.views.duplicate")}
            </MenuCommand>
            {actions.canManageViews ? (
              <MenuCommand icon={<Users />} onClick={handleShare}>
                {t("table.views.shareWithTeam")}
              </MenuCommand>
            ) : null}
            {canReset ? (
              <MenuCommand
                icon={<RotateCcw />}
                onClick={() => {
                  setOpen(false);
                  setConfirmErrorKey(null);
                  setResetOpen(true);
                }}
              >
                {t("table.views.resetToDefaults")}
              </MenuCommand>
            ) : null}
            {canArchive ? (
              <MenuCommand
                icon={<Archive />}
                destructive
                onClick={() => {
                  setOpen(false);
                  setConfirmErrorKey(null);
                  setArchiveOpen(true);
                }}
              >
                {t("table.views.archive")}
              </MenuCommand>
            ) : null}
            {menuErrorKey ? (
              <p role="alert" className="px-2 py-1 font-mono text-micro text-rose">
                {t(menuErrorKey)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="glass-dense max-w-[420px] rounded-modal p-0" hideClose>
          <form onSubmit={handleRename} className="flex flex-col">
            <DialogHeader className="border-b border-border px-3 py-2">
              <DialogTitle className="flex items-center gap-2 font-cakemono text-[18px] font-light uppercase text-text">
                <Pencil className="h-4 w-4" />
                {t("table.views.renameTitle")}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-2 px-3 py-3">
              <label htmlFor={inputId} className="flex flex-col gap-1">
                <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                  {t("table.views.nameLabel")}
                </span>
                <input
                  id={inputId}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setRenameErrorKey(null);
                  }}
                  className="min-h-9 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 font-mohave text-body-sm text-text outline-none placeholder:text-text-3 focus:border-ops-accent"
                />
              </label>
              {renameErrorKey ? (
                <p role="alert" className="font-mono text-micro text-rose">
                  {t(renameErrorKey)}
                </p>
              ) : null}
            </div>

            <DialogFooter className="border-t border-border px-3 py-2">
              <DialogClose
                type="button"
                className="rounded-[5px] px-3 py-1.5 font-cakemono text-[12px] font-light uppercase text-text-3 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              >
                {t("table.views.cancel")}
              </DialogClose>
              <button
                type="submit"
                disabled={actions.renameView.isPending}
                className="rounded-[5px] border border-ops-accent bg-ops-accent px-3 py-1.5 font-cakemono text-[12px] font-light uppercase text-black transition-colors hover:bg-ops-accent-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-40"
              >
                {t("table.views.renameAction")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PipelineViewCreateDialog
        open={duplicateOpen}
        mode="duplicate"
        activeView={activeView}
        actions={actions}
        onOpenChange={setDuplicateOpen}
        onViewCreated={onViewDuplicated}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent className="glass-dense rounded-modal border border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-cakemono text-[18px] font-light uppercase text-text">
              {t("table.views.archiveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("table.views.archiveBody")}</AlertDialogDescription>
            {confirmErrorKey ? (
              <p role="alert" className="font-mono text-micro text-rose">
                {t(confirmErrorKey)}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("table.views.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleArchive();
              }}
              className="border-brick text-rose hover:bg-surface-hover"
            >
              {t("table.views.archiveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="glass-dense rounded-modal border border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-cakemono text-[18px] font-light uppercase text-text">
              {t("table.views.resetTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("table.views.resetBody")}</AlertDialogDescription>
            {confirmErrorKey ? (
              <p role="alert" className="font-mono text-micro text-rose">
                {t(confirmErrorKey)}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("table.views.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleReset();
              }}
              className="border-ops-accent bg-ops-accent text-black hover:bg-ops-accent-hover"
            >
              {t("table.views.resetConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
