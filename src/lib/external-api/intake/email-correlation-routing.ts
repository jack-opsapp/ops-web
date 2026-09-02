import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import {
  InvalidEmailCorrelationMarkerError,
  openEmailCorrelationMarker,
  readEmailCorrelationKeyRing,
  type EmailCorrelationKeyRing,
} from "./email-correlation";

interface EmailCorrelationRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const sourceIdsSchema = z.array(z.string().uuid()).max(100);
const resolvedCorrelationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_found") }).strict(),
  z
    .object({
      status: z.literal("found"),
      opportunity_id: z.string().uuid(),
      client_id: z.string().uuid(),
    })
    .strict(),
]);

export interface ResolvedExternalIntakeEmailCorrelation {
  opportunityId: string;
  clientId: string;
}

interface EmailCorrelationRoutingDependencies {
  client?: EmailCorrelationRpcClient;
  keyRing?: EmailCorrelationKeyRing;
  now?: Date;
}

/**
 * Authenticate an intake marker against the mailbox currently ingesting the
 * provider message, then revalidate its immutable submission-to-lead mapping
 * in the database. Marker failures are deliberately a no-match so ordinary
 * email ingestion continues; database failures remain retryable.
 */
export async function resolveExternalIntakeEmailCorrelation(
  input: Readonly<{
    marker: string | null;
    companyId: string;
    mailboxId: string;
  }>,
  dependencies: EmailCorrelationRoutingDependencies = {}
): Promise<ResolvedExternalIntakeEmailCorrelation | null> {
  if (!input.marker) return null;

  let keyRing: EmailCorrelationKeyRing;
  try {
    keyRing = dependencies.keyRing ?? readEmailCorrelationKeyRing();
  } catch {
    return null;
  }

  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as EmailCorrelationRpcClient);
  const sourcesResponse = await client.rpc(
    "list_external_intake_email_correlation_sources_as_system",
    {
      p_company_id: input.companyId,
      p_mailbox_id: input.mailboxId,
    }
  );
  if (sourcesResponse.error) {
    throw new Error(
      `external intake email correlation source lookup failed: ${
        sourcesResponse.error.message ?? "unknown error"
      }`
    );
  }
  const parsedSources = sourceIdsSchema.safeParse(sourcesResponse.data);
  if (!parsedSources.success) {
    throw new Error(
      "external intake email correlation source lookup returned an invalid result"
    );
  }

  const successful = parsedSources.data.flatMap((sourceId) => {
    try {
      const payload = openEmailCorrelationMarker(
        input.marker!,
        {
          companyId: input.companyId,
          mailboxId: input.mailboxId,
          sourceId,
        },
        keyRing,
        dependencies.now
      );
      return [{ sourceId, payload }];
    } catch (error) {
      if (error instanceof InvalidEmailCorrelationMarkerError) return [];
      throw error;
    }
  });
  if (successful.length !== 1) return null;

  const match = successful[0];
  const resolutionResponse = await client.rpc(
    "resolve_external_intake_email_correlation_as_system",
    {
      p_company_id: input.companyId,
      p_mailbox_id: input.mailboxId,
      p_source_id: match.sourceId,
      p_submission_id: match.payload.submissionId,
      p_opportunity_id: match.payload.leadId,
    }
  );
  if (resolutionResponse.error) {
    throw new Error(
      `external intake email correlation resolution failed: ${
        resolutionResponse.error.message ?? "unknown error"
      }`
    );
  }
  const parsedResolution = resolvedCorrelationSchema.safeParse(
    resolutionResponse.data
  );
  if (!parsedResolution.success) {
    throw new Error(
      "external intake email correlation resolution returned an invalid result"
    );
  }
  if (parsedResolution.data.status === "not_found") return null;
  return {
    opportunityId: parsedResolution.data.opportunity_id,
    clientId: parsedResolution.data.client_id,
  };
}
