"use client";

/**
 * Bounce-rate semicircular gauge. 0..15% range with green/yellow/red zones.
 * Operator should be able to read deliverability state in <1s.
 */
import { motion, useReducedMotion } from "framer-motion";
import { bounceGaugeNeedleVariants } from "@/lib/utils/motion";

interface Props {
  bouncePct: number;
}

const MAX_PCT = 15;

export function BounceGauge({ bouncePct }: Props) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(bouncePct, MAX_PCT));
  const angleDeg = -90 + (clamped / MAX_PCT) * 180;
  const zone = bouncePct >= 10 ? "critical" : bouncePct >= 5 ? "warn" : "ok";
  const needleColor =
    zone === "critical" ? "#93321A" : zone === "warn" ? "#C4A868" : "#9DB582";
  const readoutColor =
    zone === "critical" ? "#B58289" : zone === "warn" ? "#C4A868" : "#9DB582";

  return (
    <div
      className="rounded-panel p-4"
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-text-3 block mb-2">
        // BOUNCE RATE [15-MIN]
      </span>
      <svg
        viewBox="0 0 200 110"
        className="w-full max-w-[280px] block"
        role="img"
        aria-label={`Bounce rate ${bouncePct.toFixed(2)} percent`}
      >
        <path
          d="M 20 90 A 80 80 0 0 1 80 18.6"
          stroke="#9DB582"
          strokeWidth="3"
          fill="none"
        />
        <path
          d="M 80 18.6 A 80 80 0 0 1 140 30.7"
          stroke="#C4A868"
          strokeWidth="3"
          fill="none"
        />
        <path
          d="M 140 30.7 A 80 80 0 0 1 180 90"
          stroke="#93321A"
          strokeWidth="3"
          fill="none"
        />
        <text x="20" y="105" fill="#8A8A8A" fontSize="8" fontFamily="JetBrains Mono">
          0%
        </text>
        <text x="95" y="14" fill="#8A8A8A" fontSize="8" fontFamily="JetBrains Mono">
          5
        </text>
        <text x="135" y="22" fill="#8A8A8A" fontSize="8" fontFamily="JetBrains Mono">
          10
        </text>
        <text x="170" y="105" fill="#8A8A8A" fontSize="8" fontFamily="JetBrains Mono">
          15%
        </text>
        <motion.line
          x1="100"
          y1="90"
          x2="100"
          y2="20"
          stroke={needleColor}
          strokeWidth="2"
          strokeLinecap="round"
          custom={angleDeg}
          variants={bounceGaugeNeedleVariants}
          initial={reduce ? false : "hidden"}
          animate={reduce ? { rotate: angleDeg, transition: { duration: 0 } } : "visible"}
          style={{ transformOrigin: "100px 90px" }}
        />
        <circle cx="100" cy="90" r="3" fill="#EDEDED" />
      </svg>
      <p
        className="mt-2 font-mono text-[20px] tracking-tight"
        style={{
          color: readoutColor,
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        {bouncePct.toFixed(2)}%
      </p>
    </div>
  );
}
