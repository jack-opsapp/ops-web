import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { runWithEmailConnectionSyncLock } from "./email-connection-sync-lock";

export type EmailProviderMailboxCheckpoint = (force?: boolean) => Promise<void>;

export class EmailProviderMailboxLeaseError extends Error {
  readonly code: string;

  constructor(code: string, options?: { cause?: unknown }) {
    super(code);
    this.name = "EmailProviderMailboxLeaseError";
    this.code = code;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

export class EmailProviderMailboxBusyError extends EmailProviderMailboxLeaseError {
  constructor(code: string) {
    super(code);
    this.name = "EmailProviderMailboxBusyError";
  }
}

export function isEmailProviderMailboxLeaseError(
  error: unknown
): error is EmailProviderMailboxLeaseError {
  return (
    error instanceof EmailProviderMailboxLeaseError ||
    (error instanceof Error &&
      (error.name === "EmailProviderMailboxLeaseError" ||
        error.name === "EmailProviderMailboxBusyError"))
  );
}

export function isEmailProviderMailboxBusyError(
  error: unknown
): error is EmailProviderMailboxBusyError {
  return (
    error instanceof EmailProviderMailboxBusyError ||
    (error instanceof Error && error.name === "EmailProviderMailboxBusyError")
  );
}

/**
 * Serialize one provider operation against sync/import for the same physical
 * mailbox. Callers that already own the lease pass its checkpoint so this
 * helper never attempts nested acquisition.
 */
export async function runEmailProviderMailboxOperation<T>(input: {
  /**
   * Required only when this operation must acquire the mailbox lease itself.
   * An inherited checkpoint already carries the authoritative lease owner and
   * therefore does not need a second database client or nested acquisition.
   */
  supabase?: SupabaseClient;
  connectionId: string;
  context: string;
  busyError: string;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
  run: (checkpoint: EmailProviderMailboxCheckpoint) => Promise<T>;
}): Promise<T> {
  let providerRunStarted = false;
  let providerRunCompleted = false;
  const execute = async (
    checkpoint: EmailProviderMailboxCheckpoint
  ): Promise<T> => {
    await checkpoint();
    providerRunStarted = true;
    const value = await input.run(checkpoint);
    providerRunCompleted = true;
    await checkpoint();
    return value;
  };

  if (input.providerLockCheckpoint) {
    return execute(input.providerLockCheckpoint);
  }

  let locked;
  try {
    locked = await runWithEmailConnectionSyncLock({
      connectionId: input.connectionId,
      context: input.context,
      client: input.supabase,
      run: execute,
    });
  } catch (error) {
    // Provider errors originate while the callback is running and retain
    // their original type. Failures before the provider boundary or after a
    // completed provider operation are mailbox-lease failures and must not be
    // mistaken for a best-effort provider write by callers.
    if (!providerRunStarted || providerRunCompleted) {
      throw new EmailProviderMailboxLeaseError(
        `${input.busyError}_LEASE_LOST`,
        { cause: error }
      );
    }
    throw error;
  }
  if (!locked.acquired) {
    throw new EmailProviderMailboxBusyError(input.busyError);
  }
  return locked.value;
}
