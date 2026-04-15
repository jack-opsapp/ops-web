"use client";

import * as React from "react";

interface HandlerShellProps {
  eyebrow: string;
  children: React.ReactNode;
}

export function HandlerShell({ eyebrow, children }: HandlerShellProps) {
  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center px-4 py-8"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 20%, rgba(89,119,148,0.03) 0%, transparent 60%)",
      }}
    >
      <div className="w-full max-w-[420px] flex flex-col items-center">
        <div
          className="font-mohave text-white font-bold uppercase mb-8"
          style={{ fontSize: "18px", letterSpacing: "4px" }}
        >
          OPS
        </div>
        <div
          className="w-full rounded-[5px] p-8"
          style={{
            background: "rgba(10, 10, 10, 0.70)",
            backdropFilter: "blur(20px) saturate(1.2)",
            WebkitBackdropFilter: "blur(20px) saturate(1.2)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}
        >
          <div
            className="font-kosugi uppercase text-text-tertiary mb-6"
            style={{
              fontSize: "11px",
              letterSpacing: "1.5px",
              lineHeight: "14px",
            }}
          >
            {eyebrow}
          </div>
          {children}
        </div>
        <p
          className="font-mohave text-text-disabled mt-6 text-center"
          style={{ fontSize: "12px", lineHeight: "18px" }}
        >
          Trouble? Tap <span className="text-text-secondary">Open OPS</span>.
        </p>
      </div>
    </div>
  );
}
