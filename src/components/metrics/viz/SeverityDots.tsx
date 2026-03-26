"use client";

interface SeverityDotsProps {
  count: number;
  color: string;
  maxDots?: number;
}

export function SeverityDots({ count, color, maxDots = 8 }: SeverityDotsProps) {
  if (count <= 0) return null;

  const dots = Math.min(count, maxDots);

  return (
    <div className="mt-1.5 flex gap-[3px]" role="img" aria-label={`${count} items`}>
      {Array.from({ length: dots }, (_, i) => {
        const height = 12 - ((i / Math.max(dots - 1, 1)) * 6);
        const opacity = 0.9 - (i / Math.max(dots - 1, 1)) * 0.6;

        return (
          <div
            key={i}
            style={{
              width: 8,
              height,
              borderRadius: 1,
              background: color,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}
