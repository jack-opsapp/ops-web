"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReceiptLightboxProps {
  imageUrl: string;
  onClose: () => void;
}

// ─── Animation ───────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const imageVariants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

const transition = { duration: 0.2, ease: EASE };

// ─── Component ───────────────────────────────────────────────────────────────

export function ReceiptLightbox({ imageUrl, onClose }: ReceiptLightboxProps) {
  // Escape key listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-label="Receipt viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      variants={backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center text-text-secondary hover:text-text-primary"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Receipt image */}
      <motion.img
        src={imageUrl}
        alt="Receipt"
        className="max-h-[90vh] max-w-[90vw] rounded-[3px] object-contain"
        variants={imageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={transition}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </motion.div>
  );
}
