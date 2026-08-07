/**
 * OPS Web — Client name-backfill planner.
 *
 * Clients auto-created before the local-part guard landed are still carrying a
 * machine-minted name ("canprojack", "New Lead", "Office"). This decides,
 * offline and without any writes, which of them can be renamed and to what.
 *
 * Evidence comes only from what the pipeline already stored for that client —
 * an opportunity's extracted contact name, a sub-contact's name, or a linked
 * thread's resolved sender name — in that order of trust. A candidate that is
 * itself a placeholder is never adopted, so a thread whose sender name was
 * composed from the client's own broken name cannot launder it back in.
 *
 * Operator-set and operator-confirmed names are refused outright: the whole
 * point of field provenance is that a human's correction outranks every
 * machine signal.
 */

import { isPlaceholderClientName } from "@/lib/email/placeholder-name";

export type ClientNameCandidateOrigin =
  | "opportunity"
  | "sub_client"
  | "thread";

export interface ClientNameBackfillRow {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ClientNameCandidate {
  clientId: string;
  name: string | null;
  origin: ClientNameCandidateOrigin;
}

export interface ClientNameBackfillProvenanceRow {
  clientId: string;
  source: string | null;
  confirmedAt: string | null;
}

export interface ClientNameBackfillInput {
  clients: ClientNameBackfillRow[];
  candidates: ClientNameCandidate[];
  provenance: ClientNameBackfillProvenanceRow[];
}

export interface ClientNameBackfillRename {
  clientId: string;
  from: string | null;
  to: string;
  origin: ClientNameCandidateOrigin;
}

export interface ClientNameBackfillRefusal {
  clientId: string;
  reason: "operator_owned" | "no_candidate";
}

export interface ClientNameBackfillPlan {
  checked: number;
  eligible: number;
  renames: ClientNameBackfillRename[];
  refused: ClientNameBackfillRefusal[];
}

const ORIGIN_PRIORITY: Record<ClientNameCandidateOrigin, number> = {
  opportunity: 0,
  sub_client: 1,
  thread: 2,
};

export function planClientNameBackfill(
  input: ClientNameBackfillInput
): ClientNameBackfillPlan {
  const candidatesByClient = new Map<string, ClientNameCandidate[]>();
  for (const candidate of input.candidates) {
    const bucket = candidatesByClient.get(candidate.clientId);
    if (bucket) bucket.push(candidate);
    else candidatesByClient.set(candidate.clientId, [candidate]);
  }

  const provenanceByClient = new Map<string, ClientNameBackfillProvenanceRow>();
  for (const row of input.provenance) {
    provenanceByClient.set(row.clientId, row);
  }

  const plan: ClientNameBackfillPlan = {
    checked: input.clients.length,
    eligible: 0,
    renames: [],
    refused: [],
  };

  for (const client of input.clients) {
    if (!isPlaceholderClientName(client.name, client.email)) continue;
    plan.eligible += 1;

    const provenance = provenanceByClient.get(client.id);
    if (
      provenance &&
      (provenance.source === "operator" || provenance.confirmedAt != null)
    ) {
      plan.refused.push({ clientId: client.id, reason: "operator_owned" });
      continue;
    }

    const currentKey = (client.name ?? "").trim().toLowerCase();
    const usable = (candidatesByClient.get(client.id) ?? [])
      .map((candidate) => ({
        ...candidate,
        name: (candidate.name ?? "").trim(),
      }))
      .filter(
        (candidate) =>
          candidate.name &&
          !isPlaceholderClientName(candidate.name, client.email) &&
          candidate.name.toLowerCase() !== currentKey
      )
      .sort(
        (a, b) => ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin]
      );

    const best = usable[0];
    if (!best) {
      plan.refused.push({ clientId: client.id, reason: "no_candidate" });
      continue;
    }

    plan.renames.push({
      clientId: client.id,
      from: client.name,
      to: best.name,
      origin: best.origin,
    });
  }

  return plan;
}
