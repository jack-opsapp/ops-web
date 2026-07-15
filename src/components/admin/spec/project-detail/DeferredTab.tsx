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
      className="glass-surface p-6"
    >
      <h2 className="font-cakemono text-[15px] font-light uppercase text-text">
        <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
          {"//"}
        </span>
        {label}
      </h2>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">[</span>
        DEFERRED TO F.2.B
        <span className="text-text-mute">]</span>
      </p>
      <p className="mt-4 max-w-[60ch] text-[13px] leading-relaxed text-text-2">
        {rationale}
      </p>
    </section>
  );
}
