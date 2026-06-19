import Link from "next/link";

export function CapacityEditorHeader() {
  return (
    <header className="flex items-end justify-between border-b border-white/[0.08] px-8 py-6">
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.20em] text-text-mute">
          <Link
            href="/admin/spec"
            className="text-text-3 underline-offset-4 transition-colors hover:text-text hover:underline"
          >
            <span aria-hidden="true" className="text-text-mute">
              [
            </span>
            ← SPEC OPS
            <span aria-hidden="true" className="text-text-mute">
              ]
            </span>
          </Link>
        </div>
        <h1 className="font-cakemono text-2xl font-light uppercase leading-none text-text">
          <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
            {"//"}
          </span>
          CAPACITY CONFIG
        </h1>
        <p className="mt-2 max-w-[640px] font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
          <span aria-hidden="true" className="text-text-mute">
            [
          </span>
          EDITS WRITE TO SPEC_CAPACITY · TRIGGER PUBLIC SNAPSHOT REFRESH · LOG AUDIT
          <span aria-hidden="true" className="text-text-mute">
            ]
          </span>
        </p>
      </div>
    </header>
  );
}
