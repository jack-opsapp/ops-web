import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Field` — label + child + optional/required/hint/error wrapper.
// Owns the workspace label voice (Mono uppercase 11px tracked-out, the
// design-system label tier). Auto-generates an id and clones the child to
// inject:
//   - the wired `id`
//   - `aria-describedby` pointing at the hint or error text
//   - `aria-invalid` when an error is present
//
// Children stay agnostic of label semantics — TextInput, TextArea, Select,
// Segmented, or any custom control all work without their own label logic.

export interface FieldProps {
  label: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  /** Forwarded onto the wrapper div for parent-driven testing / styling. */
  "data-testid"?: string;
  children: React.ReactElement;
}

export function Field({
  label,
  optional,
  required,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldProps) {
  const reactId = React.useId();
  // Allow the child to declare its own id; otherwise fall back to the
  // generated one so the label binds correctly either way.
  const childId =
    (children.props as { id?: string }).id ?? `field-${reactId}`;

  const hintId = hint ? `${childId}-hint` : undefined;
  const errorId = error ? `${childId}-error` : undefined;
  const describedBy = errorId ?? hintId;

  // Clone the child to inject id, aria-describedby, aria-invalid. Use a
  // shallow merge — caller's existing aria attrs win nothing here because
  // Field is the source of truth for these specific bindings.
  const enhancedChild = React.cloneElement(children, {
    id: childId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? "true" : undefined,
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      data-testid={rest["data-testid"]}
    >
      <label
        htmlFor={childId}
        className={cn(
          "font-mono uppercase tracking-[0.18em] text-text-3",
          "text-[11px] leading-[1.3]",
          "inline-flex items-center gap-1",
        )}
      >
        {label}
        {required && (
          <span className="text-[var(--rose)]" aria-hidden="true">
            *
          </span>
        )}
        {optional && (
          <span className="text-text-mute lowercase tracking-normal">
            [optional]
          </span>
        )}
      </label>

      {enhancedChild}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="font-mono text-[10px] leading-[1.3] text-[var(--rose)]"
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className="font-mono text-[10px] leading-[1.3] text-text-mute"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
Field.displayName = "Field";
