"use client";

import { motion } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import { placeholderCellVariants } from "@/lib/utils/motion";

interface GridPlaceholderCellProps {
  id: string;
  index: number;
}

export function GridPlaceholderCell({ id, index }: GridPlaceholderCellProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <motion.div
      ref={setNodeRef}
      custom={index}
      variants={placeholderCellVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="col-span-1"
      style={{ minHeight: 160 }}
      aria-label={`Empty slot ${index + 1}`}
      role="region"
    >
      <div
        className="h-full w-full rounded-[var(--radius)] transition-colors duration-150"
        style={{
          backgroundColor: isOver
            ? "rgba(var(--ops-accent-rgb), 0.25)"
            : "rgba(255, 255, 255, 0.2)",
        }}
      />
    </motion.div>
  );
}
