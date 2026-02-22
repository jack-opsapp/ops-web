const PLAN_COLORS: Record<string, string> = {
  trial: "#A0A0A0",
  starter: "#9DB582",
  team: "#8195B5",
  business: "#C4A868",
};

export function PlanBadge({ plan }: { plan: string }) {
  const color = PLAN_COLORS[plan?.toLowerCase()] ?? "#6B6B6B";
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full font-mohave text-[12px] uppercase border"
      style={{
        color,
        borderColor: color,
        backgroundColor: `${color}1f`,
      }}
    >
      {plan ?? "—"}
    </span>
  );
}
