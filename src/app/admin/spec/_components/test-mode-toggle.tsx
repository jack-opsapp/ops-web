"use client";

import { useTransition } from "react";
import { toggleSpecTestMode } from "../_actions/toggle-test-mode";

export function TestModeToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const next = !enabled;

  return (
    <form
      action={(formData: FormData) => {
        startTransition(() => {
          toggleSpecTestMode(formData);
        });
      }}
    >
      <input type="hidden" name="enabled" value={next ? "1" : "0"} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={enabled}
        className={`group inline-flex items-center gap-2 rounded-[5px] border px-3 py-[5px] text-[12px] uppercase tracking-[0.12em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          enabled
            ? "border-[#C4A868]/40 bg-[#C4A868]/12 text-[#C4A868]"
            : "border-white/[0.10] bg-transparent text-[#8A8A8A] hover:bg-white/[0.05] hover:text-[#EDEDED]"
        } ${pending ? "opacity-50" : ""}`}
      >
        <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.18em] text-current/70">
          {"//"}
        </span>
        <span className="font-mono">TEST MODE</span>
        <span
          aria-hidden="true"
          className={`inline-block h-[6px] w-[6px] rounded-full ${
            enabled ? "bg-[#C4A868]" : "bg-[#3A3A3A]"
          }`}
        />
      </button>
    </form>
  );
}
