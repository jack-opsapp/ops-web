export class MemoryDeadlineExceededError extends Error {
  readonly code = "MEMORY_DEADLINE_EXCEEDED" as const;

  constructor(options?: ErrorOptions) {
    super("MEMORY_DEADLINE_EXCEEDED", options);
    this.name = "MemoryDeadlineExceededError";
  }
}

export async function withinMemoryDeadline<T>(
  operation: (signal: AbortSignal) => PromiseLike<T> | T,
  options: {
    readonly deadlineAt: number;
    readonly signal?: AbortSignal;
    readonly now?: () => number;
  }
): Promise<T> {
  const now = options.now ?? Date.now;
  const remaining = options.deadlineAt - now();
  if (
    !Number.isFinite(options.deadlineAt) ||
    remaining <= 0 ||
    options.signal?.aborted
  ) {
    throw new MemoryDeadlineExceededError();
  }

  const controller = new AbortController();
  let rejectBoundary: ((error: MemoryDeadlineExceededError) => void) | null =
    null;
  let settled = false;
  const rejectAsExpired = () => {
    if (settled) return;
    controller.abort(options.signal?.reason);
    rejectBoundary?.(new MemoryDeadlineExceededError());
  };
  const boundary = new Promise<never>((_, reject) => {
    rejectBoundary = reject;
  });
  const timer = setTimeout(rejectAsExpired, Math.max(1, remaining));
  timer.unref?.();
  options.signal?.addEventListener("abort", rejectAsExpired, { once: true });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      boundary,
    ]);
  } finally {
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", rejectAsExpired);
  }
}
