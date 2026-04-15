"use client";

import * as React from "react";
import { handlerCopy } from "./copy";

export type ErrorKind =
  | "malformed"
  | "expired"
  | "alreadyUsed"
  | "userDisabled"
  | "network"
  | "unknown";

interface HandlerErrorProps {
  kind: ErrorKind;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export function HandlerError({
  kind,
  onPrimary,
  onSecondary,
}: HandlerErrorProps) {
  const c = handlerCopy.errors[kind];
  const secondary =
    "secondaryCta" in c ? (c as { secondaryCta?: string }).secondaryCta : undefined;
  return (
    <div>
      <h1
        className="font-mohave text-text-primary mb-2"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {c.headline}
      </h1>
      <p
        className="font-mohave text-text-secondary mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        {c.body}
      </p>
      <button
        type="button"
        onClick={onPrimary}
        className="w-full rounded-sm font-kosugi uppercase"
        style={{
          minHeight: "60px",
          background: "#597794",
          color: "#FFFFFF",
          fontSize: "13px",
          letterSpacing: "1.8px",
          border: "1px solid #597794",
        }}
      >
        {c.primaryCta} →
      </button>
      {secondary ? (
        <button
          type="button"
          onClick={onSecondary}
          className="block w-full text-center mt-3 font-kosugi uppercase text-text-tertiary hover:text-text-secondary transition-colors"
          style={{ fontSize: "11px", letterSpacing: "1.2px" }}
        >
          {secondary}
        </button>
      ) : null}
    </div>
  );
}
