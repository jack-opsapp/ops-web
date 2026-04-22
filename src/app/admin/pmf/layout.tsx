import type { ReactNode } from "react";

export default function PmfLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pmf-scope min-h-screen" style={{ padding: "36px 44px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        {children}
      </div>
    </div>
  );
}
