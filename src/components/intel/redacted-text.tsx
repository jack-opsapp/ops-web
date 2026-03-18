"use client";

import { cn } from "@/lib/utils/cn";

interface RedactedTextProps {
  children: string;
  className?: string;
}

export function RedactedText({ children, className }: RedactedTextProps) {
  const parts = children.split(/(█+)/g);

  return (
    <span className={cn("font-mohave", className)}>
      {parts.map((part, i) =>
        part.startsWith("█") ? (
          <span
            key={i}
            className="inline-block rounded-[1px] mx-0.5"
            style={{
              background: "#1a1a1a",
              boxShadow: "0 0 8px rgba(89, 119, 148, 0.3)",
              width: `${part.length * 0.5}em`,
              height: "1em",
              verticalAlign: "middle",
            }}
          />
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}
