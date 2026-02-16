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
            className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {prefixIcon && (
            <div className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
              {prefixIcon}
            </div>
          )}
          <input
            type={type}
            id={inputId}
            className={cn(
              "w-full bg-background-input text-text-primary font-mohave text-body",
              "px-1.5 py-1.5 rounded-lg",
              "border border-border",
              "transition-all duration-150",
              "placeholder:text-text-tertiary",
              "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
              "disabled:cursor-not-allowed disabled:opacity-40",
              prefixIcon && "pl-5",
              suffixIcon && "pr-5",
              error && "border-ops-error focus:border-ops-error focus:shadow-glow-error",
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
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-tertiary">
              {suffixIcon}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-caption-sm text-ops-error font-mohave" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="text-caption-sm text-text-tertiary font-mohave">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
