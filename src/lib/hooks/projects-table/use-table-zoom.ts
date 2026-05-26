import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SetStateAction,
  type WheelEvent,
} from "react";
import type { ProjectTableDensity } from "@/lib/types/project-table";

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const WHEEL_COMMIT_DELAY_MS = 180;

export const PROJECT_TABLE_DENSITY_PRESETS = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.25,
} as const satisfies Record<ProjectTableDensity, number>;

const DENSITY_SEQUENCE = [
  "compact",
  "comfortable",
  "spacious",
] as const satisfies readonly ProjectTableDensity[];

export interface ProjectTableZoomMetrics {
  zoom: number;
  density: ProjectTableDensity;
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  microFontSize: number;
  avatarSize: number;
  columnScale: number;
}

export interface ProjectTableDensityCommit {
  density: ProjectTableDensity;
  zoomLevel: number;
}

export interface UseTableZoomOptions {
  initialDensity?: ProjectTableDensity | null;
  initialZoom?: number | null;
  onPersistDensity?: (input: ProjectTableDensityCommit) => Promise<void> | void;
  onPersistError?: (error: unknown) => void;
  wheelCommitDelayMs?: number;
}

interface NormalizedTableZoomOptions {
  initialDensity: ProjectTableDensity;
  initialZoom: number;
  onPersistDensity?: (input: ProjectTableDensityCommit) => Promise<void> | void;
  onPersistError?: (error: unknown) => void;
  wheelCommitDelayMs: number;
}

export function clampTableZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function densityFromZoom(zoom: number): ProjectTableDensity {
  const clamped = clampTableZoom(zoom);
  return DENSITY_SEQUENCE.reduce<ProjectTableDensity>((nearest, density) => {
    const nearestDistance = Math.abs(PROJECT_TABLE_DENSITY_PRESETS[nearest] - clamped);
    const candidateDistance = Math.abs(PROJECT_TABLE_DENSITY_PRESETS[density] - clamped);
    return candidateDistance < nearestDistance ? density : nearest;
  }, "comfortable");
}

function clampMetric(min: number, value: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function normalizeInitialOptions(
  optionsOrInitialZoom: number | UseTableZoomOptions,
): NormalizedTableZoomOptions {
  if (typeof optionsOrInitialZoom === "number") {
    return {
      initialDensity: densityFromZoom(optionsOrInitialZoom),
      initialZoom: optionsOrInitialZoom,
      wheelCommitDelayMs: WHEEL_COMMIT_DELAY_MS,
    };
  }

  const initialZoom = optionsOrInitialZoom.initialZoom ?? PROJECT_TABLE_DENSITY_PRESETS.comfortable;
  return {
    initialDensity: optionsOrInitialZoom.initialDensity ?? densityFromZoom(initialZoom),
    initialZoom,
    onPersistDensity: optionsOrInitialZoom.onPersistDensity,
    onPersistError: optionsOrInitialZoom.onPersistError,
    wheelCommitDelayMs: optionsOrInitialZoom.wheelCommitDelayMs ?? WHEEL_COMMIT_DELAY_MS,
  };
}

function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='option']"))
  );
}

export function getTableZoomMetrics(
  zoomValue: number,
  densityValue = densityFromZoom(zoomValue),
): ProjectTableZoomMetrics {
  const zoom = clampTableZoom(zoomValue);
  return {
    zoom,
    density: densityValue,
    rowHeight: clampMetric(32, 44 * zoom, 64),
    headerHeight: clampMetric(32, 40 * zoom, 60),
    fontSize: clampMetric(12, 14 * zoom, 21),
    microFontSize: clampMetric(11, 11 * zoom, 17),
    avatarSize: clampMetric(18, 20 * zoom, 30),
    columnScale: zoom,
  };
}

