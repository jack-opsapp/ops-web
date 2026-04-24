import type { Metadata } from "next";

/**
 * CALIBRATION layout — pass-through. The parent (dashboard) group layout
 * at src/app/(dashboard)/layout.tsx handles auth + permission gating by
 * mapping /calibration to the email.configure_ai permission in its
 * ROUTE_PERMISSIONS dictionary (see K4 for that wire-up).
 */
export const metadata: Metadata = {
  title: "Calibration · OPS",
};

export default function CalibrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
