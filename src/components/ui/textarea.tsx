import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id || generatedId;

    return (
      <div className="flex flex-col gap-0.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest"
          >
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          className={cn(
            "w-full bg-background-input text-text-primary font-mohave text-body",
            "px-1.5 py-1.5 rounded-lg",
            "border border-border",
            "transition-all duration-150",
            "placeholder:text-text-tertiary",
            "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
            "disabled:cursor-not-allowed disabled:opacity-40",
            "min-h-[80px] resize-y",
            error && "border-ops-error focus:border-ops-error focus:shadow-glow-error",
            className
          )}
          ref={ref}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={
            error ? `${textareaId}-error` : helperText ? `${textareaId}-helper` : undefined
          }
          {...props}
        />
        {error && (
          <p id={`${textareaId}-error`} className="text-caption-sm text-ops-error font-mohave" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${textareaId}-helper`} className="text-caption-sm text-text-tertiary font-mohave">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
