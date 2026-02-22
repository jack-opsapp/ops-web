"use client";

import { useState } from "react";
import { SubTabs } from "../../_components/sub-tabs";
import type { AuditLogEntry, DataQualityIssue, TableStats } from "@/lib/admin/types";

interface SystemContentProps {
  auditLog: AuditLogEntry[];
  dataQuality: DataQualityIssue[];
  tableStats: TableStats[];
  integrations: {
    portalEnabled: number;
    brandingConfigured: number;
    gmailConnected: number;
    accountingConnected: number;
    total: number;
  };
}

export function SystemContent({ auditLog, dataQuality, tableStats, integrations }: SystemContentProps) {
  return (
    <SubTabs tabs={["Audit Log", "Data Quality", "Integrations", "Database"]}>
      {(tab) => {
        if (tab === "Audit Log") return <AuditLogTab entries={auditLog} />;
        if (tab === "Data Quality") return <DataQualityTab issues={dataQuality} />;
        if (tab === "Integrations") return <IntegrationsTab data={integrations} />;
        if (tab === "Database") return <DatabaseTab stats={tableStats} />;
        return null;
      }}
    </SubTabs>
  );
}

function AuditLogTab({ entries }: { entries: AuditLogEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="grid grid-cols-5 px-6 py-3 border-b border-white/[0.08]">
        {["TABLE", "ACTION", "RECORD ID", "TIMESTAMP", ""].map((h) => (
          <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
        ))}
      </div>
      {entries.map((entry) => (
        <div key={entry.id}>
          <div
            className="grid grid-cols-5 px-6 items-center h-14 border-b border-white/[0.05] cursor-pointer hover:bg-white/[0.02] transition-colors"
            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
          >
            <span className="font-mohave text-[14px] text-[#E5E5E5]">{entry.table_name}</span>
            <span className={`font-mohave text-[13px] uppercase ${
              entry.action === "INSERT" ? "text-[#9DB582]" :
              entry.action === "UPDATE" ? "text-[#8195B5]" :
              entry.action === "DELETE" ? "text-[#93321A]" : "text-[#A0A0A0]"
            }`}>
              {entry.action}
            </span>
            <span className="font-kosugi text-[12px] text-[#6B6B6B] truncate">{entry.record_id}</span>
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">
              [{new Date(entry.created_at).toLocaleString()}]
            </span>
            <span className="font-mohave text-[12px] text-[#597794]">
              {expandedId === entry.id ? "COLLAPSE" : "EXPAND"}
            </span>
          </div>
          {expandedId === entry.id && (
            <div className="px-6 py-4 bg-white/[0.02] border-b border-white/[0.05]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="font-mohave text-[11px] uppercase text-[#6B6B6B] mb-2">OLD DATA</p>
                  <pre className="text-[12px] text-[#A0A0A0] bg-black/50 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                    {entry.old_data ? JSON.stringify(entry.old_data, null, 2) : "(none)"}
                  </pre>
                </div>
                <div>
                  <p className="font-mohave text-[11px] uppercase text-[#6B6B6B] mb-2">NEW DATA</p>
                  <pre className="text-[12px] text-[#A0A0A0] bg-black/50 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                    {entry.new_data ? JSON.stringify(entry.new_data, null, 2) : "(none)"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      {entries.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
            No audit log entries (table may not exist)
          </p>
        </div>
      )}
    </div>
  );
}

function DataQualityTab({ issues }: { issues: DataQualityIssue[] }) {
  const SEVERITY_STYLES: Record<string, { dot: string; text: string }> = {
    info: { dot: "bg-[#597794]", text: "text-[#A0A0A0]" },
    warning: { dot: "bg-[#C4A868]", text: "text-[#C4A868]" },
    danger: { dot: "bg-[#93321A]", text: "text-[#93321A]" },
  };

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      {issues.map((issue, i) => {
        const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info;
        return (
          <div key={i} className="flex items-center justify-between px-6 h-14 border-b border-white/[0.05] last:border-0">
            <div className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full ${style.dot}`} />
              <span className={`font-mohave text-[14px] ${style.text}`}>{issue.check}</span>
            </div>
            {issue.count > 0 && (
              <span className="font-mohave text-[14px] text-[#E5E5E5]">{issue.count}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IntegrationsTab({ data }: { data: SystemContentProps["integrations"] }) {
  const items = [
    { label: "Portal Enabled", count: data.portalEnabled, total: data.total },
    { label: "Portal Branding Configured", count: data.brandingConfigured, total: data.total },
    { label: "Gmail Connected", count: data.gmailConnected, total: data.total },
    { label: "Accounting Connected", count: data.accountingConnected, total: data.total },
  ];

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="grid grid-cols-3 px-6 py-3 border-b border-white/[0.08]">
        {["INTEGRATION", "COMPANIES", "ADOPTION"].map((h) => (
          <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
        ))}
      </div>
      {items.map((item) => {
        const pct = item.total > 0 ? Math.round((item.count / item.total) * 100) : 0;
        return (
          <div key={item.label} className="grid grid-cols-3 px-6 items-center h-14 border-b border-white/[0.05] last:border-0">
            <span className="font-mohave text-[14px] text-[#E5E5E5]">{item.label}</span>
            <span className="font-mohave text-[14px] text-[#A0A0A0]">
              {item.count} / {item.total}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#597794] rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="font-mohave text-[13px] text-[#A0A0A0]">{pct}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DatabaseTab({ stats }: { stats: TableStats[] }) {
  const totalRows = stats.reduce((s, t) => s + t.rowCount, 0);

  return (
    <div className="space-y-4">
      <div className="border border-white/[0.08] rounded-lg p-4 inline-flex items-center gap-4">
        <span className="font-mohave text-[13px] uppercase text-[#6B6B6B]">Total Rows</span>
        <span className="font-mohave text-2xl text-[#E5E5E5]">{totalRows.toLocaleString()}</span>
        <span className="font-mohave text-[13px] uppercase text-[#6B6B6B]">across {stats.length} tables</span>
      </div>

      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-3 px-6 py-3 border-b border-white/[0.08]">
          {["TABLE", "ROWS", "% OF TOTAL"].map((h) => (
            <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
          ))}
        </div>
        {stats.map((t) => {
          const pct = totalRows > 0 ? Math.round((t.rowCount / totalRows) * 100) : 0;
          return (
            <div key={t.table} className="grid grid-cols-3 px-6 items-center h-12 border-b border-white/[0.05] last:border-0">
              <span className="font-mohave text-[14px] text-[#E5E5E5] font-mono">{t.table}</span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{t.rowCount.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#597794] rounded-full"
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
                <span className="font-mohave text-[12px] text-[#6B6B6B]">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
