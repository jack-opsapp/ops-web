"use client";

import { useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeftRight, ArrowUpDown, GripVertical } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_COLS = 1;
const MAX_COLS = 8;
const MIN_ROWS = 1;
const MAX_ROWS = 4;

// ---------------------------------------------------------------------------
// Animation config
// ---------------------------------------------------------------------------

const HANDLE_SPRING = { type: "spring" as const, stiffness: 500, damping: 30 };
const LABEL_SPRING = { type: "spring" as const, stiffness: 300, damping: 20 };

const handleVariants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
};

const borderVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpacerWidgetProps {
  instanceId: string;
  config: Record<string, unknown>;
  isCustomizing?: boolean;
}

// ---------------------------------------------------------------------------
// Handle sub-component — animated arrow grip
// ---------------------------------------------------------------------------

function ResizeHandle({
  edge,
  onPointerDown,
  isDragging,
}: {
  edge: "right" | "bottom" | "corner";
  onPointerDown: (e: React.PointerEvent) => void;
  isDragging: boolean;
}) {
  const isRight = edge === "right";
  const isBottom = edge === "bottom";
  const isCorner = edge === "corner";

  const posClasses = isRight
    ? "absolute right-[-6px] top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center"
    : isBottom
      ? "absolute bottom-[-6px] left-0 right-0 h-3 cursor-row-resize flex items-center justify-center"
      : "absolute bottom-[-4px] right-[-4px] w-4 h-4 cursor-nwse-resize flex items-center justify-center";

  return (
    <motion.div
      variants={handleVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ ...HANDLE_SPRING, delay: isRight ? 0.05 : isBottom ? 0.1 : 0.15 }}
      className={`${posClasses} z-20 pointer-events-auto group/handle`}
      onPointerDown={onPointerDown}
    >
      {isCorner ? (
        <motion.div
          animate={{
            scale: isDragging ? 1.3 : 1,
            backgroundColor: isDragging
              ? "rgba(89, 119, 148, 0.5)"
              : "rgba(255, 255, 255, 0.1)",
          }}
          whileHover={{ scale: 1.2, backgroundColor: "rgba(89, 119, 148, 0.4)" }}
          transition={HANDLE_SPRING}
          className="w-[10px] h-[10px] rounded-sm"
        >
          <GripVertical className="w-2.5 h-2.5 text-text-disabled rotate-[-45deg] translate-x-[1px]" />
        </motion.div>
      ) : (
        <motion.div
          animate={{
            scale: isDragging ? 1.15 : 1,
            backgroundColor: isDragging
              ? "rgba(89, 119, 148, 0.35)"
              : "rgba(255, 255, 255, 0.06)",
            boxShadow: isDragging
              ? "0 0 12px rgba(89, 119, 148, 0.3)"
              : "0 0 0px transparent",
          }}
          whileHover={{
            scale: 1.1,
            backgroundColor: "rgba(89, 119, 148, 0.25)",
            boxShadow: "0 0 8px rgba(89, 119, 148, 0.2)",
          }}
          transition={HANDLE_SPRING}
          className={`flex items-center justify-center rounded-sm ${
            isRight ? "w-5 h-10" : "h-5 w-10"
          }`}
        >
          <motion.div
            animate={{ color: isDragging ? "#597794" : "rgba(255,255,255,0.25)" }}
            whileHover={{ color: "#597794" }}
            transition={{ duration: 0.15 }}
          >
            {isRight ? (
              <ArrowLeftRight className="w-3 h-3" />
            ) : (
              <ArrowUpDown className="w-3 h-3" />
            )}
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpacerWidget({
  instanceId,
  config,
  isCustomizing,
}: SpacerWidgetProps) {
  const updateWidgetInstance = usePreferencesStore(
    (s) => s.updateWidgetInstance
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingEdge, setDraggingEdge] = useState<string | null>(null);

  const colSpan = (config.colSpan as number) ?? 2;
  const rowSpan = (config.rowSpan as number) ?? 1;

  // ── Drag-to-resize handler ──
  const handleResize = useCallback(
    (edge: "right" | "bottom" | "corner", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const el = containerRef.current;
      if (!el) return;

      setDraggingEdge(edge);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = el.offsetWidth;
      const startHeight = el.offsetHeight;
      const cellWidth = startWidth / colSpan;
      const cellHeight = startHeight / rowSpan;

      let lastCols = colSpan;
      let lastRows = rowSpan;

      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;

        let newCols = colSpan;
        let newRows = rowSpan;

        if (edge === "right" || edge === "corner") {
          newCols = Math.max(
            MIN_COLS,
            Math.min(MAX_COLS, Math.round((startWidth + dx) / cellWidth))
          );
        }
        if (edge === "bottom" || edge === "corner") {
          newRows = Math.max(
            MIN_ROWS,
            Math.min(MAX_ROWS, Math.round((startHeight + dy) / cellHeight))
          );
        }

        if (newCols !== lastCols || newRows !== lastRows) {
          lastCols = newCols;
          lastRows = newRows;
          updateWidgetInstance(instanceId, {
            config: { ...config, colSpan: newCols, rowSpan: newRows },
          });
        }
      };

      const onUp = () => {
        setDraggingEdge(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [colSpan, rowSpan, instanceId, config, updateWidgetInstance]
  );

  // ── Normal mode: invisible ──
  if (!isCustomizing) {
    return <div className="w-full h-full" />;
  }

  // ── Customize mode: animated border, handles, size label ──
  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Animated dashed border */}
      <motion.div
        variants={borderVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute inset-0 rounded-md border border-dashed"
        style={{
          borderColor: draggingEdge
            ? "rgba(89, 119, 148, 0.5)"
            : "rgba(255, 255, 255, 0.1)",
          transition: "border-color 0.2s ease",
        }}
      />

      {/* Glow border during drag */}
      <AnimatePresence>
        {draggingEdge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 rounded-md pointer-events-none"
            style={{
              boxShadow: "inset 0 0 20px rgba(89, 119, 148, 0.1), 0 0 12px rgba(89, 119, 148, 0.08)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Size label — animated on change */}
      <div className="flex items-center justify-center h-full">
        <motion.span
          key={`${colSpan}x${rowSpan}`}
          initial={{ opacity: 0, scale: 0.8, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={LABEL_SPRING}
          className="font-kosugi text-[10px] text-text-disabled tracking-wider uppercase select-none"
        >
          {colSpan} &times; {rowSpan}
        </motion.span>
      </div>

      {/* Drag handles — staggered entrance */}
      <AnimatePresence>
        <ResizeHandle
          edge="right"
          onPointerDown={(e) => handleResize("right", e)}
          isDragging={draggingEdge === "right" || draggingEdge === "corner"}
        />
        <ResizeHandle
          edge="bottom"
          onPointerDown={(e) => handleResize("bottom", e)}
          isDragging={draggingEdge === "bottom" || draggingEdge === "corner"}
        />
        <ResizeHandle
          edge="corner"
          onPointerDown={(e) => handleResize("corner", e)}
          isDragging={draggingEdge === "corner"}
        />
      </AnimatePresence>
    </div>
  );
}
