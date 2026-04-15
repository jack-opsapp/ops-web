"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { StrengthMeter, scoreStrength } from "./StrengthMeter";
import { handlerCopy } from "./copy";

interface PasswordInputProps {
  onSubmit: (password: string) => void;
  submitting: boolean;
  loadingLabel?: string;
}

export function PasswordInput({
  onSubmit,
  submitting,
  loadingLabel,
}: PasswordInputProps) {
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const strength = React.useMemo(() => scoreStrength(password), [password]);
  const canSubmit = strength.passes && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(password);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <label
        className="font-kosugi uppercase text-text-tertiary block mb-2"
        style={{ fontSize: "10px", letterSpacing: "1.2px" }}
      >
        {handlerCopy.reset.passwordLabel}
      </label>
      <div
        className="flex items-center gap-2 rounded-sm px-3"
        style={{
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.2)",
          minHeight: "60px",
        }}
      >
        <input
          type={show ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          autoFocus
          autoComplete="new-password"
          className="flex-1 bg-transparent outline-none text-text-primary font-mohave"
          style={{ fontSize: "16px", letterSpacing: "0.04em" }}
          aria-label={handlerCopy.reset.passwordLabel}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={submitting}
          className="text-text-tertiary hover:text-text-secondary transition-colors p-2"
          style={{ minWidth: "44px", minHeight: "44px" }}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <StrengthMeter password={password} />
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-sm font-kosugi uppercase mt-6 transition-opacity"
        style={{
          minHeight: "60px",
          background: "#597794",
          color: "#FFFFFF",
          fontSize: "13px",
          letterSpacing: "1.8px",
          opacity: canSubmit ? 1 : 0.4,
          border: "1px solid #597794",
        }}
      >
        {submitting ? (loadingLabel ?? "• • •") : `${handlerCopy.reset.submitCta} →`}
      </button>
    </form>
  );
}
