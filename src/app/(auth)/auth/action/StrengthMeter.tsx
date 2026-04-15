"use client";

import * as React from "react";
import { zxcvbnOptions, zxcvbn } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import { handlerCopy } from "./copy";

// Configure zxcvbn once at module load
zxcvbnOptions.setOptions({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

interface StrengthMeterProps {
  password: string;
}

interface StrengthState {
  score: number;
  segments: number;
  label: string;
  passes: boolean;
}

export function scoreStrength(password: string): StrengthState {
  if (password.length < 4) {
    return {
      score: 0,
      segments: 0,
      label: handlerCopy.reset.strengthTooShort,
      passes: false,
    };
  }
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

export function StrengthMeter({ password }: StrengthMeterProps) {
  const strength = React.useMemo(() => scoreStrength(password), [password]);
  const tone =
    strength.segments <= 1
      ? "error"
      : strength.segments <= 4
      ? "dim"
      : strength.segments <= 7
      ? "accent"
      : "success";
  const colorFor = (filled: boolean) =>
    !filled
      ? "rgba(255,255,255,0.08)"
      : tone === "error"
      ? "#93321A"
      : tone === "dim"
      ? "#555555"
      : tone === "accent"
      ? "#597794"
      : "#A5B368";
  return (
    <div className="flex items-center gap-3 mt-2" aria-live="polite">
      <div className="flex gap-[2px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-[4px] w-2 rounded-sm transition-colors duration-200"
            style={{ background: colorFor(i < strength.segments) }}
          />
        ))}
      </div>
      <span
        className="font-kosugi uppercase text-text-tertiary"
        style={{ fontSize: "10px", letterSpacing: "1px", lineHeight: 1 }}
      >
        {strength.label}
      </span>
    </div>
  );
}
