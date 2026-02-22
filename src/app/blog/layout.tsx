import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog | OPS",
  description:
    "Insights, guides, and strategies for trade businesses — from the OPS team.",
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-[#0D0D0D]">{children}</div>;
}
