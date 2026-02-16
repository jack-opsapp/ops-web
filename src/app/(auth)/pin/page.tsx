"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Delete } from "lucide-react";
import { toast } from "sonner";

const PIN_LENGTH = 4;

export default function PinPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [shake, setShake] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDigit = useCallback(
    (digit: string) => {
      if (pin.length >= PIN_LENGTH || isVerifying) return;
      setError(null);
      const newPin = pin + digit;
      setPin(newPin);

      // Auto-submit on 4th digit
      if (newPin.length === PIN_LENGTH) {
        setIsVerifying(true);
        setTimeout(() => {
          // Verify against localStorage-stored PIN hash
          const storedPin = localStorage.getItem("ops-pin");
          if (!storedPin) {
            // No PIN set - redirect to dashboard
            router.push("/dashboard");
            return;
          }
          const isValid = newPin === storedPin;
          if (isValid) {
            router.push("/projects");
          } else {
            setShake(true);
            setTimeout(() => setShake(false), 500);
            setError("Incorrect PIN");
            setPin("");
            setIsVerifying(false);
          }
        }, 600);
      }
    },
    [pin, isVerifying, router]
  );

  const handleDelete = useCallback(() => {
    if (isVerifying) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }, [isVerifying]);

  // Keyboard support
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleDelete();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDigit, handleDelete]);

  const numpadRows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "delete"],
  ];

  return (
    <div className="flex flex-col items-center" ref={containerRef}>
      {/* Logo */}
      <h1 className="font-bebas text-[48px] tracking-[0.2em] text-ops-accent leading-none mb-1">
        OPS
      </h1>
      <p className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.3em] mb-5">
        Enter PIN
      </p>

      {/* PIN Dots */}
      <div
        className={cn(
          "flex items-center gap-2 mb-4 transition-transform",
          shake && "animate-[shake_0.5s_ease-in-out]"
        )}
        style={
          shake
            ? {
                animation: "shake 0.5s ease-in-out",
              }
            : undefined
        }
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-[18px] h-[18px] rounded-full border-2 transition-all duration-200",
              i < pin.length
                ? "bg-ops-accent border-ops-accent shadow-glow-accent scale-110"
                : "bg-transparent border-border-medium"
            )}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="font-mohave text-body-sm text-ops-error mb-2 animate-slide-up">
          {error}
        </p>
      )}

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-[280px]">
        {numpadRows.flat().map((key, i) => {
          if (key === "") {
            return <div key={i} />;
          }

          if (key === "delete") {
            return (
              <button
                key={i}
                onClick={handleDelete}
                disabled={pin.length === 0 || isVerifying}
                className={cn(
                  "h-[64px] rounded flex items-center justify-center",
                  "text-text-tertiary hover:text-text-secondary hover:bg-background-elevated",
                  "transition-all duration-150 active:scale-95",
                  "disabled:opacity-30 disabled:pointer-events-none"
                )}
              >
                <Delete className="w-[24px] h-[24px]" />
              </button>
            );
          }

          return (
            <button
              key={i}
              onClick={() => handleDigit(key)}
              disabled={isVerifying}
              className={cn(
                "h-[64px] rounded flex items-center justify-center",
                "bg-background-card border border-border-subtle",
                "font-mohave text-[28px] text-text-primary",
                "hover:bg-background-elevated hover:border-border-medium hover:shadow-glow-accent",
                "transition-all duration-150 active:scale-95",
                "disabled:opacity-50 disabled:pointer-events-none"
              )}
            >
              {key}
            </button>
          );
        })}
      </div>

      {/* Forgot PIN */}
      <button
        className="mt-3 font-mohave text-body-sm text-text-tertiary hover:text-ops-accent transition-colors underline underline-offset-4"
        onClick={() => {
          localStorage.removeItem("ops-pin");
          toast.success("PIN cleared. Please set a new PIN in Settings.");
          router.push("/dashboard");
        }}
      >
        Forgot PIN?
      </button>

      {/* Inline shake keyframe */}
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
