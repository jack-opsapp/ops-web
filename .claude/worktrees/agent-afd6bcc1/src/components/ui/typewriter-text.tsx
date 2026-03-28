"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface TypewriterTextProps {
  text: string;
  className?: string;
  typingSpeed?: number;
  startDelay?: number;
  onComplete?: () => void;
}

export function TypewriterText({
  text,
  className,
  typingSpeed = 40,
  startDelay = 0,
  onComplete,
}: TypewriterTextProps) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const reset = useCallback(() => {
    setDisplayed("");
    setDone(false);
  }, []);

  useEffect(() => {
    reset();

    // Respect reduced motion
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReduced) {
      setDisplayed(text);
      setDone(true);
      onCompleteRef.current?.();
      return;
    }

    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;

    const startTimer = () => {
      timer = setTimeout(function type() {
        idx++;
        setDisplayed(text.slice(0, idx));
        if (idx >= text.length) {
          setDone(true);
          onCompleteRef.current?.();
        } else {
          timer = setTimeout(type, typingSpeed);
        }
      }, typingSpeed);
    };

    if (startDelay > 0) {
      timer = setTimeout(startTimer, startDelay);
    } else {
      startTimer();
    }

    return () => clearTimeout(timer);
  }, [text, typingSpeed, startDelay, reset]);

  return (
    <span className={className} aria-label={text}>
      {displayed}
      {!done && (
        <span className="inline-block w-[2px] h-[1em] bg-text-tertiary ml-[2px] align-middle animate-pulse" />
      )}
    </span>
  );
}
