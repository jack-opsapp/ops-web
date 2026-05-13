"use client";

export function inboxThreadHref(threadId: string): string {
  return `/inbox/${encodeURIComponent(threadId)}`;
}

export function threadIdFromInboxPathname(pathname: string): string | null {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (first !== "inbox" || !second) return null;
  try {
    return decodeURIComponent(second);
  } catch {
    return second;
  }
}

export function shouldHandleInPlaceThreadNavigation(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
