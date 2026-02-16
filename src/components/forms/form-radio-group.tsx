"use client";

import * as React from "react";
import { useFormContext, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormRadioGroupProps<T extends FieldValues = FieldValues> {
  name: FieldPath<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  options: RadioOption[];
  orientation?: "horizontal" | "vertical";
  disabled?: boolean;
  containerClassName?: string;
  className?: string;
}

function FormRadioGroup<T extends FieldValues = FieldValues>({
  name,
  label,
  helperText,
  required = false,
  options,
  orientation = "vertical",
  disabled = false,
  containerClassName,
  className,
}: FormRadioGroupProps<T>) {
  const { control, formState: { errors } } = useFormContext<T>();

  const groupId = React.useId();
  const error = errors[name];
  const errorMessage = error?.message as string | undefined;

  return (
    <div className={cn("flex flex-col gap-0.5", containerClassName)}>
      {label && (
        <Label id={`${groupId}-label`}>
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
          <div
            role="radiogroup"
            aria-labelledby={label ? `${groupId}-label` : undefined}
            aria-invalid={errorMessage ? "true" : undefined}
            className={cn(
              "flex gap-1.5",
              orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
              className
            )}
          >
            {options.map((option) => {
              const optionId = `${groupId}-${option.value}`;
              const isSelected = field.value === option.value;

              return (
                <label
                  key={option.value}
                  htmlFor={optionId}
                  className={cn(
                    "flex items-start gap-1 cursor-pointer group",
                    "rounded p-1 -m-1",
                    "transition-colors duration-150",
                    "hover:bg-background-elevated/50",
                    disabled && "cursor-not-allowed opacity-40"
                  )}
                >
                  <div className="flex items-center justify-center mt-[2px]">
                    <input
                      type="radio"
                      id={optionId}
                      name={name}
                      value={option.value}
                      checked={isSelected}
                      onChange={() => field.onChange(option.value)}
                      disabled={disabled}
                      className="sr-only"
                    />
                    <div
                      className={cn(
                        "h-[18px] w-[18px] rounded-full border-2",
                        "transition-all duration-150",
                        "flex items-center justify-center",
                        isSelected
                          ? "border-ops-accent shadow-glow-accent"
                          : "border-border-medium group-hover:border-ops-accent/50"
                      )}
                    >
                      {isSelected && (
                        <div className="h-[8px] w-[8px] rounded-full bg-ops-accent" />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mohave text-body-sm text-text-primary">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="font-mohave text-caption-sm text-text-tertiary">
                        {option.description}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      />
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
}
FormRadioGroup.displayName = "FormRadioGroup";

export { FormRadioGroup };
