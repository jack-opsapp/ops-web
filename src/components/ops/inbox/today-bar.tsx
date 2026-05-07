"use client";

import Link from "next/link";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface TodayCommitment {
  id: string;
  text: string;
  due: string;
  threadId: string;
  urgent: boolean;
}

interface TodayBarProps {
  commitments: TodayCommitment[];
  className?: string;
}

export function TodayBar({ commitments, className }: TodayBarProps) {
  const { t } = useDictionary("inbox");
  const empty = commitments.length === 0;
  const next = commitments[0];

  return (
    <div
      className={cn(
        "flex h-16 shrink-0 items-center gap-3 border-b border-line bg-inbox-panel px-3.5",
        className,
      )}
    >
      {empty ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-cakemono text-[10.5px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
            {t("todayBar.allClear", "// ALL CLEAR")}
          </span>
          <span className="font-mohave text-[12px] leading-tight text-text-3">
            {t("todayBar.noCommitments", "no commitments today")}
          </span>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-cakemono text-[10.5px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
                {t("todayBar.title", "// BALL IN YOUR COURT — TODAY")}
              </span>
              {commitments.length > 1 && (
                <span
                  className="font-mono text-[9.5px] leading-none tabular-nums text-text-3"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {commitments.length}
                </span>
              )}
              {next?.urgent && (
                <span
                  data-testid="today-bar-urgent"
                  aria-label="urgent"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose"
                />
              )}
            </div>
            {next && (
              <Link
                href={`/inbox/${next.threadId}`}
                className="block min-w-0 truncate font-mohave text-[12px] leading-tight text-text-2 hover:text-text"
              >
                {next.text}
              </Link>
            )}
          </div>
          {next && (
            <span
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-text-3"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {next.due}
            </span>
          )}
        </>
      )}
    </div>
  );
}
