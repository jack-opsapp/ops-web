import Link from "next/link";
import { TestModeToggle } from "./test-mode-toggle";
import { RefreshBoardButton } from "./refresh-board-button";

interface SpecPageHeaderProps {
  testMode: boolean;
  snapshotRefreshedAt: string | null;
}

export function SpecPageHeader({ testMode, snapshotRefreshedAt }: SpecPageHeaderProps) {
  return (
    <header className="flex items-end justify-between border-b border-white/[0.08] px-8 py-6">
      <div>
        <h1 className="font-cakemono text-2xl font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          SPEC OPERATIONS
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span className="text-text-mute">[</span>
          {testMode ? "TEST + LIVE ROWS" : "LIVE ROWS ONLY"}
          <span className="text-text-mute">]</span>
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Link
          href="/admin/spec/analytics"
          className="rounded-[5px] border border-white/[0.12] px-3 py-2 font-cakemono text-[12px] font-light uppercase text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.05]"
        >
          ANALYTICS
        </Link>
        <TestModeToggle enabled={testMode} />
        <RefreshBoardButton initialRefreshedAt={snapshotRefreshedAt} />
      </div>
    </header>
  );
}
