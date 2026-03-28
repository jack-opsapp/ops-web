"use client";

import * as React from "react";
import { useFormContext, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface FormFieldProps<T extends FieldValues = FieldValues> {
  name: FieldPath<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  className?: string;
  children: (field: {
    value: unknown;
    onChange: (...event: unknown[]) => void;
    onBlur: () => void;
    name: string;
    ref: React.Ref<unknown>;
    error?: string;
  }) => React.ReactNode;
}

function FormField<T extends FieldValues = FieldValues>({
  name,
  label,
  helperText,
  required = false,
  className,
  children,
}: FormFieldProps<T>) {
  const { control } = useFormContext<T>();
  const fieldId = React.useId();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const errorMessage = fieldState.error?.message;

        return (
          <div className={cn("flex flex-col gap-0.5", className)}>
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
            {children({
              ...field,
              error: errorMessage,
            })}
            {errorMessage && (
              <p className="text-caption-sm text-ops-error font-mohave" role="alert">
                {errorMessage}
              </p>
            )}
            {helperText && !errorMessage && (
              <p className="text-caption-sm text-text-tertiary font-mohave">{helperText}</p>
            )}
          </div>
        );
      }}
    />
  );
}
FormField.displayName = "FormField";

export { FormField };
