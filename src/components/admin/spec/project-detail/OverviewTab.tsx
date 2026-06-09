import Link from "next/link";
import { updateEta } from "@/app/admin/spec/[id]/_actions/update-eta";
import type {
  SpecOverviewTab,
  SpecPaymentMilestone,
  SpecProjectHeader,
} from "@/lib/admin/spec-types";
import { SPEC_MILESTONE_LABELS } from "@/lib/admin/spec-types";
import { formatCents, formatDate, formatIsoDate, formatRelative, statusLabel } from "./format";

interface OverviewTabProps {
  data: SpecOverviewTab;
  header: SpecProjectHeader;
}

export function OverviewTab({ data, header }: OverviewTabProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr,3fr]">
      {/* LEFT COLUMN — identity + status */}
      <div className="space-y-6">
        <Panel title="CUSTOMER">
          <DefList>
            <Row label="NAME" value={data.customer.name || "—"} />
            <Row label="EMAIL" value={data.customer.email} mono />
            <Row label="PHONE" value={data.customer.phone || "—"} mono />
            <Row label="GST / HST" value={data.customer.gstNumber || "—"} mono />
          </DefList>
        </Panel>

        <Panel title="IDENTITIES">
          <DefList>
            <IdentityRow
              label="BUYER"
              user={data.buyer}
              note={data.buyerIsAccountHolder ? "Same as account holder" : null}
            />
            <IdentityRow
              label="ACCOUNT HOLDER"
              user={data.accountHolder}
              note={
                !data.buyerIsAccountHolder && data.accountHolder
                  ? "Differs from buyer — Path B engagement"
                  : null
              }
            />
            <Row
              label="COMPANY"
              value={
                data.company ? (
                  <Link
                    href={`/admin/companies/${data.company.id}`}
                    className="text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text-2"
                  >
                    {data.company.name || data.company.id}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          </DefList>
        </Panel>

        <Panel title="STATUS">
          <DefList>
            <Row label="CURRENT" value={statusLabel(header.status)} />
            <Row
              label="LAST CHANGE"
              value={
                data.lastStatusChangeAt ? (
                  <span>
                    {formatDate(data.lastStatusChangeAt)}{" "}
                    <span className="text-text-mute">· {formatRelative(data.lastStatusChangeAt)}</span>
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="TIER"
              value={
                <span>
                  {header.tier.toUpperCase()}
                  {header.originalTier && header.originalTier !== header.tier && (
                    <span className="ml-2 text-text-mute">
                      · WAS {header.originalTier.toUpperCase()}
                    </span>
                  )}
                </span>
              }
            />
          </DefList>
        </Panel>

        {data.holdState && (
          <Panel title="HOLD STATE" tone="brick">
            <DefList>
              <Row
                label="TYPE"
                value={
                  data.holdState.holdType === "customer_requested"
                    ? "CUSTOMER REQUESTED"
                    : "OPS BLOCKED"
                }
              />
              <Row
                label="PRIOR STATUS"
                value={data.holdState.priorStatus ? statusLabel(data.holdState.priorStatus) : "—"}
              />
              <Row label="ON HOLD AT" value={formatDate(data.holdState.onHoldAt)} />
              <Row label="EXPIRES" value={formatDate(data.holdState.onHoldExpiresAt)} />
              <Row label="REASON" value={data.holdState.onHoldReason || "—"} long />
            </DefList>
          </Panel>
        )}

        <Panel title="ATTRIBUTION">
          <DefList>
            <Row label="SOURCE" value={data.attribution.utmSource || "—"} mono />
            <Row label="MEDIUM" value={data.attribution.utmMedium || "—"} mono />
            <Row label="CAMPAIGN" value={data.attribution.utmCampaign || "—"} mono />
            <Row label="CONTENT" value={data.attribution.utmContent || "—"} mono />
            <Row label="TERM" value={data.attribution.utmTerm || "—"} mono />
            <Row label="GCLID" value={data.attribution.gclid || "—"} mono />
            <Row label="FBCLID" value={data.attribution.fbclid || "—"} mono />
            <Row
              label="LANDING URL"
              value={
                data.attribution.landingUrl ? (
                  <a
                    href={data.attribution.landingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-text transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text-2"
                  >
                    {data.attribution.landingUrl}
                  </a>
                ) : (
                  "—"
                )
              }
              long
            />
            <Row label="FIRST TOUCH" value={formatDate(data.attribution.firstTouchAt)} />
          </DefList>
        </Panel>
      </div>

      {/* RIGHT COLUMN — money + dates + ETA */}
      <div className="space-y-6">
        <Panel title="FINANCIAL SUMMARY">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <Kpi label="COMMITTED" value={formatCents(data.financial.totalCommittedCents)} />
            <Kpi
              label="PAID"
              value={formatCents(data.financial.totalPaidCents)}
              tone="text-olive"
            />
            <Kpi
              label="PENDING"
              value={formatCents(data.financial.pendingCents)}
              tone="text-tan"
            />
            <Kpi
              label="OVERDUE"
              value={formatCents(data.financial.overdueCents)}
              tone={data.financial.overdueCents > 0 ? "text-rose" : "text-text-3"}
            />
            <Kpi
              label="REFUNDED"
              value={formatCents(data.financial.refundedCents)}
              tone={data.financial.refundedCents > 0 ? "text-rose" : "text-text-3"}
            />
            <Kpi
              label="POLISH HRS"
              value={
                data.financial.polishHoursBudget > 0
                  ? `${data.financial.polishHoursUsed.toFixed(1)} / ${data.financial.polishHoursBudget.toFixed(1)}`
                  : "—"
              }
            />
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
              MILESTONE BREAKDOWN
            </h3>
            {data.financial.perMilestone.length === 0 ? (
              <p className="font-mono text-[12px] text-text-mute">
                — no milestones invoiced yet
              </p>
            ) : (
              <ul className="space-y-1 font-mono text-[12px]">
                {data.financial.perMilestone.map((m) => (
                  <li
                    key={m.milestone}
                    className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-1.5 last:border-b-0"
                  >
                    <span className="flex items-center gap-2 text-text-2">
                      <span className="text-text-mute">
                        {SPEC_MILESTONE_LABELS[m.milestone as SpecPaymentMilestone]}
                      </span>
                      <span className="text-text">{milestoneLabel(m.milestone)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-text-mute uppercase tracking-[0.12em]">
                        {statusLabel(m.status)}
                      </span>
                      <span className="tabular-nums text-text">
                        {formatCents(m.amountCents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="KEY DATES">
          <DefList>
            <Row label="DEPOSIT PAID" value={formatDate(data.keyDates.depositPaidAt)} />
            <Row label="SCOPE SIGNED" value={formatDate(data.keyDates.scopeDocSignedAt)} />
            <Row label="BUILD STARTED" value={formatDate(data.keyDates.buildStartedAt)} />
            <Row
              label="WALKTHROUGH"
              value={formatDate(data.keyDates.walkthroughCompletedAt)}
            />
            <Row
              label="SUPPORT ENDS"
              value={formatDate(data.keyDates.supportWindowEndsAt)}
            />
          </DefList>
        </Panel>

        <Panel title="ESTIMATED COMPLETION">
          <form action={updateEta} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="project_id" value={header.id} />
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                <span className="text-text-mute">[</span>YYYY-MM-DD
                <span className="text-text-mute">]</span>
              </span>
              <input
                name="estimated_completion_date"
                type="date"
                defaultValue={formatIsoDate(data.estimatedCompletionDate) === "—" ? "" : formatIsoDate(data.estimatedCompletionDate)}
                className="rounded-[5px] border border-white/[0.10] bg-black px-3 py-1.5 font-mono text-[12px] tabular-nums text-text outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-ops-accent"
              />
            </label>
            <button
              type="submit"
              className="rounded-[5px] border border-ops-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ops-accent transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-ops-accent hover:text-black"
            >
              UPDATE ETA
            </button>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
              <span className="text-text-mute">[</span>
              CURRENT · {formatDate(data.estimatedCompletionDate)}
              <span className="text-text-mute">]</span>
            </span>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function milestoneLabel(m: SpecPaymentMilestone | string): string {
  if (m === "deposit") return "DEPOSIT";
  if (m === "scope_signoff") return "SCOPE SIGN-OFF";
  if (m === "midpoint") return "MIDPOINT";
  if (m === "delivery") return "DELIVERY";
  return statusLabel(m);
}

// ─── Local primitives ───────────────────────────────────────────────────────

function Panel({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "brick";
}) {
  const borderClass =
    tone === "brick" ? "border-rose/40" : "border-white/[0.10]";
  return (
    <section
      aria-label={title}
      className={`rounded-[10px] border ${borderClass} bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]`}
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

function DefList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-white/[0.06]">{children}</dl>;
}

function Row({
  label,
  value,
  mono,
  long,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  long?: boolean;
}) {
  return (
    <div className={`grid gap-2 py-2 ${long ? "" : "grid-cols-[140px,1fr]"}`}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        {label}
      </dt>
      <dd
        className={`break-words text-[13px] text-text ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function IdentityRow({
  label,
  user,
  note,
}: {
  label: string;
  user: { id: string; email: string | null; name: string | null } | null;
  note: string | null;
}) {
  return (
    <div className="grid grid-cols-[140px,1fr] gap-2 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        {label}
      </dt>
      <dd className="text-[13px] text-text">
        {user ? (
          <span className="flex flex-col gap-0.5">
            <span>{user.name || user.email || user.id.slice(0, 8)}</span>
            {user.email && user.name && (
              <span className="font-mono text-[11px] tabular-nums text-text-3">
                {user.email}
              </span>
            )}
            {note && (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                <span className="text-text-mute">[</span>
                {note}
                <span className="text-text-mute">]</span>
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        {label}
      </p>
      <p className={`mt-1 font-mono text-[16px] tabular-nums leading-none ${tone ?? "text-text"}`}>
        {value}
      </p>
    </div>
  );
}
