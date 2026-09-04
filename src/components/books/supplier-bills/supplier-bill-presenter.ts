import type { SupplierBillIntakeStage } from "@/lib/accounting/supplier-bills/intake-contracts";

const STREET_WORDS: Record<string, string> = {
  avenue: "ave",
  street: "st",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
};

export interface SupplierBillStageSource {
  review_stage: SupplierBillIntakeStage;
}

export interface SupplierBillProjectOption {
  id: string;
  title: string;
  address: string | null;
}

export function countSupplierBillStages(
  bills: readonly SupplierBillStageSource[]
): Record<SupplierBillIntakeStage, number> {
  const counts: Record<SupplierBillIntakeStage, number> = {
    review: 0,
    to_pay: 0,
    paid: 0,
    held: 0,
    payroll: 0,
  };
  for (const bill of bills) counts[bill.review_stage] += 1;
  return counts;
}

function normalizeLocation(value: string): string {
  return value
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((part) => STREET_WORDS[part] ?? part)
    .join(" ");
}

export function suggestProjectForJobHint(
  jobHint: string | null,
  projects: readonly SupplierBillProjectOption[]
): string | null {
  if (!jobHint || !/^\s*\d{1,6}\b/.test(jobHint)) return null;
  const hint = normalizeLocation(jobHint);
  const [streetNumber, streetName] = hint.split(" ");
  if (!streetNumber || !streetName) return null;
  const matches = projects.filter((project) => {
    const location = normalizeLocation(
      [project.address, project.title].filter(Boolean).join(" ")
    );
    return (
      location.startsWith(`${streetNumber} ${streetName} `) ||
      location.includes(` ${streetNumber} ${streetName} `)
    );
  });
  return matches.length === 1 ? matches[0].id : null;
}

export function buildConfirmedLineAllocations(
  lines: readonly { position: number; total: string }[],
  projectIdByPosition: Readonly<Record<number, string | undefined>>
) {
  return lines.map((line) => {
    const projectId = projectIdByPosition[line.position];
    if (!projectId) {
      throw new Error(`Line ${line.position} needs a confirmed job.`);
    }
    return {
      linePosition: line.position,
      projectId,
      amount: line.total,
      basis: "confirmed_suggestion" as const,
    };
  });
}
