import { Check } from "lucide-react";
import { useDictionary } from "@/i18n/client";

export interface RequestSentRowProps {
  timestamp: Date;
}

function formatTimestamp(date: Date): string {
  // HH:MM TZ in user's locale, e.g. "14:23 PT"
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const tz = new Intl.DateTimeFormat([], { timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return tz ? `${time} ${tz}` : time;
}

export function RequestSentRow({ timestamp }: RequestSentRowProps) {
  const { t } = useDictionary("auth");
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 w-full px-3 py-3 rounded-sm bg-[var(--olive-soft)] border border-[var(--olive-line)] text-[var(--olive)]"
    >
      <Check className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
        {t("lockout.shared.requestSent").toUpperCase()} · {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}
