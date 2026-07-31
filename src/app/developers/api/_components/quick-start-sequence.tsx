import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";

interface QuickStartSequenceProps {
  copy: ExternalApiDocsCopy;
}

const STEPS = [
  {
    title: "quickStartConfigTitle",
    body: "quickStartConfigBody",
    path: "GET /v1/intake/config",
  },
  {
    title: "quickStartReserveTitle",
    body: "quickStartReserveBody",
    path: "POST /v1/intake/uploads",
  },
  {
    title: "quickStartUploadTitle",
    body: "quickStartUploadBody",
    path: "PUT {capability.url}",
  },
  {
    title: "quickStartSubmitTitle",
    body: "quickStartSubmitBody",
    path: "POST /v1/intake/submissions",
  },
  {
    title: "quickStartPollTitle",
    body: "quickStartPollBody",
    path: "GET /v1/intake/submissions/{publicSubmissionId}",
  },
] as const;

export function QuickStartSequence({ copy }: QuickStartSequenceProps) {
  return (
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
            <code className="font-mono text-micro text-text-2">
              {step.path}
            </code>
          </div>
          <p className="mt-0.5 max-w-3xl font-mohave text-body-sm text-text-2">
            {copy[step.body]}
          </p>
        </li>
      ))}
    </ol>
  );
}
