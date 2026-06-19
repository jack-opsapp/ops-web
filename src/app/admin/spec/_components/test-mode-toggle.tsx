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
            ? "border-tan/40 bg-tan/12 text-tan"
            : "border-white/[0.10] bg-transparent text-text-3 hover:bg-white/[0.05] hover:text-text"
        } ${pending ? "opacity-50" : ""}`}
      >
        <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.18em] text-current/70">
          {"//"}
        </span>
        <span className="font-mono">TEST MODE</span>
        <span
          aria-hidden="true"
          className={`inline-block h-[6px] w-[6px] rounded-full ${
            enabled ? "bg-tan" : "bg-text-mute"
          }`}
        />
      </button>
    </form>
  );
}
