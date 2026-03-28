"use client";

import * as React from "react";
import { useFormContext, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface FormSelectOption {
  value: string;
  label: string;
}

export interface FormSelectProps<T extends FieldValues = FieldValues> {
  name: FieldPath<T>;
  label?: string;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  options: FormSelectOption[];
  disabled?: boolean;
  containerClassName?: string;
  className?: string;
}

function FormSelect<T extends FieldValues = FieldValues>({
  name,
  label,
  placeholder = "Select...",
  helperText,
  required = false,
  options,
  disabled = false,
  containerClassName,
  className,
}: FormSelectProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();

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
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select
            value={field.value as string}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <SelectTrigger
              id={fieldId}
              className={cn(
                errorMessage && "border-ops-error focus:border-ops-error focus:shadow-glow-error",
                className
              )}
              aria-invalid={errorMessage ? "true" : undefined}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
FormSelect.displayName = "FormSelect";

export { FormSelect };
