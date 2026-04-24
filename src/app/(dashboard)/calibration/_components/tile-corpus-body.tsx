"use client";

import { useEffect, useRef } from "react";
import { AnimatedNumber } from "./animated-number";
import { useDictionary } from "@/i18n/client";
import type { DeckState } from "@/lib/types/calibration";

interface Props {
  corpus: DeckState["corpus"];
}

export function TileCorpusBody({ corpus }: Props) {
  const { t } = useDictionary("calibration");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // DPI-aware sparkline — 140×20px at logical resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = 140;
    const H = 20;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    const data = corpus.last7DaysFactCounts;
    if (!data.length) return;
    const max = Math.max(...data, 1);
    const step = W / Math.max(data.length - 1, 1);

    // Fill underneath
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(0, H);
    data.forEach((v, i) => ctx.lineTo(i * step, H - (v / max) * (H - 2)));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Stroke on top
    ctx.strokeStyle = "#B5B5B5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    data.forEach((v, i) =>
      i === 0
        ? ctx.moveTo(i * step, H - (v / max) * (H - 2))
        : ctx.lineTo(i * step, H - (v / max) * (H - 2))
    );
    ctx.stroke();
  }, [corpus.last7DaysFactCounts]);

  const confidence = corpus.writingConfidence;
  const showConfidenceRow = confidence > 0 && confidence < 0.5;
  const showLocked = confidence >= 0.85;

  return (
    <div className="flex flex-col gap-2 h-full justify-center">
      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={corpus.factCount}
          className="font-mohave font-light text-[42px] text-text leading-none"
        />
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("tiles.corpus.factsLabel")}
        </span>
      </div>
      <canvas ref={canvasRef} className="block" aria-hidden="true" />
      {showConfidenceRow && (
        <span
          className="font-mono text-micro uppercase tracking-wider"
          style={{ color: "#C4A868" }}
        >
          {t("tiles.corpus.confidenceStatuses.training").replace(
            "{conf}",
            confidence.toFixed(2)
          )}
        </span>
      )}
      {showLocked && (
        <span
          className="font-mono text-micro uppercase tracking-wider"
          style={{ color: "#9DB582" }}
        >
          {t("tiles.corpus.confidenceStatuses.locked").replace(
            "{conf}",
            confidence.toFixed(2)
          )}
        </span>
      )}
    </div>
  );
}
