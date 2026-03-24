// src/lib/types/email-import.ts
// Types for the Import Your Pipeline wizard flow

import type { DetectedSource, PatternDetectionResult } from '@/lib/api/services/pattern-detection-service';
import type { ClassificationResult, ThreadAnalysisResult } from '@/lib/api/services/email-ai-classifier';

// Wizard Step 2 → Step 3: analysis results
export interface AnalysisResult {
  jobId: string;
  status: 'pending' | 'analyzing_sent' | 'detecting_platforms' | 'classifying_ai' | 'analyzing_threads' | 'complete' | 'error';
  progress: {
    stage: string;
    message: string;
    percent: number;
  };
  result?: {
    estimatePattern: string | null;
    estimatePatternConfidence: number;
    estimateThreadCount: number;
    detectedSources: DetectedSource[];
    companyDomains: string[];
    teamForwarders: string[];
    leads: AnalyzedLead[];
    totalScanned: number;
  };
  error?: string;
}

// A lead ready for review in Step 4
export interface AnalyzedLead {
  id: string;
  threadId: string;
  emails: Array<{
    id: string;
    from: string;
    subject: string;
    date: string;
    direction: 'inbound' | 'outbound';
  }>;
  client: {
    name: string;
    email: string;
    phone: string | null;
    description: string;
  };
  stage: string;
  stageConfidence: number;
  estimatedValue: number | null;
  correspondenceCount: number;
  outboundCount: number;
  lastMessageDate: string;
  source: 'pattern' | 'platform' | 'forwarder' | 'ai';
  sourceLabel: string;
  duplicateGroupId: string | null;
  subContacts: Array<{ name: string; email: string; phone: string | null }>;
  /** Up to 6 email excerpts (3 client + 3 owner) with body content for AI validation */
  emailExcerpts?: Array<{
    from: string;
    fromName: string;
    direction: 'inbound' | 'outbound';
    date: string;
    body: string;
  }>;
  matchResult: {
    existingClientId: string | null;
    existingClientName: string | null;
    action: 'link' | 'create_subclient' | 'review' | 'create_new' | 'merge' | 'discard' | 'discard_existing';
    confidence: string;
  };
  enabled: boolean;
  /** AI-detected terminal state: likely already won or lost */
  terminalFlag?: 'likely_won' | 'likely_lost' | null;
  /** Flagged for user review — not a standard lead but needs attention */
  needsReview?: boolean;
  /** Why this was flagged for review */
  reviewReason?: 'legal' | 'job_seeker' | 'collections' | 'platform_bid' | 'warranty' | 'ambiguous' | null;
  /** Merge mode for duplicate resolution — fill blanks or overwrite existing data */
  mergeMode?: 'fill_blanks' | 'overwrite';
}

// ─── Consolidation types (import review sub-step 2) ──────────────────────────

/** A group of leads from the same company that need consolidation */
export interface ConsolidationGroup {
  id: string;
  companyName: string;
  domain: string | null;
  contacts: Array<{
    leadId: string;
    name: string;
    email: string;
    phone: string | null;
  }>;
  leads: Array<{
    leadId: string;
    title: string;
    primaryContactEmail: string;
    correspondenceCount: number;
    lastMessageDate: string;
  }>;
  decision: 'confirm' | 'merge' | null;
}

export type TriageDecision = 'won' | 'lost' | 'active' | 'discard';

// Step 4 → Step 5: import payload
export interface ImportPayload {
  connectionId: string;
  companyId: string;
  leads: Array<{
    id: string;
    threadId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string | null;
    description: string;
    stage: string;
    estimatedValue: number | null;
    correspondenceCount: number;
    outboundCount: number;
    lastMessageDate: string | null;
    existingClientId: string | null;
    action: 'create_new' | 'link' | 'create_subclient' | 'merge' | 'discard' | 'discard_existing';
    mergeMode?: 'fill_blanks' | 'overwrite';
    mergeWithLeadId: string | null;
    subContacts?: Array<{ name: string; email: string; phone: string | null }>;
    /** Opportunity title — only set when client has multiple leads (distinguishing label) */
    title: string | null;
    /** For won/lost leads: close date derived from last email activity */
    actualCloseDate: string | null;
  }>;
  syncProfile: {
    estimateSubjectPatterns: string[];
    companyDomains: string[];
    teamForwarders: string[];
    knownPlatformSenders: string[];
    formSubjectPatterns: string[];
    userEmailAddresses: string[];
    aiClassificationThreshold: number;
  };
}

// Step 5: activation payload
export interface ActivationPayload {
  connectionId: string;
  companyId: string;
  syncIntervalMinutes: number;
  syncProfile: ImportPayload['syncProfile'];
}

// Import result
export interface ImportResult {
  clientsCreated: number;
  leadsCreated: number;
  activitiesLogged: number;
  labelsApplied: number;
  errors: string[];
}
