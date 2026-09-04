import { ArrowUpRight } from "lucide-react";

import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";

interface CredentialIssuingProps {
  copy: ExternalApiDocsCopy;
}

/**
 * Deep link into the OPS settings shell. The shell keeps section state in
 * `?section=<leaf>` (see `settings-shell.tsx`); `website` is the leaf id
 * registered in `settings-domains.tsx` under the Comms domain.
 */
export const WEBSITE_SETTINGS_PATH = "/settings?section=website";

const STEPS = [
  {
    title: "credentialStepRegisterTitle",
    action: "credentialStepRegisterAction",
    body: "credentialStepRegisterBody",
  },
  {
    title: "credentialStepIssueTitle",
    action: "credentialStepIssueAction",
    body: "credentialStepIssueBody",
  },
  {
    title: "credentialStepSecretTitle",
    action: "credentialStepSecretAction",
    body: "credentialStepSecretBody",
  },
] as const;

export function CredentialIssuing({ copy }: CredentialIssuingProps) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-10">
      <div className="lg:col-span-6">
        <h2 className="font-cakemono text-cake-section uppercase text-text">
          {copy.credentialTitle}
        </h2>
        <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
          {copy.credentialBody}
        </p>
        <ol className="mt-3 border-l border-line">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative pb-3 pl-3 last:pb-0">
              <span className="absolute -left-1.5 top-0 flex h-3 w-3 items-center justify-center rounded-chip border border-line bg-background font-mono text-micro text-text-2">
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-2">
                <h3 className="font-cakemono text-cake-button uppercase text-text">
                  {copy[step.title]}
                </h3>
                <code className="font-mono text-micro uppercase tracking-wider text-text-2">
                  {copy[step.action]}
                </code>
              </div>
              <p className="mt-0.5 max-w-3xl font-mohave text-body-sm text-text-2">
                {copy[step.body]}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-4 border-y border-line py-2">
          <h3 className="font-cakemono text-cake-button uppercase text-text">
            {copy.credentialAnalyticsTitle}
          </h3>
          <p className="mt-0.5 max-w-3xl font-mohave text-body-sm text-text-2">
            {copy.credentialAnalyticsBody}
          </p>
        </div>
      </div>
      <div className="self-start rounded-modal border border-glass-border bg-glass-dense p-2 lg:sticky lg:top-8 lg:col-span-4">
        <dl className="divide-y divide-line">
          <div className="pb-2">
            <dt className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.credentialIssuerLabel}
            </dt>
            <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
              {copy.credentialIssuerValue}
            </dd>
          </div>
          <div className="py-2">
            <dt className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.credentialLocationLabel}
            </dt>
            <dd className="mt-0.5 font-mono text-data-sm text-text">
              {copy.credentialLocationValue}
            </dd>
          </div>
        </dl>
        <a
          href={WEBSITE_SETTINGS_PATH}
          className="mt-2 inline-flex min-h-control-36 items-center gap-1 rounded border border-line px-2 font-cakemono text-cake-button uppercase text-text-2 transition-colors duration-150 ease-smooth hover:border-text-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {copy.credentialOpenSettings}
          <ArrowUpRight aria-hidden className="h-icon-16 w-icon-16" />
        </a>
        <p className="mt-1 font-mohave text-body-sm text-text-3">
          {copy.credentialOpenSettingsHint}
        </p>
      </div>
    </div>
  );
}
