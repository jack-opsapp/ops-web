"use client";

import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { useProjectCanvasStore } from "./project-canvas-store";

interface ProjectDragConfirmationProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProjectDragConfirmation({
  open,
  onConfirm,
  onCancel,
}: ProjectDragConfirmationProps) {
  const { t } = useDictionary("projects-canvas");
  const setFirstDragConfirmed = useProjectCanvasStore((s) => s.setFirstDragConfirmed);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-[4px] p-6 max-w-[400px] w-full mx-4"
        style={{
          background: "rgba(20,20,20,0.95)",
          backdropFilter: "blur(20px) saturate(1.2)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-mohave text-body font-medium text-text mb-2">
          {t("drag.confirmTitle")}
        </h3>
        <p className="font-mohave text-body-sm text-text-2 mb-4 leading-relaxed">
          {t("drag.confirmMessage")}
        </p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-4 h-4 rounded-[2px] border border-[rgba(255,255,255,0.15)] bg-transparent accent-[#597794]"
          />
          <span className="font-mohave text-body-sm text-text-3">
            {t("drag.dontShowAgain")}
          </span>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-panel font-mohave text-body-sm text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (dontShowAgain) setFirstDragConfirmed();
              onConfirm();
            }}
            className="px-4 py-2 rounded-panel font-mohave text-body-sm text-text bg-[rgba(89,119,148,0.2)] hover:bg-[rgba(89,119,148,0.3)] border border-[rgba(89,119,148,0.3)] transition-colors duration-150"
          >
            {t("drag.confirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
