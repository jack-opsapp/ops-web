"use client";

import { Database } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export function DeveloperTab() {
  const { t } = useDictionary("settings");

  return (
    <div className="max-w-3xl space-y-3">
      <div>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("developer.title")}
        </span>
        <p className="mt-1 font-mohave text-body-sm text-text-2">
          {t("developer.description")}
        </p>
      </div>

      <div className="glass-surface rounded-panel p-3">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-[20px] w-[20px] shrink-0 text-text-3" />
          <div className="flex-1">
            <p className="font-mohave text-body text-text">
              {t("developer.database")}
            </p>
            <p className="mt-1 font-mohave text-body-sm text-text-2">
              {t("developer.databaseDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
