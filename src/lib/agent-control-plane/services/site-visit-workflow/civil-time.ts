import { z } from "zod-v4";

const Civil = z.iso.datetime({ local: true, precision: 0 });
export const SiteVisitTimezoneProofSchema = z
  .object({
    timezone: z.string().min(1).max(100),
    probes: z
      .array(
        z
          .object({
            local: Civil,
            instant: z.iso.datetime({ offset: true }),
            utc_offset_minutes: z.number().int().min(-840).max(840),
          })
          .strict()
      )
      .min(1)
      .max(2),
  })
  .strict();

/** PostgreSQL owns IANA interpretation and rejects gaps/unresolved folds.
 * This only checks arithmetic on proof returned by the authenticated RPC. It
 * cannot confer authority on caller-supplied data, and never consults Node ICU.
 * The SQL proposal seals this proof; commit recompiles it under current rules. */
export function verifySiteVisitTimezoneProof(raw: unknown) {
  const proof = SiteVisitTimezoneProofSchema.parse(raw);
  for (const probe of proof.probes) {
    const nominal = Date.parse(`${probe.local}Z`);
    if (
      !Number.isFinite(nominal) ||
      new Date(nominal).toISOString().slice(0, 19) !== probe.local
    )
      throw new Error("INVALID_LOCAL_TIME");
    const instant = Date.parse(probe.instant);
    if (
      !Number.isFinite(instant) ||
      nominal - probe.utc_offset_minutes * 60_000 !== instant
    )
      throw new Error("TIMEZONE_PROOF_MISMATCH");
  }
  return proof;
}
