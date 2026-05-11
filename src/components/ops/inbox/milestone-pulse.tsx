"use client";

import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { useReducedInboxMotion } from "@/lib/utils/motion";

interface MilestonePulseProps<T> {
  /** Trigger value. When this changes from one render to the next, the pulse
   *  fires once. Pass the milestone status (e.g. project.status === "Done"
   *  ? "Done" : null) so transitioning into a milestone state cycles the
   *  pulse. Same value back-to-back does nothing. */
  trigger: T;
  className?: string;
  children: ReactNode;
}

export function MilestonePulse<T>({
  trigger,
  className,
  children,
}: MilestonePulseProps<T>) {
  const m = useReducedInboxMotion();
  const [animateKey, setAnimateKey] = useState(0);

  useEffect(() => {
    setAnimateKey((k) => k + 1);
  }, [trigger]);

  return (
    <motion.div
      key={animateKey}
      initial="initial"
      animate="pulse"
      variants={m.milestone}
      className={className}
    >
      {children}
    </motion.div>
  );
}
