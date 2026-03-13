"use client";

import * as React from "react";
import { useFormContext, type FieldPath, type FieldValues } from "react-hook-form";
import { MapPin, Crosshair, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { useGeolocationAddress } from "@/lib/hooks/use-geolocation-address";

export interface AddressAutocompleteProps<T extends FieldValues = FieldValues>
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "name"> {
  name: FieldPath<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  containerClassName?: string;
}

/**
 * Address input with a "Use my location" button that reverse-geocodes
 * the user's current GPS position into a street address.
 */
function AddressAutocomplete<T extends FieldValues = FieldValues>({
  name,
  label,
  helperText,
  required = false,
  containerClassName,
  className,
  placeholder = "123 Main Street, City, State ZIP",
  ...inputProps
}: AddressAutocompleteProps<T>) {
  const {
    register,
    setValue,
    formState: { errors },
  } = useFormContext<T>();

  const fieldId = React.useId();
  const error = errors[name];
  const errorMessage = error?.message as string | undefined;
  const { getAddress, loading: locating } = useGeolocationAddress();

  async function handleLocate() {
    const address = await getAddress();
    if (address) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setValue(name, address as any, { shouldDirty: true, shouldValidate: true });
    }
  }

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
      <div className="relative flex gap-1">
        <div className="relative flex-1">
          <MapPin
            className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[16px] w-[16px] text-text-tertiary pointer-events-none"
            aria-hidden="true"
          />
          <input
            id={fieldId}
            type="text"
            placeholder={placeholder}
            {...register(name)}
            className={cn(
              "w-full bg-background-input text-text-primary font-mohave text-body",
              "pl-5 pr-1.5 py-1.5 rounded",
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
            autoComplete="street-address"
            {...inputProps}
          />
        </div>
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className={cn(
            "flex items-center justify-center w-[36px] shrink-0 rounded",
            "border border-border bg-background-input",
            "text-text-tertiary hover:text-ops-accent hover:border-ops-accent",
            "transition-colors duration-150",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
          title="Use my location"
          aria-label="Auto-fill address from current location"
        >
          {locating ? (
            <Loader2 className="w-[16px] h-[16px] animate-spin" />
          ) : (
            <Crosshair className="w-[16px] h-[16px]" />
          )}
        </button>
      </div>
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
AddressAutocomplete.displayName = "AddressAutocomplete";

export { AddressAutocomplete };
