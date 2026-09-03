import { fillCopy, formatStep, type CustomerCopy } from "@/lib/customer-identity/hosted-format";

interface StepMarkProps {
  /** 1-based position of the current step. */
  step: number;
  total: number;
  /** The step's own name, already uppercase (`EMAIL`, `TIME`, `CODE`). */
  label: string;
  copy: CustomerCopy;
}

/**
 * The hosted surface's progress mark: `STEP 02 / 03` over one filled segment
 * per completed step. Shared by every hosted flow so a visitor who signs in
 * and then books sees the same signature twice.
 */
export function StepMark({ step, total, label, copy }: StepMarkProps) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-micro uppercase tracking-widest cs-text-2">
        <span>
          {fillCopy(copy["step.counter"], {
            step: formatStep(step),
            total: formatStep(total),
          })}
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-1 flex gap-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={
              i < step ? "flex-1 h-0.5 rounded-bar cs-track-fill" : "flex-1 h-0.5 rounded-bar cs-track"
            }
          />
        ))}
      </div>
    </div>
  );
}
