"use client";

import * as React from "react";
import Link from "next/link";

export function TemplatesTab() {
  return (
    <div className="rounded-panel border border-white/[0.09] p-8 max-w-[640px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        {"// TEMPLATE REGISTRY"}
      </div>
      <h2 className="mt-2 font-cakemono font-light text-[20px] uppercase tracking-[0.04em] text-[#EDEDED]">
        Versioned email templates
      </h2>
      <p className="mt-3 font-mohave text-[14px] text-[#B5B5B5]">
        Browse all 17 typed templates, preview rendered HTML with arbitrary props,
        view the version timeline (sha256-verified at build time), or send yourself
        a test email.
      </p>
      <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6A6A6A]">
        [hash mismatch on a registered version causes the build to fail]
      </div>
      <Link
        href="/admin/email/templates"
        className="mt-6 inline-block px-5 py-2 border border-ops-accent text-ops-accent font-cakemono font-light text-[12px] uppercase tracking-[0.18em] hover:bg-ops-accent hover:text-black transition-colors rounded-[5px]"
        style={{
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        Open registry
      </Link>
    </div>
  );
}
