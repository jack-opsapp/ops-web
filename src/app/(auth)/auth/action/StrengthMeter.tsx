"use client";

import * as React from "react";
import { handlerCopy } from "./copy";

interface StrengthMeterProps {
  password: string;
  onScoreChange?: (score: number, passes: boolean) => void;
}

interface StrengthState {
  score: number;
  segments: number;
  label: string;
  passes: boolean;
}

const NULL_STATE: StrengthState = {
  score: 0,
  segments: 0,
  label: handlerCopy.reset.strengthTooShort,
  passes: false,
};

type ZxcvbnFn = (password: string) => { score: number };

export function StrengthMeter({ password, onScoreChange }: StrengthMeterProps) {
  const [zx, setZx] = React.useState<ZxcvbnFn | null>(null);
  const [state, setState] = React.useState<StrengthState>(NULL_STATE);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
    ]).then(([core, common, en]) => {
      if (cancelled) return;
      core.zxcvbnOptions.setOptions({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      });
      setZx(() => core.zxcvbn);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!zx) {
      setState(NULL_STATE);
      onScoreChange?.(0, false);
      return;
    }
    const handle = window.setTimeout(() => {
      const next = computeStrength(password, zx);
      setState(next);
      onScoreChange?.(next.score, next.passes);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [password, zx, onScoreChange]);

  const tone =
    state.segments <= 1
      ? "error"
      : state.segments <= 4
      ? "dim"
      : state.segments <= 7
      ? "accent"
      : "success";
  const colorFor = (filled: boolean) =>
    !filled
      ? "rgba(255,255,255,0.08)"
      : tone === "error"
      ? "#93321A"
      : tone === "dim"
      ? "#6A6A6A"
      : tone === "accent"
      ? "#6F94B0"
      : "#9DB582";

  return (
    <div className="flex items-center gap-3 mt-2" aria-live="polite">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={state.score}
        aria-label="password strength"
        className="flex gap-[2px]"
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-[4px] w-2 rounded-[2px] transition-colors duration-200"
            style={{ background: colorFor(i < state.segments) }}
          />
        ))}
      </div>
      <span
        className="font-mono uppercase text-text-3"
        style={{ fontSize: "10px", letterSpacing: "0.12em", lineHeight: 1 }}
      >
        {state.label}
      </span>
    </div>
  );
}

function computeStrength(password: string, zxcvbn: ZxcvbnFn): StrengthState {
  if (password.length < 4) return NULL_STATE;
  const { score } = zxcvbn(password);
  const lenBoost = Math.min(password.length / 2, 5);
  const segments = Math.min(10, Math.round(score * 2 + lenBoost));
  const label =
    password.length < 8
      ? handlerCopy.reset.strengthTooShort
      : score <= 1
      ? handlerCopy.reset.strengthWeak
      : score === 2
      ? handlerCopy.reset.strengthOk
      : score === 3
      ? handlerCopy.reset.strengthStrong
      : handlerCopy.reset.strengthStrongest;
  const passes = password.length >= 8 && score >= 2;
  return { score, segments, label, passes };
}
