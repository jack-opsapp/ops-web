export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="w-full rounded-lg bg-white/[0.03] animate-pulse"
      style={{ height }}
    >
      <div className="h-full flex items-end justify-between px-4 pb-4 gap-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-white/[0.05] rounded-t"
            style={{
              height: `${20 + Math.sin(i * 0.8) * 30 + Math.random() * 20}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
