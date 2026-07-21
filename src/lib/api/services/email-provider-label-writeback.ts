import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailProviderInterface } from "./email-provider";
import {
  runEmailProviderMailboxOperation,
  type EmailProviderMailboxCheckpoint,
} from "./email-provider-mailbox-operation";

export type EmailProviderLabelWritebackOutcome = "applied" | "provider_failed";

async function applyUnderLease(input: {
  providerThreadId: string;
  providerLabelId: string;
  provider: Pick<EmailProviderInterface, "applyLabel">;
  logPrefix: string;
}): Promise<EmailProviderLabelWritebackOutcome> {
  let outcome: EmailProviderLabelWritebackOutcome = "applied";
  try {
    await input.provider.applyLabel(
      input.providerThreadId,
      input.providerLabelId
    );
  } catch (error) {
    outcome = "provider_failed";
    console.error(`${input.logPrefix} label writeback failed`, error);
  }
  return outcome;
}

export async function applyEmailProviderLabelWriteback(input: {
  supabase: SupabaseClient;
  connectionId: string;
  providerThreadId: string;
  providerLabelId: string;
  provider: Pick<EmailProviderInterface, "applyLabel">;
  context: string;
  busyError: string;
  logPrefix?: string;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<EmailProviderLabelWritebackOutcome> {
  return runEmailProviderMailboxOperation({
    supabase: input.supabase,
    connectionId: input.connectionId,
    context: input.context,
    busyError: input.busyError,
    providerLockCheckpoint: input.providerLockCheckpoint,
    run: () =>
      applyUnderLease({
        providerThreadId: input.providerThreadId,
        providerLabelId: input.providerLabelId,
        provider: input.provider,
        logPrefix: input.logPrefix ?? `[${input.context}]`,
      }),
  });
}
