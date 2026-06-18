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
            className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]"
          >
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          className={cn(
            "w-full bg-surface-input text-text font-mohave text-body",
            "px-1.5 py-1.5 rounded-[5px]",
            "border border-border",
            "transition-all duration-150",
            "placeholder:text-text-3",
            "focus:border-[rgba(255,255,255,0.20)] focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-40",
            "min-h-[80px] resize-y",
            error && "border-rose-line focus:border-rose-line",
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
          <p id={`${textareaId}-error`} className="text-caption-sm text-rose font-mohave" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${textareaId}-helper`} className="text-caption-sm text-text-3 font-mohave">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
