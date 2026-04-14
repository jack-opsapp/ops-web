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

export interface IntelTask {
  id: string;
  projectId: string;
  title: string;
  /**
   * Raw DB value from project_tasks.status — CHECK constraint allows
   * only three values (verified 2026-04-14 against live DB):
   *   active, completed, cancelled.
   * The TS TaskStatus enum keeps a separate InProgress slot for iOS
   * parity, but project_tasks collapses it into 'active'.
   */
  status: "active" | "completed" | "cancelled";
  taskColor: string;
  startDate: string | null;
  endDate: string | null;
  teamMemberIds: string[];
  displayOrder: number;
  createdAt: string;
}

export interface IntelTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  userColor: string | null;
  role: string;
  profileImageUrl: string | null;
}

export interface IntelClientWithStatus {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  mostActiveProjectStatus: string;
  createdAt: string;
}

export interface IntelGraphData {
  entities: IntelEntity[];
  edges: IntelEdge[];
  voiceProfiles: IntelVoiceProfile[];
  tasks: IntelTask[];
  teamMembers: IntelTeamMember[];
  clientsWithStatus: IntelClientWithStatus[];
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
