import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Orientation = "horizontal" | "vertical";

export interface OpsLockupProps extends React.SVGProps<SVGSVGElement> {
  /** Horizontal (mark + OPS inline) or vertical (mark above OPS). Default "horizontal". */
  orientation?: Orientation;
  /** Accessible label. Defaults to "OPS". Pass "" to mark decorative. */
  title?: string;
  className?: string;
}

// Horizontal: mark + "OPS" inline. viewBox 0 0 2405.66 1511.21 (~1.59:1).
const HORIZONTAL_PATHS = (
  <>
    <path d="M826.84,778.71v-350.91s-233.86-116.97-233.86-116.97h0l-175.42,87.71.1.05,292.23,146.15v292.4s.04.02.04.02l116.92-58.46Z" />
    <path d="M707.58,1119.3h.02v-.06l-292.32-146.2-.08-292.37-116.66,58.43-.09.05-.2,350.79.09.05,233.83,116.94.06.04,175.36-87.67Z" />
    <path d="M1129.61,931.61v-344.67c0-69.09,41-97.18,110.84-97.18h74.4c69.84,0,110.84,28.09,110.84,97.18v344.67c0,69.09-41,97.18-110.84,97.18h-74.4c-69.84,0-110.84-28.09-110.84-97.18ZM1308.78,974.13c44.03,0,55.42-13.67,55.42-56.18v-317.34c0-42.51-11.39-56.18-55.42-56.18h-62.25c-44.03,0-55.42,13.67-55.42,56.18v317.34c0,42.51,11.39,56.18,55.42,56.18h62.25Z" />
    <path d="M1503.12,494.32h164.74c70.6,0,110.84,28.09,110.84,97.18v129.06c0,69.09-40.24,97.18-110.84,97.18h-103.25v208.02h-61.49V494.32ZM1663.31,763.83c40.24,0,54.66-15.18,54.66-53.9v-107.8c0-38.72-14.42-53.9-54.66-53.9h-98.69v215.61h98.69Z" />
    <path d="M1820.46,931.61v-70.6h61.49v56.94c0,42.51,11.39,56.18,55.42,56.18h53.14c44.03,0,55.42-13.67,55.42-56.18v-33.4c0-27.33-9.11-41.75-27.33-55.42l-139.69-94.9c-33.4-22.02-50.87-48.59-50.87-95.66v-51.62c0-69.09,40.24-97.18,110.84-97.18h51.62c69.85,0,110.84,28.09,110.84,97.18v70.6h-61.49v-56.94c0-42.51-11.39-56.18-55.42-56.18h-39.48c-44.03,0-56.18,13.67-56.18,56.18v31.13c0,27.33,9.11,41.76,28.09,54.66l138.93,94.9c33.4,22.78,51.62,49.35,51.62,96.42v53.9c0,69.09-41,97.18-110.84,97.18h-65.29c-69.85,0-110.84-28.09-110.84-97.18Z" />
  </>
);

// Vertical: mark above "OPS". viewBox 0 0 2400 2400 (1:1 square).
const VERTICAL_PATHS = (
  <>
    <path d="M1474.88,795.74v-358.81s-239.12-119.6-239.12-119.6h0l-179.36,89.68.1.05,298.8,149.44v298.98s.04.02.04.02l119.55-59.77Z" />
    <path d="M1352.94,1144h.02v-.06l-298.9-149.48-.08-298.94-119.29,59.75-.1.05-.21,358.68.1.05,239.09,119.57.07.04,179.3-89.65Z" />
    <path d="M702.4,1994.58v-352.43c0-70.64,41.92-99.36,113.34-99.36h76.07c71.42,0,113.34,28.72,113.34,99.36v352.43c0,70.64-41.92,99.36-113.34,99.36h-76.07c-71.42,0-113.34-28.72-113.34-99.36ZM885.6,2038.05c45.02,0,56.67-13.97,56.67-57.44v-324.48c0-43.47-11.64-57.45-56.67-57.45h-63.65c-45.02,0-56.67,13.97-56.67,57.45v324.48c0,43.47,11.64,57.44,56.67,57.44h63.65Z" />
    <path d="M1084.32,1547.45h168.45c72.19,0,113.34,28.72,113.34,99.36v131.97c0,70.64-41.14,99.36-113.34,99.36h-105.57v212.7h-62.88v-543.39ZM1248.11,1823.03c41.14,0,55.89-15.53,55.89-55.12v-110.23c0-39.59-14.75-55.12-55.89-55.12h-100.92v220.46h100.92Z" />
    <path d="M1408.79,1994.58v-72.19h62.88v58.22c0,43.47,11.64,57.44,56.67,57.44h54.34c45.02,0,56.67-13.97,56.67-57.44v-34.16c0-27.95-9.32-42.69-27.95-56.67l-142.83-97.03c-34.16-22.51-52.01-49.68-52.01-97.81v-52.79c0-70.64,41.14-99.36,113.34-99.36h52.79c71.42,0,113.34,28.72,113.34,99.36v72.19h-62.88v-58.22c0-43.47-11.64-57.45-56.67-57.45h-40.37c-45.02,0-57.44,13.97-57.44,57.45v31.83c0,27.95,9.31,42.69,28.72,55.89l142.06,97.03c34.16,23.29,52.79,50.46,52.79,98.59v55.12c0,70.64-41.92,99.36-113.34,99.36h-66.76c-71.42,0-113.34-28.72-113.34-99.36Z" />
  </>
);

/**
 * OPS lockup (mark + "OPS" wordmark in Cake Mono, outlined as paths).
 * Uses `fill="currentColor"` so color inherits from CSS color.
 * Orientation determines aspect ratio: horizontal (~1.59:1) or vertical (1:1).
 * Size via width/height props or className. Default scales to 1em.
 */
export const OpsLockup = React.forwardRef<SVGSVGElement, OpsLockupProps>(
  ({ orientation = "horizontal", title = "OPS", className, ...props }, ref) => {
    const labelId = React.useId();
    const isDecorative = title === "";
    const viewBox = orientation === "horizontal" ? "0 0 2405.66 1511.21" : "0 0 2400 2400";
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        fill="currentColor"
        role={isDecorative ? undefined : "img"}
        aria-label={isDecorative ? undefined : title}
        aria-labelledby={isDecorative ? undefined : labelId}
        aria-hidden={isDecorative ? true : undefined}
        focusable="false"
        className={cn("inline-block", className)}
        {...props}
      >
        {!isDecorative && <title id={labelId}>{title}</title>}
        {orientation === "horizontal" ? HORIZONTAL_PATHS : VERTICAL_PATHS}
      </svg>
    );
  }
);
OpsLockup.displayName = "OpsLockup";
