"use client";

import { useId, useRef, useState } from "react";

import type { ExternalApiCodeExample } from "@/lib/external-api/docs/code-examples";
import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";

import { CopyCodeButton } from "./copy-code-button";

interface CodeExampleTabsProps {
  copy: ExternalApiDocsCopy;
  examples: ExternalApiCodeExample[];
  operationSummary: string;
  responseExample: unknown;
}

export function CodeExampleTabs({
  copy,
  examples,
  operationSummary,
  responseExample,
}: CodeExampleTabsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const selected = examples[selectedIndex] ?? examples[0];
  if (!selected) return null;

  function select(index: number) {
    const normalized = (index + examples.length) % examples.length;
    setSelectedIndex(normalized);
    tabRefs.current[normalized]?.focus();
  }

  return (
    <section
      aria-label={`${operationSummary} ${copy.requestExampleLabel}`}
      className="overflow-hidden rounded-modal border border-glass-border bg-glass-dense"
      role="region"
    >
      <div className="flex flex-col gap-1 border-b border-line p-1">
        <div
          aria-label={copy.requestExampleLabel}
          className="flex overflow-x-auto"
          role="tablist"
        >
          {examples.map((example, index) => {
            const active = index === selectedIndex;
            return (
              <button
                key={example.language}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`${id}-${example.language}-tab`}
                type="button"
                role="tab"
                aria-controls={`${id}-code-panel`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelectedIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    select(index + 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    select(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    select(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    select(examples.length - 1);
                  }
                }}
                className={
                  active
                    ? "shrink-0 border-b border-text px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent"
                    : "shrink-0 border-b border-transparent px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent motion-reduce:transition-none"
                }
              >
                {example.label}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <CopyCodeButton
            code={selected.code}
            label={copy.copyExampleLabel.replace("{language}", selected.label)}
            copyText={copy.copyAction}
            copiedText={copy.copiedStatus}
            failureText={copy.copyFailedStatus}
          />
        </div>
      </div>
      <div
        id={`${id}-code-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${selected.language}-tab`}
      >
        <pre
          className="max-h-96 overflow-auto p-2 font-mono text-micro text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent"
          tabIndex={0}
        >
          <code>{selected.code}</code>
        </pre>
      </div>
      <div className="border-t border-line">
        <p className="px-2 pt-2 font-mono text-micro uppercase tracking-wider text-text-3">
          {copy.responseExampleLabel}
        </p>
        <pre
          className="max-h-64 overflow-auto p-2 font-mono text-micro text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent"
          tabIndex={0}
        >
          <code>{JSON.stringify(responseExample, null, 2)}</code>
        </pre>
      </div>
    </section>
  );
}
