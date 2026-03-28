"use client";

import { Database } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function DeveloperTab() {
  const { t } = useDictionary("settings");

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-semibold text-[#E5E5E5]">{t("developer.title")}</h2>
        <p className="text-sm text-[#999] mt-1">
          {t("developer.description")}
        </p>
      </div>

      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-[#417394] mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-[#E5E5E5]">
              {t("developer.database")}
            </h3>
            <p className="text-sm text-[#999] mt-1">
              {t("developer.databaseDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
