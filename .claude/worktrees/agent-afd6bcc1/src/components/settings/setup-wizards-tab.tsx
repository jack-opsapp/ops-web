"use client";

import { Wrench, CheckCircle, Circle } from "lucide-react";
import { useTaskTypes } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { useRouter } from "next/navigation";

export function SetupWizardsTab() {
  const { t } = useDictionary("settings");
  const router = useRouter();
  const { data: taskTypes = [] } = useTaskTypes();
  const activeCount = taskTypes.filter((tt: any) => !tt.deletedAt).length;
  const isComplete = activeCount > 0;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-mohave text-heading-sm text-text-primary uppercase tracking-wide">
          {t("setup.title")}
        </h2>
        <p className="font-kosugi text-body-sm text-text-secondary mt-[4px]">
          {t("setup.description")}
        </p>
      </div>

      <button
        onClick={() => router.push("/settings?tab=task-types")}
        className="w-full flex items-center gap-3 p-3 rounded-md border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-all text-left"
      >
        <Wrench className="w-[20px] h-[20px] text-text-disabled shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-mohave text-body text-text-primary">{t("setup.taskTypes.title")}</h3>
          <p className="font-kosugi text-caption-sm text-text-tertiary">{t("setup.taskTypes.description")}</p>
        </div>
        <div className="flex items-center gap-[6px] shrink-0">
          {isComplete ? (
            <>
              <CheckCircle className="w-[14px] h-[14px] text-ops-success" />
              <span className="font-mono text-[10px] text-text-disabled">
                {activeCount} {t("setup.taskTypes.configured")}
              </span>
            </>
          ) : (
            <>
              <Circle className="w-[14px] h-[14px] text-text-disabled" />
              <span className="font-mono text-[10px] text-text-disabled">
                {t("setup.taskTypes.notStarted")}
              </span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}
