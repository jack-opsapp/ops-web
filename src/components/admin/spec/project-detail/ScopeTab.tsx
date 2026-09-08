import { lockTotal } from "@/app/admin/spec/[id]/_actions/lock-total";
import { markFeature } from "@/app/admin/spec/[id]/_actions/mark-feature";
import { newScopeRevision } from "@/app/admin/spec/[id]/_actions/new-scope-revision";
import { formatCadCents, lockBlockedLabel } from "@/lib/admin/spec-locked-total";
import { formatSpecTier, specMilestoneSchedule } from "@/lib/admin/spec-tiers";
import type { SpecScopeLockedTotal, SpecScopeTab } from "@/lib/admin/spec-types";
import { formatCents, formatDate, formatDateTime, statusLabel, truncateHash } from "./format";

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
                        "rounded-chip border px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.16em]",
                        v.isCurrent
                          ? "border-olive/40 text-olive"
                          : "border-white/[0.08] text-text-mute",
                      ].join(" ")}
                    >
                      {v.isCurrent ? "CURRENT" : v.supersededAt ? "SUPERSEDED" : "DRAFT"}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
                    DRAFTED · {formatDate(v.draftedAt)}
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
                    SENT · {v.sentAt ? formatDate(v.sentAt) : "—"}
                  </div>
                  {v.supersededAt && (
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
                      SUPERSEDED · {formatDate(v.supersededAt)}
                    </div>
                  )}
                  <div
                    className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute"
                    title={v.contentHash}
                  >
                    HASH · {truncateHash(v.contentHash, 10)}
                  </div>
                  {v.externalUrl && (
                    <a
                      href={v.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2 transition-colors duration-150 ease-smooth hover:text-text"
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
              className="w-full rounded border border-ops-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black"
            >
              {data.current ? "NEW SCOPE REVISION" : "CREATE V1 DRAFT"}
            </button>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
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
        {data.lockedTotal && <LockedTotalPanel data={data.lockedTotal} projectId={projectId} />}
        {data.current ? (
          <>
            <Panel title={`CURRENT — V${data.current.version}`}>
              {data.current.contentJson ? (
                <pre className="overflow-x-auto rounded border border-white/[0.06] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-text">
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
                        <p className="rounded border border-rose/30 bg-brick/[0.06] p-2 text-[11px] leading-relaxed text-rose">
                          <span className="mr-1 font-mono uppercase tracking-[0.16em]">
                            FAIL ·
                          </span>
                          {f.failureNotes}
                        </p>
                      )}
                      {f.verifiedAt && (
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
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

/**
 * SPEC-03 only — the operator commits the quoted total onto the current scope
 * doc draft before it goes out. Once the doc is sent, signed, or P2 is
 * invoiced the panel goes read-only and names the blocker; changes then go
 * through a change order. P2–P4 on the Milestones tab price off this figure.
 */
function LockedTotalPanel({ data, projectId }: { data: SpecScopeLockedTotal; projectId: string }) {
  const locked = data.lockedTotalCents != null;
  const open = data.blockedReason === null;
  const split = locked ? specMilestoneSchedule(data.tier, data.lockedTotalCents) : null;
  const docCarriesOtherFigure =
    locked && data.currentDocTotalCents != null && data.currentDocTotalCents !== data.lockedTotalCents;
  const version = data.currentDocVersion;

  return (
    <Panel title="LOCKED TOTAL">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className={[
              "rounded-chip border px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.16em]",
              locked ? "border-olive/40 text-olive" : "border-line text-text-mute",
            ].join(" ")}
          >
            {locked ? "LOCKED" : "NOT LOCKED"}
          </span>
          <span className="font-mono text-[20px] font-semibold tabular-nums leading-none text-text">
            {formatCents(data.lockedTotalCents)}
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
          <span className="text-text-mute">[</span>
          {formatSpecTier(data.tier)} · FLOOR · {formatCents(data.floorCents)}
          <span className="text-text-mute">]</span>
        </span>
      </div>

      {split && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">[</span>
          {split.entries.map((e) => `${e.label} ${formatCents(e.amountCents)}`).join(" · ")}
          <span className="text-text-mute">]</span>
        </p>
      )}

      {docCarriesOtherFigure && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-tan">
          <span className="text-text-mute">[</span>
          V{version} CARRIES {formatCents(data.currentDocTotalCents)} — RE-LOCK TO SYNC
          <span className="text-text-mute">]</span>
        </p>
      )}

      {open ? (
        <form action={lockTotal} className="mt-4 border-t border-white/[0.06] pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="project_id" value={projectId} />
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
                <span className="text-text-mute">[</span>TOTAL · CAD
                <span className="text-text-mute">]</span>
              </span>
              <span className="flex items-center rounded border border-line bg-surface-input transition-colors duration-150 ease-smooth focus-within:border-line-hi">
                <span aria-hidden="true" className="pl-3 font-mono text-[12px] text-text-3">
                  $
                </span>
                <input
                  name="locked_total"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={locked ? formatCadCents(data.lockedTotalCents as number).slice(1) : ""}
                  placeholder={formatCadCents(data.floorCents).slice(1)}
                  className="bg-transparent px-2 py-1.5 font-mono text-[12px] tabular-nums text-text outline-none placeholder:text-text-mute"
                />
              </span>
            </label>
            <button
              type="submit"
              className="rounded border border-ops-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black"
            >
              {locked ? "RE-LOCK" : "LOCK TOTAL"}
            </button>
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">[</span>
            {locked
              ? `OPEN UNTIL V${version} IS SENT — AFTER SIGN-OFF, CHANGES GO THROUGH A CHANGE ORDER`
              : `WRITES THE TOTAL ONTO V${version} · P2/P3/P4 SPLIT THE REMAINDER THREE WAYS`}
            <span className="text-text-mute">]</span>
          </p>
        </form>
      ) : (
        <p className="mt-4 border-t border-white/[0.06] pt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
          <span className="text-text-mute">[</span>
          {lockBlockedLabel(data.blockedReason as NonNullable<typeof data.blockedReason>, {
            version,
            signedAt: data.signedAt,
          })}
          <span className="text-text-mute">]</span>
        </p>
      )}
    </Panel>
  );
}

function FeatureBadge({ status }: { status: "pending" | "passing" | "failing" }) {
  const tone =
    status === "passing"
      ? "text-olive border-olive/40"
      : status === "failing"
        ? "text-rose border-rose/40"
        : "text-text-3 border-line";
  return (
    <span
      className={`rounded-chip border px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.16em] ${tone}`}
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
    "rounded-chip border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-150 ease-smooth disabled:cursor-not-allowed disabled:opacity-40";
  const toneCls =
    tone === "olive"
      ? "border-olive/40 text-olive hover:bg-olive hover:text-black"
      : tone === "brick"
        ? "border-rose/40 text-rose hover:bg-rose hover:text-black"
        : "border-line text-text-3 hover:text-text";
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
