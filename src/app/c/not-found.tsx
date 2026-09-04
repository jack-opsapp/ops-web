import { OpsLockup } from "@/components/brand";
import { getCustomerCopy, resolveCustomerLocale } from "@/lib/customer-identity/hosted-copy";

/**
 * Rendered for any `/c/<handle>` that does not resolve — malformed, unknown,
 * or a company that no longer exists. One page for all three, so the URL
 * never confirms or denies anything about a business.
 */
export default async function HostedNotFound() {
  const locale = await resolveCustomerLocale();
  const copy = getCustomerCopy(locale);

  return (
    <div className="min-h-screen bg-background text-text flex flex-col">
      <div className="flex-1 flex flex-col px-3 pt-5 sm:px-5 sm:pt-8">
        <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center gap-1">
          <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest text-text leading-none">
            {copy["notFound.title"]}
          </h1>
          <p className="font-mohave text-body text-text-2">{copy["notFound.body"]}</p>
        </div>
      </div>
      <footer className="px-3 pb-3 sm:px-5 sm:pb-5">
        <div className="w-full max-w-sm mx-auto">
          <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-widest text-text-2">
            {copy["brand.poweredBy"]}
            <OpsLockup orientation="horizontal" title={copy["brand.ops"]} className="h-icon-24 w-auto" />
          </span>
        </div>
      </footer>
    </div>
  );
}
