"use client";

import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";

export type ConnectEmailProvider = "gmail" | "microsoft365";

/**
 * ConnectEmailMenu — the pipeline banner's CONNECT entry point. One button,
 * two providers: a `glass-dense` popover (app menu convention — see
 * PipelineDetailActionMenu) offering Gmail and Microsoft 365 / Outlook.
 * Opens ABOVE the trigger because the banner is pinned to the viewport's
 * bottom edge. Outside click and Escape close it.
 */
export function ConnectEmailMenu({
  onSelect,
}: {
  onSelect: (provider: ConnectEmailProvider) => void;
}) {
  const { t } = useDictionary("pipeline");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const choose = (provider: ConnectEmailProvider) => {
    setOpen(false);
    onSelect(provider);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        className="gap-[6px]"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Mail className="h-[14px] w-[14px]" />
        {t("email.connect")}
      </Button>

      {open && (
        <div
          role="menu"
          data-keyboard-scope="modal-or-menu"
          aria-label={t("email.connectBanner")}
          className="glass-dense absolute bottom-full right-0 z-10 mb-1 min-w-[220px] rounded-modal border border-border p-1"
        >
          <ProviderItem
            label={t("email.gmail")}
            onClick={() => choose("gmail")}
          />
          <ProviderItem
            label={t("email.outlook")}
            onClick={() => choose("microsoft365")}
          />
        </div>
      )}
    </div>
  );
}

function ProviderItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer select-none items-center gap-[8px] rounded px-[8px] py-[6px] text-left font-mohave text-body-sm text-text-2 transition-colors duration-150 hover:bg-fill-neutral-dim hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ops-accent"
    >
      <Mail className="h-[14px] w-[14px] shrink-0 text-text-3" strokeWidth={1.5} />
      {label}
    </button>
  );
}
