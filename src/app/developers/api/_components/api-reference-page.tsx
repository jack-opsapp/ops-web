import type { ExternalApiCodeExamples } from "@/lib/external-api/docs/code-examples";
import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import type { ExternalApiReference } from "@/lib/external-api/docs/reference";

import { OperationReference } from "./operation-reference";
import { QuickStartSequence } from "./quick-start-sequence";
import { ReferenceHeader } from "./reference-header";
import { ReferenceNavigation } from "./reference-navigation";

interface ApiReferencePageProps {
  copy: ExternalApiDocsCopy;
  reference: ExternalApiReference;
  codeExamples: ExternalApiCodeExamples;
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${Number.isInteger(size) ? size : size.toFixed(1)} ${units[unitIndex]}`;
}

export function ApiReferencePage({
  copy,
  reference,
  codeExamples,
}: ApiReferencePageProps) {
  const intakeOperations = reference.operations.slice(0, 4);
  const analyticsOperations = reference.operations.slice(4);
  const intakeConfig = intakeOperations[0]?.successResponses[0]?.example as
    | {
        result?: {
          acceptedFilePolicy?: {
            contentTypes?: string[];
            maxFiles?: number;
            maxFileBytes?: number;
            maxBatchBytes?: number;
          };
          requestLimits?: {
            maxJsonBodyBytes?: number;
            maxAnswers?: number;
          };
        };
      }
    | undefined;
  const limits = intakeConfig?.result;
  const filePolicy = limits?.acceptedFilePolicy;
  const requestLimits = limits?.requestLimits;

  return (
    <div className="min-h-screen bg-background text-text">
      <ReferenceHeader copy={copy} baseUrl={reference.baseUrl} />
      <div className="mx-auto w-full max-w-screen-2xl px-2 md:px-3 xl:px-4">
        <ReferenceNavigation mobile copy={copy} reference={reference} />
        <div className="xl:grid xl:grid-cols-12">
          <aside className="hidden border-r border-line xl:col-span-2 xl:block">
            <ReferenceNavigation copy={copy} reference={reference} />
          </aside>
          <main className="min-w-0 xl:col-span-10 xl:pl-4">
            <section
              id="overview"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                {copy.overviewKicker}
              </p>
              <h1 className="mt-1 font-cakemono text-cake-display uppercase text-text">
                {copy.overviewTitle}
              </h1>
              <p className="mt-2 max-w-4xl font-mohave text-body-lg text-text-2">
                {copy.overviewDescription}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                <div className="py-2 md:pr-3">
                  <h2 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.overviewBoundaryTitle}
                  </h2>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.overviewBoundaryBody}
                  </p>
                </div>
                <div className="border-t border-line py-2 md:border-l md:border-t-0 md:pl-3">
                  <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                    {copy.overviewOperationsLabel}
                  </p>
                  <p className="mt-0.5 font-mono text-data-lg text-text">
                    {reference.operations.length}
                  </p>
                </div>
              </div>
            </section>

            <section
              id="authentication"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-10">
                <div className="lg:col-span-6">
                  <h2 className="font-cakemono text-cake-section uppercase text-text">
                    {copy.authenticationTitle}
                  </h2>
                  <p className="mt-1 font-mohave text-body text-text-2">
                    {copy.authenticationBody}
                  </p>
                  <div className="mt-3 border-l border-tan-line bg-tan-soft p-2">
                    <p className="font-mono text-micro uppercase tracking-wider text-tan">
                      {copy.serverSideLabel}
                    </p>
                    <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                      {copy.authenticationWarning}
                    </p>
                  </div>
                  <h3 className="mt-4 font-cakemono text-cake-button uppercase text-text">
                    {copy.authenticationScopeLabel}
                  </h3>
                  <dl className="mt-1 divide-y divide-line border-y border-line">
                    <div className="py-2">
                      <dt className="font-mono text-data-sm text-text">
                        intake.write
                      </dt>
                      <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
                        {copy.authenticationIntakeScope}
                      </dd>
                    </div>
                    <div className="py-2">
                      <dt className="font-mono text-data-sm text-text">
                        analytics.leads.read
                      </dt>
                      <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
                        {copy.authenticationAnalyticsScope}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="self-start rounded-modal border border-glass-border bg-glass-dense p-2 lg:sticky lg:top-8 lg:col-span-4">
                  <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                    {copy.authenticationHeaderLabel}
                  </p>
                  <pre
                    className="mt-2 overflow-x-auto font-mono text-data-sm text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent"
                    tabIndex={0}
                  >
                    <code>Authorization: Bearer $OPS_API_TOKEN</code>
                  </pre>
                </div>
              </div>
            </section>

            <section
              id="quick-start"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.quickStartTitle}
              </h2>
              <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
                {copy.quickStartDescription}
              </p>
              <QuickStartSequence copy={copy} />
            </section>

            <section
              id="lead-intake"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.leadIntakeTitle}
              </h2>
              <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
                {copy.leadIntakeDescription}
              </p>
            </section>
            {intakeOperations.map((operation) => (
              <OperationReference
                key={operation.operationId}
                copy={copy}
                operation={operation}
                examples={codeExamples[operation.operationId]}
              />
            ))}

            <section
              id="lead-analytics"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.leadAnalyticsTitle}
              </h2>
              <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
                {copy.leadAnalyticsDescription}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                <div className="py-2 md:pr-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.leadSyncTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.leadSyncBody}
                  </p>
                </div>
                <div className="border-t border-line py-2 md:border-l md:border-t-0 md:pl-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.financialScopeTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.financialScopeBody}
                  </p>
                </div>
              </div>
            </section>
            {analyticsOperations.map((operation) => (
              <OperationReference
                key={operation.operationId}
                copy={copy}
                operation={operation}
                examples={codeExamples[operation.operationId]}
              />
            ))}

            <section
              id="errors"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.errorsTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.errorsBody}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                <div className="py-2 md:pr-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.errorsRetryTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.errorsRetryBody}
                  </p>
                </div>
                <div className="border-t border-line py-2 md:border-l md:border-t-0 md:pl-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.errorsConflictTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.errorsConflictBody}
                  </p>
                </div>
              </div>
            </section>

            <section
              id="limits"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.limitsTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.limitsBody}
              </p>
              <dl className="mt-4 grid grid-cols-1 border-y border-line sm:grid-cols-2 lg:grid-cols-3">
                {[
                  [
                    copy.acceptedTypesLabel,
                    filePolicy?.contentTypes?.join(", ") ?? copy.noneValue,
                  ],
                  [
                    copy.maxFilesLabel,
                    filePolicy?.maxFiles?.toLocaleString() ?? copy.noneValue,
                  ],
                  [
                    copy.maxFileSizeLabel,
                    filePolicy?.maxFileBytes
                      ? formatBytes(filePolicy.maxFileBytes)
                      : copy.noneValue,
                  ],
                  [
                    copy.maxBatchSizeLabel,
                    filePolicy?.maxBatchBytes
                      ? formatBytes(filePolicy.maxBatchBytes)
                      : copy.noneValue,
                  ],
                  [
                    copy.maxJsonSizeLabel,
                    requestLimits?.maxJsonBodyBytes
                      ? formatBytes(requestLimits.maxJsonBodyBytes)
                      : copy.noneValue,
                  ],
                  [
                    copy.maxAnswersLabel,
                    requestLimits?.maxAnswers?.toLocaleString() ??
                      copy.noneValue,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border-b border-line p-2 last:border-b-0 sm:border-r lg:[&:nth-child(3n)]:border-r-0"
                  >
                    <dt className="font-mono text-micro uppercase tracking-wider text-text-3">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono text-data-sm text-text">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                <div className="py-2 md:pr-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.limitsCredentialTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.limitsCredentialBody}
                  </p>
                </div>
                <div className="border-t border-line py-2 md:border-l md:border-t-0 md:pl-3">
                  <h3 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.limitsDataTitle}
                  </h3>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.limitsDataBody}
                  </p>
                </div>
              </div>
            </section>

            <section id="resources" className="scroll-mt-8 py-6">
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.resourcesTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.resourcesBody}
              </p>
              <a
                href="/developers/api/openapi.json"
                download
                className="mt-4 block border-y border-line py-2 text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-input hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="font-cakemono text-cake-button uppercase">
                  {copy.openApiResourceTitle}
                </span>
                <span className="mt-0.5 block font-mohave text-body-sm">
                  {copy.openApiResourceBody}
                </span>
              </a>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
