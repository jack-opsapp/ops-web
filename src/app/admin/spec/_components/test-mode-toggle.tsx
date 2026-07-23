"use client";

import { useId, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";
import { toggleSpecTestMode } from "../_actions/toggle-test-mode";

export function TestModeToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const id = useId();

  return (
    <div className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="font-mono text-[10px] tracking-[0.18em] text-text-mute"
      >
        {"//"}
      </span>
      <label
        htmlFor={id}
        className={cn(
          "font-mono text-[12px] uppercase tracking-[0.12em] transition-colors duration-150",
          enabled ? "text-tan" : "text-text-3"
        )}
      >
        TEST MODE
      </label>
      <Switch
        id={id}
        checked={enabled}
        disabled={pending}
        aria-label="Spec test mode"
        onCheckedChange={(next) => {
          const formData = new FormData();
          formData.set("enabled", next ? "1" : "0");
          startTransition(() => toggleSpecTestMode(formData));
        }}
      />
    </div>
  );
}
