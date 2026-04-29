import type { Metadata } from "next";

export const metadata: Metadata = {
  other: {
    "apple-itunes-app": "app-id=6746662078",
  },
};

export default function OpenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
