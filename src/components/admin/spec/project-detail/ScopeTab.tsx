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
                    <span className="font-mono text-[12px] tabular-nums text-text">
                      V{v.version}
                    </span>
                    <span
                      className={[
                        "rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em]",
                        v.isCurrent
                          ? "border-olive/40 text-olive"
                          : "border-white/[0.08] text-text-mute",
                      ].join(" ")}
                    >
                      {v.isCurrent ? "CURRENT" : v.supersededAt ? "SUPERSEDED" : "DRAFT"}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                    DRAFTED · {formatDate(v.draftedAt)}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                    SENT · {v.sentAt ? formatDate(v.sentAt) : "—"}
                  </div>
                  {v.supersededAt && (
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                      SUPERSEDED · {formatDate(v.supersededAt)}
                    </div>
                  )}
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute"
                    title={v.contentHash}
                  >
                    HASH · {truncateHash(v.contentHash, 10)}
                  </div>
                  {v.externalUrl && (
                    <a
                      href={v.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text"
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
              className="w-full rounded-[5px] border border-ops-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-ops-accent hover:text-black"
            >
              {data.current ? "NEW SCOPE REVISION" : "CREATE V1 DRAFT"}
            </button>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
              <span className="text-text-mute">[</span>
              {data.current
                ? `INCREMENTS VERSION · MARKS V${data.current.version} SUPERSEDED`
                : "SEEDS THE FIRST SCOPE DOC"}
              <span className="text-text-mute">]</span>
            </p>
          </form>
        </Panel>
      </div>

      <div className="space-y-6">
        {data.current ? (
          <>
            <Panel title={`CURRENT — V${data.current.version}`}>
              {data.current.contentJson ? (
                <pre className="overflow-x-auto rounded-[5px] border border-white/[0.06] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-text">
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
                        <span className="text-[13px] text-text">{f.featureName}</span>
                        <FeatureBadge status={f.status} />
                      </div>
                      <p className="text-[12px] leading-relaxed text-text-2">
                        {f.acceptanceCriteria}
                      </p>
                      {f.failureNotes && (
                        <p className="rounded-[5px] border border-rose/30 bg-[rgba(147,50,26,0.06)] p-2 text-[11px] leading-relaxed text-rose">
                          <span className="mr-1 font-mono uppercase tracking-[0.16em]">
                            FAIL ·
                          </span>
                          {f.failureNotes}
                        </p>
                      )}
                      {f.verifiedAt && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
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
      ? "text-olive border-olive/40"
      : status === "failing"
        ? "text-rose border-rose/40"
        : "text-text-3 border-white/[0.10]";
  return (
    <span
      className={`rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
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
    "rounded-[4px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:cursor-not-allowed disabled:opacity-40";
  const toneCls =
    tone === "olive"
      ? "border-olive/40 text-olive hover:bg-olive hover:text-black"
      : tone === "brick"
        ? "border-rose/40 text-rose hover:bg-rose hover:text-black"
        : "border-white/[0.10] text-text-3 hover:text-text";
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
      className="glass-surface p-5"
    >
      <h2 className="mb-3 font-cakemono text-[14px] font-light uppercase leading-none text-text">
        <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
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
    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
      <span className="text-text-mute">[</span>
      {children}
      <span className="text-text-mute">]</span>
    </p>
  );
}
