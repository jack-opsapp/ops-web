import type { ExternalApiCodeExample } from "@/lib/external-api/docs/code-examples";
import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import type { ExternalApiReferenceOperation } from "@/lib/external-api/docs/reference";

import { CodeExampleTabs } from "./code-example-tabs";
import { SchemaFields } from "./schema-fields";

interface OperationReferenceProps {
  copy: ExternalApiDocsCopy;
  examples: ExternalApiCodeExample[];
  operation: ExternalApiReferenceOperation;
}

export function OperationReference({
  copy,
  examples,
  operation,
}: OperationReferenceProps) {
  const response = operation.successResponses[0];
  if (!response) {
    throw new Error(`Missing success response for ${operation.operationId}`);
  }
  const methodClass =
    operation.method === "get"
      ? "border-olive-line bg-olive-soft text-olive"
      : "border-tan-line bg-tan-soft text-tan";

  return (
    <section
      id={operation.operationId}
      data-operation-id={operation.operationId}
      className="scroll-mt-8 border-b border-line py-6 last:border-b-0"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-10">
        <div className="lg:col-span-6">
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={`rounded-chip border px-1 py-0.5 font-mono text-micro uppercase tracking-wider ${methodClass}`}
            >
              {operation.method}
            </span>
            <code className="break-all font-mono text-data-sm text-text">
              {operation.path}
            </code>
          </div>
          <h3 className="mt-2 font-cakemono text-cake-section uppercase text-text">
            {operation.summary}
          </h3>
          <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
            {operation.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1 border-y border-line py-1">
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.operationScopeLabel}
            </span>
            {operation.requiredScopes.map((scope) => (
              <code
                key={scope}
                className="rounded-chip border border-line bg-surface-input px-1 py-0.5 font-mono text-micro text-text-2"
              >
                {scope}
              </code>
            ))}
          </div>

          {operation.parameters.length > 0 ? (
            <div className="mt-4">
              <h4 className="mb-1 font-cakemono text-cake-button uppercase text-text">
                {copy.parametersTitle}
              </h4>
              <SchemaFields copy={copy} fields={operation.parameters} />
            </div>
          ) : null}

          {operation.request ? (
            <div className="mt-4">
              <h4 className="mb-1 font-cakemono text-cake-button uppercase text-text">
                {copy.requestBodyTitle}
              </h4>
              <SchemaFields copy={copy} fields={operation.request.fields} />
            </div>
          ) : null}

          <div className="mt-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
              <h4 className="font-cakemono text-cake-button uppercase text-text">
                {copy.responseTitle}
              </h4>
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                  {copy.successStatusLabel}
                </span>
                {operation.successResponses.map((success) => (
                  <code
                    key={success.status}
                    className="rounded-chip border border-olive-line bg-olive-soft px-1 py-0.5 font-mono text-micro text-olive"
                  >
                    {success.status}
                  </code>
                ))}
              </div>
            </div>
            <SchemaFields copy={copy} fields={response.fields} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.possibleErrorsLabel}
            </span>
            {operation.errorStatuses.map((status) => (
              <code
                key={status}
                className={
                  status === "429" || status === "503"
                    ? "rounded-chip border border-tan-line bg-tan-soft px-1 py-0.5 font-mono text-micro text-tan"
                    : "rounded-chip border border-rose-line bg-rose-soft px-1 py-0.5 font-mono text-micro text-rose"
                }
              >
                {status}
              </code>
            ))}
          </div>
        </div>
        <div className="self-start lg:sticky lg:top-8 lg:col-span-4">
          <CodeExampleTabs
            copy={copy}
            examples={examples}
            operationSummary={operation.summary}
            responseExample={response.example}
          />
        </div>
      </div>
    </section>
  );
}
