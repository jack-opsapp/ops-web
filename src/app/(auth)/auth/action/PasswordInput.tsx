"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { StrengthMeter } from "./StrengthMeter";
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
  const meetsMinLength = password.length >= 8;
  const canSubmit = meetsMinLength && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(password);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <label
        htmlFor="ops-new-password"
        className="font-mono uppercase text-text-3 block mb-2"
        style={{ fontSize: "10px", letterSpacing: "0.12em" }}
      >
        {handlerCopy.reset.passwordLabel}
      </label>
      <div
        className="flex items-center gap-2 rounded px-3"
        style={{
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.10)",
          minHeight: "60px",
        }}
      >
        <input
          id="ops-new-password"
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
          className="text-text-3 hover:text-text-2 transition-colors p-2 flex items-center justify-center"
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
        className={`w-full rounded font-cakemono font-light uppercase mt-6 border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
          canSubmit
            ? "text-ops-accent border-ops-accent hover:bg-ops-accent hover:text-black"
            : "text-text-disabled border-border cursor-not-allowed"
        }`}
        style={{
          minHeight: "60px",
          fontSize: "13px",
          letterSpacing: "0.16em",
        }}
      >
        {submitting
          ? loadingLabel ?? "..."
          : `${handlerCopy.reset.submitCta} →`}
      </button>
    </form>
  );
}
