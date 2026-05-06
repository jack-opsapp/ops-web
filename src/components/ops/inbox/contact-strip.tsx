"use client";

import { Building2, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ContactStripProps {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  className?: string;
}

const linkClass =
  "inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-text-3 hover:text-text-2 transition-colors";

export function ContactStrip({
  phone,
  email,
  address,
  className,
}: ContactStripProps) {
  if (!phone && !email && !address) return null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-inbox-bg px-[18px] py-2",
        className,
      )}
    >
      {phone && (
        <a className={linkClass} href={`tel:${phone}`}>
          <Phone aria-hidden className="h-[11px] w-[11px] text-text-mute" strokeWidth={1.75} />
          {phone}
        </a>
      )}
      {email && (
        <a className={linkClass} href={`mailto:${email}`}>
          <Mail aria-hidden className="h-[11px] w-[11px] text-text-mute" strokeWidth={1.75} />
          {email}
        </a>
      )}
      {address && (
        <span className={linkClass}>
          <Building2 aria-hidden className="h-[11px] w-[11px] text-text-mute" strokeWidth={1.75} />
          {address}
        </span>
      )}
    </div>
  );
}
