"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";
import { useDictionary } from "@/i18n/client";
import {
  useSageBusinessSelectionSession,
  useSelectSageBusiness,
} from "@/lib/hooks/use-accounting";
import { cn } from "@/lib/utils/cn";

interface ConnectedBusiness {
  businessName: string;
  providerEnvironment: "production" | "sandbox";
}

const NO_BUSINESSES: Array<{ id: string; name: string }> = [];

export function SageBusinessSelectionModal({
  open,
  companyId,
  sessionId,
  onClose,
  onConnected,
}: {
  open: boolean;
  companyId: string;
  sessionId: string;
  onClose: () => void;
  onConnected: (business: ConnectedBusiness) => void;
}) {
  const { t } = useDictionary("books");
  const selection = useSageBusinessSelectionSession(companyId, sessionId, open);
  const connect = useSelectSageBusiness();
  const [selectedId, setSelectedId] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const descriptionId = useId();
  const businesses = selection.data?.businesses ?? NO_BUSINESSES;

  useEffect(() => {
    if (!open) {
      setSelectedId("");
      setSaveFailed(false);
      return;
    }
    setSaveFailed(false);
    setSelectedId((current) => {
      if (businesses.some((business) => business.id === current))
        return current;
      return businesses.length === 1 ? businesses[0].id : "";
    });
  }, [open, businesses]);

  const moveSelection = (index: number) => {
    const business = businesses[index];
    if (!business) return;
    setSelectedId(business.id);
    radioRefs.current[index]?.focus();
  };

  const handleRadioKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % businesses.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + businesses.length) % businesses.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = businesses.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    moveSelection(nextIndex);
  };

  const handleConnect = () => {
    if (!selectedId || connect.isPending) return;
    setSaveFailed(false);
    connect.mutate(
      { companyId, sessionId, businessId: selectedId },
      {
        onSuccess: (result) =>
          onConnected({
            businessName: result.businessName,
            providerEnvironment: result.providerEnvironment,
          }),
        onError: () => setSaveFailed(true),
      }
    );
  };

  const requestClose = () => {
    if (connect.isPending) return;
    onClose();
  };

  const loadErrorStatus = (selection.error as { status?: unknown } | null)
    ?.status;
  const hasLoadError = Boolean(selection.error);
  const isEmpty =
    !selection.isLoading && !hasLoadError && businesses.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent
        aria-describedby={descriptionId}
        hideClose
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocusRef.current =
            active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="font-mono text-micro uppercase tracking-authority text-text-3">
              <span className="text-text-mute">{"// "}</span>
              {t("sync.sageBusiness.title")}
            </DialogTitle>
            {selection.data?.providerEnvironment === "sandbox" && (
              <Tag variant="tan">{t("sync.sageBusiness.sandbox")}</Tag>
            )}
          </div>
          <DialogDescription id={descriptionId} className="text-text-2">
            {t("sync.sageBusiness.helper")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-control-40 py-2">
          {selection.isLoading && (
            <div
              className="flex min-h-control-40 items-center gap-1.5 font-mono text-caption-sm text-text-3"
              role="status"
            >
              <Loader2
                aria-hidden
                className="h-icon-16 w-icon-16 animate-spin motion-reduce:animate-none"
              />
              {t("sync.sageBusiness.loading")}
            </div>
          )}

          {(hasLoadError || isEmpty) && (
            <p
              className="border border-rose-line bg-rose-soft p-2 font-mono text-caption-sm leading-relaxed text-rose"
              role="alert"
            >
              {hasLoadError
                ? t(
                    loadErrorStatus === 410
                      ? "sync.sageBusiness.expired"
                      : "sync.sageBusiness.loadFailed"
                  )
                : t("sync.sageBusiness.empty")}
            </p>
          )}

          {!selection.isLoading && !hasLoadError && businesses.length > 0 && (
            <div
              aria-label={t("sync.sageBusiness.groupLabel")}
              className="space-y-1"
              role="radiogroup"
            >
              {businesses.map((business, index) => {
                const selected = business.id === selectedId;
                const tabbable = selected || (!selectedId && index === 0);
                return (
                  <button
                    key={business.id}
                    ref={(node) => {
                      radioRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={tabbable ? 0 : -1}
                    onClick={() => setSelectedId(business.id)}
                    onKeyDown={(event) => handleRadioKeyDown(event, index)}
                    className={cn(
                      "flex min-h-control-40 w-full cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left",
                      "transition-colors duration-150 ease-smooth motion-reduce:transition-none",
                      "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                      selected
                        ? "border-line-hi bg-surface-active"
                        : "border-border hover:bg-surface-hover"
                    )}
                  >
                    <span className="flex h-control-32 w-control-32 shrink-0 items-center justify-center rounded-chip bg-fill-neutral-dim text-text-2">
                      <Building aria-hidden className="h-icon-16 w-icon-16" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mohave text-body-sm font-medium text-text">
                      {business.name}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-icon-16 w-icon-16 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-text" : "border-text-3"
                      )}
                    >
                      {selected && (
                        <span className="h-1 w-1 rounded-full bg-text" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {saveFailed && (
            <p
              className="mt-2 font-mono text-caption-sm text-rose"
              role="alert"
            >
              {t("sync.sageBusiness.saveFailed")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={requestClose}
            disabled={connect.isPending}
          >
            {t("sync.sageBusiness.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={
              !selectedId || selection.isLoading || hasLoadError || isEmpty
            }
            loading={connect.isPending}
          >
            {t("sync.sageBusiness.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
