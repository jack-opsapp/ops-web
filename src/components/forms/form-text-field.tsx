"use client";

import * as React from "react";
import { useFormContext, type FieldPath, type FieldValues } from "react-hook-form";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface FormTextFieldProps<T extends FieldValues = FieldValues>
  extends Omit<InputProps, "name" | "error"> {
  name: FieldPath<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  containerClassName?: string;
}

function FormTextField<T extends FieldValues = FieldValues>({
  name,
  label,
  helperText,
  required = false,
  containerClassName,
  className,
  ...inputProps
}: FormTextFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const fieldId = React.useId();
  const error = errors[name];
  const errorMessage = error?.message as string | undefined;

  return (
    <div className={cn("flex flex-col gap-0.5", containerClassName)}>
      {label && (
        <Label htmlFor={fieldId}>
          {label}
          {required && (
            <span className="text-ops-error ml-[2px]" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      <input
        id={fieldId}
        {...register(name)}
        className={cn(
          "w-full bg-background-input text-text-primary font-mohave text-body",
          "px-1.5 py-1.5 rounded-lg",
          "border border-border",
          "transition-all duration-150",
          "placeholder:text-text-tertiary",
          "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
          "disabled:cursor-not-allowed disabled:opacity-40",
          errorMessage && "border-ops-error focus:border-ops-error focus:shadow-glow-error",
          className
        )}
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={
          errorMessage ? `${fieldId}-error` : helperText ? `${fieldId}-helper` : undefined
        }
        {...inputProps}
      />
      {errorMessage && (
        <p id={`${fieldId}-error`} className="text-caption-sm text-ops-error font-mohave" role="alert">
          {errorMessage}
        </p>
      )}
      {helperText && !errorMessage && (
        <p id={`${fieldId}-helper`} className="text-caption-sm text-text-tertiary font-mohave">
          {helperText}
        </p>
      )}
    </div>
  );
}
FormTextField.displayName = "FormTextField";

export { FormTextField };
