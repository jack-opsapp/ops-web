"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type ClipboardEvent,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils/cn";
import { extractDigits } from "@/lib/customer-identity/hosted-format";

export const CODE_LENGTH = 6;

export interface CodeInputHandle {
  focusFirst: () => void;
}

export interface CodeInputProps {
  /** Digits entered so far (0–6 characters, digits only). */
  value: string;
  onChange: (value: string) => void;
  /** Fires once each time the sixth digit lands. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible group label, e.g. "Six-digit code". */
  label: string;
  /** Accessible per-cell label, e.g. n => `Digit ${n} of 6`. */
  digitLabel: (n: number) => string;
  /** id of the element that describes the group (error / helper), if any. */
  describedBy?: string;
  autoFocus?: boolean;
}

/**
 * Six single-digit cells that behave like one field.
 *
 * - Typing advances; Backspace on an empty cell steps back and clears.
 * - Paste anywhere fills from the first cell.
 * - iOS/Android one-time-code autofill writes the whole code into the first
 *   cell; the change handler distributes it.
 * - Arrow keys move between cells; Enter is left to the surrounding form.
 */
export const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(function CodeInput(
  {
    value,
    onChange,
    onComplete,
    disabled = false,
    invalid = false,
    label,
    digitLabel,
    describedBy,
    autoFocus = false,
  },
  ref
) {
  const cells = useRef<Array<HTMLInputElement | null>>([]);
  const lastCompleted = useRef<string | null>(null);

  const focusCell = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, index));
    const el = cells.current[clamped];
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  useImperativeHandle(ref, () => ({ focusFirst: () => focusCell(0) }), [focusCell]);

  useEffect(() => {
    if (autoFocus && !disabled) focusCell(0);
  }, [autoFocus, disabled, focusCell]);

  // Completion fires exactly once per distinct six-digit value.
  useEffect(() => {
    if (value.length === CODE_LENGTH) {
      if (lastCompleted.current !== value) {
        lastCompleted.current = value;
        onComplete?.(value);
      }
    } else {
      lastCompleted.current = null;
    }
  }, [value, onComplete]);

  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");

  const commit = useCallback(
    (nextDigits: string[]) => {
      // Digits are contiguous from the left: a gap means everything after it is dropped,
      // which keeps `value` a single prefix string the parent can reason about.
      let next = "";
      for (const d of nextDigits) {
        if (d === "") break;
        next += d;
      }
      onChange(next);
    },
    [onChange]
  );

  const writeFrom = useCallback(
    (start: number, incoming: string) => {
      const clean = extractDigits(incoming, CODE_LENGTH - start);
      if (clean.length === 0) return;
      const next = [...digits];
      for (let i = 0; i < clean.length; i += 1) next[start + i] = clean[i];
      commit(next);
      focusCell(start + clean.length);
    },
    [digits, commit, focusCell]
  );

  const handleChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const clean = extractDigits(raw, CODE_LENGTH);

    if (clean.length === 0) {
      const next = [...digits];
      next[index] = "";
      commit(next);
      return;
    }

    // Autofill / multi-character entry: a full code always starts from cell 1.
    if (clean.length > 1) {
      writeFrom(clean.length === CODE_LENGTH ? 0 : index, clean);
      return;
    }

    const next = [...digits];
    next[index] = clean;
    commit(next);
    focusCell(index + 1);
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "Backspace": {
        if (digits[index] === "" && index > 0) {
          event.preventDefault();
          const next = [...digits];
          next[index - 1] = "";
          commit(next);
          focusCell(index - 1);
        }
        return;
      }
      case "ArrowLeft":
        event.preventDefault();
        focusCell(index - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        focusCell(index + 1);
        return;
      default:
        return;
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const text = event.clipboardData.getData("text");
    const clean = extractDigits(text, CODE_LENGTH);
    if (clean.length === 0) return;
    event.preventDefault();
    writeFrom(0, clean);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className="flex gap-1"
      onPaste={handlePaste}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            cells.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={digitLabel(index + 1)}
          aria-invalid={invalid ? "true" : undefined}
          data-filled={digit !== "" ? "true" : "false"}
          disabled={disabled}
          value={digit}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(
            "cs-input cs-cell flex-1 min-w-0 h-6 rounded",
            "font-mono text-data-lg tabular-nums"
          )}
        />
      ))}
    </div>
  );
});
