// ---------------------------------------------------------------------------
// Intel Galaxy — shared types used by API routes, hooks, and components.
// Single source of truth. Do NOT redefine these interfaces elsewhere.
// ---------------------------------------------------------------------------

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

export interface IntelFact {
  id: string;
  category: string;
  content: string;
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
}

export interface IntelKnowledgeEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  predicate: string;
  linkType: string | null;
  confidence: number;
  properties: Record<string, unknown>;
  createdAt: string;
}

export interface IntelEntityDetail {
  entity: Record<string, unknown> | null;
  facts: IntelFact[];
  edges: IntelKnowledgeEdge[];
  details: Record<string, unknown>;
}
