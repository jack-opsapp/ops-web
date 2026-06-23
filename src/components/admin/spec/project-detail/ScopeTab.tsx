import { markFeature } from "@/app/admin/spec/[id]/_actions/mark-feature";
import { newScopeRevision } from "@/app/admin/spec/[id]/_actions/new-scope-revision";
import type { SpecScopeTab } from "@/lib/admin/spec-types";
import { formatDate, formatDateTime, statusLabel, truncateHash } from "./format";

interface ScopeTabProps {
  data: SpecScopeTab;
  projectId: string;
}

export function ScopeTab({ data, projectId }: ScopeTabProps) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr,2fr]">
      <div className="space-y-6">
        <Panel title="VERSIONS">
          {data.versions.length === 0 ? (
            <EmptyState>NO SCOPE DOCS YET</EmptyState>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {data.versions.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-col gap-1 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] tabular-nums text-[#EDEDED]">
                      V{v.version}
                    </span>
                    <span
                      className={[
                        "rounded-chip border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em]",
                        v.isCurrent
                          ? "border-[#9DB582]/40 text-[#9DB582]"
                          : "border-white/[0.08] text-[#6A6A6A]",
                      ].join(" ")}
                    >
                      {v.isCurrent ? "CURRENT" : v.supersededAt ? "SUPERSEDED" : "DRAFT"}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                    DRAFTED · {formatDate(v.draftedAt)}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                    SENT · {v.sentAt ? formatDate(v.sentAt) : "—"}
                  </div>
                  {v.supersededAt && (
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                      SUPERSEDED · {formatDate(v.supersededAt)}
                    </div>
                  )}
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
                    title={v.contentHash}
                  >
                    HASH · {truncateHash(v.contentHash, 10)}
                  </div>
                  {v.externalUrl && (
                    <a
                      href={v.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#EDEDED]"
                    >
                      OPEN EXTERNAL ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form action={newScopeRevision} className="mt-4 border-t border-white/[0.06] pt-4">
            <input type="hidden" name="project_id" value={projectId} />
            <button
              type="submit"
              className="w-full rounded border border-[#6F94B0] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
            >
              {data.current ? "NEW SCOPE REVISION" : "CREATE V1 DRAFT"}
            </button>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
              <span className="text-[#3A3A3A]">[</span>
              {data.current
                ? `INCREMENTS VERSION · MARKS V${data.current.version} SUPERSEDED`
                : "SEEDS THE FIRST SCOPE DOC"}
              <span className="text-[#3A3A3A]">]</span>
            </p>
          </form>
        </Panel>
      </div>

      <div className="space-y-6">
        {data.current ? (
          <>
            <Panel title={`CURRENT — V${data.current.version}`}>
              {data.current.contentJson ? (
                <pre className="overflow-x-auto rounded border border-white/[0.06] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-[#EDEDED]">
{JSON.stringify(data.current.contentJson, null, 2)}
                </pre>
              ) : (
                <EmptyState>NO CONTENT JSON STORED</EmptyState>
              )}
            </Panel>

            <Panel title={`FEATURE ACCEPTANCE · ${data.current.features.length} FEATURES`}>
              {data.current.features.length === 0 ? (
                <EmptyState>NO FEATURES SEEDED — RUN NEW REVISION TO POPULATE</EmptyState>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {data.current.features.map((f) => (
                    <li key={f.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="text-[13px] text-[#EDEDED]">{f.featureName}</span>
                        <FeatureBadge status={f.status} />
                      </div>
                      <p className="text-[12px] leading-relaxed text-[#B5B5B5]">
                        {f.acceptanceCriteria}
                      </p>
                      {f.failureNotes && (
                        <p className="rounded border border-[#B58289]/30 bg-[rgba(147,50,26,0.06)] p-2 text-[11px] leading-relaxed text-[#B58289]">
                          <span className="mr-1 font-mono uppercase tracking-[0.16em]">
                            FAIL ·
                          </span>
                          {f.failureNotes}
                        </p>
                      )}
                      {f.verifiedAt && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                          VERIFIED · {formatDateTime(f.verifiedAt)}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <FeatureControl
                          projectId={projectId}
                          featureId={f.id}
                          target="passing"
                          label="MARK PASSING"
                          tone="olive"
                          disabled={f.status === "passing"}
                        />
                        <FeatureControl
                          projectId={projectId}
                          featureId={f.id}
                          target="failing"
                          label="MARK FAILING"
                          tone="brick"
                          disabled={f.status === "failing"}
                        />
                        <FeatureControl
                          projectId={projectId}
                          featureId={f.id}
                          target="pending"
                          label="RESET"
                          tone="mute"
                          disabled={f.status === "pending"}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : (
          <Panel title="CURRENT">
            <EmptyState>NO CURRENT SCOPE DOC — DRAFT THE FIRST VERSION</EmptyState>
          </Panel>
        )}
      </div>
    </div>
  );
}

function FeatureBadge({ status }: { status: "pending" | "passing" | "failing" }) {
  const tone =
    status === "passing"
      ? "text-[#9DB582] border-[#9DB582]/40"
      : status === "failing"
        ? "text-[#B58289] border-[#B58289]/40"
        : "text-[#8A8A8A] border-white/[0.10]";
  return (
    <span
      className={`rounded-chip border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function FeatureControl({
  projectId,
  featureId,
  target,
  label,
  tone,
  disabled,
}: {
  projectId: string;
  featureId: string;
  target: "passing" | "failing" | "pending";
  label: string;
  tone: "olive" | "brick" | "mute";
  disabled: boolean;
}) {
  const base =
    "rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:cursor-not-allowed disabled:opacity-40";
  const toneCls =
    tone === "olive"
      ? "border-[#9DB582]/40 text-[#9DB582] hover:bg-[#9DB582] hover:text-black"
      : tone === "brick"
        ? "border-[#B58289]/40 text-[#B58289] hover:bg-[#B58289] hover:text-black"
        : "border-white/[0.10] text-[#8A8A8A] hover:text-[#EDEDED]";
  return (
    <form action={markFeature} className="inline-flex">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="feature_id" value={featureId} />
      <input type="hidden" name="target_status" value={target} />
      <button type="submit" disabled={disabled} className={`${base} ${toneCls}`}>
        {label}
      </button>
    </form>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-panel border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
    >
      <h2 className="mb-3 font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
        <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
          {"//"}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
      <span className="text-[#3A3A3A]">[</span>
      {children}
      <span className="text-[#3A3A3A]">]</span>
    </p>
  );
}
