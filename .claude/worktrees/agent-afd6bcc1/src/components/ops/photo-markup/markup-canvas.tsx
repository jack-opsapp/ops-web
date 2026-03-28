"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";

export interface DrawingPath {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface MarkupCanvasRef {
  exportImage: () => string | null;
  undo: () => void;
  clear: () => void;
  hasDrawing: () => boolean;
}

interface MarkupCanvasProps {
  imageUrl: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export const MarkupCanvas = forwardRef<MarkupCanvasRef, MarkupCanvasProps>(
  function MarkupCanvas(
    {
      imageUrl,
      width = 800,
      height = 600,
      strokeColor = "#FF0000",
      strokeWidth = 3,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [paths, setPaths] = useState<DrawingPath[]>([]);
    const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [dims, setDims] = useState({ w: width, h: height });

    // Load image
    useEffect(() => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageRef.current = img;
        const scale = Math.min(width / img.width, height / img.height);
        setDims({
          w: Math.round(img.width * scale),
          h: Math.round(img.height * scale),
        });
      };
      img.src = imageUrl;
    }, [imageUrl, width, height]);

    // Redraw
    const redraw = useCallback(
      (allPaths: DrawingPath[], active: DrawingPath | null) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !imageRef.current) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

        const drawPath = (path: DrawingPath) => {
          if (path.points.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = path.color;
          ctx.lineWidth = path.width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.moveTo(path.points[0].x, path.points[0].y);
          for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
          }
          ctx.stroke();
        };

        allPaths.forEach(drawPath);
        if (active) drawPath(active);
      },
      []
    );

    useEffect(() => {
      redraw(paths, currentPath);
    }, [paths, currentPath, redraw]);

    function getCanvasPoint(
      e: React.MouseEvent | React.TouchEvent
    ): { x: number; y: number } | null {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      if ("touches" in e) {
        const touch = e.touches[0];
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }

    function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
      const point = getCanvasPoint(e);
      if (!point) return;
      setIsDrawing(true);
      setCurrentPath({ points: [point], color: strokeColor, width: strokeWidth });
    }

    function handlePointerMove(e: React.MouseEvent | React.TouchEvent) {
      if (!isDrawing || !currentPath) return;
      const point = getCanvasPoint(e);
      if (!point) return;
      setCurrentPath((prev) =>
        prev ? { ...prev, points: [...prev.points, point] } : null
      );
    }

    function handlePointerUp() {
      if (currentPath && currentPath.points.length > 1) {
        setPaths((prev) => [...prev, currentPath]);
      }
      setCurrentPath(null);
      setIsDrawing(false);
    }

    useImperativeHandle(ref, () => ({
      exportImage: () =>
        canvasRef.current?.toDataURL("image/jpeg", 0.9) ?? null,
      undo: () => setPaths((prev) => prev.slice(0, -1)),
      clear: () => setPaths([]),
      hasDrawing: () => paths.length > 0,
    }));

    return (
      <canvas
        ref={canvasRef}
        width={dims.w}
        height={dims.h}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        className="max-w-full cursor-crosshair rounded-lg touch-none"
        style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
      />
    );
  }
);
