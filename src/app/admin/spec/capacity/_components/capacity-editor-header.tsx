import Link from "next/link";

export function CapacityEditorHeader() {
  return (
    <header className="flex items-end justify-between border-b border-white/[0.08] px-8 py-6">
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.20em] text-[#6A6A6A]">
          <Link
            href="/admin/spec"
            className="text-[#8A8A8A] underline-offset-4 transition-colors hover:text-[#EDEDED] hover:underline"
          >
            <span aria-hidden="true" className="text-[#3A3A3A]">
              [
            </span>
            ← SPEC OPS
            <span aria-hidden="true" className="text-[#3A3A3A]">
              ]
            </span>
          </Link>
        </div>
        <h1 className="font-cakemono text-2xl font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          CAPACITY CONFIG
        </h1>
        <p className="mt-2 max-w-[640px] font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span aria-hidden="true" className="text-[#3A3A3A]">
            [
          </span>
          EDITS WRITE TO SPEC_CAPACITY · TRIGGER PUBLIC SNAPSHOT REFRESH · LOG AUDIT
          <span aria-hidden="true" className="text-[#3A3A3A]">
            ]
          </span>
        </p>
      </div>
    </header>
  );
}
