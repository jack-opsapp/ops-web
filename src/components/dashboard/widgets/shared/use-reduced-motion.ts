"use client";

// Re-export framer-motion's useReducedMotion for widget consistency.
// Reads prefers-reduced-motion via useEffect (SSR-safe, no hydration mismatch).
export { useReducedMotion } from "framer-motion";
