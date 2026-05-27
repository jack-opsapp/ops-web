import type { SpecIntakeTab } from "@/lib/admin/spec-types";
import { formatBytes, formatDateTime } from "./format";

interface IntakeTabProps {
  data: SpecIntakeTab;
}

// The intake form sections are grouped per the bible's intake schema. Unknown
// keys land in `Other`, so an intake change doesn't break the surface.
const SECTION_DEFS: Array<{ title: string; keys: string[] }> = [
  {
    title: "BUSINESS BASICS",
    keys: [
      "business_name",
      "industry",
      "trade",
      "founded_year",
      "headcount",
      "annual_revenue",
      "website",
      "service_area",
    ],
  },
  {
    title: "TEAM",
    keys: ["team_size", "field_crew_count", "office_staff_count", "owners", "key_decision_makers"],
  },
  {
    title: "MONEY",
    keys: [
      "current_accounting_software",
      "invoice_volume",
      "payment_terms",
      "ar_aging_avg_days",
      "p_and_l_owner",
    ],
  },
  {
    title: "CURRENT TOOLS",
    keys: [
      "current_software",
      "tools_in_use",
      "primary_pain_software",
      "integrations_required",
      "data_sources",
    ],
  },
  {
    title: "WORKFLOW",
    keys: [
      "lead_intake_process",
      "estimation_process",
      "scheduling_process",
      "field_dispatch_process",
      "invoicing_process",
      "reporting_process",
    ],
  },
  {
    title: "PAIN POINTS",
    keys: ["pain_points", "current_workarounds", "lost_time_per_week_hours", "lost_revenue_estimate"],
  },
  {
    title: "SUCCESS",
    keys: ["success_criteria", "definition_of_done", "north_star_metric", "timeline_constraints"],
  },
  {
    title: "REGULATED WORKFLOW ATTESTATION",
    keys: [
      "regulated_workflow_attestation",
      "regulated_workflows_present",
      "phi_present",
      "pci_card_capture",
      "regulated_credit_decisions",
      "surveillance_workflows",
      "casl_bulk_messaging",
    ],
  },
];

export function IntakeTab({ data }: IntakeTabProps) {
  const responses = data.responses ?? null;
  const known = new Set<string>(SECTION_DEFS.flatMap((s) => s.keys));
  const otherKeys = responses
    ? Object.keys(responses).filter((k) => !known.has(k))
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]">
        <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          INTAKE
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] md:grid-cols-3">
          <Meta label="SUBMITTED" value={formatDateTime(data.submittedAt)} />
          <Meta
            label="REGULATED FLAGGED"
            value={
              data.regulatedWorkflowFlaggedAt ? formatDateTime(data.regulatedWorkflowFlaggedAt) : "—"
            }
            tone={data.regulatedWorkflowFlaggedAt ? "text-[#B58289]" : undefined}
          />
          <Meta label="FILES" value={`${data.files.length}`} mono />
        </div>
      </div>

      {data.regulatedWorkflowFlaggedAt && data.regulatedWorkflowFlags && (
        <section
          aria-label="Regulated workflow flags"
          className="rounded-[10px] border border-[#B58289]/40 bg-[rgba(147,50,26,0.08)] p-5"
        >
          <h3 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#B58289]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            REGULATED WORKFLOW FLAGS
          </h3>
          <pre className="mt-3 overflow-x-auto rounded-[5px] border border-white/[0.06] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-[#EDEDED]">
{JSON.stringify(data.regulatedWorkflowFlags, null, 2)}
          </pre>
        </section>
      )}

      {!data.submittedAt && (
        <p className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-6 font-mono text-[12px] uppercase tracking-[0.16em] text-[#6A6A6A] backdrop-blur-[28px]">
          <span className="text-[#3A3A3A]">[</span>
          INTAKE NOT YET SUBMITTED
          <span className="text-[#3A3A3A]">]</span>
        </p>
      )}

      {responses && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {SECTION_DEFS.map((section) => {
            const visibleKeys = section.keys.filter(
              (k) => responses[k] !== undefined && responses[k] !== null && responses[k] !== "",
            );
            if (visibleKeys.length === 0) return null;
            return (
              <SectionPanel key={section.title} title={section.title}>
                {visibleKeys.map((k) => (
                  <FieldRow
                    key={k}
                    label={k.replace(/_/g, " ").toUpperCase()}
                    value={responses[k]}
                  />
                ))}
              </SectionPanel>
            );
          })}
          {otherKeys.length > 0 && (
            <SectionPanel title="OTHER">
              {otherKeys.map((k) => (
                <FieldRow
                  key={k}
                  label={k.replace(/_/g, " ").toUpperCase()}
                  value={responses[k]}
                />
              ))}
            </SectionPanel>
          )}
        </div>
      )}

      <section
        aria-label="Intake files"
        className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
      >
        <h3 className="mb-3 font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
          <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
            {"//"}
          </span>
          FILES
        </h3>
        {data.files.length === 0 ? (
          <p className="font-mono text-[12px] text-[#6A6A6A]">— no files uploaded</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {data.files.map((file) => (
              <li key={file.path} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[#EDEDED]">{file.filename}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                    {file.contentType ?? "—"} · {formatBytes(file.sizeBytes)}{" "}
                    {file.uploadedAt ? `· ${formatDateTime(file.uploadedAt)}` : ""}
                  </p>
                </div>
                {file.signedUrl ? (
                  <a
                    href={file.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[5px] border border-[#6F94B0] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
                  >
                    DOWNLOAD
                  </a>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                    <span className="text-[#3A3A3A]">[</span>
                    URL UNAVAILABLE
                    <span className="text-[#3A3A3A]">]</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
    >
      <h3 className="mb-3 font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
        <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
          {"//"}
        </span>
        {title}
      </h3>
      <dl className="divide-y divide-white/[0.06]">{children}</dl>
    </section>
  );
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid grid-cols-[160px,1fr] gap-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">
        {label}
      </dt>
      <dd className="text-[13px] leading-relaxed text-[#EDEDED]">{renderValue(value)}</dd>
    </div>
  );
}

function renderValue(value: unknown): React.ReactNode {
  if (value == null || value === "") return <span className="text-[#6A6A6A]">—</span>;
  if (typeof value === "boolean") {
    return (
      <span
        className={`font-mono text-[11px] uppercase tracking-[0.16em] ${value ? "text-[#9DB582]" : "text-[#B58289]"}`}
      >
        {value ? "YES" : "NO"}
      </span>
    );
  }
  if (typeof value === "string" || typeof value === "number") {
    return <span className="break-words">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[#6A6A6A]">—</span>;
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li key={i} className="text-[12px] text-[#B5B5B5]">
            <span className="mr-2 font-mono text-[10px] text-[#6A6A6A]">·</span>
            {typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return (
      <pre className="overflow-x-auto rounded-[5px] border border-white/[0.06] bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-[#EDEDED]">
{JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="text-[#6A6A6A]">—</span>;
}

function Meta({ label, value, tone, mono }: { label: string; value: string; tone?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#6A6A6A]">{label}</span>
      <span className={`${tone ?? "text-[#EDEDED]"} ${mono ? "tabular-nums" : ""}`}>{value}</span>
    </div>
  );
}
