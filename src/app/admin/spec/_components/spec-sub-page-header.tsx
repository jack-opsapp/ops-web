import Link from "next/link";
import { TestModeToggle } from "./test-mode-toggle";

interface SpecSubPageHeaderProps {
  title: string;
  testMode: boolean;
  backHref: string;
  rightMeta?: string;
}

/**
 * Header for nested `/admin/spec/<page>` routes. Mirrors the overview's
 * `SpecPageHeader` typography + test-mode chip, but adds a back-arrow to the
 * overview and a right-meta slot for queue counts.
 */
export function SpecSubPageHeader({
  title,
  testMode,
  backHref,
  rightMeta,
}: SpecSubPageHeaderProps) {
  return (
    <header className="flex items-end justify-between border-b border-white/[0.08] px-8 py-6">
      <div>
        <Link
          href={backHref}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#EDEDED]"
        >
          <span className="text-[#3A3A3A]">←</span> SPEC OPERATIONS
        </Link>
        <h1 className="mt-1 font-cakemono text-2xl font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          {title}
        </h1>
        {rightMeta && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {rightMeta}
            <span className="text-[#3A3A3A]">]</span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        <TestModeToggle enabled={testMode} />
      </div>
    </header>
  );
}
