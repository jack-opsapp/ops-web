/**
 * Bug Report Context Collector
 *
 * Lightweight in-memory collector that captures diagnostic context for
 * bug reports submitted from the web UI. Holds small ring buffers of
 * console events and breadcrumbs, and exposes a synchronous snapshot
 * function used at submit time.
 *
 * Safe to call `initBugContext()` multiple times — it no-ops after the
 * first call. Designed to run only in the browser.
 */

type BreadcrumbType = "navigation" | "click" | "input" | "network" | "custom";

interface ConsoleEntry {
  level: "log" | "warn" | "error";
  message: string;
  stack?: string;
  timestamp: string;
}

interface Breadcrumb {
  type: BreadcrumbType;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

interface ParsedUA {
  browser: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceModel: string | null;
}

export interface BugContextSnapshot {
  // Browser / device
  browser: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  userAgent: string | null;

  // Viewport / display
  viewportWidth: number | null;
  viewportHeight: number | null;
  devicePixelRatio: number | null;
  screenWidth: number | null;
  screenHeight: number | null;

  // Location
  url: string | null;
  pathname: string | null;
  referrer: string | null;

  // Network
  networkType: string | null;
  online: boolean;

  // Locale
  language: string | null;
  timezone: string | null;

  // Rich context
  consoleLogs: ConsoleEntry[];
  breadcrumbs: Breadcrumb[];
  stateSnapshot: Record<string, unknown>;
  customMetadata: Record<string, unknown>;
}

// ─── Ring Buffers ────────────────────────────────────────────────────────────

const MAX_CONSOLE = 30;
const MAX_BREADCRUMBS = 20;

const consoleBuffer: ConsoleEntry[] = [];
const breadcrumbBuffer: Breadcrumb[] = [];

let initialized = false;

function pushConsole(entry: ConsoleEntry) {
  consoleBuffer.push(entry);
  if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
}

function pushBreadcrumb(crumb: Breadcrumb) {
  breadcrumbBuffer.push(crumb);
  if (breadcrumbBuffer.length > MAX_BREADCRUMBS) breadcrumbBuffer.shift();
}

function serializeArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function recordBreadcrumb(
  type: BreadcrumbType,
  message: string,
  data?: Record<string, unknown>
): void {
  pushBreadcrumb({ type, message, data, timestamp: new Date().toISOString() });
}

export function initBugContext(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  // Wrap console.error / console.warn without breaking native behavior
  const nativeError = console.error;
  const nativeWarn = console.warn;

  console.error = (...args: unknown[]) => {
    pushConsole({
      level: "error",
      message: args.map(serializeArg).join(" "),
      timestamp: new Date().toISOString(),
    });
    nativeError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    pushConsole({
      level: "warn",
      message: args.map(serializeArg).join(" "),
      timestamp: new Date().toISOString(),
    });
    nativeWarn.apply(console, args);
  };

  // Global error handlers
  window.addEventListener("error", (e) => {
    pushConsole({
      level: "error",
      message: e.message || "window.error",
      stack: e.error?.stack,
      timestamp: new Date().toISOString(),
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    pushConsole({
      level: "error",
      message:
        reason instanceof Error
          ? `UnhandledRejection: ${reason.message}`
          : `UnhandledRejection: ${serializeArg(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
      timestamp: new Date().toISOString(),
    });
  });

  // Navigation breadcrumbs via pushState/replaceState patching
  const nativePushState = history.pushState;
  const nativeReplaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = nativePushState.apply(this, args);
    recordBreadcrumb("navigation", `pushState ${location.pathname}`);
    return result;
  };
  history.replaceState = function (...args) {
    const result = nativeReplaceState.apply(this, args);
    recordBreadcrumb("navigation", `replaceState ${location.pathname}`);
    return result;
  };
  window.addEventListener("popstate", () => {
    recordBreadcrumb("navigation", `popstate ${location.pathname}`);
  });

  // Click breadcrumbs (throttled)
  let lastClickAt = 0;
  document.addEventListener(
    "click",
    (e) => {
      const now = Date.now();
      if (now - lastClickAt < 100) return;
      lastClickAt = now;

      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const text = (target.innerText || target.getAttribute("aria-label") || "")
        .trim()
        .slice(0, 60);
      const id = target.id ? `#${target.id}` : "";
      const cls = target.className && typeof target.className === "string"
        ? `.${target.className.split(" ").slice(0, 2).join(".")}`
        : "";
      recordBreadcrumb("click", `${tag}${id}${cls}${text ? ` "${text}"` : ""}`);
    },
    true
  );

  recordBreadcrumb("custom", "bug-context:init");
}

// ─── UA Parsing ──────────────────────────────────────────────────────────────

function parseUserAgent(ua: string): ParsedUA {
  const result: ParsedUA = {
    browser: null,
    browserVersion: null,
    osName: null,
    osVersion: null,
    deviceModel: null,
  };

  // Browser
  const edge = ua.match(/Edg\/([\d.]+)/);
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);

  if (edge) {
    result.browser = "Edge";
    result.browserVersion = edge[1];
  } else if (firefox) {
    result.browser = "Firefox";
    result.browserVersion = firefox[1];
  } else if (chrome) {
    result.browser = "Chrome";
    result.browserVersion = chrome[1];
  } else if (safari) {
    result.browser = "Safari";
    result.browserVersion = safari[1];
  }

  // OS
  if (/Windows NT 10/.test(ua)) {
    result.osName = "Windows";
    result.osVersion = "10/11";
  } else if (/Windows/.test(ua)) {
    result.osName = "Windows";
  } else if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X ([\d_]+)/);
    result.osName = "macOS";
    result.osVersion = m?.[1]?.replace(/_/g, ".") ?? null;
  } else if (/iPhone OS/.test(ua)) {
    const m = ua.match(/iPhone OS ([\d_]+)/);
    result.osName = "iOS";
    result.osVersion = m?.[1]?.replace(/_/g, ".") ?? null;
    result.deviceModel = "iPhone";
  } else if (/iPad/.test(ua)) {
    result.osName = "iPadOS";
    result.deviceModel = "iPad";
  } else if (/Android/.test(ua)) {
    const m = ua.match(/Android ([\d.]+)/);
    result.osName = "Android";
    result.osVersion = m?.[1] ?? null;
  } else if (/Linux/.test(ua)) {
    result.osName = "Linux";
  }

  return result;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function getBugContext(
  extra?: { stateSnapshot?: Record<string, unknown>; customMetadata?: Record<string, unknown> }
): BugContextSnapshot {
  if (typeof window === "undefined") {
    return {
      browser: null,
      browserVersion: null,
      osName: null,
      osVersion: null,
      deviceModel: null,
      userAgent: null,
      viewportWidth: null,
      viewportHeight: null,
      devicePixelRatio: null,
      screenWidth: null,
      screenHeight: null,
      url: null,
      pathname: null,
      referrer: null,
      networkType: null,
      online: false,
      language: null,
      timezone: null,
      consoleLogs: [],
      breadcrumbs: [],
      stateSnapshot: extra?.stateSnapshot ?? {},
      customMetadata: extra?.customMetadata ?? {},
    };
  }

  const ua = navigator.userAgent;
  const parsed = parseUserAgent(ua);

  const connection =
    (navigator as unknown as {
      connection?: { effectiveType?: string };
    }).connection;

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // ignore
  }

  return {
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    osName: parsed.osName,
    osVersion: parsed.osVersion,
    deviceModel: parsed.deviceModel,
    userAgent: ua,

    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio ?? null,
    screenWidth: window.screen?.width ?? null,
    screenHeight: window.screen?.height ?? null,

    url: window.location.href,
    pathname: window.location.pathname,
    referrer: document.referrer || null,

    networkType: connection?.effectiveType ?? null,
    online: navigator.onLine,

    language: navigator.language ?? null,
    timezone,

    consoleLogs: consoleBuffer.slice(),
    breadcrumbs: breadcrumbBuffer.slice(),
    stateSnapshot: extra?.stateSnapshot ?? {},
    customMetadata: {
      ...(extra?.customMetadata ?? {}),
      appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? null,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
    },
  };
}

/**
 * Derive a human-readable screen name from a Next.js pathname.
 * Example: "/projects/abc123/financial" -> "Projects.Financial"
 */
export function screenNameFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Root";

  const cleaned = segments.filter(
    (s) => !/^[0-9a-f-]{8,}$/i.test(s) && !/^\d+$/.test(s)
  );
  if (cleaned.length === 0) return segments[0];

  return cleaned
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(".");
}
