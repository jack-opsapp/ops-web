interface AlertItem {
  severity: "info" | "warning" | "danger";
  title: string;
  detail?: string;
}

const SEVERITY_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  info: { dot: "bg-[#597794]", text: "text-[#A0A0A0]", bg: "" },
  warning: { dot: "bg-[#C4A868]", text: "text-[#C4A868]", bg: "bg-[#C4A868]/5" },
  danger: { dot: "bg-[#93321A]", text: "text-[#93321A]", bg: "bg-[#93321A]/10" },
};

export function AlertList({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) {
    return (
      <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] py-4 text-center">
        No alerts
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {alerts.map((alert, i) => {
        const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
        return (
          <div
            key={i}
            className={`flex items-start gap-3 px-4 py-3 border-b border-white/[0.05] last:border-0 ${style.bg}`}
          >
            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
            <div className="min-w-0">
              <p className={`font-mohave text-[14px] ${style.text}`}>
                {alert.title}
              </p>
              {alert.detail && (
                <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-0.5 truncate">
                  [{alert.detail}]
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
