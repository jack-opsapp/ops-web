import type { ReactNode } from "react";
import { OpsLockup } from "@/components/brand";
import type { HostedCompany } from "@/lib/customer-identity/hosted-company";
import type { CustomerCopy } from "@/lib/customer-identity/hosted-format";
import { buildHostedThemeStyle } from "@/lib/customer-identity/hosted-theme";

interface CustomerShellProps {
  company: HostedCompany;
  copy: CustomerCopy;
  children: ReactNode;
}

/**
 * The frame every hosted customer page shares: the business's letterhead at
 * the top of a single left-aligned column, the page content beneath a
 * hairline, and a quiet "powered by OPS" line pinned to the bottom.
 *
 * Server component. Color arrives as CSS custom properties on the root
 * (`buildHostedThemeStyle`); everything else is OPS tokens.
 */
export function CustomerShell({ company, copy, children }: CustomerShellProps) {
  return (
    <div
      className="customer-shell min-h-screen flex flex-col"
      style={buildHostedThemeStyle(company.branding)}
      data-customer-theme={company.branding.themeMode}
    >
      <div className="flex-1 flex flex-col px-3 pt-5 sm:px-5 sm:pt-8">
        <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center">
          <header className="flex items-center gap-2 pb-3 border-b cs-line">
            {company.logoUrl ? (
              // Plain <img>: customer logos are company-uploaded and may live on
              // hosts outside next.config's remotePatterns; next/image would throw.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logoUrl}
                alt=""
                className="h-5 w-auto max-w-full object-contain shrink-0"
                decoding="async"
              />
            ) : null}
            <span className="min-w-0 truncate font-cakemono font-light text-cake-section uppercase tracking-widest cs-text">
              {company.name}
            </span>
          </header>

          <main className="pt-4 pb-6">{children}</main>
        </div>
      </div>

      <footer className="px-3 pb-3 sm:px-5 sm:pb-5">
        <div className="w-full max-w-sm mx-auto">
          <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-widest cs-text-2">
            {copy["brand.poweredBy"]}
            <OpsLockup
              orientation="horizontal"
              title={copy["brand.ops"]}
              className="h-icon-24 w-auto"
            />
          </span>
        </div>
      </footer>
    </div>
  );
}
