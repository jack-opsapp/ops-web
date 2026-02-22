const STATUS_COLORS: Record<string, string> = {
  trial: "#A0A0A0",
  active: "#9DB582",
  grace: "#C4A868",
  expired: "#93321A",
  cancelled: "#93321A",
  none: "#4A4A4A",
  unknown: "#6B6B6B",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status?.toLowerCase()] ?? "#6B6B6B";
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full font-mohave text-[12px] uppercase border"
      style={{
        color,
        borderColor: color,
        backgroundColor: `${color}1f`,
      }}
    >
      {status ?? "—"}
    </span>
  );
}
