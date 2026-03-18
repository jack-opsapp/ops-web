/**
 * OPS Web - Intel Graph Hook
 *
 * TanStack Query hook for the Intel Galaxy unified graph data.
 * Fetches entities, edges, voice profiles, and stats for the
 * galaxy visualization from /api/intel/graph.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { useAuthStore } from "../store/auth-store";

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface IntelEntity {
  id: string;
  type: "person" | "company" | "project" | "invoice" | "estimate" | "voice_profile";
  name: string;
  cluster: "client" | "vendor" | "subtrade" | "internal" | "project" | "financial" | "voice";
  properties: Record<string, unknown>;
  confidence: number;
  createdAt: string;
  source: "email_import" | "ops_data";
}

export interface IntelEdge {
  sourceId: string;
  targetId: string;
  predicate: string;
  properties?: Record<string, unknown>;
}

export interface IntelVoiceProfile {
  profileType: string;
  formalityScore: number;
  toneTraits: string[];
  greetingPatterns: string[];
  closingPatterns: string[];
  vocabularyPreferences: Record<string, unknown>;
  emailsAnalyzed: number;
}

export interface IntelGraphData {
  entities: IntelEntity[];
  edges: IntelEdge[];
  voiceProfiles: IntelVoiceProfile[];
  stats: {
    entityCount: number;
    edgeCount: number;
    profileCount: number;
    lastScanAt: string | null;
  };
  phaseCEnabled: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the unified Intel graph for the current company.
 *
 * Returns all entities and edges for the galaxy visualization —
 * always includes live OPS records (clients, projects, invoices, estimates),
 * and adds Phase C AI entities when the feature is enabled.
 *
 * staleTime: 5 minutes — graph data doesn't change frequently
 */
export function useIntelGraph(
  queryOptions?: Partial<UseQueryOptions<IntelGraphData>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery<IntelGraphData>({
    queryKey: queryKeys.intel.graph(companyId),
    queryFn: async (): Promise<IntelGraphData> => {
      const res = await fetch(`/api/intel/graph?companyId=${companyId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error((body as { error?: string }).error ?? "Failed to fetch intel graph"),
          { status: res.status }
        );
      }
      return res.json() as Promise<IntelGraphData>;
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    ...queryOptions,
  });
}