export function useTableZoom(optionsOrInitialZoom: number | UseTableZoomOptions = 1) {
  const options = normalizeInitialOptions(optionsOrInitialZoom);
  const initialZoom = clampTableZoom(options.initialZoom);
  const initialDensity = options.initialDensity ?? densityFromZoom(initialZoom);
  const [zoom, setZoom] = useState(initialZoom);
  const [density, setDensity] = useState<ProjectTableDensity>(initialDensity);
  const pinchDistanceRef = useRef<number | null>(null);
  const initialStateRef = useRef({
    zoom: initialZoom,
    density: initialDensity,
  });
  const latestZoomRef = useRef(initialZoom);
  const persistRef = useRef(options.onPersistDensity);
  const persistErrorRef = useRef(options.onPersistError);
  const wheelTimerRef = useRef<number | null>(null);
  const commitSequenceRef = useRef(0);

  useEffect(() => {
    persistRef.current = options.onPersistDensity;
    persistErrorRef.current = options.onPersistError;
  }, [options.onPersistDensity, options.onPersistError]);

  useEffect(() => {
    if (
      initialStateRef.current.zoom === initialZoom &&
      initialStateRef.current.density === initialDensity
    ) {
      return;
    }

    if (wheelTimerRef.current) {
      window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
    pinchDistanceRef.current = null;
    commitSequenceRef.current += 1;
    initialStateRef.current = {
      zoom: initialZoom,
      density: initialDensity,
    };
    latestZoomRef.current = initialZoom;
    setZoom(initialZoom);
    setDensity(initialDensity);
  }, [initialDensity, initialZoom]);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
    };
  }, []);

  const metrics = useMemo(() => getTableZoomMetrics(zoom, density), [density, zoom]);

  const revertToSavedDensity = useCallback(() => {
    const savedState = initialStateRef.current;
    latestZoomRef.current = savedState.zoom;
    setZoom(savedState.zoom);
    setDensity(savedState.density);
  }, []);

  const commitDensity = useCallback(
    async (next: ProjectTableDensityCommit) => {
      if (wheelTimerRef.current) {
        window.clearTimeout(wheelTimerRef.current);
        wheelTimerRef.current = null;
      }

      const densityValue = next.density;
      const zoomLevel = clampTableZoom(next.zoomLevel);
      const sequence = commitSequenceRef.current + 1;
      commitSequenceRef.current = sequence;

      latestZoomRef.current = zoomLevel;
      setZoom(zoomLevel);
      setDensity(densityValue);

      try {
        await persistRef.current?.({ density: densityValue, zoomLevel });
      } catch (error) {
        if (commitSequenceRef.current === sequence) {
          revertToSavedDensity();
          persistErrorRef.current?.(error);
        }
      }
    },
    [revertToSavedDensity],
  );

  const commitPreset = useCallback(
    (nextDensity: ProjectTableDensity) =>
      commitDensity({
        density: nextDensity,
        zoomLevel: PROJECT_TABLE_DENSITY_PRESETS[nextDensity],
      }),
    [commitDensity],
  );

  const commitZoomLevel = useCallback(
    (zoomValue: number) => {
      const nextZoom = clampTableZoom(zoomValue);
      return commitDensity({
        density: densityFromZoom(nextZoom),
        zoomLevel: nextZoom,
      });
    },
    [commitDensity],
  );

  const commitNearestPreset = useCallback(
    (zoomValue: number) => {
      const nextDensity = densityFromZoom(zoomValue);
      return commitPreset(nextDensity);
    },
    [commitPreset],
  );

  const adjustZoom = useCallback((delta: number) => {
    let nextZoom = latestZoomRef.current;
    setZoom((current) => {
      nextZoom = clampTableZoom(current + delta);
      latestZoomRef.current = nextZoom;
      return nextZoom;
    });
    setDensity(densityFromZoom(nextZoom));
    return nextZoom;
  }, []);

  const setZoomLevel = useCallback((value: SetStateAction<number>) => {
    setZoom((current) => {
      const rawValue = typeof value === "function" ? value(current) : value;
      const nextZoom = clampTableZoom(rawValue);
      latestZoomRef.current = nextZoom;
      setDensity(densityFromZoom(nextZoom));
      return nextZoom;
    });
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const nextZoom = adjustZoom(event.deltaY > 0 ? -0.04 : 0.04);

      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => {
        void commitNearestPreset(nextZoom);
      }, options.wheelCommitDelayMs);
    },
    [adjustZoom, commitNearestPreset, options.wheelCommitDelayMs],
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
    const hadPinch = pinchDistanceRef.current != null;
    pinchDistanceRef.current = null;
    if (hadPinch) void commitNearestPreset(latestZoomRef.current);
  }, [commitNearestPreset]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if ((!event.metaKey && !event.ctrlKey) || isTextEntryTarget(event.target)) return;

      const activeDensityIndex = DENSITY_SEQUENCE.indexOf(density);
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const nextDensity = DENSITY_SEQUENCE[Math.min(DENSITY_SEQUENCE.length - 1, activeDensityIndex + 1)];
        void commitPreset(nextDensity);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        const nextDensity = DENSITY_SEQUENCE[Math.max(0, activeDensityIndex - 1)];
        void commitPreset(nextDensity);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        void commitPreset("comfortable");
      }
    },
    [commitPreset, density],
  );

  return {
    zoom,
    density,
    setZoom: setZoomLevel,
    metrics,
    setPreset: commitPreset,
    setZoomLevel: commitZoomLevel,
    revertToSavedDensity,
    handleWheel,
    handleKeyDown,
    beginPinch,
    updatePinch,
    endPinch,
  };
}
