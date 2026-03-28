"use client";

import * as React from "react";
import { useFormContext, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

export interface FormToggleProps<T extends FieldValues = FieldValues> {
  name: FieldPath<T>;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  className?: string;
}

function FormToggle<T extends FieldValues = FieldValues>({
  name,
  title,
  subtitle,
  disabled = false,
  className,
}: FormToggleProps<T>) {
  const { control } = useFormContext<T>();
  const fieldId = React.useId();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div
          className={cn(
            "flex items-center justify-between gap-2 py-1.5",
            className
          )}
        >
          <div className="flex flex-col gap-[2px]">
            <label
              htmlFor={fieldId}
              className="font-mohave text-body text-text-primary cursor-pointer"
            >
              {title}
            </label>
            {subtitle && (
              <span className="font-mohave text-caption-sm text-text-tertiary">
                {subtitle}
              </span>
            )}
          </div>
          <Switch
            id={fieldId}
            checked={!!field.value}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
        </div>
      )}
    />
  );
}
FormToggle.displayName = "FormToggle";

export { FormToggle };
