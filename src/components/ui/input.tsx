import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  prefixIcon?: React.ReactNode;
  suffixIcon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helperText, prefixIcon, suffixIcon, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className="flex flex-col gap-0.5">
        {label && (
          <label
            htmlFor={inputId}
            className="font-mohave text-caption-sm text-text-tertiary uppercase tracking-[0.08em]"
          >
            {label}
          </label>
        )}
        <div
          className={cn(
            "flex items-center gap-2 bg-background-input rounded-sm min-h-[56px]",
            "border border-[rgba(255,255,255,0.08)]",
            "transition-all duration-150",
            "focus-within:border-ops-accent",
            error && "border-ops-error focus-within:border-ops-error",
            prefixIcon ? "pl-3" : "pl-2",
            suffixIcon ? "pr-3" : "pr-2",
          )}
        >
          {prefixIcon && (
            <div className="text-text-tertiary shrink-0 pointer-events-none [&_svg]:w-3.5 [&_svg]:h-3.5">
              {prefixIcon}
            </div>
          )}
          <input
            type={type}
            id={inputId}
            className={cn(
              "flex-1 min-w-0 bg-transparent text-text-primary font-mohave text-body",
              "py-1.5 outline-none caret-ops-accent",
              "placeholder:text-text-disabled",
              "disabled:cursor-not-allowed disabled:opacity-40",
              className
            )}
            ref={ref}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={
              error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
            }
            {...props}
          />
          {suffixIcon && (
            <div className="text-text-tertiary shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
              {suffixIcon}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-caption-sm text-ops-error font-kosugi" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="text-caption-sm text-text-disabled font-kosugi">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
