interface DeferredTabProps {
  label: string;
  rationale: string;
}

/**
 * Placeholder render for the 6 tabs deferred to sub-chip F.2.b. The tab label
 * is preserved in the strip so muscle memory works once F.2.b ships; the body
 * surfaces a single sentence explaining what arrives next.
 */
export function DeferredTab({ label, rationale }: DeferredTabProps) {
  return (
    <section
      aria-label={`${label} (deferred)`}
      className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-6 backdrop-blur-[28px]"
    >
      <h2 className="font-cakemono text-[15px] font-light uppercase text-[#EDEDED]">
        <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
          {"//"}
        </span>
        {label}
      </h2>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        <span className="text-[#3A3A3A]">[</span>
        DEFERRED TO F.2.B
        <span className="text-[#3A3A3A]">]</span>
      </p>
      <p className="mt-4 max-w-[60ch] text-[13px] leading-relaxed text-[#B5B5B5]">
        {rationale}
      </p>
    </section>
  );
}
