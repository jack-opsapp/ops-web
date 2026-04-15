"use client";

import * as React from "react";

export type DeviceClass = "ios" | "android" | "desktop";

export function useUserAgent(): DeviceClass {
  const [device, setDevice] = React.useState<DeviceClass>("desktop");

  React.useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      setDevice("ios");
      return;
    }
    if (/Android/i.test(ua)) {
      setDevice("android");
      return;
    }
    setDevice("desktop");
  }, []);

  return device;
}
