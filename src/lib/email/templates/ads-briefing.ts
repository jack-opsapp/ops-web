/**
 * Google Ads Intelligence Briefing — Email Template
 * Dark theme, dense, scannable. Act on it or click through.
 */
import type { AdBriefing } from "@/lib/admin/briefing-types";
import { getAppUrl } from "@/lib/utils/app-url";

function formatDelta(value: number): string {
  const pct = (value * 100).toFixed(1);
  return value > 0 ? `\u2191${pct}%` : value < 0 ? `\u2193${Math.abs(Number(pct))}%` : "\u2192 flat";
}

function priorityColor(p: string): string {
  return p === "high" ? "#93321A" : p === "medium" ? "#C4A868" : "#6B6B6B";
}

export function adsBriefingTemplate(briefing: AdBriefing): string {
  const perf = briefing.performance_data;
  const actions = briefing.action_items.slice(0, 3);
  const appUrl = getAppUrl();

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:'Courier New',monospace;color:#E5E5E5;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">

    <div style="border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:16px;margin-bottom:24px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;">
        OPS INTEL // GOOGLE ADS WEEKLY
      </span>
      <br/>
      <span style="font-size:12px;color:#6B6B6B;">
        ${briefing.period_start} \u2014 ${briefing.period_end}
      </span>
    </div>

    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;line-height:1.5;color:#E5E5E5;">
        ${briefing.summary ?? "Briefing summary unavailable."}
      </p>
    </div>

    <div style="margin-bottom:24px;">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;margin:0 0 12px 0;">
        THIS WEEK'S ACTIONS
      </p>
      ${actions.map((a, i) => `
        <div style="margin-bottom:8px;padding:8px 12px;border-left:2px solid ${priorityColor(a.priority)};">
          <span style="font-size:13px;color:#E5E5E5;">
            ${i + 1}. <span style="color:${priorityColor(a.priority)};text-transform:uppercase;font-size:11px;">[${a.priority}]</span>
            ${a.action}
          </span>
          <br/>
          <span style="font-size:11px;color:#6B6B6B;">${a.expectedImpact} \u00b7 ${a.effort}</span>
        </div>
      `).join("")}
    </div>

    ${perf ? `
    <div style="margin-bottom:24px;">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;margin:0 0 12px 0;">
        KEY METRICS
      </p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">Spend</td>
          <td style="padding:4px 8px;color:#E5E5E5;">$${perf.current.spend.toFixed(0)}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.spend)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">CPA</td>
          <td style="padding:4px 8px;color:#E5E5E5;">$${perf.current.cpa.toFixed(2)}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.cpa)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">Conv.</td>
          <td style="padding:4px 8px;color:#E5E5E5;">${perf.current.conversions}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.conversions)}</td>
        </tr>
      </table>
    </div>
    ` : ""}

    <div style="text-align:center;margin-top:32px;">
      <a href="${appUrl}/admin/google-ads/briefings/${briefing.id}"
         style="display:inline-block;padding:10px 24px;background:#597794;color:#E5E5E5;text-decoration:none;font-size:13px;border-radius:4px;text-transform:uppercase;letter-spacing:0.05em;">
        View Full Briefing
      </a>
    </div>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <span style="font-size:10px;color:#444444;">OPS LTD \u00b7 Automated Intelligence Briefing</span>
    </div>

  </div>
</body>
</html>`;
}
