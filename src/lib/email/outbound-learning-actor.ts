export interface OutboundLearningActorInput {
  activityCreatedBy?: string | null;
  connectionType: "company" | "individual";
  connectionOwnerId?: string | null;
}

/**
 * Resolve only identity evidence that actually proves who authored a message.
 *
 * A shared mailbox address can be used by many OPS users, so its From address,
 * connection creator, and any matching login email are never actor evidence.
 */
export function resolveOutboundLearningActorId(
  input: OutboundLearningActorInput
): string | null {
  const recordedActor = input.activityCreatedBy?.trim();
  if (recordedActor) return recordedActor;

  if (input.connectionType !== "individual") return null;
  return input.connectionOwnerId?.trim() || null;
}
