import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectTableDensity } from "@/lib/types/project-table";

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;

export function clampTableZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function densityFromZoom(zoom: number): ProjectTableDensity {
  if (zoom <= 0.9) return "compact";
  if (zoom >= 1.18) return "spacious";
  return "comfortable";
}

export function useTableZoom(initialZoom = 1) {
  const [zoom, setZoom] = useState(() => clampTableZoom(initialZoom));
  const pinchDistanceRef = useRef<number | null>(null);
  const initialZoomRef = useRef(initialZoom);

  useEffect(() => {
    if (initialZoomRef.current === initialZoom) return;
    initialZoomRef.current = initialZoom;
    setZoom(clampTableZoom(initialZoom));
  }, [initialZoom]);

  const density = densityFromZoom(zoom);

  const metrics = useMemo(() => {
    return {
      zoom,
      density,
      rowHeight: Math.round(38 * zoom),
      headerHeight: Math.round(42 * zoom),
      fontSize: Math.max(12, Math.round(14 * zoom)),
      microFontSize: Math.max(11, Math.round(11 * zoom)),
      columnScale: zoom,
    };
  }, [density, zoom]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clampTableZoom(current + delta));
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? -0.04 : 0.04);
    },
    [adjustZoom],
  );

  const beginPinch = useCallback((distance: number) => {
    pinchDistanceRef.current = distance;
  }, []);

  const updatePinch = useCallback((distance: number) => {
    const previous = pinchDistanceRef.current;
    if (!previous) {
      pinchDistanceRef.current = distance;
      return;
    }
    const delta = (distance - previous) / 500;
    pinchDistanceRef.current = distance;
    adjustZoom(delta);
  }, [adjustZoom]);

  const endPinch = useCallback(() => {
    pinchDistanceRef.current = null;
  }, []);

  return { zoom, setZoom, metrics, handleWheel, beginPinch, updatePinch, endPinch };
}
