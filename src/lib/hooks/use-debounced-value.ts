"use client";

import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce of a changing value. The raw value stays live for the
 * controlled input; the returned value settles `delayMs` after the last change
 * and is what server queries should key on, so a fetch fires once per typing
 * pause instead of once per keystroke.
 *
 * An empty-string reset (clearing a search) propagates immediately — the list
 * snaps back without the trailing delay.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === "") {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
