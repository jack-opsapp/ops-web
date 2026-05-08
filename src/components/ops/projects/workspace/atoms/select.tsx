import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// `Select` — workspace value/options wrapper around Radix Select. Symmetric
// API with `TextInput` / `TextArea` (single component, value/onChange/options
// props) so `Field` consumers don't case-split on input type. Behaviour
// delegates entirely to Radix.
//
// Reuses the existing `<SelectContent>`/`<SelectItem>` styling rules from
// `src/components/ui/select.tsx` (glass-dense menu, rounded-chip items)
// so the workspace dropdown reads as a sibling of the rest of the app.

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Field clones in id, aria-describedby, aria-invalid. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  id,
  className,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        className={cn(
          "flex w-full h-8 items-center justify-between gap-1 px-2",
          "font-mohave text-[14px] leading-[1.4] text-text",
          "bg-[rgba(255,255,255,0.04)]",
          "rounded-[5px] border border-glass-border",
          "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:border-glass-border-medium",
          "focus:outline-none focus:border-glass-border-strong",
          "disabled:cursor-not-allowed disabled:opacity-40",
          "aria-[invalid=true]:border-[var(--rose-line)]",
          "aria-[invalid=true]:focus:border-[var(--rose)]",
          "[&[data-placeholder]]:text-text-mute",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 text-text-3 shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "relative z-[60] overflow-hidden",
            "min-w-[var(--radix-select-trigger-width)] max-h-[300px]",
            "bg-[var(--glass-dense)] backdrop-blur-[28px]",
            "rounded-[8px] border border-glass-border",
            "p-0.5",
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center",
                  "rounded-chip py-1.5 pl-6 pr-2",
                  "font-mohave text-[14px] text-text",
                  "outline-none transition-colors duration-100",
                  "focus:bg-[rgba(255,255,255,0.06)]",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
                )}
              >
                <span className="absolute left-1.5 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-3.5 w-3.5 text-ops-accent" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
Select.displayName = "Select";
